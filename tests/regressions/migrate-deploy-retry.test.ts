/**
 * Every deploy runs scripts/migrate-deploy-with-retry.mjs before next build
 * (npm run build). A migration that touches a busy table sets its own
 * `SET LOCAL lock_timeout`, so a deploy that meets a long transaction (an
 * ingestion run, a slow read) fails within seconds instead of stalling the
 * site. Postgres rolls that file back whole, but Prisma records it as failed,
 * and until 2026-11-26 every later deploy then stopped with P3009 until
 * someone resolved it by hand. That is why a deploy with migrations had to
 * stay clear of the ingestion runs. The wrapper now marks such a migration
 * rolled back and runs it again after a wait (scripts/migrate-deploy-policy.mjs).
 * These pin when it may do that, and that it leaves the history clean when it
 * stops trying.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    CONNECTION_RETRY_DELAYS_MS,
    LOCK_RETRY_DELAYS_MS,
    classifyFailure,
    deployWithRetry,
    isRetrySafeMigration,
} from '../../scripts/migrate-deploy-policy.mjs';

const MIGRATION = '20261126000006_add_jobs_shadowed_by_job_id_idx';

/** What `prisma migrate deploy` prints when a migration runs out of lock time. */
function lockTimeoutOutput(migration: string = MIGRATION): string {
    return [
        `Applying migration \`${migration}\``,
        'Error: P3018',
        '',
        'A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve',
        '',
        `Migration name: ${migration}`,
        '',
        'Database error code: 55P03',
        '',
        'Database error:',
        'ERROR: canceling statement due to lock timeout',
    ].join('\n');
}

const CONNECTION_OUTPUT = "Error: P1001: Can't reach database server at `db.example.supabase.co:5432`";
const RECORDED_FAILURE_OUTPUT = [
    'Error: P3009',
    '',
    'migrate found failed migrations in the target database, new migrations will not be applied. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve',
    `The \`${MIGRATION}\` migration started at 2026-11-26 04:20:00 UTC failed`,
].join('\n');

const SAFE_SQL = [
    '-- In its own file, so its own transaction.',
    "SET LOCAL lock_timeout = '5s';",
    '',
    'CREATE INDEX IF NOT EXISTS "jobs_shadowed_by_job_id_idx" ON "jobs"("shadowed_by_job_id");',
].join('\n');

type Run = { code: number; output: string };

const failed = (output: string): Run => ({ code: 1, output });
const succeeded: Run = { code: 0, output: 'All migrations have been successfully applied.' };

function fakeIo(deploys: Run[], options: { sql?: string | null; resolveCode?: number } = {}) {
    const queue = [...deploys];
    const sql = options.sql === undefined ? SAFE_SQL : options.sql;
    return {
        deploy: vi.fn<() => Promise<Run>>(async () => queue.shift() ?? succeeded),
        markRolledBack: vi.fn<(migration: string) => Promise<Run>>(async () => ({ code: options.resolveCode ?? 0, output: '' })),
        readMigration: vi.fn<(migration: string) => Promise<string | null>>(async () => sql),
        sleep: vi.fn<(ms: number) => Promise<void>>(async () => undefined),
        log: vi.fn<(line: string) => void>(),
    };
}

describe('classifyFailure', () => {
    it('reads a lock timeout and the migration it stopped', () => {
        expect(classifyFailure(lockTimeoutOutput())).toEqual({ kind: 'lock-timeout', migration: MIGRATION });
    });

    it('knows a lock timeout by its message when no error code is printed', () => {
        const output = lockTimeoutOutput().replace('Database error code: 55P03', '');
        expect(classifyFailure(output)).toEqual({ kind: 'lock-timeout', migration: MIGRATION });
    });

    it('treats a migration that fails for another reason as final', () => {
        const output = lockTimeoutOutput()
            .replace('55P03', '42P07')
            .replace('canceling statement due to lock timeout', 'relation "jobs_shadowed_by_job_id_idx" already exists');
        expect(classifyFailure(output)).toEqual({ kind: 'other' });
    });

    it('treats a failure an earlier deploy recorded as final', () => {
        expect(classifyFailure(RECORDED_FAILURE_OUTPUT)).toEqual({ kind: 'other' });
    });

    it('treats an unreachable database as transient', () => {
        expect(classifyFailure(CONNECTION_OUTPUT)).toEqual({ kind: 'connection' });
    });
});

describe('isRetrySafeMigration', () => {
    it('accepts a file that sets its own lock timeout and runs as one transaction', () => {
        expect(isRetrySafeMigration(SAFE_SQL)).toBe(true);
    });

    it('refuses a file without SET LOCAL lock_timeout', () => {
        expect(isRetrySafeMigration(SAFE_SQL.replace('SET LOCAL', 'SET'))).toBe(false);
        expect(isRetrySafeMigration('ALTER TABLE "jobs" ADD COLUMN "x" TEXT;')).toBe(false);
    });

    it('refuses a file with its own transaction control, which keeps what ran before a COMMIT', () => {
        expect(isRetrySafeMigration(`BEGIN;\n${SAFE_SQL}\nCOMMIT;`)).toBe(false);
        expect(isRetrySafeMigration(`${SAFE_SQL}\nCOMMIT;\nALTER TABLE "jobs" ADD COLUMN "x" TEXT;`)).toBe(false);
        expect(isRetrySafeMigration(`START TRANSACTION;\n${SAFE_SQL}\nEND;`)).toBe(false);
    });

    it('refuses CONCURRENTLY, which runs outside a transaction', () => {
        expect(isRetrySafeMigration(SAFE_SQL.replace('CREATE INDEX', 'CREATE INDEX CONCURRENTLY'))).toBe(false);
    });

    it('does not read words in comments, quoted text or function bodies as commands', () => {
        const sql = [
            "SET LOCAL lock_timeout = '5s';",
            '-- a COMMIT here would keep the column',
            '/* BEGIN; CONCURRENTLY */',
            'DO $$ BEGIN PERFORM 1; END $$;',
            'CREATE FUNCTION "noop"() RETURNS void AS $body$ BEGIN RETURN; END $body$ LANGUAGE plpgsql;',
            "COMMENT ON TABLE \"jobs\" IS 'COMMIT; it''s CONCURRENTLY';",
            'ALTER TABLE "jobs" ADD COLUMN "begin" TEXT;',
        ].join('\n');
        expect(isRetrySafeMigration(sql)).toBe(true);
    });

    it('accepts every migration in this repository that sets SET LOCAL lock_timeout', () => {
        const root = path.join(process.cwd(), 'prisma', 'migrations');
        const withLockTimeout = readdirSync(root)
            .map((folder) => path.join(root, folder, 'migration.sql'))
            .filter((file) => existsSync(file))
            .map((file) => ({ file, sql: readFileSync(file, 'utf8') }))
            .filter(({ sql }) => /\bSET\s+LOCAL\s+lock_timeout\b/i.test(sql));
        expect(withLockTimeout.length).toBeGreaterThan(0);
        // A file here that sets its own lock timeout but is refused would stay
        // failed after a lock timeout, and block every later deploy.
        expect(withLockTimeout.filter(({ sql }) => !isRetrySafeMigration(sql)).map(({ file }) => file)).toEqual([]);
    });
});

describe('deployWithRetry', () => {
    it('runs once when the deploy succeeds', async () => {
        const io = fakeIo([succeeded]);
        await expect(deployWithRetry(io)).resolves.toBe(0);
        expect(io.deploy).toHaveBeenCalledTimes(1);
        expect(io.sleep).not.toHaveBeenCalled();
    });

    it('marks a migration that ran out of lock time rolled back, waits, and runs it again', async () => {
        const io = fakeIo([failed(lockTimeoutOutput()), succeeded]);
        await expect(deployWithRetry(io)).resolves.toBe(0);
        expect(io.readMigration).toHaveBeenCalledWith(MIGRATION);
        expect(io.markRolledBack).toHaveBeenCalledWith(MIGRATION);
        expect(io.sleep).toHaveBeenCalledWith(LOCK_RETRY_DELAYS_MS[0]);
        expect(io.deploy).toHaveBeenCalledTimes(2);
    });

    it('marks each migration that stops, in turn', async () => {
        const second = '20261126000008_add_jobs_twin_company_linked_at';
        const io = fakeIo([failed(lockTimeoutOutput()), failed(lockTimeoutOutput(second)), succeeded]);
        await expect(deployWithRetry(io)).resolves.toBe(0);
        expect(io.markRolledBack.mock.calls).toEqual([[MIGRATION], [second]]);
    });

    it('gives up after the last wait and still leaves the migration marked rolled back, so the next deploy is not blocked', async () => {
        const attempts = LOCK_RETRY_DELAYS_MS.length + 1;
        const io = fakeIo(Array.from({ length: attempts }, () => failed(lockTimeoutOutput())));
        await expect(deployWithRetry(io)).resolves.toBe(1);
        expect(io.deploy).toHaveBeenCalledTimes(attempts);
        expect(io.markRolledBack).toHaveBeenCalledTimes(attempts);
        expect(io.sleep.mock.calls.map(([ms]) => ms)).toEqual(LOCK_RETRY_DELAYS_MS);
    });

    it('leaves a migration that cannot run again safely for a person', async () => {
        const io = fakeIo([failed(lockTimeoutOutput())], { sql: SAFE_SQL.replace('SET LOCAL', 'SET') });
        await expect(deployWithRetry(io)).resolves.toBe(1);
        expect(io.markRolledBack).not.toHaveBeenCalled();
        expect(io.sleep).not.toHaveBeenCalled();
        expect(io.log.mock.calls.flat().join('\n')).toContain('resolve it by hand');
    });

    it('leaves a migration whose file cannot be read for a person', async () => {
        const io = fakeIo([failed(lockTimeoutOutput())], { sql: null });
        await expect(deployWithRetry(io)).resolves.toBe(1);
        expect(io.markRolledBack).not.toHaveBeenCalled();
    });

    it('never puts a name that is not a migration folder into a path or a command', async () => {
        const io = fakeIo([failed(lockTimeoutOutput('../../prisma/schema.prisma'))]);
        await expect(deployWithRetry(io)).resolves.toBe(1);
        expect(io.readMigration).not.toHaveBeenCalled();
        expect(io.markRolledBack).not.toHaveBeenCalled();
    });

    it('stops when the migration cannot be marked rolled back', async () => {
        const io = fakeIo([failed(lockTimeoutOutput())], { resolveCode: 1 });
        await expect(deployWithRetry(io)).resolves.toBe(1);
        expect(io.sleep).not.toHaveBeenCalled();
        expect(io.deploy).toHaveBeenCalledTimes(1);
    });

    it('retries an unreachable database twice, then reports it', async () => {
        const io = fakeIo([failed(CONNECTION_OUTPUT), failed(CONNECTION_OUTPUT), failed(CONNECTION_OUTPUT)]);
        await expect(deployWithRetry(io)).resolves.toBe(1);
        expect(io.deploy).toHaveBeenCalledTimes(3);
        expect(io.sleep.mock.calls.map(([ms]) => ms)).toEqual(CONNECTION_RETRY_DELAYS_MS);
        expect(io.markRolledBack).not.toHaveBeenCalled();
    });

    it('succeeds when the database comes back', async () => {
        const io = fakeIo([failed(CONNECTION_OUTPUT), succeeded]);
        await expect(deployWithRetry(io)).resolves.toBe(0);
        expect(io.sleep).toHaveBeenCalledWith(CONNECTION_RETRY_DELAYS_MS[0]);
    });

    it('reports any other failure at once, unchanged', async () => {
        const io = fakeIo([{ code: 7, output: RECORDED_FAILURE_OUTPUT }]);
        await expect(deployWithRetry(io)).resolves.toBe(7);
        expect(io.deploy).toHaveBeenCalledTimes(1);
        expect(io.sleep).not.toHaveBeenCalled();
        expect(io.markRolledBack).not.toHaveBeenCalled();
    });
});

describe('the build', () => {
    it('applies migrations through the wrapper before next build', () => {
        const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        const steps = pkg.scripts.build.split('&&').map((step) => step.trim());
        expect(steps[0]).toBe('node scripts/migrate-deploy-with-retry.mjs');
        expect(steps.indexOf('next build')).toBeGreaterThan(0);
        expect(steps).not.toContain('prisma migrate deploy');
    });
});

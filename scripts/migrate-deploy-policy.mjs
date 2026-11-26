/**
 * What scripts/migrate-deploy-with-retry.mjs does when `prisma migrate deploy`
 * fails, kept apart from the process handling so tests can drive it
 * (tests/regressions/migrate-deploy-retry.test.ts).
 *
 * Two failures get another attempt:
 * - The database could not be reached. The production build of 171bef4 failed
 *   two minutes in on 2026-11-17 at 18:59 UTC, with no migration in the
 *   commit, while crawler load was exhausting the database's connections; the
 *   same code built later. So it is retried twice, 15 and 30 seconds apart.
 * - A migration gave up waiting for a lock. Migrations that touch busy tables
 *   set `SET LOCAL lock_timeout`, so a deploy that would queue behind a long
 *   transaction (an ingestion run, a slow read) fails within seconds instead
 *   of stalling every query queued behind it. Postgres rolls the whole file
 *   back, since Prisma sends it as one multi-statement query and that runs as
 *   one transaction. Prisma still records the migration as failed, and every
 *   later deploy then stops with P3009 until someone resolves it by hand. So
 *   the migration is marked rolled back, which is true, and run again after a
 *   wait. If the table is still busy after the last attempt, the build fails
 *   with the history left clean, and the next deploy runs the migration again.
 *
 * Anything else (a migration that fails for another reason, a drifted history,
 * a failure recorded by an earlier deploy) is reported at once, unchanged.
 */

export const CONNECTION_RETRY_DELAYS_MS = [15_000, 30_000];

/** About four minutes in all: a lock wait lasts seconds, so this outlasts a busy spell. */
export const LOCK_RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000];

// Prisma's connection error codes: P1001 can't reach the server, P1002 the
// server timed out (also the advisory-lock wait), P1017 the server closed the
// connection. The text patterns cover a pooler or Postgres refusing a client.
const CONNECTION_FAILURE = [
  /\bP1001\b/,
  /\bP1002\b/,
  /\bP1017\b/,
  /too many (clients|connections)/i,
  /max client connections/i,
  /remaining connection slots are reserved/i,
  /ECONNRESET|ETIMEDOUT|ECONNREFUSED/,
];

// P3018 is Prisma's "A migration failed to apply"; 55P03 is Postgres's
// lock_not_available, raised when a lock_timeout runs out.
const FAILED_MIGRATION = /\bP3018\b/;
const LOCK_TIMEOUT = [/\b55P03\b/, /canceling statement due to lock timeout/i];
const MIGRATION_NAME = /^Migration name:\s*(\S+)\s*$/m;

// A migration folder name as this repository writes them: a date or a
// timestamp, then words. Nothing else is put in a path or a command.
const MIGRATION_FOLDER = /^\d{8,14}_[A-Za-z0-9_]+$/;

const SETS_LOCAL_LOCK_TIMEOUT = /\bSET\s+LOCAL\s+lock_timeout\b/i;
const CONCURRENTLY = /\bCONCURRENTLY\b/i;
const TRANSACTION_CONTROL = /^(BEGIN|COMMIT|ROLLBACK|ABORT|END|START\s+TRANSACTION)\b/i;
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

const RESOLVE_GUIDE = 'https://pris.ly/d/migrate-resolve';

/**
 * @param {string} output everything `prisma migrate deploy` printed
 * @returns {{ kind: 'connection' } | { kind: 'lock-timeout', migration: string } | { kind: 'other' }}
 */
export function classifyFailure(output) {
  const migration = MIGRATION_NAME.exec(output)?.[1];
  if (FAILED_MIGRATION.test(output) && migration && LOCK_TIMEOUT.some((pattern) => pattern.test(output))) {
    return { kind: 'lock-timeout', migration };
  }
  if (CONNECTION_FAILURE.some((pattern) => pattern.test(output))) return { kind: 'connection' };
  return { kind: 'other' };
}

/**
 * Whether a migration that ran out of lock time can be marked rolled back and
 * run again. It must set its own lock timeout with SET LOCAL, which holds only
 * inside the one transaction the file runs as. Outside comments and quoted
 * text it must hold no transaction control (a COMMIT keeps what ran before it)
 * and nothing CONCURRENTLY (that runs outside a transaction and can leave an
 * invalid index behind).
 * @param {string} sql the migration file
 */
export function isRetrySafeMigration(sql) {
  const code = codeOf(sql);
  if (!SETS_LOCAL_LOCK_TIMEOUT.test(code) || CONCURRENTLY.test(code)) return false;
  return !code
    .split(';')
    .map((statement) => statement.trim())
    .some((statement) => TRANSACTION_CONTROL.test(statement));
}

/**
 * The SQL with comments removed and every quoted string, quoted name and
 * dollar-quoted body emptied, so a word inside them is not read as a command.
 * @param {string} sql
 */
function codeOf(sql) {
  const parts = [];
  let at = 0;
  while (at < sql.length) {
    const span = skippedSpan(sql, at);
    parts.push(span ? span.replacement : sql[at]);
    at = span ? span.end : at + 1;
  }
  return parts.join('');
}

/**
 * A comment or quoted span starting at `start`, as its end and what stands in
 * for it, or null when none starts there.
 * @param {string} sql
 * @param {number} start
 * @returns {{ end: number, replacement: string } | null}
 */
function skippedSpan(sql, start) {
  if (sql.startsWith('--', start)) {
    const end = sql.indexOf('\n', start);
    return { end: end === -1 ? sql.length : end, replacement: ' ' };
  }
  if (sql.startsWith('/*', start)) {
    const end = sql.indexOf('*/', start + 2);
    return { end: end === -1 ? sql.length : end + 2, replacement: ' ' };
  }
  const tag = sql[start] === '$' ? DOLLAR_TAG.exec(sql.slice(start, start + 64))?.[0] : undefined;
  if (tag) {
    const end = sql.indexOf(tag, start + tag.length);
    return { end: end === -1 ? sql.length : end + tag.length, replacement: "''" };
  }
  const quote = sql[start];
  if (quote === "'" || quote === '"') return { end: quotedEnd(sql, start, quote), replacement: quote + quote };
  return null;
}

/**
 * The index just past a quoted span, where a doubled quote stands for itself.
 * @param {string} sql
 * @param {number} start
 * @param {string} quote
 */
function quotedEnd(sql, start, quote) {
  let at = start + 1;
  while (at < sql.length) {
    if (sql[at] !== quote) at += 1;
    else if (sql[at + 1] === quote) at += 2;
    else return at + 1;
  }
  return sql.length;
}

/**
 * @typedef {{ code: number, output: string }} RunResult
 * @typedef {{
 *   deploy: () => Promise<RunResult>,
 *   markRolledBack: (migration: string) => Promise<RunResult>,
 *   readMigration: (migration: string) => Promise<string | null>,
 *   sleep: (ms: number) => Promise<void>,
 *   log: (line: string) => void,
 * }} DeployIo
 */

/**
 * Runs `prisma migrate deploy` until it succeeds or a failure is final.
 * @param {DeployIo} io
 * @returns {Promise<number>} the exit code for the build
 */
export async function deployWithRetry(io) {
  let connectionRetries = 0;
  let lockRetries = 0;
  for (;;) {
    const { code, output } = await io.deploy();
    if (code === 0) return 0;
    const failure = classifyFailure(output);
    if (failure.kind === 'connection') {
      const delay = CONNECTION_RETRY_DELAYS_MS[connectionRetries];
      if (delay === undefined) {
        io.log(`[migrate] the database stayed unreachable after ${connectionRetries + 1} attempts`);
        return code;
      }
      connectionRetries += 1;
      io.log(`[migrate] could not reach the database; retrying in ${delay / 1000} s`);
      await io.sleep(delay);
    } else if (failure.kind === 'lock-timeout') {
      const delay = await afterLockTimeout(io, failure.migration, lockRetries);
      if (delay === null) return code;
      lockRetries += 1;
      await io.sleep(delay);
    } else {
      io.log('[migrate] prisma migrate deploy failed; not a connection error or a lock timeout, so no retry');
      return code;
    }
  }
}

/**
 * Marks a migration that ran out of lock time as rolled back, when that is
 * safe, and returns how long to wait before the next attempt, or null when
 * there is none.
 * @param {DeployIo} io
 * @param {string} migration
 * @param {number} retriesSoFar
 * @returns {Promise<number | null>}
 */
async function afterLockTimeout(io, migration, retriesSoFar) {
  const sql = MIGRATION_FOLDER.test(migration) ? await io.readMigration(migration) : null;
  if (sql === null || !isRetrySafeMigration(sql)) {
    io.log(`[migrate] ${migration} ran out of lock time and cannot be run again safely; resolve it by hand: ${RESOLVE_GUIDE}`);
    return null;
  }
  const resolved = await io.markRolledBack(migration);
  if (resolved.code !== 0) {
    io.log(`[migrate] could not mark ${migration} rolled back; resolve it by hand: ${RESOLVE_GUIDE}`);
    return null;
  }
  const delay = LOCK_RETRY_DELAYS_MS[retriesSoFar];
  if (delay === undefined) {
    io.log(`[migrate] ${migration} still found its table busy after ${retriesSoFar + 1} attempts. Postgres rolled it back and it is marked so, so the next deploy runs it again.`);
    return null;
  }
  io.log(`[migrate] ${migration} ran out of lock time; Postgres rolled it back and it is marked so. Retrying in ${delay / 1000} s`);
  return delay;
}

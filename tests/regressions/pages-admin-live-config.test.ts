/**
 * /admin/settings and /admin/cron used to report things they never read.
 *
 * Settings was a client component with no data access: every "Active" pill was
 * a literal, and two of the env names it displayed (FB_PAGE_ACCESS_TOKEN,
 * IG_USER_ID) are read nowhere in this codebase. /admin/cron called itself a
 * Health Dashboard while fetching only the vercel.json schedule list, so a
 * cron that had been failing for a week looked exactly like a healthy one.
 *
 * The invariants worth keeping: a settings row may only claim a status it can
 * derive from env keys the runtime actually reads, it never carries a value,
 * and the cron page must find a cron's run history from its scheduled path,
 * including the batch dispatchers and the crons they run.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { blankComments, readCode, sourceFilesUnder } from '../helpers/source';
import {
    INTEGRATION_SECTIONS,
    describeRateLimit,
    readIntegrationStatus,
    type IntegrationRow,
} from '@/app/admin/settings/config-status';
import {
    cronNameFromPath,
    describeTargetGate,
    isRunStale,
    runOutcome,
    staleLabel,
    staleThresholdMs,
    RUN_FINISH_GRACE_MS,
    STALE_RUN_MS,
} from '@/app/admin/cron/cron-run-lookup';
import { CRON_BATCHES, CRON_ENTRIES } from '@/config/cron-schedule';
import { buildExpectedCronCadences } from '@/lib/inngest/functions/cron-watchdog';
import { RATE_LIMITS } from '@/lib/rate-limit';

const ROOT = process.cwd();
const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_ROWS: IntegrationRow[] = INTEGRATION_SECTIONS.flatMap((s) => [...s.rows]);
const ALL_MODE_ROWS = ALL_ROWS.filter((row) => row.mode !== 'any');
const ANY_ROWS = ALL_ROWS.filter((row) => row.mode === 'any');

/** A file's code, or every .ts/.tsx file's code under a folder, comments blanked. */
function readSources(relPath: string): string {
    if (fs.statSync(path.join(ROOT, relPath)).isFile()) return readCode(relPath);
    return sourceFilesUnder([relPath]).map((file) => readCode(file)).join('\n');
}

describe('admin settings config status', () => {
    it('derives every row from env keys, never from a literal', () => {
        expect(ALL_ROWS.length).toBeGreaterThan(0);
        for (const row of ALL_ROWS) {
            expect(row.envKeys.length, row.label).toBeGreaterThan(0);
        }
        // An 'any' row with one key would just be an 'all' row with a twist.
        for (const row of ANY_ROWS) {
            expect(row.envKeys.length, row.label).toBeGreaterThan(1);
        }
    });

    it('reports not configured, naming every key, when the keys are absent', () => {
        for (const row of ALL_ROWS) {
            const status = readIntegrationStatus(row, {});
            expect(status.configured, row.label).toBe(false);
            expect(status.missing).toEqual([...row.envKeys]);
        }
    });

    it('needs every key of an all-keys row', () => {
        for (const row of ALL_MODE_ROWS) {
            const full = Object.fromEntries(row.envKeys.map((k) => [k, 'set']));
            expect(readIntegrationStatus(row, full).configured, row.label).toBe(true);

            if (row.envKeys.length > 1) {
                const partial = Object.fromEntries(row.envKeys.slice(1).map((k) => [k, 'set']));
                const status = readIntegrationStatus(row, partial);
                expect(status.configured).toBe(false);
                expect(status.missing).toEqual([row.envKeys[0]]);
            }
        }
    });

    it('needs only one key of a row whose keys the code reads as alternatives', () => {
        expect(ANY_ROWS.length).toBeGreaterThan(0);
        for (const row of ANY_ROWS) {
            for (const key of row.envKeys) {
                const status = readIntegrationStatus(row, { [key]: 'set' });
                expect(status, `${row.label} with only ${key}`).toEqual({ configured: true, missing: [] });
            }
        }
    });

    it('counts a blank value as missing', () => {
        for (const row of ALL_ROWS) {
            const blank = Object.fromEntries(row.envKeys.map((k) => [k, '   ']));
            expect(readIntegrationStatus(row, blank).configured, row.label).toBe(false);
        }
    });

    it('never carries a value, only key names', () => {
        const secret = 'value-that-must-not-leave-the-server';
        for (const row of ALL_ROWS) {
            const half = Object.fromEntries(row.envKeys.map((k, i) => [k, i === 0 ? secret : '']));
            const status = readIntegrationStatus(row, half);
            expect(Object.keys(status).sort()).toEqual(['configured', 'missing']);
            expect(JSON.stringify(status)).not.toContain(secret);
        }
    });

    it('names env keys the runtime really reads, in code, at the place it says it reads them', () => {
        // The old page displayed FB_PAGE_ACCESS_TOKEN and IG_USER_ID, which no
        // code path looks at: the social posts read POSTIZ_* instead.
        for (const row of ALL_ROWS) {
            const source = readSources(row.readBy);
            for (const key of row.envKeys) {
                expect(source.includes(key), `${row.label} claims ${key} is read by ${row.readBy}`).toBe(true);
            }
        }
    });

    it('lists none of the names the old page showed that nothing reads', () => {
        const keys = ALL_ROWS.flatMap((row) => [...row.envKeys]);
        expect(keys).not.toContain('FB_PAGE_ACCESS_TOKEN');
        expect(keys).not.toContain('IG_USER_ID');
        expect(new Set(ALL_ROWS.map((r) => r.label)).size).toBe(ALL_ROWS.length);
    });

    it('describes every live rate limit in words', () => {
        expect(describeRateLimit({ limit: 20, windowSeconds: 60 })).toBe('20 requests per minute');
        expect(describeRateLimit({ limit: 3, windowSeconds: 3600 })).toBe('3 requests per hour');
        expect(describeRateLimit({ limit: 1, windowSeconds: 86400 })).toBe('1 request per day');
        expect(describeRateLimit({ limit: 5, windowSeconds: 90 })).toBe('5 requests per 90 seconds');
        for (const [name, cfg] of Object.entries(RATE_LIMITS)) {
            expect(describeRateLimit(cfg), name).toMatch(/^\d+ requests? per /);
        }
    });

    it('renders on the server at request time, so env is read live', () => {
        // A client component cannot read env at all, and a static page would
        // freeze the answers at build time.
        const page = readCode('app/admin/settings/page.tsx');
        expect(page).not.toMatch(/^\s*['"]use client['"]/m);
        expect(page).toMatch(/export const dynamic = 'force-dynamic'/);
        expect(page).toContain('readIntegrationStatus(');
        expect(page).toContain('RATE_LIMITS');
        expect(page).toContain('listFlags()');
    });
});

/** The name each cron route passes to withCronTracking, resolving a named constant in its folder. */
function trackedNames(): Map<string, string> {
    const cronDir = path.join(ROOT, 'app/api/cron');
    const names = new Map<string, string>();
    for (const entry of fs.readdirSync(cronDir, { withFileTypes: true })) {
        const file = path.join(cronDir, entry.name, 'route.ts');
        if (!entry.isDirectory() || !fs.existsSync(file)) continue;
        const route = blankComments(fs.readFileSync(file, 'utf8'));
        const literal = route.match(/withCronTracking\(\s*'([^']+)'/);
        if (literal) {
            names.set(entry.name, literal[1]);
            continue;
        }
        const constant = route.match(/withCronTracking\(\s*([A-Z_][A-Z0-9_]*)\s*,/);
        if (!constant) continue;
        const folder = readSources(`app/api/cron/${entry.name}`);
        const definition = folder.match(new RegExp(`const\\s+${constant[1]}\\s*=\\s*'([^']+)'`));
        if (definition) names.set(entry.name, definition[1]);
    }
    return names;
}

describe('cron run lookup', () => {
    it('maps a scheduled path to the name withCronTracking records under', () => {
        expect(cronNameFromPath('/api/cron/index-pseo')).toBe('index-pseo');
        expect(cronNameFromPath('/api/cron/ingest?source=adzuna&chunk=1')).toBe('ingest');
        expect(cronNameFromPath('/api/cron/send-alerts?frequency=daily')).toBe('send-alerts');
        // The batch dispatcher records under batch/<group>, not its last segment.
        expect(cronNameFromPath('/api/cron/batch/morning')).toBe('batch/morning');
    });

    it('agrees with the names the cron routes actually pass to withCronTracking', () => {
        // The join is only useful if it lands on real rows. Read every route,
        // resolve the name it tracks under, and check the path a scheduler
        // calls maps to it rather than trusting the convention holds.
        const names = trackedNames();
        for (const [folder, tracked] of names) {
            expect(cronNameFromPath(`/api/cron/${folder}?source=x`), `${folder} route`).toBe(tracked);
        }
        expect(names.size).toBeGreaterThan(25);
    });

    it('agrees with the batch dispatcher, which tracks under batch/<group>', () => {
        const dispatcher = readCode('app/api/cron/batch/[group]/route.ts');
        expect(dispatcher).toMatch(/withCronTracking\(\s*`batch\/\$\{group\}`/);
        for (const batch of CRON_BATCHES) {
            expect(cronNameFromPath(`/api/cron/batch/${batch.group}`)).toBe(`batch/${batch.group}`);
        }
    });

    it('resolves every scheduled cron and every batch target to a route that records runs', () => {
        const names = new Set(trackedNames().values());
        const groups = new Set(CRON_BATCHES.map((b) => `batch/${b.group}`));
        const scheduled = [
            ...CRON_ENTRIES.map((e) => e.path),
            ...CRON_BATCHES.flatMap((b) => b.targets.map((t) => t.path)),
        ];
        for (const scheduledPath of scheduled) {
            const name = cronNameFromPath(scheduledPath);
            expect(names.has(name) || groups.has(name), `${scheduledPath} records no runs under ${name}`).toBe(true);
        }
    });

    it('keys the stale thresholds by the same names the page looks up', () => {
        // /api/admin/cron-runs keys staleAfterMs by the watchdog's cadence
        // names; the page looks each cron up by cronNameFromPath.
        const expected = new Set(buildExpectedCronCadences().map((c) => c.name));
        for (const entry of CRON_ENTRIES) {
            expect(expected.has(cronNameFromPath(entry.path)), entry.path).toBe(true);
        }
        for (const target of CRON_BATCHES.flatMap((b) => b.targets)) {
            expect(expected.has(cronNameFromPath(target.path)), target.path).toBe(true);
        }
    });

    it('flags a run older than a week and leaves a recent one alone', () => {
        const now = Date.now();
        expect(isRunStale(new Date(now - STALE_RUN_MS - 1000).toISOString(), now)).toBe(true);
        expect(isRunStale(new Date(now - 60_000).toISOString(), now)).toBe(false);
    });

    it('does not call an unparseable timestamp stale', () => {
        expect(isRunStale('not a date')).toBe(false);
    });

    it('waits twice the cadence before flagging a cron that runs less than twice a week', () => {
        expect(staleThresholdMs(12 * 60 * 60 * 1000)).toBe(STALE_RUN_MS);
        expect(staleThresholdMs(undefined)).toBe(STALE_RUN_MS);
        expect(staleThresholdMs(0)).toBe(STALE_RUN_MS);
        const monthly = staleThresholdMs(31 * DAY_MS);
        expect(monthly).toBe(62 * DAY_MS);

        const now = Date.now();
        const tenDaysAgo = new Date(now - 10 * DAY_MS).toISOString();
        expect(isRunStale(tenDaysAgo, now, monthly)).toBe(false);
        expect(isRunStale(tenDaysAgo, now, STALE_RUN_MS)).toBe(true);
    });

    it('labels the stale flag in plain words', () => {
        expect(staleLabel(STALE_RUN_MS)).toBe('No run in over a week');
        expect(staleLabel(62 * DAY_MS)).toBe('No run in over 62 days');
    });

    it('tells a run that is still going from one that never finished', () => {
        const now = Date.now();
        const started = (msAgo: number) => new Date(now - msAgo).toISOString();
        expect(runOutcome({ startedAt: started(1000), finishedAt: started(0), success: true }, now)).toBe('succeeded');
        expect(runOutcome({ startedAt: started(1000), finishedAt: started(0), success: false }, now)).toBe('failed');
        expect(runOutcome({ startedAt: started(60_000), finishedAt: null, success: false }, now)).toBe('running');
        expect(runOutcome({ startedAt: started(RUN_FINISH_GRACE_MS + 1000), finishedAt: null, success: false }, now)).toBe('unfinished');
    });

    it('describes a batch target gate in plain words', () => {
        expect(describeTargetGate({})).toBeNull();
        expect(describeTargetGate({ utcHours: [12] })).toBe('only on the 12:00 UTC run');
        expect(describeTargetGate({ utcDaysOfWeek: [3, 6] })).toBe('Wednesday and Saturday only');
        expect(describeTargetGate({ utcDaysOfMonth: [1] })).toBe('day 1 of the month only');
        for (const target of CRON_BATCHES.flatMap((b) => b.targets)) {
            const gate = describeTargetGate(target);
            if (gate !== null) expect(gate).not.toMatch(/undefined|NaN/);
        }
    });
});

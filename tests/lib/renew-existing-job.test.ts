/**
 * renewExistingJob: what the ingest run writes when a source lists a posting
 * the duplicate check resolved to a stored job.
 *
 * Runs the real function, and the real presence check, against an in-memory
 * jobs table and health record. The last block replays the laps this fix
 * ends: a health check takes a job down, the next ingest run sees a
 * look-alike posting, and the job must come back pointing at that posting
 * with no miss against it (or stay down), so nothing takes it down again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { renewExistingJob, type RenewalListing } from '@/lib/ingestion-service';
import { recordSourcePresence } from '@/lib/health/source-presence';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number): Date => new Date(NOW.getTime() + days * DAY_MS);

interface Row {
    id: string;
    title: string;
    employer: string;
    location: string;
    sourceType: string;
    sourceProvider: string | null;
    externalId: string | null;
    applyLink: string | null;
    isPublished: boolean;
    isManuallyUnpublished: boolean;
    healthConsecutiveMissing: number;
    healthLastSeenAt: Date | null;
    lastLinkCheckedAt: Date | null;
    originalPostedAt: Date;
    expiresAt: Date | null;
    description: string;
    benefits: string[];
    [key: string]: unknown;
}

const row = (over: Partial<Row> = {}): Row => ({
    id: 'job-1',
    title: 'Staff Clinician, Outpatient',
    employer: 'Example Health Group',
    location: 'Austin, TX',
    sourceType: 'external',
    sourceProvider: 'adzuna',
    externalId: 'adzuna_1',
    applyLink: 'https://relister.example/land/ad/1',
    isPublished: true,
    isManuallyUnpublished: false,
    healthConsecutiveMissing: 0,
    healthLastSeenAt: null,
    lastLinkCheckedAt: new Date('2026-11-10T12:00:00.000Z'),
    originalPostedAt: daysFromNow(-5),
    expiresAt: daysFromNow(55),
    description: 'A short description.',
    benefits: [],
    // The category tagger's other inputs: a renewal that changes one re-derives the tags.
    isRemote: false,
    isHybrid: false,
    newGradFriendly: false,
    minYearsExperience: null,
    categoryTags: [],
    ...over,
});

interface HealthRow {
    jobId: string;
    checkType: string;
    alive: boolean;
    checkedAt: Date;
}

interface Table {
    rows: Row[];
    health: HealthRow[];
    updates: Array<{ id: string; data: Record<string, unknown> }>;
}

/** An in-memory jobs table and health record behind the mocked Prisma client. */
function installTable(rows: Row[], health: HealthRow[] = []): Table {
    const table: Table = { rows, health, updates: [] };
    const apply = (target: Row, data: Record<string, unknown>): void => {
        for (const [key, value] of Object.entries(data)) {
            const increment = (value as { increment?: number } | null)?.increment;
            target[key] = typeof increment === 'number' ? Number(target[key] ?? 0) + increment : value;
        }
    };
    vi.mocked(prisma.job.findUnique).mockImplementation((async (args: { where: { id: string }; select?: Record<string, unknown> }) => {
        const found = table.rows.find((r) => r.id === args.where.id);
        if (!found) return null;
        if (!args.select) return { ...found };
        return Object.fromEntries(Object.keys(args.select).map((key) => [key, found[key] ?? null]));
    }) as never);
    vi.mocked(prisma.job.update).mockImplementation((async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        table.updates.push({ id: args.where.id, data: args.data });
        const found = table.rows.find((r) => r.id === args.where.id);
        if (found) apply(found, args.data);
        return {};
    }) as never);
    // The presence check: published jobs of one source, then two bulk writes.
    vi.mocked(prisma.job.findMany).mockImplementation((async (args: { where: { sourceProvider: string; isPublished: boolean } }) =>
        table.rows
            .filter((r) => r.sourceProvider === args.where.sourceProvider && r.isPublished === args.where.isPublished && r.externalId !== null)
            .map((r) => ({ id: r.id, externalId: r.externalId }))) as never);
    vi.mocked(prisma.job.updateMany).mockImplementation((async (args: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
        const hit = table.rows.filter((r) => args.where.id.in.includes(r.id));
        hit.forEach((r) => apply(r, args.data));
        return { count: hit.length };
    }) as never);
    // The newest health row of one job.
    vi.mocked(prisma.jobHealthCheck.findFirst).mockImplementation((async (args: { where: { jobId: string } }) => {
        const mine = table.health.filter((h) => h.jobId === args.where.jobId);
        if (mine.length === 0) return null;
        const newest = mine.reduce((a, b) => (b.checkedAt.getTime() >= a.checkedAt.getTime() ? b : a));
        return { checkType: newest.checkType, alive: newest.alive };
    }) as never);
    return table;
}

const healthRow = (checkType: string, alive: boolean, daysAgo = 1, jobId = 'job-1'): HealthRow => ({
    jobId,
    checkType,
    alive,
    checkedAt: daysFromNow(-daysAgo),
});
const SWEPT = healthRow('source_presence', false);
const LINK_DEAD = healthRow('http_probe', false);
const LINK_ALIVE = healthRow('http_probe', true);

/** A relisted copy the presence sweep took down. */
const sweptRow = (over: Partial<Row> = {}): Row => row({ isPublished: false, healthConsecutiveMissing: 3, ...over });
/** An employer feed's posting a dead-link verdict took down. */
const linkDeadRow = (over: Partial<Row> = {}): Row =>
    row({ sourceProvider: 'lever', externalId: 'lever-acme-1', applyLink: 'https://ats.example/acme/1', isPublished: false, ...over });

/** A look-alike of the stored job: the same title, employer and location under another id. */
const listing = (over: Partial<RenewalListing> = {}): RenewalListing => ({
    source: 'adzuna',
    externalId: 'adzuna_2',
    applyLink: 'https://relister.example/land/ad/2',
    sourceSite: null,
    title: 'Staff Clinician, Outpatient',
    employer: 'Example Health Group',
    location: 'Austin, TX',
    listedThisRun: new Set(['adzuna_2']),
    ...over,
});
const ownListing = (): RenewalListing =>
    listing({ externalId: 'adzuna_1', applyLink: 'https://relister.example/land/ad/1', listedThisRun: new Set(['adzuna_1']) });
const leverLookAlike = (over: Partial<RenewalListing> = {}): RenewalListing =>
    listing({ source: 'lever', externalId: 'lever-acme-2', applyLink: 'https://ats.example/acme/2', listedThisRun: new Set(['lever-acme-2']), ...over });
const employerFeed = (over: Partial<RenewalListing> = {}): RenewalListing =>
    listing({ source: 'greenhouse', externalId: 'gh_9', applyLink: 'https://ats.example/jobs/9', listedThisRun: new Set(['gh_9']), ...over });
/** The same title in a city spelled almost alike: a match for the fuzzy strategy, another opening. */
const NEAR_MISS = { location: 'Houston, TX' };

const identityKeys = (data: Record<string, unknown>): boolean =>
    'externalId' in data || 'applyLink' in data || 'sourceProvider' in data;

/** The rows the presence sweep cron would take down (app/api/cron/source-presence-unpublish). */
const sweepCandidates = (table: Table, threshold = 3): Row[] =>
    table.rows.filter(
        (r) => r.isPublished && !r.isManuallyUnpublished && r.sourceType === 'external' && r.healthConsecutiveMissing >= threshold,
    );

/** What the sweep cron does to them: unpublish, and one audit row each. */
const runSweep = (table: Table): string[] => {
    const down = sweepCandidates(table);
    down.forEach((r) => {
        r.isPublished = false;
        table.health.push({ jobId: r.id, checkType: 'source_presence', alive: false, checkedAt: new Date(NOW.getTime() + table.health.length) });
    });
    return down.map((r) => r.id);
};

/** What the dead-link cron does on a dead verdict: one audit row, and unpublish. */
const flipDead = (table: Table, id = 'job-1'): void => {
    const target = table.rows.find((r) => r.id === id);
    if (!target) return;
    target.isPublished = false;
    table.health.push({ jobId: id, checkType: 'http_probe', alive: false, checkedAt: new Date(NOW.getTime() + table.health.length) });
};

const renew = (table: Table, with_: RenewalListing, fresh: Record<string, unknown> | null = null) =>
    renewExistingJob('job-1', table.rows[0].originalPostedAt, fresh, with_, NOW);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('renewExistingJob: the source returned the stored posting itself', () => {
    it('brings back a job the presence sweep took down and clears its misses, keeping its identity', async () => {
        const table = installTable([sweptRow({ healthConsecutiveMissing: 4 })], [SWEPT]);

        expect(await renew(table, ownListing())).toEqual({ outcome: 'renewed' });

        expect(table.rows[0]).toMatchObject({ isPublished: true, healthConsecutiveMissing: 0, healthLastSeenAt: NOW, externalId: 'adzuna_1' });
        expect(identityKeys(table.updates[0].data)).toBe(false);
    });

    it('does the same when a look-alike was matched and the stored id is in the same fetch', async () => {
        const table = installTable([sweptRow()], [SWEPT]);

        expect(await renew(table, listing({ listedThisRun: new Set(['adzuna_1', 'adzuna_2']) }))).toEqual({ outcome: 'renewed' });

        expect(table.rows[0]).toMatchObject({ isPublished: true, healthConsecutiveMissing: 0, externalId: 'adzuna_1', applyLink: 'https://relister.example/land/ad/1' });
        expect(identityKeys(table.updates[0].data)).toBe(false);
    });

    it('does not read another source\'s fetch as word on the stored posting', async () => {
        // The same id string in an employer feed's fetch says nothing about a
        // relisted copy: the employer feed takes the job over instead.
        const table = installTable([sweptRow()], [SWEPT]);

        expect(await renew(table, employerFeed({ listedThisRun: new Set(['adzuna_1', 'gh_9']) }))).toEqual({ outcome: 'took-over' });
    });

    it('brings back an employer feed\'s posting after a dead-link verdict, but not a relisted one', async () => {
        const employer = installTable([linkDeadRow()], [LINK_DEAD]);
        const own = leverLookAlike({ externalId: 'lever-acme-1', applyLink: 'https://ats.example/acme/1', listedThisRun: new Set(['lever-acme-1']) });
        expect(await renew(employer, own)).toEqual({ outcome: 'renewed' });
        expect(employer.rows[0].isPublished).toBe(true);

        // A relisting source can go on listing a posting whose page is gone.
        const relisted = installTable([row({ isPublished: false })], [LINK_DEAD]);
        expect(await renew(relisted, ownListing())).toEqual({ outcome: 'left-unpublished' });
        expect(relisted.updates).toEqual([]);
    });

    it('keeps a published job live and clears misses the next sweep would act on', async () => {
        const table = installTable([row({ healthConsecutiveMissing: 2 })]);

        expect(await renew(table, ownListing())).toEqual({ outcome: 'renewed' });

        expect(table.rows[0]).toMatchObject({ isPublished: true, healthConsecutiveMissing: 0 });
        // A published job's health record is not read.
        expect(prisma.jobHealthCheck.findFirst).not.toHaveBeenCalled();
    });
});

describe('renewExistingJob: only what the health checks took down comes back', () => {
    it('leaves a job whose newest health row says alive: something else took it down', async () => {
        // A report threshold, an admin edit or a cleanup: none writes a health row.
        for (const with_ of [ownListing(), listing(), employerFeed()]) {
            const table = installTable([row({ isPublished: false })], [LINK_ALIVE]);
            expect(await renew(table, with_)).toEqual({ outcome: 'left-unpublished' });
            expect(table.updates).toEqual([]);
        }
    });

    it('leaves a job with no health record at all', async () => {
        const table = installTable([row({ isPublished: false, healthConsecutiveMissing: 2 })]);
        expect(await renew(table, ownListing())).toEqual({ outcome: 'left-unpublished' });
        expect(table.updates).toEqual([]);
    });

    it('reads a job at the sweep\'s miss threshold as the sweep\'s, when the audit row was not written', async () => {
        // The audit write is best effort; the counter is what the sweep acted on.
        const table = installTable([sweptRow()], [LINK_ALIVE]);
        expect(await renew(table, ownListing())).toEqual({ outcome: 'renewed' });
        expect(table.rows[0].isPublished).toBe(true);
    });

    it('reads the newest row, not an older verdict', async () => {
        // Flipped dead long ago, republished by a recovery probe, then taken
        // down by something that left no row.
        const table = installTable([row({ isPublished: false })], [healthRow('http_probe', false, 9), healthRow('http_probe', true, 2)]);
        expect(await renew(table, listing())).toEqual({ outcome: 'left-unpublished' });
    });

    it('does not read an expiry row as a health takedown', async () => {
        const table = installTable([row({ isPublished: false })], [healthRow('expiry', false)]);
        expect(await renew(table, listing())).toEqual({ outcome: 'left-unpublished' });
    });

    it('never republishes a job an employer posted on the board', async () => {
        const table = installTable([row({ sourceType: 'employer', sourceProvider: null, externalId: null, isPublished: false })], [LINK_DEAD]);
        expect(await renew(table, employerFeed())).toEqual({ outcome: 'left-unpublished' });
        expect(table.updates).toEqual([]);
    });
});

describe('renewExistingJob: a different posting', () => {
    it('from the same source takes over a job whose own posting is gone', async () => {
        const table = installTable([sweptRow()], [SWEPT]);

        expect(await renew(table, listing())).toEqual({ outcome: 'took-over' });

        expect(table.rows[0]).toMatchObject({
            isPublished: true,
            sourceProvider: 'adzuna',
            externalId: 'adzuna_2',
            applyLink: 'https://relister.example/land/ad/2',
            healthConsecutiveMissing: 0,
            healthLastSeenAt: NOW,
            lastLinkCheckedAt: null,
        });
    });

    it('stamps the content change when a job comes back, and not on a plain refresh', async () => {
        const back = installTable([sweptRow()], [SWEPT]);
        await renew(back, listing());
        expect(back.updates[0].data.contentChangedAt).toEqual(NOW);

        const refreshed = installTable([row()]);
        await renew(refreshed, listing());
        expect('contentChangedAt' in refreshed.updates[0].data).toBe(false);
    });

    it('takes over a job the dead-link check took down, which carries no presence miss', async () => {
        const table = installTable([linkDeadRow()], [LINK_DEAD]);

        expect(await renew(table, leverLookAlike())).toEqual({ outcome: 'took-over' });
        expect(table.rows[0]).toMatchObject({ isPublished: true, externalId: 'lever-acme-2', applyLink: 'https://ats.example/acme/2' });
    });

    it('reads identity the way the duplicate check does: case, punctuation and a company suffix do not matter', async () => {
        const table = installTable([sweptRow()], [SWEPT]);
        const reworded = listing({ title: 'STAFF CLINICIAN - Outpatient', employer: 'Example Health Group, LLC', location: 'Austin, TX' });

        expect(await renew(table, reworded)).toEqual({ outcome: 'took-over' });
    });

    it('that is a near miss is never put under the stored job: it is stored on its own', async () => {
        // The fuzzy strategy matches the same title in a city spelled almost
        // alike. Taking the job over would put that opening's apply link
        // under this job's place.
        const sameSource = installTable([sweptRow()], [SWEPT]);
        expect(await renew(sameSource, listing(NEAR_MISS))).toEqual({ outcome: 'separate' });
        expect(sameSource.updates).toEqual([]);
        expect(sameSource.rows[0].isPublished).toBe(false);

        const fromEmployerFeed = installTable([sweptRow()], [SWEPT]);
        expect(await renew(fromEmployerFeed, employerFeed(NEAR_MISS))).toEqual({ outcome: 'separate' });
        expect(fromEmployerFeed.updates).toEqual([]);
    });

    it('only refreshes a published job: no publish, id or link in the write', async () => {
        const noMissYet = installTable([row()]);
        expect(await renew(noMissYet, listing())).toEqual({ outcome: 'renewed' });
        expect(noMissYet.updates).toEqual([{ id: 'job-1', data: { updatedAt: NOW } }]);

        const nearMiss = installTable([row({ healthConsecutiveMissing: 2 })]);
        expect(await renew(nearMiss, listing(NEAR_MISS))).toEqual({ outcome: 'renewed' });
        expect(nearMiss.updates).toEqual([{ id: 'job-1', data: { updatedAt: NOW } }]);
    });

    it('still merges what the fresh copy improves, on a refresh and on a take-over', async () => {
        const longer = 'A much longer description of the role, the team, the schedule and the pay. '.repeat(5);
        const refreshed = installTable([row()]);
        await renew(refreshed, listing(), { description: longer });
        expect(refreshed.rows[0].description).toBe(longer);

        const takenOver = installTable([sweptRow()], [SWEPT]);
        await renew(takenOver, listing(), { description: longer });
        expect(takenOver.rows[0]).toMatchObject({ description: longer, externalId: 'adzuna_2' });
    });

    it('from a relisting source leaves a job its own employer feed closed: nothing is written', async () => {
        const table = installTable([linkDeadRow()], [LINK_DEAD]);

        expect(await renew(table, listing(), { description: 'x'.repeat(900) })).toEqual({ outcome: 'left-unpublished' });

        expect(table.updates).toEqual([]);
        expect(table.rows[0].isPublished).toBe(false);
    });

    it('from an employer feed takes over an unpublished relisted copy, which becomes the employer\'s posting', async () => {
        const table = installTable([sweptRow()], [SWEPT]);

        expect(await renew(table, employerFeed())).toEqual({ outcome: 'took-over' });
        expect(table.rows[0]).toMatchObject({ isPublished: true, sourceProvider: 'greenhouse', externalId: 'gh_9', applyLink: 'https://ats.example/jobs/9' });
    });
});

describe('renewExistingJob: the states it leaves alone', () => {
    it('a job a person took down', async () => {
        const table = installTable([row({ isPublished: false, isManuallyUnpublished: true })], [SWEPT]);
        expect(await renew(table, listing())).toEqual({ outcome: 'manually-unpublished' });
        expect(table.updates).toEqual([]);
    });

    it('a job past its own expiry', async () => {
        const table = installTable([row({ isPublished: false, expiresAt: daysFromNow(-1) })], [SWEPT]);
        expect(await renew(table, listing())).toEqual({ outcome: 'expired' });
        expect(table.updates).toEqual([]);
    });

    it('a job that is not there', async () => {
        installTable([]);
        expect(await renewExistingJob('job-1', NOW, null, listing(), NOW)).toEqual({ outcome: 'missing' });
    });

    it('past the 60 day age cap a published job is unpublished once, and an unpublished one is not written again', async () => {
        const live = installTable([row({ originalPostedAt: daysFromNow(-61), expiresAt: null })]);
        expect(await renew(live, listing())).toEqual({ outcome: 'age-expired', ageDays: 61 });
        expect(live.updates).toEqual([{ id: 'job-1', data: { isPublished: false } }]);

        const down = installTable([row({ originalPostedAt: daysFromNow(-61), expiresAt: null, isPublished: false })]);
        expect(await renew(down, listing())).toEqual({ outcome: 'age-expired', ageDays: 61 });
        expect(down.updates).toEqual([]);
    });
});

describe('the takedown and republish laps', () => {
    const presenceRun = (fetched: string[], source = 'adzuna') =>
        recordSourcePresence(prisma, { source, fetchedExternalIds: fetched, fetchedCount: fetched.length, historicalAvgFetched: fetched.length });

    it('presence: a relisted role comes back once, pointing at the live posting, and the sweep leaves it up', async () => {
        const table = installTable([row({ healthConsecutiveMissing: 3 })]);
        expect(runSweep(table)).toEqual(['job-1']);

        // Three ingest runs in a row: the source lists the role under a new id.
        for (let run = 0; run < 3; run++) {
            await renew(table, listing());
            await presenceRun(['adzuna_2']);
            expect(runSweep(table)).toEqual([]);
        }

        expect(table.rows[0]).toMatchObject({ isPublished: true, externalId: 'adzuna_2', healthConsecutiveMissing: 0 });
        // One take-over, then plain renewals of the job's own posting.
        expect(table.updates.filter((u) => 'externalId' in u.data)).toHaveLength(1);
    });

    it('presence: a job whose own posting returns is not taken down again while the presence check is skipped', async () => {
        const table = installTable([row({ healthConsecutiveMissing: 3 })]);
        runSweep(table);

        await renew(table, ownListing());
        // No presence run here: a partial fetch skips it.

        expect(table.rows[0].isPublished).toBe(true);
        expect(runSweep(table)).toEqual([]);
    });

    it('presence: a closed employer posting stays down while a relisting source still carries a copy', async () => {
        const table = installTable([row({ sourceProvider: 'workday', externalId: 'wd-1', applyLink: 'https://ats.example/wd/1', healthConsecutiveMissing: 3 })]);
        expect(runSweep(table)).toEqual(['job-1']);

        for (let run = 0; run < 3; run++) {
            expect(await renew(table, listing())).toEqual({ outcome: 'left-unpublished' });
            expect(runSweep(table)).toEqual([]);
        }

        expect(table.rows[0].isPublished).toBe(false);
        expect(table.updates).toEqual([]);
    });

    it('presence: a published job with misses is moved to the live id before the sweep reaches it', async () => {
        const table = installTable([row({ healthConsecutiveMissing: 2 })]);

        expect(await renew(table, listing())).toEqual({ outcome: 'took-over' });
        await presenceRun(['adzuna_2']);

        expect(runSweep(table)).toEqual([]);
        expect(table.rows[0]).toMatchObject({ isPublished: true, externalId: 'adzuna_2', healthConsecutiveMissing: 0 });
    });

    it('dead link: a reposted role comes back with the new link, and never with the dead one', async () => {
        const table = installTable([row({ sourceProvider: 'lever', externalId: 'lever-acme-1', applyLink: 'https://ats.example/acme/1' })]);
        flipDead(table);

        // The employer reposted the role: the feed lists it under a new id.
        expect(await renew(table, leverLookAlike())).toEqual({ outcome: 'took-over' });
        expect(table.rows[0]).toMatchObject({ isPublished: true, applyLink: 'https://ats.example/acme/2', lastLinkCheckedAt: null });

        // The next runs match the job's own posting: nothing is rewritten.
        for (let run = 0; run < 3; run++) {
            const own = leverLookAlike({ listedThisRun: new Set(['lever-acme-2']) });
            expect(await renew(table, own)).toEqual({ outcome: 'renewed' });
        }
        expect(table.rows[0].applyLink).toBe('https://ats.example/acme/2');
        expect(table.updates.filter((u) => 'applyLink' in u.data)).toHaveLength(1);
    });

    it('dead link: a relisted copy that outlives its page does not come back run after run', async () => {
        const table = installTable([row()]);
        flipDead(table);

        for (let run = 0; run < 3; run++) {
            expect(await renew(table, ownListing())).toEqual({ outcome: 'left-unpublished' });
        }
        expect(table.rows[0].isPublished).toBe(false);
        expect(table.updates).toEqual([]);
    });

    it('a job enough people reported stays down, whatever its source lists', async () => {
        const table = installTable([row()], [LINK_ALIVE]);
        // The report threshold unpublishes and writes no health row.
        table.rows[0].isPublished = false;

        for (const with_ of [ownListing(), listing(), employerFeed()]) {
            expect(await renew(table, with_)).toEqual({ outcome: 'left-unpublished' });
        }
        expect(table.rows[0].isPublished).toBe(false);
        expect(table.updates).toEqual([]);
    });
});

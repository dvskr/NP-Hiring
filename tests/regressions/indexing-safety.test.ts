/**
 * Search indexing safety.
 *
 * Five failures that are all invisible today, because every key in the
 * indexing pipeline is empty, and all five become live and expensive the
 * moment an owner pastes credentials in:
 *
 *  1. app/api/cron/historical-deindex classified any non 2xx/3xx HEAD result
 *     as dead and asked Google to REMOVE the URL. A 5xx means our own server
 *     had a problem, so one Vercel incident during a sweep would have handed
 *     Google removal requests for live pages across a 25,000 URL surface,
 *     unattended, at 01:00.
 *  2. The Google Indexing API allows 200 publishes a day for the whole
 *     project, and the per caller caps summed to more than 6,000. Whoever
 *     fired first won, which put the least valuable callers first. The budget
 *     that fixes it introduces a failure of its own, pinned below: a row whose
 *     Google publish was deferred must not be retired from the de-index queue
 *     on an IndexNow success, because IndexNow cannot remove a URL from
 *     Google and the queue only looks at rows still marked pending.
 *  3. The same cron, run before the Google key exists, would drain the queue
 *     without ever reaching Google, so the backlog would be gone by the time
 *     the owner armed it. It now stops before it reads the queue.
 *  4. The IndexNow key lived under two env names and half the readers only
 *     knew one of them.
 *  5. app/api/cron/index-pseo published category x city landings, which carry
 *     no JobPosting markup, to the Google Indexing API, and the blog publish
 *     did the same for posts. Google limits the API to JobPosting and
 *     BroadcastEvent pages and can revoke access for the whole Cloud project,
 *     which would take the in-policy job publishes and removals down with it.
 *     lib/search-indexing.ts now refuses every other page type for every
 *     caller, and index-pseo has no Google leg at all.
 *
 * Nothing here touches the network or the database. Every fetch is mocked,
 * including the Google OAuth exchange, so "Google was asked" is a real code
 * path in the tests that assert it rather than an assumption.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

// Local prisma mock: the shared tests/setup.ts mock has no deindexQueue model,
// and shared test files must not be edited. This file-level mock overrides the
// setup-level one for this module graph only.
vi.mock('@/lib/prisma', () => ({
    prisma: {
        deindexQueue: {
            findMany: vi.fn(),
            updateMany: vi.fn(),
            update: vi.fn(),
        },
        cronRun: {
            create: vi.fn().mockResolvedValue({ id: 'cron-run-test' }),
            update: vi.fn(),
        },
        pseoStats: {
            findMany: vi.fn(),
            upsert: vi.fn(),
        },
        $queryRaw: vi.fn(),
    },
}));
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({
    verifyCronOrAdmin: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/discord-notifier', () => ({
    sendCronFailureAlert: vi.fn().mockResolvedValue(undefined),
}));
// The real dataset is tens of thousands of lines; index-pseo only reads the
// population and the shortage flag, so three stand-in cities cover every
// branch of its gate: two above the population floor and one below it.
vi.mock('@/lib/pseo/city-data/cities', () => {
    const cities: Record<string, { population: number; mentalHealthShortage: boolean }> = {
        'large-city-tx': { population: 600000, mentalHealthShortage: false },
        'mid-city-oh': { population: 120000, mentalHealthShortage: false },
        'hamlet-vt': { population: 900, mentalHealthShortage: false },
    };
    return { getCityBySlug: (slug: string) => cities[slug] };
});

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { slugify } from '@/lib/utils';
import {
    GOOGLE_BUDGET_REFUSED,
    GOOGLE_DAILY_HEADROOM,
    GOOGLE_DAILY_PUBLISH_QUOTA,
    GOOGLE_INDEXING_LANES,
    GOOGLE_NOT_CONFIGURED,
    GOOGLE_POLICY_REFUSED,
    GOOGLE_TOKEN_EXCHANGE_FAILED,
    googleWasNotAsked,
    isGoogleBudgetRefusal,
    isGoogleIndexingEligibleUrl,
    isGooglePolicyRefusal,
    pingAllSearchEngines,
    pingAllSearchEnginesBatch,
    pingAllSearchEnginesBatchDeleted,
    pingGoogle,
    resetGoogleIndexingBudget,
    type GoogleIndexingLane,
} from '@/lib/search-indexing';
import { pingIndexNow } from '@/lib/indexnow';
import { matchIndexNowKeyPath, resolveIndexNowKey } from '@/lib/indexnow-key-file';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Repo-relative paths of every .ts/.tsx file under `dirs`, forward slashes. */
function sourceFiles(dirs: string[]): string[] {
    const files: string[] = [];
    for (const dir of dirs) {
        const stack = [path.join(ROOT, dir)];
        while (stack.length > 0) {
            const current = stack.pop() as string;
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) stack.push(full);
                else if (/\.tsx?$/.test(entry.name)) {
                    files.push(path.relative(ROOT, full).replace(/\\/g, '/'));
                }
            }
        }
    }
    return files;
}

const INDEXING_KEYS = [
    'GOOGLE_INDEXING_CREDENTIALS',
    'INDEXNOW_KEY',
    'INDEXNOW_API_KEY',
    'BING_WEBMASTER_API_KEY',
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
    // The budget is per invocation, so each test starts with a full lane.
    resetGoogleIndexingBudget();
    // Re-armed here rather than in the vi.mock factory because the afterEach
    // restore strips implementations, and withCronTracking only logs when the
    // cron_run row cannot be created, so a stale mock would hide behind noise.
    vi.mocked(prisma.cronRun.create).mockResolvedValue({ id: 'cron-run-test' } as never);
    for (const key of INDEXING_KEYS) {
        savedEnv.set(key, process.env[key]);
        delete process.env[key];
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    savedEnv.clear();
});

// ─── Job page URLs in the shape the detail page resolves ────────────────────

/**
 * A UUID the job page's resolver accepts, distinct per index. The detail page
 * finds a job only by a trailing UUID in its slug, and lib/search-indexing.ts
 * only lets that shape reach Google, so every job fixture here carries one.
 */
const jobUuid = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** A job detail URL, e.g. /jobs/gone-00000000-0000-4000-8000-000000000003. */
const jobUrl = (label: string, i = 0): string => `${brand.baseUrl}/jobs/${label}-${jobUuid(i)}`;

// ─── Credible credentials, so "Google was asked" is a real code path ────────

/**
 * A real RSA key, because lib/search-indexing.ts signs a JWT with it before it
 * will talk to Google. A placeholder string throws inside crypto and every
 * publish would come back as a generic failure, which would let a test assert
 * "Google was asked" about a call that never got near the OAuth exchange.
 */
const { privateKey: SERVICE_ACCOUNT_PRIVATE_KEY } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const SERVICE_ACCOUNT_EMAIL = 'indexer@test-project.iam.gserviceaccount.com';

/** Put the cron in the state an owner reaches after pasting the key in. */
function armGoogle(): void {
    process.env.GOOGLE_INDEXING_CREDENTIALS = JSON.stringify({
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: SERVICE_ACCOUNT_PRIVATE_KEY,
    });
}

/** Arm the two engines that carry no page type restriction. */
function armBingAndIndexNow(): void {
    process.env.BING_WEBMASTER_API_KEY = 'bing-test-key';
    process.env.INDEXNOW_KEY = 'f'.repeat(32);
}

interface NetworkOptions {
    /** What every HEAD check on one of our own URLs answers with. */
    headStatus: number;
    /** What the Indexing API answers. Default 200, an accepted publish. */
    googleStatus?: number;
    /** What IndexNow answers. Default 503, so only Google can retire a row. */
    indexNowStatus?: number;
    /** What the Bing URL Submission API answers. Default 200. */
    bingStatus?: number;
}

/**
 * One mock for the whole network. Routing by URL keeps the endpoints
 * independent, which is what lets a test say "Google accepted and IndexNow did
 * not" and mean it.
 */
const mockNetwork = (opts: NetworkOptions) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com')) {
            return new Response(JSON.stringify({ access_token: 'test-access-token' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (url.includes('indexing.googleapis.com')) {
            return new Response('', { status: opts.googleStatus ?? 200 });
        }
        if (url.includes('indexnow')) {
            return new Response('', { status: opts.indexNowStatus ?? 503 });
        }
        if (url.includes('ssl.bing.com')) {
            return new Response('', { status: opts.bingStatus ?? 200 });
        }
        return new Response(null, { status: opts.headStatus });
    });

type FetchMock = ReturnType<typeof mockNetwork>;

/** Every URL this run asked the Indexing API to publish, in order. */
const googlePublishedUrls = (fetchMock: FetchMock): string[] =>
    fetchMock.mock.calls
        .filter((call) => String(call[0]).includes('indexing.googleapis.com'))
        .map((call) => JSON.parse(String((call[1] as RequestInit).body)).url as string);

/** True when anything at all went to a Google endpoint, OAuth included. */
const touchedGoogle = (fetchMock: FetchMock): boolean =>
    fetchMock.mock.calls.some((call) => String(call[0]).includes('googleapis.com'));

// ─── 1. Only a proven-gone status may trigger a removal ─────────────────────

interface QueueRow {
    id: string;
    url: string;
    attempt: number;
}

const queueRows = (count: number, attempt = 0): QueueRow[] =>
    Array.from({ length: count }, (_, i) => ({
        id: `row-${i}`,
        url: jobUrl('legacy-posting', i),
        attempt,
    }));

async function runDeindexCron(): Promise<{ status: number; body: Record<string, unknown> }> {
    const { GET } = await import('@/app/api/cron/historical-deindex/route');
    const res = await GET(
        new Request('https://example.com/api/cron/historical-deindex', {
            headers: { authorization: 'Bearer test' },
        }) as never,
    );
    return { status: res.status, body: await res.json() };
}

/** Every prisma.deindexQueue.update this run made, with the row it targeted. */
const queueUpdateCalls = (): Array<{ id: string; data: Record<string, unknown> }> =>
    vi.mocked(prisma.deindexQueue.update).mock.calls.map((call) => {
        const arg = call[0] as { where: { id: string }; data: Record<string, unknown> };
        return { id: arg.where.id, data: arg.data };
    });

/** The data payload of every prisma.deindexQueue.update this run made. */
const queueUpdates = (): Record<string, unknown>[] => queueUpdateCalls().map((call) => call.data);

describe('historical-deindex only removes URLs it can prove are gone', () => {
    // 5xx is the one that must never regress: it is OUR fault, not evidence.
    // The rest are the statuses a WAF, a CDN, an auth wall or a picky host
    // returns for a page that renders perfectly well for Googlebot.
    const NOT_PROOF_OF_ABSENCE = [500, 502, 503, 504, 429, 403, 401, 405, 400, 451];

    for (const status of NOT_PROOF_OF_ABSENCE) {
        it(`treats HTTP ${status} as retryable and submits no removal`, async () => {
            armGoogle();
            const rows = queueRows(3);
            vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(rows as never);
            mockNetwork({ headStatus: status });

            const { body } = await runDeindexCron();

            expect(body.submitted).toBe(0);
            expect(body.submitFailed).toBe(0);
            expect(body.headFailed).toBe(3);
            expect(prisma.deindexQueue.updateMany).not.toHaveBeenCalled();

            // Each row bumps its attempt counter and stays pending for retry.
            expect(prisma.deindexQueue.update).toHaveBeenCalledTimes(3);
            for (const data of queueUpdates()) {
                expect(data.status).toBe('pending');
                expect(data.attempt).toBe(1);
            }
        });
    }

    for (const status of [404, 410]) {
        it(`treats HTTP ${status} as gone and asks Google to remove it`, async () => {
            armGoogle();
            vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(queueRows(2) as never);
            const fetchMock = mockNetwork({ headStatus: status });

            const { body } = await runDeindexCron();

            expect(body.headFailed).toBe(0);
            expect(body.submitted).toBe(2);

            const published = fetchMock.mock.calls.filter((call) =>
                String(call[0]).includes('indexing.googleapis.com'),
            );
            expect(published).toHaveLength(2);
            for (const call of published) {
                expect(JSON.parse(String((call[1] as RequestInit).body)).type).toBe('URL_DELETED');
            }
        });
    }

    for (const status of [200, 301]) {
        it(`treats HTTP ${status} as live and clears the rows without submitting`, async () => {
            armGoogle();
            vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(queueRows(2) as never);
            mockNetwork({ headStatus: status });

            const { body } = await runDeindexCron();

            expect(body.live).toBe(2);
            expect(body.submitted).toBe(0);
            expect(prisma.deindexQueue.updateMany).toHaveBeenCalledTimes(1);
        });
    }

    it('never asks any search engine about a URL that only returned 503', async () => {
        armGoogle();
        vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(queueRows(2) as never);
        const fetchMock = mockNetwork({ headStatus: 503 });

        await runDeindexCron();

        for (const call of fetchMock.mock.calls) {
            const url = String(call[0]);
            expect(url).not.toContain('googleapis.com');
            expect(url).not.toContain('indexnow');
            expect((call[1] as RequestInit | undefined)?.method).toBe('HEAD');
        }
    });

    it('does not spend a retry attempt on a publish the budget refused', async () => {
        // backlog-removal grants a fixed number of publishes per invocation.
        // Queue one more gone URL than that: the overflow is refused before it
        // reaches Google, so those rows must come back untouched except for a
        // note, not one attempt closer to being marked failed for good.
        armGoogle();
        const cap = GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation;
        vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(queueRows(cap + 4) as never);
        mockNetwork({ headStatus: 410 });

        const { body } = await runDeindexCron();

        expect(body.submitted).toBe(cap);
        expect(body.budgetDeferred).toBe(4);

        const deferred = queueUpdates().filter((data) => !('attempt' in data));
        expect(deferred).toHaveLength(4);
        for (const data of deferred) {
            expect(data.status).toBeUndefined();
            expect(String(data.lastError)).toContain('Deferred');
            expect(String(data.lastError)).toContain(GOOGLE_BUDGET_REFUSED);
        }
    });

    it('does not retire a deferred row just because IndexNow accepted it', async () => {
        // The budget made this possible and it has to be pinned. IndexNow
        // reaches Bing, Yandex and Seznam but cannot remove anything from
        // Google. Counting an IndexNow acceptance as success for a row the
        // Google budget never reached would take that row out of a queue
        // filtered on status 'pending', so Google would never be asked about
        // the URL at all. With a batch of 50 against the lane's much smaller
        // per run grant, that is most of the backlog, reported to the admin
        // page as submitted.
        armGoogle();
        process.env.INDEXNOW_KEY = 'd'.repeat(32);
        const cap = GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation;
        vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(queueRows(cap + 4) as never);
        mockNetwork({ headStatus: 410, indexNowStatus: 200 });

        const { body } = await runDeindexCron();

        expect(body.submitted).toBe(cap);
        expect(body.budgetDeferred).toBe(4);

        const updates = queueUpdates();

        // Exactly the rows Google was asked about may carry status 'submitted'.
        expect(updates.filter((data) => data.status === 'submitted')).toHaveLength(cap);

        const deferred = updates.filter((data) => !('status' in data));
        expect(deferred).toHaveLength(4);
        for (const data of deferred) {
            expect('attempt' in data).toBe(false);
            expect(String(data.lastError)).toContain('IndexNow accepted');
        }
    });

    it('does not retire a row Google REJECTED just because IndexNow accepted it', async () => {
        // The likeliest first armed run: the Indexing API answers 403 until the
        // service account is a verified owner of the property in Search
        // Console, and creating the key is not enough to make that true. If an
        // IndexNow acceptance could retire the row, the backlog would drain
        // against that 403 at the lane's per run cap, reporting green, with
        // Google never having accepted a single removal. IndexNow reaches Bing
        // and Yandex; it cannot remove anything from Google, which is the
        // entire point of this queue.
        armGoogle();
        process.env.INDEXNOW_KEY = 'e'.repeat(32);
        vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(queueRows(3) as never);
        mockNetwork({ headStatus: 410, googleStatus: 403, indexNowStatus: 200 });

        const { body } = await runDeindexCron();

        expect(body.submitted).toBe(0);
        expect(body.submitFailed).toBe(3);

        const updates = queueUpdates();
        expect(updates.filter((data) => data.status === 'submitted')).toHaveLength(0);
        for (const data of updates) {
            // Held for another attempt rather than retired, with the Google
            // error kept where an operator can read it.
            expect(data.status).toBe('pending');
            expect(data.attempt).toBe(1);
            expect(String(data.lastError)).not.toBe('IndexNow rejected');
        }
    });

    it('leaves the backlog completely alone while the Google key is absent', async () => {
        // The pre-credential window is the whole reason this release exists.
        // Reaching the queue at all here would burn the oldest rows three
        // times a day, with Google never asked, and the queue filters on
        // status 'pending', so those rows would never be offered again once
        // the owner finally armed the cron.
        vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(queueRows(50) as never);
        const fetchMock = mockNetwork({ headStatus: 404, indexNowStatus: 200 });
        process.env.INDEXNOW_KEY = 'e'.repeat(32);

        const { body } = await runDeindexCron();

        expect(body.processed).toBe(0);
        expect(prisma.deindexQueue.findMany).not.toHaveBeenCalled();
        expect(prisma.deindexQueue.update).not.toHaveBeenCalled();
        expect(prisma.deindexQueue.updateMany).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('declares its lane so a 25,000 row backlog cannot starve live removals', () => {
        const src = read('app/api/cron/historical-deindex/route.ts');
        expect(src).toContain("pingAllSearchEnginesBatchDeleted(goneUrls, 'backlog-removal')");
        // The old shape classified everything non 2xx/3xx as dead.
        expect(src).toContain('GONE_STATUSES');
        expect(src).not.toMatch(/4xx or 5xx/);
        // A budget refusal is not the only way Google goes unasked, and
        // testing only for it is what retired rows in the unarmed window.
        expect(src).toContain('googleWasNotAsked(googleResult)');
        expect(src).not.toContain('isGoogleBudgetRefusal');
    });
});

// ─── 2. The shared daily Google budget ──────────────────────────────────────

describe('the Google Indexing API daily budget cannot be exceeded', () => {
    const lanes = Object.entries(GOOGLE_INDEXING_LANES) as Array<
        [GoogleIndexingLane, (typeof GOOGLE_INDEXING_LANES)[GoogleIndexingLane]]
    >;

    it('reserves no more than the quota across every lane, with headroom to spare', () => {
        // The headroom is what absorbs the unscheduled publishes (an employer
        // post, a manual script run). Reallocating a lane may move quota
        // between lanes; it may not eat into this.
        const reserved = lanes.reduce((sum, [, lane]) => sum + lane.dailyReservation, 0);
        expect(GOOGLE_DAILY_HEADROOM).toBeGreaterThan(0);
        expect(reserved + GOOGLE_DAILY_HEADROOM).toBeLessThanOrEqual(GOOGLE_DAILY_PUBLISH_QUOTA);
    });

    it('keeps each lane scheduled spend inside its own reservation', () => {
        for (const [name, lane] of lanes) {
            expect(
                lane.perInvocation * lane.scheduledInvocationsPerDay,
                `lane "${name}" schedules more publishes than it reserves`,
            ).toBeLessThanOrEqual(lane.dailyReservation);
        }
    });

    it('holds no quota for a caller the scope rule refuses', () => {
        // The 'programmatic' lane existed for index-pseo's category x city
        // landings. Those carry no JobPosting, so nothing in policy could
        // spend it, and a reservation nobody can spend is quota taken from
        // the lanes that are starved.
        expect(Object.keys(GOOGLE_INDEXING_LANES).sort()).toEqual([
            'backlog-removal',
            'expired-job-removal',
            'new-content',
            'unreserved',
        ]);
        for (const [name, lane] of lanes) {
            expect(lane.callers, `lane "${name}" still names index-pseo`).not.toContain('index-pseo');
        }
    });

    it('grants the backlog lane no more per run than historical-deindex can find', () => {
        // The retired lane's quota went to backlog-removal. A per run grant
        // wider than the cron's HEAD batch could never be spent, so the two
        // numbers have to move together.
        const batch = Number(
            read('app/api/cron/historical-deindex/route.ts').match(/const BATCH_SIZE = (\d+);/)?.[1],
        );
        expect(batch).toBeGreaterThan(0);
        expect(GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation).toBeLessThanOrEqual(batch);
    });

    it('spends nothing for a caller that declares the unreserved lane', async () => {
        armGoogle();
        const fetchMock = mockNetwork({ headStatus: 404 });
        expect(GOOGLE_INDEXING_LANES.unreserved.dailyReservation).toBe(0);

        // lib/ingestion-service.ts runs 60 batches a day over URLs that
        // index-urls and deindex-expired already publish out of real lanes.
        // Naming this lane keeps its IndexNow coverage without paying twice.
        const { google } = await pingAllSearchEnginesBatchDeleted([jobUrl('anything')], 'unreserved');

        expect(google).toHaveLength(1);
        expect(isGoogleBudgetRefusal(google[0])).toBe(true);
        expect(google[0].error).toContain(GOOGLE_BUDGET_REFUSED);
        expect(touchedGoogle(fetchMock)).toBe(false);
    });

    it('takes the lane as a required argument on both batch helpers and on pingGoogle', () => {
        // A default is the failure this pins. Generous enough for the three
        // cron firings a day and the 60 ingest batches spend it all; small
        // enough for the ingest path and it is zero, which silently kills
        // expired-job-removal, the only channel that can drop a dead job URL
        // out of Google. Requiring the argument turns that into a type error.
        const src = read('lib/search-indexing.ts');
        expect(src).toContain('lane: GoogleIndexingLane,');
        expect(src).not.toMatch(/lane: GoogleIndexingLane = '/);
    });

    it('has no batch caller left that relies on a default lane, beyond the known handoffs', () => {
        // Single-identifier calls are calls with no lane. The list below is the
        // handoff set this package filed and cannot edit itself; a NEW name
        // appearing here means someone added a caller that spends nothing.
        const KNOWN_HANDOFFS = [
            'app/api/cron/deindex-expired/route.ts',
            'app/api/cron/index-urls/route.ts',
            'lib/ingestion-service.ts',
            'scripts/google-index.ts',
        ];
        const callPattern = /pingAllSearchEnginesBatch(?:Deleted)?\(\s*[A-Za-z_$][\w$]*\s*\)/;

        const offenders = sourceFiles(['app', 'lib', 'scripts']).filter(
            (rel) => rel !== 'lib/search-indexing.ts' && callPattern.test(read(rel)),
        );

        expect(offenders.filter((f) => !KNOWN_HANDOFFS.includes(f))).toEqual([]);
    });

    it('has no direct pingGoogle caller left without a lane', () => {
        // tsconfig excludes scripts/, so a script can still call pingGoogle
        // with one or two arguments and only find out at run time. The last
        // two such callers were scripts: scripts/google-index.ts now names
        // the new-content lane and filters to job pages first, and
        // scripts/deindex-auth-pages.ts has no Google leg at all, since auth
        // pages carry no job posting markup. So nothing is excused any more.

        /** Calls whose top level argument list has fewer than three entries. */
        const callsWithoutLane = (src: string): number => {
            let count = 0;
            const opener = /\bpingGoogle\(/g;
            // exec advances opener.lastIndex to just past the '(' each time.
            while (opener.exec(src) !== null) {
                let depth = 1;
                let commas = 0;
                for (let i = opener.lastIndex; i < src.length && depth > 0; i++) {
                    const ch = src[i];
                    if (ch === '(' || ch === '[' || ch === '{') depth++;
                    else if (ch === ')' || ch === ']' || ch === '}') depth--;
                    else if (ch === ',' && depth === 1) commas++;
                }
                if (commas < 2) count++;
            }
            return count;
        };

        const offenders = sourceFiles(['app', 'lib', 'scripts']).filter(
            (rel) => rel !== 'lib/search-indexing.ts' && callsWithoutLane(read(rel)) > 0,
        );

        expect(offenders).toEqual([]);
    });

    it('throws by name when a caller declares no lane at all', async () => {
        // pingGoogle used to default to 'programmatic' so index-pseo could
        // spend without declaring a lane. That caller and that lane are gone,
        // and a silent zero would print in a script's summary as "Google took
        // nothing", which reads like a quota problem rather than a missing
        // argument. So an omitted lane fails as loudly as a mistyped one.
        await expect(
            pingGoogle(jobUrl('open-role'), 'URL_UPDATED', undefined as never),
        ).rejects.toThrow(/No Google indexing lane was declared/);
    });

    it('stops granting publishes once a lane hits its per-invocation cap', async () => {
        // No credential is armed here on purpose: the cap has to be the
        // outermost numeric check, so the arithmetic reads the same whether
        // or not the project happens to be configured.
        const cap = GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation;
        const attempts = cap + 10;

        const results = [];
        for (let i = 0; i < attempts; i++) {
            results.push(await pingGoogle(jobUrl('gone', i), 'URL_DELETED', 'backlog-removal'));
        }

        expect(results.filter((r) => !isGoogleBudgetRefusal(r))).toHaveLength(cap);
        expect(results.filter(isGoogleBudgetRefusal)).toHaveLength(10);
    });

    it('does not let a caller reset its cap by calling the batch helper again', async () => {
        armGoogle();
        mockNetwork({ headStatus: 404 });
        const lane: GoogleIndexingLane = 'expired-job-removal';
        const cap = GOOGLE_INDEXING_LANES[lane].perInvocation;
        const urls = Array.from({ length: cap }, (_, i) => jobUrl('expired', i));

        const first = await pingAllSearchEnginesBatchDeleted(urls, lane);
        const second = await pingAllSearchEnginesBatchDeleted(urls, lane);

        expect(first.google.every((r) => r.success)).toBe(true);
        expect(second.google.every(isGoogleBudgetRefusal)).toBe(true);
    });

    it('returns a result for every URL, including the ones it refused', async () => {
        armGoogle();
        mockNetwork({ headStatus: 404 });
        const cap = GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation;
        const urls = Array.from({ length: cap + 3 }, (_, i) => jobUrl('gone', i));

        const { google } = await pingAllSearchEnginesBatchDeleted(urls, 'backlog-removal');

        // Dropping the overflow silently would leave a caller unable to tell
        // "Google said no" from "we never asked Google".
        expect(google).toHaveLength(urls.length);
        expect(google.filter(isGoogleBudgetRefusal)).toHaveLength(3);
    });

    it('fails by name on a lane that does not exist', async () => {
        // tsconfig excludes scripts/, so a one off script can pass a lane name
        // no compiler ever checked. A loud named throw is the failure mode we
        // want: granting zero would print as "Google 0 of N" in the script's
        // own summary and read like a quota problem rather than a typo. The
        // retired lane is the likeliest stale name, so it is checked by name.
        await expect(
            pingGoogle(jobUrl('gone'), 'URL_DELETED', 'backlog_removal' as never),
        ).rejects.toThrow(/Unknown Google indexing lane/);
        await expect(
            pingGoogle(jobUrl('gone'), 'URL_DELETED', 'programmatic' as never),
        ).rejects.toThrow(/Unknown Google indexing lane "programmatic"/);
    });

    it('orders the lanes so removals of live expired jobs outrank the backlog', () => {
        expect(GOOGLE_INDEXING_LANES['expired-job-removal'].priority).toBeLessThan(
            GOOGLE_INDEXING_LANES['backlog-removal'].priority,
        );
        expect(GOOGLE_INDEXING_LANES['new-content'].priority).toBeLessThan(
            GOOGLE_INDEXING_LANES['backlog-removal'].priority,
        );
        expect(GOOGLE_INDEXING_LANES.unreserved.priority).toBe(
            Math.max(...lanes.map(([, lane]) => lane.priority)),
        );
    });
});

// ─── 3. "Google said no" is never confused with "we never asked" ────────────

describe('a publish that never became a request reports itself as such', () => {
    it('reports an absent credential as not configured, not as a rejection', async () => {
        const result = await pingGoogle(jobUrl('gone'), 'URL_DELETED', 'backlog-removal');

        expect(result.success).toBe(false);
        expect(result.error).toBe(GOOGLE_NOT_CONFIGURED);
        expect(isGoogleBudgetRefusal(result)).toBe(false);
        expect(googleWasNotAsked(result)).toBe(true);
    });

    it('counts a budget refusal as not asked as well', async () => {
        const result = await pingGoogle(jobUrl('gone'), 'URL_DELETED', 'unreserved');

        expect(googleWasNotAsked(result)).toBe(true);
    });

    it('does not excuse a key that fails to exchange, which is a real fault', async () => {
        // A credential that will not produce a token has to reach the retry
        // path so the attempt counter eventually surfaces it. Treating it as
        // "never asked" would defer the same rows forever in silence.
        armGoogle();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            if (String(input).includes('oauth2.googleapis.com')) {
                return new Response('invalid_grant', { status: 400 });
            }
            return new Response(null, { status: 200 });
        });

        const result = await pingGoogle(jobUrl('gone'), 'URL_DELETED', 'backlog-removal');

        expect(result.error).toBe(GOOGLE_TOKEN_EXCHANGE_FAILED);
        expect(googleWasNotAsked(result)).toBe(false);
    });

    it('does not count a genuine Google rejection as not asked', () => {
        expect(
            googleWasNotAsked({
                engine: 'Google',
                url: jobUrl('gone'),
                success: false,
                error: 'Permission denied. Failed to verify the URL ownership.',
            }),
        ).toBe(false);
    });
});

// ─── 4. Google only ever sees pages that carry JobPosting ───────────────────

describe('the Google Indexing API only ever sees job posting pages', () => {
    const OUT_OF_SCOPE = [
        `${brand.baseUrl}/blog/choosing-your-first-role`,
        `${brand.baseUrl}/jobs/remote`,
        `${brand.baseUrl}/jobs/remote/city/large-city-tx`,
        `${brand.baseUrl}/jobs/state/texas`,
        `${brand.baseUrl}/companies/acme-health`,
        `${brand.baseUrl}/signup`,
        `${brand.baseUrl}/jobs`,
        `${brand.baseUrl}/`,
        // A job UUID with a further segment is not the detail page.
        `${brand.baseUrl}/jobs/nurse-practitioner-${jobUuid(1)}/apply`,
        'not a url at all',
    ];

    it('admits the job detail page and nothing else', () => {
        expect(isGoogleIndexingEligibleUrl(jobUrl('family-nurse-practitioner', 7))).toBe(true);
        for (const url of OUT_OF_SCOPE) {
            expect(isGoogleIndexingEligibleUrl(url), url).toBe(false);
        }
    });

    it('refuses every landing directory under app/jobs, including ones added later', () => {
        // Read from disk so a new landing is covered the day it is created.
        const landings = fs
            .readdirSync(path.join(ROOT, 'app/jobs'), { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !/^[[(_]/.test(entry.name))
            .map((entry) => entry.name);
        expect(landings.length).toBeGreaterThan(10);

        for (const name of landings) {
            expect(isGoogleIndexingEligibleUrl(`${brand.baseUrl}/jobs/${name}`), name).toBe(false);
            expect(
                isGoogleIndexingEligibleUrl(`${brand.baseUrl}/jobs/${name}/city/large-city-tx`),
                `${name} city landing`,
            ).toBe(false);
        }
    });

    it('admits exactly the slugs the job page itself resolves', () => {
        // The scope rule is a copy of the detail page's resolver. If the page
        // ever resolves jobs differently, this is where the two disagree.
        const src = read('app/jobs/[slug]/page.tsx');
        const resolvers = [...src.matchAll(/slug\.match\(\/(.+?)\/([a-z]*)\)/g)].map(
            ([, body, flags]) => new RegExp(body, flags),
        );
        expect(resolvers.length).toBeGreaterThan(0);

        const uuid = jobUuid(42);
        const samples = [
            slugify('Nurse Practitioner (Telehealth) / Remote, Part Time', uuid),
            slugify(`Family Nurse Practitioner ${'Primary Care '.repeat(20)}`, uuid),
            slugify('', uuid),
            uuid,
            `nurse-practitioner-${uuid.toUpperCase()}`,
            `nurse-practitioner-${uuid.slice(0, -1)}`,
            'nurse-practitioner-12345',
            'remote',
            'family-practice',
        ];
        for (const slug of samples) {
            const pageResolves = resolvers.every((re) => re.test(slug));
            expect(isGoogleIndexingEligibleUrl(`${brand.baseUrl}/jobs/${slug}`), slug).toBe(pageResolves);
        }
    });

    it('renders JobPosting markup from exactly one page, the one the rule admits', () => {
        // If another page type starts carrying JobPosting, the scope rule in
        // lib/search-indexing.ts has to learn its URL shape in the same change.
        const files = sourceFiles(['app', 'components', 'lib']);
        const importers = files.filter((rel) =>
            /from ['"]@\/components\/JobStructuredData['"]/.test(read(rel)),
        );
        const emitters = files.filter((rel) =>
            /['"]@type['"]\s*:\s*['"]JobPosting['"]/.test(read(rel)),
        );
        expect(importers).toEqual(['app/jobs/[slug]/page.tsx']);
        expect(emitters).toEqual(['components/JobStructuredData.tsx']);
    });

    it('refuses every other page type before any network, whatever the lane', async () => {
        armGoogle();
        const fetchMock = mockNetwork({ headStatus: 200 });

        for (const url of OUT_OF_SCOPE) {
            for (const lane of ['expired-job-removal', 'new-content', 'backlog-removal'] as const) {
                for (const type of ['URL_UPDATED', 'URL_DELETED'] as const) {
                    const result = await pingGoogle(url, type, lane);
                    expect(result.error, url).toBe(GOOGLE_POLICY_REFUSED);
                    expect(isGooglePolicyRefusal(result)).toBe(true);
                }
            }
        }

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a scope refusal as final rather than as a deferral', async () => {
        // googleWasNotAsked means "try again later". A scope refusal never
        // clears up, and historical-deindex reads its oldest rows first, so
        // reporting one as a deferral would hold that row pending forever and
        // a handful of them would block the queue for good.
        const result = await pingGoogle(`${brand.baseUrl}/jobs/remote`, 'URL_DELETED', 'backlog-removal');

        expect(isGooglePolicyRefusal(result)).toBe(true);
        expect(isGoogleBudgetRefusal(result)).toBe(false);
        expect(googleWasNotAsked(result)).toBe(false);
    });

    it('does not let an out of scope URL use up any of a lane', async () => {
        const lane: GoogleIndexingLane = 'backlog-removal';
        const cap = GOOGLE_INDEXING_LANES[lane].perInvocation;

        for (let i = 0; i < cap + 5; i++) {
            await pingGoogle(`${brand.baseUrl}/jobs/remote/city/town-${i}`, 'URL_DELETED', lane);
        }
        const jobs = [];
        for (let i = 0; i < cap; i++) {
            jobs.push(await pingGoogle(jobUrl('gone', i), 'URL_DELETED', lane));
        }

        expect(jobs.filter(isGoogleBudgetRefusal)).toHaveLength(0);
        expect(jobs.every((r) => r.error === GOOGLE_NOT_CONFIGURED)).toBe(true);
    });

    it('sends a blog post to Bing and IndexNow but never to Google', async () => {
        // app/api/blog pings every engine through pingAllSearchEngines when a
        // post goes live. The post keeps its Bing and IndexNow coverage.
        armGoogle();
        armBingAndIndexNow();
        const fetchMock = mockNetwork({ headStatus: 200, indexNowStatus: 200 });

        const results = await pingAllSearchEngines(`${brand.baseUrl}/blog/choosing-your-first-role`);

        expect(touchedGoogle(fetchMock)).toBe(false);
        const called = fetchMock.mock.calls.map((call) => String(call[0]));
        expect(called.some((url) => url.includes('ssl.bing.com'))).toBe(true);
        expect(called.some((url) => url.includes('indexnow'))).toBe(true);
        expect(results.find((r) => r.engine === 'Google')?.error).toBe(GOOGLE_POLICY_REFUSED);
    });

    it('still publishes a new job page through the single URL helper', async () => {
        armGoogle();
        armBingAndIndexNow();
        const fetchMock = mockNetwork({ headStatus: 200, indexNowStatus: 200 });
        const url = jobUrl('new-role', 3);

        const results = await pingAllSearchEngines(url);

        expect(googlePublishedUrls(fetchMock)).toEqual([url]);
        expect(results.find((r) => r.engine === 'Google')?.success).toBe(true);
    });

    it('publishes only the job pages out of a mixed batch, and gives Bing and IndexNow all of it', async () => {
        armGoogle();
        armBingAndIndexNow();
        const fetchMock = mockNetwork({ headStatus: 200, indexNowStatus: 200 });
        const jobs = [jobUrl('new-role', 1), jobUrl('new-role', 2)];
        const others = [`${brand.baseUrl}/jobs/telehealth`, `${brand.baseUrl}/blog/a-post`];

        const { google, bing, indexNow } = await pingAllSearchEnginesBatch([...others, ...jobs], 'new-content');

        expect(googlePublishedUrls(fetchMock)).toEqual(jobs);
        expect(google.filter(isGooglePolicyRefusal).map((r) => r.url)).toEqual(others);
        expect(bing).toHaveLength(4);
        expect(bing.every((r) => r.success)).toBe(true);
        expect(indexNow).toHaveLength(4);
        expect(indexNow.every((r) => r.success)).toBe(true);
    });

    it('lets historical-deindex retire an out of scope row at once instead of holding it', async () => {
        // The queue was seeded from Search Console exports of every URL type,
        // so it holds landings and posts as well as jobs. Those rows must
        // neither reach Google nor sit pending at the head of an oldest first
        // queue. Google's refusal is permanent, so the cron retires them all
        // in one updateMany before any network: spending three runs, three
        // HEAD requests and three attempts on each would change nothing.
        armGoogle();
        const cap = GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation;
        const outOfScope: QueueRow[] = [
            { id: 'old-landing', url: `${brand.baseUrl}/jobs/remote/city/old-town-xx`, attempt: 0 },
            { id: 'old-post', url: `${brand.baseUrl}/blog/retired-post`, attempt: 2 },
        ];
        vi.mocked(prisma.deindexQueue.findMany).mockResolvedValue(
            [...outOfScope, ...queueRows(cap)] as never,
        );
        const fetchMock = mockNetwork({ headStatus: 404 });

        const { body } = await runDeindexCron();

        // Every job row still got the lane's full grant, and the out of scope
        // rows are reported as their own count, not as Google failures.
        expect(body.submitted).toBe(cap);
        expect(body.budgetDeferred).toBe(0);
        expect(body.submitFailed).toBe(0);
        expect(body.outOfScope).toBe(2);
        expect(body.processed).toBe(cap + 2);

        // No request of any kind went out for them, HEAD checks included.
        const requested = fetchMock.mock.calls.map((call) => String(call[0]));
        const published = googlePublishedUrls(fetchMock);
        for (const row of outOfScope) {
            expect(requested).not.toContain(row.url);
            expect(published).not.toContain(row.url);
        }

        // One updateMany retires them together, with the reason kept and the
        // attempt counter left alone, because nothing was attempted.
        expect(prisma.deindexQueue.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.deindexQueue.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['old-landing', 'old-post'] } },
            data: { status: 'failed', lastError: GOOGLE_POLICY_REFUSED },
        });

        // And no per-row update touches them afterwards.
        const updatedIds = queueUpdateCalls().map((call) => call.id);
        for (const row of outOfScope) expect(updatedIds).not.toContain(row.id);
        expect(updatedIds).toHaveLength(cap);
    });

    it('keeps the hand-run scripts inside the scope rule', () => {
        // tsconfig excludes scripts/, so no compiler checks these two, and
        // each one used to send pages Google refuses.
        const bulk = read('scripts/google-index.ts');
        expect(bulk).toContain('urls.filter(isGoogleIndexingEligibleUrl)');
        expect(bulk).toContain("pingGoogle(capped[i], 'URL_UPDATED', 'new-content')");
        expect(bulk).toContain("GOOGLE_INDEXING_LANES['new-content'].perInvocation");
        expect(bulk).not.toMatch(/slice\(0, 200\)/);
        expect(bulk).not.toContain('/blog/');
        expect(bulk).toContain('const BASE_URL = brand.baseUrl;');
        expect(bulk).not.toContain('pmhnphiring.com');

        // Auth pages carry no job posting markup, so this one keeps only its
        // IndexNow leg and sends the operator to the Removals tool for Google.
        const auth = read('scripts/deindex-auth-pages.ts');
        expect(auth).not.toMatch(/\bpingGoogle\b/);
        expect(auth).toContain('pingIndexNow(AUTH_URLS)');
        expect(auth).toContain('Removals');
        expect(auth).toContain('const BASE = brand.baseUrl;');
        expect(auth).not.toContain("'https://pmhnphiring.com'");
    });
});

// ─── 5. index-pseo submits its landings to Bing and IndexNow only ───────────

describe('index-pseo never publishes to Google', () => {
    const ROUTE = 'app/api/cron/index-pseo/route.ts';
    const PSEO_BASE = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;
    const LANDING_ROWS = [
        { categorySlug: 'remote', locationSlug: 'large-city-tx', totalJobs: 12, distinctEmployers: 5 },
        { categorySlug: 'telehealth', locationSlug: 'mid-city-oh', totalJobs: 6, distinctEmployers: 3 },
        // Fails the sitemap gate: a single employer.
        { categorySlug: 'travel', locationSlug: 'large-city-tx', totalJobs: 9, distinctEmployers: 1 },
        // Fails the population floor.
        { categorySlug: 'remote', locationSlug: 'hamlet-vt', totalJobs: 9, distinctEmployers: 4 },
    ];
    // Highest score first: 24 for the jobs plus 20 for the city beats 12 plus 15.
    const EXPECTED_URLS = [
        `${PSEO_BASE}/jobs/remote/city/large-city-tx`,
        `${PSEO_BASE}/jobs/telehealth/city/mid-city-oh`,
    ];

    async function runIndexPseoCron(): Promise<{ status: number; body: Record<string, unknown> }> {
        const { GET } = await import('@/app/api/cron/index-pseo/route');
        const res = await GET(
            new Request('https://example.com/api/cron/index-pseo', {
                headers: { authorization: 'Bearer test' },
            }) as never,
        );
        return { status: res.status, body: await res.json() };
    }

    function stageLandings(recentlySubmitted: Array<{ categorySlug: string; locationSlug: string }> = []): void {
        vi.mocked(prisma.$queryRaw).mockResolvedValue(LANDING_ROWS as never);
        vi.mocked(prisma.pseoStats.findMany).mockResolvedValue(recentlySubmitted as never);
        vi.mocked(prisma.pseoStats.upsert).mockResolvedValue({} as never);
    }

    /** The urlList of the one Bing batch this run sent. */
    const bingUrlList = (fetchMock: FetchMock): string[] => {
        const calls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('ssl.bing.com'));
        expect(calls).toHaveLength(1);
        return JSON.parse(String((calls[0][1] as RequestInit).body)).urlList;
    };

    it('has no Google call left in its source', () => {
        const src = read(ROUTE);
        expect(src).not.toMatch(/\bpingGoogle\b/);
        // pingAllSearchEngines and both batch helpers carry a Google leg.
        expect(src).not.toMatch(/\bpingAllSearchEngines/);
        expect(src).not.toContain('googleapis.com');
        const imported = src.match(/import \{([^}]*)\} from '@\/lib\/search-indexing'/)?.[1] ?? '';
        expect(
            imported
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean)
                .sort(),
        ).toEqual(['pingBingBatch', 'pingIndexNow']);
    });

    it('sends its landings to Bing and IndexNow only, even with the Google key armed', async () => {
        armGoogle();
        armBingAndIndexNow();
        stageLandings();
        const fetchMock = mockNetwork({ headStatus: 200, indexNowStatus: 200 });

        const { status, body } = await runIndexPseoCron();

        expect(status).toBe(200);
        expect(touchedGoogle(fetchMock)).toBe(false);
        expect(bingUrlList(fetchMock)).toEqual(EXPECTED_URLS);
        const indexNowCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('indexnow'));
        expect(JSON.parse(String((indexNowCall?.[1] as RequestInit).body)).urlList).toEqual(EXPECTED_URLS);

        // The response and the stored run metrics stop reporting Google.
        expect(body).not.toHaveProperty('google');
        expect(body.bing).toEqual({ submitted: 2, failed: 0 });
        expect(body.indexNow).toEqual({ submitted: 2, failed: 0 });
        expect(body.recorded).toBe(2);
        const metrics = vi.mocked(prisma.cronRun.update).mock.calls.map(
            (call) => (call[0] as { data: { metrics?: Record<string, unknown> } }).data.metrics ?? {},
        );
        expect(metrics).toHaveLength(1);
        expect(Object.keys(metrics[0]).filter((key) => /google/i.test(key))).toEqual([]);
    });

    it('does not bench a landing no engine accepted', async () => {
        // With neither key set nothing is sent, so nothing may be recorded as
        // submitted: the landing has to be offered again on the next run
        // rather than sit out a week for a submission that never happened.
        stageLandings();
        const fetchMock = mockNetwork({ headStatus: 200 });

        const { body } = await runIndexPseoCron();

        expect(body.submitted).toBe(2);
        expect(body.recorded).toBe(0);
        expect(prisma.pseoStats.upsert).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still skips a landing it offered inside the last seven days', async () => {
        armBingAndIndexNow();
        stageLandings([{ categorySlug: 'remote', locationSlug: 'large-city-tx' }]);
        const fetchMock = mockNetwork({ headStatus: 200, indexNowStatus: 200 });

        const { body } = await runIndexPseoCron();

        expect(bingUrlList(fetchMock)).toEqual([EXPECTED_URLS[1]]);
        expect(body.recorded).toBe(1);

        const where = (vi.mocked(prisma.pseoStats.findMany).mock.calls[0][0] as {
            where: { type: string; updatedAt: { gte: Date } };
        }).where;
        expect(where.type).toBe('index-submitted');
        const windowDays = (Date.now() - where.updatedAt.gte.getTime()) / 86_400_000;
        expect(windowDays).toBeGreaterThan(6.9);
        expect(windowDays).toBeLessThan(7.1);
    });
});

// ─── 6. One IndexNow key, resolved the same way by every reader ─────────────

describe('the IndexNow key resolves under either env name, everywhere', () => {
    const KEY = 'b'.repeat(32);

    it('resolves the key file path from INDEXNOW_API_KEY alone', () => {
        expect(resolveIndexNowKey({ INDEXNOW_API_KEY: KEY })).toBe(KEY);
        expect(matchIndexNowKeyPath(`/${KEY}.txt`, { INDEXNOW_API_KEY: KEY })).toBe(KEY);
    });

    it('resolves the key file path from INDEXNOW_KEY alone', () => {
        expect(resolveIndexNowKey({ INDEXNOW_KEY: KEY })).toBe(KEY);
        expect(matchIndexNowKeyPath(`/${KEY}.txt`, { INDEXNOW_KEY: KEY })).toBe(KEY);
    });

    it('prefers INDEXNOW_KEY when both are set, so the served file and the submitted key agree', () => {
        const other = 'c'.repeat(32);
        expect(resolveIndexNowKey({ INDEXNOW_KEY: KEY, INDEXNOW_API_KEY: other })).toBe(KEY);
    });

    it('submits with INDEXNOW_API_KEY alone', async () => {
        process.env.INDEXNOW_API_KEY = KEY;
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('', { status: 200 }));

        const result = await pingIndexNow([`${brand.baseUrl}/jobs/example-role`]);

        expect(result.ok).toBe(true);
        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.key).toBe(KEY);
        expect(body.keyLocation).toContain(`${KEY}.txt`);
    });

    it('keeps the manual resubmit script on the shared client', () => {
        const src = read('scripts/gsc-resubmit.ts');
        // It used to carry a private client that read INDEXNOW_KEY only and
        // hardcoded the donor board's host, so the one tool an owner reaches
        // for after configuring credentials skipped its IndexNow half.
        expect(src).toContain("import('../lib/indexnow')");
        expect(src).not.toContain('api.indexnow.org');
        expect(src).not.toContain('process.env.INDEXNOW_KEY');
        expect(src).not.toContain('pmhnphiring.com');
    });

    it('leaves lib/indexnow.ts as the only module that talks to the endpoint', () => {
        const hits: string[] = [];
        for (const dir of ['lib', 'scripts', 'app']) {
            const stack = [path.join(ROOT, dir)];
            while (stack.length > 0) {
                const current = stack.pop() as string;
                for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                    const full = path.join(current, entry.name);
                    if (entry.isDirectory()) stack.push(full);
                    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
                        if (fs.readFileSync(full, 'utf8').includes('api.indexnow.org')) {
                            hits.push(path.relative(ROOT, full).replace(/\\/g, '/'));
                        }
                    }
                }
            }
        }
        expect(hits).toEqual(['lib/indexnow.ts']);
    });
});

// ─── 7. Ops surfaces stop describing a pipeline that no longer exists ───────

describe('the ops surfaces describe the pipeline as it actually is', () => {
    it('.env.example points at the live key-file owner, not the removed route', () => {
        const src = read('.env.example');
        expect(src).not.toContain('app/[indexnow]/route.ts');
        expect(src).toContain('lib/indexnow-key-file.ts');
        // Setting both names was advice for a drift that no longer exists.
        expect(src).not.toContain('Set BOTH to the same value');
    });

    it('.env.example warns that the Google key arms the removal cron', () => {
        const src = read('.env.example');
        expect(src).toMatch(/ARMS A DESTRUCTIVE CRON/);
        expect(src).toContain('historical-deindex');
    });

    it('promises on both ops surfaces that the unarmed cron leaves the queue alone', () => {
        // The claim and the guard have to move together. "Inert" was written
        // here once while the cron still HEAD-checked and retired 50 rows a
        // run, and an operator who believes it will not expect a queue that
        // has already been eaten by the time they paste the key in.
        for (const file of ['.env.example', 'scripts/fork-preflight.ts']) {
            expect(read(file), `${file} must not overstate what the unarmed cron does`).toContain(
                'returns before it reads',
            );
        }
        expect(read('app/api/cron/historical-deindex/route.ts')).toContain(
            "if (!process.env.GOOGLE_INDEXING_CREDENTIALS) {",
        );
    });

    it('fork-preflight stops blaming the GSC keys for the historical-deindex cron', () => {
        const src = read('scripts/fork-preflight.ts');
        expect(src).not.toMatch(/gsc-health-check and historical-deindex crons silently no-op/);
        expect(src).toContain('checkGoogleIndexingCredentials');
        expect(src).toMatch(/GOOGLE_INDEXING_CREDENTIALS is SET/);
    });

    it('fork-preflight no longer claims the two IndexNow names read different modules', () => {
        const src = read('scripts/fork-preflight.ts');
        expect(src).not.toMatch(/lib\/search-indexing\.ts reads INDEXNOW_API_KEY/);
    });
});

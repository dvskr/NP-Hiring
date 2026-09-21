/**
 * Search indexing safety.
 *
 * Four failures that are all invisible today, because every key in the
 * indexing pipeline is empty, and all four become live and expensive the
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
    },
}));
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({
    verifyCronOrAdmin: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/discord-notifier', () => ({
    sendCronFailureAlert: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import {
    GOOGLE_BUDGET_REFUSED,
    GOOGLE_DAILY_PUBLISH_QUOTA,
    GOOGLE_INDEXING_LANES,
    GOOGLE_NOT_CONFIGURED,
    GOOGLE_TOKEN_EXCHANGE_FAILED,
    googleWasNotAsked,
    isGoogleBudgetRefusal,
    pingAllSearchEnginesBatchDeleted,
    pingGoogle,
    resetGoogleIndexingBudget,
    type GoogleIndexingLane,
} from '@/lib/search-indexing';
import { pingIndexNow } from '@/lib/indexnow';
import { matchIndexNowKeyPath, resolveIndexNowKey } from '@/lib/indexnow-key-file';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

interface NetworkOptions {
    /** What every HEAD check on one of our own URLs answers with. */
    headStatus: number;
    /** What the Indexing API answers. Default 200, an accepted publish. */
    googleStatus?: number;
    /** What IndexNow answers. Default 503, so only Google can retire a row. */
    indexNowStatus?: number;
}

/**
 * One mock for the whole network. Routing by URL keeps the three endpoints
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
        return new Response(null, { status: opts.headStatus });
    });

// ─── 1. Only a proven-gone status may trigger a removal ─────────────────────

interface QueueRow {
    id: string;
    url: string;
    attempt: number;
}

const queueRows = (count: number, attempt = 0): QueueRow[] =>
    Array.from({ length: count }, (_, i) => ({
        id: `row-${i}`,
        url: `${brand.baseUrl}/jobs/legacy-posting-${i}`,
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

/** The data payload of every prisma.deindexQueue.update this run made. */
const queueUpdates = (): Record<string, unknown>[] =>
    vi
        .mocked(prisma.deindexQueue.update)
        .mock.calls.map((call) => (call[0] as { data: Record<string, unknown> }).data);

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
        // the URL at all. With a batch of 50 against a lane granting 15 that
        // is most of the backlog, reported to the admin page as submitted.
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

    it('reserves no more than the whole quota across every lane', () => {
        const reserved = lanes.reduce((sum, [, lane]) => sum + lane.dailyReservation, 0);
        expect(reserved).toBeLessThanOrEqual(GOOGLE_DAILY_PUBLISH_QUOTA);
    });

    it('keeps each lane scheduled spend inside its own reservation', () => {
        for (const [name, lane] of lanes) {
            expect(
                lane.perInvocation * lane.scheduledInvocationsPerDay,
                `lane "${name}" schedules more publishes than it reserves`,
            ).toBeLessThanOrEqual(lane.dailyReservation);
        }
    });

    it('spends nothing for a caller that declares the unreserved lane', async () => {
        armGoogle();
        const fetchMock = mockNetwork({ headStatus: 404 });
        expect(GOOGLE_INDEXING_LANES.unreserved.dailyReservation).toBe(0);

        // lib/ingestion-service.ts runs 60 batches a day over URLs that
        // index-urls and deindex-expired already publish out of real lanes.
        // Naming this lane keeps its IndexNow coverage without paying twice.
        const { google } = await pingAllSearchEnginesBatchDeleted(
            [`${brand.baseUrl}/jobs/anything`],
            'unreserved',
        );

        expect(google).toHaveLength(1);
        expect(isGoogleBudgetRefusal(google[0])).toBe(true);
        expect(google[0].error).toContain(GOOGLE_BUDGET_REFUSED);
        for (const call of fetchMock.mock.calls) {
            expect(String(call[0])).not.toContain('googleapis.com');
        }
    });

    it('takes the lane as a required argument on both batch helpers', () => {
        // A default is the failure this pins. Generous enough for the three
        // cron firings a day and the 60 ingest batches spend it all; small
        // enough for the ingest path and it is zero, which silently kills
        // expired-job-removal, the only channel that can drop a dead job URL
        // out of Google. Requiring the argument turns that into a type error.
        const src = read('lib/search-indexing.ts');
        expect(src).toContain('lane: GoogleIndexingLane,');
        expect(src).not.toMatch(/lane: GoogleIndexingLane = 'unreserved'/);
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

        const offenders = new Set<string>();
        for (const dir of ['app', 'lib', 'scripts']) {
            const stack = [path.join(ROOT, dir)];
            while (stack.length > 0) {
                const current = stack.pop() as string;
                for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                    const full = path.join(current, entry.name);
                    if (entry.isDirectory()) {
                        stack.push(full);
                    } else if (/\.tsx?$/.test(entry.name)) {
                        const rel = path.relative(ROOT, full).replace(/\\/g, '/');
                        if (rel === 'lib/search-indexing.ts') continue;
                        if (callPattern.test(fs.readFileSync(full, 'utf8'))) offenders.add(rel);
                    }
                }
            }
        }

        expect([...offenders].filter((f) => !KNOWN_HANDOFFS.includes(f))).toEqual([]);
    });

    it('gives a bare pingGoogle the smallest real lane, so index-pseo is not starved to zero', async () => {
        // app/api/cron/index-pseo is off limits to this package, so the
        // default lane on pingGoogle is the only share it can get.
        const cap = GOOGLE_INDEXING_LANES.programmatic.perInvocation;
        expect(cap).toBeGreaterThan(0);

        const results = [];
        for (let i = 0; i < cap + 2; i++) {
            results.push(await pingGoogle(`${brand.baseUrl}/jobs/city-page-${i}`));
        }

        expect(results.filter((r) => !isGoogleBudgetRefusal(r))).toHaveLength(cap);
        expect(
            GOOGLE_INDEXING_LANES.programmatic.priority,
            'the pingGoogle default must stay the LOWEST real lane',
        ).toBe(Math.max(...lanes.filter(([name]) => name !== 'unreserved').map(([, l]) => l.priority)));
    });

    it('stops granting publishes once a lane hits its per-invocation cap', async () => {
        // No credential is armed here on purpose: the cap has to be the
        // outermost check, so the arithmetic reads the same whether or not the
        // project happens to be configured.
        const cap = GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation;
        const attempts = cap + 10;

        const results = [];
        for (let i = 0; i < attempts; i++) {
            results.push(
                await pingGoogle(`${brand.baseUrl}/jobs/gone-${i}`, 'URL_DELETED', 'backlog-removal'),
            );
        }

        expect(results.filter((r) => !isGoogleBudgetRefusal(r))).toHaveLength(cap);
        expect(results.filter(isGoogleBudgetRefusal)).toHaveLength(10);
    });

    it('does not let a caller reset its cap by calling the batch helper again', async () => {
        armGoogle();
        mockNetwork({ headStatus: 404 });
        const lane: GoogleIndexingLane = 'expired-job-removal';
        const cap = GOOGLE_INDEXING_LANES[lane].perInvocation;
        const urls = Array.from({ length: cap }, (_, i) => `${brand.baseUrl}/jobs/expired-${i}`);

        const first = await pingAllSearchEnginesBatchDeleted(urls, lane);
        const second = await pingAllSearchEnginesBatchDeleted(urls, lane);

        expect(first.google.every((r) => r.success)).toBe(true);
        expect(second.google.every(isGoogleBudgetRefusal)).toBe(true);
    });

    it('returns a result for every URL, including the ones it refused', async () => {
        armGoogle();
        mockNetwork({ headStatus: 404 });
        const cap = GOOGLE_INDEXING_LANES['backlog-removal'].perInvocation;
        const urls = Array.from({ length: cap + 3 }, (_, i) => `${brand.baseUrl}/jobs/gone-${i}`);

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
        // own summary and read like a quota problem rather than a typo.
        await expect(
            pingGoogle(`${brand.baseUrl}/jobs/gone`, 'URL_DELETED', 'backlog_removal' as never),
        ).rejects.toThrow(/Unknown Google indexing lane/);
    });

    it('treats an omitted lane as programmatic rather than as an error', async () => {
        // scripts/google-index.ts still calls the batch helper with one
        // argument, which is the handoff this package filed and cannot edit.
        // Until that lands, the parameter default is what keeps it working,
        // so the two behaviours have to be pinned together: a missing lane is
        // the smallest real share, a wrong lane is a throw.
        const result = await pingGoogle(
            `${brand.baseUrl}/jobs/gone`,
            'URL_DELETED',
            undefined as never,
        );

        expect(result.error).toBe(GOOGLE_NOT_CONFIGURED);
    });

    it('orders the lanes so removals of live expired jobs outrank the backlog', () => {
        expect(GOOGLE_INDEXING_LANES['expired-job-removal'].priority).toBeLessThan(
            GOOGLE_INDEXING_LANES['backlog-removal'].priority,
        );
        expect(GOOGLE_INDEXING_LANES['new-content'].priority).toBeLessThan(
            GOOGLE_INDEXING_LANES.programmatic.priority,
        );
        expect(GOOGLE_INDEXING_LANES.unreserved.priority).toBe(
            Math.max(...lanes.map(([, lane]) => lane.priority)),
        );
    });
});

// ─── 3. "Google said no" is never confused with "we never asked" ────────────

describe('a publish that never became a request reports itself as such', () => {
    it('reports an absent credential as not configured, not as a rejection', async () => {
        const result = await pingGoogle(`${brand.baseUrl}/jobs/gone`, 'URL_DELETED', 'backlog-removal');

        expect(result.success).toBe(false);
        expect(result.error).toBe(GOOGLE_NOT_CONFIGURED);
        expect(isGoogleBudgetRefusal(result)).toBe(false);
        expect(googleWasNotAsked(result)).toBe(true);
    });

    it('counts a budget refusal as not asked as well', async () => {
        const result = await pingGoogle(`${brand.baseUrl}/jobs/gone`, 'URL_DELETED', 'unreserved');

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

        const result = await pingGoogle(`${brand.baseUrl}/jobs/gone`, 'URL_DELETED', 'backlog-removal');

        expect(result.error).toBe(GOOGLE_TOKEN_EXCHANGE_FAILED);
        expect(googleWasNotAsked(result)).toBe(false);
    });

    it('does not count a genuine Google rejection as not asked', () => {
        expect(
            googleWasNotAsked({
                engine: 'Google',
                url: `${brand.baseUrl}/jobs/gone`,
                success: false,
                error: 'Permission denied. Failed to verify the URL ownership.',
            }),
        ).toBe(false);
    });
});

// ─── 4. One IndexNow key, resolved the same way by every reader ─────────────

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

// ─── 5. Ops surfaces stop describing a pipeline that no longer exists ───────

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

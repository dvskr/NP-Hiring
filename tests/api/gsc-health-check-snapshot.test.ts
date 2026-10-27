/**
 * The daily Search Console snapshot is written only from data Search Console
 * returned (register 2.30).
 *
 * gsc_snapshots held all zeros from at least 2026-10-15. Why, from the code:
 *   - Its named coverage columns (indexedTotal, notIndexedTotal and the rest)
 *     are never written by anything. Search Console has no API for page
 *     indexing coverage (decision B40), so every row keeps their default 0, and
 *     an alert on falling indexed counts could never fire.
 *   - The "today" figure is yesterday's Search Analytics total, which Search
 *     Console has not processed when the cron runs at 09:30 UTC (its data lags
 *     about two days), so the API answers no row and the snapshot showed 0
 *     clicks and 0 impressions. A day it answers no row for was then compared
 *     with a day it did as if traffic had dropped to zero.
 *   - The credentials and the property are not it: a wrong key or property
 *     fails the run (OAuth error or 403) instead of writing a row.
 * Now a run that read nothing (no Search Analytics row for either day, no
 * query or page rows, no sitemaps) writes no row, logs once, and alerts once
 * per such streak; a run that read anything still writes it, and the drop
 * alerts compare only two days Search Console answered for.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, type MockInstance } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        gscSnapshot: { upsert: vi.fn() },
        cronRun: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    },
}));
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({ verifyCronOrAdmin: vi.fn() }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn(), sendCronFailureAlert: vi.fn() }));
const gsc = vi.hoisted(() => ({
    getGscConfig: vi.fn(),
    getGscAccessToken: vi.fn(),
    fetchSearchAnalyticsAggregate: vi.fn(),
    fetchSearchAnalyticsByDimension: vi.fn(),
    fetchSitemapsList: vi.fn(),
}));
vi.mock('@/lib/gsc-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/gsc-client')>()),
    ...gsc,
}));

import { prisma } from '@/lib/prisma';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendDiscordMessage, sendCronFailureAlert } from '@/lib/discord-notifier';
import type { GscDimensionRow, GscSitemapEntry, SearchAnalyticsAggregate } from '@/lib/gsc-client';

/** The 09:30 UTC firing on 2026-10-27: "today" is 2026-10-26, a week ago 2026-10-20. */
const NOW = new Date('2026-10-27T09:30:00.000Z');
const YESTERDAY = '2026-10-26';
const WEEK_AGO = '2026-10-20';

const day = (clicks: number, impressions: number): SearchAnalyticsAggregate => ({ clicks, impressions, ctr: clicks / impressions, position: 18.4 });
const queryRow: GscDimensionRow = { key: 'nurse practitioner jobs texas', clicks: 2, impressions: 140, ctr: 0.014, position: 21 };
const sitemap: GscSitemapEntry = {
    path: 'https://nphiring.com/api/sitemaps/index',
    lastSubmitted: '2026-10-01T10:00:00.000Z',
    lastDownloaded: '2026-10-26T04:00:00.000Z',
    isPending: false,
    isSitemapsIndex: true,
    errors: 0,
    warnings: 0,
    submittedUrls: 994,
};

interface Reads {
    today?: SearchAnalyticsAggregate | null;
    weekAgo?: SearchAnalyticsAggregate | null;
    queries?: GscDimensionRow[] | Error;
    sitemaps?: GscSitemapEntry[] | Error;
}

/** What Search Console answers this run. The defaults are a run that read nothing. */
function searchConsoleAnswers({ today = null, weekAgo = null, queries = [], sitemaps = [] }: Reads = {}): void {
    gsc.fetchSearchAnalyticsAggregate.mockImplementation(async (_token: string, _site: string, startDate: string) =>
        (startDate === YESTERDAY ? today : startDate === WEEK_AGO ? weekAgo : null));
    gsc.fetchSearchAnalyticsByDimension.mockImplementation(async (_token: string, _site: string, opts: { dimension: string }) => {
        if (queries instanceof Error) throw queries;
        return opts.dimension === 'query' ? queries : [];
    });
    gsc.fetchSitemapsList.mockImplementation(async () => {
        if (sitemaps instanceof Error) throw sitemaps;
        return sitemaps;
    });
}

async function runCron(): Promise<{ status: number; body: Record<string, unknown> }> {
    const { GET } = await import('@/app/api/cron/gsc-health-check/route');
    const res = await GET(new NextRequest('https://test.local/api/cron/gsc-health-check', { headers: { authorization: 'Bearer test' } }));
    return { status: res.status, body: await res.json() };
}

/** The metrics withCronTracking stored for this run. */
function storedMetrics(): Record<string, unknown> {
    const call = vi.mocked(prisma.cronRun.update).mock.calls.at(-1);
    return (call?.[0] as { data: { metrics?: Record<string, unknown> } }).data.metrics ?? {};
}

const discordTitles = (): string[] =>
    vi.mocked(sendDiscordMessage).mock.calls.flatMap((call) => (call[1] ?? []).map((embed) => String(embed.title)));

let warn: MockInstance<typeof console.warn>;

beforeAll(async () => {
    await import('@/app/api/cron/gsc-health-check/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.mocked(verifyCronOrAdmin).mockResolvedValue(null);
    vi.mocked(sendDiscordMessage).mockResolvedValue(true as never);
    vi.mocked(prisma.cronRun.create).mockResolvedValue({ id: 'run-today' } as never);
    vi.mocked(prisma.cronRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.cronRun.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.gscSnapshot.upsert).mockResolvedValue({} as never);
    gsc.getGscConfig.mockReturnValue({ keyJson: '{}', siteUrl: 'sc-domain:nphiring.com' });
    gsc.getGscAccessToken.mockResolvedValue('token');
    searchConsoleAnswers();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('a run that read nothing writes no snapshot', () => {
    it('skips the write, says why, logs once and alerts once', async () => {
        const { status, body } = await runCron();

        expect(status).toBe(200);
        expect(prisma.gscSnapshot.upsert).not.toHaveBeenCalled();
        expect(body).toMatchObject({ success: true, skipped: true, reason: 'no data', capturedOn: YESTERDAY, alertSent: true });
        expect(String(body.message)).toContain(YESTERDAY);
        expect(String(body.message)).toContain(WEEK_AGO);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain(`no snapshot was written for ${YESTERDAY}`);
        expect(discordTitles()).toEqual(['GSC Health Check: no data, snapshot not written']);
        expect(storedMetrics()).toMatchObject({ snapshotSkipped: true, reason: 'no data', capturedOn: YESTERDAY, alertSent: true, streakAlerted: true });
        // The streak check reads this cron's newest successful run.
        expect(prisma.cronRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { name: 'gsc-health-check', success: true },
            orderBy: { startedAt: 'desc' },
        }));
    });

    it('does not alert again while the streak lasts, and still logs', async () => {
        vi.mocked(prisma.cronRun.findFirst).mockResolvedValue({ metrics: { snapshotSkipped: true, reason: 'no data', alertSent: false, streakAlerted: true } } as never);

        const { body } = await runCron();

        expect(body).toMatchObject({ skipped: true, alertSent: false });
        expect(prisma.gscSnapshot.upsert).not.toHaveBeenCalled();
        expect(sendDiscordMessage).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        // The streak stays alerted, so the run after this one stays quiet too.
        expect(storedMetrics()).toMatchObject({ snapshotSkipped: true, alertSent: false, streakAlerted: true });
    });

    it('tries again when the streak\'s alert was never delivered', async () => {
        vi.mocked(prisma.cronRun.findFirst).mockResolvedValue({ metrics: { snapshotSkipped: true, reason: 'no data', alertSent: false, streakAlerted: false } } as never);
        vi.mocked(sendDiscordMessage).mockResolvedValue(false as never);

        const { body } = await runCron();

        expect(sendDiscordMessage).toHaveBeenCalledTimes(1);
        expect(body).toMatchObject({ skipped: true, alertSent: false });
        expect(storedMetrics()).toMatchObject({ alertSent: false, streakAlerted: false });
    });

    it('alerts again once data had come back in between', async () => {
        vi.mocked(prisma.cronRun.findFirst).mockResolvedValue({ metrics: { todayClicks: 3, sitemapCount: 1 } } as never);

        const { body } = await runCron();

        expect(body).toMatchObject({ skipped: true, alertSent: true });
        expect(sendDiscordMessage).toHaveBeenCalledTimes(1);
    });

    it('alerts when the streak check itself cannot be read, rather than stay silent', async () => {
        vi.mocked(prisma.cronRun.findFirst).mockRejectedValue(new Error('connection reset'));

        const { status, body } = await runCron();

        expect(status).toBe(200);
        expect(body).toMatchObject({ skipped: true, alertSent: true });
        expect(sendDiscordMessage).toHaveBeenCalledTimes(1);
    });

    it('reports the failed dimension and sitemap reads with the skip', async () => {
        searchConsoleAnswers({ queries: new Error('Search Analytics query: 500 backend error'), sitemaps: new Error('Sitemaps list: 503') });

        const { body } = await runCron();

        expect(prisma.gscSnapshot.upsert).not.toHaveBeenCalled();
        expect(body).toMatchObject({
            skipped: true,
            dimensionError: 'Search Analytics query: 500 backend error',
            sitemapError: 'Sitemaps list: 503',
        });
        expect(storedMetrics()).toMatchObject({ dimensionError: 'Search Analytics query: 500 backend error', sitemapError: 'Sitemaps list: 503' });
        // The one alert says what failed, too.
        const description = String(vi.mocked(sendDiscordMessage).mock.calls[0][1]?.[0]?.description);
        expect(description).toContain('Search Analytics query: 500 backend error');
        expect(description).toContain('Sitemaps list: 503');
    });

    it('still skips without a key, as before', async () => {
        gsc.getGscConfig.mockReturnValue(null);

        const { body } = await runCron();

        expect(body).toMatchObject({ success: true, skipped: true, reason: 'no service account key configured' });
        expect(gsc.getGscAccessToken).not.toHaveBeenCalled();
        expect(prisma.gscSnapshot.upsert).not.toHaveBeenCalled();
    });
});

describe('a run that read something writes it', () => {
    it('writes both days of Search Analytics', async () => {
        searchConsoleAnswers({ today: day(4, 300), weekAgo: day(3, 280) });

        const { body } = await runCron();

        expect(body).toMatchObject({ success: true, today: { clicks: 4, impressions: 300 }, weekAgo: { clicks: 3, impressions: 280 } });
        expect(body).not.toHaveProperty('skipped');
        expect(prisma.gscSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { capturedOn: new Date(YESTERDAY) },
            create: { capturedOn: new Date(YESTERDAY), raw: expect.objectContaining({ searchAnalytics: { today: day(4, 300), weekAgo: day(3, 280) } }) },
        }));
        expect(warn).not.toHaveBeenCalled();
    });

    it('writes the sitemaps alone when Search Analytics answered nothing, and reports the days as not read', async () => {
        searchConsoleAnswers({ sitemaps: [sitemap] });

        const { body } = await runCron();

        const raw = vi.mocked(prisma.gscSnapshot.upsert).mock.calls[0][0].create.raw as Record<string, unknown>;
        expect(raw).toMatchObject({ searchAnalytics: { today: null, weekAgo: null }, sitemaps: [sitemap] });
        expect(body).toMatchObject({ today: null, weekAgo: null });
        expect(storedMetrics()).toMatchObject({ todayRead: false, weekAgoRead: false, sitemapCount: 1 });
        expect(discordTitles()).toEqual([]);
    });

    it('writes the query rows alone when nothing else answered', async () => {
        searchConsoleAnswers({ queries: [queryRow] });

        await runCron();

        const raw = vi.mocked(prisma.gscSnapshot.upsert).mock.calls[0][0].create.raw as { dimensions?: { queries: { current: unknown[] } } };
        expect(raw.dimensions?.queries.current).toEqual([queryRow]);
    });
});

describe('the drop alerts compare only days Search Console answered for', () => {
    it('a day not processed yet is not a drop to zero', async () => {
        searchConsoleAnswers({ today: null, weekAgo: day(5, 400), sitemaps: [sitemap] });

        const { body } = await runCron();

        expect(prisma.gscSnapshot.upsert).toHaveBeenCalledTimes(1);
        expect(body.alerts).toEqual([]);
        expect(discordTitles()).toEqual([]);
    });

    it('a day with no week ago row to compare with is written, with no alert', async () => {
        searchConsoleAnswers({ today: day(4, 300), weekAgo: null });

        const { body } = await runCron();

        expect(prisma.gscSnapshot.upsert).toHaveBeenCalledTimes(1);
        expect(body).toMatchObject({ today: { clicks: 4, impressions: 300 }, weekAgo: null, alerts: [] });
        expect(storedMetrics()).toMatchObject({ todayRead: true, weekAgoRead: false });
        expect(discordTitles()).toEqual([]);
    });

    it('a real drop between two answered days still alerts', async () => {
        searchConsoleAnswers({ today: day(2, 100), weekAgo: day(10, 400) });

        const { body } = await runCron();

        expect(body.alerts).toEqual([
            '📉 GSC clicks dropped -80.0% week-over-week (10 → 2)',
            '📉 GSC impressions dropped -75.0% week-over-week (400 → 100)',
        ]);
        expect(discordTitles()).toHaveLength(1);
        expect(sendCronFailureAlert).not.toHaveBeenCalled();
    });
});

/**
 * The daily index-urls cron counts a Bing Webmaster submission that was never
 * made as skipped, not failed (register 2.30).
 *
 * BING_WEBMASTER_API_KEY is optional and unset in production (IndexNow
 * already reaches Bing, PENDING_WORK 1.5), so every run reported all of its
 * Bing submissions as failed. A result lib/search-indexing.ts marks skipped
 * now has its own count, in the response (bing.skipped) and in the run's
 * cron_runs metrics (bingSkipped). A Bing answer that is not OK is still a
 * failure, and the Google and IndexNow counts are unchanged.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        job: { findMany: vi.fn() },
        cronRun: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    },
}));
vi.mock('@/lib/auth/verify-cron-or-admin', () => ({ verifyCronOrAdmin: vi.fn() }));
vi.mock('@/lib/discord-notifier', () => ({ sendCronFailureAlert: vi.fn() }));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEnginesBatch: vi.fn() }));

import { prisma } from '@/lib/prisma';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { pingAllSearchEnginesBatch } from '@/lib/search-indexing';

const JOBS = [1, 2, 3].map((i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    title: `Family Nurse Practitioner ${i}`,
    slug: `family-nurse-practitioner-${i}-00000000-0000-4000-8000-00000000000${i}`,
    employer: 'Riverbend Health',
    description: 'Outpatient primary care role. You will evaluate new patients, manage medications and work closely with therapists and primary care teams.',
    location: 'Austin, TX',
    mode: 'In-Person',
    isRemote: false,
    isHybrid: false,
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    country: 'US',
}));

type Result = { engine: string; url: string; success: boolean; skipped?: boolean; error?: string };

function engineAnswers(bing: (url: string) => Result): void {
    vi.mocked(pingAllSearchEnginesBatch).mockImplementation((async (urls: string[]) => ({
        google: urls.map((url) => ({ engine: 'Google', url, success: true })),
        bing: urls.map(bing),
        indexNow: urls.map((url, i) => ({ engine: 'IndexNow', url, success: i > 0, ...(i > 0 ? {} : { error: 'IndexNow rejected the batch (403)' }) })),
    })) as never);
}

async function runCron(): Promise<Record<string, unknown>> {
    const { GET } = await import('@/app/api/cron/index-urls/route');
    const res = await GET(new Request('https://example.com/api/cron/index-urls', { headers: { authorization: 'Bearer test' } }) as never);
    expect(res.status).toBe(200);
    return res.json();
}

function storedMetrics(): Record<string, unknown> {
    const call = vi.mocked(prisma.cronRun.update).mock.calls.at(-1);
    return (call?.[0] as { data: { metrics?: Record<string, unknown> } }).data.metrics ?? {};
}

beforeAll(async () => {
    await import('@/app/api/cron/index-urls/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyCronOrAdmin).mockResolvedValue(null);
    vi.mocked(prisma.job.findMany).mockResolvedValue(JOBS as never);
    vi.mocked(prisma.cronRun.create).mockResolvedValue({ id: 'run-1' } as never);
    vi.mocked(prisma.cronRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.cronRun.findFirst).mockResolvedValue(null as never);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('index-urls reports Bing skips apart from failures', () => {
    it('no Bing key: every submission skipped, none failed', async () => {
        engineAnswers((url) => ({ engine: 'Bing', url, success: false, skipped: true, error: 'BING_WEBMASTER_API_KEY not set' }));

        const body = await runCron();

        expect(body.bing).toEqual({ submitted: 0, failed: 0, skipped: 3 });
        expect(storedMetrics()).toMatchObject({ bingSubmitted: 0, bingFailed: 0, bingSkipped: 3 });
    });

    it('a Bing answer that is not OK is still a failure', async () => {
        engineAnswers((url) => ({ engine: 'Bing', url, success: false, error: 'quota exceeded' }));

        const body = await runCron();

        expect(body.bing).toEqual({ submitted: 0, failed: 3, skipped: 0 });
        expect(storedMetrics()).toMatchObject({ bingFailed: 3, bingSkipped: 0 });
    });

    it('accepted submissions are counted as before, and Google and IndexNow are unchanged', async () => {
        engineAnswers((url) => ({ engine: 'Bing', url, success: true }));

        const body = await runCron();

        expect(body.bing).toEqual({ submitted: 3, failed: 0, skipped: 0 });
        expect(body.google).toEqual({ submitted: 3, failed: 0 });
        expect(body.indexNow).toEqual({ submitted: 2, failed: 1 });
        expect(storedMetrics()).toMatchObject({ googleSubmitted: 3, googleFailed: 0, indexNowSubmitted: 2, indexNowFailed: 1, bingSubmitted: 3 });
    });
});

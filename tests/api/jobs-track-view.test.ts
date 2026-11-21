/**
 * POST /api/jobs/[id]/track-view (2026-11-21): the job page's view count,
 * posted from the visitor's browser now that the page render (cached for a
 * day) no longer writes it. Counts live listings for real browsers only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: { job: { updateMany: vi.fn() }, jobViewEvent: { create: vi.fn() } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { telemetry: { limit: 60, windowSeconds: 60 } },
}));

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function req(userAgent: string | null = BROWSER): Request {
  const headers: Record<string, string> = userAgent ? { 'user-agent': userAgent } : {};
  return new Request('https://example.com/api/jobs/job-1/track-view', { method: 'POST', headers });
}
const params = () => Promise.resolve({ id: 'job-1' });

beforeEach(() => vi.clearAllMocks());

describe('POST /api/jobs/[id]/track-view', () => {
  it('counts a browser view of a live listing, job id only', async () => {
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.jobViewEvent.create).mockResolvedValue({} as never);
    const { POST } = await import('@/app/api/jobs/[id]/track-view/route');
    const res = await POST(req() as never, { params: params() } as never);
    expect(await res.json()).toEqual({ success: true, counted: true });
    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'job-1', isPublished: true }),
        data: { viewCount: { increment: 1 } },
      }),
    );
    expect(prisma.jobViewEvent.create).toHaveBeenCalledWith({ data: { jobId: 'job-1' } });
  });

  it('ignores crawlers and requests without a user agent', async () => {
    const { POST } = await import('@/app/api/jobs/[id]/track-view/route');
    for (const ua of ['Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)', null]) {
      const res = await POST(req(ua) as never, { params: params() } as never);
      expect(await res.json()).toEqual({ success: true, counted: false });
    }
    expect(prisma.job.updateMany).not.toHaveBeenCalled();
    expect(prisma.jobViewEvent.create).not.toHaveBeenCalled();
  });

  it('records no event for a job that is not a live listing', async () => {
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 0 } as never);
    const { POST } = await import('@/app/api/jobs/[id]/track-view/route');
    const res = await POST(req() as never, { params: params() } as never);
    expect(await res.json()).toEqual({ success: false, reason: 'job_not_found' });
    expect(prisma.jobViewEvent.create).not.toHaveBeenCalled();
  });

  it('reports a failed write in the body without throwing', async () => {
    vi.mocked(prisma.job.updateMany).mockRejectedValue(new Error('timeout exceeded when trying to connect'));
    const { POST } = await import('@/app/api/jobs/[id]/track-view/route');
    const res = await POST(req() as never, { params: params() } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: false, reason: 'persist_failed' });
  });
});

describe('isBotUserAgent', () => {
  it('passes real browsers (every one starts with "Mozilla/5.0") and catches Moz by name', async () => {
    const { isBotUserAgent } = await import('@/lib/bot-user-agent');
    expect(isBotUserAgent(BROWSER)).toBe(false);
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)')).toBe(true);
    expect(isBotUserAgent('rogerbot/1.2 (https://moz.com/help/guides/moz-procedures/what-is-rogerbot)')).toBe(true);
  });
});

/**
 * Regression (audit H3) — POST /api/jobs/report had no per-reporter dedup and
 * counted ALL report rows toward AUTO_UNPUBLISH_THRESHOLD (3). One logged-in
 * account could file the same job 3× and auto-unpublish any competitor's job.
 *
 * The fix de-dups per (jobId, reporterEmail) and measures the threshold in
 * DISTINCT reporters. These tests lock that in.
 *
 * Also: the job id in the body must be a plain string. It is the lookup key of
 * job.findUnique and the where of the report queries after it, and a JSON
 * body can carry an object there (an unvalidated value reached Prisma and
 * answered 500). The route answers 400 before any query (lib/request-body.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: getUserMock } }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    job: { findUnique: vi.fn(), update: vi.fn() },
    userProfile: { findUnique: vi.fn() },
    jobReport: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: { feedback: { limit: 5, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function req(body: Record<string, unknown>): Request {
  return new Request('https://example.com/api/jobs/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: 'sb-rep', email: 'reporter@example.com' } } });
  vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ firstName: 'R', lastName: 'X', email: 'reporter@example.com' } as never);
});

describe('POST /api/jobs/report — abuse-resistant threshold', () => {
  it('a repeat report from the same reporter does not create a duplicate row', async () => {
    vi.mocked(prisma.job.findUnique).mockResolvedValue({ id: 'job1', title: 'T', employer: 'E', isPublished: true } as never);
    vi.mocked(prisma.jobReport.findFirst).mockResolvedValue({ id: 'existing' } as never); // already reported
    vi.mocked(prisma.jobReport.findMany).mockResolvedValue([{ reporterEmail: 'reporter@example.com' }] as never);

    const { POST } = await import('@/app/api/jobs/report/route');
    const res = await POST(req({ jobId: 'job1', reason: 'scam' }) as never);

    expect(res.status).toBe(200);
    expect(prisma.jobReport.create).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.alreadyReported).toBe(true);
  });

  it('does NOT auto-unpublish when one reporter accounts for all reports (1 distinct)', async () => {
    vi.mocked(prisma.job.findUnique).mockResolvedValue({ id: 'job1', title: 'T', employer: 'E', isPublished: true } as never);
    vi.mocked(prisma.jobReport.findFirst).mockResolvedValue({ id: 'existing' } as never);
    vi.mocked(prisma.jobReport.findMany).mockResolvedValue([{ reporterEmail: 'reporter@example.com' }] as never);

    const { POST } = await import('@/app/api/jobs/report/route');
    const res = await POST(req({ jobId: 'job1', reason: 'scam' }) as never);

    const json = await res.json();
    expect(json.autoUnpublished).toBe(false);
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it('auto-unpublishes only at 3 DISTINCT reporters', async () => {
    vi.mocked(prisma.job.findUnique).mockResolvedValue({ id: 'job1', title: 'T', employer: 'E', isPublished: true } as never);
    vi.mocked(prisma.jobReport.findFirst).mockResolvedValue(null as never); // new reporter
    vi.mocked(prisma.jobReport.create).mockResolvedValue({ id: 'r3' } as never);
    vi.mocked(prisma.jobReport.findMany).mockResolvedValue([
      { reporterEmail: 'a@x.com' }, { reporterEmail: 'b@x.com' }, { reporterEmail: 'reporter@example.com' },
    ] as never);

    const { POST } = await import('@/app/api/jobs/report/route');
    const res = await POST(req({ jobId: 'job1', reason: 'scam' }) as never);

    const json = await res.json();
    expect(json.totalReports).toBe(3);
    expect(json.autoUnpublished).toBe(true);
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'job1' }, data: { isPublished: false } }),
    );
  });
});

let nextReporterIp = 0;

/**
 * A report request from a fresh IP. The route keeps a module-level count of
 * 5 reports per hour per IP, and this file's other requests share one.
 */
function reportFromNewIp(body: string): Request {
  nextReporterIp += 1;
  return new Request('https://example.com/api/jobs/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${nextReporterIp}` },
    body,
  });
}

const BAD_JOB_IDS: Array<[string, unknown]> = [
  ['a not filter', { not: '' }],
  ['a startsWith filter', { startsWith: 'job' }],
  ['an array', ['job1']],
  ['a number', 12345],
  ['a boolean', true],
  ['null', null],
  ['no value', undefined],
  ['an empty string', ''],
  ['an overlong string', 'a'.repeat(201)],
];

describe('POST /api/jobs/report: the job id is a plain string', () => {
  it.each(BAD_JOB_IDS)('refuses %s as the job id with 400 and no query', async (_label, jobId) => {
    const { POST } = await import('@/app/api/jobs/report/route');
    const res = await POST(reportFromNewIp(JSON.stringify({ jobId, reason: 'scam' })) as never);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'jobId and reason are required' });
    expect(prisma.job.findUnique).not.toHaveBeenCalled();
    expect(prisma.jobReport.findFirst).not.toHaveBeenCalled();
    expect(prisma.jobReport.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a null body', 'null'],
    ['an array body', JSON.stringify([{ jobId: 'job1', reason: 'scam' }])],
    ['a string body', '"job1"'],
  ])('refuses %s with 400 and no query', async (_label, body) => {
    const { POST } = await import('@/app/api/jobs/report/route');
    const res = await POST(reportFromNewIp(body) as never);

    expect(res.status).toBe(400);
    expect(prisma.job.findUnique).not.toHaveBeenCalled();
    expect(prisma.jobReport.create).not.toHaveBeenCalled();
  });

  it('still refuses a reason that is not one of the listed reasons', async () => {
    const { POST } = await import('@/app/api/jobs/report/route');
    const res = await POST(reportFromNewIp(JSON.stringify({ jobId: 'job1', reason: { not: '' } })) as never);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^Invalid reason/);
    expect(prisma.job.findUnique).not.toHaveBeenCalled();
  });

  it('still looks a string job id up by equality', async () => {
    vi.mocked(prisma.job.findUnique).mockResolvedValue(null as never);

    const { POST } = await import('@/app/api/jobs/report/route');
    const res = await POST(reportFromNewIp(JSON.stringify({ jobId: 'job1', reason: 'scam' })) as never);

    expect(res.status).toBe(404);
    expect(prisma.job.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job1' } }));
  });
});

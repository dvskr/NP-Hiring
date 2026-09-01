/**
 * SiteStat wiring — the homepage now reads cached counters from the SiteStat
 * singleton (refreshed by the refresh-site-stats cron) instead of running a
 * COUNT + distinct-employer query on every render. These tests lock in:
 *  - reads use the cached row when present (no live aggregate),
 *  - reads fall back to a live compute when the row is empty,
 *  - refresh computes + upserts the singleton row,
 *  - counts run through the canonical predicates (live review 2026-08-17
 *    item #4: totalJobs = canonicalActiveJobWhere, totalCompanies =
 *    canonicalEmployerWhere — no bare isPublished, no distinct-employer
 *    string counting),
 *  - getSiteStatsOrNull returns null (omit-not-fabricate) when the DB is
 *    down, instead of the FALLBACK constants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { canonicalActiveJobWhere, canonicalEmployerWhere } from '@/lib/canonical-counts';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    siteStat: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    job: { count: vi.fn() },
    company: { count: vi.fn() },
    emailLead: { count: vi.fn() },
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('getSiteStats', () => {
  it('returns the cached SiteStat row without running aggregates', async () => {
    vi.mocked(prisma.siteStat.findFirst).mockResolvedValue({ id: 's1', totalJobs: 1234, totalCompanies: 88, totalSubscribers: 4200 } as never);
    const { getSiteStats } = await import('@/lib/site-stats');
    const stats = await getSiteStats();
    expect(stats).toEqual({ totalJobs: 1234, totalCompanies: 88, totalSubscribers: 4200 });
    expect(prisma.job.count).not.toHaveBeenCalled();
    expect(prisma.company.count).not.toHaveBeenCalled();
  });

  it('falls back to a live compute when no snapshot exists yet', async () => {
    vi.mocked(prisma.siteStat.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.job.count).mockResolvedValue(500 as never);
    vi.mocked(prisma.company.count).mockResolvedValue(72 as never);
    vi.mocked(prisma.emailLead.count).mockResolvedValue(99 as never);
    const { getSiteStats } = await import('@/lib/site-stats');
    const stats = await getSiteStats();
    expect(stats).toEqual({ totalJobs: 500, totalCompanies: 72, totalSubscribers: 99 });
  });

  it('returns safe defaults if the DB throws', async () => {
    vi.mocked(prisma.siteStat.findFirst).mockRejectedValue(new Error('db down'));
    const { getSiteStats } = await import('@/lib/site-stats');
    const stats = await getSiteStats();
    expect(stats.totalJobs).toBeGreaterThan(0);
  });
});

describe('getSiteStatsOrNull', () => {
  it('returns the cached row when present', async () => {
    vi.mocked(prisma.siteStat.findFirst).mockResolvedValue({ id: 's1', totalJobs: 900, totalCompanies: 105, totalSubscribers: 30 } as never);
    const { getSiteStatsOrNull } = await import('@/lib/site-stats');
    expect(await getSiteStatsOrNull()).toEqual({ totalJobs: 900, totalCompanies: 105, totalSubscribers: 30 });
  });

  it('returns null — never the FALLBACK constants — when the DB throws', async () => {
    vi.mocked(prisma.siteStat.findFirst).mockRejectedValue(new Error('db down'));
    const { getSiteStatsOrNull } = await import('@/lib/site-stats');
    expect(await getSiteStatsOrNull()).toBeNull();
  });
});

describe('computeSiteStats — canonical predicates', () => {
  it('counts jobs with canonicalActiveJobWhere and companies with canonicalEmployerWhere', async () => {
    vi.mocked(prisma.job.count).mockResolvedValue(10 as never);
    vi.mocked(prisma.company.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.emailLead.count).mockResolvedValue(1 as never);
    const { computeSiteStats } = await import('@/lib/site-stats');
    await computeSiteStats();

    const jobWhere = vi.mocked(prisma.job.count).mock.calls[0][0]?.where;
    const companyWhere = vi.mocked(prisma.company.count).mock.calls[0][0]?.where;
    // Shape parity with the canonical builders (dates differ by ms, so
    // compare structure keys rather than deep-equality on the whole object).
    expect(Object.keys(jobWhere ?? {}).sort()).toEqual(
      Object.keys(canonicalActiveJobWhere()).sort(),
    );
    expect(jobWhere).toHaveProperty('isPublished', true);
    expect(jobWhere).toHaveProperty('AND');
    // No top-level OR: the expiry gate lives inside AND so composition can
    // never clobber it (the /about OR-clobber bug).
    expect(jobWhere).not.toHaveProperty('OR');
    expect(Object.keys(companyWhere ?? {})).toEqual(Object.keys(canonicalEmployerWhere()));
    expect(companyWhere).toHaveProperty('jobs.some.isPublished', true);
  });
});

describe('refreshSiteStats', () => {
  beforeEach(() => {
    vi.mocked(prisma.job.count).mockResolvedValue(777 as never);
    vi.mocked(prisma.company.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.emailLead.count).mockResolvedValue(150 as never);
  });

  it('creates the singleton row when none exists', async () => {
    vi.mocked(prisma.siteStat.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.siteStat.create).mockResolvedValue({} as never);
    const { refreshSiteStats } = await import('@/lib/site-stats');
    const stats = await refreshSiteStats();
    expect(stats).toEqual({ totalJobs: 777, totalCompanies: 3, totalSubscribers: 150 });
    expect(prisma.siteStat.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { totalJobs: 777, totalCompanies: 3, totalSubscribers: 150 } }),
    );
    expect(prisma.siteStat.update).not.toHaveBeenCalled();
  });

  it('updates the existing singleton row', async () => {
    vi.mocked(prisma.siteStat.findFirst).mockResolvedValue({ id: 'existing' } as never);
    vi.mocked(prisma.siteStat.update).mockResolvedValue({} as never);
    const { refreshSiteStats } = await import('@/lib/site-stats');
    await refreshSiteStats();
    expect(prisma.siteStat.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing' }, data: { totalJobs: 777, totalCompanies: 3, totalSubscribers: 150 } }),
    );
    expect(prisma.siteStat.create).not.toHaveBeenCalled();
  });
});

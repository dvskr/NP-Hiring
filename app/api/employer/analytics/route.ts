import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { getEmployerTier, getEmployerActivePostings } from '@/lib/tier-limits';
import { PricingTier } from '@/lib/config';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { employerJobOwnershipBranches } from '@/lib/employer-ownership';
import { scopeJobIdsToOwned } from '@/app/api/employer/applicants/scope';

/** The chart window in days: DEFAULT_DAYS unless asked, never more than MAX_DAYS. */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

/**
 * SECURITY (docs/PENDING_WORK.md 2.19): `days` went through parseInt with no
 * ceiling, and it sizes the label loop below, so ?days=100000000 ran that
 * loop a hundred million times; 'abc' or 0 drew an empty chart. Only an
 * all-digit value above 0 counts, held to MAX_DAYS. Pinned by
 * tests/api/employer-analytics-ownership.test.ts.
 */
function parseDays(raw: string | null): number {
    if (raw === null || !/^\d+$/.test(raw)) return DEFAULT_DAYS;
    const days = Number(raw);
    return days > 0 ? Math.min(days, MAX_DAYS) : DEFAULT_DAYS;
}

/**
 * GET /api/employer/analytics
 * Return view + apply-click time-series data for an employer's jobs.
 * Query params: jobId (optional, one of the caller's own jobs unless admin),
 * days (default 30, at most 365)
 *
 * Access:
 *   No active posting → summary totals only
 *   Active posting    → full data (time-series chart, per-job breakdown, CTR)
 *   Admin             → full data + CSV export (handled by /analytics/csv)
 */
export async function GET(req: NextRequest) {
    const rateLimitResponse = await rateLimit(req, 'employer:analytics', RATE_LIMITS.employer);
    if (rateLimitResponse) return rateLimitResponse;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id },
        select: { id: true, role: true },
    });

    if (!profile || !['employer', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isAdmin = profile.role === 'admin';
    const tier: PricingTier = await getEmployerTier(user.id);
    const hasActivePosting = isAdmin
        ? true
        : (await getEmployerActivePostings(user.id)).length > 0;

    const { searchParams } = new URL(req.url);
    const jobIdFilter = searchParams.get('jobId');
    const days = parseDays(searchParams.get('days'));
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get all job IDs owned by this employer
    const employerJobs = await prisma.employerJob.findMany({
        where: {
            OR: employerJobOwnershipBranches(user),
        },
        select: { jobId: true, job: { select: { id: true, title: true, viewCount: true, applyClickCount: true } } },
    });

    // SECURITY (docs/PENDING_WORK.md 2.19): the jobId filter replaced the owned
    // set (`jobIdFilter ? [jobIdFilter] : owned`), so an employer with one live
    // post could read the daily apply clicks of any job on the board. It now
    // narrows the owned set, as on the applicants route, and a job the caller
    // does not own answers 404 before any click is read. An admin may still
    // name any job. Pinned by tests/api/employer-analytics-ownership.test.ts.
    const adminJobId = isAdmin ? jobIdFilter?.trim() : '';
    const jobIds = adminJobId
        ? [adminJobId]
        : scopeJobIdsToOwned(employerJobs.map(ej => ej.jobId), jobIdFilter);
    if (jobIds === null) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (jobIds.length === 0) {
        return NextResponse.json({
            tier,
            views: [], clicks: [],
            summary: { totalViews: 0, totalClicks: 0, ctr: 0 },
            jobs: [],
        });
    }

    // Build per-job summary (all tiers get this)
    const jobSummaries = employerJobs.map(ej => ({
        id: ej.job.id,
        title: ej.job.title,
        views: ej.job.viewCount,
        clicks: ej.job.applyClickCount,
        ctr: ej.job.viewCount > 0
            ? Math.round((ej.job.applyClickCount / ej.job.viewCount) * 1000) / 10
            : 0,
    }));

    const totalViews = jobSummaries.reduce((sum, j) => sum + j.views, 0);
    const totalClicks = jobSummaries.reduce((sum, j) => sum + j.clicks, 0);
    const ctr = totalViews > 0 ? Math.round((totalClicks / totalViews) * 1000) / 10 : 0;

    // ── No active posting: summary totals only ──
    if (!hasActivePosting) {
        return NextResponse.json({
            tier,
            summary: { totalViews, totalClicks, ctr },
            // No per-job breakdown or time-series until an active posting exists.
            upgradeHint: 'Post or renew a job to unlock per-job breakdowns, time-series charts, and click analytics.',
        });
    }

    // ── Active posting: full time-series + per-job breakdown ──

    // Recent apply clicks (last N days) per day
    const recentClicks = await prisma.applyClick.findMany({
        where: {
            jobId: { in: jobIds },
            timestamp: { gte: since },
        },
        select: { timestamp: true },
        orderBy: { timestamp: 'asc' },
    });

    // Group clicks by date string
    const clicksByDate: Record<string, number> = {};
    recentClicks.forEach(click => {
        const dateKey = click.timestamp.toISOString().split('T')[0];
        clicksByDate[dateKey] = (clicksByDate[dateKey] || 0) + 1;
    });

    // Generate date labels for last N days
    const dateLabels: string[] = [];
    const clickSeries: number[] = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        dateLabels.push(dateKey);
        clickSeries.push(clicksByDate[dateKey] || 0);
    }

    const response: Record<string, unknown> = {
        tier,
        summary: { totalViews, totalClicks, ctr },
        jobs: jobSummaries,
        chart: {
            labels: dateLabels,
            clicks: clickSeries,
        },
    };

    // ── Admin only: add CSV export URL ──
    if (isAdmin) {
        response.exportUrl = '/api/employer/analytics/csv';
    }

    return NextResponse.json(response);
}

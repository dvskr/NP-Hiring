import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdminActor } from '@/lib/auth/require-api-admin';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import {
    emptyApplicationCounts,
    isTrackedStatus,
    type EmployerApplicationCounts,
} from '@/lib/admin/employer-overview-types';
import {
    buildOrganizations,
    buildSummary,
    type EmployerJobRow,
    type EmployerProfileRow,
} from '@/lib/admin/employer-organizations';

/**
 * GET /api/admin/employers
 *
 * One row per ORGANIZATION: the connected component of employer accounts and
 * posts that share any identity key (lib/admin/employer-org-keys.ts: the
 * account, or a business mail domain). Two accounts at one clinic, on one
 * company mail domain, are one row, with the per-account story nested under
 * it.
 *
 * The grouping, folding and shaping live in lib/admin/employer-organizations.ts;
 * this route only loads rows, delegates, and guards access.
 *
 * PII: this endpoint shows EMPLOYER contact data to an admin, which is why
 * the access is audit logged (with ids only: the admin's profile id, never an
 * email). It shows NO candidate identity: applications are only ever counted.
 *
 * Cost: a fixed number of queries in two waves however many employers exist,
 * then an in-memory union-find. Nothing loops per employer.
 */

// Never cached or prerendered: the payload is per admin, audit logged, and
// carries employer contact data.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Type only, so this adds nothing to any client bundle.
export type {
    AdminEmployersResponse,
    AdminEmployerSummary,
    AdminOrganizationAccount,
    AdminOrganizationRow,
    EmployerApplicationCounts,
    EmployerHiringStatus,
    EmployerPostCounts,
} from '@/lib/admin/employer-overview-types';

const EMPLOYER_ROLE = 'employer';
const WITHDRAWN_STATUS = 'withdrawn';

const PROFILE_SELECT = {
    supabaseId: true,
    email: true,
    firstName: true,
    lastName: true,
    company: true,
    createdAt: true,
} as const;

/* ─── Data loading ─── */

async function loadEmployerJobs(): Promise<EmployerJobRow[]> {
    return prisma.employerJob.findMany({
        select: {
            userId: true,
            jobId: true,
            employerName: true,
            contactEmail: true,
            quotaDomain: true,
            paymentStatus: true,
            createdAt: true,
            job: {
                select: {
                    isPublished: true,
                    expiresAt: true,
                    viewCount: true,
                    applyClickCount: true,
                },
            },
        },
        orderBy: { createdAt: 'desc' },
    });
}

/** One job's counts with `count` more applications at `status`. */
function withLiveApplications(counts: EmployerApplicationCounts, status: string, count: number): EmployerApplicationCounts {
    // A row marked withdrawn by status but missing withdrawnAt (the employer
    // set it through the ATS) is still a withdrawal: out of the live total.
    if (status === WITHDRAWN_STATUS) return { ...counts, withdrawn: counts.withdrawn + count };
    const total = counts.total + count;
    return isTrackedStatus(status) ? { ...counts, total, [status]: counts[status] + count } : { ...counts, total };
}

/**
 * Applications per job, split into live buckets and a withdrawn count.
 *
 * Two groupBy queries with disjoint where clauses, so nothing is counted
 * twice. Scoped to employer posted jobs with a RELATION filter (the job has
 * an employer_jobs row) rather than `jobId: { in: [...] }`, whose bind list
 * would grow with the table: the same rows, at a constant parameter count.
 */
async function loadApplicationsByJob(hasEmployerPosts: boolean): Promise<ReadonlyMap<string, EmployerApplicationCounts>> {
    if (!hasEmployerPosts) return new Map();

    // Job.employerJobs is an optional to-one back relation (EmployerJob.jobId
    // is unique), so `isNot: null` reads as "posted by an employer".
    const employerPostedJob = { job: { employerJobs: { isNot: null } } } as const;
    const [liveGroups, withdrawnGroups] = await Promise.all([
        prisma.jobApplication.groupBy({
            by: ['jobId', 'status'],
            where: { ...employerPostedJob, withdrawnAt: null },
            _count: { _all: true },
        }),
        prisma.jobApplication.groupBy({
            by: ['jobId'],
            where: { ...employerPostedJob, withdrawnAt: { not: null } },
            _count: { _all: true },
        }),
    ]);

    const byJob = new Map<string, EmployerApplicationCounts>();
    const current = (jobId: string): EmployerApplicationCounts => byJob.get(jobId) ?? emptyApplicationCounts();
    for (const group of liveGroups) {
        byJob.set(group.jobId, withLiveApplications(current(group.jobId), group.status, group._count._all));
    }
    for (const group of withdrawnGroups) {
        const counts = current(group.jobId);
        byJob.set(group.jobId, { ...counts, withdrawn: counts.withdrawn + group._count._all });
    }
    return byJob;
}

/**
 * A post can belong to a profile whose role is no longer 'employer'. One
 * bounded extra query recovers those, never one per employer.
 */
async function loadMissingProfiles(
    employerJobs: readonly EmployerJobRow[],
    known: ReadonlyMap<string, EmployerProfileRow>,
): Promise<EmployerProfileRow[]> {
    const missing = [...new Set(employerJobs.map((row) => row.userId).filter((id): id is string => !!id && !known.has(id)))];
    if (missing.length === 0) return [];
    return prisma.userProfile.findMany({ where: { supabaseId: { in: missing } }, select: PROFILE_SELECT });
}

/* ─── Handler ─── */

export async function GET(request: NextRequest) {
    const { error: authError, actor } = await requireApiAdminActor(request);
    if (authError) return authError;

    // Employer contact data is about to be read: record who looked, by id.
    await logAudit({ action: 'admin.employers.list', actorType: 'admin', actorId: actor.profileId });

    try {
        const now = new Date();

        // Wave 1: every employer post, and every employer role account.
        const [employerJobs, employerProfiles] = await Promise.all([
            loadEmployerJobs(),
            prisma.userProfile.findMany({
                where: { role: EMPLOYER_ROLE },
                select: PROFILE_SELECT,
                orderBy: { createdAt: 'desc' },
            }),
        ]);
        const employerById = new Map<string, EmployerProfileRow>(employerProfiles.map((profile) => [profile.supabaseId, profile]));

        // Wave 2: application aggregates plus any profile the first wave missed.
        const [applicationsByJob, extraProfiles] = await Promise.all([
            loadApplicationsByJob(employerJobs.length > 0),
            loadMissingProfiles(employerJobs, employerById),
        ]);
        const profilesById = new Map<string, EmployerProfileRow>([
            ...employerById,
            ...extraProfiles.map((profile): [string, EmployerProfileRow] => [profile.supabaseId, profile]),
        ]);

        const organizations = buildOrganizations(employerProfiles, employerJobs, applicationsByJob, profilesById, now);
        const employerAccountIds = new Set(employerById.keys());
        const postedUserIds = new Set(employerJobs.map((row) => row.userId).filter((id): id is string => !!id));

        return NextResponse.json({
            success: true,
            summary: buildSummary(organizations, employerAccountIds, postedUserIds),
            organizations,
        });
    } catch (error) {
        // The client gates on `success`, so a caught failure must leave a
        // record: logger.error reports it, with the stack. The error itself
        // never reaches the client.
        logger.error('[admin/employers] could not build the employers overview', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch employer data' }, { status: 500 });
    }
}

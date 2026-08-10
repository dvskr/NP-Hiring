import type { Prisma } from '@prisma/client';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';

/**
 * Shared SELECT for the admin companies surface (mirrors the claim-select.ts
 * pattern next door): the list route and the PATCH route return the same row
 * shape so the table can splice an updated row in without a refetch.
 *
 * The active-jobs `_count` uses the SAME predicate as the public company
 * profile's 404 gate (lib/active-job-filter.ts), so the number an admin
 * triages by is the number candidates actually see — Company.jobCount is a
 * lifetime increment-only counter and would mis-rank companies whose postings
 * have expired.
 */
export function companySelect(now: Date = new Date()) {
    return {
        id: true,
        name: true,
        normalizedName: true,
        website: true,
        isVerified: true,
        claimVerifiedAt: true,
        recruitmentType: true,
        jobCount: true,
        _count: {
            select: {
                jobs: { where: activeIndexableJobWhere(now) },
            },
        },
    } satisfies Prisma.CompanySelect;
}

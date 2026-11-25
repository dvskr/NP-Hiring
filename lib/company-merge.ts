/**
 * Merging two Company rows without losing the employer relationship on either.
 *
 * The merge used to move the jobs and the aliases, then delete the merged row.
 * On this board a Company also carries employer claims (CompanyClaim rows,
 * which the database deletes with their company), the public claimed badge
 * and an admin's direct hire or staffing agency classification. Deleting the
 * merged row silently dropped all three.
 *
 * Now the claims move to the kept company, open ones included. The badge and
 * the classification are never written here: the claim review route is their
 * only writer for the badge and the admin company route for the
 * classification (tests/regressions/p4-company-claim-surfaces.test.ts and
 * tests/regressions/p5-recruitment-type-schema-admin.test.ts pin both). So
 * when keeping the chosen company would drop either one, the merge is refused,
 * and the refusal says which company to keep or what to resolve first. A
 * merge that goes ahead therefore leaves the kept company with every trust
 * signal either company had.
 *
 * Every merge that goes ahead is written to the audit log.
 */
import { prisma } from '@/lib/prisma';
import { logAudit, type ActorType } from '@/lib/audit-log';

const APPROVED = 'approved';
const PENDING = 'pending';

/** The columns of a Company the merge decision reads. */
export interface MergeCompanySnapshot {
    id: string;
    name: string;
    normalizedName: string;
    aliases: string[];
    claimVerifiedAt: Date | null;
    recruitmentType: string | null;
}

/** The columns of a CompanyClaim the merge decision reads. */
export interface MergeClaimSnapshot {
    id: string;
    companyId: string;
    claimantUserId: string;
    status: string;
}

export type MergeRefusalCode =
    | 'missing_id'
    | 'same_company'
    | 'not_found'
    | 'both_claimed'
    | 'merged_is_claimed'
    | 'classification_conflict'
    | 'merged_is_classified'
    | 'duplicate_open_claim';

export interface MergeRefusal {
    ok: false;
    code: MergeRefusalCode;
    /** The HTTP status a caller should answer with. */
    status: 400 | 404 | 409;
    message: string;
}

export interface MergePlan {
    ok: true;
    /** The kept company's aliases after the merge. */
    aliases: string[];
}

function refuse(code: MergeRefusalCode, status: MergeRefusal['status'], message: string): MergeRefusal {
    return { ok: false, code, status, message };
}

function classificationWords(value: string): string {
    return value.replace(/_/g, ' ');
}

function holdsVerifiedClaim(company: MergeCompanySnapshot, claims: readonly MergeClaimSnapshot[]): boolean {
    return company.claimVerifiedAt !== null || claims.some((c) => c.status === APPROVED);
}

function refuseOnClaims(
    keep: MergeCompanySnapshot,
    merge: MergeCompanySnapshot,
    keepClaims: readonly MergeClaimSnapshot[],
    mergeClaims: readonly MergeClaimSnapshot[],
): MergeRefusal | null {
    const keepClaimed = holdsVerifiedClaim(keep, keepClaims);
    const mergeClaimed = holdsVerifiedClaim(merge, mergeClaims);
    if (keepClaimed && mergeClaimed) {
        return refuse('both_claimed', 409,
            `"${keep.name}" and "${merge.name}" both hold a verified employer claim. Reject one of the claims in /admin/company-claims before merging.`);
    }
    if (mergeClaimed) {
        return refuse('merged_is_claimed', 409,
            `"${merge.name}" holds the verified employer claim and "${keep.name}" does not. Keep "${merge.name}" instead: swap the two companies.`);
    }
    const openOnKeep = new Set(keepClaims.filter((c) => c.status === PENDING).map((c) => c.claimantUserId));
    if (mergeClaims.some((c) => c.status === PENDING && openOnKeep.has(c.claimantUserId))) {
        return refuse('duplicate_open_claim', 409,
            'The same person has an open claim on both companies. Approve or reject one of them in /admin/company-claims before merging.');
    }
    return null;
}

function refuseOnClassification(keep: MergeCompanySnapshot, merge: MergeCompanySnapshot): MergeRefusal | null {
    if (!merge.recruitmentType || merge.recruitmentType === keep.recruitmentType) return null;
    if (keep.recruitmentType) {
        return refuse('classification_conflict', 409,
            `"${keep.name}" is classified as ${classificationWords(keep.recruitmentType)} and "${merge.name}" as ${classificationWords(merge.recruitmentType)}. Correct one of them in /admin/companies before merging.`);
    }
    return refuse('merged_is_classified', 409,
        `"${merge.name}" is classified as ${classificationWords(merge.recruitmentType)} and "${keep.name}" is not classified. Classify "${keep.name}" in /admin/companies first, or keep "${merge.name}" instead.`);
}

/**
 * Decide whether `merge` can be folded into `keep`, and what the kept row
 * becomes. Pure: the caller reads the rows and applies the plan.
 */
export function planCompanyMerge(
    keep: MergeCompanySnapshot,
    merge: MergeCompanySnapshot,
    claims: readonly MergeClaimSnapshot[],
): MergePlan | MergeRefusal {
    if (keep.id === merge.id) {
        return refuse('same_company', 400, 'A company cannot be merged with itself.');
    }
    const keepClaims = claims.filter((c) => c.companyId === keep.id);
    const mergeClaims = claims.filter((c) => c.companyId === merge.id);

    const refusal = refuseOnClaims(keep, merge, keepClaims, mergeClaims) ?? refuseOnClassification(keep, merge);
    if (refusal) return refusal;

    const aliases = [...new Set([...keep.aliases, merge.name, merge.normalizedName, ...merge.aliases])];
    return { ok: true, aliases };
}

export interface MergeActor {
    actorType: ActorType;
    /** UserProfile.id of the admin, or null for a script or cron. */
    actorId: string | null;
}

export interface MergeResult {
    ok: true;
    keepId: string;
    mergeId: string;
    keptName: string;
    mergedName: string;
    jobsMoved: number;
    claimsMoved: number;
    /** The kept company's job count after the merge, recounted from its jobs. */
    jobCount: number;
}

export type MergeOutcome = MergeResult | MergeRefusal;

const COMPANY_SELECT = {
    id: true,
    name: true,
    normalizedName: true,
    aliases: true,
    claimVerifiedAt: true,
    recruitmentType: true,
} as const;

/**
 * Fold `mergeId` into `keepId` in one transaction: jobs and claims move, the
 * kept row takes the merged names as aliases and a recounted job count, and
 * the merged row is deleted only after nothing hangs off it. Answers a
 * refusal, never a partial merge, when the plan says no. Database errors
 * propagate to the caller.
 */
export async function mergeCompanyRecords(
    keepId: string,
    mergeId: string,
    actor: MergeActor,
): Promise<MergeOutcome> {
    if (!keepId || !mergeId) {
        return refuse('missing_id', 400, 'Both keepId and mergeId are required.');
    }
    if (keepId === mergeId) {
        return refuse('same_company', 400, 'A company cannot be merged with itself.');
    }

    const outcome = await prisma.$transaction(async (tx): Promise<MergeOutcome> => {
        const keep = await tx.company.findUnique({ where: { id: keepId }, select: COMPANY_SELECT });
        const merge = await tx.company.findUnique({ where: { id: mergeId }, select: COMPANY_SELECT });
        if (!keep || !merge) {
            return refuse('not_found', 404, `Company ${keep ? mergeId : keepId} was not found.`);
        }

        const claims = await tx.companyClaim.findMany({
            where: { companyId: { in: [keepId, mergeId] } },
            select: { id: true, companyId: true, claimantUserId: true, status: true },
        });
        const plan = planCompanyMerge(keep, merge, claims);
        if (!plan.ok) return plan;

        const jobs = await tx.job.updateMany({ where: { companyId: mergeId }, data: { companyId: keepId } });
        // Open claims hold their company id in pendingCompanyId too (the one
        // open claim per claimant rule); move it before the row it names goes.
        await tx.companyClaim.updateMany({ where: { pendingCompanyId: mergeId }, data: { pendingCompanyId: keepId } });
        const claimsMoved = await tx.companyClaim.updateMany({ where: { companyId: mergeId }, data: { companyId: keepId } });
        const jobCount = await tx.job.count({ where: { companyId: keepId } });

        await tx.company.update({
            where: { id: keepId },
            data: { aliases: plan.aliases, jobCount },
        });
        await tx.company.delete({ where: { id: mergeId } });

        return {
            ok: true,
            keepId,
            mergeId,
            keptName: keep.name,
            mergedName: merge.name,
            jobsMoved: jobs.count,
            claimsMoved: claimsMoved.count,
            jobCount,
        };
    });

    if (outcome.ok) {
        await logAudit({
            action: 'company.merge',
            actorType: actor.actorType,
            actorId: actor.actorId,
            targetType: 'company',
            targetId: outcome.keepId,
            metadata: {
                mergedId: outcome.mergeId,
                mergedName: outcome.mergedName,
                keptName: outcome.keptName,
                jobsMoved: outcome.jobsMoved,
                claimsMoved: outcome.claimsMoved,
                jobCount: outcome.jobCount,
            },
        });
    }
    return outcome;
}

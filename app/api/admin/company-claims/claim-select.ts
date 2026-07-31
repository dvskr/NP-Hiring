/**
 * Shared Prisma selection for the admin company-claim queue.
 *
 * Lives outside route.ts because Next.js App Router route files may only export
 * HTTP method handlers and the reserved segment-config fields; an extra named
 * export there is a build-time type error.
 *
 * The company block travels with every claim on purpose. An admin judging
 * "should this person own this profile" needs the website the domain signal was
 * compared against, and needs to see `isVerified` — which means only "the ingest
 * pipeline matched this employer name against the KNOWN_COMPANIES map", is NOT
 * evidence about the claimant, and must never be mistaken for the thing this
 * queue actually sets (`claimVerifiedAt`).
 */
export const CLAIM_SELECT = {
    id: true,
    companyId: true,
    claimantUserId: true,
    claimantEmail: true,
    claimantDomain: true,
    companyHost: true,
    domainMatch: true,
    freeEmailDomain: true,
    claimantRole: true,
    note: true,
    status: true,
    reviewedAt: true,
    reviewedBy: true,
    reviewNote: true,
    createdAt: true,
    company: {
        select: {
            name: true,
            normalizedName: true,
            website: true,
            isVerified: true,
            claimVerifiedAt: true,
        },
    },
} as const;

/** The three states a claim can be in. Mirrors CompanyClaim.status. */
export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

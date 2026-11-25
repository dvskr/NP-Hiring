import type { Prisma } from '@prisma/client';

/**
 * The talent pool: the profiles an employer can find, open, unlock, save,
 * message from the pool and be alerted about. A profile is in it while it
 * belongs to a job seeker, is visible to employers, is open to offers and
 * its account is not deleted. The soft delete also clears both flags; the
 * deletion is still checked on its own, so no later write to a flag can put
 * a deleted account back in front of employers.
 *
 * Register 2.26: every pool read wrote this rule by hand (seven routes), and
 * only the candidate alert cron checked the deletion.
 * Test: tests/regressions/talent-pool-shared-rules.test.ts
 */
export function talentPoolWhere(): Prisma.UserProfileWhereInput {
    return { role: 'job_seeker', profileVisible: true, openToOffers: true, deletedAt: null };
}

export interface TalentPoolFlags {
    readonly role: string;
    readonly profileVisible: boolean;
    readonly openToOffers: boolean;
    readonly deletedAt: Date | null;
}

/** The same rule for a profile already loaded. */
export function isInTalentPool(profile: TalentPoolFlags): boolean {
    return profile.role === 'job_seeker'
        && profile.profileVisible
        && profile.openToOffers
        && profile.deletedAt === null;
}

/**
 * What an employer may read of a pool member, and so what a search may match
 * or filter on. The candidate list and AI talent search select by these tiers:
 *   browse   any employer: first name and last initial, headline, years of
 *            experience, specialties, preferred work mode.
 *   posting  an employer with an active posting: also certifications,
 *            license states, desired salary, available date, the resume flag.
 *   admin    everything, including the full last name, bio, state and city.
 * Contact details and the resume itself need an unlock (a ProfileView row).
 */
export type CandidateAccessTier = 'browse' | 'posting' | 'admin';

export function candidateAccessTier(viewer: { readonly isAdmin: boolean; readonly hasActivePosting: boolean }): CandidateAccessTier {
    if (viewer.isAdmin) return 'admin';
    return viewer.hasActivePosting ? 'posting' : 'browse';
}

/** Whether the tier reads the posting-tier fields, and so may filter on them. */
export function seesPostingTierFields(tier: CandidateAccessTier): boolean {
    return tier !== 'browse';
}

/**
 * The OR branches of a free-text search, over the fields the tier can read
 * only. A match on a locked field confirms its value: q=<surname> answering
 * "Anna N." told an employer the surname an unlock pays for.
 * Test: tests/lib/candidate-pool-access.test.ts
 */
export function candidateTextSearchClauses(q: string, tier: CandidateAccessTier): Prisma.UserProfileWhereInput[] {
    const match = { contains: q, mode: 'insensitive' as const };
    return [
        { firstName: match },
        { headline: match },
        { specialties: match },
        { preferredWorkMode: match },
        ...(seesPostingTierFields(tier) ? [{ certifications: match }] : []),
        ...(tier === 'admin' ? [{ lastName: match }, { bio: match }, { state: match }, { city: match }] : []),
    ];
}

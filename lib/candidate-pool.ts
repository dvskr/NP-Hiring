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

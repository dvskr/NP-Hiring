import { prisma } from '@/lib/prisma';
import { config, PricingTier } from '@/lib/config';
import { activePostingJobWhere } from '@/lib/active-posting';

/**
 * Get ALL active employer job postings (published + not expired, the rule in
 * lib/active-posting.ts). Returns them ordered by tier rank (highest first).
 */
export async function getEmployerActivePostings(employerId: string) {
    const activePostings = await prisma.employerJob.findMany({
        where: {
            userId: employerId,
            job: activePostingJobWhere(),
        },
        select: {
            id: true,
            pricingTier: true,
            createdAt: true,
            jobId: true,
            job: {
                select: { id: true, createdAt: true, expiresAt: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    return activePostings;
}

/**
 * Get the employer's most recent active posting (single-tier model — all postings
 * are equivalent, so "best" is just "most recent").
 */
export async function getEmployerActivePosting(employerId: string) {
    const postings = await getEmployerActivePostings(employerId);
    if (postings.length === 0) return null;
    // postings are already ordered by createdAt desc — return the newest
    return postings[0];
}

/**
 * Get the employer's current pricing tier. Always 'pro' in the single-tier
 * model — kept as a function only for callers that destructure or pass it through.
 *
 * Important: callers should NOT use the returned tier as a gate for "do they
 * have an active posting?" — use `getEmployerActivePostings(...).length > 0`
 * directly. Tier represents the plan; active-posting count represents the state.
 */
export async function getEmployerTier(_employerId: string): Promise<PricingTier> {
    return 'pro';
}

/**
 * Count how many profile unlocks are tied to a specific posting.
 */
export async function getUnlocksForPosting(employerJobId: string): Promise<number> {
    return prisma.profileView.count({
        where: { employerJobId },
    });
}

/**
 * The InMails charged to a posting: the threads this employer opened since
 * the posting began, about the posting's job, or naming no job with the
 * posting recorded on the message that opened them. Replies are free, so a
 * thread counts once however many messages it holds.
 *
 * A thread that names no job records the posting it spent on its opening
 * message (POST /api/employer/messages), not on the thread: the thread's job
 * would show the candidate a posting the employer never named, and would move
 * the thread off the (pair, no job) key a later message to them lands on.
 * Such a thread opened before 2026-11-25 has no posting on that message and
 * counts against none.
 *
 * Only threads the employer opened count, as on PMHNP Hiring. There the
 * initiator is participantA; NP stores a new thread's participants in sorted
 * order, so the sender of the thread's first message says who opened it. A
 * candidate's question about a job (app/api/candidate/messages names the job)
 * used to count against the employer's own allowance.
 * tests/lib/inmail-attribution.test.ts
 */
export async function getInMailsForPosting(
    senderId: string,
    jobId: string,
    postingCreatedAt: Date
): Promise<number> {
    const threads = await prisma.conversation.findMany({
        where: {
            AND: [
                { OR: [{ participantA: senderId }, { participantB: senderId }] },
                { OR: [{ jobId }, { jobId: null, messages: { some: { senderId, jobId } } }] },
            ],
            createdAt: { gte: postingCreatedAt },
        },
        select: {
            jobId: true,
            messages: {
                orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
                take: 1,
                select: { senderId: true, jobId: true },
            },
        },
    });
    return threads.filter((thread) => {
        const opening = thread.messages[0];
        return opening !== undefined && opening.senderId === senderId && (thread.jobId ?? opening.jobId) === jobId;
    }).length;
}

/** The fields inMailSpendOrder reads from an active posting. */
interface SpendOrderPosting {
    readonly id: string;
    readonly createdAt: Date;
    readonly job: { readonly expiresAt: Date | null };
}

/**
 * The order a new thread that names no job spends InMail credits in: the
 * posting that ends soonest first, since its credits lapse with it, so the
 * employer keeps the most credits overall. A posting with no end date never
 * lapses and comes last; among equal end dates the older posting comes first,
 * then the id, so the same postings always give the same order.
 */
export function inMailSpendOrder<T extends SpendOrderPosting>(postings: readonly T[]): T[] {
    const endsAt = (posting: T): number => posting.job.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return [...postings].sort((a, b) =>
        endsAt(a) - endsAt(b)
        || a.createdAt.getTime() - b.createdAt.getTime()
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Check if the employer can unlock another candidate profile.
 * Per-posting: each posting gets its own independent credit pool.
 * Returns the posting ID to charge if allowed.
 *
 * Audit #13 fix: only counts views attributed to *currently active* postings,
 * plus orphan legacy views (employerJobId=null) that fit within the active
 * postings' remaining capacity. Views from expired postings no longer count
 * against the new posting's cap — an employer with 75 historical views from
 * three expired postings is no longer locked out of their fresh 25/25 bucket.
 */
export async function canUnlockCandidate(
    employerId: string,
    tier: PricingTier
): Promise<{ allowed: boolean; used: number; limit: number; postingId?: string; reason?: 'no_posting' | 'posting_cap' | 'daily_cap' }> {
    const limits = config.getTierLimits(tier);
    const limit = limits.candidateUnlocksPerPosting;

    // Unlimited tier
    if (!Number.isFinite(limit)) {
        return { allowed: true, used: 0, limit: Infinity };
    }

    // Cross-posting daily cap (anti-scrape). Even if per-posting headroom exists,
    // refuse if the employer has unlocked >= dailyUnlockCap unique candidates in
    // the last 24h. Bypasses the rest of the math when triggered so we don't
    // reveal posting-level state to abusers via error responses.
    // viewedAt is the first unlock: no write moves it (lib/candidate-unlock.ts,
    // GET /api/employer/candidates/[id]), so re-opening a candidate unlocked
    // earlier is not counted as a new unlock. tests/api/employer-unlock-daily-cap.test.ts
    const dailyCap = config.dailyUnlockCap;
    if (Number.isFinite(dailyCap) && dailyCap > 0) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentUnlocks = await prisma.profileView.count({
            where: { viewerId: employerId, viewedAt: { gte: since } },
        });
        if (recentUnlocks >= dailyCap) {
            return {
                allowed: false,
                used: recentUnlocks,
                limit: dailyCap,
                reason: 'daily_cap',
            };
        }
    }

    // Get all active postings
    const postings = await getEmployerActivePostings(employerId);
    if (postings.length === 0) {
        return { allowed: false, used: 0, limit, reason: 'no_posting' };
    }

    // Calculate total limit across all currently-active postings
    let totalLimit = 0;
    for (const posting of postings) {
        const postingLimits = config.getTierLimits(posting.pricingTier as PricingTier);
        const postingLimit = postingLimits.candidateUnlocksPerPosting;
        if (!Number.isFinite(postingLimit)) {
            totalLimit = Infinity;
            break;
        }
        totalLimit += postingLimit;
    }

    // Count views attributed to active postings + legacy (unattributed) views.
    // Views from EXPIRED postings (employerJobId pointing to a non-active row)
    // are deliberately excluded — they were paid for under that posting's cap
    // and shouldn't penalize a new active posting (audit #13).
    const activePostingIds = postings.map(p => p.id);
    const activeAndLegacyViews = await prisma.profileView.count({
        where: {
            viewerId: employerId,
            OR: [
                { employerJobId: { in: activePostingIds } },
                { employerJobId: null },
            ],
        },
    });

    // Global safety check using the active-scoped count
    if (Number.isFinite(totalLimit) && activeAndLegacyViews >= totalLimit) {
        return { allowed: false, used: activeAndLegacyViews, limit: totalLimit };
    }

    // Per-posting check: distribute legacy views to postings (oldest first so
    // the newest posting keeps its full bucket for fresh unlocks).
    const legacyViews = await prisma.profileView.count({
        where: { viewerId: employerId, employerJobId: null },
    });

    // Iterate oldest-to-newest for legacy distribution, then return the first
    // (newest) posting with remaining capacity for the new charge.
    const oldestToNewest = [...postings].reverse();
    const legacyChargedPerPosting = new Map<string, number>();
    let legacyRemaining = legacyViews;
    for (const posting of oldestToNewest) {
        const postingLimits = config.getTierLimits(posting.pricingTier as PricingTier);
        const postingLimit = postingLimits.candidateUnlocksPerPosting;
        if (!Number.isFinite(postingLimit)) continue;

        const attributedViews = await getUnlocksForPosting(posting.id);
        const headroom = Math.max(0, postingLimit - attributedViews);
        const charged = Math.min(legacyRemaining, headroom);
        legacyChargedPerPosting.set(posting.id, charged);
        legacyRemaining -= charged;
    }

    // Now find a posting with remaining capacity (newest first)
    for (const posting of postings) {
        const postingLimits = config.getTierLimits(posting.pricingTier as PricingTier);
        const postingLimit = postingLimits.candidateUnlocksPerPosting;

        if (!Number.isFinite(postingLimit)) {
            return { allowed: true, used: activeAndLegacyViews, limit: Infinity, postingId: posting.id };
        }

        const attributedViews = await getUnlocksForPosting(posting.id);
        const legacyCharge = legacyChargedPerPosting.get(posting.id) ?? 0;
        const effectiveUsed = attributedViews + legacyCharge;

        if (effectiveUsed < postingLimit) {
            return { allowed: true, used: activeAndLegacyViews, limit: totalLimit, postingId: posting.id };
        }
    }

    // All postings exhausted
    return { allowed: false, used: activeAndLegacyViews, limit: totalLimit };
}

/**
 * Whether the employer may open a new thread, and the posting whose InMail
 * credit it spends: `jobId` in the answer is that posting's job, and the
 * caller records it on the thread so getInMailsForPosting counts it.
 * Per-posting: each posting gets its own credit pool for InMails.
 *
 * A thread that names a job (`jobId`) spends that posting's credit and no
 * other's. Checked against "any posting with room" while the thread was
 * counted under the named one, an exhausted posting kept sending for as long
 * as another posting had room, whose count never moved (PMHNP Hiring's fix).
 *
 * A thread that names no job spends the credit of the first active posting
 * in inMailSpendOrder that has credit left: the one that ends soonest. A
 * thread with no job named used to count against no posting at all.
 *
 * Refused, with the totals of the postings it read, when none has credit.
 * tests/lib/inmail-attribution.test.ts
 */
export async function canSendInMail(
    senderId: string,
    employerId: string,
    tier: PricingTier,
    jobId?: string,
): Promise<{ allowed: boolean; used: number; limit: number; jobId?: string }> {
    const limit = config.getTierLimits(tier).inmailsPerPosting;

    const activePostings = await getEmployerActivePostings(employerId);
    const postings = jobId
        ? activePostings.filter((posting) => posting.job.id === jobId)
        : inMailSpendOrder(activePostings);
    if (postings.length === 0) {
        return { allowed: false, used: 0, limit };
    }

    let totalUsed = 0;
    let totalLimit = 0;
    for (const posting of postings) {
        const postingLimit = config.getTierLimits(posting.pricingTier as PricingTier).inmailsPerPosting;
        if (!Number.isFinite(postingLimit)) {
            return { allowed: true, used: totalUsed, limit: Infinity, jobId: posting.job.id };
        }
        const used = await getInMailsForPosting(senderId, posting.job.id, posting.createdAt);
        if (used < postingLimit) {
            return { allowed: true, used, limit: postingLimit, jobId: posting.job.id };
        }
        totalUsed += used;
        totalLimit += postingLimit;
    }

    // Every posting it may spend is exhausted
    return { allowed: false, used: totalUsed, limit: totalLimit };
}

/**
 * Get a summary of the employer's total usage vs total limits across all postings.
 * Each posting contributes its own pool to the totals.
 */
export async function getUsageSummary(
    profileId: string,
    employerId: string,
    tier: PricingTier
): Promise<{
    candidateUnlocks: { used: number; limit: number };
    inmails: { used: number; limit: number };
}> {
    const postings = await getEmployerActivePostings(employerId);

    if (postings.length === 0) {
        // No active posting → no entitlement. Returning the per-posting tier
        // allowance here was misleading: the dashboard rendered "0/25 unlocks"
        // and the talent-pool cards showed "Unlock Profile" CTAs that always
        // failed at the API with `reason: 'no_posting'`. Reporting a 0-cap
        // makes the empty state explicit so the UI can prompt "Post a job".
        // `tier` is still useful upstream as the plan label, so we keep the
        // arg even though we no longer read its allowances here.
        void tier;
        return {
            candidateUnlocks: { used: 0, limit: 0 },
            inmails: { used: 0, limit: 0 },
        };
    }

    let totalUnlocksUsed = 0;
    let totalUnlocksLimit = 0;
    let totalInmailsUsed = 0;
    let totalInmailsLimit = 0;

    for (const posting of postings) {
        const postingLimits = config.getTierLimits(posting.pricingTier as PricingTier);

        // Unlocks
        const unlockLimit = postingLimits.candidateUnlocksPerPosting;
        if (Number.isFinite(unlockLimit)) {
            const unlockCount = await getUnlocksForPosting(posting.id);
            totalUnlocksUsed += unlockCount;
            totalUnlocksLimit += unlockLimit;
        } else {
            totalUnlocksLimit = Infinity;
        }

        // InMails — count unique conversations, not individual messages
        const inmailLimit = postingLimits.inmailsPerPosting;
        if (Number.isFinite(inmailLimit)) {
            const inmailCount = await getInMailsForPosting(profileId, posting.job.id, posting.createdAt);
            totalInmailsUsed += inmailCount;
            totalInmailsLimit += inmailLimit;
        } else {
            totalInmailsLimit = Infinity;
        }
    }

    return {
        candidateUnlocks: { used: totalUnlocksUsed, limit: totalUnlocksLimit },
        inmails: { used: totalInmailsUsed, limit: totalInmailsLimit },
    };
}

/**
 * Get per-posting credit breakdown with job titles.
 * Used by the posting selector dropdown in the Talent Pool.
 */
export async function getPerPostingUsage(
    profileId: string,
    employerId: string
): Promise<{
    id: string;
    jobId: string;
    jobTitle: string;
    tier: string;
    unlocks: { used: number; limit: number; remaining: number };
    inmails: { used: number; limit: number; remaining: number };
}[]> {
    const postings = await getEmployerActivePostings(employerId);

    const result = [];
    for (const posting of postings) {
        const limits = config.getTierLimits(posting.pricingTier as PricingTier);

        const unlockCount = await getUnlocksForPosting(posting.id);
        const unlockLimit = limits.candidateUnlocksPerPosting;
        const unlockRemaining = Number.isFinite(unlockLimit) ? Math.max(0, unlockLimit - unlockCount) : Infinity;

        const inmailCount = await getInMailsForPosting(profileId, posting.job.id, posting.createdAt);
        const inmailLimit = limits.inmailsPerPosting;
        const inmailRemaining = Number.isFinite(inmailLimit) ? Math.max(0, inmailLimit - inmailCount) : Infinity;

        // Fetch job title
        const job = await prisma.job.findUnique({
            where: { id: posting.jobId },
            select: { title: true },
        });

        result.push({
            id: posting.id,
            jobId: posting.jobId,
            jobTitle: job?.title || 'Untitled Job',
            tier: posting.pricingTier,
            unlocks: {
                used: unlockCount,
                limit: Number.isFinite(unlockLimit) ? unlockLimit : -1,
                remaining: Number.isFinite(unlockRemaining) ? unlockRemaining : -1,
            },
            inmails: {
                used: inmailCount,
                limit: Number.isFinite(inmailLimit) ? inmailLimit : -1,
                remaining: Number.isFinite(inmailRemaining) ? inmailRemaining : -1,
            },
        });
    }

    return result;
}

/**
 * Legacy helper: count unlocks for a posting by creation date.
 * Kept for backward compatibility but prefer getUnlocksForPosting.
 */
export async function getCandidateUnlocksForPosting(
    employerId: string,
    postingCreatedAt: Date
): Promise<number> {
    return prisma.profileView.count({
        where: {
            viewerId: employerId,
            viewedAt: { gte: postingCreatedAt },
        },
    });
}

/**
 * Legacy helper: count total InMails for employer.
 */
export async function getTotalInMailsForEmployer(
    senderId: string,
    employerId: string
): Promise<number> {
    const posting = await getEmployerActivePosting(employerId);
    if (!posting) return 0;

    return prisma.employerMessage.count({
        where: {
            senderId,
            sentAt: { gte: posting.job.createdAt },
        },
    });
}

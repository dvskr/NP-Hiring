/**
 * Shared monthly AI-generation quota for the autofill AI routes (audit F29).
 *
 * Before this helper existed only generate-answer enforced the free/pro cap,
 * and it counted ROWS with aiGenerations > 0 while /api/autofill/usage
 * displayed the SUM of aiGenerations — so a bulk call recording 10
 * generations in one row counted as 1 toward enforcement but 10 in the UI.
 *
 * Contract:
 *   - `getMonthlyAiGenerations` is THE number: the SUM of
 *     autofill_usage.ai_generations for the current calendar month. Both the
 *     enforcement path (this file) and the display path
 *     (/api/autofill/usage) call it, so they can never disagree again.
 *   - Every autofill AI route calls `checkAutofillAiQuota` BEFORE the model
 *     call, passing how many generations the request will consume
 *     (generate-bulk passes the count of questions that actually need AI).
 *   - Cover letters are paid-only per docs/ai-architecture.md §"Cover letter
 *     generation = paid only" — the route rejects tier 'free' outright via
 *     `tier` on the result before even consulting the cap.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export type AutofillTier = 'free' | 'pro' | 'premium';

/** Monthly AI-generation caps per tier. Infinity = unlimited (premium). */
export const AUTOFILL_AI_MONTHLY_LIMITS: Record<AutofillTier, number> = {
    free: 10,
    pro: 100,
    premium: Number.POSITIVE_INFINITY,
};

export function tierFromRole(role: string | null | undefined): AutofillTier {
    return role === 'premium' ? 'premium' : role === 'pro' ? 'pro' : 'free';
}

/** First instant of the current calendar month (server timezone — matches
 *  the period the usage endpoint has always displayed). */
export function startOfCurrentMonth(now: Date = new Date()): Date {
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * SUM of aiGenerations recorded this calendar month — the same number the
 * /api/autofill/usage endpoint displays.
 */
export async function getMonthlyAiGenerations(userId: string): Promise<number> {
    const agg = await prisma.autofillUsage.aggregate({
        where: { userId, createdAt: { gte: startOfCurrentMonth() } },
        _sum: { aiGenerations: true },
    });
    return agg._sum.aiGenerations ?? 0;
}

export interface AutofillQuotaResult {
    allowed: boolean;
    tier: AutofillTier;
    /** Numeric cap, or 'unlimited' for premium. */
    limit: number | 'unlimited';
    /** Generations already consumed this calendar month (SUM). */
    used: number;
    remaining: number | 'unlimited';
}

/**
 * Checks whether `userId` may consume `generationsRequested` more AI
 * generations this month. Does NOT record usage — routes record after a
 * successful model call, exactly as before.
 */
export async function checkAutofillAiQuota(
    userId: string,
    generationsRequested: number = 1,
): Promise<AutofillQuotaResult> {
    const profile = await prisma.userProfile.findUnique({
        where: { id: userId },
        select: { role: true },
    });
    const tier = tierFromRole(profile?.role);
    const limit = AUTOFILL_AI_MONTHLY_LIMITS[tier];
    const used = await getMonthlyAiGenerations(userId);

    if (!Number.isFinite(limit)) {
        return { allowed: true, tier, limit: 'unlimited', used, remaining: 'unlimited' };
    }

    return {
        allowed: used + generationsRequested <= limit,
        tier,
        limit,
        used,
        remaining: Math.max(0, limit - used),
    };
}

/** Standard 429 payload for an exhausted monthly quota. */
export function quotaExceededResponse(quota: AutofillQuotaResult): NextResponse {
    return NextResponse.json(
        {
            error: 'AI generation limit reached for this month',
            tier: quota.tier,
            limit: quota.limit,
            used: quota.used,
            remaining: quota.remaining,
        },
        { status: 429 },
    );
}

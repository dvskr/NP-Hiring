import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyExtensionToken } from '@/lib/verify-extension-token';
import {
    AUTOFILL_AI_MONTHLY_LIMITS,
    getMonthlyAiGenerations,
    startOfCurrentMonth,
    tierFromRole,
} from '../_lib/quota';


export async function GET(req: NextRequest) {
    try {
        const user = await verifyExtensionToken(req);
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get current period (calendar month)
        const now = new Date();
        const periodStart = startOfCurrentMonth(now);
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

        // Get usage for this period
        const usageRecords = await prisma.autofillUsage.findMany({
            where: {
                userId: user.userId,
                createdAt: { gte: periodStart, lte: periodEnd },
            },
        });

        const autofillsUsed = usageRecords.filter(r => r.fieldsFilled > 0).length;
        // Audit F29: the displayed number MUST be the same SUM the
        // enforcement helper uses — both call getMonthlyAiGenerations so
        // they can never disagree.
        const aiGenerationsUsed = await getMonthlyAiGenerations(user.userId);

        // Check tier
        const profile = await prisma.userProfile.findUnique({
            where: { id: user.userId },
            select: { role: true },
        });

        const tier = tierFromRole(profile?.role);

        // AI caps come from the shared quota module (audit F29); the
        // autofill-count caps are display-only and stay local.
        const aiCapFor = (t: typeof tier): number | 'unlimited' =>
            Number.isFinite(AUTOFILL_AI_MONTHLY_LIMITS[t]) ? AUTOFILL_AI_MONTHLY_LIMITS[t] : 'unlimited';
        const tierLimits: Record<string, { autofills: number | 'unlimited'; ai: number | 'unlimited' }> = {
            free: { autofills: 10, ai: aiCapFor('free') },
            pro: { autofills: 'unlimited' as const, ai: aiCapFor('pro') },
            premium: { autofills: 'unlimited' as const, ai: aiCapFor('premium') },
        };

        const limits = tierLimits[tier] || tierLimits.free;

        return NextResponse.json({
            autofillsUsed,
            autofillsRemaining: limits.autofills === 'unlimited'
                ? 'unlimited'
                : Math.max(0, (limits.autofills as number) - autofillsUsed),
            aiGenerationsUsed,
            aiGenerationsRemaining: limits.ai === 'unlimited'
                ? 'unlimited'
                : Math.max(0, (limits.ai as number) - aiGenerationsUsed),
            tier,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
        });
    } catch (error) {
        console.error('Usage fetch error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

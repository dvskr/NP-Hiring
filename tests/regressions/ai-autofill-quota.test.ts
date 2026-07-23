/**
 * Regression guards for audit F29 — one shared monthly AI-generation quota,
 * SUM-based, enforced on ALL five autofill AI routes BEFORE the model call,
 * and displayed from the same SUM by /api/autofill/usage.
 *
 * The pre-fix state: only generate-answer checked the cap, and it counted
 * ROWS with aiGenerations > 0 while the usage endpoint displayed the SUM —
 * a 10-generation bulk row counted as 1 toward enforcement but 10 in the UI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import {
    AUTOFILL_AI_MONTHLY_LIMITS,
    checkAutofillAiQuota,
    getMonthlyAiGenerations,
    tierFromRole,
} from '@/app/api/autofill/_lib/quota';

vi.mock('@/lib/prisma', () => ({
    prisma: {
        userProfile: { findUnique: vi.fn() },
        autofillUsage: { aggregate: vi.fn() },
    },
}));

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function mockUsageSum(sum: number | null): void {
    vi.mocked(prisma.autofillUsage.aggregate).mockResolvedValue(
        { _sum: { aiGenerations: sum } } as never,
    );
}

function mockRole(role: string | null): void {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(
        (role === null ? null : { role }) as never,
    );
}

describe('F29 — checkAutofillAiQuota sums aiGenerations for the month', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('SUMS aiGenerations (a 10-generation bulk row counts as 10, not 1)', async () => {
        mockRole('job_seeker'); // free tier
        mockUsageSum(10); // e.g. one bulk row with aiGenerations: 10
        const quota = await checkAutofillAiQuota('user-1', 1);
        expect(quota.used).toBe(10);
        expect(quota.allowed).toBe(false); // free cap is 10 — already exhausted
        expect(quota.tier).toBe('free');
        expect(quota.limit).toBe(10);
    });

    it('allows a request that fits, blocks one that would exceed the cap', async () => {
        mockRole(null); // no profile → free
        mockUsageSum(8);
        expect((await checkAutofillAiQuota('user-1', 2)).allowed).toBe(true);
        mockUsageSum(8);
        expect((await checkAutofillAiQuota('user-1', 3)).allowed).toBe(false);
    });

    it('bulk requests pass their full generation count', async () => {
        mockRole('pro');
        mockUsageSum(95);
        const quota = await checkAutofillAiQuota('user-1', 10);
        expect(quota.allowed).toBe(false); // 95 + 10 > 100
        expect(quota.remaining).toBe(5);
    });

    it('premium is unlimited', async () => {
        mockRole('premium');
        mockUsageSum(100_000);
        const quota = await checkAutofillAiQuota('user-1', 10);
        expect(quota.allowed).toBe(true);
        expect(quota.limit).toBe('unlimited');
    });

    it('null SUM (no rows this month) counts as 0', async () => {
        mockRole('pro');
        mockUsageSum(null);
        expect(await getMonthlyAiGenerations('user-1')).toBe(0);
    });

    it('tier mapping matches the historical role → tier logic', () => {
        expect(tierFromRole('premium')).toBe('premium');
        expect(tierFromRole('pro')).toBe('pro');
        expect(tierFromRole('job_seeker')).toBe('free');
        expect(tierFromRole(null)).toBe('free');
        expect(tierFromRole(undefined)).toBe('free');
        expect(AUTOFILL_AI_MONTHLY_LIMITS.free).toBe(10);
        expect(AUTOFILL_AI_MONTHLY_LIMITS.pro).toBe(100);
    });
});

describe('F29 — every autofill AI route enforces the shared quota before the model call', () => {
    const routes = [
        'app/api/autofill/classify-fields/route.ts',
        'app/api/autofill/generate-cover-letter/route.ts',
        'app/api/autofill/generate-answer/route.ts',
        'app/api/autofill/generate-bulk/route.ts',
        'app/api/autofill/extract-resume-sections/route.ts',
    ];

    for (const rel of routes) {
        it(`${path.basename(path.dirname(rel))} calls checkAutofillAiQuota before complete()`, () => {
            const src = read(rel);
            const quotaIdx = src.indexOf('checkAutofillAiQuota(');
            const completeIdx = src.indexOf('await complete({');
            expect(quotaIdx, 'quota check missing').toBeGreaterThan(-1);
            expect(completeIdx, 'gateway call missing').toBeGreaterThan(-1);
            expect(quotaIdx, 'quota must be checked BEFORE the model call').toBeLessThan(completeIdx);
        });
    }

    it('generate-bulk checks quota for the whole batch (aiNeeded count), not per call', () => {
        const src = read('app/api/autofill/generate-bulk/route.ts');
        expect(src).toMatch(/checkAutofillAiQuota\(user\.userId, aiNeeded\)/);
    });

    it('the usage endpoint displays the same SUM the enforcement uses', () => {
        const src = read('app/api/autofill/usage/route.ts');
        expect(src).toContain('getMonthlyAiGenerations(user.userId)');
        // The old drift source — an inline reduce over rows — must be gone.
        expect(src).not.toMatch(/reduce\(\(sum, r\) => sum \+ r\.aiGenerations/);
    });

    it('cover letters are paid-only per the architecture decision', () => {
        const src = read('app/api/autofill/generate-cover-letter/route.ts');
        expect(src).toContain("quota.tier === 'free'");
        expect(src).toContain('paid_plan_required');
        // 403, before the model call.
        const gateIdx = src.indexOf('paid_plan_required');
        const completeIdx = src.indexOf('await complete({');
        expect(gateIdx).toBeLessThan(completeIdx);
    });
});

/**
 * Regression (F3, audit high) — ENABLE_PAID_POSTING was a phantom flag: the
 * launch runbook told operators to launch with it false and "flip when
 * ready", .env.example documented it, but no code read it (lib/env.ts
 * isFeatureEnabled only supported 'sentry'). These tests pin the flag as
 * REAL: isFeatureEnabled('paidPosting') follows the env var strictly
 * ('true' only — mirroring scripts/fork-preflight.ts), and
 * getPaidPostingStatus() combines it with stripeConfigured into the single
 * availability signal the checkout APIs and the /post-job funnel gate on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// lib/env caches the parsed env on first getEnv() — each case must reset
// modules and re-import so the stubbed process.env is actually re-read.
async function importFreshEnv() {
    vi.resetModules();
    return import('@/lib/env');
}

const savedEnv: Record<string, string | undefined> = {};
const TOUCHED_KEYS = ['ENABLE_PAID_POSTING', 'STRIPE_SECRET_KEY', 'CRON_SECRET'] as const;

beforeEach(() => {
    for (const key of TOUCHED_KEYS) {
        savedEnv[key] = process.env[key];
    }
    // Satisfy the required-vars schema (setup.ts covers DATABASE_URL and the
    // Supabase trio; CRON_SECRET must be >= 16 chars).
    process.env.CRON_SECRET = 'test-cron-secret-0123456789abcdef';
    delete process.env.ENABLE_PAID_POSTING;
    delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
    for (const key of TOUCHED_KEYS) {
        if (savedEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = savedEnv[key];
        }
    }
});

describe("F3 — isFeatureEnabled('paidPosting') reads ENABLE_PAID_POSTING", () => {
    it('is false when the variable is unset (documented launch default)', async () => {
        const { isFeatureEnabled } = await importFreshEnv();
        expect(isFeatureEnabled('paidPosting')).toBe(false);
    });

    it("is false for 'false' and for sloppy truthy variants", async () => {
        for (const value of ['false', 'FALSE', '1', 'yes', 'TRUE']) {
            process.env.ENABLE_PAID_POSTING = value;
            const { isFeatureEnabled } = await importFreshEnv();
            expect(isFeatureEnabled('paidPosting'), `value=${value}`).toBe(false);
        }
    });

    it("is true only for the strict string 'true'", async () => {
        process.env.ENABLE_PAID_POSTING = 'true';
        const { isFeatureEnabled } = await importFreshEnv();
        expect(isFeatureEnabled('paidPosting')).toBe(true);
    });
});

describe('F3 — getPaidPostingStatus combines flag + stripeConfigured', () => {
    it('unavailable when both are off', async () => {
        const { getPaidPostingStatus } = await importFreshEnv();
        expect(getPaidPostingStatus()).toEqual({
            enabled: false,
            stripeConfigured: false,
            available: false,
        });
    });

    it('unavailable when Stripe is configured but the flag is off (the pre-F3 trap)', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { getPaidPostingStatus } = await importFreshEnv();
        expect(getPaidPostingStatus()).toEqual({
            enabled: false,
            stripeConfigured: true,
            available: false,
        });
    });

    it('unavailable when the flag is on but Stripe is not configured', async () => {
        process.env.ENABLE_PAID_POSTING = 'true';
        const { getPaidPostingStatus } = await importFreshEnv();
        expect(getPaidPostingStatus()).toEqual({
            enabled: true,
            stripeConfigured: false,
            available: false,
        });
    });

    it('available only when the flag is on AND Stripe is configured', async () => {
        process.env.ENABLE_PAID_POSTING = 'true';
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        const { getPaidPostingStatus } = await importFreshEnv();
        expect(getPaidPostingStatus()).toEqual({
            enabled: true,
            stripeConfigured: true,
            available: true,
        });
    });
});

/**
 * Environment Variable Validation
 * 
 * Validates all required environment variables at startup.
 * Provides type-safe access to environment variables.
 */

import { z } from 'zod';
import { brand } from '@/config/brand';

const envSchema = z.object({
    // Database (required)
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Supabase (required for auth)
    NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

    // App URL (required)
    NEXT_PUBLIC_APP_URL: z.string().url().optional().default('http://localhost:3000'),
    NEXT_PUBLIC_BASE_URL: z.string().url().optional(),

    // Email (required for production)
    RESEND_API_KEY: z.string().optional(),
    // Sender defaults come from config/brand.ts — the single source of truth —
    // so a fork can't silently send as the original board's (unverified) domain.
    EMAIL_FROM: z.string().optional().default(brand.email.transactionalFrom),
    EMAIL_FROM_MARKETING: z.string().optional().default(brand.email.marketingFrom),
    EMAIL_REPLY_TO: z.string().optional().default(brand.email.replyTo),
    EMAIL_ASSETS_URL: z.string().url().optional().default(brand.assets.emailAssetsBase),
    SALARY_GUIDE_URL: z.string().url().optional().default(brand.assets.salaryGuidePdf),
    // Required so the Resend webhook can verify Svix signatures. Webhook returns 500 at
    // runtime if missing — better to fail at startup so misconfiguration is loud.
    RESEND_WEBHOOK_SECRET: z.string().optional(),

    // Stripe (optional - for paid posting)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    // Master switch for paid job posting. Strict 'true' enables the checkout
    // APIs (Stripe keys then required — see scripts/fork-preflight.ts); any
    // other value (or unset) makes create-checkout / create-renewal-checkout
    // return 503 { code: 'PAID_POSTING_DISABLED' } and lets /post-job show a
    // "paid posting coming soon" state before the form.
    ENABLE_PAID_POSTING: z.string().optional(),

    // Cron security (required — protects all cron endpoints)
    CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),

    // Inngest (optional — but the FP-recovery loop, embeddings refresh,
    // recommendation digests, payment reconciliation, broadcast sends, and
    // the cron watchdog ALL silently stop when these are unset in
    // production; validateEnvironmentAtStartup warns loudly about that).
    INNGEST_EVENT_KEY: z.string().optional(),
    INNGEST_SIGNING_KEY: z.string().optional(),

    // Job aggregator APIs (all optional)
    ADZUNA_APP_ID: z.string().optional(),
    ADZUNA_APP_KEY: z.string().optional(),
    JOOBLE_API_KEY: z.string().optional(),
    USAJOBS_API_KEY: z.string().optional(),

    // Monitoring (optional)
    SENTRY_DSN: z.string().optional(),

    // Logging
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

/**
 * Validates and returns typed environment variables.
 * Caches the result after first call.
 * Throws on validation failure in production.
 */
export function getEnv(): Env {
    if (cachedEnv) {
        return cachedEnv;
    }

    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        const errors = result.error.issues
            .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
            .join('\n');

        const message = `❌ Invalid environment variables:\n${errors}`;

        // In production, throw immediately
        if (process.env.NODE_ENV === 'production') {
            throw new Error(message);
        }

        // In development, warn but continue with defaults
        console.warn(message);
        console.warn('⚠️  Continuing with defaults for missing optional variables...\n');

        // Parse again with defaults applied using safeParse to prevent crashing
        const fallbackResult = envSchema.safeParse({
            ...process.env,
            NODE_ENV: process.env.NODE_ENV || 'development',
            // Default required keys to prevent throwing if missed in dev (though they should be there)
            DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dev:dev@localhost:5432/dev',
            NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'demo-key',
        });

        if (fallbackResult.success) {
            cachedEnv = fallbackResult.data;
            return cachedEnv;
        }

        // If even fallback fails, throw a clear error
        throw new Error(`Failed to initialize environment: ${fallbackResult.error.message}`);
    }

    cachedEnv = result.data;
    return cachedEnv;
}

export type FeatureFlag = 'sentry' | 'paidPosting';

/**
 * Check if a specific feature is enabled
 */
export function isFeatureEnabled(feature: FeatureFlag): boolean {
    const env = getEnv();
    switch (feature) {
        case 'sentry':
            return !!env.SENTRY_DSN;
        case 'paidPosting':
            // Strict 'true' — mirrors scripts/fork-preflight.ts and the
            // documented launch default (ENABLE_PAID_POSTING=false).
            return env.ENABLE_PAID_POSTING === 'true';
        default:
            return false;
    }
}

export interface PaidPostingStatus {
    /** ENABLE_PAID_POSTING === 'true' */
    enabled: boolean;
    /** STRIPE_SECRET_KEY is present */
    stripeConfigured: boolean;
    /** Both — the only state in which paid checkout can actually complete */
    available: boolean;
}

/**
 * Combined paid-posting availability signal: the ENABLE_PAID_POSTING flag
 * AND a configured Stripe secret key. The checkout APIs 503 unless both
 * hold; /post-job uses this (via /api/create-checkout/availability) to show
 * a "paid posting coming soon" state BEFORE the employer fills the form.
 */
export function getPaidPostingStatus(): PaidPostingStatus {
    const env = getEnv();
    const enabled = isFeatureEnabled('paidPosting');
    const stripeConfigured = !!env.STRIPE_SECRET_KEY;
    return { enabled, stripeConfigured, available: enabled && stripeConfigured };
}

/**
 * Get the base URL for the app
 */
export function getBaseUrl(): string {
    const env = getEnv();
    return env.NEXT_PUBLIC_BASE_URL || env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

// ─── Startup validation (B107) ───────────────────────────────────────
//
// Previously this module threw at import time in production, which (a) only
// ran for routes that happened to import lib/env, (b) could break `next
// build` (NODE_ENV=production during builds), and (c) crashed the route
// instead of surfacing an actionable report. Validation is now wired at
// server startup via instrumentation.ts → validateEnvironmentAtStartup():
// log-and-alert in production, warn-and-continue in development, never
// throw. Explicit getEnv() callers keep their existing throw-in-production
// behavior for genuinely unusable configurations.

export interface EnvStartupReport {
    /** True when the full schema parsed cleanly. */
    ok: boolean;
    /** Hard schema violations (missing/invalid REQUIRED variables). */
    issues: string[];
    /**
     * Production-only operational warnings: variables that are schema-optional
     * but whose absence silently disables a whole subsystem.
     */
    warnings: string[];
}

/**
 * Validate the environment for startup reporting. Never throws — the caller
 * (instrumentation.ts register()) decides how loudly to surface the report.
 */
export function validateEnvironmentAtStartup(): EnvStartupReport {
    const result = envSchema.safeParse(process.env);
    const issues = result.success
        ? []
        : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

    const warnings: string[] = [];
    if (process.env.NODE_ENV === 'production') {
        if (!process.env.RESEND_API_KEY) {
            warnings.push('RESEND_API_KEY is unset — ALL email delivery (confirmations, alerts, digests) is disabled');
        }
        if (!process.env.RESEND_WEBHOOK_SECRET) {
            warnings.push('RESEND_WEBHOOK_SECRET is unset — the Resend webhook returns 500 and bounce/complaint suppression is dead');
        }
        // B108: Inngest events silently drop without these — FP-recovery,
        // embeddings, recommendation digests, payment reconciliation, and
        // the cron watchdog all die with no signal.
        if (!process.env.INNGEST_EVENT_KEY) {
            warnings.push('INNGEST_EVENT_KEY is unset — inngest.send() events are dropped (FP-recovery, embeddings, digests, payment reconciliation)');
        }
        if (!process.env.INNGEST_SIGNING_KEY) {
            warnings.push('INNGEST_SIGNING_KEY is unset — Inngest cannot invoke scheduled/durable functions on this deployment');
        }
        if (process.env.ENABLE_PAID_POSTING === 'true') {
            if (!process.env.STRIPE_SECRET_KEY) {
                warnings.push('ENABLE_PAID_POSTING=true but STRIPE_SECRET_KEY is unset — paid checkout cannot complete');
            }
            if (!process.env.STRIPE_WEBHOOK_SECRET) {
                warnings.push('ENABLE_PAID_POSTING=true but STRIPE_WEBHOOK_SECRET is unset — payment webhooks are rejected; paid jobs will never activate');
            }
        }
    }

    return { ok: result.success, issues, warnings };
}

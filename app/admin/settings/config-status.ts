/**
 * What /admin/settings reports, and how it decides.
 *
 * The page used to be a static client component: every "Active" and
 * "Enabled" pill was a literal, so it read green whether or not the
 * integration behind it was configured, and two of the env names it
 * displayed (FB_PAGE_ACCESS_TOKEN, IG_USER_ID) are read nowhere in this
 * codebase. A settings screen that cannot be wrong is not telling you
 * anything.
 *
 * Each row names the env vars its feature actually reads and the file that
 * reads them. Status is derived from those and nothing else, so a row can
 * only claim "Configured" when the keys the runtime looks for are present.
 * Values never leave the server: a status carries key names, not values.
 */

export interface IntegrationRow {
    label: string;
    /** What the feature does, and what happens when its keys are absent. */
    description: string;
    /** Env vars the runtime reads. */
    envKeys: readonly string[];
    /**
     * 'all' (the default): every key must be set. 'any': the code reads the
     * keys as alternatives, so one set key is enough.
     */
    mode?: 'all' | 'any';
    /** Where those keys are read (a file, or a folder), so the claim can be checked against code. */
    readBy: string;
}

export interface IntegrationSection {
    title: string;
    rows: readonly IntegrationRow[];
}

export const INTEGRATION_SECTIONS: readonly IntegrationSection[] = [
    {
        title: 'Job ingestion',
        rows: [
            {
                label: 'Adzuna feed',
                description: 'Credentialed aggregator feed. Without both keys the Adzuna source fetches nothing.',
                envKeys: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
                readBy: 'lib/aggregators/adzuna.ts',
            },
            {
                label: 'USAJobs feed',
                description: 'Federal listings. Without a key and a contact user agent the USAJobs source fetches nothing.',
                envKeys: ['USAJOBS_API_KEY', 'USAJOBS_USER_AGENT'],
                readBy: 'lib/aggregators/usajobs.ts',
            },
            {
                label: 'Cron authentication',
                description: 'Shared secret every scheduled run and batch dispatcher presents. Missing means the crons cannot authenticate.',
                envKeys: ['CRON_SECRET'],
                readBy: 'lib/auth/verify-cron-or-admin.ts',
            },
        ],
    },
    {
        title: 'Social posting',
        rows: [
            {
                label: 'Postiz account',
                description: 'API key the social post routes publish through.',
                envKeys: ['POSTIZ_API_KEY'],
                readBy: 'lib/postiz-client.ts',
            },
            {
                label: 'Facebook page',
                description: 'Postiz integration id for the page. Unset means the social post skips Facebook.',
                envKeys: ['POSTIZ_FB_INTEGRATION_ID'],
                readBy: 'lib/social-post-generator.ts',
            },
            {
                label: 'Instagram account',
                description: 'Postiz integration id for the carousel post. Unset means the social post skips Instagram.',
                envKeys: ['POSTIZ_INSTAGRAM_INTEGRATION_ID'],
                readBy: 'lib/social-post-generator.ts',
            },
        ],
    },
    {
        title: 'Email and notifications',
        rows: [
            {
                label: 'Transactional email',
                description: 'Every alert, digest and account email sends through Resend.',
                envKeys: ['RESEND_API_KEY'],
                readBy: 'lib/email-service.ts',
            },
            {
                label: 'Delivery webhooks',
                description: 'Signing secret for bounce and complaint events. Without it suppression flags never flip.',
                envKeys: ['RESEND_WEBHOOK_SECRET'],
                readBy: 'app/api/webhooks/resend/route.ts',
            },
            {
                label: 'DMARC reports',
                description: 'Postmark token the DMARC admin page reads its reports with.',
                envKeys: ['POSTMARK_DMARC_API_TOKEN'],
                readBy: 'app/admin/dmarc/page.tsx',
            },
            {
                label: 'Discord alerts',
                description: 'Webhook for cron failures and health alerts. Unset means those alerts are skipped.',
                envKeys: ['DISCORD_WEBHOOK_URL'],
                readBy: 'lib/discord-notifier.ts',
            },
        ],
    },
    {
        title: 'Search indexing',
        rows: [
            {
                label: 'IndexNow',
                description: 'Submits new and changed URLs to Bing and Yandex. Either key name is read.',
                envKeys: ['INDEXNOW_KEY', 'INDEXNOW_API_KEY'],
                mode: 'any',
                readBy: 'lib/indexnow.ts',
            },
            {
                label: 'Bing Webmaster API',
                description: 'Per site URL submission plus coverage visibility.',
                envKeys: ['BING_WEBMASTER_API_KEY'],
                readBy: 'lib/search-indexing.ts',
            },
            {
                label: 'Google Indexing API',
                description: 'Service account credentials for job posting submissions.',
                envKeys: ['GOOGLE_INDEXING_CREDENTIALS'],
                readBy: 'lib/search-indexing.ts',
            },
        ],
    },
    {
        title: 'AI and content',
        rows: [
            {
                label: 'OpenAI',
                description: 'Backs the AI features: job enrichment, embeddings and the resume parser.',
                envKeys: ['OPENAI_API_KEY'],
                readBy: 'lib/ai/providers/openai.ts',
            },
            {
                label: 'Blog content API key',
                description: 'Bearer token the external content pipeline uses to write posts.',
                envKeys: ['BLOG_API_KEY'],
                readBy: 'app/api/blog/route.ts',
            },
        ],
    },
    {
        title: 'Platform',
        rows: [
            {
                label: 'Supabase auth',
                description: 'Sign in, sessions, and the service role used by server-side writes.',
                envKeys: [
                    'NEXT_PUBLIC_SUPABASE_URL',
                    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                    'SUPABASE_SERVICE_ROLE_KEY',
                ],
                readBy: 'lib/supabase',
            },
            {
                label: 'Redis rate limiting',
                description: 'Shared rate-limit counters. Unset falls back to per-instance in-memory counts, which do not hold across serverless instances.',
                envKeys: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
                readBy: 'lib/rate-limit.ts',
            },
            {
                label: 'Stripe checkout',
                description: 'Secret key for paid job posting checkout.',
                envKeys: ['STRIPE_SECRET_KEY'],
                readBy: 'lib/stripe.ts',
            },
            {
                label: 'Stripe webhook',
                description: 'Signing secret for payment events. Without it a paid post never activates.',
                envKeys: ['STRIPE_WEBHOOK_SECRET'],
                readBy: 'app/api/webhooks/stripe/route.ts',
            },
            {
                label: 'Background jobs (Inngest)',
                description: 'Event key to send jobs and signing key for Inngest to run scheduled functions here.',
                envKeys: ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'],
                readBy: 'lib/env.ts',
            },
        ],
    },
    {
        title: 'Monitoring',
        rows: [
            {
                label: 'Error tracking, server',
                description: 'Sentry DSN for server and edge errors. Either key name is read.',
                envKeys: ['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN'],
                mode: 'any',
                readBy: 'sentry.server.config.ts',
            },
            {
                label: 'Error tracking, browser',
                description: 'Sentry DSN for errors in the browser, which reads only the public key name.',
                envKeys: ['NEXT_PUBLIC_SENTRY_DSN'],
                readBy: 'instrumentation-client.ts',
            },
        ],
    },
];

export interface IntegrationStatus {
    configured: boolean;
    /** Keys the row needs that are absent or blank (for an 'any' row, all of them when none is set). */
    missing: string[];
}

function isSet(env: Readonly<Record<string, string | undefined>>, key: string): boolean {
    return (env[key] ?? '').trim() !== '';
}

/**
 * Whether the env vars a row depends on are present and non-blank.
 *
 * Blank counts as missing: an empty string in a deploy's env panel is the
 * usual way a key gets "set" without being set, and every consumer treats it
 * as absent.
 */
export function readIntegrationStatus(
    row: IntegrationRow,
    env: Readonly<Record<string, string | undefined>>,
): IntegrationStatus {
    const missing = row.envKeys.filter((key) => !isSet(env, key));
    if (row.mode === 'any') {
        const anySet = missing.length < row.envKeys.length;
        return { configured: anySet, missing: anySet ? [] : [...row.envKeys] };
    }
    return { configured: missing.length === 0, missing };
}

const WINDOW_WORDS: Readonly<Record<number, string>> = {
    60: 'minute',
    3600: 'hour',
    86400: 'day',
};

/** A rate limit in words: "20 requests per minute", "3 requests per hour". */
export function describeRateLimit(cfg: { limit: number; windowSeconds: number }): string {
    const requests = `${cfg.limit} ${cfg.limit === 1 ? 'request' : 'requests'}`;
    const unit = WINDOW_WORDS[cfg.windowSeconds];
    return unit ? `${requests} per ${unit}` : `${requests} per ${cfg.windowSeconds} seconds`;
}

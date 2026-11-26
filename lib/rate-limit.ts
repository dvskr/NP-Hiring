/**
 * Rate Limiting Middleware
 * 
 * Supports two backends:
 * 1. Redis (via @upstash/ratelimit) - Preferred for production/serverless
 * 2. In-Memory (Map) - Fallback for local development or when Redis is unconfigured
 */

import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { logger } from './logger';
import { redisKey } from './redis-key';

// --- Configuration ---

interface RateLimitConfig {
    /** Maximum requests allowed in the window */
    limit: number;
    /** Time window in seconds */
    windowSeconds: number;
}

// Preset configurations for common endpoints
export const RATE_LIMITS = {
    /** Newsletter subscription: 10 req/min */
    subscribe: { limit: 10, windowSeconds: 60 },
    /** Job posting: 3 req/min */
    postJob: { limit: 3, windowSeconds: 60 },
    /** Contact form: 5 req/min */
    contact: { limit: 5, windowSeconds: 60 },
    /** Job alerts: 10 req/min */
    jobAlerts: { limit: 10, windowSeconds: 60 },
    /** General API: 60 req/min */
    general: { limit: 60, windowSeconds: 60 },
    /** Auth endpoints: 10 req/min */
    auth: { limit: 10, windowSeconds: 60 },
    /** Uploads: 10 req/min */
    upload: { limit: 10, windowSeconds: 60 },
    /** Direct applications: 10 req/min */
    applyDirect: { limit: 10, windowSeconds: 60 },
    /** Autofill AI endpoints: 30 req/min */
    autofill: { limit: 30, windowSeconds: 60 },
    /** Feedback/report: 5 req/min */
    feedback: { limit: 5, windowSeconds: 60 },
    /** Profile CRUD: 20 req/min */
    profile: { limit: 20, windowSeconds: 60 },
    /** Track/telemetry: 60 req/min */
    telemetry: { limit: 60, windowSeconds: 60 },
    /**
     * Admin console, per signed-in admin per route group: 60 req/min.
     *
     * It used to be 20 req/min keyed on IP alone, shared by every /api/admin
     * route and charged before authentication, so an operator walking through
     * the console (jobs, users and analytics in the same minute, or a
     * debounced search) spent it, and anonymous traffic from the same address
     * spent it for them. The budget now belongs to the admin and the route
     * group (lib/auth/require-api-admin.ts), so a burst on one screen cannot
     * lock the rest of the console.
     */
    admin: { limit: 60, windowSeconds: 60 },
    /**
     * High-impact admin actions, per signed-in admin per action: 10 req/min,
     * charged on top of RATE_LIMITS.admin (lib/auth/require-api-admin.ts
     * limitHighImpactAdminAction). A broadcast send, a bulk hard delete of
     * jobs and a user deletion each mail many people or remove what cannot be
     * restored, so a stuck button or a script in a loop is stopped within ten
     * calls instead of sixty.
     */
    adminHighImpact: { limit: 10, windowSeconds: 60 },
    /**
     * Pre-auth guard on /api/admin: 120 req/min per IP across every admin
     * route. It runs before the session is known, so it stays loose enough for
     * a real console session; its job is only to bound anonymous hammering,
     * which costs a Supabase round trip per call.
     */
    adminIp: { limit: 120, windowSeconds: 60 },
    /** Employer endpoints: 30 req/min */
    employer: { limit: 30, windowSeconds: 60 },
    /** Candidate messaging: 10 messages per 24h */
    candidateMessage: { limit: 10, windowSeconds: 86400 },
    /** Public job listing pages: 120 req/min per IP (real users < 30/min) */
    publicListing: { limit: 120, windowSeconds: 60 },
    /** Public job detail pages: 240 req/min per IP (4/sec — fast browsing OK) */
    publicDetail: { limit: 240, windowSeconds: 60 },
    /** Public company pages: 60 req/min per IP (rarely deep-browsed) */
    publicCompany: { limit: 60, windowSeconds: 60 },
    /** Each throttled crawler (lib/crawler-policy.ts THROTTLED_CRAWLERS), across all of its IPs: one request every 6 seconds on average, its robots.txt Crawl-delay order. */
    throttledCrawler: { limit: 10, windowSeconds: 60 },
    /** DSAR submission: 3 per hour per IP — privacy requests don't burst */
    dataRequest: { limit: 3, windowSeconds: 3600 },
    /** Short-link redirects (/r/<code>): 120 req/min per IP. Real social
     *  clicks come in bursts when a post lands, but no human taps the same
     *  link 100×/min — the cap exists to bound abuse of the redirect as a
     *  free 302 proxy, not to throttle organic engagement. */
    shortlinkRedirect: { limit: 120, windowSeconds: 60 },
    /** Guides store: starting a checkout, 10 per minute per IP. */
    guideCheckout: { limit: 10, windowSeconds: 60 },
    /** Guides store: claiming a guide while the guides are free to claim, 5 per minute per IP (each claim can send an email). */
    guideClaim: { limit: 5, windowSeconds: 60 },
    /** Guides store: claims for one email address, 6 per hour across every IP, so nobody can flood an inbox with delivery emails. */
    guideClaimPerEmail: { limit: 6, windowSeconds: 3600 },
    /** Guides store: verifying a checkout, opening a library link or downloading, 60 per minute per IP. */
    guideAccess: { limit: 60, windowSeconds: 60 },
} as const;

// --- Redis Backend Setup ---

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null;

// --- In-Memory Backend Setup (Fallback) ---

interface MemoryEntry {
    count: number;
    resetTime: number;
}

const memoryStore = new Map<string, MemoryEntry>();

// Warn once per cold start if Redis is unavailable in production
let hasWarnedMemoryFallback = false;

// Clean up old entries every minute
if (!redis) {
    if (process.env.NODE_ENV === 'production' && !hasWarnedMemoryFallback) {
        console.warn('[RATE-LIMIT] ⚠️ Redis unavailable — falling back to in-memory rate limiting (ineffective on serverless)');
        hasWarnedMemoryFallback = true;
    }
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of memoryStore.entries()) {
            if (now > entry.resetTime) {
                memoryStore.delete(key);
            }
        }
    }, 60000);
}

// --- Helpers ---

function getClientIp(request: Request): string {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    const realIp = request.headers.get('x-real-ip');
    if (realIp) {
        return realIp;
    }
    return '127.0.0.1';
}

function rateLimitExceeded(resetTime: number): NextResponse {
    const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
    return NextResponse.json(
        {
            error: 'Too many requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter,
        },
        {
            status: 429,
            headers: {
                'Retry-After': String(retryAfter),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.ceil(resetTime / 1000)),
            },
        }
    );
}

// --- Core Logic ---

/**
 * Check rate limit for a given key using the best available backend
 * Exported for testing
 */
export async function checkRateLimit(key: string, config: RateLimitConfig): Promise<{ success: boolean; reset: number; remaining: number }> {
    // Strategy 1: Redis (Production/Serverless)
    if (redis) {
        try {
            const limiter = new Ratelimit({
                redis: redis,
                limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSeconds} s`),
                analytics: true,
                // Namespaced per board at the single point every limiter key
                // (and the analytics keys beside it) passes through, so a
                // caller that builds its own key is covered too.
                prefix: redisKey('@upstash/ratelimit'),
            });

            const { success, reset, remaining } = await limiter.limit(key);
            return { success, reset, remaining };
        } catch (error) {
            logger.warn('Redis rate limit check failed, falling back to memory', { error });
            // Fallthrough to memory
        }
    }

    // Strategy 2: In-Memory (Fallback/Dev)
    const now = Date.now();
    const windowMs = config.windowSeconds * 1000;
    const entry = memoryStore.get(key);

    if (!entry || now > entry.resetTime) {
        const reset = now + windowMs;
        memoryStore.set(key, { count: 1, resetTime: reset });
        return { success: true, reset, remaining: config.limit - 1 };
    }

    if (entry.count < config.limit) {
        entry.count++;
        return { success: true, reset: entry.resetTime, remaining: config.limit - entry.count };
    }

    return { success: false, reset: entry.resetTime, remaining: 0 };
}

/**
 * Rate limit middleware function to use in API routes
 */
export async function rateLimit(
    request: Request,
    endpointKey: string,
    config: RateLimitConfig
): Promise<NextResponse | null> {
    const ip = getClientIp(request);
    const key = `ratelimit:${endpointKey}:${ip}`;

    const { success, reset } = await checkRateLimit(key, config);

    if (!success) {
        return rateLimitExceeded(reset);
    }

    return null;
}

/**
 * A limit shared by every request with the same key, whatever its IP: for a
 * client identified another way, such as a crawler by its user agent
 * (middleware.ts, lib/crawler-policy.ts) or a signed-in admin by their
 * session (lib/auth/require-api-admin.ts). Answers 429 with Retry-After past
 * the limit, null otherwise.
 */
export async function rateLimitShared(sharedKey: string, config: RateLimitConfig): Promise<NextResponse | null> {
    const { success, reset } = await checkRateLimit(`ratelimit:shared:${sharedKey}`, config);
    return success ? null : rateLimitExceeded(reset);
}

export { rateLimit as default };

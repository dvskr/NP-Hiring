/**
 * Rate limiting for the OAuth endpoints (design 2.11) on the site's shared
 * limiter (lib/rate-limit.ts: Upstash when configured, memory otherwise).
 */
import { checkRateLimit } from '@/lib/rate-limit';

export interface WindowLimit {
    limit: number;
    windowSeconds: number;
}

/** The longest client IP kept in a rate-limit key. */
const MAX_IP_LENGTH = 64;

/**
 * Seconds until the caller may try again when `key` is over its limit, or
 * null when the request may proceed. At least 1, for Retry-After.
 */
export async function rateLimitWait(key: string, config: WindowLimit): Promise<number | null> {
    const { success, reset } = await checkRateLimit(key, config);
    if (success) return null;
    return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

/**
 * The caller's IP as Vercel reports it: the first X-Forwarded-For entry
 * (Vercel sets that header itself), else X-Real-IP. Same reading as
 * lib/rate-limit.ts, bounded so a header cannot grow the key.
 */
export function clientIp(headers: Headers): string {
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
    return ip.slice(0, MAX_IP_LENGTH);
}

import { brand } from '@/config/brand';

/**
 * Where a password-reset link may land.
 *
 * Opening a recovery link hands the recovery session to the link's redirect
 * target in the URL fragment, so the target must be a host this site
 * controls. That is production, plus the Vercel hosts of the running
 * deployment itself (VERCEL_URL and VERCEL_BRANCH_URL, which the platform
 * sets and no request can), so a preview's reset returns to that preview.
 * No other *.vercel.app host qualifies: anyone can register one. Loopback is
 * accepted outside production only.
 *
 * Read at call time, not at module load, so the running deployment's values
 * apply (tests/api/forgot-password-redirect.test.ts).
 */
const RECOVERY_PATH = '/auth/confirm';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/** The hostname in an env value written as a bare host or as a URL; undefined when unusable. */
function hostnameOf(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    try {
        return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname || undefined;
    } catch {
        return undefined;
    }
}

export function resetRedirectHosts(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
    const hosts = new Set<string>([brand.domain, `www.${brand.domain}`]);
    for (const deploymentHost of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
        const host = hostnameOf(deploymentHost);
        if (host) hosts.add(host);
    }
    return hosts;
}

/**
 * The recovery URL to mint the link with, or undefined, and the caller falls
 * back to its own recovery page.
 *
 * The caller's value only chooses the origin; the URL is rebuilt rather than
 * passed on, so no caller path or query reaches Supabase (a session landing
 * elsewhere on the origin could be carried on by any same-origin redirect).
 * Accepted: https on a host from resetRedirectHosts with no port, or a
 * loopback host outside production; never embedded credentials; and only
 * the recovery path, which is all app/forgot-password/page.tsx sends.
 */
export function safeResetRedirect(
    raw: string | undefined,
    env: NodeJS.ProcessEnv = process.env,
): string | undefined {
    if (!raw) return undefined;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return undefined;
    }
    if (url.username || url.password || url.pathname !== RECOVERY_PATH) return undefined;

    const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
    const isAllowed = isLoopback
        ? env.NODE_ENV !== 'production' && (url.protocol === 'http:' || url.protocol === 'https:')
        : url.protocol === 'https:' && url.port === '' && resetRedirectHosts(env).has(url.hostname);
    return isAllowed ? `${url.origin}${RECOVERY_PATH}?type=recovery` : undefined;
}

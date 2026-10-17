/**
 * POST /api/auth/forgot-password: where the mailed reset link may land.
 *
 * The route mints a recovery link with the admin API and mails it to the
 * address in the body. Opening the link hands the recovery session to the
 * link's redirect target in the URL fragment, so that target must be a host
 * this site controls. The allow-list accepted every *.vercel.app host as a
 * "preview deploy", and anyone can register one: a request naming someone
 * else's address and https://<anything>.vercel.app put a genuine reset email
 * in their inbox whose link pointed at the requester's host. Only the
 * Supabase dashboard's Redirect URLs list, which the repo cannot see, stood
 * between that link and the account.
 *
 * Pinned on the redirect the route actually passes to generateLink:
 *   - production hosts, and this deployment's own Vercel hosts, pass as sent;
 *   - every other host, including any other *.vercel.app host, falls back
 *     to this site's own /auth/confirm;
 *   - localhost passes only outside production;
 *   - the answer stays the generic 200 either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { brand } from '@/config/brand';

const h = vi.hoisted(() => ({ generateLink: vi.fn(), sendAndLog: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({ auth: { admin: { generateLink: h.generateLink } } }),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/email-service', () => ({ sendAndLog: h.sendAndLog }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '@/app/api/auth/forgot-password/route';

const FALLBACK = `${process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl}/auth/confirm?type=recovery`;
const RECOVERY_PATH = '/auth/confirm?type=recovery';

/** POST a reset request carrying `redirectTo`; returns the redirect the route minted the link with. */
async function mintedRedirect(redirectTo: string | undefined): Promise<string> {
    const res = await POST(new NextRequest('https://nphiring.com/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'someone@example.com', ...(redirectTo === undefined ? {} : { redirectTo }) }),
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
        ok: true,
        message: 'If an account exists for that email, a reset link has been sent.',
    });
    expect(h.generateLink).toHaveBeenCalledTimes(1);
    const [args] = h.generateLink.mock.calls[0] as [{ type: string; email: string; options: { redirectTo: string } }];
    expect(args.type).toBe('recovery');
    return args.options.redirectTo;
}

beforeEach(() => {
    vi.clearAllMocks();
    h.generateLink.mockResolvedValue({
        data: { properties: { action_link: 'https://auth.example.supabase.co/verify?token=t' } },
        error: null,
    });
    h.sendAndLog.mockResolvedValue(undefined);
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('VERCEL_BRANCH_URL', '');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('POST /api/auth/forgot-password: the reset link lands only on hosts this site controls', () => {
    it('keeps a production target as sent', async () => {
        expect(await mintedRedirect(`https://${brand.domain}${RECOVERY_PATH}`)).toBe(`https://${brand.domain}${RECOVERY_PATH}`);
        vi.clearAllMocks();
        expect(await mintedRedirect(`https://www.${brand.domain}${RECOVERY_PATH}`)).toBe(`https://www.${brand.domain}${RECOVERY_PATH}`);
    });

    it('never mints a link for a *.vercel.app host this deployment does not own', async () => {
        for (const host of ['attacker.vercel.app', 'nphiring.vercel.app', 'np-hiring-git-main-someone.vercel.app']) {
            vi.clearAllMocks();
            expect(await mintedRedirect(`https://${host}${RECOVERY_PATH}`), host).toBe(FALLBACK);
        }
    });

    it("keeps this deployment's own Vercel hosts, so a preview's reset returns to that preview", async () => {
        vi.stubEnv('VERCEL_URL', 'np-hiring-abc123-team.vercel.app');
        vi.stubEnv('VERCEL_BRANCH_URL', 'np-hiring-git-fix-team.vercel.app');
        for (const host of ['np-hiring-abc123-team.vercel.app', 'np-hiring-git-fix-team.vercel.app']) {
            vi.clearAllMocks();
            expect(await mintedRedirect(`https://${host}${RECOVERY_PATH}`), host).toBe(`https://${host}${RECOVERY_PATH}`);
        }
        // A sibling deployment is still somebody else's host.
        vi.clearAllMocks();
        expect(await mintedRedirect(`https://np-hiring-zzz999-team.vercel.app${RECOVERY_PATH}`)).toBe(FALLBACK);
    });

    it('accepts localhost outside production only', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        expect(await mintedRedirect(`http://localhost:3000${RECOVERY_PATH}`)).toBe(`http://localhost:3000${RECOVERY_PATH}`);
        vi.stubEnv('NODE_ENV', 'production');
        vi.clearAllMocks();
        expect(await mintedRedirect(`http://localhost:3000${RECOVERY_PATH}`)).toBe(FALLBACK);
    });

    it('requires https on a production host', async () => {
        expect(await mintedRedirect(`http://${brand.domain}${RECOVERY_PATH}`)).toBe(FALLBACK);
    });

    it('rejects look-alike, credential and scheme tricks', async () => {
        for (const target of [
            `https://${brand.domain}.evil.example/x`,
            `https://evil.example/?h=${brand.domain}`,
            `https://${brand.domain}@evil.example/x`,
            'https://np-hiring-abc123-team.vercel.app.evil.example/x',
            'javascript:alert(1)',
        ]) {
            vi.clearAllMocks();
            expect(await mintedRedirect(target), target).toBe(FALLBACK);
        }
    });

    it('falls back when no target is sent', async () => {
        expect(await mintedRedirect(undefined)).toBe(FALLBACK);
    });

    it('rebuilds the target, so only the recovery path on an allowed origin reaches Supabase', async () => {
        // A recovery session that lands anywhere else on the origin can be
        // carried on by any same-origin redirect, so the path and query are
        // never taken from the caller.
        expect(await mintedRedirect(`https://${brand.domain}${RECOVERY_PATH}&next=https://evil.example`))
            .toBe(`https://${brand.domain}${RECOVERY_PATH}`);
        for (const target of [
            `https://${brand.domain}/anything?next=https://evil.example`,
            `https://${brand.domain}/auth/confirm/../r/abc`,
            `https://${brand.domain}/`,
        ]) {
            vi.clearAllMocks();
            expect(await mintedRedirect(target), target).toBe(FALLBACK);
        }
    });

    it('rejects a port or embedded credentials on an allowed host', async () => {
        for (const target of [
            `https://${brand.domain}:8443${RECOVERY_PATH}`,
            `https://user:pw@${brand.domain}${RECOVERY_PATH}`,
            `https://evil.example@${brand.domain}${RECOVERY_PATH}`,
        ]) {
            vi.clearAllMocks();
            expect(await mintedRedirect(target), target).toBe(FALLBACK);
        }
    });

    it('reads a deployment host the platform gave with a scheme or in upper case', async () => {
        vi.stubEnv('VERCEL_URL', 'HTTPS://NP-Hiring-ABC123-team.vercel.app');
        expect(await mintedRedirect(`https://np-hiring-abc123-team.vercel.app${RECOVERY_PATH}`))
            .toBe(`https://np-hiring-abc123-team.vercel.app${RECOVERY_PATH}`);
    });
});

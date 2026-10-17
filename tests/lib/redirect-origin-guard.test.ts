/**
 * Sec2: the password-reset `redirectTo` allow-list (lib/auth/reset-redirect.ts).
 *
 * This file used to test a copy of the route's function, written for the
 * fork's old domain, so it passed whatever the route did; the copy also
 * accepted every *.vercel.app host, which anyone can register. It now
 * exercises the real function. The route-level pins, on the redirect the
 * route hands to generateLink, are in tests/api/forgot-password-redirect.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { brand } from '@/config/brand';
import { resetRedirectHosts, safeResetRedirect } from '@/lib/auth/reset-redirect';

const PROD: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
const PREVIEW: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    VERCEL_URL: 'np-hiring-abc123-team.vercel.app',
    VERCEL_BRANCH_URL: 'np-hiring-git-fix-team.vercel.app',
};
const DEV: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
const RECOVERY = '/auth/confirm?type=recovery';

describe('Sec2: password-reset redirect allow-list', () => {
    it('accepts the production hosts over https, rebuilt to the recovery path', () => {
        for (const origin of [`https://${brand.domain}`, `https://www.${brand.domain}`]) {
            expect(safeResetRedirect(`${origin}${RECOVERY}`, PROD)).toBe(`${origin}${RECOVERY}`);
            expect(safeResetRedirect(`${origin}/auth/confirm`, PROD)).toBe(`${origin}${RECOVERY}`);
        }
    });

    it('never passes on the caller\'s path or query', () => {
        expect(safeResetRedirect(`https://${brand.domain}${RECOVERY}&next=https://evil.example`, PROD))
            .toBe(`https://${brand.domain}${RECOVERY}`);
        expect(safeResetRedirect(`https://${brand.domain}/reset`, PROD)).toBeUndefined();
        expect(safeResetRedirect(`https://${brand.domain}/auth/confirm/x`, PROD)).toBeUndefined();
    });

    it('rejects a production host over plain http, with a port, or with credentials', () => {
        expect(safeResetRedirect(`http://${brand.domain}${RECOVERY}`, PROD)).toBeUndefined();
        expect(safeResetRedirect(`https://${brand.domain}:8443${RECOVERY}`, PROD)).toBeUndefined();
        expect(safeResetRedirect(`https://user:pw@${brand.domain}${RECOVERY}`, PROD)).toBeUndefined();
        expect(safeResetRedirect(`https://evil.com@${brand.domain}${RECOVERY}`, PROD)).toBeUndefined();
    });

    it("accepts this deployment's own Vercel hosts and no other *.vercel.app host", () => {
        expect(safeResetRedirect(`https://np-hiring-abc123-team.vercel.app${RECOVERY}`, PREVIEW))
            .toBe(`https://np-hiring-abc123-team.vercel.app${RECOVERY}`);
        expect(safeResetRedirect(`https://np-hiring-git-fix-team.vercel.app${RECOVERY}`, PREVIEW))
            .toBe(`https://np-hiring-git-fix-team.vercel.app${RECOVERY}`);
        expect(safeResetRedirect(`https://np-hiring-zzz999-team.vercel.app${RECOVERY}`, PREVIEW)).toBeUndefined();
        expect(safeResetRedirect(`https://attacker.vercel.app${RECOVERY}`, PREVIEW)).toBeUndefined();
        expect(safeResetRedirect(`https://attacker.vercel.app${RECOVERY}`, PROD)).toBeUndefined();
    });

    it('lists only production plus the deployment hosts the platform set, however they are written', () => {
        expect([...resetRedirectHosts(PROD)].sort()).toEqual([brand.domain, `www.${brand.domain}`].sort());
        expect(resetRedirectHosts(PREVIEW).has('np-hiring-abc123-team.vercel.app')).toBe(true);
        expect(resetRedirectHosts({ ...PROD, VERCEL_URL: '' }).size).toBe(2);
        expect(resetRedirectHosts({ ...PROD, VERCEL_URL: ' HTTPS://NP-Hiring-ABC123-team.vercel.app ' })
            .has('np-hiring-abc123-team.vercel.app')).toBe(true);
        expect(resetRedirectHosts({ ...PROD, VERCEL_URL: 'not a host at all' }).size).toBe(2);
    });

    it('accepts loopback outside production only, on any port', () => {
        expect(safeResetRedirect(`http://localhost:3000${RECOVERY}`, DEV)).toBe(`http://localhost:3000${RECOVERY}`);
        expect(safeResetRedirect(`http://127.0.0.1:3000${RECOVERY}`, DEV)).toBe(`http://127.0.0.1:3000${RECOVERY}`);
        expect(safeResetRedirect(`http://localhost:3000${RECOVERY}`, PROD)).toBeUndefined();
        expect(safeResetRedirect(`http://127.0.0.1:3000${RECOVERY}`, PROD)).toBeUndefined();
    });

    it('rejects look-alike hosts', () => {
        expect(safeResetRedirect(`https://evil.example.com${RECOVERY}`, PREVIEW)).toBeUndefined();
        expect(safeResetRedirect(`https://np-hiring-abc123-team.vercel.app.evil.com${RECOVERY}`, PREVIEW)).toBeUndefined();
        expect(safeResetRedirect(`https://${brand.domain}.evil.com${RECOVERY}`, PROD)).toBeUndefined();
        expect(safeResetRedirect(`https://${brand.domain}.${RECOVERY}`, PROD)).toBeUndefined();
    });

    it('rejects other schemes, malformed and missing input', () => {
        expect(safeResetRedirect('javascript:alert(1)', DEV)).toBeUndefined();
        expect(safeResetRedirect(`ftp://${brand.domain}${RECOVERY}`, PROD)).toBeUndefined();
        expect(safeResetRedirect('not a url', DEV)).toBeUndefined();
        expect(safeResetRedirect(undefined, DEV)).toBeUndefined();
        expect(safeResetRedirect('', DEV)).toBeUndefined();
    });
});

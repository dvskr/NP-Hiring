/**
 * P10 platform-routing-db: regression guards for the seven E2E-verified
 * defects in lib/prisma.ts, the catch-all routes, the job and city sitemaps,
 * the admin layout guard and the loopback CSRF/CSP handling.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import {
    resolvePoolSizing,
    SERVERLESS_POOL_MAX,
    LONG_LIVED_POOL_MAX,
    POOL_MAX_CEILING,
    SERVERLESS_CONNECT_TIMEOUT_MS,
    LONG_LIVED_CONNECT_TIMEOUT_MS,
} from '@/lib/prisma-pool-config';
import { matchIndexNowKeyPath, resolveIndexNowKey } from '@/lib/indexnow-key-file';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { canonicalActiveJobWhere } from '@/lib/canonical-counts';
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';
import { adminReturnPath } from '@/lib/auth/admin-return-path';
import {
    verifyCsrf,
    isLoopbackSameHostOrigin,
    hostnameFromHostHeader,
    isLoopbackHostname,
} from '@/lib/csrf';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ─── #1 pool sizing ───────────────────────────────────────────────────── */

describe('#1 pg pool sizing is runtime-aware', () => {
    it('long-lived server (next start) gets a larger pool and a longer queue', () => {
        const sizing = resolvePoolSizing({});
        expect(sizing.runtime).toBe('long-lived');
        expect(sizing.max).toBe(LONG_LIVED_POOL_MAX);
        expect(sizing.max).toBeGreaterThan(2);
        expect(sizing.connectionTimeoutMillis).toBe(LONG_LIVED_CONNECT_TIMEOUT_MS);
        expect(sizing.allowExitOnIdle).toBe(false);
    });

    it('serverless keeps the small per-instance pool (EMAXCONN guard)', () => {
        const sizing = resolvePoolSizing({ VERCEL: '1' });
        expect(sizing.runtime).toBe('serverless');
        expect(sizing.max).toBe(SERVERLESS_POOL_MAX);
        expect(sizing.connectionTimeoutMillis).toBe(SERVERLESS_CONNECT_TIMEOUT_MS);
        expect(sizing.allowExitOnIdle).toBe(true);
        expect(resolvePoolSizing({ AWS_LAMBDA_FUNCTION_NAME: 'fn' }).max).toBe(SERVERLESS_POOL_MAX);
    });

    it('DATABASE_POOL_MAX / DATABASE_POOL_CONNECT_TIMEOUT_MS override, clamped', () => {
        expect(resolvePoolSizing({ VERCEL: '1', DATABASE_POOL_MAX: '4' }).max).toBe(4);
        expect(resolvePoolSizing({ DATABASE_POOL_MAX: '9999' }).max).toBe(POOL_MAX_CEILING);
        expect(resolvePoolSizing({ DATABASE_POOL_CONNECT_TIMEOUT_MS: '45000' }).connectionTimeoutMillis).toBe(45000);
    });

    it('invalid overrides fall back to the runtime default', () => {
        for (const bad of ['0', '-3', 'abc', '2.5', '', ' ']) {
            expect(resolvePoolSizing({ DATABASE_POOL_MAX: bad }).max).toBe(LONG_LIVED_POOL_MAX);
        }
    });

    it('lib/prisma.ts takes its sizing from the resolver (no hard-coded max: 2)', () => {
        const src = read('lib/prisma.ts');
        expect(src).toContain('resolvePoolSizing(process.env)');
        expect(src).not.toMatch(/max:\s*2\b/);
    });
});

/* ─── #2 / #4 no catch-all routes; IndexNow key from middleware ─────────── */

describe('#2/#4 unmatched URLs reach Next not-found handling', () => {
    it('neither catch-all route exists any more', () => {
        expect(fs.existsSync(path.join(ROOT, 'app/[indexnow]'))).toBe(false);
        expect(fs.existsSync(path.join(ROOT, 'app/[...catchall]'))).toBe(false);
        const topLevelDynamic = fs
            .readdirSync(path.join(ROOT, 'app'))
            .filter((name) => name.startsWith('['));
        expect(topLevelDynamic).toEqual([]);
    });

    it('the branded not-found page still carries an H1 and recovery links', () => {
        const src = read('app/not-found.tsx');
        expect(src).toMatch(/<h1/);
        expect(src).toMatch(/href="\/jobs"|href=\{?['"`]\/jobs/);
    });

    it('IndexNow key path matches only the exact key spellings', () => {
        const env = { INDEXNOW_KEY: 'abcDEF0123456789' };
        expect(matchIndexNowKeyPath('/abcDEF0123456789.txt', env)).toBe('abcDEF0123456789');
        expect(matchIndexNowKeyPath('/abcDEF0123456789', env)).toBe('abcDEF0123456789');
        expect(matchIndexNowKeyPath('/this-route-does-not-exist-e2e', env)).toBeNull();
        expect(matchIndexNowKeyPath('/abcdef0123456789.txt', env)).toBeNull();
        expect(matchIndexNowKeyPath('/abcDEF0123456789.txt', {})).toBeNull();
    });

    it('key env precedence and validation mirror lib/indexnow.ts', () => {
        expect(resolveIndexNowKey({ INDEXNOW_API_KEY: 'fallbackkey1' })).toBe('fallbackkey1');
        expect(resolveIndexNowKey({ INDEXNOW_KEY: 'primarykey1', INDEXNOW_API_KEY: 'other1234' })).toBe('primarykey1');
        expect(resolveIndexNowKey({ INDEXNOW_KEY: 'short' })).toBeNull();
        expect(resolveIndexNowKey({ INDEXNOW_KEY: '../etc/passwd' })).toBeNull();
    });

    it('middleware answers the key before the case-fold redirect', () => {
        const src = read('middleware.ts');
        const keyAt = src.indexOf('matchIndexNowKeyPath(pathname, process.env)');
        const caseFoldAt = src.indexOf('URL Case Normalization');
        expect(keyAt).toBeGreaterThan(-1);
        expect(keyAt).toBeLessThan(caseFoldAt);
    });
});

/* ─── #3 sitemap job filter carries GLOBAL_EXCLUSIONS ──────────────────── */

describe('#3 activeIndexableJobWhere applies the profession quarantine', () => {
    const now = new Date('2026-09-13T00:00:00Z');

    it('excludes every GLOBAL_EXCLUSIONS clause under its own NOT key', () => {
        const where = activeIndexableJobWhere(now);
        expect(where.NOT).toEqual(GLOBAL_EXCLUSIONS);
        expect(where.isPublished).toBe(true);
        expect(Array.isArray(where.OR)).toBe(true);
    });

    it('the first exclusion is the professionClass gate (other_clinical is vetoed)', () => {
        const where = activeIndexableJobWhere(now);
        const clauses = where.NOT as typeof GLOBAL_EXCLUSIONS;
        expect(JSON.stringify(clauses[0])).toContain('professionClass');
        expect(JSON.stringify(clauses[0])).toContain('other_clinical');
    });

    it('a spread with location keys keeps the exclusions', () => {
        const composed = { ...activeIndexableJobWhere(now), state: 'Texas' };
        expect(composed.NOT).toEqual(GLOBAL_EXCLUSIONS);
    });

    it('canonicalActiveJobWhere stays a superset (same exclusions)', () => {
        const canonical = canonicalActiveJobWhere(now);
        expect(canonical.NOT).toEqual(GLOBAL_EXCLUSIONS);
    });
});

/* ─── #5 setting x state sitemap threshold ─────────────────────────────── */

describe('#5 setting x state sitemap entries clear the noindex gate', () => {
    it('template noindexes below 3 jobs', () => {
        expect(read('lib/pseo/setting-state-template.tsx')).toMatch(/stats\.totalJobs < 3/);
    });

    // The gate moved from a count floor to the cron's stored verdict
    // (PseoStats.indexable, written from shouldIndexSettingState); both
    // sitemap routes read the flag through the same raw projection.
    for (const file of ['app/api/sitemaps/cities/[batch]/route.ts', 'app/api/sitemaps/index/route.ts']) {
        it(`${file} gates setting-state rows on the stored indexable verdict`, () => {
            const src = read(file);
            expect(src).toContain('"indexable"');
            expect(src).toContain('if (!row.indexable) continue;');
            expect(src).not.toContain('MIN_SETTING_STATE_SITEMAP_JOBS');
        });
    }
});

/* ─── #6 admin deep links survive the login bounce ─────────────────────── */

describe('#6 admin layout passes a validated return path', () => {
    it('accepts plain admin paths', () => {
        expect(adminReturnPath('/admin')).toBe('/admin');
        expect(adminReturnPath('/admin/users')).toBe('/admin/users');
        expect(adminReturnPath('/admin/jobs/abc-123')).toBe('/admin/jobs/abc-123');
    });

    it('falls back to /admin for anything else', () => {
        for (const bad of [
            null, undefined, '', '/', '/login', '/administrator', '//evil.example/admin',
            '/admin//evil.example', '/admin/../login', '/admin/./x', '/admin\\evil',
            '/admin/users?x=1', '/admin/users#frag', 'https://evil.example/admin', '/admin/ ',
        ]) {
            expect(adminReturnPath(bad)).toBe('/admin');
        }
    });

    it('layout reads the middleware header and passes it to requireAdmin', () => {
        const layout = read('app/admin/layout.tsx');
        expect(layout).toMatch(/requireAdmin\(returnTo\)/);
        expect(layout).toContain('REQUEST_PATHNAME_HEADER');
        const mw = read('middleware.ts');
        // always overwritten, never appended, before updateSession forwards it
        const setAt = mw.indexOf('request.headers.set(REQUEST_PATHNAME_HEADER, pathname)');
        expect(setAt).toBeGreaterThan(-1);
        expect(setAt).toBeLessThan(mw.indexOf('await updateSession(request)'));
    });
});

/* ─── #7 loopback origins ──────────────────────────────────────────────── */

function fakeRequest(opts: { origin?: string; host: string; nextOrigin?: string }): NextRequest {
    const headers = new Headers();
    if (opts.origin) headers.set('origin', opts.origin);
    headers.set('host', opts.host);
    return {
        headers,
        method: 'POST',
        nextUrl: new URL(`${opts.nextOrigin ?? 'http://localhost:3000'}/api/jobs/filter-counts`),
    } as unknown as NextRequest;
}

describe('#7 loopback origin handling', () => {
    it('host header parsing and loopback detection are exact', () => {
        expect(hostnameFromHostHeader('127.0.0.1:3000')).toBe('127.0.0.1');
        expect(hostnameFromHostHeader('[::1]:3000')).toBe('[::1]');
        expect(hostnameFromHostHeader('LOCALHOST')).toBe('localhost');
        expect(isLoopbackHostname('127.0.0.1')).toBe(true);
        expect(isLoopbackHostname('[::1]')).toBe(true);
        expect(isLoopbackHostname('localhost.attacker.example')).toBe(false);
        expect(isLoopbackHostname(hostnameFromHostHeader('evil-localhost.com'))).toBe(false);
    });

    it('a browser on http://127.0.0.1:3000 passes CSRF when served on that host', () => {
        expect(verifyCsrf(fakeRequest({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' }))).toBeNull();
        expect(verifyCsrf(fakeRequest({ origin: 'http://[::1]:3000', host: '[::1]:3000' }))).toBeNull();
    });

    it('fails closed when the loopback origin does not match the served host', () => {
        // production host: a loopback Origin must still be rejected
        const prod = verifyCsrf(fakeRequest({
            origin: 'http://127.0.0.1:3000', host: 'nphiring.com', nextOrigin: 'https://nphiring.com',
        }));
        expect(prod?.status).toBe(403);
        // different loopback port
        expect(verifyCsrf(fakeRequest({ origin: 'http://127.0.0.1:4000', host: '127.0.0.1:3000' }))?.status).toBe(403);
        // non-loopback origin claiming a loopback host
        expect(verifyCsrf(fakeRequest({ origin: 'http://evil.example', host: 'evil.example' }))?.status).toBe(403);
        expect(isLoopbackSameHostOrigin('http://127.0.0.1:3000/path', '127.0.0.1:3000')).toBe(false);
        expect(isLoopbackSameHostOrigin('file://127.0.0.1', '127.0.0.1')).toBe(false);
        expect(isLoopbackSameHostOrigin('http://127.0.0.1:3000', null)).toBe(false);
    });

    it('middleware CSP loopback check uses the exact hostname helper', () => {
        const mw = read('middleware.ts');
        expect(mw).toContain("isLoopbackHostname(hostnameFromHostHeader(request.headers.get('host')))");
        expect(mw).not.toMatch(/get\('host'\)\?\.includes\('localhost'\)/);
    });
});

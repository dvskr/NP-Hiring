/**
 * Regression (audit B98) — CSRF protection covered only 6 of ~100
 * state-changing cookie-authenticated API routes. Fix: middleware.ts now
 * calls enforceApiCsrf() for every POST/PUT/PATCH/DELETE under /api/*,
 * so every mutation route (and any future one) gets Origin/Referer
 * verification by default.
 *
 * These tests lock in:
 *  - cross-origin mutations against previously-unprotected routes → 403
 *  - same-origin browser traffic (canonical + preview self-origin) → pass
 *  - extension JWT bearer requests → pass (dual cookie/JWT auth must work)
 *  - server-to-server callers with no Origin/Referer → pass
 *  - signature-verified endpoints (/api/webhooks/*, /api/inngest) → exempt
 *  - middleware.ts actually wires the gate (source pin)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { enforceApiCsrf } from '@/lib/csrf';
import { brand } from '@/config/brand';

const EVIL_ORIGIN = 'https://evil.example';

/** Sample of mutation routes that had NO per-route verifyCsrf call before B98. */
const PREVIOUSLY_UNPROTECTED_ROUTES = [
    '/api/saved-jobs',
    '/api/applications',
    '/api/profile/resume',
    '/api/employer/settings',
    '/api/job-alerts',
];

function makeRequest(
    pathname: string,
    opts: {
        method?: string;
        origin?: string;
        referer?: string;
        authorization?: string;
        baseUrl?: string;
    } = {}
): NextRequest {
    const base = opts.baseUrl ?? brand.baseUrl;
    const headers = new Headers();
    if (opts.origin) headers.set('origin', opts.origin);
    if (opts.referer) headers.set('referer', opts.referer);
    if (opts.authorization) headers.set('authorization', opts.authorization);
    return new NextRequest(`${base}${pathname}`, {
        method: opts.method ?? 'POST',
        headers,
    });
}

describe('enforceApiCsrf — cross-origin mutations are rejected (B98)', () => {
    for (const route of PREVIOUSLY_UNPROTECTED_ROUTES) {
        it(`blocks a cross-origin POST to ${route}`, () => {
            const res = enforceApiCsrf(makeRequest(route, { origin: EVIL_ORIGIN }));
            expect(res).not.toBeNull();
            expect(res!.status).toBe(403);
        });
    }

    it('blocks cross-origin PUT/PATCH/DELETE as well', () => {
        for (const method of ['PUT', 'PATCH', 'DELETE']) {
            const res = enforceApiCsrf(
                makeRequest('/api/profile/resume', { method, origin: EVIL_ORIGIN })
            );
            expect(res?.status).toBe(403);
        }
    });

    it('blocks a cross-origin Referer when Origin is absent', () => {
        const res = enforceApiCsrf(
            makeRequest('/api/saved-jobs', { referer: `${EVIL_ORIGIN}/attack.html` })
        );
        expect(res?.status).toBe(403);
    });
});

describe('enforceApiCsrf — legitimate flows still pass', () => {
    it('allows same-origin POST (canonical domain)', () => {
        const res = enforceApiCsrf(
            makeRequest('/api/saved-jobs', { origin: brand.baseUrl })
        );
        expect(res).toBeNull();
    });

    it('allows self-origin POST on a preview deployment not in the static allowlist', () => {
        const preview = 'https://np-hiring-git-feature-x.vercel.app';
        const res = enforceApiCsrf(
            makeRequest('/api/saved-jobs', { origin: preview, baseUrl: preview })
        );
        expect(res).toBeNull();
    });

    it('allows extension JWT bearer requests regardless of Origin (dual auth)', () => {
        const res = enforceApiCsrf(
            makeRequest('/api/autofill/generate-answer', {
                origin: 'chrome-extension://abcdefghijklmnop',
                authorization: 'Bearer extension-jwt-token',
            })
        );
        expect(res).toBeNull();
    });

    it('allows server-to-server callers with no Origin and no Referer', () => {
        // Vercel cron, Stripe CLI, RFC 8058 List-Unsubscribe POSTs, curl.
        const res = enforceApiCsrf(makeRequest('/api/one-click-unsubscribe', {}));
        expect(res).toBeNull();
    });

    it('ignores non-mutation methods (GET / HEAD / OPTIONS preflight)', () => {
        for (const method of ['GET', 'HEAD', 'OPTIONS']) {
            const res = enforceApiCsrf(
                makeRequest('/api/saved-jobs', { method, origin: EVIL_ORIGIN })
            );
            expect(res).toBeNull();
        }
    });

    it('ignores non-API paths', () => {
        const res = enforceApiCsrf(makeRequest('/jobs', { origin: EVIL_ORIGIN }));
        expect(res).toBeNull();
    });
});

describe('enforceApiCsrf — signature-verified endpoints are exempt', () => {
    it('exempts /api/webhooks/* (Stripe/Resend signatures)', () => {
        for (const route of ['/api/webhooks/stripe', '/api/webhooks/resend']) {
            const res = enforceApiCsrf(makeRequest(route, { origin: EVIL_ORIGIN }));
            expect(res).toBeNull();
        }
    });

    it('exempts /api/inngest (Inngest request signing)', () => {
        const res = enforceApiCsrf(
            makeRequest('/api/inngest', { method: 'PUT', origin: EVIL_ORIGIN })
        );
        expect(res).toBeNull();
    });

    it('does NOT exempt lookalike prefixes (/api/inngestx)', () => {
        const res = enforceApiCsrf(makeRequest('/api/inngestx', { origin: EVIL_ORIGIN }));
        expect(res?.status).toBe(403);
    });

    it('does NOT exempt cron routes — admin manual triggers stay protected', () => {
        const res = enforceApiCsrf(
            makeRequest('/api/cron/ingest', { origin: EVIL_ORIGIN })
        );
        expect(res?.status).toBe(403);
    });
});

describe('middleware wiring pin', () => {
    it('middleware.ts imports and invokes enforceApiCsrf before other handling', () => {
        const source = readFileSync(
            path.join(process.cwd(), 'middleware.ts'),
            'utf-8'
        );
        expect(source).toMatch(/import\s*\{\s*enforceApiCsrf\s*\}\s*from\s*'@\/lib\/csrf'/);
        expect(source).toMatch(/enforceApiCsrf\(request\)/);
    });
});

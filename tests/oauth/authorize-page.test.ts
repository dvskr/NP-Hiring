/**
 * GET /oauth/authorize (app/oauth/authorize/page.tsx, design 2.5), rendered
 * for real with the session, the profile, the rate limit and the database
 * mocked.
 *
 * Pinned, in order: a client or redirect URI that cannot be verified gets
 * our own error page and never a redirect; every later error goes back to
 * the client with error, state and iss (before any sign-in check); a valid
 * request from a signed-out visitor goes to /login and returns; an employer,
 * admin, deleted or missing profile gets the candidate-accounts error page;
 * a candidate gets the consent card with the exact design copy, no dashes,
 * and a consent token for exactly what the card shows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => {
    /** What the mocked next/navigation redirect() throws, like the real one. */
    class RedirectSignal extends Error {
        constructor(readonly url: string) {
            super(`redirect ${url}`);
        }
    }
    return {
        RedirectSignal,
        getUser: vi.fn(),
        ensureProfile: vi.fn(),
        checkRateLimit: vi.fn(),
        headers: new Map<string, string>(),
        consentProps: [] as Array<Record<string, unknown>>,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
});

vi.mock('next/navigation', () => ({
    redirect: (url: string) => {
        throw new h.RedirectSignal(url);
    },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers(Object.fromEntries(h.headers)) }));
vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return { default: ({ href, children, style }: { href: string; children?: React.ReactNode; style?: React.CSSProperties }) => createElement('a', { href, style }, children) };
});
vi.mock('@/components/auth/AuthLayout', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return { default: ({ children }: { children?: React.ReactNode }) => createElement('main', { 'data-auth-layout': '' }, children) };
});
vi.mock('@/components/oauth/ConsentForm', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/oauth/ConsentForm')>();
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return {
        default: (props: React.ComponentProps<typeof actual.default>) => {
            h.consentProps.push(props as unknown as Record<string, unknown>);
            return createElement(actual.default, props);
        },
    };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })) }));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfileFromAuth: h.ensureProfile }));
vi.mock('@/lib/prisma', async () => ({ prisma: (await import('./support/fake-prisma')).fakePrisma }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock('@/lib/logger', () => ({ logger: h.logger }));

import AuthorizePage, { dynamic, metadata } from '@/app/oauth/authorize/page';
import { safeInternalPath } from '@/lib/auth/safe-redirect';
import { clearClientMetadataCache } from '@/lib/oauth/cimd';
import { verifyConsentToken } from '@/lib/oauth/consent-csrf';
import type { AuthorizeParams } from '@/lib/oauth/authorize-params';
import { addClient, resetDb } from './support/fake-prisma';
import { CHALLENGE, CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, CLAUDE_RESOURCE, DCR_CLIENT_ID, ISSUER, dashesIn, useOAuthEnv } from './support/fixtures';

const USER = { id: 'user-1', email: 'np@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const CANDIDATE = { id: 'p1', supabaseId: USER.id, email: USER.email, role: 'job_seeker', deletedAt: null };
const LOOPBACK_REGISTERED = 'http://127.0.0.1/callback';

type Query = Record<string, string | string[] | undefined>;

const VALID: Query = {
    response_type: 'code',
    client_id: DCR_CLIENT_ID,
    redirect_uri: CLAUDE_REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    resource: CLAUDE_RESOURCE,
    scope: 'profile:read applications:read',
    state: 'xyz 1',
};

type Visit = { redirect: string; html?: undefined } | { html: string; redirect?: undefined };

async function visit(query: Query): Promise<Visit> {
    try {
        const element = await AuthorizePage({ searchParams: Promise.resolve(query) });
        return { html: renderToStaticMarkup(element) };
    } catch (error) {
        if (error instanceof h.RedirectSignal) return { redirect: error.url };
        throw error;
    }
}

const text = (html: string): string =>
    html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function expectErrorPage(result: Visit, sentence: string): void {
    expect(result.redirect, 'must not redirect').toBeUndefined();
    const page = text(result.html ?? '');
    expect(page).toContain('This app could not connect');
    expect(page).toContain(sentence);
    expect(page).toContain('Back to NP Hiring');
    expect(result.html).toContain('href="/"');
    expect(h.consentProps).toHaveLength(0);
}

/** The client redirect: the URL and its query, checked to carry iss. */
function expectClientRedirect(result: Visit, error: string, redirectUri = CLAUDE_REDIRECT): URLSearchParams {
    expect(result.html, 'must redirect').toBeUndefined();
    const url = String(result.redirect);
    expect(url.startsWith(`${redirectUri}${redirectUri.includes('?') ? '&' : '?'}error=${error}`), url).toBe(true);
    const query = new URL(url).searchParams;
    expect(query.get('error')).toBe(error);
    expect(query.get('iss')).toBe(ISSUER);
    return query;
}

beforeEach(() => {
    useOAuthEnv();
    resetDb();
    clearClientMetadataCache();
    addClient(DCR_CLIENT_ID, { clientName: 'Claude', redirectUris: [CLAUDE_REDIRECT, LOOPBACK_REGISTERED, 'https://claude.ai/cb?tenant=1'] });
    h.consentProps.length = 0;
    h.headers.clear();
    h.headers.set('x-forwarded-for', '192.0.2.44');
    h.getUser.mockReset().mockResolvedValue({ data: { user: USER }, error: null });
    h.ensureProfile.mockReset().mockResolvedValue(CANDIDATE);
    h.checkRateLimit.mockReset().mockResolvedValue({ success: true, reset: Date.now() + 60_000, remaining: 29 });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('page settings', () => {
    it('is noindex and rendered per request', () => {
        expect(metadata.robots).toEqual({ index: false, follow: false });
        expect(dynamic).toBe('force-dynamic');
    });
});

describe('steps 1 and 2: an unverified client or redirect URI gets our own error page, never a redirect', () => {
    it('an unknown, missing or repeated client_id, even with every other parameter wrong', async () => {
        for (const client_id of ['dcr_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'nonsense', undefined, [DCR_CLIENT_ID, DCR_CLIENT_ID]]) {
            h.consentProps.length = 0;
            expectErrorPage(await visit({ ...VALID, client_id, response_type: 'token', resource: 'https://evil.example' }), "The app's sign-in link is not valid.");
        }
    });

    it('a metadata document URL on a host outside the allowlist, fetched never', async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        expectErrorPage(await visit({ ...VALID, client_id: 'https://evil.example/client.json' }), "The app's sign-in link is not valid.");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('a redirect URI that is missing, unregistered, a near miss, or repeated', async () => {
        for (const redirect_uri of [
            undefined,
            'https://evil.example/cb',
            `${CLAUDE_REDIRECT}/`,
            `${CLAUDE_REDIRECT}#frag`,
            'https://127.0.0.1:5000/callback',
            [CLAUDE_REDIRECT, CLAUDE_REDIRECT],
        ]) {
            h.consentProps.length = 0;
            expectErrorPage(await visit({ ...VALID, redirect_uri, response_type: 'token' }), "The app's sign-in link is not valid.");
        }
    });
});

describe('steps 3 to 8: later errors go back to the app with error, state and iss', () => {
    const cases: Array<[string, Query, string]> = [
        ['response_type missing', { response_type: undefined }, 'invalid_request'],
        ['response_type token', { response_type: 'token' }, 'unsupported_response_type'],
        ['code_challenge missing', { code_challenge: undefined }, 'invalid_request'],
        ['code_challenge too short', { code_challenge: 'abc' }, 'invalid_request'],
        ['code_challenge_method missing', { code_challenge_method: undefined }, 'invalid_request'],
        ['code_challenge_method plain', { code_challenge_method: 'plain' }, 'invalid_request'],
        ['resource missing', { resource: undefined }, 'invalid_target'],
        ['resource another site', { resource: 'https://evil.example/mcp' }, 'invalid_target'],
        ['resource the site root', { resource: 'https://nphiring.com' }, 'invalid_target'],
        ['resource repeated', { resource: [CLAUDE_RESOURCE, 'https://nphiring.com/mcp/chatgpt'] }, 'invalid_target'],
        ['an unknown scope', { scope: 'profile:read admin' }, 'invalid_scope'],
        ['scope repeated', { scope: ['profile:read', 'applications:read'] }, 'invalid_request'],
    ];
    for (const [name, change, error] of cases) {
        it(`${name}: ${error}`, async () => {
            const query = expectClientRedirect(await visit({ ...VALID, ...change }), error);
            expect(query.get('state')).toBe('xyz 1');
            expect(query.get('error_description')).toBeTruthy();
            expect(h.consentProps).toHaveLength(0);
        });
    }

    it('a state over 1,024 characters: invalid_request, and that state is not echoed', async () => {
        const query = expectClientRedirect(await visit({ ...VALID, state: 's'.repeat(1025) }), 'invalid_request');
        expect(query.has('state')).toBe(false);
    });

    it('a request URL over 2,000 characters: invalid_request', async () => {
        const query = expectClientRedirect(await visit({ ...VALID, state: 's'.repeat(1000), extra: 'e'.repeat(900) }), 'invalid_request');
        expect(query.get('state')).toBe('s'.repeat(1000));
    });

    it('keeps the query the redirect URI already has', async () => {
        const result = await visit({ ...VALID, redirect_uri: 'https://claude.ai/cb?tenant=1', response_type: 'token' });
        expect(String(result.redirect).startsWith('https://claude.ai/cb?tenant=1&error=unsupported_response_type')).toBe(true);
    });

    it('is checked before the session: a signed-out visitor with a bad request goes back to the app, not to sign in', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        expectClientRedirect(await visit({ ...VALID, response_type: 'token' }), 'unsupported_response_type');
    });

    it('without a signing secret: temporarily_unavailable back to the app', async () => {
        delete process.env.MCP_OAUTH_SIGNING_SECRET;
        const query = expectClientRedirect(await visit(VALID), 'temporarily_unavailable');
        expect(query.get('state')).toBe('xyz 1');
    });
});

describe('step 9: a signed-out visitor signs in and returns', () => {
    it('goes to /login with the authorize path and query as next', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const result = await visit({ ...VALID, prompt: 'consent' });
        expect(String(result.redirect).startsWith('/login?next=')).toBe(true);
        const next = new URL(String(result.redirect), 'https://nphiring.com').searchParams.get('next') ?? '';
        expect(next.startsWith('/oauth/authorize?')).toBe(true);
        expect(safeInternalPath(next, '/dashboard')).toBe(next);
        const returned = new URL(next, 'https://nphiring.com').searchParams;
        for (const [key, value] of Object.entries({ ...VALID, prompt: 'consent' })) expect(returned.get(key), key).toBe(value);
        expect(h.ensureProfile).not.toHaveBeenCalled();
    });
});

describe('step 10: candidate accounts only', () => {
    it('an employer, an admin, a deleted profile or no profile gets the error page, never a code', async () => {
        for (const profile of [
            { ...CANDIDATE, role: 'employer' },
            { ...CANDIDATE, role: 'admin' },
            { ...CANDIDATE, deletedAt: new Date() },
            null,
        ]) {
            h.consentProps.length = 0;
            h.ensureProfile.mockResolvedValueOnce(profile);
            expectErrorPage(await visit(VALID), 'NP Hiring apps work with candidate accounts.');
        }
    });
});

describe('step 11: the consent card', () => {
    it('shows the design 2.5 copy for the requested scopes only', async () => {
        const result = await visit(VALID);
        const page = text(result.html ?? '');
        expect(page).toContain('Allow Claude to use your NP Hiring account?');
        expect(page).toContain('Claude at claude.ai');
        expect(page).toContain('Signed in as np@example.com');
        expect(page).toContain('Use a different account');
        expect(page).toContain('See your name, headline and whether a resume is on your profile');
        expect(page).toContain('See your applications and saved jobs');
        expect(page).not.toContain('Submit, track and withdraw');
        expect(page).toContain('You can remove access at any time in Settings, under Account.');
        expect(result.html).toContain('href="/privacy#ai-apps"');
        expect(result.html).toContain('href="/terms"');
        expect(page).toContain('Privacy Policy');
        expect(page).toContain('Terms');
        expect(page).toMatch(/Cancel\s+Allow/);
        expect(dashesIn(page)).toEqual([]);
        expect(result.html).toContain('#BE185D');
    });

    it('an empty scope, or only offline_access, asks for all three', async () => {
        for (const scope of [undefined, '', 'offline_access']) {
            h.consentProps.length = 0;
            const page = text((await visit({ ...VALID, scope })).html ?? '');
            expect(page, String(scope)).toContain('Submit, track and withdraw applications and save jobs when you ask');
            expect(page).toContain('See your applications and saved jobs');
            expect(page).toContain('See your name, headline and whether a resume is on your profile');
        }
    });

    it('a loopback client on any port reads "at this computer"', async () => {
        const page = text((await visit({ ...VALID, redirect_uri: 'http://127.0.0.1:53682/callback' })).html ?? '');
        expect(page).toContain('Claude at this computer');
    });

    it('hands the form a consent token for this user and exactly these parameters', async () => {
        await visit(VALID);
        expect(h.consentProps).toHaveLength(1);
        const props = h.consentProps[0];
        const params = props.params as AuthorizeParams;
        expect(params).toEqual({
            response_type: 'code',
            client_id: DCR_CLIENT_ID,
            redirect_uri: CLAUDE_REDIRECT,
            code_challenge: CHALLENGE,
            code_challenge_method: 'S256',
            resource: CLAUDE_RESOURCE,
            scope: 'profile:read applications:read',
            state: 'xyz 1',
        });
        expect(verifyConsentToken(props.csrf, USER.id, params)).toBe(true);
        expect(verifyConsentToken(props.csrf, 'user-2', params)).toBe(false);
    });

    it('resolves a metadata document client, naming it from its document', async () => {
        const doc = { client_id: CLAUDE_CLIENT_ID, client_name: 'Claude', redirect_uris: [CLAUDE_REDIRECT] };
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify(doc), { status: 200 }));
        vi.stubGlobal('fetch', fetchSpy);
        const page = text((await visit({ ...VALID, client_id: CLAUDE_CLIENT_ID })).html ?? '');
        expect(page).toContain('Allow Claude to use your NP Hiring account?');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('writes nothing: the grant is only created by the decision', async () => {
        const { fakePrisma } = await import('./support/fake-prisma');
        await visit(VALID);
        expect(fakePrisma.oauthGrant.create).not.toHaveBeenCalled();
        expect(fakePrisma.oauthAuthorizationCode.create).not.toHaveBeenCalled();
    });
});

describe('rate limit', () => {
    it('counts per signed-in user, 30 a minute, and shows the error page past it', async () => {
        await visit(VALID);
        expect(h.checkRateLimit).toHaveBeenCalledWith(`oauth:authorize:user:${USER.id}`, { limit: 30, windowSeconds: 60 });

        h.checkRateLimit.mockResolvedValue({ success: false, reset: Date.now() + 10_000, remaining: 0 });
        h.consentProps.length = 0;
        expectErrorPage(await visit(VALID), 'There have been too many attempts. Try again in a minute.');
    });

    it('counts per IP before sign-in', async () => {
        h.getUser.mockResolvedValue({ data: { user: null }, error: null });
        await visit(VALID);
        expect(h.checkRateLimit).toHaveBeenCalledWith('oauth:authorize:ip:192.0.2.44', { limit: 30, windowSeconds: 60 });
    });
});

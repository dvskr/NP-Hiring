/**
 * P10 auth-account-security: session-shaped defects.
 *
 *  - A malformed sb-<ref>-auth-token cookie crashed updateSession with a
 *    plain-text 500 on every page and API route.
 *  - /reset-password let any signed-in session set a new password without
 *    a recovery link or the current password.
 *  - /auth/confirm?code=<garbage> reported "Your email is confirmed" and
 *    redirected to /login?confirmed=true; the page had no h1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { stringToBase64URL } from '@supabase/ssr';

const createServerClientMock = vi.fn();
vi.mock('@supabase/ssr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/ssr')>();
  return { ...actual, createServerClient: (...args: unknown[]) => createServerClientMock(...args) };
});

const REF = 'sb-ytpmrlpnpbdylujbtgij-auth-token';
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('findMalformedAuthCookieNames', () => {
  it('flags an undecodable base64 session cookie together with its chunks', async () => {
    const { findMalformedAuthCookieNames } = await import('@/lib/supabase/middleware');
    const names = findMalformedAuthCookieNames([
      { name: REF, value: 'base64-eyJub3QiOiJqc29uIn0.garbage' },
      { name: `${REF}.0`, value: 'garbage' },
      { name: 'unrelated', value: 'base64-!!!' },
    ]);
    expect(names.sort()).toEqual([REF, `${REF}.0`].sort());
  });

  it('accepts valid unchunked, chunked, raw JSON and code-verifier cookies', async () => {
    const { findMalformedAuthCookieNames } = await import('@/lib/supabase/middleware');
    const session = `base64-${stringToBase64URL(JSON.stringify({ access_token: 'a', refresh_token: 'b' }))}`;
    const half = Math.floor(session.length / 2);
    expect(findMalformedAuthCookieNames([{ name: REF, value: session }])).toEqual([]);
    expect(findMalformedAuthCookieNames([
      { name: `${REF}.0`, value: session.slice(0, half) },
      { name: `${REF}.1`, value: session.slice(half) },
    ])).toEqual([]);
    expect(findMalformedAuthCookieNames([{ name: REF, value: '{"access_token":"a"}' }])).toEqual([]);
    expect(findMalformedAuthCookieNames([
      { name: `${REF}-code-verifier`, value: `base64-${stringToBase64URL(JSON.stringify('verifier/PASSWORD_RECOVERY'))}` },
    ])).toEqual([]);
  });

  it('flags a base64 payload that decodes to something other than JSON', async () => {
    const { findMalformedAuthCookieNames } = await import('@/lib/supabase/middleware');
    const value = `base64-${stringToBase64URL('not json at all')}`;
    expect(findMalformedAuthCookieNames([{ name: REF, value }])).toEqual([REF]);
  });
});

describe('updateSession with a malformed auth cookie', () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
  });

  it('does not throw: strips the cookie from the forwarded request and expires it', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware');
    const request = new NextRequest('http://localhost:3000/api/dashboard', {
      headers: { cookie: `${REF}=base64-eyJub3QiOiJqc29uIn0.garbage; ${REF}.0=garbage; keep=1` },
    });
    const response = await updateSession(request);
    expect(response.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(request.cookies.has(REF)).toBe(false);
    expect(request.cookies.has(`${REF}.0`)).toBe(false);
    expect(request.cookies.get('keep')?.value).toBe('1');
    const cleared = response.cookies.getAll().filter((c) => c.name.startsWith(REF));
    expect(cleared.map((c) => c.name).sort()).toEqual([REF, `${REF}.0`].sort());
    for (const c of cleared) expect(c.maxAge).toBe(0);
    // The forwarded request (what Route Handlers read) no longer carries it.
    expect(response.headers.get('x-middleware-request-cookie') ?? '').not.toContain(REF);
  });

  it('a throwing session refresh does not become a 500', async () => {
    createServerClientMock.mockReturnValue({ auth: { getUser: vi.fn().mockRejectedValue(new Error('boom')) } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { updateSession } = await import('@/lib/supabase/middleware');
    const request = new NextRequest('http://localhost:3000/');
    const response = await updateSession(request);
    expect(response.status).toBe(200);
    warn.mockRestore();
  });
});

describe('getPasswordChangeMode (/reset-password)', () => {
  const now = 1_789_263_730;

  it('a fresh emailed-link session (amr otp, as the dev project issues for recovery links) may reset directly', async () => {
    const { getPasswordChangeMode } = await import('@/app/reset-password/recovery-session');
    expect(getPasswordChangeMode([{ method: 'otp', timestamp: now - 120 }], now)).toBe('recovery');
    expect(getPasswordChangeMode([{ method: 'recovery', timestamp: now - 10 }], now)).toBe('recovery');
  });

  it('password or OAuth sessions, stale link sessions and missing claims must re-authenticate', async () => {
    const { getPasswordChangeMode } = await import('@/app/reset-password/recovery-session');
    expect(getPasswordChangeMode([{ method: 'password', timestamp: now - 5 }], now)).toBe('reauthenticate');
    expect(getPasswordChangeMode([{ method: 'oauth', timestamp: now - 5 }], now)).toBe('reauthenticate');
    expect(getPasswordChangeMode([{ method: 'otp', timestamp: now - 3601 }], now)).toBe('reauthenticate');
    expect(getPasswordChangeMode([{ method: 'otp', timestamp: now + 3600 }], now)).toBe('reauthenticate');
    expect(getPasswordChangeMode([], now)).toBe('reauthenticate');
    expect(getPasswordChangeMode(undefined, now)).toBe('reauthenticate');
  });

  it('the page gates updateUser behind the mode check and re-authenticates with the current password', () => {
    const src = read('app/reset-password/page.tsx');
    const gate = src.indexOf("submitMode === 'reauthenticate'");
    const reauth = src.indexOf('signInWithPassword');
    const update = src.indexOf('updateUser({ password })');
    expect(gate).toBeGreaterThan(-1);
    expect(reauth).toBeGreaterThan(gate);
    expect(update).toBeGreaterThan(reauth);
    expect(src).toContain('id="reset-current"');
  });
});

describe('/auth/confirm code exchange failures', () => {
  it('garbage codes and server rejections are invalid; only a well formed code with a missing verifier is the other-browser case', async () => {
    const { classifyCodeExchangeFailure } = await import('@/app/auth/confirm/confirm-state');
    const missing = { name: 'AuthPKCECodeVerifierMissingError', code: 'pkce_code_verifier_not_found' };
    expect(classifyCodeExchangeFailure('this-is-not-a-real-code', missing)).toBe('invalid');
    expect(classifyCodeExchangeFailure('3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f', missing)).toBe('other_browser');
    expect(classifyCodeExchangeFailure('3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f', { name: 'AuthApiError', code: 'flow_state_not_found' })).toBe('invalid');
    expect(classifyCodeExchangeFailure('3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f', null)).toBe('invalid');
  });

  it('never claims confirmation on a failed exchange and renders an h1 in every state', async () => {
    const { confirmHeading } = await import('@/app/auth/confirm/confirm-state');
    for (const s of ['loading', 'success', 'error', 'expired'] as const) {
      expect(confirmHeading(s)).toMatch(/\S/);
      expect(confirmHeading(s)).not.toMatch(/[–—]/);
    }
    const src = read('app/auth/confirm/page.tsx');
    expect(src).not.toContain('Your email is confirmed');
    expect(src).not.toContain('confirmed=true');
    expect(src).toMatch(/<h1[\s\S]*?\{confirmHeading\(status\)\}[\s\S]*?<\/h1>/);
  });
});

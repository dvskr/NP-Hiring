/**
 * Regression (F26, audit high) — the signup path discarded apply intent:
 * ApplyButton sent visitors to /signup?redirectTo=<job path> but SignUpForm
 * never read it — autoconfirm signups were pushed to hardcoded destinations,
 * the confirm-required flow hardcoded router.push('/dashboard') in
 * /auth/confirm, and both auth forms rendered <GoogleSignInButton /> without
 * the redirectTo prop so OAuth always won with '/dashboard'. ApplyButton
 * additionally built returnUrl from pathname only, dropping ?apply=1.
 *
 * These tests pin the end-to-end redirectTo thread:
 *   1. SignUpForm reads + validates redirectTo, appends it to emailRedirectTo
 *      as /auth/confirm?next=..., uses it for the has-session push, and
 *      passes it into GoogleSignInButton;
 *   2. LoginContent passes redirectTo into GoogleSignInButton;
 *   3. GoogleSignInButton URL-encodes the next value;
 *   4. /auth/confirm honors ?next= via safeInternalPath (no hardcoded
 *      /dashboard push on the success paths);
 *   5. ApplyButton builds returnUrl from pathname + search and forces
 *      apply=1 for in-platform jobs;
 *   6. safeInternalPath behavior for the exact values threaded here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { safeInternalPath } from '@/lib/auth/safe-redirect';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SIGNUP_FORM = 'components/auth/SignUpForm.tsx';
const LOGIN_CONTENT = 'components/auth/LoginContent.tsx';
const GOOGLE_BUTTON = 'components/auth/GoogleSignInButton.tsx';
const CONFIRM_PAGE = 'app/auth/confirm/page.tsx';
const APPLY_BUTTON = 'components/ApplyButton.tsx';

describe('F26 — SignUpForm threads redirectTo end-to-end', () => {
  it('reads and validates redirectTo/next from the URL via safeInternalPath', () => {
    const src = read(SIGNUP_FORM);
    expect(src).toMatch(/import\s*\{[^}]*safeInternalPath[^}]*\}\s*from\s*'@\/lib\/auth\/safe-redirect'/);
    expect(src).toMatch(/safeInternalPath\(\s*searchParams\.get\('redirectTo'\)\s*\|\|\s*searchParams\.get\('next'\)/);
  });

  it('appends the target to emailRedirectTo as /auth/confirm?next=<encoded>', () => {
    const src = read(SIGNUP_FORM);
    // eslint-disable-next-line no-template-curly-in-string
    expect(src).toContain('/auth/confirm?next=${encodeURIComponent(redirectTo)}');
    // The bare (no-redirect) variant must survive as the fallback.
    // eslint-disable-next-line no-template-curly-in-string
    expect(src).toContain('`${window.location.origin}/auth/confirm`');
  });

  it('uses redirectTo for the has-session push instead of hardcoded destinations', () => {
    const src = read(SIGNUP_FORM);
    expect(src).toMatch(/router\.push\(\s*redirectTo\s*\?\?/);
  });

  it('passes redirectTo into GoogleSignInButton', () => {
    const src = read(SIGNUP_FORM);
    expect(src).toMatch(/<GoogleSignInButton\s+mode="signup"\s+redirectTo=\{redirectTo\}/);
  });
});

describe('F26 — LoginContent passes redirectTo into GoogleSignInButton', () => {
  it('validates the URL param and wires the prop', () => {
    const src = read(LOGIN_CONTENT);
    expect(src).toMatch(/safeInternalPath\(\s*searchParams\.get\('redirectTo'\)\s*\|\|\s*searchParams\.get\('next'\)/);
    expect(src).toMatch(/<GoogleSignInButton\s+mode="login"\s+redirectTo=\{redirectTo\}/);
  });
});

describe('F26 — GoogleSignInButton encodes the next value', () => {
  it('a target carrying its own query (?apply=1) survives as one next param', () => {
    const src = read(GOOGLE_BUTTON);
    // eslint-disable-next-line no-template-curly-in-string
    expect(src).toContain('?next=${encodeURIComponent(redirectTo)}');
    // The unencoded interpolation must not come back.
    // eslint-disable-next-line no-template-curly-in-string
    expect(src).not.toContain('?next=${redirectTo}');
  });
});

describe('F26 — /auth/confirm honors ?next= via safeInternalPath', () => {
  it('derives nextPath from the query and pushes it on both success paths', () => {
    const src = read(CONFIRM_PAGE);
    expect(src).toMatch(/import\s*\{[^}]*safeInternalPath[^}]*\}\s*from\s*'@\/lib\/auth\/safe-redirect'/);
    expect(src).toMatch(/safeInternalPath\(urlParams\.get\('next'\),\s*'\/dashboard'\)/);
    // Both the PKCE and implicit-flow confirmation paths push the validated target.
    const pushes = src.match(/router\.push\(nextPath\)/g) ?? [];
    expect(pushes.length).toBeGreaterThanOrEqual(2);
    // The hardcoded dashboard push on confirmation success must stay dead.
    expect(src).not.toMatch(/router\.push\('\/dashboard'\)/);
  });

  it('carries the target into login on the cross-browser PKCE-mismatch path', () => {
    const src = read(CONFIRM_PAGE);
    // eslint-disable-next-line no-template-curly-in-string
    expect(src).toContain('/login?confirmed=true&redirectTo=${encodeURIComponent(nextPath)}');
  });
});

describe('F26 — ApplyButton returnUrl keeps the query string', () => {
  it('builds returnUrl from pathname + search and forces apply=1 for platform jobs', () => {
    const src = read(APPLY_BUTTON);
    expect(src).toMatch(/const buildReturnUrl = /);
    expect(src).toMatch(/new URLSearchParams\(window\.location\.search\)/);
    expect(src).toMatch(/if \(applyOnPlatform\) params\.set\('apply', '1'\)/);
    expect(src).toMatch(/\/login\?redirectTo=\$\{encodeURIComponent\(buildReturnUrl\(\)\)\}/);
    expect(src).toMatch(/\/signup\?redirectTo=\$\{encodeURIComponent\(buildReturnUrl\(\)\)\}/);
    // The pathname-only returnUrl (drops ?apply=1) must not come back.
    expect(src).not.toMatch(/returnUrl = window\.location\.pathname;/);
  });
});

describe('F26 — ApplyButton auto-open waits for auth resolution', () => {
  it('gates the ?apply=1 effect on authResolved so a just-authenticated return never sees the sign-in gate', () => {
    const src = read(APPLY_BUTTON);
    // Resolution latches immediately when the caller supplies isAuthenticated,
    // otherwise when the /api/auth/me probe settles — success OR failure.
    expect(src).toMatch(/const \[authResolved, setAuthResolved\] = useState<boolean>\(typeof isAuthenticated === 'boolean'\)/);
    expect(src).toMatch(/\.finally\(\(\) => \{ if \(active\) setAuthResolved\(true\); \}\)/);
    // The auto-open effect must bail on unresolved auth BEFORE latching
    // autoOpened — otherwise it fires once on the provisional authed=false
    // and shows the auth gate to a freshly-authenticated user.
    const applyGuard = src.indexOf("if (searchParams?.get('apply') !== '1') return;");
    const resolvedGuard = src.indexOf('if (!authResolved) return;');
    const latch = src.indexOf('autoOpened.current = true;');
    expect(applyGuard).toBeGreaterThan(-1);
    expect(resolvedGuard).toBeGreaterThan(applyGuard);
    expect(latch).toBeGreaterThan(resolvedGuard);
  });

  it('corrects an already-open sign-in gate when auth resolves to authenticated', () => {
    const src = read(APPLY_BUTTON);
    // Safety net for the manual-click race: authed flipping true while the
    // gate is up must close it (and open the platform apply form).
    expect(src).toMatch(/if \(!authed \|\| !showAuthModal\) return;/);
    expect(src).toMatch(/setShowAuthModal\(false\);\s*\n\s*if \(applyOnPlatform\) \{\s*\n\s*setShowPlatformApply\(true\);/);
  });
});

describe('F26 — safeInternalPath accepts the threaded values and rejects hostile ones', () => {
  it('passes through a job path with its own query', () => {
    expect(safeInternalPath('/jobs/pmhnp-austin-tx?apply=1', '')).toBe('/jobs/pmhnp-austin-tx?apply=1');
  });

  it('treats absent/hostile values as "no redirect requested" with an empty fallback', () => {
    expect(safeInternalPath(null, '')).toBe('');
    expect(safeInternalPath('//evil.com', '')).toBe('');
    expect(safeInternalPath('/\\evil.com', '')).toBe('');
    expect(safeInternalPath('https://evil.com/jobs', '')).toBe('');
  });

  it('falls back to /dashboard for hostile next= on the confirm page', () => {
    expect(safeInternalPath('//evil.com', '/dashboard')).toBe('/dashboard');
    expect(safeInternalPath('javascript:alert(1)', '/dashboard')).toBe('/dashboard');
  });
});

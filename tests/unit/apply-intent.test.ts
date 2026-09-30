/**
 * Owner decision 2026-09 (package APPLY): applying requires an account, and
 * the apply intent survives the sign up, log in and email confirmation round
 * trips back to the same job page.
 *
 * lib/apply-intent.ts holds the pure pieces: the ?apply=1 marker, the gate
 * URLs, the return path stashed in auth metadata for the confirmation email,
 * and the step an Apply click takes for a given auth state.
 * app/auth/confirm/confirm-state.ts decides where a confirmed account lands.
 */
import { describe, it, expect } from 'vitest';
import {
  APPLY_INTENT_PARAM,
  SIGNUP_RETURN_METADATA_KEY,
  SIGNUP_RETURN_WINDOW_MS,
  authGateHref,
  authSwitchHref,
  canLinkToEmployer,
  hasApplyIntent,
  isApplyReturnPath,
  isRenderedElement,
  resolveApplyStep,
  signupReturnPath,
  withApplyIntent,
  type ApplyStepInput,
} from '@/lib/apply-intent';
import { confirmDestination } from '@/app/auth/confirm/confirm-state';

const NOW = Date.parse('2026-09-29T12:00:00Z');

describe('the ?apply=1 marker', () => {
  it('reads only apply=1 as an intent', () => {
    expect(APPLY_INTENT_PARAM).toBe('apply');
    expect(hasApplyIntent(new URLSearchParams('apply=1'))).toBe(true);
    expect(hasApplyIntent(new URLSearchParams('apply=true'))).toBe(false);
    expect(hasApplyIntent(new URLSearchParams('ref=card'))).toBe(false);
    expect(hasApplyIntent(null)).toBe(false);
  });

  it('adds the intent to a job path and keeps the other parameters', () => {
    expect(withApplyIntent('/jobs/pmhnp-austin-tx-1')).toBe('/jobs/pmhnp-austin-tx-1?apply=1');
    expect(withApplyIntent('/jobs/pmhnp-austin-tx-1', '?ref=card')).toBe('/jobs/pmhnp-austin-tx-1?ref=card&apply=1');
    expect(withApplyIntent('/jobs/pmhnp-austin-tx-1?ref=card')).toBe('/jobs/pmhnp-austin-tx-1?ref=card&apply=1');
    // Idempotent: an existing intent is not doubled.
    expect(withApplyIntent('/jobs/x', '?apply=1')).toBe('/jobs/x?apply=1');
  });

  it('never turns a hostile path into a return target', () => {
    for (const hostile of ['//evil.com/jobs/x', 'https://evil.com/jobs/x', '/\\evil.com', 'javascript:alert(1)', '']) {
      expect(withApplyIntent(hostile), hostile).toBeNull();
    }
  });
});

describe('only the ApplyButton on screen acts on the intent', () => {
  // The job page mounts a desktop and a mobile ApplyButton and CSS hides one.
  // An element under a display: none ancestor has no client rects.
  const withRects = (length: number) => ({ getClientRects: () => ({ length }) });

  it('an element with no client rects (display: none) is not rendered', () => {
    expect(isRenderedElement(withRects(0))).toBe(false);
  });

  it('an element with at least one client rect is rendered', () => {
    expect(isRenderedElement(withRects(1))).toBe(true);
    expect(isRenderedElement(withRects(3))).toBe(true);
  });

  it('a missing element (ref not attached yet, or unmounted) is not rendered', () => {
    expect(isRenderedElement(null)).toBe(false);
    expect(isRenderedElement(undefined)).toBe(false);
  });
});

describe('gate and form-switch URLs', () => {
  it('sends the visitor to sign up or log in with an encoded return path', () => {
    expect(authGateHref('signup', '/jobs/x?apply=1')).toBe('/signup?redirectTo=%2Fjobs%2Fx%3Fapply%3D1');
    expect(authGateHref('login', '/jobs/x?apply=1')).toBe('/login?redirectTo=%2Fjobs%2Fx%3Fapply%3D1');
  });

  it('drops a hostile return path instead of forwarding it', () => {
    expect(authGateHref('signup', '//evil.com')).toBe('/signup');
    expect(authGateHref('login', null)).toBe('/login');
  });

  it('keeps the return path and the employer role when switching between the forms', () => {
    expect(authSwitchHref('login', { redirectTo: '/jobs/x?apply=1' })).toBe('/login?redirectTo=%2Fjobs%2Fx%3Fapply%3D1');
    expect(authSwitchHref('signup', { redirectTo: '/jobs/x?apply=1', employer: true }))
      .toBe('/signup?role=employer&redirectTo=%2Fjobs%2Fx%3Fapply%3D1');
    expect(authSwitchHref('signup', { employer: true })).toBe('/signup?role=employer');
    expect(authSwitchHref('login')).toBe('/login');
    expect(authSwitchHref('login', { redirectTo: 'https://evil.com' })).toBe('/login');
  });

  it('recognises a return path that is a job with an apply intent', () => {
    expect(isApplyReturnPath('/jobs/x?apply=1')).toBe(true);
    expect(isApplyReturnPath('/jobs/x')).toBe(false);
    expect(isApplyReturnPath('/saved?apply=1')).toBe(false);
    expect(isApplyReturnPath('//evil.com/jobs/x?apply=1')).toBe(false);
    expect(isApplyReturnPath(undefined)).toBe(false);
  });
});

describe('the return path carried through the confirmation email', () => {
  const confirmedJustNow = new Date(NOW - 30_000).toISOString();
  const user = (value: unknown, confirmedAt: string | null = confirmedJustNow) => ({
    user_metadata: { [SIGNUP_RETURN_METADATA_KEY]: value },
    email_confirmed_at: confirmedAt,
  });

  it('is read back right after the email is confirmed', () => {
    expect(signupReturnPath(user('/jobs/x?apply=1'), NOW)).toBe('/jobs/x?apply=1');
  });

  it('is ignored once the confirmation is older than the window, or missing', () => {
    const stale = new Date(NOW - SIGNUP_RETURN_WINDOW_MS - 1).toISOString();
    expect(signupReturnPath(user('/jobs/x?apply=1', stale), NOW)).toBeNull();
    expect(signupReturnPath(user('/jobs/x?apply=1', null), NOW)).toBeNull();
    expect(signupReturnPath(user('/jobs/x?apply=1', 'not a date'), NOW)).toBeNull();
    expect(signupReturnPath(null, NOW)).toBeNull();
  });

  it('never yields a hostile or non-string value', () => {
    for (const value of ['//evil.com', 'https://evil.com/jobs/x', 42, null, undefined, { path: '/jobs/x' }]) {
      expect(signupReturnPath(user(value), NOW), JSON.stringify(value)).toBeNull();
    }
  });

  it('/auth/confirm: an explicit ?next= wins, then the stored path, then the default', () => {
    const stored = user('/jobs/x?apply=1');
    expect(confirmDestination('/jobs/y?apply=1', true, stored, NOW)).toBe('/jobs/y?apply=1');
    expect(confirmDestination('/onboarding/professional', false, stored, NOW)).toBe('/jobs/x?apply=1');
    expect(confirmDestination('/onboarding/professional', false, user(undefined), NOW)).toBe('/onboarding/professional');
    expect(confirmDestination('/onboarding/professional', false, null, NOW)).toBe('/onboarding/professional');
  });
});

describe('what an Apply click does', () => {
  const input = (overrides: Partial<ApplyStepInput>): ApplyStepInput => ({
    applyOnPlatform: false,
    hasExternalHref: true,
    authResolved: true,
    authed: false,
    ...overrides,
  });

  it('a signed-out visitor always gets the gate, Easy Apply and external alike', () => {
    expect(resolveApplyStep(input({ applyOnPlatform: false }))).toBe('auth-gate');
    expect(resolveApplyStep(input({ applyOnPlatform: true, hasExternalHref: false }))).toBe('auth-gate');
  });

  it('a click before the sign-in probe answers is held', () => {
    expect(resolveApplyStep(input({ authResolved: false }))).toBe('wait-for-auth');
    expect(resolveApplyStep(input({ authResolved: false, authed: true }))).toBe('wait-for-auth');
  });

  it('a signed-in candidate opens Easy Apply, or the continue link for an external job', () => {
    expect(resolveApplyStep(input({ authed: true, applyOnPlatform: true }))).toBe('easy-apply-form');
    expect(resolveApplyStep(input({ authed: true }))).toBe('continue-to-employer');
  });

  it('a job with no usable apply path does nothing', () => {
    expect(resolveApplyStep(input({ hasExternalHref: false }))).toBe('unavailable');
    expect(resolveApplyStep(input({ hasExternalHref: false, authed: true }))).toBe('unavailable');
  });

  it('the employer link is rendered only for a visitor known to be signed in', () => {
    expect(canLinkToEmployer(input({ authed: true }))).toBe(true);
    expect(canLinkToEmployer(input({ authed: false }))).toBe(false);
    expect(canLinkToEmployer(input({ authed: true, authResolved: false }))).toBe(false);
    expect(canLinkToEmployer(input({ authed: true, applyOnPlatform: true }))).toBe(false);
    expect(canLinkToEmployer(input({ authed: true, hasExternalHref: false }))).toBe(false);
  });
});

/**
 * Apply intent: carries a candidate's Apply click across the sign up or log
 * in round trip, back to the same job page.
 *
 * Owner decision (2026-09): applying requires an NP Hiring account. The job
 * description stays readable without one, but every Apply click by a
 * signed-out visitor (external ATS link or on-platform Easy Apply, on the
 * job page or on a job card) opens the sign-up or log-in gate first. The
 * gate sends the visitor to /signup or /login with a return path that ends
 * in ?apply=1; when they come back signed in, the job page reads that
 * marker and either opens Easy Apply or shows a "Continue to employer
 * application" link. Nothing here ever opens a window: a new tab is only
 * opened by the candidate clicking a real link.
 *
 * Pure and dependency-light on purpose: client components (ApplyButton,
 * JobCard, the auth forms) and the /auth/confirm helpers all import it.
 */
import { safeInternalPath } from '@/lib/auth/safe-redirect';

/** Query parameter that marks an apply intent on a job page URL. */
export const APPLY_INTENT_PARAM = 'apply';
/** The only value that counts as an apply intent. */
export const APPLY_INTENT_VALUE = '1';

/** Anything with URLSearchParams' get(), such as Next's ReadonlyURLSearchParams. */
interface ParamReader {
  get(name: string): string | null;
}

/** True when the query string carries the apply intent (?apply=1). */
export function hasApplyIntent(params: ParamReader | null | undefined): boolean {
  return params?.get(APPLY_INTENT_PARAM) === APPLY_INTENT_VALUE;
}

/** The one DOM method isRenderedElement reads, so tests can pass a fake. */
interface ClientRectsReader {
  getClientRects(): { length: number };
}

/**
 * True when the element is laid out on the page. An element with
 * display: none on itself or on any ancestor has no client rects.
 *
 * The job page mounts two ApplyButtons (the desktop sidebar and the mobile
 * sticky bar) and CSS hides one of them, so both see the same ?apply=1. Only
 * the one that is rendered may act on it; otherwise the apply click is
 * counted twice and two Easy Apply modals stack on top of each other.
 */
export function isRenderedElement(el: ClientRectsReader | null | undefined): boolean {
  return !!el && el.getClientRects().length > 0;
}

/** Placeholder origin used only to parse a same-origin path. */
const PARSE_BASE = 'https://apply-intent.invalid';

/**
 * The same-origin path with ?apply=1 set, keeping every other query
 * parameter. Accepts a bare path ("/jobs/x"), a path with a query
 * ("/jobs/x?ref=card") or a pathname plus a separate search string
 * (window.location.pathname, window.location.search). Anything that is not
 * a safe same-origin path yields null, so it can never become a redirect.
 */
export function withApplyIntent(path: string, search = ''): string | null {
  const url = parseSameOriginPath(path, search);
  if (!url) return null;
  url.searchParams.set(APPLY_INTENT_PARAM, APPLY_INTENT_VALUE);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The same-origin path with the apply intent removed, keeping every other
 * query parameter. Same inputs as withApplyIntent; anything that is not a
 * safe same-origin path yields null.
 *
 * The job page strips ?apply=1 from the address bar once it has acted on
 * the intent, so a reload, a Back press or a copied link does not open the
 * Easy Apply form again or count another apply click. The sign-up or log-in
 * gate adds the intent back (withApplyIntent) when it is used.
 */
export function withoutApplyIntent(path: string, search = ''): string | null {
  const url = parseSameOriginPath(path, search);
  if (!url) return null;
  url.searchParams.delete(APPLY_INTENT_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Parses a safe same-origin path, merging in a separate search string.
 * Null for anything that is not a safe same-origin path.
 */
function parseSameOriginPath(path: string, search: string): URL | null {
  const safe = safeInternalPath(path, '');
  if (!safe) return null;
  let url: URL;
  try {
    url = new URL(safe, PARSE_BASE);
  } catch {
    return null;
  }
  if (url.origin !== PARSE_BASE) return null;
  const extra = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  extra.forEach((value, key) => url.searchParams.set(key, value));
  return url;
}

export type AuthGateTarget = 'signup' | 'login';

/**
 * /signup or /login URL that returns to `returnPath` once the visitor is
 * signed in. An unsafe return path is dropped rather than forwarded.
 */
export function authGateHref(target: AuthGateTarget, returnPath: string | null | undefined): string {
  const base = target === 'signup' ? '/signup' : '/login';
  const safe = safeInternalPath(returnPath, '');
  return safe ? `${base}?redirectTo=${encodeURIComponent(safe)}` : base;
}

/**
 * Link between the two auth forms ("Already have an account? Sign in",
 * "Create one") that keeps the return path and the employer role, so a
 * visitor who switches forms does not lose the job they were applying for.
 */
export function authSwitchHref(
  target: AuthGateTarget,
  options: { redirectTo?: string | null; employer?: boolean } = {},
): string {
  const base = target === 'signup' ? '/signup' : '/login';
  const params = new URLSearchParams();
  if (options.employer) params.set('role', 'employer');
  const safe = safeInternalPath(options.redirectTo, '');
  if (safe) params.set('redirectTo', safe);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Auth user_metadata key that carries the return path through the email
 * confirmation round trip. SignUpForm writes it at sign up; /auth/confirm
 * reads it when the confirmation link arrives without ?next=, which is what
 * happens when the candidate uses "Resend" (the resend link is minted
 * server side) or when the redirect loses its query string.
 */
export const SIGNUP_RETURN_METADATA_KEY = 'signup_return_to';

/**
 * How long after the email is confirmed the stored return path is still
 * honoured. The confirmation that reads it has just happened, so this only
 * has to absorb clock skew; it keeps an old value from ever steering a
 * later sign in.
 */
export const SIGNUP_RETURN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The parts of a Supabase auth user this module reads. */
export interface SignupReturnUser {
  user_metadata?: Record<string, unknown> | null;
  email_confirmed_at?: string | null;
}

/**
 * The return path stored at sign up, when the email was confirmed within
 * SIGNUP_RETURN_WINDOW_MS of `now` and the stored value is a safe
 * same-origin path. Null otherwise.
 */
export function signupReturnPath(user: SignupReturnUser | null | undefined, now: number): string | null {
  if (!user) return null;
  const confirmedAt = typeof user.email_confirmed_at === 'string' ? Date.parse(user.email_confirmed_at) : NaN;
  if (!Number.isFinite(confirmedAt)) return null;
  if (Math.abs(now - confirmedAt) > SIGNUP_RETURN_WINDOW_MS) return null;
  const stored = user.user_metadata?.[SIGNUP_RETURN_METADATA_KEY];
  return safeInternalPath(stored, '') || null;
}

/** True when a (validated) return path points back to a job with an apply intent. */
export function isApplyReturnPath(path: string | null | undefined): boolean {
  const safe = safeInternalPath(path, '');
  if (!safe) return false;
  try {
    const url = new URL(safe, PARSE_BASE);
    return url.pathname.startsWith('/jobs/') && hasApplyIntent(url.searchParams);
  } catch {
    return false;
  }
}

/**
 * What an Apply click (or an arriving ?apply=1) should do right now:
 * - 'unavailable': the job has no usable apply path.
 * - 'wait-for-auth': the sign-in probe has not answered yet; hold the click.
 * - 'auth-gate': signed out; show the sign-up or log-in gate.
 * - 'easy-apply-form': signed in, on-platform job; open the Easy Apply form.
 * - 'continue-to-employer': signed in, external job; show the "Continue to
 *   employer application" link (a real link, so the new tab opens from the
 *   candidate's own click).
 */
export type ApplyStep =
  | 'unavailable'
  | 'wait-for-auth'
  | 'auth-gate'
  | 'easy-apply-form'
  | 'continue-to-employer';

export interface ApplyStepInput {
  applyOnPlatform: boolean;
  /** True when the external apply link is a safe http(s) or mailto: URL. */
  hasExternalHref: boolean;
  authResolved: boolean;
  authed: boolean;
}

export function resolveApplyStep(input: ApplyStepInput): ApplyStep {
  if (!input.applyOnPlatform && !input.hasExternalHref) return 'unavailable';
  if (!input.authResolved) return 'wait-for-auth';
  if (!input.authed) return 'auth-gate';
  return input.applyOnPlatform ? 'easy-apply-form' : 'continue-to-employer';
}

/**
 * The main call to action may be a direct link to the employer's
 * application only for a visitor known to be signed in. Until the sign-in
 * probe answers, and for every signed-out visitor, it is a button that opens
 * the gate.
 */
export function canLinkToEmployer(input: ApplyStepInput): boolean {
  return resolveApplyStep(input) === 'continue-to-employer';
}

/**
 * Pure helpers for /auth/confirm, kept out of the page so they can be unit
 * tested.
 */
import { authGateHref, signupReturnPath, type SignupReturnUser } from '@/lib/apply-intent'

export type ConfirmStatus = 'loading' | 'success' | 'error' | 'expired'

/**
 * Where a failed or unusable confirmation link sends the visitor to log in.
 * An explicit ?next= (for example the job being applied for,
 * /jobs/x?apply=1) rides along, so logging in still lands on that job with
 * the apply intent; otherwise it is plain /login.
 */
export function confirmLoginHref(nextPath: string, hasExplicitNext: boolean): string {
  return hasExplicitNext ? authGateHref('login', nextPath) : '/login'
}

/**
 * Where a just-confirmed account goes next.
 *
 * An explicit ?next= on the confirmation link always wins. Without one (a
 * link minted by "Resend", or a redirect that dropped its query string), the
 * return path SignUpForm stashed in the auth metadata is used, so a
 * candidate who signed up from a job's Apply button still lands back on
 * that job with the apply intent. Otherwise `nextPath` (the onboarding
 * interstitial) stands.
 */
export function confirmDestination(
  nextPath: string,
  hasExplicitNext: boolean,
  user: SignupReturnUser | null | undefined,
  now: number,
): string {
  if (hasExplicitNext) return nextPath
  return signupReturnPath(user, now) ?? nextPath
}

/** Supabase PKCE auth codes are v4 UUIDs (GoTrue flow_state.auth_code). */
const AUTH_CODE_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface AuthErrorLike {
  name?: unknown
  code?: unknown
}

/**
 * Outcome of a failed exchangeCodeForSession:
 * - 'other_browser': the code is well formed but this browser holds no PKCE
 *   code verifier, which is what happens when a real confirmation email is
 *   opened in a different browser than the one used to sign up. The code can
 *   not be checked from here, so the page must NOT claim the email is
 *   confirmed; it sends the user to log in instead.
 * - 'invalid': anything else (malformed code, or the auth server rejected
 *   it). The link is invalid or expired.
 */
export type CodeExchangeFailure = 'other_browser' | 'invalid'

export function classifyCodeExchangeFailure(code: string, error: AuthErrorLike | null | undefined): CodeExchangeFailure {
  const verifierMissing =
    error?.name === 'AuthPKCECodeVerifierMissingError' || error?.code === 'pkce_code_verifier_not_found'
  return verifierMissing && AUTH_CODE_SHAPE.test(code.trim()) ? 'other_browser' : 'invalid'
}

/** Visible h1 for each state of the page. */
export function confirmHeading(status: ConfirmStatus): string {
  switch (status) {
    case 'loading':
      return 'Confirming your account'
    case 'success':
      return 'You are verified'
    case 'expired':
      return 'Confirmation link expired'
    case 'error':
      return 'We could not verify this link'
  }
}

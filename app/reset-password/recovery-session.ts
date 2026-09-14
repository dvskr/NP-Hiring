/**
 * Decides whether the current Supabase session may set a new password
 * WITHOUT re-entering the current one.
 *
 * Supabase records how a session was established in the access token's
 * `amr` claim. A session minted by an emailed one-time link (the password
 * reset link from /forgot-password) carries method "otp" (verified live on
 * the dev project: admin generateLink recovery and magiclink both yield
 * [{ method: 'otp' }]); newer GoTrue builds may also report "recovery" or
 * "magiclink". A password or OAuth sign-in does not, so a merely signed-in
 * browser (for example one left unattended) must re-authenticate with the
 * current password first.
 *
 * The link proof is only honoured for a bounded time after it was used,
 * matching the one-hour lifetime of the reset link itself.
 */

export interface AuthMethodReference {
  method: string
  /** Seconds since the Unix epoch. */
  timestamp: number
}

export const EMAIL_LINK_AMR_METHODS: readonly string[] = ['otp', 'recovery', 'magiclink']

/** One hour, the lifetime of a password reset link. */
export const RECOVERY_WINDOW_SECONDS = 60 * 60

/** Tolerated clock skew between the auth server and the browser. */
const CLOCK_SKEW_SECONDS = 60

export type PasswordChangeMode = 'recovery' | 'reauthenticate'

export function getPasswordChangeMode(
  methods: readonly AuthMethodReference[] | null | undefined,
  nowSeconds: number,
  windowSeconds: number = RECOVERY_WINDOW_SECONDS,
): PasswordChangeMode {
  const hasRecentLinkProof = (methods ?? []).some(
    ({ method, timestamp }) =>
      EMAIL_LINK_AMR_METHODS.includes(method) &&
      Number.isFinite(timestamp) &&
      timestamp <= nowSeconds + CLOCK_SKEW_SECONDS &&
      nowSeconds - timestamp <= windowSeconds,
  )
  return hasRecentLinkProof ? 'recovery' : 'reauthenticate'
}

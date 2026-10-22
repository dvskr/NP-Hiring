/**
 * Single source of truth for "auto-create a UserProfile from a Supabase
 * auth user". Both `lib/auth/protect.ts:requireAuth` and the
 * `/api/auth/profile` GET handler call into here so the role-detection
 * logic can never drift between them again.
 *
 * Why this exists:
 * Prior to 2026-05-26 two separate auto-create paths each hardcoded
 * `role: 'job_seeker'`. SignUpForm pushed the actual signup intent into
 * Supabase `user_metadata.role`, but neither auto-create path read it
 * back. Result: every employer signup that hit a protected route before
 * the SignUpForm's POST could land (the common case when email
 * confirmation is required) was stranded as a job_seeker profile —
 * silently, with no error logs. We had a steady trickle of "I tried
 * to sign up as employer but got a job_seeker profile" contact-form
 * complaints before tracing the cause.
 *
 * Rules this helper enforces:
 *   - Allow-list role to ('employer' | 'job_seeker'). Anything else
 *     (including the literal 'admin') falls back to 'job_seeker' —
 *     admin can only be granted by direct DB action.
 *   - Pull first_name / last_name / company from metadata so the row
 *     is fully populated, not just role, each cleaned and bounded the way
 *     POST /api/auth/profile treats its body (the account holder writes
 *     metadata).
 *   - Relink a profile filed under the session's email only when Supabase
 *     has confirmed that email (see findOrRelinkProfile).
 *   - One structured log per auto-create so we can grep for unexpected
 *     fallbacks in prod.
 */
import type { User } from '@supabase/supabase-js'
import type { PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'
import { syncToBeehiiv } from '@/lib/beehiiv'
import { sanitizeText } from '@/lib/sanitize'

interface SupabaseAuthMetadata {
  role?: string
  // The account holder writes these (any JSON), so they are read as unknown.
  company?: unknown
  first_name?: unknown
  last_name?: unknown
  /** Google sign-in sends the name only as this. */
  full_name?: unknown
  /** Google sign-in sends the profile picture as this. */
  avatar_url?: unknown
  want_job_highlights?: boolean
  highlights_frequency?: string
  newsletter_opt_in?: boolean
}

/** The bounds POST /api/auth/profile puts on the same fields in its body. */
const METADATA_NAME_MAX = 50
const METADATA_COMPANY_MAX = 100
/** The bound the admin company profile route puts on a stored URL. */
const METADATA_AVATAR_URL_MAX = 500

/**
 * SECURITY: user_metadata is written by the account holder (the public auth
 * API stores any `options.data` sent at sign-up), and the names and company
 * were stored as sent: any length and any type. A text field from it is now
 * cleaned and bounded the way POST /api/auth/profile cleans its body
 * (sanitizeText), and a value that is not a string, or is empty once
 * cleaned, is dropped. tests/regressions/auth-metadata-sanitise.test.ts
 * Cleaning is not HTML escaping: markup outside a script block survives it,
 * so a sink that writes the value into HTML escapes it there
 * (sendSignupWelcomeEmail).
 */
function metadataText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  return sanitizeText(value, maxLength) || null
}

/**
 * First and last name from the sign-in provider's full_name (Google sends
 * only that), split at the first space, each part cleaned like a sign-up
 * name. Both null when full_name is absent or not a string.
 */
export function readProviderFullName(user: User): { firstName: string | null; lastName: string | null } {
  const fullName = (user.user_metadata as SupabaseAuthMetadata | undefined)?.full_name
  if (typeof fullName !== 'string') return { firstName: null, lastName: null }
  const parts = fullName.split(' ')
  return {
    firstName: metadataText(parts[0], METADATA_NAME_MAX),
    lastName: metadataText(parts.slice(1).join(' '), METADATA_NAME_MAX),
  }
}

/**
 * The host Google serves sign-in pictures from, and the only remote picture
 * host this site loads: the CSP img-src (middleware.ts) and next.config.ts
 * remotePatterns allow no other.
 */
const GOOGLE_PICTURE_HOST = 'lh3.googleusercontent.com'

/**
 * True when Supabase records a Google identity on the account. app_metadata
 * is written by Supabase only (the public auth API updates user_metadata),
 * and `providers` lists an identity linked after an email sign-up too.
 */
function signedInWithGoogle(user: User): boolean {
  const app = user.app_metadata ?? {}
  return app.provider === 'google' || (Array.isArray(app.providers) && app.providers.includes('google'))
}

/**
 * The Google sign-in picture: an https URL on GOOGLE_PICTURE_HOST of at most
 * METADATA_AVATAR_URL_MAX characters, or null. The profile renders it to
 * other users as an image source and a CSS background, so another scheme
 * (javascript:, data:, http), a relative or protocol-relative path, a value
 * that does not parse and an oversized one are all dropped rather than
 * stored.
 *
 * SECURITY: any https host was kept, and avatar_url is account-written for
 * an email sign-up too, so an account could point its avatar at a server of
 * its own and log the address and read time of every employer or candidate
 * shown it. It is now kept only for an account that signed in with Google,
 * only on Google's picture host, with no credentials or port, and with
 * nothing that ends a CSS url(). tests/regressions/auth-metadata-sanitise.test.ts
 */
export function readProviderAvatarUrl(user: User): string | null {
  if (!signedInWithGoogle(user)) return null
  const raw = (user.user_metadata as SupabaseAuthMetadata | undefined)?.avatar_url
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > METADATA_AVATAR_URL_MAX) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== GOOGLE_PICTURE_HOST) return null
  if (url.username || url.password || url.port) return null
  const href = url.href
  if (href.length > METADATA_AVATAR_URL_MAX || /[\s()'"\\]/.test(href)) return null
  return href
}

export interface AuthMetadataDerivedFields {
  role: 'employer' | 'job_seeker'
  company: string | null
  firstName: string | null
  lastName: string | null
  /**
   * Signup opt-ins stashed in auth metadata by SignUpForm. In the
   * confirm-required email flow the client's immediate profile POST 401s
   * (no session cookie yet), so these are the only surviving record of
   * what the user checked at signup. Defaults are conservative: absent
   * metadata (old accounts, OAuth) reads as opted-out.
   */
  wantJobHighlights: boolean
  highlightsFrequency: 'daily' | 'weekly'
  newsletterOptIn: boolean
}

/**
 * Pure helper: extract the profile fields the signup flow stashed in
 * `auth.user_metadata` via `supabase.auth.signUp({ ..., options: { data } })`.
 * Returns safe defaults for anything missing. Exported so callers that
 * need the derived role *without* writing to the DB (e.g. analytics)
 * can reuse the same allow-list logic.
 */
export function readSignupMetadata(user: User): AuthMetadataDerivedFields {
  const meta = (user.user_metadata ?? {}) as SupabaseAuthMetadata
  const role: 'employer' | 'job_seeker' =
    meta.role === 'employer' ? 'employer' : 'job_seeker'
  return {
    role,
    company: role === 'employer' ? metadataText(meta.company, METADATA_COMPANY_MAX) : null,
    firstName: metadataText(meta.first_name, METADATA_NAME_MAX),
    lastName: metadataText(meta.last_name, METADATA_NAME_MAX),
    wantJobHighlights: role === 'job_seeker' && meta.want_job_highlights === true,
    highlightsFrequency: meta.highlights_frequency === 'weekly' ? 'weekly' : 'daily',
    newsletterOptIn: meta.newsletter_opt_in === true,
  }
}

/**
 * Completes the signup opt-ins that the client-side profile POST used to
 * carry (F27). Mirrors the record creation in `POST /api/auth/profile` and
 * the Google-OAuth branch of `app/auth/callback/route.ts`:
 *   - employers  → EmployerLead (sales tracking), guarded by contactEmail
 *   - seekers    → EmailLead upsert (newsletterOptIn), Beehiiv sync, and —
 *                  if the user checked "job highlights" — a JobAlert with
 *                  confirmedAt set (single opt-in: the signup checkbox is
 *                  the consent event; the digest cron skips unconfirmed
 *                  alerts entirely).
 *
 * Idempotent by construction (findFirst guards + upsert), and only invoked
 * from ensureProfileFromAuth's create branch, which never runs for the
 * autoconfirm/OAuth paths — those already created these records.
 */
export async function completeSignupOptIns(
  prisma: PrismaClient,
  email: string,
  derived: AuthMetadataDerivedFields,
): Promise<void> {
  if (derived.role === 'employer') {
    const existingEmployerLead = await prisma.employerLead.findFirst({
      where: { contactEmail: email },
    })
    if (!existingEmployerLead) {
      const contactName =
        [derived.firstName, derived.lastName].filter(Boolean).join(' ') || null
      await prisma.employerLead.create({
        data: {
          companyName: derived.company || contactName || 'Unknown',
          contactEmail: email,
          contactName,
          source: 'employer_signup',
          status: 'prospect',
        },
      })
      logger.info('[completeSignupOptIns] EmployerLead created', { email })
    }
    return
  }

  // Job seekers → email_leads FIRST (FK: JobAlert.email → EmailLead.email)
  await prisma.emailLead.upsert({
    where: { email },
    update: {
      isSubscribed: true,
      newsletterOptIn: derived.newsletterOptIn ? true : undefined,
    },
    create: {
      email,
      source: 'signup',
      isSubscribed: true,
      newsletterOptIn: derived.newsletterOptIn,
    },
  })

  // Beehiiv newsletter sync (fire-and-forget inside the lib), only with the
  // newsletter opt-in: it ran for every new seeker whatever the checkbox
  // said. tests/regressions/newsletter-consent-signup-paths.test.ts
  if (derived.newsletterOptIn) {
    syncToBeehiiv(email, { utmSource: 'signup' })
  }

  if (derived.wantJobHighlights) {
    const existingAlert = await prisma.jobAlert.findFirst({ where: { email } })
    if (!existingAlert) {
      await prisma.jobAlert.create({
        data: {
          email,
          name: 'Job Highlights',
          keyword: null,
          location: null,
          mode: null,
          jobType: null,
          minSalary: null,
          maxSalary: null,
          frequency: derived.highlightsFrequency,
          isActive: true,
          // Single opt-in: the user explicitly checked "job highlights"
          // during signup. The digest cron only sends to alerts with
          // confirmedAt set, so leaving it null would make this alert
          // permanently invisible to the sender.
          confirmedAt: new Date(),
          token: crypto.randomUUID(),
        },
      })
      logger.info('[completeSignupOptIns] JobAlert created', {
        email,
        frequency: derived.highlightsFrequency,
      })
    }
  }
}

/**
 * What findOrRelinkProfile answers instead of a profile when the one under
 * the session's email belongs to another auth user and the session's email
 * is not confirmed.
 */
const RELINK_REFUSED = Symbol('relink refused')

/**
 * Idempotent profile bootstrap. Returns the existing profile if one is
 * already linked to the auth user, otherwise creates one with the
 * metadata-derived role + name fields. If a stale profile exists with
 * the same email but a different supabaseId (re-signup after delete),
 * it gets relinked rather than duplicated, provided Supabase has
 * confirmed the session's email; otherwise the answer is null.
 *
 * NOTE: This function ONLY creates. It never updates an existing
 * profile's role — that's intentional. An admin who was promoted via
 * direct DB action must not be demotable just by hitting a protected
 * route. If you need to update a freshly-created row's role later
 * (e.g. user upgraded plan), do it explicitly in the route handler.
 */
export async function ensureProfileFromAuth<
  T extends { id: string; supabaseId: string; email: string; role: string }
>(
  prisma: PrismaClient,
  user: User,
  options: {
    /** Prisma include for callers that need _count or other relations. */
    include?: Record<string, unknown>
    /** Extra log context (caller name, etc.). */
    logSource?: string
  } = {},
): Promise<T | null> {
  if (!user.email) return null

  const found = await findOrRelinkProfile<T>(prisma, user, user.email, options)
  // The address belongs to another account's profile and this session has
  // not confirmed it: no profile, and no create (it could only collide).
  if (found === RELINK_REFUSED) return null
  if (found) return found

  // Slow path 2: no profile anywhere. Create from auth metadata.
  const derived = readSignupMetadata(user)
  let created: T
  try {
    created = (await prisma.userProfile.create({
      data: {
        supabaseId: user.id,
        email: user.email,
        role: derived.role,
        company: derived.company,
        firstName: derived.firstName,
        lastName: derived.lastName,
      },
      ...(options.include ? { include: options.include } : {}),
    })) as unknown as T
  } catch (createError) {
    // First login fires several bootstrap calls at once (requireAuth in the
    // page layout plus GET /api/auth/profile from the client). Each sees no
    // row, each tries to create, and the losers hit the unique constraint
    // on supabase_id or email (P2002), which surfaced as a 500. The winner's
    // row is the profile we want: re-read it. The winner also owns the
    // signup opt-in completion below, so the loser skips it (no duplicates).
    if (!isUniqueViolation(createError)) throw createError
    const winner = await findOrRelinkProfile<T>(prisma, user, user.email, options)
    if (!winner || winner === RELINK_REFUSED) throw createError
    logger.info('[ensureProfileFromAuth] concurrent create lost the race; returned existing profile', {
      email: user.email,
      source: options.logSource ?? null,
    })
    return winner
  }
  logger.info('[ensureProfileFromAuth] created profile from auth metadata', {
    email: user.email,
    role: derived.role,
    hasEmployerMetadata: derived.role === 'employer',
    source: options.logSource ?? null,
  })

  // F27: in the confirm-required email flow the client's profile POST 401s
  // before a session exists, silently dropping the signup opt-ins (JobAlert,
  // EmailLead/newsletter, EmployerLead, Beehiiv). They were stashed in auth
  // metadata at signUp, so complete them here — this branch only runs when
  // no profile row existed, which excludes the autoconfirm/OAuth paths that
  // already created these records alongside their profile.
  try {
    await completeSignupOptIns(prisma, user.email, derived)
  } catch (optInError) {
    // Never block auth on opt-in bookkeeping — profile creation succeeded.
    // NOTE: logger contract is error(message, error?, context?) — the
    // exception goes in slot 2 so Sentry captures the real error, not the
    // context object.
    logger.error(
      '[ensureProfileFromAuth] signup opt-in completion failed',
      optInError,
      { email: user.email, role: derived.role, source: options.logSource ?? null },
    )
  }

  return created
}

/** True for a Prisma unique-constraint violation (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002'
}

/**
 * Lookup half of ensureProfileFromAuth: the profile linked to this auth
 * user, or one under the same email relinked to it. Null when neither exists.
 * RELINK_REFUSED when one exists under the email but the relink is refused.
 */
async function findOrRelinkProfile<T>(
  prisma: PrismaClient,
  user: User,
  email: string,
  options: { include?: Record<string, unknown>; logSource?: string },
): Promise<T | null | typeof RELINK_REFUSED> {
  // Fast path: profile already exists on this supabaseId.
  const existing = await prisma.userProfile.findUnique({
    where: { supabaseId: user.id },
    ...(options.include ? { include: options.include } : {}),
  })
  if (existing) return existing as unknown as T

  // Slow path 1: profile exists under this email but a different
  // supabaseId. Happens when the auth user was deleted+recreated. Relink.
  const byEmail = await prisma.userProfile.findFirst({
    where: { email },
    ...(options.include ? { include: options.include } : {}),
  })
  if (byEmail && byEmail.supabaseId !== user.id) {
    // SECURITY: the relink hands an existing profile, whatever its role
    // (admin included), to whichever auth user presents its email. That
    // proves ownership only once Supabase has confirmed the address, the
    // check /api/auth/welcome makes. Every legitimate session carries
    // email_confirmed_at: Supabase refuses a password sign-in for an
    // unconfirmed email, stamps it when a confirmation, magic link or
    // recovery link is verified, and at a Google sign-in whose email Google
    // reports verified. Only a session let in on an unverified address
    // lacks it, and it is refused here instead of taking the profile over.
    // With "Confirm email" off, Supabase stamps it at sign-up, so that
    // dashboard setting stays the real control.
    // tests/regressions/ensure-profile-relink-confirmed-email.test.ts
    if (!user.email_confirmed_at) {
      logger.warn('[ensureProfileFromAuth] refused to relink a profile to an auth user whose email is not confirmed', {
        email,
        profileId: byEmail.id,
        source: options.logSource ?? null,
      })
      return RELINK_REFUSED
    }
    const relinked = await prisma.userProfile.update({
      where: { id: byEmail.id },
      data: { supabaseId: user.id },
      ...(options.include ? { include: options.include } : {}),
    })
    logger.info('[ensureProfileFromAuth] relinked existing profile to new auth user', {
      email,
      profileId: byEmail.id,
      source: options.logSource ?? null,
    })
    return relinked as unknown as T
  }
  return byEmail as unknown as T | null
}

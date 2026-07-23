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
 *     is fully populated, not just role.
 *   - One structured log per auto-create so we can grep for unexpected
 *     fallbacks in prod.
 */
import type { User } from '@supabase/supabase-js'
import type { PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'
import { syncToBeehiiv } from '@/lib/beehiiv'

interface SupabaseAuthMetadata {
  role?: string
  company?: string
  first_name?: string
  last_name?: string
  want_job_highlights?: boolean
  highlights_frequency?: string
  newsletter_opt_in?: boolean
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
    company: role === 'employer' && meta.company ? meta.company : null,
    firstName: meta.first_name ?? null,
    lastName: meta.last_name ?? null,
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

  // Beehiiv newsletter sync (fire-and-forget inside the lib)
  syncToBeehiiv(email, { utmSource: 'signup' })

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
 * Idempotent profile bootstrap. Returns the existing profile if one is
 * already linked to the auth user, otherwise creates one with the
 * metadata-derived role + name fields. If a stale profile exists with
 * the same email but a different supabaseId (re-signup after delete),
 * it gets relinked rather than duplicated.
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

  // Fast path: profile already exists on this supabaseId.
  const existing = await prisma.userProfile.findUnique({
    where: { supabaseId: user.id },
    ...(options.include ? { include: options.include } : {}),
  })
  if (existing) return existing as unknown as T

  // Slow path 1: profile exists under this email but a different
  // supabaseId. Happens when the auth user was deleted+recreated. Relink.
  const byEmail = await prisma.userProfile.findFirst({
    where: { email: user.email },
    ...(options.include ? { include: options.include } : {}),
  })
  if (byEmail && byEmail.supabaseId !== user.id) {
    const relinked = await prisma.userProfile.update({
      where: { id: byEmail.id },
      data: { supabaseId: user.id },
      ...(options.include ? { include: options.include } : {}),
    })
    logger.info('[ensureProfileFromAuth] relinked existing profile to new auth user', {
      email: user.email,
      profileId: byEmail.id,
      source: options.logSource ?? null,
    })
    return relinked as unknown as T
  }
  if (byEmail) return byEmail as unknown as T

  // Slow path 2: no profile anywhere. Create from auth metadata.
  const derived = readSignupMetadata(user)
  const created = await prisma.userProfile.create({
    data: {
      supabaseId: user.id,
      email: user.email,
      role: derived.role,
      company: derived.company,
      firstName: derived.firstName,
      lastName: derived.lastName,
    },
    ...(options.include ? { include: options.include } : {}),
  })
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

  return created as unknown as T
}

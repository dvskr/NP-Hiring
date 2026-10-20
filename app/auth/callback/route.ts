import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncToBeehiiv } from '@/lib/beehiiv'
import { sendSignupWelcomeEmail } from '@/lib/email-service'
import { safeInternalPath } from '@/lib/auth/safe-redirect'
import { readSignupMetadata, readProviderFullName, readProviderAvatarUrl } from '@/lib/auth/ensure-profile'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  // Open-redirect guard: `${origin}${next}` with an unsanitized next allows
  // e.g. next='@evil.com' -> https://<brand.domain>@evil.com (external host).
  const next = safeInternalPath(requestUrl.searchParams.get('next'), '/dashboard')
  const origin = requestUrl.origin

  if (!code) {
    // No PKCE code → this isn't an OAuth handshake. It's almost certainly
    // a hash-fragment redirect (recovery / magic link) that was pointed at
    // /auth/callback by mistake — either an old email in someone's inbox
    // (sent before the redirect was switched to /auth/confirm) or some
    // other code path we missed.
    //
    // Hand off to /auth/confirm. The browser preserves the original URL
    // fragment across this redirect (since the new Location has none),
    // so #access_token=…&type=recovery will arrive at /auth/confirm
    // intact and the client there will parse it and route to
    // /reset-password. Genuine OAuth failures usually carry ?error=…
    // in the query string, which /auth/confirm also handles.
    const fallback = new URL('/auth/confirm', origin)
    requestUrl.searchParams.forEach((v, k) => fallback.searchParams.set(k, v))
    return NextResponse.redirect(fallback)
  }

  try {
    const supabase = await createClient()

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error || !data.user) {
      console.error('Auth callback: code exchange failed', error?.message)
      return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
    }

    // Password recovery: just exchange code and redirect, no profile setup
    const type = requestUrl.searchParams.get('type')
    if (type === 'recovery') {
      return NextResponse.redirect(`${origin}/reset-password`)
    }

    // Check if profile exists, create if not
    try {
      const existingProfile = await prisma.userProfile.findUnique({
        where: { supabaseId: data.user.id }
      })

      if (!existingProfile && data.user.email) {
        const metadata = data.user.user_metadata || {}
        // SECURITY: user_metadata is written by the account holder (the
        // public auth API stores any `options.data` sent at sign-up), so the
        // role is never read from it raw. readSignupMetadata holds it to
        // employer or job_seeker, as the other two creation paths do; admin
        // is granted by a direct database action only. This branch wrote
        // `metadata.role` as it came, which made any sign-up carrying
        // role 'admin' an admin (tests/regressions/auth-callback-role-allowlist.test.ts).
        const signup = readSignupMetadata(data.user)
        const signupRole = signup.role

        // SECURITY: the names, company and avatar come from the same
        // account-written metadata and were stored as sent: any length, any
        // type, the company of a job seeker too, and any avatar string. They
        // now go through readSignupMetadata (shared with
        // ensureProfileFromAuth) and readProviderFullName /
        // readProviderAvatarUrl from lib/auth/ensure-profile.ts, which clean
        // and bound them the way POST /api/auth/profile treats its body; the
        // company is kept for an employer only and the avatar only as the
        // Google picture of a Google sign-in.
        // tests/regressions/auth-metadata-sanitise.test.ts
        //
        // Handle both email signup metadata and Google OAuth metadata
        let firstName = signup.firstName
        let lastName = signup.lastName
        const avatarUrl = readProviderAvatarUrl(data.user)

        // For Google OAuth, parse full_name if firstName/lastName not provided
        if (!firstName && !lastName) {
          const fromFullName = readProviderFullName(data.user)
          firstName = fromFullName.firstName
          lastName = fromFullName.lastName
        }

        await prisma.userProfile.create({
          data: {
            supabaseId: data.user.id,
            email: data.user.email,
            firstName: firstName,
            lastName: lastName,
            role: signupRole,
            company: signup.company,
            avatarUrl: avatarUrl,
          }
        })

        // Sync new user to Beehiiv newsletter (fire-and-forget)
        syncToBeehiiv(data.user.email, { utmSource: 'google_signup' })

        // Create lead records (mirrors /api/auth/profile POST logic)
        try {
          if (signupRole === 'employer') {
            const existingEmployerLead = await prisma.employerLead.findFirst({
              where: { contactEmail: data.user.email },
            })
            if (!existingEmployerLead) {
              await prisma.employerLead.create({
                data: {
                  companyName: signup.company || `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown',
                  contactEmail: data.user.email,
                  contactName: [firstName, lastName].filter(Boolean).join(' ') || null,
                  source: 'google_signup',
                  status: 'prospect',
                },
              })
            }
          } else {
            // Job seekers → email_leads. B73: newsletter opt-in requires the
            // same explicit consent as the email signup flow — SignUpForm
            // stashes a `newsletter_opt_in` checkbox value in auth metadata,
            // and readSignupMetadata (lib/auth/ensure-profile.ts) treats
            // absent metadata as opted OUT. Google OAuth carries no such
            // checkbox, so OAuth signups default to newsletterOptIn: false
            // instead of being silently subscribed. Mirrors ensure-profile's
            // "never downgrade an existing opt-in" update semantics.
            const newsletterConsent = metadata.newsletter_opt_in === true
            await prisma.emailLead.upsert({
              where: { email: data.user.email },
              update: {
                isSubscribed: true,
                newsletterOptIn: newsletterConsent ? true : undefined,
              },
              create: {
                email: data.user.email,
                source: 'google_signup',
                isSubscribed: true,
                newsletterOptIn: newsletterConsent,
              },
            })
          }
        } catch (leadError) {
          console.error('Failed to create lead for Google user', leadError)
        }

        // Auto-create daily job alert for job seekers (only if none exists)
        if (signupRole === 'job_seeker') {
          try {
            const existingAlert = await prisma.jobAlert.findFirst({
              where: { email: data.user.email },
            })
            if (!existingAlert) {
              await prisma.jobAlert.create({
                data: {
                  email: data.user.email,
                  name: 'Job Highlights',
                  keyword: null,
                  location: null,
                  mode: null,
                  jobType: null,
                  minSalary: null,
                  maxSalary: null,
                  frequency: 'daily',
                  isActive: true,
                  // Single opt-in: account creation is the consent event. The
                  // digest cron only sends to alerts with confirmedAt set, so
                  // leaving it null makes this alert permanently invisible.
                  confirmedAt: new Date(),
                  token: crypto.randomUUID(),
                }
              })
            }
          } catch (e) {
            console.error('Failed to create auto job alert for Google user', e)
          }
        }

        // Send welcome email for first-time Google OAuth users only
        try {
          await sendSignupWelcomeEmail(data.user.email, firstName || '', signupRole)
        } catch (emailError) {
          console.error('Failed to send welcome email', emailError)
        }
      } // end of if (!existingProfile)
    } catch (profileError) {
      // Don't block login if profile creation fails
      console.error('Auth callback: profile creation error', profileError)
    }

    // Send welcome email (dedup: only if not already sent)
    if (data.user.email) {
      try {
        const alreadySent = await prisma.emailSend.findFirst({
          where: { to: data.user.email, emailType: 'welcome_signup' },
        })
        if (!alreadySent) {
          const profile = await prisma.userProfile.findUnique({
            where: { supabaseId: data.user.id },
            select: { firstName: true, role: true },
          })
          // With no profile name to use, fall back to the sign-up metadata as
          // readSignupMetadata cleans and bounds it, never the raw value.
          // Cleaning is not HTML escaping: the email escapes the name where
          // it writes it into HTML (sendSignupWelcomeEmail).
          const signup = readSignupMetadata(data.user)
          await sendSignupWelcomeEmail(
            data.user.email,
            profile?.firstName || signup.firstName || '',
            profile?.role || signup.role
          )
          console.log('Welcome email sent', { userId: data.user.id })
        }
      } catch (welcomeErr) {
        console.error('Failed to send welcome email', welcomeErr)
      }
    }

    // Auto-link legacy jobs (e.g. guest posts) to this user
    if (data.user?.email) {
      // SECURITY: this hands every unclaimed job filed under the address, and
      // its applicants, to the session, and the address proves ownership only
      // once Supabase has confirmed it (the relink in ensureProfileFromAuth
      // makes the same check). A session let in on an unverified address
      // claimed them all. Every legitimate session carries the stamp, so a
      // refused claim waits for a confirmed sign-in to the address.
      // tests/regressions/auth-callback-legacy-claim-confirmed-email.test.ts
      if (data.user.email_confirmed_at) {
        try {
          await prisma.employerJob.updateMany({
            where: {
              contactEmail: data.user.email,
              userId: null,
            },
            data: {
              userId: data.user.id,
            },
          })
        } catch (e) {
          console.error('Failed to link legacy jobs', e)
        }
      } else {
        console.warn('Auth callback: legacy job link skipped, email not confirmed', { userId: data.user.id })
      }
    }

    // If 'next' parameter is explicitly provided, use it
    if (requestUrl.searchParams.has('next')) {
      return NextResponse.redirect(`${origin}${next}`)
    }

    // Otherwise, redirect based on role
    const profile = await prisma.userProfile.findUnique({
      where: { supabaseId: data.user.id }
    })

    if (profile?.role === 'admin') {
      return NextResponse.redirect(`${origin}/admin/jobs`)
    } else if (profile?.role === 'employer') {
      return NextResponse.redirect(`${origin}/employer/dashboard`)
    } else {
      // Seekers land in the post-signup interstitial unless their profile is
      // already detailed enough to be embedded by the AI matcher. The page
      // itself enforces this — sending everyone there is intentional so we
      // also catch users who skipped onboarding on a previous session.
      return NextResponse.redirect(`${origin}/onboarding/professional`)
    }
  } catch (e) {
    console.error('Auth callback: unexpected error', e)
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }
}

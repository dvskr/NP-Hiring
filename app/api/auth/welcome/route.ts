import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { sendSignupWelcomeEmail } from '@/lib/email-service'
import { logger } from '@/lib/logger'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/auth/welcome
 *
 * Sends the welcome email after email confirmation.
 * Called from /auth/confirm after successful verification.
 *
 * Protection against abuse:
 * 1. Session required: the recipient is ALWAYS the signed-in user's own,
 *    confirmed address. Any email in the body is ignored, so an anonymous
 *    caller gets the same 401 for every address (no account-existence
 *    oracle) and nobody can trigger mail to someone else.
 * 2. Profile check: only sends to users with an existing UserProfile
 * 3. Dedup: only sends once per email (checks EmailSend table)
 */
export async function POST(request: NextRequest) {
  // Rate limiting
  const rateLimitResult = await rateLimit(request, 'auth-welcome', RATE_LIMITS.auth);
  if (rateLimitResult) return rateLimitResult;

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user?.email || !user.email_confirmed_at) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = user.email.toLowerCase().trim()

    // Must have a profile (proves they signed up)
    const profile = await prisma.userProfile.findFirst({
      where: { supabaseId: user.id },
      select: { firstName: true, role: true },
    })

    if (!profile) {
      return NextResponse.json({ sent: false })
    }

    // Dedup — check if welcome email was already sent
    const alreadySent = await prisma.emailSend.findFirst({
      where: { to: email, emailType: 'welcome_signup' },
    })

    if (alreadySent) {
      return NextResponse.json({ sent: false })
    }

    await sendSignupWelcomeEmail(email, profile.firstName || '', profile.role || 'job_seeker')
    logger.info('Welcome email sent after email confirmation', { role: profile.role })

    return NextResponse.json({ sent: true })
  } catch (error) {
    logger.error('Error sending post-confirmation welcome email', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

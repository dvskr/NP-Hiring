import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { syncToBeehiiv, unsubscribeFromBeehiiv } from '@/lib/beehiiv'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/newsletter — Capture email for newsletter
 * Body: { email: string, source?: string, optIn?: boolean }
 *
 * Upserts EmailLead: creates if new, flips newsletterOptIn if exists.
 *
 * Opting IN stays public: the blog signup and the resource download gate
 * post here signed out. Opting OUT needs a signed-in session whose own
 * address is the one posted (see the SECURITY note in the opt-out branch).
 * Signed-out unsubscribes go through the token routes under /api/email.
 */
export async function POST(request: NextRequest) {
    // Rate limiting
    const rateLimitResult = await rateLimit(request, 'jobAlerts', RATE_LIMITS.jobAlerts)
    if (rateLimitResult) return rateLimitResult

    try {
        const body = await request.json()
        const { email, source, optIn = true } = body

        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!email || typeof email !== 'string' || !emailRegex.test(email.trim())) {
            return NextResponse.json(
                { success: false, error: 'Please enter a valid email address' },
                { status: 400 }
            )
        }

        // SECURITY: the branch used to be picked by truthiness, so 0, '' and
        // null opted an address out and the string 'false' opted it in. Only
        // a real boolean (or no optIn, which subscribes) is accepted.
        // tests/api/newsletter-optout-session.test.ts
        if (typeof optIn !== 'boolean') {
            return NextResponse.json(
                { success: false, error: 'optIn must be true or false' },
                { status: 400 }
            )
        }

        const normalizedEmail = email.trim().toLowerCase()

        if (optIn) {
            // Subscribe: create if new, set true if exists
            await prisma.emailLead.upsert({
                where: { email: normalizedEmail },
                update: { newsletterOptIn: true },
                create: {
                    email: normalizedEmail,
                    source: source || 'newsletter',
                    newsletterOptIn: true,
                },
            })

            // Sync to Beehiiv newsletter (fire-and-forget)
            syncToBeehiiv(normalizedEmail, { utmSource: source || 'newsletter' })
        } else {
            // SECURITY: this branch took the address from an anonymous body,
            // so anyone could take any subscriber off the newsletter here and
            // in Beehiiv. Only the two signed-in settings toggles send
            // optIn false, so it now needs a confirmed session whose own
            // address is the one posted (401 without one, 403 for another
            // address), checked before either write. A getUser error fails
            // closed. tests/api/newsletter-optout-session.test.ts
            const supabase = await createClient()
            const { data: { user }, error: authError } = await supabase.auth.getUser()
            if (authError || !user?.email || !user.email_confirmed_at) {
                return NextResponse.json(
                    { success: false, error: 'Authentication required' },
                    { status: 401 }
                )
            }
            if (user.email.trim().toLowerCase() !== normalizedEmail) {
                return NextResponse.json(
                    { success: false, error: 'You can only change the newsletter setting for your own email' },
                    { status: 403 }
                )
            }

            // Unsubscribe: set false if exists (don't create)
            await prisma.emailLead.update({
                where: { email: normalizedEmail },
                data: { newsletterOptIn: false },
            }).catch(() => {
                // Ignore if not found
            })

            // Also push to Beehiiv so they actually stop receiving emails.
            // Fire-and-forget — DB write is the source of truth for the UI.
            unsubscribeFromBeehiiv(normalizedEmail)
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Newsletter signup error:', error)
        return NextResponse.json(
            { success: false, error: 'Something went wrong. Please try again.' },
            { status: 500 }
        )
    }
}

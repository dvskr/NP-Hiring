import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/newsletter/status?email=...  — The signed-in user's own newsletter
 * opt-in. Callers: the candidate and employer settings toggles, which pass
 * their own profile email.
 *
 * SECURITY: this answered for any ?email= with no session, so anyone could
 * confirm that a named address subscribes (the rate limit only slowed the
 * probing). It now needs a confirmed session; a getUser error fails closed.
 * The lookup is keyed on the session's own address, never on the parameter,
 * and a parameter naming another address is refused (403) before any lookup.
 * The answer depends on the cookie, so it is marked no-store.
 * tests/api/newsletter-status-session.test.ts
 */
export async function GET(request: NextRequest) {
    const limited = await rateLimit(request, 'newsletter-status', RATE_LIMITS.general)
    if (limited) return limited

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user?.email || !user.email_confirmed_at) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const sessionEmail = user.email.trim().toLowerCase()
    const requested = request.nextUrl.searchParams.get('email')?.trim().toLowerCase()
    if (requested && requested !== sessionEmail) {
        return NextResponse.json(
            { error: 'You can only check the newsletter setting for your own email' },
            { status: 403 }
        )
    }

    const lead = await prisma.emailLead.findUnique({
        where: { email: sessionEmail },
        select: { newsletterOptIn: true },
    })

    return NextResponse.json(
        { optIn: lead?.newsletterOptIn ?? false },
        { headers: { 'Cache-Control': 'private, no-store' } }
    )
}

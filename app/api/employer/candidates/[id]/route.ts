import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { canUnlockCandidate, getEmployerTier } from '@/lib/tier-limits'
import { PricingTier } from '@/lib/config'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { mintResumeReadUrl, extractRequestContext } from '@/lib/resume-storage'
import { employerJobOwnershipBranches } from '@/lib/employer-ownership'
import { talentPoolWhere } from '@/lib/candidate-pool'
import { recordCandidateUnlock } from '@/lib/candidate-unlock'

/**
 * GET /api/employer/candidates/[id]: a candidate's page. An employer's first
 * open is the unlock: it spends one of an active posting's unlocks
 * (canUnlockCandidate) and returns the full profile in the same response. A
 * later open, or an admin's, spends nothing.
 *
 * SECURITY (owner, 2026-11-25): full access used to want an active featured
 * posting, which a new post here never is, so the first open spent the
 * unlock and returned the locked view; the profile came on the next load.
 * Full access is now the unlock row itself: never charged without being
 * delivered, never delivered without the row (lib/candidate-unlock.ts).
 * tests/api/employer-candidate-unlock.test.ts
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    // Rate limiting — without this, an authenticated employer could mass-scrape
    // candidate profiles by enumerating IDs. Same bucket as the list endpoint.
    const rateLimitResult = await rateLimit(req, 'employer:candidate-detail', RATE_LIMITS.employer)
    if (rateLimitResult) return rateLimitResult

    const { id } = await params

    // Auth check — employer or admin only
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const viewerProfile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id },
        select: { role: true },
    })

    if (!viewerProfile || (viewerProfile.role !== 'employer' && viewerProfile.role !== 'admin')) {
        return NextResponse.json({ error: 'Forbidden. This page is available to employers and administrators only.' }, { status: 403 })
    }

    // Determine access level: an admin by role, an employer by the unlock
    const isAdmin = viewerProfile.role === 'admin'

    // Check if this candidate was already unlocked (ProfileView exists)
    const existingView = await prisma.profileView.findUnique({
        where: {
            viewerId_candidateId: {
                viewerId: user.id,
                candidateId: id,
            },
        },
    })

    // Fetch candidate (privacy check: must be in the talent pool)
    const candidate = await prisma.userProfile.findFirst({
        where: { supabaseId: id, ...talentPoolWhere() },
    })

    if (!candidate) {
        return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    let chargePostingId: string | undefined
    let hasUnlockRow = !!existingView

    if (!existingView && !isAdmin) {
        // This is a new unlock — check per-posting credit pool + daily cap
        const tier = await getEmployerTier(user.id)
        const unlockCheck = await canUnlockCandidate(user.id, tier)
        if (!unlockCheck.allowed) {
            // Branch the message by reason — daily cap means "come back tomorrow",
            // posting cap means "buy another posting", no posting means "post first".
            const messages: Record<string, string> = {
                daily_cap: `Daily unlock cap reached (${unlockCheck.limit} per 24h). This safety limit protects candidate privacy. Please try again tomorrow.`,
                posting_cap: 'Candidate unlock limit reached for your active postings.',
                no_posting: 'You need at least one active job posting to unlock candidates.',
            };
            const reason = unlockCheck.reason || 'posting_cap';
            return NextResponse.json({
                error: messages[reason] || messages.posting_cap,
                reason,
                used: unlockCheck.used,
                limit: unlockCheck.limit,
                tier,
                upgradeRequired: reason === 'posting_cap',
            }, { status: 403 })
        }

        // 2026-05-15: prefer the client's selected posting (?postingId=) so
        // the unlock debits the posting the employer is watching on the
        // talent-pool counter. Without this, canUnlockCandidate picks
        // "newest active posting with headroom" — typically a different
        // posting — and the visible counter never moves even though the
        // unlock succeeded.
        //
        // Security guard: only honor a postingId that's actually owned by
        // this employer AND currently active. Otherwise fall through to
        // the auto-picker — never trust a client-supplied posting id
        // unverified.
        const requestedPostingId = req.nextUrl.searchParams.get('postingId') || null;
        if (requestedPostingId) {
            const ownsPosting = await prisma.employerJob.findFirst({
                where: {
                    id: requestedPostingId,
                    OR: employerJobOwnershipBranches(user),
                    job: { isPublished: true, expiresAt: { gt: new Date() } },
                },
                select: { id: true },
            });
            chargePostingId = ownsPosting ? requestedPostingId : unlockCheck.postingId;
        } else {
            chargePostingId = unlockCheck.postingId;
        }

        // The unlock this request records delivers the profile below, in this
        // same response. Without the row nothing is delivered.
        hasUnlockRow = await recordCandidateUnlock(user.id, id, chargePostingId || null)
        if (!hasUnlockRow) {
            return NextResponse.json({
                error: 'We could not unlock this profile just now. Please try again.',
                reason: 'unlock_failed',
            }, { status: 503 })
        }
    } else {
        // An earlier unlock, or an admin: a view, not a charge, so a failed
        // write only loses the viewedAt refresh.
        try {
            await prisma.profileView.upsert({
                where: {
                    viewerId_candidateId: {
                        viewerId: user.id,
                        candidateId: id,
                    },
                },
                update: { viewedAt: new Date() },
                create: {
                    viewerId: user.id,
                    candidateId: id,
                    employerJobId: null,
                },
            })
        } catch {
            // Don't fail the request if view tracking fails
        }
    }

    // Full access: an admin by role, an employer by the unlock row, which
    // every employer request that reaches this point holds.
    const hasFullAccess = isAdmin || hasUnlockRow

    // Tier is informational only (always 'pro' in single-tier model). Real gates
    // are isAdmin (admin-only fields) and hasFullAccess (unlock-gated fields).
    const tier: PricingTier = await getEmployerTier(user.id)

    // Privacy: full last name only for admins; everyone else sees first-initial only.
    const displayName = candidate.firstName
        ? `${candidate.firstName} ${isAdmin && candidate.lastName ? candidate.lastName : (candidate.lastName ? candidate.lastName.charAt(0) + '.' : '')}`.trim()
        : 'PMHNP Candidate'

    // Base fields — everyone sees these
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: Record<string, any> = {
        id: candidate.supabaseId,
        displayName,
        initials: `${(candidate.firstName || 'P').charAt(0)}${(candidate.lastName || 'C').charAt(0)}`.toUpperCase(),
        avatarUrl: candidate.avatarUrl,
        headline: candidate.headline,
        yearsExperience: candidate.yearsExperience,
        specialties: candidate.specialties ? candidate.specialties.split(',').map(s => s.trim()) : [],
        preferredWorkMode: candidate.preferredWorkMode,
        joinedAt: candidate.createdAt.toISOString(),
        tier,
        hasFullAccess,
    }

    // Unlock-gated fields — certifications, license, salary, availability.
    // Same gate as contact info (hasFullAccess) so the response is consistent.
    if (hasFullAccess) {
        response.certifications = candidate.certifications ? candidate.certifications.split(',').map(s => s.trim()) : []
        response.licenseStates = candidate.licenseStates ? candidate.licenseStates.split(',').map(s => s.trim()) : []
        response.availableDate = candidate.availableDate?.toISOString() || null
        response.hasResume = !!candidate.resumeUrl

        // Salary range — never show exact, round to nearest 5k
        if (candidate.desiredSalaryMin || candidate.desiredSalaryMax) {
            const roundTo5k = (n: number) => Math.round(n / 5000) * 5000
            const min = candidate.desiredSalaryMin ? roundTo5k(candidate.desiredSalaryMin) : null
            const max = candidate.desiredSalaryMax ? roundTo5k(candidate.desiredSalaryMax) : null
            if (min && max) {
                response.salaryRange = `$${(min / 1000).toFixed(0)}k to $${(max / 1000).toFixed(0)}k`
            } else if (min) {
                response.salaryRange = `$${(min / 1000).toFixed(0)}k+`
            } else if (max) {
                response.salaryRange = `Up to $${(max / 1000).toFixed(0)}k`
            }
        }
    }

    // Admin-only fields — bio, job type preference
    if (isAdmin) {
        response.bio = candidate.bio
        response.preferredJobType = candidate.preferredJobType
    }

    // hasFullAccess fields — resume download, email, LinkedIn (unchanged).
    // Resume URL goes through the centralized minter for audit logging
    // and 15-min default TTL.
    const freshResumeUrl = hasFullAccess
        ? await mintResumeReadUrl(candidate.resumeUrl, {
              actorId: user.id,
              ownerId: id,
              audience: isAdmin ? 'admin' : 'employer',
              action: 'view',
              ...extractRequestContext(req),
              reason: 'employer candidate detail page',
          })
        : null
    response.resumeUrl = freshResumeUrl
    response.contactEmail = hasFullAccess ? candidate.email : null
    response.linkedinUrl = hasFullAccess ? candidate.linkedinUrl : null

    return NextResponse.json(response)
}

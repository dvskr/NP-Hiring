import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getEmployerTier, getEmployerActivePostings } from '@/lib/tier-limits'
import { PricingTier } from '@/lib/config'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { parsePagination } from '@/app/api/jobs/pagination'
import {
    candidateAccessTier,
    candidateTextSearchClauses,
    seesPostingTierFields,
    talentPoolWhere,
} from '@/lib/candidate-pool'
import { disclosedPhoto, loadPhotoCheck } from '@/app/api/conversations/_lib/surname-disclosure'
import { signAvatarUrls } from '@/lib/avatar-url'

/**
 * Bounds on the search inputs. Each specialty or state term becomes its own
 * case-insensitive `contains` match against every candidate row, and q is
 * matched against up to nine columns, all of it twice (the page and the
 * count). The talent pool page sends at most its specialty presets and the 51
 * states (the 50 and DC), both under MAX_FILTER_TERMS, and a typed query far
 * shorter than MAX_QUERY_LENGTH.
 */
const MAX_QUERY_LENGTH = 200
const MAX_FILTER_TERMS = 60
const MAX_FILTER_TERM_LENGTH = 100
/** Past any real career, and inside the Int range of yearsExperience. */
const MAX_EXPERIENCE_YEARS = 100

/** A comma-separated list filter: trimmed terms, blanks dropped, each term and the count capped. */
function filterTerms(raw: string | null): string[] {
    if (!raw) return []
    return raw
        .split(',')
        .map(s => s.trim().slice(0, MAX_FILTER_TERM_LENGTH))
        .filter(Boolean)
        .slice(0, MAX_FILTER_TERMS)
}

export async function GET(req: NextRequest) {
    // Rate limit + Auth check — employer or admin only
    const rateLimitResponse = await rateLimit(req, 'employer:candidates', RATE_LIMITS.employer)
    if (rateLimitResponse) return rateLimitResponse

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.userProfile.findUnique({
        where: { supabaseId: user.id },
        select: { role: true },
    })

    if (!profile || !['employer', 'admin'].includes(profile.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Real gates: isAdmin (admin-only fields) and hasActivePosting (unlock-eligible
    // metadata). Tier value is informational only in the single-tier model.
    const isAdmin = profile.role === 'admin'
    const tier: PricingTier = await getEmployerTier(user.id)
    const hasActivePosting = isAdmin
        ? true
        : (await getEmployerActivePostings(user.id)).length > 0
    const access = candidateAccessTier({ isAdmin, hasActivePosting })

    // Parse query params.
    // SECURITY (EMP-CAND-1): Math.max(1, parseInt('abc')) is NaN, so ?page=abc
    // or ?limit=abc reached Prisma as a NaN skip or take and answered 500, and
    // q, workMode, experience and the list filters had no bounds. page and
    // limit go through the public job search's parser (the same defaults: page
    // 1, 20 per page, at most 50); the other inputs are capped above.
    // Pinned by tests/api/employer-candidates-search-inputs.test.ts.
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim().slice(0, MAX_QUERY_LENGTH) || ''
    const experience = searchParams.get('experience') // e.g. "3" for 3+ years
    const specList = filterTerms(searchParams.get('specialties')) // comma-separated
    const stateList = filterTerms(searchParams.get('states')) // comma-separated
    const workMode = searchParams.get('workMode')?.slice(0, MAX_FILTER_TERM_LENGTH)
    const hasResume = searchParams.get('hasResume') // "true" or "false"
    const { page, limit } = parsePagination(searchParams)
    const skip = (page - 1) * limit

    // Build WHERE clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = talentPoolWhere()

    // SECURITY: q matched surname, bio, state, city and certifications for
    // every employer, so a search confirmed fields the viewer cannot read.
    // It now matches only this viewer's fields: name, headline, specialties
    // and work mode (so "remote"/"hybrid"/"onsite" works) for everyone,
    // certifications with a posting, surname, bio and location for admins.
    // Pinned by tests/api/employer-candidate-search-scope.test.ts.
    if (q) {
        where.OR = candidateTextSearchClauses(q, access)
    }

    // Experience filter (minimum years): a whole number, held inside the Int
    // range of yearsExperience (parseInt let 99999999999 through to Prisma)
    if (experience && /^\d+$/.test(experience)) {
        where.yearsExperience = { gte: Math.min(Number(experience), MAX_EXPERIENCE_YEARS) }
    }

    // Specialties filter (any match)
    if (specList.length > 0) {
        where.AND = [
            ...(where.AND || []),
            {
                OR: specList.map(s => ({
                    specialties: { contains: s, mode: 'insensitive' as const },
                })),
            },
        ]
    }

    // Licensed states filter (any match). License states and the resume flag
    // are posting-tier fields, so without a posting these two filters are
    // ignored: applied, they would confirm the hidden values. Same test file.
    const mayFilterLocked = seesPostingTierFields(access)
    if (mayFilterLocked && stateList.length > 0) {
        where.AND = [
            ...(where.AND || []),
            {
                OR: stateList.map(s => ({
                    licenseStates: { contains: s, mode: 'insensitive' as const },
                })),
            },
        ]
    }

    // Work mode filter
    if (workMode) {
        where.preferredWorkMode = { contains: workMode, mode: 'insensitive' }
    }

    // Has resume filter
    if (mayFilterLocked && hasResume === 'true') {
        where.resumeUrl = { not: null }
    } else if (mayFilterLocked && hasResume === 'false') {
        where.resumeUrl = null
    }

    // ── Field selection by access level ──
    const baseSelect = {
        id: true,
        supabaseId: true,
        firstName: true,
        lastName: true,
        headline: true,
        yearsExperience: true,
        specialties: true,
        preferredWorkMode: true,
        avatarUrl: true,
        createdAt: true,
    }

    // Active-posting employers see unlock-eligible metadata for shopping
    const activeSelect = {
        ...baseSelect,
        certifications: true,
        licenseStates: true,
        desiredSalaryMin: true,
        desiredSalaryMax: true,
        desiredSalaryType: true,
        availableDate: true,
        resumeUrl: true,
    }

    // Admin-only — full profile including bio, location
    const adminSelect = {
        ...activeSelect,
        bio: true,
        preferredJobType: true,
        state: true,
        city: true,
    }

    const select = isAdmin ? adminSelect
        : hasActivePosting ? activeSelect
        : baseSelect

    // Query + fetch viewed candidates in parallel
    const [candidates, totalCount, viewedProfiles] = await Promise.all([
        prisma.userProfile.findMany({
            where,
            select,
            orderBy: { updatedAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.userProfile.count({ where }),
        prisma.profileView.findMany({
            where: { viewerId: user.id },
            select: { candidateId: true },
        }),
    ])

    const viewedCandidateIds = viewedProfiles.map(v => v.candidateId)
    // SECURITY: a photo shows once the employer unlocked the candidate or the
    // candidate applied to one of its jobs (conversations/_lib/surname-disclosure.ts).
    // tests/api/candidate-photo-disclosure.test.ts
    const photoShown = await loadPhotoCheck({ user, role: profile.role }, candidates.map(c => c.supabaseId))
    // Only a photo the rule shows is signed, as a link that expires (lib/avatar-url.ts).
    const photos = await signAvatarUrls(candidates.map(c => ({
        stored: disclosedPhoto(c.avatarUrl, photoShown(c.supabaseId)),
        ownerId: c.supabaseId,
    })))

    // Privacy transform: full last name only for admins; everyone else first-initial
    const results = candidates.map((c, i) => {
        const base = {
            id: c.supabaseId,
            displayName: c.firstName
                ? `${c.firstName} ${isAdmin && c.lastName ? c.lastName : (c.lastName ? c.lastName.charAt(0) + '.' : '')}`.trim()
                : 'PMHNP Candidate',
            headline: c.headline,
            yearsExperience: c.yearsExperience,
            specialties: c.specialties ? c.specialties.split(',').map(s => s.trim()) : [],
            preferredWorkMode: c.preferredWorkMode,
            avatarUrl: photos[i],
            initials: `${(c.firstName || 'P').charAt(0)}${(c.lastName || 'C').charAt(0)}`.toUpperCase(),
            joinedAt: c.createdAt.toISOString(),
        }

        // Unlock-eligible metadata — visible to anyone with an active posting
        if (hasActivePosting) {
            const activeData = c as typeof c & {
                certifications?: string | null;
                licenseStates?: string | null;
                desiredSalaryMin?: number | null;
                desiredSalaryMax?: number | null;
                desiredSalaryType?: string | null;
                availableDate?: Date | null;
                resumeUrl?: string | null;
            }
            Object.assign(base, {
                certifications: activeData.certifications ? activeData.certifications.split(',').map(s => s.trim()) : [],
                licenseStates: activeData.licenseStates ? activeData.licenseStates.split(',').map(s => s.trim()) : [],
                desiredSalaryMin: activeData.desiredSalaryMin,
                desiredSalaryMax: activeData.desiredSalaryMax,
                desiredSalaryType: activeData.desiredSalaryType,
                availableDate: activeData.availableDate?.toISOString() || null,
                hasResume: !!activeData.resumeUrl,
            })
        }

        // Admin-only fields
        if (isAdmin) {
            const adminData = c as typeof c & {
                bio?: string | null;
                preferredJobType?: string | null;
                state?: string | null;
                city?: string | null;
            }
            Object.assign(base, {
                bio: adminData.bio,
                preferredJobType: adminData.preferredJobType,
                state: adminData.state,
                city: adminData.city,
            })
        }

        return base
    })

    return NextResponse.json({
        candidates: results,
        totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit),
        tier,
        viewedCandidateIds,
    })
}

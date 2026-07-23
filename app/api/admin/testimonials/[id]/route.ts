import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logger } from '@/lib/logger';

/**
 * PATCH /api/admin/testimonials/:id
 *
 * Admin review actions for employer testimonials (backlog B8):
 *   { featured: true }   → approve for public display (stamps featuredAt)
 *   { featured: false }  → pull from public display (clears featuredAt)
 *   { displayAs: 'full' | 'initial' | 'anonymous' } → narrow attribution
 *
 * Consent semantics — must match the write path in
 * app/api/employer/testimonials/route.ts:
 *   - Only testimonials submitted with consent === true may ever be
 *     featured. The write path refuses non-consented submissions, but the
 *     schema default is false, so this is enforced again here.
 *   - displayAs records HOW the employer agreed to be credited. Admins may
 *     only move it toward MORE privacy (full → initial → anonymous), never
 *     widen it beyond what was consented to. Narrowing overwrites the
 *     stored value, so it is deliberately one-way.
 */
const PRIVACY_RANK: Record<string, number> = {
    anonymous: 0,
    initial: 1,
    full: 2,
};

const TESTIMONIAL_SELECT = {
    id: true,
    userId: true,
    employerJobId: true,
    employerName: true,
    content: true,
    rating: true,
    consent: true,
    displayAs: true,
    featuredAt: true,
    createdAt: true,
} as const;

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    const { id } = await params;

    try {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            return NextResponse.json(
                { success: false, error: 'Invalid JSON body' },
                { status: 400 }
            );
        }

        const { featured, displayAs } = body as { featured?: unknown; displayAs?: unknown };

        if (featured === undefined && displayAs === undefined) {
            return NextResponse.json(
                { success: false, error: 'Nothing to update — pass featured and/or displayAs.' },
                { status: 400 }
            );
        }
        if (featured !== undefined && typeof featured !== 'boolean') {
            return NextResponse.json(
                { success: false, error: 'featured must be a boolean' },
                { status: 400 }
            );
        }
        if (
            displayAs !== undefined &&
            (typeof displayAs !== 'string' || !(displayAs in PRIVACY_RANK))
        ) {
            return NextResponse.json(
                { success: false, error: "displayAs must be one of 'full', 'initial', 'anonymous'" },
                { status: 400 }
            );
        }

        const existing = await prisma.employerTestimonial.findUnique({
            where: { id },
            select: TESTIMONIAL_SELECT,
        });
        if (!existing) {
            return NextResponse.json(
                { success: false, error: 'Testimonial not found' },
                { status: 404 }
            );
        }

        const data: { featuredAt?: Date | null; displayAs?: string } = {};

        if (featured === true) {
            // Consent gate — a non-consented row can never be featured.
            if (!existing.consent) {
                return NextResponse.json(
                    {
                        success: false,
                        error: 'This testimonial was submitted without public-display consent and cannot be featured.',
                    },
                    { status: 409 }
                );
            }
            // Keep the original approval date on repeat calls.
            if (!existing.featuredAt) data.featuredAt = new Date();
        } else if (featured === false) {
            data.featuredAt = null;
        }

        if (typeof displayAs === 'string') {
            const currentRank = PRIVACY_RANK[existing.displayAs] ?? PRIVACY_RANK.initial;
            if (PRIVACY_RANK[displayAs] > currentRank) {
                return NextResponse.json(
                    {
                        success: false,
                        error: `Cannot widen attribution beyond the employer's consented '${existing.displayAs}' setting — displayAs may only move toward more privacy.`,
                    },
                    { status: 400 }
                );
            }
            if (displayAs !== existing.displayAs) data.displayAs = displayAs;
        }

        // No-op (e.g. re-featuring an already-featured row) — return current state.
        if (Object.keys(data).length === 0) {
            return NextResponse.json({ success: true, testimonial: existing });
        }

        const testimonial = await prisma.employerTestimonial.update({
            where: { id },
            data,
            select: TESTIMONIAL_SELECT,
        });

        logger.info('[Admin Testimonials] updated', {
            id,
            featured: featured === undefined ? undefined : featured,
            displayAs: data.displayAs,
        });

        return NextResponse.json({ success: true, testimonial });
    } catch (error) {
        logger.error('[Admin Testimonials] PATCH error', error, { id });
        return NextResponse.json(
            { success: false, error: 'Failed to update testimonial' },
            { status: 500 }
        );
    }
}

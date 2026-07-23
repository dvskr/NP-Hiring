import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/admin/testimonials
 *
 * Admin review list for employer testimonials collected by
 * POST /api/employer/testimonials. This is the first half of the read
 * path (backlog B8): before this route existed the table was write-only
 * and featuredAt/displayAs were dead columns.
 *
 * Returns every submission (featured or not) newest-first so admins can
 * review who said what before approving anything for public display.
 */
export async function GET(request: NextRequest) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    try {
        const testimonials = await prisma.employerTestimonial.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
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
            },
        });

        return NextResponse.json({ success: true, testimonials });
    } catch (error) {
        logger.error('[Admin Testimonials] GET error', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch testimonials' },
            { status: 500 }
        );
    }
}

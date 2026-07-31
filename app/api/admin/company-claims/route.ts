import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logger } from '@/lib/logger';
import { CLAIM_SELECT } from './claim-select';

/**
 * GET /api/admin/company-claims
 *
 * Review queue for employer profile claims submitted by POST
 * /api/companies/claim. Mirrors the read half of /api/admin/testimonials:
 * everything is returned newest-first (pending and resolved alike) so an admin
 * can see what was decided as well as what is waiting.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    try {
        const claims = await prisma.companyClaim.findMany({
            orderBy: { createdAt: 'desc' },
            select: CLAIM_SELECT,
        });

        return NextResponse.json({ success: true, claims });
    } catch (error) {
        logger.error('[Admin Company Claims] GET error', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch company claims' },
            { status: 500 },
        );
    }
}

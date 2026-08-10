import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logger } from '@/lib/logger';
import { companySelect } from './company-select';

/**
 * GET /api/admin/companies
 *
 * The company roster for the direct-hire / staffing-agency classification
 * queue (teardown A6). Mirrors the read half of /api/admin/company-claims:
 * everything is returned in one page (~150 rows at 2026-08 scale — revisit
 * pagination if the roster ever grows past ~1,000).
 *
 * Rows are ordered by ACTIVE job count descending — the triage order for the
 * human classifier: classifying the top handful of companies covers the bulk
 * of live inventory. Prisma cannot ORDER BY a filtered relation count, so the
 * sort happens in memory over the small roster.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    try {
        const companies = await prisma.company.findMany({
            select: companySelect(),
        });

        const ranked = [...companies].sort(
            (a, b) => b._count.jobs - a._count.jobs || a.name.localeCompare(b.name),
        );

        return NextResponse.json({ success: true, companies: ranked });
    } catch (error) {
        logger.error('[Admin Companies] GET error', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch companies' },
            { status: 500 },
        );
    }
}

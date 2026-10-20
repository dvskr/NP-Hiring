import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { parsePagingParam } from '@/app/api/admin/jobs/_lib/job-input';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
/** Keeps (page - 1) * limit inside Prisma's safe skip range. */
const MAX_PAGE = 1_000_000;

/**
 * GET /api/admin/email/history
 * Returns a paginated list of past broadcasts.
 */
export async function GET(req: Request) {
    const authError = await requireApiAdmin(req);
    if (authError) return authError;

    const { searchParams } = new URL(req.url);
    // A bare parseInt sent NaN or a negative skip/take to Prisma (500), let
    // ?limit=100000000 return the whole table and ?limit=0 report Infinity
    // pages. Junk now falls back to the defaults, as in GET /api/admin/jobs
    // (tests/regressions/admin-query-params.test.ts).
    const page = parsePagingParam(searchParams.get('page'), 1, MAX_PAGE);
    const limit = parsePagingParam(searchParams.get('limit'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const skip = (page - 1) * limit;

    try {
        const [broadcasts, total] = await Promise.all([
            prisma.emailBroadcast.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    subject: true,
                    audience: true,
                    audienceCount: true,
                    status: true,
                    sentAt: true,
                    sentCount: true,
                    failedCount: true,
                    scheduledFor: true,
                    createdAt: true,
                },
            }),
            prisma.emailBroadcast.count(),
        ]);

        return NextResponse.json({
            success: true,
            broadcasts,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('[Admin Email History] Error:', error);
        return NextResponse.json({ success: false, error: 'Failed to fetch history' }, { status: 500 });
    }
}

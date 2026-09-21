import { NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logger } from '@/lib/logger';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/admin/cron-list
 * Lists the cron schedule declared in vercel.json.
 *
 * Gated by requireApiAdmin (401/403/429 JSON). The page helper requireAdmin()
 * throws a NEXT_REDIRECT, which the old try/catch turned into a 500 that
 * leaked the redirect digest to anonymous and non-admin callers.
 */
export async function GET(request: Request) {
    const authError = await requireApiAdmin(request);
    if (authError) return authError;

    try {
        const vercelJsonPath = path.join(process.cwd(), 'vercel.json');

        if (!fs.existsSync(vercelJsonPath)) {
            return NextResponse.json({ crons: [] });
        }

        const vercelJson = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf-8'));

        return NextResponse.json({
            crons: Array.isArray(vercelJson.crons) ? vercelJson.crons : [],
        });
    } catch (err) {
        logger.error('[Admin cron-list] failed to read vercel.json', err);
        return NextResponse.json({ error: 'Failed to load cron list' }, { status: 500 });
    }
}

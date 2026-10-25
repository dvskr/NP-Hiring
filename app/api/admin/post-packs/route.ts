/**
 * GET /api/admin/post-packs — every 5-post pack, newest first, for the
 * /admin/post-packs back office (2027 re-price, phase 3; plan section 3.9).
 *
 *   { success: true, packs: AdminPackView[] }   lib/post-pack-admin.ts
 *
 * Admin only (requireApiAdmin, which also applies the admin rate limit),
 * bounded by MAX_ADMIN_PACKS_LISTED, and read only. The changes an admin can
 * make to one pack are PATCH /api/admin/post-packs/:id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logger } from '@/lib/logger';
import { ADMIN_PACK_SELECT, MAX_ADMIN_PACKS_LISTED, toAdminPackView } from '@/lib/post-pack-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requireApiAdmin(request);
  if (authError) return authError;

  try {
    const now = new Date();
    const rows = await prisma.employerPostPack.findMany({
      orderBy: { purchasedAt: 'desc' },
      take: MAX_ADMIN_PACKS_LISTED,
      select: ADMIN_PACK_SELECT,
    });
    return NextResponse.json({ success: true, packs: rows.map((row) => toAdminPackView(row, now)) });
  } catch (error) {
    logger.error('[Admin Post Packs] GET error', error);
    return NextResponse.json({ success: false, error: 'Failed to load the packs' }, { status: 500 });
  }
}

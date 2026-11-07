/**
 * GET /api/admin/guides?email= : guides store purchases for the /admin/guides
 * back office, newest first.
 *
 *   { success: true, purchases: AdminGuidePurchaseView[] }   lib/guides/admin.ts
 *
 * Admin only (requireApiAdmin, which also applies the admin rate limit),
 * bounded by MAX_ADMIN_GUIDE_PURCHASES_LISTED, and read only. With ?email=
 * the list holds only that reader's purchases, matched in any case; a value
 * that cannot be an address answers 400. No view carries an access token.
 * The one change an admin can make is POST /api/admin/guides/:id/rotate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { logger } from '@/lib/logger';
import { listGuidePurchases } from '@/lib/guides/admin';

export const dynamic = 'force-dynamic';

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiAdmin(request);
  if (authError) return authError;

  try {
    const result = await listGuidePurchases(request.nextUrl.searchParams.get('email'));
    if (!result.ok) return noStore(NextResponse.json({ success: false, error: result.error }, { status: 400 }));
    return noStore(NextResponse.json({ success: true, purchases: result.purchases }));
  } catch (error) {
    logger.error('[Admin Guides] GET error', error);
    return noStore(NextResponse.json({ success: false, error: 'Failed to load the purchases' }, { status: 500 }));
  }
}

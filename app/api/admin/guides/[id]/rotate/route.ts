/**
 * POST /api/admin/guides/:id/rotate : give one guides store purchase a new
 * library link and email it to the reader (register 2.35).
 *
 *   { success: true, purchase: AdminGuidePurchaseView, delivery }
 *   delivery: 'sent' | 'retry' | 'refused' | 'no-address' | 'blocked' (refunded or disputed: no email)
 *
 * The new access token cuts off the old link and every browser holding it
 * (lib/guides/admin.ts#rotateGuideAccess). The link is replaced even when the
 * email does not go, so any delivery other than 'sent' still answers 200.
 * An unknown id answers 404. Admin only (requireApiAdminActor: the admin
 * gate, its rate limit and the admin's id for the audit trail), CSRF checked
 * here as well as in middleware. No body is read. Each rotation is audit
 * logged ('guide_purchase.rotate_access'); neither the audit entry nor the
 * log line carries the token or the reader's email.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireApiAdminActor } from '@/lib/auth/require-api-admin';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { stringField } from '@/lib/request-body';
import { rotateGuideAccess } from '@/lib/guides/admin';

export const dynamic = 'force-dynamic';

/** A purchase id is a cuid; anything longer is not one. */
const MAX_PURCHASE_ID_LENGTH = 64;

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

function requestMeta(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  return { ip, userAgent: request.headers.get('user-agent') };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { error: authError, actor } = await requireApiAdminActor(request);
  if (authError) return authError;

  // Defence in depth: middleware.ts already gates every /api/* mutation.
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const purchaseId = stringField((await params).id, MAX_PURCHASE_ID_LENGTH);
  if (!purchaseId) return jsonError('Purchase not found', 404);

  try {
    const rotation = await rotateGuideAccess(purchaseId);
    if (!rotation) return jsonError('Purchase not found', 404);

    await logAudit({
      action: 'guide_purchase.rotate_access',
      actorType: 'admin',
      actorId: actor.profileId,
      targetType: 'guide_purchase',
      targetId: purchaseId,
      ...requestMeta(request),
      metadata: { delivery: rotation.delivery },
    });
    logger.info('[Admin Guides] library link replaced', { purchaseId, delivery: rotation.delivery });

    const res = NextResponse.json({ success: true, purchase: rotation.purchase, delivery: rotation.delivery });
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  } catch (error) {
    logger.error('[Admin Guides] rotate error', error, { purchaseId });
    return jsonError('Failed to set a new link', 500);
  }
}

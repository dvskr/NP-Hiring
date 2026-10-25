/**
 * PATCH /api/admin/post-packs/:id — one change to one 5-post pack (2027
 * re-price, phase 3; plan section 3.9):
 *
 *   { action: 'revoke', credits? }        take back unused posts (all by default)
 *   { action: 'extend', useBy }           a later "Use by" date, YYYY-MM-DD
 *   { action: 'restore' }                 give back one post the pack spent
 *
 * Admin only (requireApiAdminActor: the admin gate and its rate limit, plus
 * the admin's id for the audit trail), CSRF checked here as well as in
 * middleware, and the body read through lib/request-body.ts and a strict zod
 * schema: only these three shapes pass. lib/post-pack-admin.ts#planPackChange
 * decides the write, a compare-and-set on what it was planned from; a write
 * that matches nothing answers 409. Each change is audit logged
 * ('post_pack.<action>') with the counters and expiry before and after.
 * Refunded and disputed packs are left to the Stripe webhook. Stripe is
 * never called from here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireApiAdminActor } from '@/lib/auth/require-api-admin';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { readJsonObject, stringField } from '@/lib/request-body';
import { ADMIN_PACK_SELECT, planPackChange, toAdminPackView, type PackCounters } from '@/lib/post-pack-admin';

export const dynamic = 'force-dynamic';

/** A pack id is a uuid; anything longer is not one. */
const MAX_PACK_ID_LENGTH = 64;

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('revoke'), credits: z.number().int().min(1).optional() }),
  z.strictObject({ action: z.literal('extend'), useBy: z.string().min(1).max(10) }),
  z.strictObject({ action: z.literal('restore') }),
]);

const BODY_HELP = 'Pass { action: "revoke", credits? }, { action: "extend", useBy: "YYYY-MM-DD" } or { action: "restore" }.';

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

function requestMeta(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  return { ip, userAgent: request.headers.get('user-agent') };
}

const countersForAudit = (counters: PackCounters) => ({
  creditsRemaining: counters.creditsRemaining,
  creditsRevoked: counters.creditsRevoked,
  expiresAt: counters.expiresAt.toISOString(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error: authError, actor } = await requireApiAdminActor(request);
  if (authError) return authError;

  // Defence in depth: middleware.ts already gates every /api/* mutation.
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const packId = stringField((await params).id, MAX_PACK_ID_LENGTH);
  if (!packId) return jsonError('Pack not found', 404);

  const body = await readJsonObject(request);
  const parsed = body ? bodySchema.safeParse(body) : null;
  if (!parsed?.success) return jsonError(`Invalid request. ${BODY_HELP}`, 400);
  const change = parsed.data;

  try {
    const pack = await prisma.employerPostPack.findUnique({ where: { id: packId }, select: ADMIN_PACK_SELECT });
    if (!pack) return jsonError('Pack not found', 404);

    const now = new Date();
    const plan = planPackChange(pack, change, now);
    if (!plan.ok) return jsonError(plan.error, plan.status);

    const { count } = await prisma.employerPostPack.updateMany({ where: plan.where, data: plan.data });
    if (count !== 1) return jsonError('This pack changed while you were editing it. Reload and try again.', 409);

    const updated = await prisma.employerPostPack.findUnique({ where: { id: packId }, select: ADMIN_PACK_SELECT });
    if (!updated) return jsonError('Pack not found', 404);

    await logAudit({
      action: `post_pack.${change.action}`,
      actorType: 'admin',
      actorId: actor.profileId,
      targetType: 'post_pack',
      targetId: packId,
      ...requestMeta(request),
      metadata: {
        email: pack.email,
        userId: pack.userId,
        ...(change.action === 'revoke' && { credits: plan.next.creditsRevoked - plan.previous.creditsRevoked }),
        previous: countersForAudit(plan.previous),
        next: countersForAudit(plan.next),
      },
    });
    logger.info('[Admin Post Packs] changed', { packId, action: change.action });

    return NextResponse.json({ success: true, pack: toAdminPackView(updated, now) });
  } catch (error) {
    logger.error('[Admin Post Packs] PATCH error', error, { packId });
    return jsonError('Failed to update the pack', 500);
  }
}

/**
 * PATCH /api/admin/employer-plans/:id
 *
 *   { status?, slots?, currentPeriodEnd?, userId?, userEmail? }
 *
 * Edits one plan row in place. `userId` attaches the row to an employer
 * account directly; `userEmail` does the same by resolving an employer
 * profile (case-insensitive, role 'employer') server-side — this is the
 * "attach by email" action the admin page offers for rows the Stripe
 * webhook could not match. `userEmail` is additive to the documented
 * contract; the client never needs a user-lookup endpoint.
 *
 * After the write the employer's postings follow the new state exactly as
 * they would after the Stripe webhook (see applyPlanStateToPosts):
 * entitled → paused plan posts come back; cancelled → live plan posts are
 * paused now and the employer is told.
 *
 * Stripe is never called from here. A Stripe-sourced row edited by an admin
 * stays `source: 'stripe'`; the next subscription webhook overwrites status
 * and period end again, which is the intended precedence — Stripe is the
 * billing truth for rows it owns, admin edits are for attaching and for
 * rows the admin created.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import {
  PLAN_SELECT,
  applyPlanStateToPosts,
  currentAdminId,
  emailSchema,
  findEmployerByEmail,
  periodEndSchema,
  planStatusSchema,
  slotsSchema,
  withUsage,
} from '../plan-admin';

const patchSchema = z
  .object({
    status: planStatusSchema.optional(),
    slots: slotsSchema.optional(),
    currentPeriodEnd: periodEndSchema.optional(),
    userId: z.string().trim().min(1).max(64).optional(),
    userEmail: emailSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' })
  .refine((v) => !(v.userId && v.userEmail), { message: 'Pass userId or userEmail, not both' });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // requireApiAdmin also applies the admin rate limit (20/min per IP).
  const authError = await requireApiAdmin(request);
  if (authError) return authError;

  // Defence in depth — middleware.ts already gates every /api/* mutation.
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const { id } = await params;

  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid request — pass { status?, slots?, currentPeriodEnd?, userId?, userEmail? }.',
        details: err instanceof Error ? err.message : 'unknown',
      },
      { status: 400 },
    );
  }

  const actorId = await currentAdminId();

  try {
    const existing = await prisma.employerPlan.findUnique({ where: { id }, select: PLAN_SELECT });
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }

    let userId: string | undefined = parsed.userId;
    if (parsed.userEmail) {
      const employer = await findEmployerByEmail(parsed.userEmail);
      if (!employer) {
        return NextResponse.json(
          { success: false, error: 'No employer account with that email — ask them to sign up first, then attach.' },
          { status: 404 },
        );
      }
      userId = employer.supabaseId;
    }

    const updated = await prisma.employerPlan.update({
      where: { id },
      data: {
        ...(parsed.status !== undefined && { status: parsed.status }),
        ...(parsed.slots !== undefined && { slots: parsed.slots }),
        ...(parsed.currentPeriodEnd !== undefined && { currentPeriodEnd: parsed.currentPeriodEnd }),
        ...(userId !== undefined && { userId }),
      },
      select: PLAN_SELECT,
    });

    const effects = await applyPlanStateToPosts(updated);

    await logAudit({
      action: 'employer_plan.update',
      actorType: 'admin',
      actorId,
      targetType: 'employer_plan',
      targetId: id,
      metadata: {
        previous: {
          status: existing.status,
          slots: existing.slots,
          currentPeriodEnd: existing.currentPeriodEnd.toISOString(),
          userId: existing.userId,
        },
        next: {
          status: updated.status,
          slots: updated.slots,
          currentPeriodEnd: updated.currentPeriodEnd.toISOString(),
          userId: updated.userId,
        },
        ...effects,
      },
    });

    logger.info('[Admin Employer Plans] updated', { planId: id, status: updated.status, attached: updated.userId !== null, ...effects });

    const [view] = await withUsage([updated]);
    return NextResponse.json({ success: true, plan: view });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'P2002') {
      // userId is unique — that employer already owns another plan row.
      return NextResponse.json(
        { success: false, error: 'That employer already has a different plan row — cancel or edit that one instead.' },
        { status: 409 },
      );
    }
    logger.error('[Admin Employer Plans] PATCH error', error, { id });
    return NextResponse.json({ success: false, error: 'Failed to update plan' }, { status: 500 });
  }
}

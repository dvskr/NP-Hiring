/**
 * /api/admin/employer-plans
 *
 * GET  — every Employer plan row, newest-first, with live slot usage and the
 *        computed entitlement so the admin page can show "3 of 5 used" and
 *        "lapsed" without re-deriving the rule.
 * POST — grant or attach a plan by hand:
 *          { email, userId?, slots?, currentPeriodEnd?, status? }
 *        The email is resolved to an employer account (case-insensitive,
 *        role 'employer') unless a userId is passed explicitly. Writes via
 *        `upsertPlan(source: 'admin')`, which reuses an existing row for the
 *        same subscription / user / unattached email — so this is ALSO the
 *        "attach the unmatched Stripe row" path: post the Stripe email and a
 *        matching employer account and the orphan row gains its userId.
 *
 * Why an admin path at all: a plan checkout that carried no employer account
 * reference is stored unattached and alerted; a human has to finish the
 * match. It also lets the owner comp a plan for a partner without touching
 * Stripe.
 *
 * Stripe-billed rows: a row with a stripeSubscriptionId is owned by Stripe.
 * A grant may ATTACH such a row (set its userId) but never changes its
 * status, period end, slots or Stripe ids — that request is refused with
 * 409 (use PATCH). Overwriting them would sever the webhook link of a paying
 * subscription and let the lapse sweep unpublish a paying customer's posts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireApiAdmin } from '@/lib/auth/require-api-admin';
import { verifyCsrf } from '@/lib/csrf';
import { logAudit } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { findExistingPlanRow, upsertPlan } from '@/lib/employer-plan';
import {
  PLAN_SELECT,
  DEFAULT_PLAN_SLOTS,
  applyPlanStateToPosts,
  currentAdminId,
  defaultGrantPeriodEnd,
  emailSchema,
  findEmployerByEmail,
  periodEndSchema,
  planStatusSchema,
  slotsSchema,
  withUsage,
} from './plan-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requireApiAdmin(request);
  if (authError) return authError;

  try {
    const rows = await prisma.employerPlan.findMany({
      orderBy: { createdAt: 'desc' },
      select: PLAN_SELECT,
    });
    const plans = await withUsage(rows);
    return NextResponse.json({ success: true, plans });
  } catch (error) {
    logger.error('[Admin Employer Plans] GET error', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch employer plans' }, { status: 500 });
  }
}

const createSchema = z.object({
  email: emailSchema,
  userId: z.string().trim().min(1).max(64).optional(),
  slots: slotsSchema.optional(),
  currentPeriodEnd: periodEndSchema.optional(),
  status: planStatusSchema.optional(),
});

export async function POST(request: NextRequest) {
  // requireApiAdmin also applies the admin rate limit (20/min per IP).
  const authError = await requireApiAdmin(request);
  if (authError) return authError;

  // Defence in depth — middleware.ts already gates every /api/* mutation.
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  let parsed: z.infer<typeof createSchema>;
  try {
    parsed = createSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid request — pass { email, userId?, slots?, currentPeriodEnd?, status? }.',
        details: err instanceof Error ? err.message : 'unknown',
      },
      { status: 400 },
    );
  }

  const actorId = await currentAdminId();

  try {
    // Resolve the employer. An explicit userId wins; otherwise match the
    // email. No match is allowed — the row is stored unattached, exactly
    // like the webhook does, so an admin can grant ahead of signup.
    const matched = parsed.userId ? null : await findEmployerByEmail(parsed.email);
    const userId = parsed.userId ?? matched?.supabaseId ?? null;

    const target = await findExistingPlanRow({ stripeSubscriptionId: null, userId, email: parsed.email.toLowerCase() });
    const stripeRow = target?.row.stripeSubscriptionId ? target.row : null;
    if (stripeRow) {
      const changesBilling = parsed.status !== undefined || parsed.currentPeriodEnd !== undefined || parsed.slots !== undefined;
      const attachesOrphan = stripeRow.userId === null && userId !== null;
      if (changesBilling || !attachesOrphan) {
        return NextResponse.json(
          {
            success: false,
            error: 'This plan is billed through Stripe, which owns its status and period end. Use the plan\'s edit action (PATCH) to attach it or adjust slots instead of granting.',
            planId: stripeRow.id,
          },
          { status: 409 },
        );
      }
    }

    // For a Stripe row this is attach-only: upsertPlan keeps its status,
    // period end, Stripe ids and `source: 'stripe'`.
    const plan = await upsertPlan({
      userId,
      email: parsed.email,
      status: parsed.status ?? 'active',
      currentPeriodEnd: parsed.currentPeriodEnd ?? defaultGrantPeriodEnd(),
      slots: parsed.slots ?? stripeRow?.slots ?? DEFAULT_PLAN_SLOTS,
      source: 'admin',
    });

    const effects = await applyPlanStateToPosts(plan);

    await logAudit({
      action: 'employer_plan.grant',
      actorType: 'admin',
      actorId,
      targetType: 'employer_plan',
      targetId: plan.id,
      metadata: {
        email: plan.email,
        userId: plan.userId,
        status: plan.status,
        slots: plan.slots,
        currentPeriodEnd: plan.currentPeriodEnd.toISOString(),
        attached: plan.userId !== null,
        ...effects,
      },
    });

    logger.info('[Admin Employer Plans] granted', { planId: plan.id, attached: plan.userId !== null, ...effects });

    const [view] = await withUsage([plan]);
    return NextResponse.json({ success: true, plan: view, attached: plan.userId !== null }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'P2002') {
      // userId is unique: an explicit userId that already owns a different
      // plan row (one keyed on another subscription) cannot be granted twice.
      return NextResponse.json(
        { success: false, error: 'That employer already has a plan row — edit it instead of granting a second one.' },
        { status: 409 },
      );
    }
    logger.error('[Admin Employer Plans] POST error', error);
    return NextResponse.json({ success: false, error: 'Failed to grant employer plan' }, { status: 500 });
  }
}

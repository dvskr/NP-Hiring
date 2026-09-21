/**
 * GET /api/employer/plan/subscribe
 *
 * The /pricing "Subscribe to the plan" CTA. /pricing is a static marketing
 * page and cannot know who is viewing it, so the CTA points here and this
 * route decides where the buyer actually goes:
 *
 *   plan sales closed            → /pricing (the page shows the contact CTA)
 *   not signed in                → /login, then back here
 *   signed in, not an employer   → /pricing
 *   already on a plan            → /employer/dashboard (Manage billing lives
 *                                  there) — never a second subscription
 *   otherwise                    → the Stripe Payment Link carrying this
 *                                  employer's account id (client_reference_id)
 *
 * Redirect-only, no state change, so a GET is safe.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getPlanForUser, isPlanEntitled } from '@/lib/employer-plan';
import { buildPlanPaymentLink, isPlanSaleOpen } from '@/lib/employer-plan-link';

export const dynamic = 'force-dynamic';

const SELF_PATH = '/api/employer/plan/subscribe';

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
}

export async function GET(request: NextRequest) {
  if (!isPlanSaleOpen()) return redirectTo(request, '/pricing');

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return redirectTo(request, `/login?redirectTo=${encodeURIComponent(SELF_PATH)}`);

    const profile = await prisma.userProfile.findUnique({
      where: { supabaseId: user.id },
      select: { role: true, email: true },
    });
    if (profile?.role !== 'employer') return redirectTo(request, '/pricing');

    const plan = await getPlanForUser(user.id);
    if (plan && (isPlanEntitled(plan) || plan.status === 'pending')) {
      return redirectTo(request, '/employer/dashboard?plan=manage');
    }

    const link = buildPlanPaymentLink({ userId: user.id, email: profile.email ?? user.email ?? null });
    if (!link) return redirectTo(request, '/pricing');
    return NextResponse.redirect(link, 303);
  } catch (err) {
    logger.error('[Employer Plan] subscribe redirect failed', err);
    return redirectTo(request, '/pricing');
  }
}

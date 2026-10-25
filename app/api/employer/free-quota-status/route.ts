/**
 * GET /api/employer/free-quota-status — read-only quote for the NEXT post.
 *
 * The path name is historical (the wizard, the preview and UsageWidget
 * already call it); it now answers "what will this employer's next post
 * cost, and why" without consuming anything. Mirrors the gate order in
 * /api/jobs/post-free via lib/pricing.ts#resolvePostingMode:
 *
 *   promo → free through config.promoEndsLabel   ('promo' rows)
 *   pack  → free, spends a 5-post pack credit     ('pack' rows)
 *   intro → config.introPrice, first PAID purchase for this company domain
 *   paid  → config.postingPrice
 *
 * Response shape (the wizard reads `eligible` + `willBeFree`, the preview
 * banner reads `mode` / `price` / `tier`):
 *   { eligible, reason?, mode, tier, willBeFree, price, priceCents,
 *     durationDays, paidDurationDays, promoActive, promoEndsAt,
 *     promoEndsLabel, ladderStartsLabel,
 *     pack?: { remaining, total, expiresAt }, remaining, limit }
 * `pack` is sent whenever the account holds a usable credit, in either
 * phase (lib/post-packs.ts#getPackCreditStatus; expiresAt is the expiry of
 * the pack a post spends next). It replaced the retired Employer plan's
 * `plan` field. `remaining` / `limit` are legacy fields kept so old callers
 * keep compiling: promo → promo cap headroom / cap; pack → credits left /
 * held; paid modes → 0 / 0.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import {
  isFreeEmailDomain,
  domainOf,
  countActivePromoPostsForDomain,
  resolvePostingMode,
} from '@/lib/pricing';
import { getPackCreditStatus } from '@/lib/post-packs';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Anonymous callers get the same 401 JSON as every other
    // /api/employer/* route. Every in-app consumer treats !res.ok as
    // "no quota information" and falls back to neutral copy.
    if (!user || !user.email) {
      return NextResponse.json(
        { error: 'Unauthorized', eligible: false, reason: 'unauthenticated' },
        { status: 401 },
      );
    }

    const profile = await prisma.userProfile.findUnique({
      where: { supabaseId: user.id },
      select: { role: true },
    });

    if (!profile || profile.role !== 'employer') {
      return NextResponse.json({ eligible: false, reason: 'not-employer' });
    }

    // Same signup-domain anchor as the posting gate (audit #26).
    const signupDomain = domainOf(user.email);
    if (!signupDomain || isFreeEmailDomain(signupDomain)) {
      return NextResponse.json({ eligible: false, reason: 'free-email-provider' });
    }

    const now = new Date();
    const packCredit = await getPackCreditStatus(user.id, now);
    const quote = await resolvePostingMode({ quotaDomain: signupDomain, hasPackCredit: packCredit.usable, now });

    // Legacy remaining/limit semantics — see file header.
    let remaining = 0;
    let limit = 0;
    if (quote.mode === 'promo') {
      const activePromo = await countActivePromoPostsForDomain(signupDomain, prisma, now);
      limit = config.promoMaxActivePostsPerDomain;
      remaining = Math.max(0, limit - activePromo);
    } else if (quote.mode === 'pack') {
      limit = packCredit.total;
      remaining = packCredit.remaining;
    }

    return NextResponse.json({
      eligible: true,
      mode: quote.mode,
      tier: quote.tier,
      willBeFree: quote.willBeFree,
      price: quote.price,
      priceCents: quote.priceCents,
      durationDays: quote.durationDays,
      paidDurationDays: config.durationDays,
      promoActive: config.isPromoActive(now),
      promoEndsAt: config.promoEndsAt,
      promoEndsLabel: config.promoEndsLabel,
      ladderStartsLabel: config.ladderStartsLabel,
      ...(packCredit.usable && {
        pack: { remaining: packCredit.remaining, total: packCredit.total, expiresAt: packCredit.expiresAt?.toISOString() ?? null },
      }),
      remaining,
      limit,
    });
  } catch (err) {
    // Log the detail server-side; never echo err.message (it can carry
    // Prisma query text or connection details) to the client.
    logger.error('Error checking employer free quota status', err);
    return NextResponse.json(
      { eligible: false, reason: 'server-error', error: 'Unable to check free posting status' },
      { status: 500 },
    );
  }
}

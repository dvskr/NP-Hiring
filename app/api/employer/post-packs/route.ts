/**
 * GET /api/employer/post-packs — the signed-in employer's 5-post packs, and
 * whether one can be bought now (2027 re-price, phase 3). The dashboard usage
 * widget and Settings, Billing read it; /employer/post-pack reads the same
 * rows server side.
 *
 *   { saleOpen,                     lib/post-pack-sale.ts#isPackSaleOpen
 *     offer: { posts, price, priceCents, validityMonths },
 *     credit: { remaining, used, total, expiresAt } | null,
 *     packs: PostPackView[] }       lib/post-pack-view.ts, newest first
 *
 * `credit` sums the account's current packs (paid and unexpired), a used-up
 * pack included, so a page can say "5 of 5 used" (lib/post-packs.ts
 * #getPackCreditStatus); it is null with no current pack. Each pack carries
 * Stripe's hosted invoice link when Stripe issued one.
 *
 * Reads only the caller's own packs (EmployerPostPack.userId is the session's
 * account), with a bound on the list, and writes nothing. 401 signed out and
 * 403 for an account that is not an employer (lib/auth/require-employer-api),
 * before any pack is read.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { requireEmployerApi } from '@/lib/auth/require-employer-api';
import { getPackCreditStatus } from '@/lib/post-packs';
import { isPackSaleOpen } from '@/lib/post-pack-sale';
import { MAX_PACKS_LISTED, POST_PACK_VIEW_SELECT, toPostPackView } from '@/lib/post-pack-view';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, 'employer:post-packs', RATE_LIMITS.employer);
  if (limited) return limited;

  const auth = await requireEmployerApi();
  if (auth.error) return auth.error;

  try {
    const now = new Date();
    const [rows, credit] = await Promise.all([
      prisma.employerPostPack.findMany({
        where: { userId: auth.user.id },
        orderBy: { purchasedAt: 'desc' },
        take: MAX_PACKS_LISTED,
        select: POST_PACK_VIEW_SELECT,
      }),
      getPackCreditStatus(auth.user.id, now),
    ]);

    return NextResponse.json({
      saleOpen: isPackSaleOpen(now),
      offer: {
        posts: config.packPosts,
        price: config.packPrice,
        priceCents: config.stripePackPriceInCents,
        validityMonths: config.packValidityMonths,
      },
      credit: credit.total > 0
        ? { remaining: credit.remaining, used: credit.used, total: credit.total, expiresAt: credit.expiresAt?.toISOString() ?? null }
        : null,
      packs: rows.map((row) => toPostPackView(row, now)),
    });
  } catch (error) {
    logger.error('Error loading the employer 5-post packs', error);
    return NextResponse.json({ error: 'We could not load your packs.' }, { status: 500 });
  }
}

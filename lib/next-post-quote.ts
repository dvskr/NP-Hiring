/**
 * lib/next-post-quote.ts — whether a next-post quote the browser already
 * holds is still true now.
 *
 * GET /api/employer/free-quota-status answers for the instant it is asked
 * (lib/pricing.ts#resolvePostingMode). A 'promo' answer (every post free
 * through config.promoEndsLabel) stops being true at config.promoEndsAt:
 * from then the server prices that same post on the ladder. A preview,
 * checkout or dashboard that fetched its quote before the boundary and
 * renders after it (a tab left open over midnight, a page restored from the
 * back/forward cache) would otherwise keep promising a free post.
 *
 * Those pages pass the fetched quote through currentQuote while rendering,
 * so the promo branch of their copy needs the promo to be running now as
 * well as the server's answer. A stale promo quote reads as no quote: each
 * page then shows the neutral copy it shows while the quote is loading, and
 * the server prices the post when the employer continues.
 *
 * currentQuote only answers when a render asks it, and neither the clock
 * passing the boundary nor a back/forward cache restore is a render. The
 * pages therefore also call useRerenderAtPromoEnd
 * (lib/hooks/useRerenderAtPromoEnd.ts), which renders them again at
 * config.promoEndsAt and when the page or its tab is shown again.
 *
 * Client-safe: imports only lib/config.
 */
import { config } from '@/lib/config';

/** The quote while it still holds at `now`; null for a 'promo' quote once the promo has ended. */
export function currentQuote<Q extends { mode?: string }>(
  quote: Q | null | undefined,
  now: Date = new Date(),
): Q | null {
  if (!quote) return null;
  if (quote.mode === 'promo' && !config.isPromoActive(now)) return null;
  return quote;
}

/**
 * The /faq employer answers that depend on the launch-promo clock
 * (backlog 2.1).
 *
 * app/faq/page.tsx calls employerPricingFaqs(now) at render time, never at
 * module load, and re-renders hourly, so on config.promoEndsAt the visible
 * answers and the FAQPage JSON-LD they feed stop offering free posts and
 * state the ladder as the current price, with no deploy (lib/pricing-copy.ts
 * explains why module scope is not enough). While the promo runs each
 * answer is exactly what /faq printed before. A Next.js page may export only
 * Next's own names, so the builder lives here, where
 * tests/regressions/pricing-pages-phase-switch.test.ts calls it with both
 * dates.
 *
 * Every number and date is a lib/config token, and the sentences match the
 * canonical copy on /pricing (lib/pricing-copy.ts and
 * app/pricing/pricing-page-copy.ts), so the FAQPage JSON-LD never tells
 * Google a different price than the pricing page does. The Employer plan is
 * retired (owner decision, 2026-10-24), so no answer here offers it; the
 * 5-post pack answer that took its place is the shared one /pricing and
 * /for-employers print, dated while the promo runs.
 */
import { config } from '@/lib/config';
import { FULL_PACKAGE, LADDER_PRICES, PACK_FAQ_QUESTION, PROMO_HEADLINE, PROMO_SUB, ladderLine, packFaqAnswer } from '@/lib/pricing-copy';

export interface FaqEntry {
  question: string;
  answer: string;
}

/** Every post gets the same features; `kinds` names the post types on sale at `now`. */
const featuresAnswer = (kinds: string): string =>
  `Every job post, whether ${kinds}, gets the same features: a ${config.durationDays}-day listing, Featured badge, top placement in search results, company logo, full analytics with salary benchmarks, ${config.limits.candidateUnlocksPerPosting} candidate profile unlocks, ${config.limits.inmailsPerPosting} InMails, up to 5 screening questions, and apply-on-platform. There is no stripped-down tier.`;

/** "Posts made free during the launch promo" stays true once the promo is history. */
const INTRO_SCOPE = `It is scoped to your organization's domain, not to a login, and posts made free during the launch promo do not use it up.`;

/**
 * The leading /faq employer entries for `now`, in page order: cost,
 * features, intro price, 5-post pack. Call it per render.
 */
export function employerPricingFaqs(now: Date): FaqEntry[] {
  const promoActive = config.isPromoActive(now);
  return [
    {
      question: 'How much does it cost to post a job?',
      answer: promoActive
        ? `${PROMO_HEADLINE}. ${PROMO_SUB} ${ladderLine(now)}`
        : `${LADDER_PRICES} ${FULL_PACKAGE}`,
    },
    {
      question: 'What features are included?',
      answer: featuresAnswer(promoActive ? 'free during the promo, intro, or featured' : 'intro or featured'),
    },
    {
      question: 'What is the intro price, and who gets it?',
      answer: promoActive
        ? `From ${config.ladderStartsLabel}, the first paid post per company email domain is $${config.introPrice} instead of $${config.postingPrice}. ${INTRO_SCOPE}`
        : `The first paid post per company email domain is $${config.introPrice} instead of $${config.postingPrice}. ${INTRO_SCOPE}`,
    },
    {
      question: PACK_FAQ_QUESTION,
      answer: packFaqAnswer(now),
    },
  ];
}

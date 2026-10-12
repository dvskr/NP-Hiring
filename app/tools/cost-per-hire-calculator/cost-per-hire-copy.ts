/**
 * /tools/cost-per-hire-calculator copy that follows the launch-promo clock
 * (backlog 2.1): the method notes, the FAQ (which also feeds the FAQPage
 * JSON-LD) and the post-a-role card. While the promo runs every string is
 * what the page printed before; once config.promoEndsAt has passed they
 * state the ladder as the current price and say nothing about the promo
 * mode, which the calculator no longer offers. Posts made free during the
 * promo still appear as history, because they keep the intro price unspent.
 *
 * The page builds these per render from pricingPhase(new Date()) and
 * re-renders hourly, never at module load (lib/pricing-copy.ts explains
 * why). A Next.js page may export only Next's own names, so the builders
 * live here, where tests call them for both phases.
 *
 * Every price is a cost-per-hire-model or lib/pricing-copy token (both read
 * lib/config), and every pricing RULE is stated through its shared note
 * (FREE_POST_SCOPE_NOTE, INTRO_PRICE_SCOPE_NOTE, RENEWAL_SCOPE_NOTE,
 * PLAN_NO_RENEWALS_NOTE), never paraphrased; see
 * tests/regressions/p3-tools-round-2-registry.test.ts.
 */
import { LADDER_PRICES } from '@/lib/pricing-copy';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { formatUsd } from '@/components/tools/tool-theme';
import {
  DEFAULT_PLAN_MONTHS,
  DEFAULT_TIME_TO_FILL_DAYS,
  FIRST_YEAR_BASE_SOURCE,
  FLAT_FEE_PRICING,
  FREE_POST_SCOPE_NOTE,
  INTRO_PRICE_SCOPE_NOTE,
  PLAN_NO_RENEWALS_NOTE,
  RENEWAL_SCOPE_NOTE,
  type PricingPhase,
} from '@/components/tools/cost-per-hire-model';

export interface CostPerHireFaq {
  q: string;
  a: string;
}

/** What every post includes and how renewal works: the same in both phases. */
const POST_RUN_NOTE = `Every post runs ${FLAT_FEE_PRICING.durationDays} days and includes ${FLAT_FEE_PRICING.candidateUnlocksPerPosting} candidate unlocks plus ${FLAT_FEE_PRICING.inmailsPerPosting} direct messages. Renewal: ${RENEWAL_SCOPE_NOTE}; ${PLAN_NO_RENEWALS_NOTE}.`;

/** The method note on our own prices: the promo and the dated ladder, or the ladder. */
function ourPricesAssumption(phase: PricingPhase): string {
  const lead = 'Our prices are the ones you pay at checkout.';
  if (phase === 'promo') {
    return `${lead} During the launch promo ${FREE_POST_SCOPE_NOTE}. From ${FLAT_FEE_PRICING.ladderStartsLabel}: your first post is ${formatUsd(FLAT_FEE_PRICING.introPrice)}, every post after that is ${formatUsd(FLAT_FEE_PRICING.postingPrice)}, or ${formatUsd(FLAT_FEE_PRICING.planPrice)}/month for ${FLAT_FEE_PRICING.planSlots} active jobs. ${POST_RUN_NOTE}`;
  }
  return `${lead} ${LADDER_PRICES} ${POST_RUN_NOTE}`;
}

/** The method notes for `phase`, in page order. */
export function costPerHireAssumptions(phase: PricingPhase): readonly string[] {
  const promo = phase === 'promo';
  return [
    `Cost per hire is total channel spend divided by hires. Cost per applicant is total channel spend divided by applicants. Nothing else is folded in.`,
    ourPricesAssumption(phase),
    // Only while there is a promo to price: afterwards the calculator offers no promo mode.
    ...(promo
      ? [`The promo result is a real price for a dated window, not a rate: a plan modeled on the promo costs nothing on our side until the promo ends, so the calculator lets you price the same roles on the ${FLAT_FEE_PRICING.ladderStartsLabel} ladder or the Employer plan as well.`]
      : []),
    // Once it has ended the promo is named in full: nothing above introduces it any more.
    `The intro price is scoped to the employer's email domain rather than to a login: ${INTRO_PRICE_SCOPE_NOTE}. A five-recruiter health system therefore gets one intro-priced post between all five, not one each, so a multi-role plan modeled per post shows at most one intro post and prices every other post at ${formatUsd(FLAT_FEE_PRICING.postingPrice)}. Posts made free during the ${promo ? 'promo' : 'launch promo'} do not use the intro price up.`,
    `The Employer plan is modeled as enough concurrent plans to hold every role at once (${FLAT_FEE_PRICING.planSlots} active slots each) for the months you enter, which start at ${DEFAULT_PLAN_MONTHS}: our ${FLAT_FEE_PRICING.durationDays}-day posting window in whole billing months, not an estimate of how long anyone subscribes. Nothing is added for renewals, because ${PLAN_NO_RENEWALS_NOTE}.`,
    `Every figure for the sponsored-ad and agency channels is yours. The calculator supplies no typical cost per click, contingency rate, time-to-fill, or applicant-to-hire ratio.`,
    `A channel with nothing entered is reported as not comparable, never as zero. A zero in a cost column would read as free.`,
    `The applicant-volume default of ${FLAT_FEE_PRICING.candidateUnlocksPerPosting} is the number of candidate unlocks a posting includes. It is a plan feature, not an expected response rate. Replace it with what your own postings draw.`,
    `Time-to-fill defaults to ${DEFAULT_TIME_TO_FILL_DAYS} days, the posting's run length rather than a market average, and the same default applies to all three channels. The vacancy overlay only affects the result once you enter a cost per day unfilled, which starts at zero.`,
    `First-year base, the figure an agency contingency rate is applied to, starts at the cited national median of ${STAT_SOURCES.averageSalary.formatted} (${FIRST_YEAR_BASE_SOURCE}). Replace it with your budgeted base.`,
  ];
}

/** The FAQ for `phase`, in page order. It feeds the accordion and the FAQPage JSON-LD alike. */
export function costPerHireFaqs(phase: PricingPhase): readonly CostPerHireFaq[] {
  const promo = phase === 'promo';
  const ladder = `${formatUsd(FLAT_FEE_PRICING.introPrice)} for your first post and ${formatUsd(FLAT_FEE_PRICING.postingPrice)} after, or ${formatUsd(FLAT_FEE_PRICING.planPrice)}/month for ${FLAT_FEE_PRICING.planSlots} active jobs`;
  const whatItCosts = promo
    ? `During the launch promo ${FREE_POST_SCOPE_NOTE}. From ${FLAT_FEE_PRICING.ladderStartsLabel}: your first post is ${formatUsd(FLAT_FEE_PRICING.introPrice)}, every post after that is ${formatUsd(FLAT_FEE_PRICING.postingPrice)}, or ${formatUsd(FLAT_FEE_PRICING.planPrice)}/month for ${FLAT_FEE_PRICING.planSlots} active jobs.`
    : LADDER_PRICES;
  return [
    {
      q: 'How is cost per hire calculated?',
      a: `Total spend on a channel divided by the hires that channel produced. This calculator does that for three channels side by side and adds an optional overlay for the cost of the seat sitting empty: time-to-fill multiplied by what a day of vacancy costs you. It leaves out recruiter salaries, ATS licenses, and overhead, which make the number harder to check and to compare between employers. To include them, add them to a channel's spend.`,
    },
    {
      q: 'Why does this not tell me the typical cost per hire in healthcare?',
      a: `We sell one of the channels being compared, and industry cost-per-hire figures come from surveys that each define which costs count in their own way. This comparison uses our published prices plus the numbers on your own invoices and in your ATS.`,
    },
    {
      q: 'Is a flat-fee posting really cheaper than an agency?',
      a: `It depends on your roles. A contingency fee is a percentage of a first-year salary, so it scales with the salary. A posting is a fixed price that does not: ${promo ? `free during the launch promo, then ${ladder}` : ladder}. The calculator totals our side from our published rates on whichever of those you pick (posts, renewals, and the intro price if your domain still has it) and prints that as the cost per hire your other channels have to beat. It then applies your own contingency rate to your own base. Spend is not the whole comparison. A contingency agency does the sourcing and first-pass screening, carries the risk of not placing anyone, and is paid only on a hire. A posting puts the role in front of candidates and leaves the screening with you. The real question is whether the fee difference is worth more to you than the work it buys.`,
    },
    {
      q: 'What should I use for time-to-fill?',
      a: `Your own history, from the day a role opened to the day an offer was accepted. The field starts at ${DEFAULT_TIME_TO_FILL_DAYS} days because that is how long a posting runs, and the same default applies to all three channels. Time-to-fill has no effect on the result until you enter what a day of vacancy costs you.`,
    },
    {
      q: 'How do I work out what a day of vacancy costs?',
      a: `Start with what you are actually spending to cover the gap: locum or agency coverage day rates, overtime for the staff absorbing the work, or the visit revenue the empty schedule is not generating. The default is zero, and the vacancy columns stay off until you enter a figure.`,
    },
    {
      q: `What does a posting include, and what does it cost?`,
      a: `Every post (${promo ? 'promo, intro, featured, or plan' : 'intro, featured, or plan'}) runs ${FLAT_FEE_PRICING.durationDays} days, is featured, and includes ${FLAT_FEE_PRICING.candidateUnlocksPerPosting} candidate profile unlocks and ${FLAT_FEE_PRICING.inmailsPerPosting} direct messages. ${whatItCosts} Renewal: ${RENEWAL_SCOPE_NOTE}; ${PLAN_NO_RENEWALS_NOTE}. The calculator uses the same prices you pay at checkout.`,
    },
    {
      q: `Who exactly gets the intro price?`,
      a: `Your employer email domain does, not your login: ${INTRO_PRICE_SCOPE_NOTE}. It does not reset for each new recruiter who signs up. If a health system with five recruiters fills five roles on the per-post ladder, one of those posts is ${formatUsd(FLAT_FEE_PRICING.introPrice)} and the other four are ${formatUsd(FLAT_FEE_PRICING.postingPrice)} each. Posts made free during the launch promo do not use it up. That matters when you model a multi-role plan here, so uncheck the intro-price box in the calculator if anyone at your domain has already bought a post.`,
    },
  ];
}

/** The post-a-role card under "Next steps for hiring teams". */
export function postRoleBlurb(phase: PricingPhase): string {
  return phase === 'promo'
    ? `Free through ${FLAT_FEE_PRICING.promoEndsLabel}, every feature included.`
    : LADDER_PRICES;
}

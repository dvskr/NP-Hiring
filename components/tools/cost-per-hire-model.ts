/**
 * Employer cost-per-hire model (P3 #6b; re-priced 2026-09-12 for the launch
 * promo + 2027 ladder).
 *
 * WHAT IS REAL AND WHAT IS YOURS
 * Exactly one channel in this comparison has prices we can state as fact: our
 * own. Those come from lib/config.ts — the same constants the checkout charges
 * against — so the flat-fee column can never quote a price the product does not
 * actually sell.
 *
 * Every figure for every OTHER channel is an employer input. There are no
 * industry benchmarks in this file: no typical cost per click, no typical
 * contingency rate, no typical time-to-fill, no typical applicant-to-hire
 * ratio. Publishing those while selling the alternative would be marketing
 * dressed as data, and a fabricated benchmark on a page that concludes "our
 * product is cheaper" is the worst version of that. A channel with no numbers
 * entered reports NOT COMPARABLE rather than a zero — a $0 agency column would
 * read as free.
 *
 * OUR SIDE HAS THREE WAYS TO BUY, AND THE MODEL PRICES EACH ONE HONESTLY
 *   - 'promo'    — through config.promoEndsLabel every post is free. A plan
 *                  modelled here costs $0 on our side, which is a real price
 *                  for a dated window, not a comparison — the widget says so
 *                  and points the reader at the ladder. Offered only while
 *                  the promo runs: once it has ended nobody can buy a promo
 *                  post, so flatFeeModeOptions('ladder') leaves it out and
 *                  the ladder options lose their start date (PricingPhase).
 *   - 'per-post' — from config.ladderStartsLabel: the FIRST PAID post per
 *                  employer email DOMAIN is config.introPrice, every post
 *                  after it is config.postingPrice. The intro price is scoped
 *                  to the domain, lifetime, shared across every employee at
 *                  that domain (lib/pricing.ts#getNextPaidTier counts paid
 *                  rows against EmployerJob.quotaDomain). "Per account" would
 *                  overstate the discount for a multi-recruiter employer.
 *   - 'plan'     — from config.ladderStartsLabel: config.planPrice per month
 *                  for config.planSlots concurrently active posts. A plan
 *                  post runs config.durationDays like any other and is never
 *                  renewed (create-renewal-checkout refuses it); when it ends
 *                  the employer can post the role again into the freed slot
 *                  at no extra charge, so the plan has no renewals to price. A plan for
 *                  more roles than one plan's slots is modelled as enough
 *                  plans to hold every role at once (swapping roles through
 *                  fewer slots costs less, and the widget says so).
 *
 * The two defaults that are not zero are traceable and labelled as such in the
 * UI:
 *   - time-to-fill defaults to the posting's own run length (config.durationDays),
 *     stated as "the posting window, not a benchmark";
 *   - first-year base defaults to the cited BLS median (STAT_SOURCES), because
 *     an agency fee is a percentage of something and the cited median is the
 *     only salary figure this board publishes as fact.
 *
 * Pure functions and plain data — no 'use client'.
 */
import { config } from '@/lib/config';
import { STAT_SOURCES } from '@/lib/stats-sources';

export type ChannelKey = 'flatFee' | 'cpc' | 'agency';

/** How the employer buys from us. See the header for what each one prices. */
export type FlatFeeMode = 'promo' | 'per-post' | 'plan';

/** Flat-fee prices and dates, straight from the pricing config. */
export const FLAT_FEE_PRICING = {
    /** Every post is free through this date (copy label, from config). */
    promoEndsLabel: config.promoEndsLabel,
    /** First day the ladder and the plan are billed (copy label, from config). */
    ladderStartsLabel: config.ladderStartsLabel,
    /**
     * Intro price: the FIRST PAID post per employer EMAIL DOMAIN, lifetime —
     * NOT per account and not per user. lib/pricing.ts counts paid rows
     * against the immutable EmployerJob.quotaDomain snapshot taken from the
     * signup email's domain, so five recruiters at one health system share
     * ONE intro-priced post between them.
     */
    introPrice: config.introPrice,
    /** Every paid post after the intro post. */
    postingPrice: config.postingPrice,
    renewalPrice: config.renewalPrice,
    /** A renewal never extends a post past this many days after it was created. */
    renewalCapDays: config.renewalCapDays,
    /** Employer plan: monthly price and concurrently active slots. */
    planPrice: config.planPrice,
    planSlots: config.planSlots,
    /** Listing duration for EVERY post — promo, intro, featured, plan — and every renewal. */
    durationDays: config.durationDays,
    candidateUnlocksPerPosting: config.limits.candidateUnlocksPerPosting,
    inmailsPerPosting: config.limits.inmailsPerPosting,
} as const;

/** Featured-post price per day of exposure — derived, not a new price. */
export const FLAT_FEE_COST_PER_DAY = FLAT_FEE_PRICING.postingPrice / FLAT_FEE_PRICING.durationDays;

/**
 * The launch-promo rule as one string, rendered verbatim by every surface that
 * mentions it. One constant means a single place to be right: the promo is a
 * dated window, every post inside it is free, and nothing about it is per
 * account or per user.
 */
export const FREE_POST_SCOPE_NOTE =
    `every post is free through ${FLAT_FEE_PRICING.promoEndsLabel} ` +
    `(${FLAT_FEE_PRICING.durationDays} days, every feature, no card required)`;

/**
 * The intro-price rule as one string. There is exactly one correct statement
 * of its scope and three places that want to make it (the widget's checkbox,
 * the page's assumptions, the page's FAQ): the unit is the employer EMAIL
 * DOMAIN, lifetime, never an account and never a user.
 */
export const INTRO_PRICE_SCOPE_NOTE =
    `one intro-priced post at $${FLAT_FEE_PRICING.introPrice} per employer email domain, lifetime, ` +
    `shared across everyone at your organization; every post after it is $${FLAT_FEE_PRICING.postingPrice}`;

/**
 * The renewal rule as one string. Renewal is sold for promo, intro and
 * featured posts only: create-renewal-checkout answers 409 for a plan post,
 * so "renew any post" would over-promise.
 */
export const RENEWAL_SCOPE_NOTE =
    `a promo, intro or featured post renews for $${FLAT_FEE_PRICING.renewalPrice} (+${FLAT_FEE_PRICING.durationDays} days)`;

/**
 * Why the plan column prices no renewals, as one string. A plan post is NOT
 * live for as long as the plan is: it runs config.durationDays like every
 * other post (post-free writes the same expiresAt) and is never renewed. What
 * the monthly fee buys is the slot, which frees when the post ends or is
 * closed. Nothing reposts the role automatically: the employer posts it again
 * (post-free then resolves the 'plan' mode) into the freed slot at no extra
 * charge, so the note must not read as if the role returns on its own.
 */
export const PLAN_NO_RENEWALS_NOTE =
    `plan posts are not renewed: each runs ${FLAT_FEE_PRICING.durationDays} days, and when it ends you can post the role again into its slot at no extra charge`;

/**
 * The pricing phase the calculator is offered in: 'promo' while
 * config.isPromoActive(), 'ladder' from config.promoEndsAt. The server page
 * decides it per render (pricingPhase(now)) and hands it to the client
 * widget as a prop, so the server HTML and the hydrated widget agree and
 * nothing decides it at module load (lib/pricing-copy.ts explains why).
 */
export type PricingPhase = 'promo' | 'ladder';

/** The pricing phase at `now`. Call it per render, never at module load. */
export function pricingPhase(now: Date = new Date()): PricingPhase {
    return config.isPromoActive(now) ? 'promo' : 'ladder';
}

/** One way to buy from us, as the widget's select offers it. */
export interface FlatFeeModeOption {
    mode: FlatFeeMode;
    label: string;
}

/** While the promo runs: the promo, then the two ladder options dated from their start. */
const PROMO_PHASE_MODE_OPTIONS: readonly FlatFeeModeOption[] = [
    { mode: 'promo', label: `Launch promo: free through ${FLAT_FEE_PRICING.promoEndsLabel}` },
    { mode: 'per-post', label: `Per post, from ${FLAT_FEE_PRICING.ladderStartsLabel}` },
    { mode: 'plan', label: `Employer plan, from ${FLAT_FEE_PRICING.ladderStartsLabel}` },
];

/** Once the ladder is live: the two ways anyone can still buy, with no start date. */
const LADDER_PHASE_MODE_OPTIONS: readonly FlatFeeModeOption[] = [
    { mode: 'per-post', label: 'Per post' },
    { mode: 'plan', label: 'Employer plan' },
];

/**
 * The ways to buy the widget offers in `phase`; the first is the one it
 * opens on. A promo post cannot be bought once the promo has ended, so the
 * ladder phase does not offer it at all rather than pricing it at $0.
 */
export function flatFeeModeOptions(phase: PricingPhase): readonly FlatFeeModeOption[] {
    return phase === 'promo' ? PROMO_PHASE_MODE_OPTIONS : LADDER_PHASE_MODE_OPTIONS;
}

/**
 * The way to buy the widget prices in `phase`: the one the reader selected
 * while `phase` still offers it, else the phase's first. The widget seeds its
 * selection once, at mount, but the server can hand a mounted widget a new
 * phase (a tab held open across the promo end, then a soft navigation), and
 * a selection of 'promo' would then keep pricing a post nobody can buy,
 * under a select that has no such option. Derived on every render, so the
 * selection and everything else the reader entered are kept.
 */
export function offeredFlatFeeMode(selected: FlatFeeMode, phase: PricingPhase): FlatFeeMode {
    const options = flatFeeModeOptions(phase);
    return options.some((option) => option.mode === selected) ? selected : options[0].mode;
}

/**
 * Default applicant volume for the flat-fee column.
 *
 * NOT a benchmark: it is the number of candidate profiles a posting includes
 * unlocks for, so it reflects what the plan ships, and the UI says exactly
 * that. Replace it with what your own postings actually draw.
 */
export const DEFAULT_APPLICANTS_PER_ROLE = FLAT_FEE_PRICING.candidateUnlocksPerPosting;

/**
 * Default time-to-fill for every channel: the posting's run length. Chosen
 * because it is a real product fact rather than an asserted market average, and
 * it applies the SAME number to every channel, so the default can never tilt
 * the comparison toward one of them.
 */
export const DEFAULT_TIME_TO_FILL_DAYS = FLAT_FEE_PRICING.durationDays;

/** Stripe bills the plan monthly; a "month" here is 30 days for conversion only. */
const DAYS_PER_PLAN_MONTH = 30;

/**
 * Default plan length: the posting window expressed in whole billing months.
 * A product fact (the same run length a per-post listing gets), not an
 * estimate of how long anyone subscribes.
 */
export const DEFAULT_PLAN_MONTHS = Math.ceil(FLAT_FEE_PRICING.durationDays / DAYS_PER_PLAN_MONTH);

/** Default first-year base an agency fee is calculated against. */
export const DEFAULT_FIRST_YEAR_BASE = Number(STAT_SOURCES.averageSalary.value);
export const FIRST_YEAR_BASE_SOURCE = STAT_SOURCES.averageSalary.source;

export interface CostPerHireInputs {
    /** Roles you plan to fill. */
    roles: number;
    /** Renewals per role on the flat-fee channel (ignored on the plan: plan posts are never renewed; the employer posts the role again into a freed slot). */
    renewalsPerRole: number;
    /** Which of our three ways to buy the flat-fee column is priced on. */
    flatFeeMode: FlatFeeMode;
    /**
     * Per-post mode only: whether your employer email DOMAIN still has its
     * intro price available — shared across every colleague who signs up at
     * that domain, so one paid post anywhere in the organization means false.
     */
    useIntroPrice: boolean;
    /** Plan mode only: whole billing months subscribed. */
    planMonths: number;
    /** Hires you expect per role. Applies to every channel — same role, same hire. */
    hiresPerRole: number;

    /** Applicants per role on a flat-fee posting. */
    flatFeeApplicantsPerRole: number;
    flatFeeTimeToFillDays: number;

    /** Sponsored / cost-per-click spend per role. 0 leaves the channel out. */
    cpcSpendPerRole: number;
    cpcApplicantsPerRole: number;
    cpcTimeToFillDays: number;

    /** Contingency fee as a percentage of first-year base. 0 leaves it out. */
    agencyFeePct: number;
    firstYearBase: number;
    agencyTimeToFillDays: number;

    /**
     * What a day of vacancy costs you — locum or agency coverage, lost visit
     * revenue, overtime. 0 (the default) switches the whole overlay off, which
     * is the honest default: only you can know this number.
     */
    dailyVacancyCost: number;
}

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
    flatFee: 'Flat-fee posting',
    cpc: 'Sponsored / cost-per-click',
    agency: 'Agency / contingency search',
};

export interface FlatFeeBreakdown {
    mode: FlatFeeMode;
    /** Posts that cost nothing because they fall inside the launch promo. */
    promoPostings: number;
    /** 0 or 1 — the domain's intro-priced post, per-post mode only. */
    introPostings: number;
    /** Posts at the featured price, per-post mode only. */
    proPostings: number;
    /** Roles carried in plan slots, plan mode only. */
    planPostings: number;
    /** Concurrent plans needed to hold every role at once (ceil(roles / planSlots)). */
    planCount: number;
    planMonths: number;
    renewals: number;
    /** Intro + featured post spend (per-post mode). */
    postingSpend: number;
    /** planCount × planMonths × planPrice (plan mode). */
    planSpend: number;
    renewalSpend: number;
    total: number;
}

const atLeastZero = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
const wholeAtLeastZero = (n: number): number => Math.floor(atLeastZero(n));

const emptyBreakdown = (mode: FlatFeeMode): FlatFeeBreakdown => ({
    mode,
    promoPostings: 0,
    introPostings: 0,
    proPostings: 0,
    planPostings: 0,
    planCount: 0,
    planMonths: 0,
    renewals: 0,
    postingSpend: 0,
    planSpend: 0,
    renewalSpend: 0,
    total: 0,
});

/** Flat-fee spend for the whole hiring plan, priced from lib/config. */
export function flatFeeSpend(inputs: CostPerHireInputs): FlatFeeBreakdown {
    const roles = wholeAtLeastZero(inputs.roles);
    const renewals = roles * atLeastZero(inputs.renewalsPerRole);
    const renewalSpend = renewals * FLAT_FEE_PRICING.renewalPrice;
    const base = emptyBreakdown(inputs.flatFeeMode);

    if (inputs.flatFeeMode === 'promo') {
        return { ...base, promoPostings: roles, renewals, renewalSpend, total: renewalSpend };
    }

    if (inputs.flatFeeMode === 'plan') {
        // A plan post is never renewed: it runs config.durationDays and the
        // role is posted again into the freed slot inside the monthly fee, so
        // renewalsPerRole is deliberately ignored here.
        const planMonths = Math.max(1, Math.ceil(atLeastZero(inputs.planMonths)));
        const planCount = roles > 0 ? Math.ceil(roles / FLAT_FEE_PRICING.planSlots) : 0;
        const planSpend = planCount * planMonths * FLAT_FEE_PRICING.planPrice;
        return { ...base, planPostings: roles, planCount, planMonths, planSpend, total: planSpend };
    }

    // Domain-scoped, not account-scoped: the intro price applies to the first
    // paid post per employer email domain for all time, so a plan for N roles
    // gets at most ONE intro-priced post no matter how many recruiter
    // accounts post them.
    const introPostings = inputs.useIntroPrice ? Math.min(roles, 1) : 0;
    const proPostings = roles - introPostings;
    const postingSpend = introPostings * FLAT_FEE_PRICING.introPrice + proPostings * FLAT_FEE_PRICING.postingPrice;
    return {
        ...base,
        introPostings,
        proPostings,
        renewals,
        postingSpend,
        renewalSpend,
        total: postingSpend + renewalSpend,
    };
}

export interface ChannelResult {
    key: ChannelKey;
    label: string;
    /**
     * False when the employer has not supplied what the channel needs. The
     * widget renders a prompt instead of a number — never a zero.
     */
    isComparable: boolean;
    /** Why it is not comparable, for the prompt. */
    missingInput: string | null;
    totalSpend: number;
    totalApplicants: number;
    totalHires: number;
    costPerApplicant: number | null;
    costPerHire: number | null;
    timeToFillDays: number;
    /** timeToFill × daily vacancy cost × roles. Zero when the overlay is off. */
    vacancyCost: number;
    totalWithVacancy: number;
    costPerHireWithVacancy: number | null;
}

function buildResult(args: {
    key: ChannelKey;
    isComparable: boolean;
    missingInput: string | null;
    totalSpend: number;
    totalApplicants: number;
    totalHires: number;
    timeToFillDays: number;
    roles: number;
    dailyVacancyCost: number;
}): ChannelResult {
    const vacancyCost = atLeastZero(args.dailyVacancyCost) * atLeastZero(args.timeToFillDays) * args.roles;
    const totalWithVacancy = args.totalSpend + vacancyCost;
    return {
        key: args.key,
        label: CHANNEL_LABELS[args.key],
        isComparable: args.isComparable,
        missingInput: args.missingInput,
        totalSpend: args.totalSpend,
        totalApplicants: args.totalApplicants,
        totalHires: args.totalHires,
        costPerApplicant:
            args.isComparable && args.totalApplicants > 0 ? args.totalSpend / args.totalApplicants : null,
        costPerHire: args.isComparable && args.totalHires > 0 ? args.totalSpend / args.totalHires : null,
        timeToFillDays: atLeastZero(args.timeToFillDays),
        vacancyCost,
        totalWithVacancy,
        costPerHireWithVacancy:
            args.isComparable && args.totalHires > 0 ? totalWithVacancy / args.totalHires : null,
    };
}

/**
 * All three channels, in a fixed order (ours first — so the reader can see
 * whose product is being compared, rather than having the winner floated to
 * the top by the tool that sells it).
 */
export function compareChannels(inputs: CostPerHireInputs): readonly ChannelResult[] {
    const roles = wholeAtLeastZero(inputs.roles);
    const hires = roles * atLeastZero(inputs.hiresPerRole);
    const dailyVacancyCost = atLeastZero(inputs.dailyVacancyCost);
    const flat = flatFeeSpend(inputs);
    const agencyFeePerRole = (atLeastZero(inputs.agencyFeePct) / 100) * atLeastZero(inputs.firstYearBase);

    return [
        buildResult({
            key: 'flatFee',
            isComparable: roles > 0,
            missingInput: roles > 0 ? null : 'Enter how many roles you plan to fill.',
            totalSpend: flat.total,
            totalApplicants: roles * atLeastZero(inputs.flatFeeApplicantsPerRole),
            totalHires: hires,
            timeToFillDays: inputs.flatFeeTimeToFillDays,
            roles,
            dailyVacancyCost,
        }),
        buildResult({
            key: 'cpc',
            isComparable: roles > 0 && atLeastZero(inputs.cpcSpendPerRole) > 0,
            missingInput:
                roles > 0 && atLeastZero(inputs.cpcSpendPerRole) > 0
                    ? null
                    : 'Enter the sponsored spend per role from your own invoice.',
            totalSpend: roles * atLeastZero(inputs.cpcSpendPerRole),
            totalApplicants: roles * atLeastZero(inputs.cpcApplicantsPerRole),
            totalHires: hires,
            timeToFillDays: inputs.cpcTimeToFillDays,
            roles,
            dailyVacancyCost,
        }),
        buildResult({
            key: 'agency',
            isComparable: roles > 0 && agencyFeePerRole > 0,
            missingInput:
                roles > 0 && agencyFeePerRole > 0
                    ? null
                    : 'Enter the contingency rate in your agency agreement.',
            totalSpend: roles * agencyFeePerRole,
            // Agencies present shortlists rather than an applicant pool, so
            // there is no applicant count to divide by. Left at zero, which
            // makes costPerApplicant null rather than a misleading figure.
            totalApplicants: 0,
            totalHires: hires,
            timeToFillDays: inputs.agencyTimeToFillDays,
            roles,
            dailyVacancyCost,
        }),
    ];
}

/**
 * The cost per hire any other channel has to beat, on the employer's own
 * numbers. Returned as a threshold rather than a verdict — the widget states it
 * as "on your numbers", never as a general claim.
 */
export function flatFeeCostPerHire(results: readonly ChannelResult[]): number | null {
    return results.find((result) => result.key === 'flatFee')?.costPerHire ?? null;
}

/** Comparable channels ordered by cost per hire, cheapest first. */
export function rankByCostPerHire(results: readonly ChannelResult[]): readonly ChannelResult[] {
    return results
        .filter((result) => result.isComparable && result.costPerHire !== null)
        .slice()
        .sort((a, b) => (a.costPerHire as number) - (b.costPerHire as number));
}

/**
 * Defaults the widget opens on in `phase`. Every non-zero value is documented
 * above. The mode is the phase's first way to buy: the promo while it runs,
 * the per-post ladder once it has ended, so the widget never opens on a $0
 * price nobody can buy. A module-scope default (it used to be one) would be
 * decided once per server instance, and once at build for a static page.
 */
export function defaultInputs(phase: PricingPhase): CostPerHireInputs {
    return {
        roles: 1,
        renewalsPerRole: 0,
        flatFeeMode: flatFeeModeOptions(phase)[0].mode,
        useIntroPrice: true,
        planMonths: DEFAULT_PLAN_MONTHS,
        hiresPerRole: 1,
        flatFeeApplicantsPerRole: DEFAULT_APPLICANTS_PER_ROLE,
        flatFeeTimeToFillDays: DEFAULT_TIME_TO_FILL_DAYS,
        cpcSpendPerRole: 0,
        cpcApplicantsPerRole: 0,
        cpcTimeToFillDays: DEFAULT_TIME_TO_FILL_DAYS,
        agencyFeePct: 0,
        firstYearBase: DEFAULT_FIRST_YEAR_BASE,
        agencyTimeToFillDays: DEFAULT_TIME_TO_FILL_DAYS,
        dailyVacancyCost: 0,
    };
}

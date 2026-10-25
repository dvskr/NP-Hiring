/**
 * Employer cost-per-hire model (P3 #6b; re-priced 2026-09-12 for the launch
 * promo + 2027 ladder, and 2026-10-24 when the owner retired the Employer
 * plan and gave a renewal two prices).
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
 *                  the ladder options lose their start date (PricingPhase). A
 *                  promo post renews at the base renewal price.
 *   - 'per-post' — from config.ladderStartsLabel: the FIRST PAID post per
 *                  employer email DOMAIN is config.introPrice, every post
 *                  after it is config.postingPrice. The intro price is scoped
 *                  to the domain, lifetime, shared across every employee at
 *                  that domain (lib/pricing.ts#getNextPaidTier counts paid
 *                  rows against EmployerJob.quotaDomain). "Per account" would
 *                  overstate the discount for a multi-recruiter employer. The
 *                  intro post renews at the base renewal price, every post
 *                  bought at the posting price at the pro renewal price
 *                  (lib/renewal-price.ts).
 *   - 'pack'     — from config.ladderStartsLabel: config.packPrice for
 *                  config.packPosts posts (lib/post-packs.ts). A pack for
 *                  every config.packPosts roles, the roles left over one at a
 *                  time at the posting price, or from one more pack when that
 *                  costs less at the till. A paid pack uses up the domain's
 *                  intro price, so with the intro price applied the model also
 *                  prices the first post at the intro price, bought before
 *                  any pack, and keeps the lower total. Pack posts renew at the
 *                  base renewal price, like the intro post.
 * The Employer plan was a way to buy until it was retired; the model prices
 * no plan.
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
import { RENEWAL_LINE } from '@/lib/pricing-copy';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { formatUsd } from './tool-theme';

export type ChannelKey = 'flatFee' | 'cpc' | 'agency';

/** How the employer buys from us. See the header for what each one prices. */
export type FlatFeeMode = 'promo' | 'per-post' | 'pack';

/** Flat-fee prices and dates, straight from the pricing config. */
export const FLAT_FEE_PRICING = {
    /** Every post is free through this date (copy label, from config). */
    promoEndsLabel: config.promoEndsLabel,
    /** First day the ladder is billed (copy label, from config). */
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
    /** A renewal of a promo or intro post (the base renewal price). */
    renewalPrice: config.renewalPrice,
    /** A renewal of a post bought at the posting price (the pro renewal price). */
    proRenewalPrice: config.proRenewalPrice,
    /** A renewal never extends a post past this many days after it was created. */
    renewalCapDays: config.renewalCapDays,
    /** The 5-post pack: its one-time price, and the posts it holds. */
    packPrice: config.packPrice,
    packPosts: config.packPosts,
    /** Listing duration for EVERY post — promo, intro, featured, pack — and every renewal. */
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
 * The renewal rule as one sentence: the shared one every pricing surface
 * prints (lib/pricing-copy.ts#RENEWAL_LINE), which names both renewal prices
 * by the post each one renews. Renewal is sold for promo, intro and featured
 * posts only: create-renewal-checkout answers 409 for the dormant plan posts,
 * so "renew any post" would over-promise.
 */
export const RENEWAL_SCOPE_NOTE = RENEWAL_LINE;

/**
 * How the pack mode prices a hiring plan, as one string the method notes
 * render: the mix of packs and single posts flatFeeSpend works out, and why
 * the intro post is bought first when it is used at all (a pack uses up the
 * domain's intro price). It names a price, never a saving.
 */
export const PACK_SCOPE_NOTE =
    `The ${FLAT_FEE_PRICING.packPosts}-post pack option buys a pack for every ${FLAT_FEE_PRICING.packPosts} roles and posts the rest one at a time at ${formatUsd(FLAT_FEE_PRICING.postingPrice)}, or from one more pack when that costs less. ` +
    `A pack uses up your domain's intro price, so with the intro price applied the calculator also prices your first post at ${formatUsd(FLAT_FEE_PRICING.introPrice)}, bought before any pack, and keeps whichever total is lower. ` +
    `Pack posts renew at ${formatUsd(FLAT_FEE_PRICING.renewalPrice)}.`;

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

/** While the promo runs: the promo, then the per-post ladder and the pack dated from its start. */
const PROMO_PHASE_MODE_OPTIONS: readonly FlatFeeModeOption[] = [
    { mode: 'promo', label: `Launch promo: free through ${FLAT_FEE_PRICING.promoEndsLabel}` },
    { mode: 'per-post', label: `Per post, from ${FLAT_FEE_PRICING.ladderStartsLabel}` },
    { mode: 'pack', label: `${FLAT_FEE_PRICING.packPosts}-post pack, from ${FLAT_FEE_PRICING.ladderStartsLabel}` },
];

/** Once the ladder is live: the ways anyone can still buy, with no start date. */
const LADDER_PHASE_MODE_OPTIONS: readonly FlatFeeModeOption[] = [
    { mode: 'per-post', label: 'Per post' },
    { mode: 'pack', label: `${FLAT_FEE_PRICING.packPosts}-post pack` },
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

/** Default first-year base an agency fee is calculated against. */
export const DEFAULT_FIRST_YEAR_BASE = Number(STAT_SOURCES.averageSalary.value);
export const FIRST_YEAR_BASE_SOURCE = STAT_SOURCES.averageSalary.source;

export interface CostPerHireInputs {
    /** Roles you plan to fill. */
    roles: number;
    /** Renewals per role on the flat-fee channel, each priced by the post it renews. */
    renewalsPerRole: number;
    /** Which of our two ways to buy the flat-fee column is priced on. */
    flatFeeMode: FlatFeeMode;
    /**
     * Per-post and pack modes: whether your employer email DOMAIN still has
     * its intro price available — shared across every colleague who signs up
     * at that domain, so one paid post (or paid pack) anywhere in the
     * organization means false.
     */
    useIntroPrice: boolean;
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
    /** 0 or 1 — the domain's intro-priced post, per-post and pack modes. */
    introPostings: number;
    /** Posts at the featured price, per-post and pack modes. */
    proPostings: number;
    /** 5-post packs bought, pack mode only. */
    packs: number;
    /** Roles posted with a pack credit, pack mode only (a last pack may hold credits left unused). */
    packPostings: number;
    /** Every renewal priced, whatever it costs. */
    renewals: number;
    /** Renewals at the base renewal price: of promo posts, pack posts and the intro post. */
    baseRenewals: number;
    /** Renewals at the pro renewal price: of posts bought at the posting price. */
    proRenewals: number;
    /** Intro + featured single post spend (per-post and pack modes). */
    postingSpend: number;
    /** packs × the pack price (pack mode). */
    packSpend: number;
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
    packs: 0,
    packPostings: 0,
    renewals: 0,
    baseRenewals: 0,
    proRenewals: 0,
    postingSpend: 0,
    packSpend: 0,
    renewalSpend: 0,
    total: 0,
});

/** A way to post some roles from packs and single posts at the posting price. */
interface PackMix {
    packs: number;
    packPostings: number;
    proPostings: number;
    /** What the mix costs at the till: packs plus single posts. */
    spend: number;
}

/**
 * The cheapest way to post `roles` roles with packs and posts at the posting
 * price: a pack for every config.packPosts roles, the rest one at a time, or
 * from one more pack when the single posts would cost more than it.
 */
function packMix(roles: number): PackMix {
    const { packPosts, packPrice, postingPrice } = FLAT_FEE_PRICING;
    const whole = Math.floor(roles / packPosts);
    const left = roles - whole * packPosts;
    if (left > 0 && left * postingPrice > packPrice) {
        return { packs: whole + 1, packPostings: roles, proPostings: 0, spend: (whole + 1) * packPrice };
    }
    return { packs: whole, packPostings: whole * packPosts, proPostings: left, spend: whole * packPrice + left * postingPrice };
}

/** Flat-fee spend for the whole hiring plan, priced from lib/config. */
export function flatFeeSpend(inputs: CostPerHireInputs): FlatFeeBreakdown {
    const roles = wholeAtLeastZero(inputs.roles);
    const renewalsPerRole = atLeastZero(inputs.renewalsPerRole);
    const base = emptyBreakdown(inputs.flatFeeMode);

    if (inputs.flatFeeMode === 'promo') {
        // A promo post renews at the base renewal price.
        const baseRenewals = roles * renewalsPerRole;
        const renewalSpend = baseRenewals * FLAT_FEE_PRICING.renewalPrice;
        return { ...base, promoPostings: roles, renewals: baseRenewals, baseRenewals, renewalSpend, total: renewalSpend };
    }

    if (inputs.flatFeeMode === 'pack') {
        return packSpend(base, roles, renewalsPerRole, inputs.useIntroPrice);
    }

    // Domain-scoped, not account-scoped: the intro price applies to the first
    // paid post per employer email domain for all time, so a plan for N roles
    // gets at most ONE intro-priced post no matter how many recruiter
    // accounts post them.
    const introPostings = inputs.useIntroPrice ? Math.min(roles, 1) : 0;
    const proPostings = roles - introPostings;
    // Each renewal is priced by the post it renews: the intro post's at the
    // base price, a post bought at the posting price at the pro price.
    const baseRenewals = introPostings * renewalsPerRole;
    const proRenewals = proPostings * renewalsPerRole;
    const postingSpend = introPostings * FLAT_FEE_PRICING.introPrice + proPostings * FLAT_FEE_PRICING.postingPrice;
    const renewalSpend = baseRenewals * FLAT_FEE_PRICING.renewalPrice + proRenewals * FLAT_FEE_PRICING.proRenewalPrice;
    return {
        ...base,
        introPostings,
        proPostings,
        renewals: baseRenewals + proRenewals,
        baseRenewals,
        proRenewals,
        postingSpend,
        renewalSpend,
        total: postingSpend + renewalSpend,
    };
}

/**
 * Pack mode: the cheaper of the pack mix for every role, and, with the intro
 * price applied, the intro post first and the pack mix for the rest. The
 * intro post comes first because a paid pack uses up the domain's intro price
 * (lib/pricing.ts#getNextPaidTier). Chosen on what is paid at the till; pack
 * posts and the intro post renew at the base price, posts bought at the
 * posting price at the pro price.
 */
function packSpend(base: FlatFeeBreakdown, roles: number, renewalsPerRole: number, useIntroPrice: boolean): FlatFeeBreakdown {
    const withoutIntro = { introPostings: 0, ...packMix(roles) };
    const rest = packMix(Math.max(0, roles - 1));
    const withIntro = { introPostings: 1, ...rest, spend: FLAT_FEE_PRICING.introPrice + rest.spend };
    const mix = useIntroPrice && roles > 0 && withIntro.spend < withoutIntro.spend ? withIntro : withoutIntro;
    const baseRenewals = (mix.introPostings + mix.packPostings) * renewalsPerRole;
    const proRenewals = mix.proPostings * renewalsPerRole;
    const postingSpend = mix.introPostings * FLAT_FEE_PRICING.introPrice + mix.proPostings * FLAT_FEE_PRICING.postingPrice;
    const packSpendTotal = mix.packs * FLAT_FEE_PRICING.packPrice;
    const renewalSpend = baseRenewals * FLAT_FEE_PRICING.renewalPrice + proRenewals * FLAT_FEE_PRICING.proRenewalPrice;
    return {
        ...base,
        introPostings: mix.introPostings,
        proPostings: mix.proPostings,
        packs: mix.packs,
        packPostings: mix.packPostings,
        renewals: baseRenewals + proRenewals,
        baseRenewals,
        proRenewals,
        postingSpend,
        packSpend: packSpendTotal,
        renewalSpend,
        total: postingSpend + packSpendTotal + renewalSpend,
    };
}

/**
 * How the per-post and pack result lines price their renewals, appended to
 * "N renewals": the intro post and pack posts renew at the base price and a
 * post bought at the posting price at the pro price, so a line with both
 * kinds of post splits the count (" (1 at $199, 2 at $249)"), and a line
 * with one kind names its price.
 */
export function perPostRenewalPrices(flat: FlatFeeBreakdown): string {
    const basePosts = flat.introPostings + flat.packPostings;
    if (basePosts > 0 && flat.proPostings > 0) {
        return flat.renewals > 0
            ? ` (${flat.baseRenewals} at ${formatUsd(FLAT_FEE_PRICING.renewalPrice)}, ${flat.proRenewals} at ${formatUsd(FLAT_FEE_PRICING.proRenewalPrice)})`
            : '';
    }
    return ` at ${formatUsd(basePosts > 0 ? FLAT_FEE_PRICING.renewalPrice : FLAT_FEE_PRICING.proRenewalPrice)}`;
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

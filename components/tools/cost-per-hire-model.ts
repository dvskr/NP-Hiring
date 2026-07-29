/**
 * Employer cost-per-hire model (P3 #6b).
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
 * The two defaults that are not zero are traceable and labelled as such in the
 * UI:
 *   - time-to-fill defaults to the posting's own run length (config.durationDays),
 *     stated as "the posting window, not a benchmark";
 *   - first-year base defaults to the cited BLS median (STAT_SOURCES), because
 *     an agency fee is a percentage of something and the cited median is the
 *     only salary figure this board publishes as fact.
 *
 * The free-post quota is the one place this file states a RULE about our pricing
 * rather than a price, so it is scoped precisely: one free post per employer
 * email DOMAIN, lifetime, shared across every employee at that domain. See
 * FLAT_FEE_PRICING.freePostsPerDomain. Getting that scope wrong would inflate a
 * multi-recruiter employer's free allowance and understate its real spend, which
 * is exactly the error this page's premise forbids.
 *
 * Pure functions and plain data — no 'use client'.
 */
import { config } from '@/lib/config';
import { STAT_SOURCES } from '@/lib/stats-sources';

export type ChannelKey = 'flatFee' | 'cpc' | 'agency';

/** Flat-fee prices, straight from the pricing config. */
export const FLAT_FEE_PRICING = {
    postingPrice: config.postingPrice,
    renewalPrice: config.renewalPrice,
    /**
     * Free posts per employer EMAIL DOMAIN, lifetime — NOT per account and not
     * per user. The gate in app/api/jobs/post-free/route.ts counts existing free
     * posts against the immutable EmployerJob.quotaDomain snapshot taken from the
     * signup email's domain, so five recruiters at one health system share ONE
     * free post between them. Copy that says "per account" overstates the
     * giveaway and understates a multi-recruiter employer's flat-fee spend.
     */
    freePostsPerDomain: config.freePostsPerEmail,
    paidDurationDays: config.durationDays,
    freeDurationDays: config.freeDurationDays,
    candidateUnlocksPerPosting: config.limits.candidateUnlocksPerPosting,
    inmailsPerPosting: config.limits.inmailsPerPosting,
} as const;

/** Posting price per day of exposure — derived, not a new price. */
export const FLAT_FEE_COST_PER_DAY = FLAT_FEE_PRICING.postingPrice / FLAT_FEE_PRICING.paidDurationDays;

/**
 * The free-post rule as one string, rendered verbatim by every surface that
 * mentions it.
 *
 * There is exactly one correct statement of this quota and three places that
 * want to make it (the widget's checkbox, the page's assumptions, the page's
 * FAQ), which is how "per account" got asserted three times. One constant means
 * a single place to be right: the unit is the employer EMAIL DOMAIN, never an
 * account and never a user.
 */
const FREE_POST_NOUN = FLAT_FEE_PRICING.freePostsPerDomain === 1 ? 'free post' : 'free posts';
export const FREE_POST_SCOPE_NOTE =
    `${FLAT_FEE_PRICING.freePostsPerDomain} ${FREE_POST_NOUN} per employer email domain, lifetime, ` +
    `shared across everyone at your organization`;

/**
 * Default applicant volume for the flat-fee column.
 *
 * NOT a benchmark: it is the number of candidate profiles a posting includes
 * unlocks for, so it reflects what the plan ships, and the UI says exactly
 * that. Replace it with what your own postings actually draw.
 */
export const DEFAULT_APPLICANTS_PER_ROLE = FLAT_FEE_PRICING.candidateUnlocksPerPosting;

/**
 * Default time-to-fill for every channel: the paid posting's run length. Chosen
 * because it is a real product fact rather than an asserted market average, and
 * it applies the SAME number to every channel, so the default can never tilt
 * the comparison toward one of them.
 */
export const DEFAULT_TIME_TO_FILL_DAYS = FLAT_FEE_PRICING.paidDurationDays;

/** Default first-year base an agency fee is calculated against. */
export const DEFAULT_FIRST_YEAR_BASE = Number(STAT_SOURCES.averageSalary.value);
export const FIRST_YEAR_BASE_SOURCE = STAT_SOURCES.averageSalary.source;

export interface CostPerHireInputs {
    /** Roles you plan to fill. */
    roles: number;
    /** Renewals per role on the flat-fee channel. */
    renewalsPerRole: number;
    /**
     * Whether your employer email DOMAIN still has its one lifetime free post
     * available — shared across every colleague who signs up at that domain, so
     * one already-used free post anywhere in the organization means this is false.
     */
    useFreeFirstPost: boolean;
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
    freePostings: number;
    paidPostings: number;
    renewals: number;
    postingSpend: number;
    renewalSpend: number;
    total: number;
}

const atLeastZero = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
const wholeAtLeastZero = (n: number): number => Math.floor(atLeastZero(n));

/** Flat-fee spend for the whole hiring plan, priced from lib/config. */
export function flatFeeSpend(inputs: CostPerHireInputs): FlatFeeBreakdown {
    const roles = wholeAtLeastZero(inputs.roles);
    // Domain-scoped, not account-scoped: the quota is per employer email domain
    // for all time, so a plan for N roles gets at most freePostsPerDomain free
    // postings in total no matter how many recruiter accounts post them.
    const freePostings = inputs.useFreeFirstPost
        ? Math.min(roles, FLAT_FEE_PRICING.freePostsPerDomain)
        : 0;
    const paidPostings = roles - freePostings;
    const renewals = roles * atLeastZero(inputs.renewalsPerRole);
    const postingSpend = paidPostings * FLAT_FEE_PRICING.postingPrice;
    const renewalSpend = renewals * FLAT_FEE_PRICING.renewalPrice;
    return {
        freePostings,
        paidPostings,
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

/** Defaults the widget opens on. Every non-zero value is documented above. */
export const DEFAULT_INPUTS: CostPerHireInputs = {
    roles: 1,
    renewalsPerRole: 0,
    useFreeFirstPost: true,
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

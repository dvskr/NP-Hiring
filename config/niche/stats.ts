/**
 * Niche stats & marketing-claims pack — every CONCRETE CLAIM (numbers,
 * competitor comparisons, testimonial quotes, fallback employer chips)
 * previously hardcoded inside marketing components. This file is DATA
 * ONLY: layout and logic stay in the components; each export below is
 * rendered verbatim by exactly one component (named per section).
 *
 * Relationship to lib/stats-sources.ts: that file holds CITATION-BACKED
 * figures (value + source URL + as-of date) reused across pages. The
 * values here are uncited marketing copy owned by this board — none of
 * the components cited a source, and some values do not even agree with
 * the cited figures (see CAREER_PULSE_STATS). Copied verbatim from the
 * components; nothing here was verified or updated during extraction.
 *
 * ── FORK WARNING ──────────────────────────────────────────────────────
 * These are PMHNP-board-specific facts. A fork that ships them unedited
 * publishes FALSE CLAIMS (listing counts, growth rates, salary figures,
 * competitor comparisons) and FAKE ENDORSEMENTS (placeholder testimonial
 * quotes, fabricated employer chips). Re-author or empty EVERY export
 * before launching a new board. FALLBACK_EMPLOYERS is the most dangerous:
 * it actively renders invented employer names + job counts on any board
 * whose database has fewer than 10 employers — i.e. on every new fork.
 */

/* ══════════════════════════════════════════════════════════════════════
 * components/WhyUs.tsx — "Why PMHNPs Choose Us" feature rows.
 * Currently not mounted on any route (kept as a homepage-style marketing
 * section). No source is cited in the component for any figure.
 *
 * FORK WARNING: '10,000+ verified listings', '500+ healthcare employers',
 * '3,000+ sources monitored', and '73% show salary' are claims about THIS
 * board's inventory. They are false on a new board with an empty database
 * — re-measure or delete before mounting this section.
 * ══════════════════════════════════════════════════════════════════════ */

export interface WhyUsFeature {
    /** Two-digit ordinal rendered as the row number. */
    num: string;
    /** Accent color for the number gradient, line, and stat. */
    color: string;
    title: string;
    desc: string;
    /** Big right-aligned stat value. */
    stat: string;
    statLabel: string;
}

export const WHY_US_FEATURES: readonly WhyUsFeature[] = [
    {
        num: '01',
        color: '#E86C2C',
        title: '100% PMHNP Roles',
        desc: 'Every listing is verified for relevance. No physician assistant roles, no general NP positions, no irrelevant noise.',
        stat: '10,000+',
        statLabel: 'verified listings',
    },
    {
        num: '02',
        color: '#2dd4bf',
        title: 'Updated Daily',
        desc: 'We aggregate from 500+ healthcare employers, ATS feeds, and job boards — refreshed every 24 hours.',
        stat: '3,000+',
        statLabel: 'sources monitored',
    },
    {
        num: '03',
        color: '#22c55e',
        title: 'Salary Transparency',
        desc: 'See compensation upfront. We surface salary data whenever available so you skip the guesswork.',
        stat: '73%',
        statLabel: 'show salary',
    },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/Comparison.tsx — "How We Compare" feature matrix vs Indeed,
 * LinkedIn, and ZipRecruiter. Currently not mounted on any route.
 * No source is cited in the component for any competitor rating.
 *
 * FORK WARNING: these are unverified claims about NAMED third-party
 * companies ('Indeed', 'LinkedIn', 'ZipRecruiter') plus self-claims for
 * this board ('PMHNP Hiring'). A fork must rename the highlighted row to
 * its own brand and independently substantiate — or delete — every
 * competitor cell before mounting this section.
 * ══════════════════════════════════════════════════════════════════════ */

export type ComparisonStatus = 'yes' | 'no' | 'partial';

export interface ComparisonPlatform {
    name: string;
    highlighted?: boolean;
    features: Record<string, ComparisonStatus>;
}

/** Row labels of the comparison matrix, in render order. */
export const COMPARISON_FEATURE_LABELS: readonly string[] = [
    'PMHNP-Specific',
    'Zero Irrelevant Roles',
    'Salary Transparency',
    'Free Job Alerts',
    'Employer Direct',
];

export const COMPARISON_PLATFORMS: readonly ComparisonPlatform[] = [
    {
        name: 'PMHNP Hiring',
        highlighted: true,
        features: {
            'PMHNP-Specific': 'yes',
            'Zero Irrelevant Roles': 'yes',
            'Salary Transparency': 'yes',
            'Free Job Alerts': 'yes',
            'Employer Direct': 'yes',
        },
    },
    {
        name: 'Indeed',
        features: {
            'PMHNP-Specific': 'no',
            'Zero Irrelevant Roles': 'no',
            'Salary Transparency': 'partial',
            'Free Job Alerts': 'yes',
            'Employer Direct': 'no',
        },
    },
    {
        name: 'LinkedIn',
        features: {
            'PMHNP-Specific': 'no',
            'Zero Irrelevant Roles': 'no',
            'Salary Transparency': 'no',
            'Free Job Alerts': 'yes',
            'Employer Direct': 'partial',
        },
    },
    {
        name: 'ZipRecruiter',
        features: {
            'PMHNP-Specific': 'no',
            'Zero Irrelevant Roles': 'no',
            'Salary Transparency': 'partial',
            'Free Job Alerts': 'yes',
            'Employer Direct': 'no',
        },
    },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/Testimonial.tsx — "What PMHNPs Are Saying" quote cards.
 * Currently not mounted on any route. The component carried a
 * `// TODO: Replace with real testimonials` marker: these are PLACEHOLDER
 * quotes attributed to invented people ('Sarah M.', 'James R.',
 * 'Priya K.'), each rendered with a 5-star rating.
 *
 * FORK WARNING: publishing these is publishing FAKE ENDORSEMENTS — an
 * FTC-endorsement-guides violation, not just stale copy. Replace with
 * real, consented testimonials (the dashboard's Share Your Story card
 * collects them) or leave this array empty and keep the section unmounted.
 * ══════════════════════════════════════════════════════════════════════ */

export interface TestimonialEntry {
    quote: string;
    name: string;
    credential: string;
    /** Accent color for the card border, quote mark, and avatar. */
    color: string;
}

export const TESTIMONIALS: readonly TestimonialEntry[] = [
    {
        quote: 'Found my telehealth role in two weeks. No more filtering out irrelevant PA and NP positions.',
        name: 'Sarah M.',
        credential: 'PMHNP-BC',
        color: '#E86C2C',
    },
    {
        quote: 'Salary transparency saved me weeks of back-and-forth. I could compare offers and negotiate confidently.',
        name: 'James R.',
        credential: 'PMHNP-BC',
        color: '#2dd4bf',
    },
    {
        quote: 'As a new grad, I filtered for entry-level roles and had three interviews within a week.',
        name: 'Priya K.',
        credential: 'PMHNP',
        color: '#8b5cf6',
    },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/jobs/SidebarVisualCards.tsx (CareerPulseCard) — "PMHNP
 * Career Pulse" stat pebbles in the job-detail sidebar
 * (app/jobs/[slug]/page.tsx). The component's comment calls these
 * "industry stats" but cites no source, and they DIVERGE from the
 * citation-backed values in lib/stats-sources.ts ('43%' growth vs the
 * cited 45% BLS 2022–2032 projection; '$160K+' median vs the cited
 * $155,000 BLS average). Copied verbatim — NOT reconciled.
 *
 * FORK WARNING: growth %, salary, and the '2,400+ active openings
 * nationwide' count are PMHNP/US-specific (BLS-flavored) figures and the
 * openings count is a claim about this board's inventory. Re-source all
 * three per niche — ideally from lib/stats-sources.ts entries — before
 * shipping a fork.
 * ══════════════════════════════════════════════════════════════════════ */

export interface CareerPulseStat {
    emoji: string;
    value: string;
    label: string;
    /** Pebble icon background color. */
    color: string;
}

export const CAREER_PULSE_STATS: readonly CareerPulseStat[] = [
    { emoji: '📈', value: '43%', label: 'Projected growth 2024-2034', color: '#D5F5F1' },
    { emoji: '💰', value: '$160K+', label: 'Median annual salary', color: '#FDE68A' },
    { emoji: '🏥', value: '2,400+', label: 'Active openings nationwide', color: '#BFDBFE' },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/EmployerTrustSection.tsx — fallback employer chips for the
 * homepage trust strip (app/page.tsx). Rendered whenever the database
 * yields FEWER THAN 10 real employers — which is always true on a fresh
 * board — padding the strip to 18 chips. Every name is a real US
 * mental-health company (Talkiatry, BetterHelp, …) and every job count
 * is INVENTED; no source exists for any of these numbers.
 *
 * FORK WARNING: this is the most dangerous export in the file. Shipping
 * it unedited displays fabricated "N jobs" chips for real companies that
 * have no relationship with your board — false claims AND implied fake
 * endorsements. Forks should set this to [] (the strip then shows only
 * real DB employers) or replace it with employers/logos you have real
 * listings or permission for.
 * ══════════════════════════════════════════════════════════════════════ */

export const FALLBACK_EMPLOYERS: ReadonlyArray<{ name: string; count: number }> = [
    { name: 'Talkiatry', count: 47 },
    { name: 'LifeStance Health', count: 32 },
    { name: 'Cerebral', count: 18 },
    { name: 'Headway', count: 24 },
    { name: 'Grow Therapy', count: 39 },
    { name: 'Spring Health', count: 15 },
    { name: 'Modern Health', count: 22 },
    { name: 'Lyra Health', count: 28 },
    { name: 'BetterHelp', count: 41 },
    { name: 'Alma', count: 13 },
    { name: 'Geode Health', count: 17 },
    { name: 'Mindpath Health', count: 19 },
    { name: 'Rula Health', count: 12 },
    { name: 'Brightside', count: 14 },
    { name: 'Noom', count: 35 },
    { name: 'Eleanor Health', count: 11 },
    { name: 'Quartet Health', count: 9 },
    { name: 'SilverCloud', count: 16 },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/dashboard/DashboardContent.tsx — candidate dashboard
 * (app/dashboard/page.tsx). Two uncited numeric marketing claims.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Sentence under the "Your profile needs attention" heading on the
 * profile-completeness card. No source is cited for the '5x' multiplier
 * or the '80%+' threshold.
 *
 * FORK WARNING: an unsubstantiated engagement claim about THIS board's
 * employers. Substantiate from your own data or soften/delete per board.
 */
export const DASHBOARD_PROFILE_NUDGE_CLAIM =
    'Employers are 5x more likely to reach out to profiles that are 80%+ complete.';

/**
 * "Job Market Pulse" sidebar card body. Rendered as
 * {lead}<highlighted metric>{tail} — the component styles `metric` in
 * teal. No source is cited for the '18%' quarterly growth figure, and it
 * is not derived from live data.
 *
 * FORK WARNING: a fabricated-looking, time-sensitive growth stat that is
 * false the moment the quarter changes, and doubly false on another
 * niche. Wire to real analytics or delete the card per board.
 */
export const DASHBOARD_MARKET_PULSE = {
    lead: 'PMHNP roles grew ',
    metric: '18%',
    tail: ' this quarter. Telehealth surging.',
} as const;

/**
 * Niche stats & marketing-claims pack — every CONCRETE CLAIM (numbers,
 * competitor comparisons, testimonial quotes, fallback employer chips)
 * previously hardcoded inside marketing components. This file is DATA
 * ONLY: layout and logic stay in the components; each export below is
 * rendered verbatim by exactly one component (named per section).
 *
 * Relationship to lib/stats-sources.ts: that file holds CITATION-BACKED
 * figures (value + source URL + as-of date) reused across pages. The
 * values here are uncited marketing copy owned by this board.
 *
 * ── NP HIRING LAUNCH STATUS (2026-07-02) ─────────────────────────────
 * This board launches FRESH. Every claim below was either:
 *   (a) ported from the hand-forked NP donor board where its phase-8
 *       marketing rewrite produced an honest NP value,
 *   (b) re-authored to an HONEST day-one value (335 jobs from the
 *       initial ATS smoke ingest; 8 active ATS sources), or
 *   (c) EMPTIED because no honest source exists (testimonials,
 *       fallback employer chips).
 * Salary figures were retuned to NP reality (~$126k national average,
 * BLS OEWS Nurse Practitioners) — see the per-export notes, and the
 * LAUNCH TODO in lib/stats-sources.ts (still carrying the $155k
 * PMHNP-era cited figure until re-sourced).
 *
 * ── FORK WARNING ──────────────────────────────────────────────────────
 * A future fork that ships these values unedited publishes claims about
 * THIS board's inventory. Re-author or empty EVERY export before
 * launching a new board. FALLBACK_EMPLOYERS must stay [] unless you have
 * real listings or permission for every named employer.
 */

/* ══════════════════════════════════════════════════════════════════════
 * components/WhyUs.tsx — "Why NPs Choose Us" feature rows.
 * Currently not mounted on any route (kept as a homepage-style marketing
 * section).
 *
 * NP HIRING: re-authored to honest day-one values. The donor's phase-8
 * pass retitled row 01 to '100% NP Roles' but kept its old '10,000+
 * verified listings' / '3,000+ sources monitored' / '73% show salary'
 * claims — all false on a fresh board, so they were replaced here:
 *   - '335+' = jobs from the initial ATS smoke ingest (update as the
 *     board grows);
 *   - '8'    = active ATS adapters (Greenhouse, Lever, Workday,
 *     SmartRecruiters, Ashby, BambooHR, JazzHR, Workable);
 *   - 'Free' = job seekers pay nothing (structurally true).
 * Re-measure before mounting this section.
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
        title: '100% NP & APRN Roles',
        desc: 'Every listing is verified for relevance. Nurse practitioner and APRN positions only — no physician assistant roles, no RN staffing noise.',
        stat: '335+',
        statLabel: 'verified NP listings',
    },
    {
        num: '02',
        color: '#F472B6',
        title: 'Updated Daily',
        desc: 'We ingest directly from employer ATS feeds — Greenhouse, Lever, Workday, and more — refreshed every 24 hours.',
        stat: '8',
        statLabel: 'ATS sources monitored',
    },
    {
        num: '03',
        color: '#22c55e',
        title: 'Salary Transparency',
        desc: 'See compensation upfront. We surface salary data whenever available so you skip the guesswork.',
        stat: 'Free',
        statLabel: 'for job seekers',
    },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/Comparison.tsx — "How We Compare" feature matrix vs Indeed,
 * LinkedIn, and ZipRecruiter. Currently not mounted on any route.
 *
 * NP HIRING: ported from the donor's phase-8 rewrite — it renamed the
 * niche row to 'NP-Specific' and the highlighted platform to 'NP Hiring'
 * and kept the competitor cells unchanged.
 *
 * FORK WARNING: the competitor cells are UNVERIFIED claims about NAMED
 * third-party companies ('Indeed', 'LinkedIn', 'ZipRecruiter').
 * Independently substantiate — or delete — every competitor cell before
 * mounting this section.
 * ══════════════════════════════════════════════════════════════════════ */

export type ComparisonStatus = 'yes' | 'no' | 'partial';

export interface ComparisonPlatform {
    name: string;
    highlighted?: boolean;
    features: Record<string, ComparisonStatus>;
}

/** Row labels of the comparison matrix, in render order. */
export const COMPARISON_FEATURE_LABELS: readonly string[] = [
    'NP-Specific',
    'Zero Irrelevant Roles',
    'Salary Transparency',
    'Free Job Alerts',
    'Employer Direct',
];

export const COMPARISON_PLATFORMS: readonly ComparisonPlatform[] = [
    {
        name: 'NP Hiring',
        highlighted: true,
        features: {
            'NP-Specific': 'yes',
            'Zero Irrelevant Roles': 'yes',
            'Salary Transparency': 'yes',
            'Free Job Alerts': 'yes',
            'Employer Direct': 'yes',
        },
    },
    {
        name: 'Indeed',
        features: {
            'NP-Specific': 'no',
            'Zero Irrelevant Roles': 'no',
            'Salary Transparency': 'partial',
            'Free Job Alerts': 'yes',
            'Employer Direct': 'no',
        },
    },
    {
        name: 'LinkedIn',
        features: {
            'NP-Specific': 'no',
            'Zero Irrelevant Roles': 'no',
            'Salary Transparency': 'no',
            'Free Job Alerts': 'yes',
            'Employer Direct': 'partial',
        },
    },
    {
        name: 'ZipRecruiter',
        features: {
            'NP-Specific': 'no',
            'Zero Irrelevant Roles': 'no',
            'Salary Transparency': 'partial',
            'Free Job Alerts': 'yes',
            'Employer Direct': 'no',
        },
    },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/Testimonial.tsx — "What NPs Are Saying" quote cards.
 * Currently not mounted on any route.
 *
 * NP HIRING: EMPTY by design. The donor still shipped placeholder quotes
 * attributed to invented people — publishing those is publishing FAKE
 * ENDORSEMENTS (an FTC-endorsement-guides violation). This board launches
 * with zero testimonials; the component returns null when this array is
 * empty. Populate ONLY with real, consented testimonials (the dashboard's
 * Share Your Story card collects them).
 * ══════════════════════════════════════════════════════════════════════ */

export interface TestimonialEntry {
    quote: string;
    name: string;
    credential: string;
    /** Accent color for the card border, quote mark, and avatar. */
    color: string;
}

export const TESTIMONIALS: readonly TestimonialEntry[] = [];

/* ══════════════════════════════════════════════════════════════════════
 * components/jobs/SidebarVisualCards.tsx (CareerPulseCard) — "NP Career
 * Pulse" stat pebbles in the job-detail sidebar
 * (app/jobs/[slug]/page.tsx). This card IS live on every job page.
 *
 * NP HIRING: retuned to NP-wide reality:
 *   - '45%' growth matches the ONLY cited growth figure on this board
 *     (lib/stats-sources.ts blsGrowth2032 — BLS OOH Nurse Practitioners,
 *     2022–2032 projection). Do not let this drift from that file.
 *   - '$126K' average annual salary reflects BLS OEWS Nurse Practitioners
 *     (≈$126k national average). NOTE: lib/stats-sources.ts still carries
 *     the PMHNP-era $155,000 cited figure — re-sourcing that file is a
 *     LAUNCH TODO; until it lands, that file and this pebble deliberately
 *     disagree ($155k cited vs $126K here). Resolve by re-sourcing, not
 *     by copying the stale $155k.
 *   - '335+' active openings is THIS board's honest day-one inventory
 *     (initial ATS smoke ingest). Update as inventory grows — ideally
 *     wire to lib/site-stats.ts cached counters.
 * ══════════════════════════════════════════════════════════════════════ */

export interface CareerPulseStat {
    emoji: string;
    value: string;
    label: string;
    /** Pebble icon background color. */
    color: string;
}

export const CAREER_PULSE_STATS: readonly CareerPulseStat[] = [
    { emoji: '📈', value: '45%', label: 'Projected growth 2022-2032', color: '#D5F5F1' },
    { emoji: '💰', value: '$126K', label: 'Average annual salary', color: '#FDE68A' },
    { emoji: '🏥', value: '335+', label: 'Openings on this board', color: '#BFDBFE' },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/EmployerTrustSection.tsx — fallback employer chips for the
 * homepage trust strip (app/page.tsx). Rendered whenever the database
 * yields FEWER THAN 10 real employers — which is always true on a fresh
 * board.
 *
 * NP HIRING: EMPTY — MANDATORY. The donor still shipped the fabricated
 * PMHNP-era chips (real mental-health company names with invented job
 * counts). Shipping fabricated "N jobs" chips for real companies is a
 * false claim AND an implied fake endorsement. With this array empty the
 * strip shows only real DB employers (EmployerTrustSection returns null
 * when there are none at all). Only repopulate with employers you have
 * real listings or explicit permission for.
 * ══════════════════════════════════════════════════════════════════════ */

export const FALLBACK_EMPLOYERS: ReadonlyArray<{ name: string; count: number }> = [];

/* ══════════════════════════════════════════════════════════════════════
 * components/dashboard/DashboardContent.tsx — candidate dashboard
 * (app/dashboard/page.tsx). Two previously fabricated numeric claims,
 * both neutralized for launch.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Sentence under the "Your profile needs attention" heading on the
 * profile-completeness card.
 *
 * NP HIRING: the donor kept an unsourced '5x more likely' multiplier.
 * Neutralized here — no fabricated statistic. Re-introduce a number only
 * once this board's own analytics substantiate one.
 */
export const DASHBOARD_PROFILE_NUDGE_CLAIM =
    'A complete profile makes it easier for employers to find you and reach out.';

/**
 * "Job Market Pulse" sidebar card body. Rendered as
 * {lead}<highlighted metric>{tail} — the component styles `metric` in
 * the berry accent color.
 *
 * NP HIRING: the donor kept a fabricated '18% this quarter' growth stat.
 * Replaced with a structurally true statement about this board's own
 * ingestion cadence (scheduled crons ingest from employer ATS feeds
 * daily). Wire to real analytics before making any market-growth claim.
 */
export const DASHBOARD_MARKET_PULSE = {
    lead: 'New NP roles are added ',
    metric: 'daily',
    tail: ' from employer ATS feeds across all 50 states.',
} as const;

/* ══════════════════════════════════════════════════════════════════════
 * ── Scattered salary claims ──────────────────────────────────────────
 *
 * Salary figures that were hardcoded inside individual UI components,
 * extracted here. This is a THIRD family of salary numbers on this
 * board, independent of the other two:
 *   1. config/niche/salary.ts — pipeline validation/clamp/period bands
 *      (out of scope for this pass — do not retune casually; the bands
 *      decide which salaries survive ingestion);
 *   2. lib/stats-sources.ts — CITATION-BACKED figures. ⚠️ LAUNCH TODO:
 *      that file still carries the PMHNP-era $155,000 figure; it must be
 *      re-sourced to the NP-wide BLS OEWS value (~$126k) before the
 *      salary-guide/FAQ surfaces ship.
 * The three families must be retuned TOGETHER — the pipeline bands gate
 * which salaries exist, the cited figures anchor SEO/E-E-A-T copy, and
 * the UI claims below are what users actually see next to real jobs.
 *
 * INTERNAL-CONTRADICTION STATUS (NP retune, 2026-07-02): the UI-family
 * values below were reconciled to a single $126k NP national average:
 *   • SALARY_COMPARISON_NATIONAL_AVG_K = 126
 *   • SALARY_INSIGHTS_DEFAULT_NATIONAL_AVG_K = 126
 *   • STATE_FAQ_NATIONAL_AVG_SALARY_TEXT = '$126,000'
 *   • CAREER_PULSE_STATS '$126K'
 * ONE contradiction remains BY DESIGN: lib/stats-sources.ts still cites
 * $155,000 (stale PMHNP figure) until its launch-TODO re-sourcing lands.
 * A job-detail page therefore stays internally consistent, but any
 * surface quoting stats-sources.ts will disagree until that file is
 * re-sourced. Fix stats-sources.ts; do NOT regress these back to $155k.
 * ══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════
 * components/jobs/LinkedInFilters.tsx — "Salary" checkbox buckets in the
 * jobs-list filter sidebar (app/jobs/JobsPageClient.tsx) and the mobile
 * filter drawer (components/MobileFilterDrawer.tsx).
 *
 * NOT display-only — each field is query-coupled:
 *   • `value` is written to the `salaryMin` URL param on toggle
 *     (lib/filters.ts filtersToParams / parseFiltersFromParams) and used
 *     verbatim as the DB threshold (normalizedMin/MaxSalary >= salaryMin);
 *   • `countKey` must be one of the FIXED FilterCounts.salary keys
 *     (types/filters.ts) computed by POST /api/jobs/filter-counts.
 * Changing a `label` here is safe; changing a `value` changes query
 * behavior; adding or re-thresholding a bucket ALSO requires a matching
 * count bucket in the filter-counts API or its badge renders 0.
 *
 * NP HIRING: thresholds kept from the donor ($100k/$150k/$200k). With an
 * NP national average around $126k the $100k+ bucket captures the bulk
 * of listings, $150k+ captures the premium tier (CRNA, senior, high-COL),
 * and $200k+ the top slice — still a meaningful spread for this niche.
 * ══════════════════════════════════════════════════════════════════════ */

export interface SalaryFilterBucket {
    /** Checkbox label rendered in the "Salary" filter section. */
    label: string;
    /** Annual USD minimum written verbatim to the `salaryMin` query param. */
    value: number;
    /** FilterCounts.salary key holding this bucket's live job count. */
    countKey: 'over100k' | 'over150k' | 'over200k';
}

export const SALARY_FILTER_BUCKETS: readonly SalaryFilterBucket[] = [
    { label: '$100,000+', value: 100000, countKey: 'over100k' },
    { label: '$150,000+', value: 150000, countKey: 'over150k' },
    { label: '$200,000+', value: 200000, countKey: 'over200k' },
];

/* ══════════════════════════════════════════════════════════════════════
 * components/SalaryComparisonWidget.tsx — "National Avg" figure (in $k)
 * in the "💰 Salary Insights for {state}" card on the job-detail page
 * (app/jobs/[slug]/page.tsx). Also the DENOMINATOR of the "{state} pays
 * ±N% above/below the national average" comparison line, so changing it
 * silently changes every state-vs-national percentage.
 *
 * NP HIRING: retuned from the donor's stale $158k (PMHNP-era) to $126k —
 * BLS OEWS Nurse Practitioners national average. Consistent with
 * SALARY_INSIGHTS_DEFAULT_NATIONAL_AVG_K, STATE_FAQ_NATIONAL_AVG_SALARY_TEXT,
 * and CAREER_PULSE_STATS. See the contradiction status block above re:
 * lib/stats-sources.ts.
 * ══════════════════════════════════════════════════════════════════════ */

export const SALARY_COMPARISON_NATIONAL_AVG_K = 126; // ~$126k national average for NPs (BLS OEWS)

/* ══════════════════════════════════════════════════════════════════════
 * components/SalaryInsights.tsx — default for the optional
 * `nationalAvgSalary` prop (in $k): the "National average: $126k"
 * footnote under the state-average card. The component is imported by
 * app/jobs/[slug]/page.tsx but NOT currently rendered on any route, so
 * this default is LATENT — it applies the moment a call site mounts the
 * component without passing the prop.
 *
 * NP HIRING: retuned to $126k, matching SALARY_COMPARISON_NATIONAL_AVG_K
 * (the two defaults aim at the same job-detail surface and must agree).
 * ══════════════════════════════════════════════════════════════════════ */

export const SALARY_INSIGHTS_DEFAULT_NATIONAL_AVG_K = 126;

/* ══════════════════════════════════════════════════════════════════════
 * components/StateFAQ.tsx — display string templated MID-SENTENCE into
 * the no-state-data fallback answer of "What is the average NP salary
 * in {state}?" on state pages (app/jobs/state/[state]/page.tsx). The
 * answer string is emitted BOTH as visible accordion copy
 * (StateFAQAccordion) and inside FAQPage JSON-LD, so this must remain
 * the exact display form ('$126,000') — not a number to re-format — for
 * the sentence to reassemble byte-identically.
 *
 * NP HIRING: retuned to '$126,000' (BLS OEWS Nurse Practitioners ≈$126k).
 * ⚠️ Disagrees with lib/stats-sources.ts ($155,000 stale cited figure)
 * until that file's launch-TODO re-sourcing lands — see the
 * contradiction status block above.
 * ══════════════════════════════════════════════════════════════════════ */

export const STATE_FAQ_NATIONAL_AVG_SALARY_TEXT = '$126,000';

/* ══════════════════════════════════════════════════════════════════════
 * components/SalaryCalculator.tsx — multiplier tables for the "NP Salary
 * Calculator" on the salary guide (app/salary-guide/page.tsx). The three
 * multipliers are applied MULTIPLICATIVELY to a live base (selected
 * state average, or the DB-computed national average passed in as
 * `nationalAvg` — the base is NOT hardcoded). The ±10% low/high band,
 * the 2080 hours/yr hourly conversion, and the estimates footnote remain
 * in the component as calculation/layout.
 *
 * COUPLING: the component's default selections are useState('mid'),
 * useState('outpatient'), useState('general') — those `value` strings
 * must keep existing entries here or the selects start out unmatched.
 *
 * NP HIRING: option LISTS re-labeled from the donor's psychiatric
 * sub-specialties to NP-wide settings/specialties; MULTIPLIER values
 * reuse the donor's magnitudes (no independent NP source exists for
 * them). ⚠️ These multipliers are UNCITED ESTIMATES — validating them
 * against this board's own salary data is a launch TODO. The component
 * already labels output as estimates.
 * ══════════════════════════════════════════════════════════════════════ */

export interface SalaryCalcOption {
    /** <option> text shown in the calculator dropdown. */
    label: string;
    /** Stable option value — coupled to the component's useState defaults. */
    value: string;
    /** Factor applied to the running salary estimate. */
    multiplier: number;
}

export const SALARY_CALC_EXPERIENCE_OPTIONS: readonly SalaryCalcOption[] = [
    { label: 'New Grad (0-1 yr)', value: 'new-grad', multiplier: 0.82 },
    { label: 'Early Career (1-3 yrs)', value: 'early', multiplier: 0.93 },
    { label: 'Mid-Career (3-7 yrs)', value: 'mid', multiplier: 1.0 },
    { label: 'Experienced (7-15 yrs)', value: 'experienced', multiplier: 1.12 },
    { label: 'Expert (15+ yrs)', value: 'expert', multiplier: 1.28 },
];

export const SALARY_CALC_SETTING_OPTIONS: readonly SalaryCalcOption[] = [
    { label: 'Private Practice (Owner)', value: 'private', multiplier: 1.35 },
    { label: 'Travel / Locum Tenens', value: 'travel', multiplier: 1.20 },
    { label: 'Telehealth / Remote', value: 'telehealth', multiplier: 1.02 },
    { label: 'Outpatient Clinic', value: 'outpatient', multiplier: 0.95 },
    { label: 'Hospital / Inpatient', value: 'hospital', multiplier: 0.90 },
    { label: 'Community Health (FQHC)', value: 'community', multiplier: 0.78 },
];

export const SALARY_CALC_SPECIALTY_OPTIONS: readonly SalaryCalcOption[] = [
    { label: 'Primary Care / General', value: 'general', multiplier: 1.0 },
    { label: 'Psychiatric Mental Health (PMHNP)', value: 'psych', multiplier: 1.17 },
    { label: 'Acute Care / Hospitalist', value: 'acute', multiplier: 1.12 },
    { label: 'Emergency', value: 'emergency', multiplier: 1.15 },
    { label: 'Dermatology / Aesthetics', value: 'derm', multiplier: 1.10 },
    { label: 'Geriatric', value: 'geriatric', multiplier: 1.07 },
];

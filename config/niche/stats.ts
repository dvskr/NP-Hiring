/**
 * Niche stats & marketing-claims pack — every CONCRETE CLAIM (numbers,
 * fallback employer chips, dashboard copy) previously hardcoded inside
 * marketing components. This file is DATA ONLY: layout and logic stay in
 * the components; each export below is rendered verbatim by exactly one
 * component (named per section).
 *
 * Relationship to lib/stats-sources.ts: that file holds CITATION-BACKED
 * figures (value + source URL + as-of date). Every salary/growth number
 * in THIS file now DERIVES from STAT_SOURCES so the two families cannot
 * disagree — update lib/stats-sources.ts and these constants follow.
 *
 * ── NP HIRING LAUNCH STATUS (2026-07-02, updated 2026-07-18) ─────────
 * This board launches FRESH. Claims here were either re-authored to
 * honest values or EMPTIED because no honest source exists (fallback
 * employer chips). The unmounted donor marketing sections (WhyUs,
 * Comparison, Testimonial) and their data packs were DELETED 2026-07-18
 * (citation-trust sweep B10) — they carried stale day-one inventory
 * claims ('verified NP listings' counts) and unverified competitor claims. If a
 * future board wants those sections, re-author them from the donor repo
 * with values measured at that time.
 *
 * ── FORK WARNING ──────────────────────────────────────────────────────
 * A future fork that ships these values unedited publishes claims about
 * THIS board. Re-author or empty EVERY export before launching a new
 * board. FALLBACK_EMPLOYERS must stay [] unless you have real listings
 * or permission for every named employer.
 */

import { STAT_SOURCES } from '@/lib/stats-sources';

/* ══════════════════════════════════════════════════════════════════════
 * ── Derived national-average salary (single source of truth) ─────────
 *
 * All UI salary constants below derive from STAT_SOURCES.averageSalary
 * (BLS OEWS, Nurse Practitioners 29-1171 — median annual wage, May 2024,
 * $129,210). The prior 126K-era hardcodes (an earlier OEWS vintage) were
 * reconciled 2026-07-18 (citation-trust sweep B4/B51): the homepage FAQ,
 * salary guide, job-page widgets, and state FAQs now all quote the same
 * cited figure. Do NOT re-hardcode a salary anywhere — update
 * lib/stats-sources.ts instead.
 * ══════════════════════════════════════════════════════════════════════ */

/** National average NP salary in $K, derived from the cited BLS figure. */
export const NATIONAL_AVG_SALARY_K = Math.round(
    Number(STAT_SOURCES.averageSalary.value) / 1000
);

/* ══════════════════════════════════════════════════════════════════════
 * components/jobs/SidebarVisualCards.tsx (CareerPulseCard) — "NP Career
 * Pulse" stat pebbles in the job-detail sidebar
 * (app/jobs/[slug]/page.tsx). This card IS live on every job page.
 *
 * NP HIRING:
 *   - growth derives from STAT_SOURCES.blsGrowth2032 (BLS Employment
 *     Projections, NP-specific 2022–2032);
 *   - salary derives from STAT_SOURCES.averageSalary (BLS OEWS May 2024);
 *   - the former hardcoded 'openings on this board' count pebble was
 *     replaced with an evergreen cadence claim (citation-trust sweep
 *     B5). Hardcoded inventory counts go stale immediately — the board
 *     held 900+ jobs within days of the day-one snapshot (see the RULE in
 *     config/niche/copy.ts). For live counts, wire lib/site-stats.ts
 *     cached counters into the component instead of putting a number
 *     here. Guarded by tests/regressions/aeo-content-inventory-claims.
 * ══════════════════════════════════════════════════════════════════════ */

export interface CareerPulseStat {
    emoji: string;
    value: string;
    label: string;
    /** Pebble icon background color. */
    color: string;
}

export const CAREER_PULSE_STATS: readonly CareerPulseStat[] = [
    { emoji: '📈', value: STAT_SOURCES.blsGrowth2032.formatted, label: 'Projected growth 2022-2032', color: '#D5F5F1' },
    { emoji: '💰', value: `$${NATIONAL_AVG_SALARY_K}K`, label: 'Median annual salary (BLS)', color: '#FDE68A' },
    { emoji: '🏥', value: 'Daily', label: 'New jobs from employer ATS feeds', color: '#BFDBFE' },
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
 * extracted here. Two related families exist on this board:
 *   1. config/niche/salary.ts — pipeline validation/clamp/period bands
 *      (out of scope for this pass — do not retune casually; the bands
 *      decide which salaries survive ingestion);
 *   2. lib/stats-sources.ts — CITATION-BACKED figures ($129,210 BLS OEWS
 *      May 2024 median). The UI constants below DERIVE from that file
 *      (citation-trust sweep B4/B51, 2026-07-18) so a job-detail page,
 *      the homepage FAQ, and the salary guide all quote one figure.
 * The pipeline bands still gate which salaries exist — retune them
 * alongside any major stats-sources change.
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
 * NP national median around $129k the $100k+ bucket captures the bulk
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
 * NP HIRING: derives from STAT_SOURCES.averageSalary (BLS OEWS May 2024
 * median, $129,210 → 129). Consistent by construction with
 * SALARY_INSIGHTS_DEFAULT_NATIONAL_AVG_K, STATE_FAQ_NATIONAL_AVG_SALARY_TEXT,
 * and CAREER_PULSE_STATS.
 * ══════════════════════════════════════════════════════════════════════ */

export const SALARY_COMPARISON_NATIONAL_AVG_K = NATIONAL_AVG_SALARY_K;

/* ══════════════════════════════════════════════════════════════════════
 * components/SalaryInsights.tsx — default for the optional
 * `nationalAvgSalary` prop (in $k): the "National average: $129k"
 * footnote under the state-average card. The component is imported by
 * app/jobs/[slug]/page.tsx but NOT currently rendered on any route, so
 * this default is LATENT — it applies the moment a call site mounts the
 * component without passing the prop.
 *
 * NP HIRING: derives from the same cited figure as
 * SALARY_COMPARISON_NATIONAL_AVG_K (the two defaults aim at the same
 * job-detail surface and must agree).
 * ══════════════════════════════════════════════════════════════════════ */

export const SALARY_INSIGHTS_DEFAULT_NATIONAL_AVG_K = NATIONAL_AVG_SALARY_K;

/* ══════════════════════════════════════════════════════════════════════
 * components/StateFAQ.tsx — display string templated MID-SENTENCE into
 * the no-state-data fallback answer of "What is the average NP salary
 * in {state}?" on state pages (app/jobs/state/[state]/page.tsx). The
 * answer string is emitted BOTH as visible accordion copy
 * (StateFAQAccordion) and inside FAQPage JSON-LD, so this must remain
 * an exact display form — not a number to re-format — for the sentence
 * to reassemble byte-identically.
 *
 * NP HIRING: derives from STAT_SOURCES.averageSalary.formatted
 * ('$129,210' — BLS OEWS May 2024 median).
 * ══════════════════════════════════════════════════════════════════════ */

export const STATE_FAQ_NATIONAL_AVG_SALARY_TEXT = STAT_SOURCES.averageSalary.formatted;

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

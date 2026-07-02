/**
 * Niche salary configuration — the single source of truth for every
 * salary validation, clamping, and period-inference band in the pipeline.
 *
 * WHY THIS FILE EXISTS
 * Salary bounds were historically hardcoded in FOUR independent places
 * (lib/salary-normalizer.ts, lib/salary-utils.ts, lib/job-normalizer.ts,
 * lib/llm-enrichment.ts) with DIFFERENT values, each tuned by separate
 * production audits. Because the pipeline CLAMPS out-of-range values
 * rather than dropping them, a fork that changes only some of these
 * bands silently FABRICATES wrong salaries (e.g. a real $38k/yr job on a
 * lower-paying niche gets displayed as $64k). Forks must retune every
 * section below for their niche's real pay distribution.
 *
 * ── NP HIRING (board #2) ─────────────────────────────────────────────
 * Retuned 2026-07-02 for the ALL-NP + APRN cohort (donor: the NP fork's
 * phase-4c salary decisions). Anchors:
 *   - BLS NP median ≈ $126k; staff NP W-2 ≈ $95–140k
 *   - FNP entry-level low end ≈ $95k; new-grad part-time floor ≈ $60k
 *     (donor lib/salary-normalizer.ts:36)
 *   - CRNA drives the W-2 ceiling: $200–400k
 *     (donor lib/salary-normalizer.ts:32,37)
 *   - Contract/1099 hourly $40–350 across specialties
 *     (donor lib/salary-normalizer.ts:40-41); locum NP commonly $60–150/hr
 *   - LLM extraction band $60k–$400k/yr
 *     (donor lib/llm-enrichment.ts:53,115; donor LAUNCH_RUNBOOK.md:42)
 *
 * The per-consumer sections intentionally preserve each system's
 * STRUCTURE (they differ by design history — see each section's
 * comments); only VALUES are retuned. Unifying them into one derived
 * band is a future step that requires re-validation against live data;
 * do NOT "clean up" the differences mechanically.
 *
 * Period-inference thresholds (magnitude-based hourly/weekly/monthly
 * detection) are derived from this niche's pay levels too — a mis-set
 * threshold multiplies salaries by 12x–2080x in the annualizer.
 */

export const salaryConfig = {
    /** Standard full-time hours used for hourly -> annual conversion. */
    hoursPerYear: 2080,

    /**
     * lib/salary-normalizer.ts — ingest-time normalization + clamping.
     * Values = donor NP_SALARY_RANGES verbatim (donor
     * lib/salary-normalizer.ts:34-47) plus the donor's confidence
     * scaling (donor:136-148).
     */
    normalizer: {
        /** Minimum reasonable W-2 annual NP salary — new-grad part-time low end (donor:36). */
        annualMin: 60_000,
        /** Maximum reasonable W-2 annual salary — CRNA in HCOL / high-volume settings (donor:37). */
        annualMax: 400_000,
        /** Contractor hourly band — validated as hourly, not annualized (donor:40-41). */
        contractorHourlyMin: 40,
        contractorHourlyMax: 350,
        /** Typical band shown for comparisons — PMHNP/AGNP mid-band (donor:43-46). */
        typical: { min: 110_000, max: 170_000 },
        /** Confidence-scaled annual floors (factor × annualMin; donor:137-139). */
        lowConfidenceFloorFactor: 0.6, // $36k at annualMin=$60k
        highConfidenceFloorFactor: 0.8, // $48k at annualMin=$60k
        /** Confidence-scaled annual caps (donor:146-148 — kept above the
         *  W-2 max so annualized contractor/locum rates aren't rejected). */
        lowConfidenceAnnualCap: 600_000,
        highConfidenceAnnualCap: 550_000,
        /**
         * Magnitude-based period inference: a bare number below each
         * threshold is assumed to be that period. Derived from NP pay
         * levels (donor:88-104): hourly $40–350 (< 500), travel/locum
         * weekly $2–5k, monthly $8–20k.
         */
        magnitude: {
            hourlyBelow: 500,
            weeklyBelow: 5_000,
            monthlyBelow: 20_000,
        },
    },

    /**
     * lib/salary-utils.ts — display-string parsing thresholds. Wider than
     * the normalizer's band on purpose: this layer only decides "is this
     * number an hourly rate or an annual salary" when parsing free text.
     * The donor kept these exact values for the NP cohort (donor
     * lib/salary-utils.ts:5-14): $25–400/hr brackets the $40–350
     * contractor band; $40k–400k brackets W-2 NP pay up to CRNA.
     */
    utils: {
        minHourly: 25,
        maxHourly: 400,
        minAnnual: 40_000,
        maxAnnual: 400_000,
        /** Daily (per-diem/locum) parse band: NP $320–1,600/day typical,
         *  CRNA locum daily to ~$2,800–3,500 (350/hr × 8-10h). The donor
         *  exposed no daily thresholds; band kept wide-parse-side. */
        minDaily: 200,
        maxDaily: 5_000,
    },

    /**
     * lib/job-normalizer.ts — per-period clamp bounds (clamp-not-drop,
     * changed 2026-05-05) and period inference cutoffs. Clamp bounds are
     * intentionally WIDER than the normalizer's validation band (they
     * rescue sloppy source data rather than judge it).
     */
    jobNormalizer: {
        periodBounds: {
            /** Hourly: floor $20 (below the $40 contractor validation floor by
             *  design); ceiling raised 300 → 350 to match the donor's CRNA /
             *  specialty-NP contractor max (donor lib/salary-normalizer.ts:41). */
            hourly: { min: 20, max: 350 },
            /** Annual: $30k floor (part-time W-2 under the $60k validation
             *  min); $500k ceiling kept — real locum postings audit at
             *  $457k–$487k, and CRNA locum annualizes past the $400k W-2 max. */
            annual: { min: 30_000, max: 500_000 },
            /** Daily: NP per-diem $320–1,600; CRNA locum daily to ~$2,800
             *  (350/hr × 8h) — ceiling raised 2,000 → 3,000. */
            daily: { min: 200, max: 3_000 },
            /** Weekly: travel NP $2–5k/wk; travel CRNA to ~$10–12k/wk —
             *  ceiling raised 10,000 → 12,000; floor $800 (=$20/hr × 40h). */
            weekly: { min: 800, max: 12_000 },
            /** Biweekly: 2 × weekly band. */
            biweekly: { min: 1_600, max: 24_000 },
            /** Monthly: $4k (≈$48k/yr part-time floor) to $40k (> CRNA
             *  $400k/12 ≈ $33k). */
            monthly: { min: 4_000, max: 40_000 },
        },
        inference: {
            /** Values above this are treated as annual salaries — the lowest
             *  NP annual (~$60k) sits safely above, and the highest monthly
             *  (~$33k CRNA) sits safely below. */
            annualAbove: 40_000,
            /** NP hourly tops out at $350 (donor contractor max) — < 500. */
            hourlyBelow: 500,
            /** 500–6,000 → weekly. Raised from 2,000: travel-NP/CRNA weekly
             *  stipend listings ($2–6k/wk) are common and were being
             *  misread as monthly (a 12× vs 52× annualization error);
             *  true monthly pay below $6k (≈<$72k/yr) is rare on this board. */
            weeklyBelow: 6_000,
            /** 6,000–40,000 → monthly; above is annual. */
            monthlyAtOrBelow: 40_000,
        },
    },

    /**
     * lib/llm-enrichment.ts — the band is enforced TWICE (in the prompt
     * text and in the JS post-parse check); both read from here so they
     * can never drift. Donor band: $60k–$400k/yr — new-grad NP low side,
     * experienced CRNA ($350k+) high side (donor lib/llm-enrichment.ts:53,
     * 111-118; donor LAUNCH_RUNBOOK.md:42).
     */
    enrichment: {
        annualMin: 60_000,
        annualMax: 400_000,
        /** Human-readable band for the extraction prompt. */
        get promptBandText(): string {
            return `$${Math.round(this.annualMin / 1000)}k-$${Math.round(this.annualMax / 1000)}k/yr`;
        },
    },
} as const;

export type SalaryConfig = typeof salaryConfig;

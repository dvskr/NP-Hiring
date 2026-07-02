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
 * The per-consumer sections intentionally preserve each system's current
 * PMHNP-tuned values verbatim (they differ by design history — see each
 * section's comments). Unifying them into one derived band is a future
 * step that requires re-validation against live data; do NOT "clean up"
 * the differences mechanically.
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
     * $550k annual cap raised from $400k on 2026-05-05 (audit: real locum
     * postings at $457k–$487k were being rejected).
     */
    normalizer: {
        /** Minimum reasonable W-2 annual salary. */
        annualMin: 80_000,
        /** Maximum reasonable W-2 annual salary (HCOL areas). */
        annualMax: 350_000,
        /** Contractor hourly band — validated as hourly, not annualized. */
        contractorHourlyMin: 50,
        contractorHourlyMax: 350,
        /** Typical band shown for comparisons. */
        typical: { min: 100_000, max: 160_000 },
        /** Confidence-scaled annual floors (factor × annualMin). */
        lowConfidenceFloorFactor: 0.6, // $48k at annualMin=$80k
        highConfidenceFloorFactor: 0.8, // $64k at annualMin=$80k
        /** Confidence-scaled annual caps. */
        lowConfidenceAnnualCap: 600_000,
        highConfidenceAnnualCap: 550_000,
        /**
         * Magnitude-based period inference: a bare number below each
         * threshold is assumed to be that period. Derived from this
         * niche's pay levels ($50–200/hr, $2–4k/wk, $8–15k/mo).
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
     */
    utils: {
        minHourly: 25,
        maxHourly: 400,
        minAnnual: 40_000,
        maxAnnual: 400_000,
        minDaily: 200,
        maxDaily: 5_000,
    },

    /**
     * lib/job-normalizer.ts — per-period clamp bounds (clamp-not-drop,
     * changed 2026-05-05) and period inference cutoffs.
     */
    jobNormalizer: {
        periodBounds: {
            hourly: { min: 20, max: 300 },
            annual: { min: 30_000, max: 500_000 },
            daily: { min: 100, max: 2_000 },
            weekly: { min: 400, max: 10_000 },
            biweekly: { min: 800, max: 20_000 },
            monthly: { min: 2_000, max: 40_000 },
        },
        inference: {
            /** Values above this are treated as annual salaries. */
            annualAbove: 40_000,
            hourlyBelow: 500,
            weeklyBelow: 2_000,
            /** ≤ this (and ≥ weeklyBelow) is monthly; above is annual. */
            monthlyAtOrBelow: 40_000,
        },
    },

    /**
     * lib/llm-enrichment.ts — the band is enforced TWICE (in the prompt
     * text and in the JS post-parse check); both read from here so they
     * can never drift.
     */
    enrichment: {
        annualMin: 40_000,
        annualMax: 500_000,
        /** Human-readable band for the extraction prompt. */
        get promptBandText(): string {
            return `$${Math.round(this.annualMin / 1000)}k-$${Math.round(this.annualMax / 1000)}k/yr`;
        },
    },
} as const;

export type SalaryConfig = typeof salaryConfig;

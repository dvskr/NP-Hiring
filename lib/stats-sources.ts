// FORK NOTE: Per-board citation data — every stat below must be re-sourced
// for a board's own niche (value, URL, and asOf date) before launch;
// shipping stale figures publishes false, cited-looking claims.
//
// NP HIRING RE-SOURCING (2026-07-03): the PMHNP-era donor values were
// replaced with NP-wide figures:
//   - averageSalary: BLS OEWS May 2024, Nurse Practitioners (29-1171),
//     median annual wage $129,210 (replaces the PMHNP-era $155,000).
//     NOTE: the UI constants in config/niche/stats.ts were retuned to
//     ~$126k (an earlier OEWS vintage) — reconcile those to $129,210 /
//     May 2024 in the next UI-constants pass so the two families agree.
//   - blsGrowth2032: 45% kept — this is the BLS Employment Projections
//     NP-specific 2022–2032 figure (44.5%, rounded), which the
//     CAREER_PULSE_STATS pebble in config/niche/stats.ts mirrors.
//     TODO(verify): the 2023–2033 projection cycle shows ~46% for NPs
//     (40% for the combined OOH occupation group); update this entry,
//     its key name, CAREER_PULSE_STATS, and any "through 2032" page copy
//     together on the next review.
//   - hrsaShortagePopulation: the donor's mental-health-HPSA figure was
//     replaced with the PRIMARY-CARE HPSA population (the NP-relevant
//     shortage stat). Conservative ESTIMATE — see TODO(verify) on the
//     entry. Any page copy still describing this stat as "mental-health
//     HPSAs" must be updated to "primary care".
//   - fullPracticeStates: verified against AANP (27 states + DC, 2025).
/**
 * Single source of truth for cited statistics rendered across the site.
 *
 * Why this exists (SEO Fix C5/C6):
 * Healthcare YMYL content is held to a higher trust bar by Google. Quoting
 * salary, growth, and shortage numbers without citing a verifiable source —
 * or worse, citing different numbers on different pages — is a direct
 * E-E-A-T (Trustworthiness) hit and a manual-action risk. This file
 * centralizes every stat used in homepage FAQ, blog posts, About copy,
 * and JSON-LD so the same value lands everywhere with the same source link.
 *
 * Update protocol:
 *   1. Pull the latest figure from the cited source.
 *   2. Update `value` + `formatted` + `asOf` here.
 *   3. Bump the file's `STATS_LAST_REVIEWED` date below.
 *   4. The next deploy automatically propagates to homepage/FAQ/blog.
 *
 * Never hardcode a salary / growth / shortage number anywhere else.
 */

export interface StatSource {
    /** Raw numeric value used in JSON-LD or computations. */
    value: string;
    /** Human-formatted display value (e.g. "$129,210", "45%"). */
    formatted: string;
    /** Wider range for ranges shown on listing pages, e.g. "$120K–$140K". */
    range?: string;
    /** Short citation phrase rendered next to the stat. */
    source: string;
    /** Resolvable source URL (verify periodically). */
    sourceUrl: string;
    /** Date the source data was published or last refreshed. */
    asOf: string;
}

/** When the stats in this file were last verified against their sources. */
export const STATS_LAST_REVIEWED = '2026-07-03';

export const STAT_SOURCES = {
    /** Median annual NP salary, US-wide (BLS OEWS, all nurse practitioners). */
    averageSalary: {
        value: '129210',
        formatted: '$129,210',
        // Single verifiable point figure (the OEWS median). Kept equal to
        // `formatted` so surfaces that render `range` cite the same number
        // instead of an invented spread.
        range: '$129,210',
        source: 'BLS OEWS, Nurse Practitioners (29-1171) — median annual wage, May 2024',
        sourceUrl: 'https://www.bls.gov/oes/current/oes291171.htm',
        asOf: '2024-05',
    },

    /**
     * BLS-projected employment growth for nurse practitioners through 2032
     * (NP-specific 2022–2032 projection: 44.5%, rounded to 45%).
     *
     * TODO(verify): the 2023–2033 Employment Projections cycle shows ~46%
     * for NPs (and 40% for the OOH's combined nurse anesthetist / nurse
     * midwife / nurse practitioner group). Bump value + asOf here AND the
     * coupled CAREER_PULSE_STATS pebble (config/niche/stats.ts) together.
     */
    blsGrowth2032: {
        value: '45',
        formatted: '45%',
        source: 'BLS Employment Projections — Nurse Practitioners (2022–2032)',
        sourceUrl: 'https://www.bls.gov/ooh/healthcare/nurse-anesthetists-nurse-midwives-and-nurse-practitioners.htm',
        asOf: '2024',
    },

    /**
     * Population of Americans living in PRIMARY-CARE Health Professional
     * Shortage Areas — the NP-relevant shortage stat (the donor figure was
     * the mental-health-HPSA population; page copy quoting this stat must
     * say "primary care").
     *
     * ESTIMATE — TODO(verify): HRSA's quarterly designation summaries have
     * reported roughly 90–100M+ in recent releases (the figure moves each
     * quarter as designations update). "90 million+" is deliberately the
     * conservative floor; pin the exact current-quarter figure from the
     * HRSA dashboard below before quoting on high-visibility surfaces.
     */
    hrsaShortagePopulation: {
        value: '90000000',
        formatted: '90 million+',
        source: 'HRSA Bureau of Health Workforce, Designated HPSA Quarterly Summary (primary care)',
        sourceUrl: 'https://data.hrsa.gov/topics/health-workforce/shortage-areas',
        asOf: '2025',
    },

    /** States granting Full Practice Authority to NPs (incl. DC). */
    fullPracticeStates: {
        value: '27',
        formatted: '27 states + DC',
        source: 'AANP State Practice Environment',
        sourceUrl: 'https://www.aanp.org/advocacy/state/state-practice-environment',
        asOf: '2025',
    },
} as const satisfies Record<string, StatSource>;

/**
 * Render a stat with an inline citation suitable for visible HTML or JSON-LD
 * answer text. Example output for `averageSalary`:
 *   "$129,210 (BLS OEWS, Nurse Practitioners (29-1171) — median annual wage, May 2024, 2024-05)"
 */
export function citedValue(s: StatSource): string {
    return `${s.range ?? s.formatted} (${s.source}, ${s.asOf})`;
}

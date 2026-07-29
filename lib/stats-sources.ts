// FORK NOTE: Per-board citation data — every stat below must be re-sourced
// for a board's own niche (value, URL, and asOf date) before launch;
// shipping stale figures publishes false, cited-looking claims.
//
// NP HIRING RE-SOURCING (2026-07-03): the PMHNP-era donor values were
// replaced with NP-wide figures:
//   - averageSalary: BLS OEWS May 2024, Nurse Practitioners (29-1171),
//     median annual wage $129,210 (replaces the PMHNP-era $155,000).
//     RESOLVED 2026-07-18 (citation-trust sweep B4/B51): the UI constants
//     in config/niche/stats.ts now DERIVE from this entry (they had been
//     retuned to an earlier OEWS vintage), so the two families cannot
//     disagree again. app/salary-guide/page.tsx also reads this entry.
//   - blsGrowth2032: 45% — the BLS Employment Projections NP-specific
//     2022–2032 figure (44.5%, rounded), which the CAREER_PULSE_STATS
//     pebble in config/niche/stats.ts mirrors.
//   - hrsaShortagePopulation: the donor's mental-health-HPSA figure was
//     replaced with the PRIMARY-CARE HPSA population (the NP-relevant
//     shortage stat). Flagged `isEstimate` — see the entry. Any page copy
//     still describing this stat as a behavioral-health designation must
//     say "primary care".
//   - fullPracticeStates: verified against AANP (27 states + DC, 2025).
//
// P2 #10 CONSOLIDATION PASS (2026-07-29):
//   - The two open verify-markers (on blsGrowth2032 and
//     hrsaShortagePopulation) were resolved by DELETING the unverifiable
//     figures they carried rather than by promoting them: each marker
//     asserted a newer number that nothing in this repo could check —
//     a speculative later projection cycle, and a speculative wider
//     shortage-population range. Each entry now states only what its own
//     cited source supports, and the `vintageNote` field records what a
//     refresh actually requires so the next reviewer isn't guessing.
//   - The OEWS vintage was NOT bumped: no newer OEWS release exists in
//     repo data (grep for "OEWS" — every hit derives from this entry),
//     and inventing a vintage would be exactly the failure this file is
//     supposed to prevent. `vintageNote` on averageSalary says so.
//   - SALARY_BANDS (below) was added because ~20 files were printing
//     hand-typed salary RANGES that disagreed with each other.
//
// P2 #10 STATUS CORRECTION (2026-07-29, same day): the paragraph above
// originally continued "Ranges now derive from config/niche/salary.ts …
// so a published band can never claim something the pipeline would
// reject." That was not true and is corrected here. SALARY_BANDS was
// CREATED, but only ONE surface was migrated onto it
// (/resources/1099-vs-w2). Every other hand-typed band listed in
// UNMIGRATED_SALARY_BAND_SURFACES — in
// tests/regressions/p2-data-accuracy-stats-and-guides.test.ts — is still
// live and still disagrees, including the three remote-NP variants named
// below. Consolidation is the CONTRACT for new and touched surfaces, not
// a completed migration. That test pins the remaining debt as a ratchet:
// the list may shrink as surfaces migrate, and a new file printing a
// hand-typed band fails it.
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
import { salaryConfig } from '../config/niche/salary';

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
    /**
     * True when the figure is a defensible floor or approximation rather
     * than a point value published by the cited source.
     *
     * The hedge MUST live inside `formatted` itself (a trailing "+" for a
     * floor, or a leading "~"/"approximately"), never in a helper a surface
     * has to remember to call. Every consumer renders `formatted`, so a
     * data-level hedge reaches all of them; a helper-level one reached none.
     * There used to be a `citedValue()` that applied the hedge and had zero
     * production call sites — the flag looked honored and wasn't. Enforced
     * by tests/regressions/p2-data-accuracy-stats-and-guides.test.ts.
     */
    isEstimate?: boolean;
    /**
     * What a vintage refresh of this entry requires. Written for the next
     * reviewer; never rendered. Kept here instead of a TODO comment so a
     * stale entry announces itself in the data rather than in a marker
     * that greps easily but reads as an unverified claim.
     */
    vintageNote?: string;
}

/** When the stats in this file were last verified against their sources. */
export const STATS_LAST_REVIEWED = '2026-07-29';

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
        vintageNote:
            'The May 2024 OEWS release is the newest NP median this repo holds. ' +
            'No later release is present in repo data, so the vintage was left ' +
            'as-is rather than guessed. LINK-DRIFT HAZARD (same one documented ' +
            'on blsGrowth2032): sourceUrl points at /oes/current/, which BLS ' +
            'repoints to the LATEST release every year — so this entry and the ' +
            'link a reader clicks drift apart silently, and the citation starts ' +
            'naming a vintage the page no longer shows. Re-check it whenever BLS ' +
            'publishes (May data, released the following spring); the archived ' +
            'permalink for this vintage is /oes/2024/may/oes291171.htm if the ' +
            'live figure ever needs pinning. To refresh: pull the current ' +
            '29-1171 median from the sourceUrl, update value/formatted/range/' +
            'source/asOf here, and re-run ' +
            'tests/regressions/aeo-content-citation-stats.test.ts — ' +
            'config/niche/stats.ts derives from this entry and follows automatically.',
    },

    /**
     * BLS-projected employment growth for nurse practitioners, stated for
     * the projection cycle named in `source` (NP-specific 2022–2032
     * projection: 44.5%, rounded to 45%).
     *
     * The cycle is spelled out in `source` deliberately: consumers render
     * it alongside the number, so a reader always sees which projection
     * round the 45% belongs to rather than assuming it is current.
     */
    blsGrowth2032: {
        value: '45',
        formatted: '45%',
        source: 'BLS Employment Projections — Nurse Practitioners (2022–2032)',
        sourceUrl: 'https://www.bls.gov/ooh/healthcare/nurse-anesthetists-nurse-midwives-and-nurse-practitioners.htm',
        asOf: '2024',
        vintageNote:
            'BLS publishes a new Employment Projections cycle roughly annually, ' +
            'and the OOH page at sourceUrl always shows the LATEST cycle — so this ' +
            'entry and its link drift apart over time. Nothing in this repo can ' +
            'verify a newer cycle, so no newer number is asserted here. To refresh: ' +
            'read the current NP-specific projection from sourceUrl, then update ' +
            'value/formatted/source/asOf here, the key name (blsGrowth2032), the ' +
            'CAREER_PULSE_STATS pebble in config/niche/stats.ts, and every ' +
            '"through 2032" / "from 2022 to 2032" string in page copy TOGETHER.',
    },

    /**
     * Population of Americans living in PRIMARY-CARE Health Professional
     * Shortage Areas — the NP-relevant shortage stat (the donor figure was
     * a behavioral-health designation count; page copy quoting this stat
     * must say "primary care").
     *
     * Flagged `isEstimate`: HRSA re-publishes this figure every quarter as
     * designations are added and withdrawn, so "90 million+" is carried as
     * a floor rather than a point value, and `formatted` keeps the "+" so
     * the floor reads as a floor wherever it renders.
     */
    hrsaShortagePopulation: {
        value: '90000000',
        formatted: '90 million+',
        source: 'HRSA Bureau of Health Workforce, Designated HPSA Quarterly Summary (primary care)',
        sourceUrl: 'https://data.hrsa.gov/topics/health-workforce/shortage-areas',
        asOf: '2025',
        isEstimate: true,
        vintageNote:
            'Quarterly-moving figure published on a live HRSA dashboard, not in ' +
            'repo data. Kept as a conservative floor. To refresh: read the ' +
            'current primary-care HPSA population from sourceUrl and set ' +
            'value/formatted/asOf; drop isEstimate only if the exact ' +
            'current-quarter figure is pinned rather than a floor.',
    },

    /** States granting Full Practice Authority to NPs (incl. DC). */
    fullPracticeStates: {
        value: '27',
        formatted: '27 states + DC',
        source: 'AANP State Practice Environment',
        sourceUrl: 'https://www.aanp.org/advocacy/state/state-practice-environment',
        asOf: '2025',
        vintageNote:
            'Moves whenever a state legislature acts, so re-check each session. ' +
            'lib/state-practice-authority.ts holds the per-state classifications ' +
            'this count must agree with: change a state there and this value, ' +
            'formatted, and asOf change with it — /resources/fpa-guide and ' +
            '/resources/private-practice-guide both derive their counts from that ' +
            'dataset and will follow automatically.',
    },
} as const satisfies Record<string, StatSource>;

/*
 * `citedValue(s)` used to live here: it returned
 * "<formatted> (<source>, <asOf>)" and prefixed "approximately" for
 * isEstimate entries. It was deleted rather than wired up, because it had
 * ZERO production call sites — the only thing exercising it was the test
 * asserting it hedged, which made the isEstimate flag look enforced while
 * every real surface rendered `formatted` unhedged.
 *
 * It was also the wrong shape for the surfaces that exist: /editorial-policy
 * and /press render the stats as TABLES with separate value / source / asOf
 * columns, and lib/blog-license-guides.ts deliberately declines it (its
 * `cite()` omits asOf, because `source` already names the vintage and
 * "May 2024, 2024-05" reads like machine output across 51 pages).
 *
 * The hedge now lives in `formatted` — see the isEstimate doc above — so it
 * reaches every consumer without one of them having to opt in.
 */

/* ────────────────────────────────────────────────────────────────────────
 * SALARY BANDS — the single source for every published pay RANGE
 * ────────────────────────────────────────────────────────────────────────
 *
 * Why this exists (audit P2 #10):
 * STAT_SOURCES fixed the single-POINT figures (the OEWS median), but pay
 * RANGES stayed hand-typed per page, and they disagreed. The remote-NP
 * band alone shipped three different ways ($95K–$160K in the category FAQ,
 * $110K–$170K in the pSEO city/state narratives, $120K–$165K on the city
 * OG card), which is the same E-E-A-T failure the point figures had.
 *
 * TRUTH MODEL: these bands are NOT a wage survey and must never be
 * presented as one. They are the bands config/niche/salary.ts already
 * enforces on the ingest pipeline — the range this board will accept,
 * clamp to, and display for a real posting. Publishing anything wider or
 * narrower means the site advertises pay it would itself reject. Every
 * band therefore carries a `basis` string, and surfaces should render it
 * (or a short paraphrase of it) next to the number.
 *
 * Where a page wants "what NPs actually earn", the honest answer is
 * STAT_SOURCES.averageSalary (a cited government median) plus a pointer at
 * live postings — not a band.
 *
 * MIGRATION STATUS — READ BEFORE CITING THIS AS "DONE": exactly one
 * surface consumes SALARY_BANDS today (/resources/1099-vs-w2). The three
 * contradictory remote-NP bands named above are STILL PUBLISHED, as are
 * ~20 other hand-typed ranges across /jobs/* category pages, the pSEO
 * templates, /salary-guide and its PDF generator. Do not read the
 * existence of this constant as evidence the contradictions are resolved.
 * The remaining surfaces are enumerated in
 * tests/regressions/p2-data-accuracy-stats-and-guides.test.ts as
 * UNMIGRATED_SALARY_BAND_SURFACES; migrate one, delete it from that list.
 */

/** "$110K" from 110_000. */
const asK = (n: number): string => `$${Math.round(n / 1000)}K`;
/** "$53" from 52.88. */
const asDollars = (n: number): string => `$${Math.round(n)}`;

export interface SalaryBand {
    /** Lower bound in dollars (annual, or hourly for hourly bands). */
    min: number;
    /** Upper bound in dollars. */
    max: number;
    /** Display string, e.g. "$110K–$170K" or "$40–$350/hr". */
    formatted: string;
    /**
     * What the band IS, in one sentence, for rendering next to the number.
     * Prevents a validation range being read as a survey of real pay.
     */
    basis: string;
}

const HOURS_PER_YEAR = salaryConfig.hoursPerYear;
const TYPICAL = salaryConfig.normalizer.typical;

export const SALARY_BANDS = {
    /**
     * The W-2 comparison band the salary pipeline uses as a sanity check.
     * This is the band to print when a page needs "a typical full-time NP
     * salary range".
     */
    typicalW2Annual: {
        min: TYPICAL.min,
        max: TYPICAL.max,
        formatted: `${asK(TYPICAL.min)}–${asK(TYPICAL.max)}`,
        basis: `the typical W-2 comparison band this board's salary pipeline uses as a sanity check, not a wage survey`,
    },

    /** The same band expressed hourly, for contract-vs-employee comparisons. */
    typicalW2Hourly: {
        min: TYPICAL.min / HOURS_PER_YEAR,
        max: TYPICAL.max / HOURS_PER_YEAR,
        formatted: `${asDollars(TYPICAL.min / HOURS_PER_YEAR)}–${asDollars(TYPICAL.max / HOURS_PER_YEAR)}/hr`,
        basis: `the hourly equivalent of the typical W-2 band at ${HOURS_PER_YEAR.toLocaleString('en-US')} hours a year`,
    },

    /**
     * Contractor / 1099 hourly range accepted at ingest. Deliberately wide:
     * it spans every NP and APRN specialty on the board (CRNA sets the
     * ceiling), so a single-specialty role normally sits well inside it.
     */
    contractorHourly: {
        min: salaryConfig.normalizer.contractorHourlyMin,
        max: salaryConfig.normalizer.contractorHourlyMax,
        formatted: `${asDollars(salaryConfig.normalizer.contractorHourlyMin)}–${asDollars(salaryConfig.normalizer.contractorHourlyMax)}/hr`,
        basis: 'the contract/1099 hourly range this board validates postings against, across all NP and APRN specialties',
    },

    /**
     * Full W-2 annual range accepted at ingest — the outer envelope, from a
     * part-time new-grad floor to the CRNA ceiling. Use this only when a
     * page genuinely means "everything on the board", never as a typical
     * salary.
     */
    w2AnnualAccepted: {
        min: salaryConfig.normalizer.annualMin,
        max: salaryConfig.normalizer.annualMax,
        formatted: `${asK(salaryConfig.normalizer.annualMin)}–${asK(salaryConfig.normalizer.annualMax)}`,
        basis: 'the full W-2 annual range this board validates postings against, from a part-time new-grad floor to the CRNA ceiling',
    },
} as const satisfies Record<string, SalaryBand>;

/*
 * `bandWithBasis(b)` used to live here, returning "<formatted> (<basis>)".
 * Deleted for the same reason as `citedValue`: zero production call sites,
 * exercised only by the test written beside it. The one migrated surface
 * (/resources/1099-vs-w2) renders `band.formatted` and `band.basis` in
 * separate sentences, because a parenthetical that long inside a table
 * legend is unreadable. `basis` stays REQUIRED on the interface, which is
 * what actually prevents a validation range being published as a survey.
 */

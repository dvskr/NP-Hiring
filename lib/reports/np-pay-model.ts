/**
 * lib/reports/np-pay-model.ts: the NP Pay Report's pure model. Scope rows,
 * the CSV and the Dataset JSON-LD are built here from a snapshot, so the
 * page, the CSV route and the tests read one shape and nothing here touches
 * the database (lib/reports/np-pay.ts loads the snapshot).
 *
 * TRUTH RULES (the one salary engine's, lib/salary-report/stats.ts):
 *   - A live figure is the median of advertised pay on live NP postings,
 *     each employer counted once; quartiles at 10 or more employers, a
 *     median at 5 to 9, a count only at 3 to 4, nothing below 3.
 *   - A withheld cell is EMPTY in the CSV and a sentence on the page, never
 *     0 and never a figure the tier does not allow.
 *   - BLS columns (national and state rows only) are the BLS OEWS figures
 *     with their reference period; a footnoted BLS cell is empty too.
 *   - Advertised pay, not earnings and not a survey: the copy never says
 *     what nurse practitioners "earn" and never calls a figure an "average".
 *
 * Column names, tier names and the Dataset shape follow the salary build
 * spec (section 6). This report ships first, so the sister board's pay
 * report is to match these names, not the other way round.
 */
import { brand } from '@/config/brand';
import { BENCHMARK_FULL_MIN_EMPLOYERS, BENCHMARK_MIN_EMPLOYERS, type ScopeSummary } from '@/components/tools/benchmark-model';
import {
    BLS_NATIONAL,
    BLS_OEWS_REFERENCE_PERIOD,
    BLS_STATE_WAGES,
    type BlsFigure,
    type BlsStateWage,
} from '@/lib/salary-guide-bls-states';
import type { SalaryTier } from '@/lib/salary-report/stats';

/** Path of the report page and of its CSV, for links and the Dataset distribution. */
export const NP_PAY_REPORT_PATH = '/reports/np-pay';
export const NP_PAY_CSV_PATH = `${NP_PAY_REPORT_PATH}/data.csv`;

/** The CSV header, exactly as the build spec names the columns. */
export const NP_PAY_CSV_COLUMNS = [
    'as_of',
    'scope_type',
    'scope',
    'tier',
    'employers',
    'postings',
    'advertised_median_usd',
    'advertised_p25_usd',
    'advertised_p75_usd',
    'bls_median_annual_usd',
    'bls_p10_annual_usd',
    'bls_p90_annual_usd',
    'bls_median_hourly_usd',
    'bls_employment',
    'bls_reference_period',
] as const;

export type NpPayScopeType = 'national' | 'state' | 'specialty' | 'work_mode' | 'employment_type' | 'experience';

/** The CSV tier names (snake case, as the spec writes them). */
export type NpPayTier = 'full' | 'median' | 'count_only' | 'none';

export function csvTier(tier: SalaryTier): NpPayTier {
    return tier === 'countOnly' ? 'count_only' : tier;
}

/** BLS figures attached to a national or state row. */
export interface NpPayBls {
    median: BlsFigure;
    p10: BlsFigure;
    p90: BlsFigure;
    hourlyMedian: BlsFigure;
    employment: BlsFigure;
}

/** One scope of the report: its live tier and figures, and BLS where it has one. */
export interface NpPayScopeRow {
    scopeType: NpPayScopeType;
    scope: string;
    /** The page this row links (a state guide, a specialty guide), if any. */
    href: string | null;
    tier: NpPayTier;
    /** Employers behind the figure, each once; null below the count tier. */
    employers: number | null;
    /** Postings behind the figure, for context only; null below the count tier. */
    postings: number | null;
    median: number | null;
    p25: number | null;
    p75: number | null;
    bls: NpPayBls | null;
}

/** Live disclosure: postings that state a non-estimated pay range, of all live postings. */
export interface NpPayDisclosure {
    disclosed: number;
    total: number;
}

/**
 * How many employers' advertised pay (each employer's median midpoint, the
 * engine's per-employer value) reaches a threshold, of the employers in the
 * national figure. Published only at the full tier.
 */
export interface NpPayThresholdShare {
    threshold: number;
    employers: number;
    of: number;
}

/** Everything the page, the CSV and the JSON-LD need, as of one day. */
export interface NpPaySnapshot {
    /** ISO timestamp of the aggregation. */
    asOf: string;
    disclosure: NpPayDisclosure;
    /** Employers whose advertised pay reaches $200,000; null below the full tier. */
    atOrAbove200k: NpPayThresholdShare | null;
    national: NpPayScopeRow;
    /** All 51 jurisdictions, BLS on every row, the live figure where its tier allows. */
    states: NpPayScopeRow[];
    specialties: NpPayScopeRow[];
    workModes: NpPayScopeRow[];
    employmentTypes: NpPayScopeRow[];
    experience: NpPayScopeRow[];
}

/** Every row in CSV order: national, states, then the four breakdowns. */
export function allScopeRows(snapshot: NpPaySnapshot): NpPayScopeRow[] {
    return [
        snapshot.national,
        ...snapshot.states,
        ...snapshot.specialties,
        ...snapshot.workModes,
        ...snapshot.employmentTypes,
        ...snapshot.experience,
    ];
}

function blsOfState(row: BlsStateWage): NpPayBls {
    return { median: row.annualMedian, p10: row.annualP10, p90: row.annualP90, hourlyMedian: row.hourlyMedian, employment: row.employment };
}

/** The national BLS figures, same release as every state row. */
export const NATIONAL_BLS: NpPayBls = {
    median: BLS_NATIONAL.np.annualMedian,
    p10: BLS_NATIONAL.np.annualP10,
    p90: BLS_NATIONAL.np.annualP90,
    hourlyMedian: BLS_NATIONAL.np.hourlyMedian,
    employment: BLS_NATIONAL.np.employment,
};

/**
 * One scope row from the engine's summary of that scope's rows. The tier
 * decides what the row may carry: nothing below the count tier, a count at
 * the count tier, a median at the median tier, quartiles at the full tier.
 */
export function scopeRow(input: {
    scopeType: NpPayScopeType;
    scope: string;
    href?: string | null;
    summary: ScopeSummary;
    bls?: NpPayBls | null;
}): NpPayScopeRow {
    const { scopeType, scope, href = null, summary, bls = null } = input;
    const tier = csvTier(summary.summary.tier);
    const counted = tier !== 'none';
    return {
        scopeType,
        scope,
        href,
        tier,
        employers: counted ? summary.summary.n : null,
        postings: counted ? summary.postings : null,
        median: summary.row?.median ?? null,
        p25: summary.row?.p25 ?? null,
        p75: summary.row?.p75 ?? null,
        bls,
    };
}

/**
 * The share of employers at or above a threshold, from the engine's
 * per-employer midpoints, or null below the full tier (10 employers).
 */
export function thresholdShare(midpoints: readonly number[], threshold: number): NpPayThresholdShare | null {
    if (midpoints.length < BENCHMARK_FULL_MIN_EMPLOYERS) return null;
    return { threshold, employers: midpoints.filter((m) => m >= threshold).length, of: midpoints.length };
}

/** The 51 state rows, in state name order, each with its BLS figures. */
export function stateRows(summaries: ReadonlyMap<string, ScopeSummary>, empty: ScopeSummary): NpPayScopeRow[] {
    return Object.values(BLS_STATE_WAGES)
        .sort((a, b) => a.state.localeCompare(b.state))
        .map((bls) => scopeRow({
            scopeType: 'state',
            scope: bls.state,
            href: `/salary-guide/${bls.slug}`,
            summary: summaries.get(bls.state) ?? empty,
            bls: blsOfState(bls),
        }));
}

/* ── Copy ───────────────────────────────────────────────────────────── */

/** "$132,500" for a whole-dollar figure. */
export function usd(dollars: number): string {
    return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

/** What a table cell prints for a row's live figure: the median, or why there is none. */
export function liveMedianCell(row: NpPayScopeRow): string {
    if (row.median !== null && row.employers !== null) return `${usd(row.median)} (${row.employers} employers)`;
    return `Fewer than ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay`;
}

/** What a table cell prints for a row's middle half: the range, or the tier that unlocks it. */
export function liveMiddleHalfCell(row: NpPayScopeRow): string {
    if (row.p25 !== null && row.p75 !== null) return `${usd(row.p25)} to ${usd(row.p75)}`;
    if (row.median !== null) return `At ${BENCHMARK_FULL_MIN_EMPLOYERS} or more employers`;
    return '';
}

/** The sentence a reader can paste as a citation. */
export function citationText(asOfLabel: string): string {
    return `${brand.name}, NP Pay Report, advertised pay on live postings as of ${asOfLabel}, ${brand.domain}${NP_PAY_REPORT_PATH}`;
}

/* ── CSV ────────────────────────────────────────────────────────────── */

/**
 * One CSV cell. Quotes a cell that holds a comma, a quote or a line break
 * (doubling inner quotes), and prefixes a cell that starts with =, +, - or @
 * with an apostrophe, so a spreadsheet never runs it as a formula (CSV
 * injection). The scopes are fixed labels today; the guard is for tomorrow.
 */
export function csvCell(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
}

const blsCell = (figure: BlsFigure | undefined): number | null => figure?.value ?? null;

/** The whole CSV: the header and one row per scope, withheld cells empty. */
export function buildNpPayCsv(snapshot: NpPaySnapshot): string {
    const asOf = snapshot.asOf.slice(0, 10);
    const lines = [NP_PAY_CSV_COLUMNS.join(',')];
    for (const row of allScopeRows(snapshot)) {
        const cells: Array<string | number | null> = [
            asOf,
            row.scopeType,
            row.scope,
            row.tier,
            row.employers,
            row.postings,
            row.median,
            row.p25,
            row.p75,
            blsCell(row.bls?.median),
            blsCell(row.bls?.p10),
            blsCell(row.bls?.p90),
            blsCell(row.bls?.hourlyMedian),
            blsCell(row.bls?.employment),
            row.bls ? BLS_OEWS_REFERENCE_PERIOD : null,
        ];
        lines.push(cells.map(csvCell).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
}

/** The download's file name: nphiring-np-pay-{asOf}.csv. */
export function npPayCsvFileName(snapshot: Pick<NpPaySnapshot, 'asOf'>): string {
    return `${brand.domain.split('.')[0]}-np-pay-${snapshot.asOf.slice(0, 10)}.csv`;
}

/* ── JSON-LD ────────────────────────────────────────────────────────── */

/**
 * The Dataset schema, or null when no snapshot rendered: schema for data the
 * page is not showing would be a false claim. No license is declared yet
 * (an owner decision), so the key is left out rather than guessed.
 */
export function buildNpPayDataset(snapshot: NpPaySnapshot | null, datePublished: string): Record<string, unknown> | null {
    if (!snapshot) return null;
    const asOf = snapshot.asOf.slice(0, 10);
    const organization = { '@type': 'Organization', '@id': `${brand.baseUrl}/#organization`, name: brand.name };
    return {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: `${brand.name} NP Pay Report: advertised pay on live nurse practitioner postings`,
        description:
            `Median advertised annual pay on live nurse practitioner job postings listed on ${brand.name} as of ${asOf}, ` +
            'by state, specialty, work mode and employment type, beside the BLS OEWS May 2025 median annual wage for each state. ' +
            'Each employer counts once. Advertised pay, not wages paid and not a survey.',
        url: `${brand.baseUrl}${NP_PAY_REPORT_PATH}`,
        creator: organization,
        publisher: { '@id': `${brand.baseUrl}/#organization` },
        datePublished,
        dateModified: asOf,
        temporalCoverage: asOf,
        spatialCoverage: { '@type': 'Place', name: 'United States' },
        isAccessibleForFree: true,
        variableMeasured: [
            { '@type': 'PropertyValue', name: 'Median advertised annual pay', unitText: 'USD' },
            { '@type': 'PropertyValue', name: 'Employers disclosing pay' },
            { '@type': 'PropertyValue', name: `BLS median annual wage (${BLS_OEWS_REFERENCE_PERIOD})`, unitText: 'USD' },
        ],
        measurementTechnique:
            `Median of each employer's advertised pay midpoint across live postings; at least ${BENCHMARK_MIN_EMPLOYERS} employers for a median, ` +
            `${BENCHMARK_FULL_MIN_EMPLOYERS} for quartiles.`,
        distribution: [
            { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${brand.baseUrl}${NP_PAY_CSV_PATH}` },
        ],
        citation: `U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics, ${BLS_OEWS_REFERENCE_PERIOD}, Nurse Practitioners (29-1171)`,
    };
}

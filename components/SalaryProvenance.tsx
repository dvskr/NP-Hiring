/**
 * components/SalaryProvenance.tsx — the shared provenance line for every
 * salary surface (competitive teardown A4: date-stamps + provenance).
 *
 * Competitors date-stamp their pay data ("Last updated on … . Based on
 * active jobs on …"); this board's equivalent must be HONEST rather than
 * decorative, so the line is assembled from exactly three kinds of claim,
 * each with a hard rule:
 *
 *   1. CITED STATS — source name + data vintage straight from the
 *      STAT_SOURCES metadata in lib/stats-sources.ts (`source` / `asOf`).
 *      When the source string already names its vintage (the OEWS entry
 *      does), the vintage is not repeated.
 *   2. LIVE SNAPSHOT BASIS — "Based on N active postings with disclosed
 *      salary on <brand>", where N comes from the aggregate query the page
 *      ALREADY runs. Rendered only when N clears the caller's existing
 *      minimum-sample gate — omit, never fabricate (the same rule the
 *      specialty pages apply to their stat cards).
 *   3. EDITORIAL REVIEW DATE — a LITERAL a human updates on real review
 *      (the B54 / P0 #23 principle). NEVER pass a render-time date:
 *      `new Date()` here would fabricate freshness on every request, which
 *      is the exact defect P0 #23 removed. Live-data surfaces that have no
 *      editorial review date simply omit this prop, as the salary-guide
 *      state pages omit Article dates for the same reason.
 *
 * Server component (no 'use client'): every salary page that renders it is
 * server-rendered under ISR, and the line is plain text. The pure helpers
 * are exported for the one client consumer (the SalaryCalculator footnote
 * label) and for tests.
 */
import { brand } from '@/config/brand';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** A cited statistic's provenance fields (shape-compatible with StatSource). */
export interface CitedStatProvenance {
    /** Citation phrase, e.g. the `source` field of a STAT_SOURCES entry. */
    source: string;
    /** Data vintage ('YYYY', 'YYYY-MM', or 'YYYY-MM-DD') — the `asOf` field. */
    asOf: string;
}

/** The snapshot basis of a live-DB aggregate the page already computed. */
export interface LiveSampleProvenance {
    /** Row count from the aggregate query that already runs on the page. */
    count: number;
    /**
     * The surface's EXISTING minimum-sample gate (e.g. MIN_LIVE_JOBS on the
     * specialty pages). Below it the sentence is omitted entirely.
     */
    minimum: number;
    /** What one row is; defaults to "active postings with disclosed salary". */
    noun?: string;
}

export interface SalaryProvenanceProps {
    /** Cited stats to attribute (source + vintage from STAT_SOURCES). */
    cited?: readonly CitedStatProvenance[];
    /** Live snapshot basis; omitted below its minimum-sample gate. */
    live?: LiveSampleProvenance;
    /**
     * Editorial review date as a 'YYYY-MM-DD' LITERAL (e.g. the page's
     * LAST_REVIEWED_DATE constant). Never a computed "today".
     */
    reviewedOn?: string;
    /** Style overrides merged over the muted-footnote defaults. */
    style?: React.CSSProperties;
}

/**
 * 'YYYY-MM' → 'May 2024', 'YYYY' → '2024', 'YYYY-MM-DD' → 'July 28, 2026'.
 * Pure string parsing — no Date construction, so no timezone drift and no
 * possibility of accidentally rendering "now".
 */
export function formatStatVintage(asOf: string): string {
    const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(asOf.trim());
    if (!match) return asOf;
    const [, year, month, day] = match;
    if (!month) return year;
    const monthName = MONTH_NAMES[Number(month) - 1];
    if (!monthName) return asOf;
    if (!day) return `${monthName} ${year}`;
    return `${monthName} ${Number(day)}, ${year}`;
}

/**
 * Assemble the provenance sentences. Exported pure so tests can pin the
 * omission rules (below-minimum live samples, empty inputs) without
 * rendering React.
 */
export function buildProvenanceSentences(
    { cited, live, reviewedOn }: Omit<SalaryProvenanceProps, 'style'>,
): string[] {
    const sentences: string[] = [];

    if (cited && cited.length > 0) {
        const attributions = cited.map((stat) => {
            const vintage = formatStatVintage(stat.asOf);
            // The OEWS source string already ends in its vintage — do not
            // render "…, May 2024 (May 2024)".
            return stat.source.includes(vintage) ? stat.source : `${stat.source} (${vintage})`;
        });
        sentences.push(`Source${cited.length > 1 ? 's' : ''}: ${attributions.join('; ')}.`);
    }

    // Omit, never fabricate: no live sentence below the surface's own gate.
    if (live && live.count > 0 && live.count >= live.minimum) {
        const noun = live.noun ?? 'active postings with disclosed salary';
        sentences.push(
            `Based on ${live.count.toLocaleString('en-US')} ${noun} on ${brand.name}, recomputed as postings are ingested daily.`,
        );
    }

    if (reviewedOn) {
        sentences.push(`Figures last reviewed ${formatStatVintage(reviewedOn)}.`);
    }

    return sentences;
}

export default function SalaryProvenance({ cited, live, reviewedOn, style }: SalaryProvenanceProps) {
    const sentences = buildProvenanceSentences({ cited, live, reviewedOn });
    if (sentences.length === 0) return null;

    return (
        <p
            data-testid="salary-provenance"
            style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--text-muted)', margin: 0, ...style }}
        >
            {sentences.join(' ')}
        </p>
    );
}

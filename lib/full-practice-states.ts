/**
 * Full practice states, as a plain-text answer.
 *
 * WHY this exists: sites that rank for "full practice authority states"
 * disagree on the count (22, 27, 28 and 30 all appear), so /scope-of-practice
 * answers the question near the top in plain text: the count, every state by
 * name, the District of Columbia, AANP as the source, and the map's vintage.
 *
 * TRUTH RULES:
 *   - The state list and count are DERIVED at call time from
 *     lib/state-practice-authority.ts. Nothing here is hand-typed, so a
 *     reclassified state moves the visible answer and the FAQPage schema in
 *     the same build. The count must agree with
 *     STAT_SOURCES.fullPracticeStates.value (pinned by
 *     tests/regressions/p5-sop-hub-scope-of-practice.test.ts via SOP_COUNTS).
 *   - Source name, URL and vintage come from STAT_SOURCES.fullPracticeStates.
 *     The month the AANP map was updated is read from that entry's
 *     vintageNote ("Updated: 05/2026"); when the note no longer carries a
 *     month, the answer falls back to the entry's `asOf` year rather than
 *     printing a stale month.
 *   - The caveat is tier level ("Many of these states"), never a rule for
 *     one state: each state's own requirement is its `details` string,
 *     printed in the per-state sections of the same page.
 *
 * One builder feeds both the visible quick answer and the FAQ entry whose
 * text becomes the FAQPage JSON-LD, so the two can never diverge.
 */
import { brand } from '@/config/brand';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { STAT_SOURCES } from '@/lib/stats-sources';

/** The dataset's key for D.C.: a jurisdiction, not a state. */
export const DC_JURISDICTION = 'District of Columbia';

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "Updated: 05/2026" as recorded in STAT_SOURCES.fullPracticeStates.vintageNote. */
const MAP_UPDATED_PATTERN = /Updated: (\d{2})\/(\d{4})/;

/**
 * The AANP map's vintage for display: "May 2026" when the stats source
 * records the month the map was updated, otherwise the source's `asOf` year.
 */
export function getAanpMapVintage(): string {
    const { vintageNote, asOf } = STAT_SOURCES.fullPracticeStates;
    const match = MAP_UPDATED_PATTERN.exec(vintageNote);
    const monthIndex = match ? Number(match[1]) - 1 : -1;
    if (!match || monthIndex < 0 || monthIndex >= MONTHS.length) return asOf;
    return `${MONTHS[monthIndex]} ${match[2]}`;
}

/** Every full practice state, alphabetical, D.C. excluded. */
export function getFullPracticeStateNames(): readonly string[] {
    return Object.entries(STATE_PRACTICE_AUTHORITY)
        .filter(([name, info]) => info.authority === 'full' && name !== DC_JURISDICTION)
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b));
}

/** True when the dataset classifies D.C. as full practice. */
export function isDcFullPractice(): boolean {
    return STATE_PRACTICE_AUTHORITY[DC_JURISDICTION]?.authority === 'full';
}

/** "A, B, and C" (serial comma); "A and B"; "A". */
export function joinWithAnd(items: readonly string[]): string {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export interface FullPracticeAnswer {
    /** Number of full practice states, D.C. excluded. */
    count: number;
    /** The states, alphabetical, D.C. excluded. */
    states: readonly string[];
    /** Whether D.C. is in the full tier (it is named after the states). */
    includesDc: boolean;
    /** AANP source name from STAT_SOURCES.fullPracticeStates. */
    source: string;
    /** AANP source URL from STAT_SOURCES.fullPracticeStates. */
    sourceUrl: string;
    /** Display vintage of the AANP map, e.g. "May 2026". */
    vintage: string;
    /** The count and every jurisdiction by name, attributed to AANP. */
    summary: string;
    /** Where the classification comes from and how current it is. */
    attribution: string;
    /** Tier level transition caveat. */
    caveat: string;
    /** summary, attribution and caveat as one plain-text paragraph. */
    text: string;
}

/** The plain-text answer to "Which states have full practice authority?" */
export function buildFullPracticeAnswer(): FullPracticeAnswer {
    const NPS = `${brand.niche.short}s`;
    const states = getFullPracticeStateNames();
    const includesDc = isDcFullPractice();
    const { source, sourceUrl } = STAT_SOURCES.fullPracticeStates;
    const vintage = getAanpMapVintage();
    const jurisdictions = includesDc ? [...states, 'the District of Columbia'] : [...states];
    const countPhrase = includesDc
        ? `${states.length} states plus the District of Columbia`
        : `${states.length} states`;

    const summary = `AANP classifies ${countPhrase} as Full Practice for ${NPS}: ${joinWithAnd(jurisdictions)}.`;
    const attribution = `Source: ${source} map, updated ${vintage}. Classifications change when a state legislature acts.`;
    const caveat = `Full Practice does not always mean independent practice from the first day of licensure. Many of these states first require transition to practice hours or a period of collaborative or supervised practice, so check each state's own rule in the state details on this page.`;

    return {
        count: states.length,
        states,
        includesDc,
        source,
        sourceUrl,
        vintage,
        summary,
        attribution,
        caveat,
        text: `${summary} ${attribution} ${caveat}`,
    };
}

/** The FAQ entry built from the same answer, for the visible FAQ and FAQPage. */
export function buildFullPracticeFaq(): { question: string; answer: string } {
    return {
        question: `Which states have full practice authority for ${brand.niche.short}s?`,
        answer: buildFullPracticeAnswer().text,
    };
}

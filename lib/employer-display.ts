/**
 * The short employer label on a job card (components/JobCard.tsx).
 *
 * WHY THIS EXISTS (indexing audit CQ-16). The card cut any employer name
 * longer than 20 characters to its first two words, so "University of
 * Mississippi Medical Center" rendered as "University of" on
 * /jobs/city/jackson-ms, and "Medical University of South Carolina" as
 * "Medical University", a name that points at no employer. A cut is only
 * safe when the two words stand as a name on their own. When the cut would
 * end on a joining word, or the next word joins the two to the rest of the
 * name, the full name renders instead and the card's CSS clips it visually,
 * so the markup (what crawlers and screen readers read) always carries a
 * real name.
 */

/** Names at or below this length always render in full. */
export const EMPLOYER_LABEL_FULL_MAX_CHARS = 20;

/** How many leading words a long name is cut to. */
export const EMPLOYER_LABEL_WORDS = 2;

/** Words that join the parts of one name ("University of Mississippi", "Johnson & Johnson"). */
const JOINING_WORDS: ReadonlySet<string> = new Set([
    'of', 'the', 'and', '&', 'for', 'at', 'in', 'on', 'to', 'a', 'an', 'de', 'del', 'la', 'le', 'y',
]);

const isJoiningWord = (word: string | undefined): boolean =>
    word !== undefined && JOINING_WORDS.has(word.toLowerCase());

/**
 *   "Televero Health"                           -> Televero Health (short: in full)
 *   "Unified Healing Collective Holdings"      -> Unified Healing
 *   "University of Mississippi Medical Center" -> University of Mississippi Medical Center
 *   "Medical University of South Carolina"     -> Medical University of South Carolina
 */
export function shortEmployerLabel(name: string): string {
    const full = name.trim().replace(/\s+/g, ' ');
    if (full.length <= EMPLOYER_LABEL_FULL_MAX_CHARS) return full;
    const words = full.split(' ');
    if (words.length <= EMPLOYER_LABEL_WORDS) return full;
    const kept = words.slice(0, EMPLOYER_LABEL_WORDS);
    const next = words[EMPLOYER_LABEL_WORDS];
    if (kept.some(isJoiningWord) || isJoiningWord(next)) return full;
    return kept.join(' ');
}

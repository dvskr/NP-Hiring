/**
 * Render-time separator normaliser for employer-authored text.
 *
 * Job titles, employer names and location strings come from the listings
 * themselves and often carry dashes as separators ("NP — Remote |
 * Telehealth", "Remote - USA", "NP/PA - Studio City"). They are DATA: the
 * stored row and every structured-data surface (JobPosting / BreadcrumbList
 * JSON-LD) keep the original string. Owner direction (2026-09-12): no dashes
 * in visible text, so every candidate-facing render point passes the value
 * through this helper before printing it.
 *
 * Rules:
 *   - every em dash (U+2014) and en dash (U+2013), with any whitespace around
 *     it, becomes a single middle-dot separator " · ";
 *   - a hyphen surrounded by whitespace ("Remote - USA") becomes " · " too;
 *   - hyphens inside words ("Full-Time", "Part-time", "1099-vs-W2") are left
 *     alone;
 *   - idempotent: a string that already uses " · " is returned unchanged;
 *   - null, undefined and the empty string return null.
 */

const SEPARATOR = ' · ';

// Em/en dash with any surrounding whitespace, OR a hyphen that has whitespace
// on BOTH sides. The hyphen branch requires \s+ on each side so compound
// words and negative numbers are never touched.
const DASH_SEPARATOR_PATTERN = /\s*[–—]\s*|\s+-\s+/g;

export function normalizeDisplayText(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.replace(DASH_SEPARATOR_PATTERN, SEPARATOR);
}

/**
 * String-returning variant for template literals and attribute values, where
 * a null would otherwise print as the text "null". Empty input yields ''.
 */
export function displayText(value: string | null | undefined): string {
  return normalizeDisplayText(value) ?? '';
}

/*
 * Count grammar (pSEO thin-content program, T0-6). One implementation for
 * every count string: `pluralize` picks the noun, `formatCount` prints
 * "{n} {noun}" (the form the page specs write as pluralize(n, 'role')),
 * `isAre` picks the verb. All three live in lib/pseo/plural.ts and are
 * re-exported here so display helpers have one import path.
 */
export { pluralize, formatCount, isAre } from '@/lib/pseo/plural';

/** Past-tense partner of isAre: "was" for exactly one, "were" otherwise. */
export function wasWere(count: number): 'was' | 'were' {
  return count === 1 ? 'was' : 'were';
}

/** Trailing separators that must not end a truncated string. */
const DANGLING_TAIL_PATTERN = /[\s,;:(]+$/;

/**
 * Clip `text` to at most `max` characters without ever ending mid-word.
 *
 * Shared by every meta description and teaser (the metro page kept a local
 * copy before this existed). The cut lands on the last whitespace inside the
 * budget, then any dangling ", " / ";" / ":" / "(" tail is stripped, so the
 * result reads as a complete final word. `suffix` (for example a single
 * ellipsis character) is appended after the cut and counts toward `max`. A
 * single word longer than the budget is returned clipped, since there is no
 * word boundary to honour.
 */
export function truncateOnWord(text: string, max: number, suffix = ''): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const budget = Math.max(0, max - suffix.length);
  // Look one character past the budget: a space there means the budget
  // ended exactly on a word boundary and nothing needs cutting back.
  const cutsMidWord = !/\s/.test(trimmed.charAt(budget));
  let clipped = trimmed.slice(0, budget);
  if (cutsMidWord) {
    const lastSpace = clipped.lastIndexOf(' ');
    if (lastSpace > 0) clipped = clipped.slice(0, lastSpace);
  }
  return `${clipped.replace(DANGLING_TAIL_PATTERN, '')}${suffix}`;
}

/**
 * "a" or "an" for a term that opens a phrase. Acronyms follow the spoken
 * letter ("an NP", "a CRNA", "an FNP"); words follow the leading vowel. The
 * niche credential comes from brand.niche.short, so copy can never bake in
 * the article that happens to fit the reference niche.
 */
export function indefiniteArticle(term: string): 'a' | 'an' {
  const trimmed = term.trim();
  const first = trimmed.charAt(0);
  if (!first) return 'a';
  if (/^[A-Z0-9]{2,}/.test(trimmed)) return 'AEFHILMNORSX8'.includes(first) ? 'an' : 'a';
  return /[aeiou]/i.test(first) ? 'an' : 'a';
}

/**
 * "A", "A and B", "A, B and C". No serial comma: the page specs write
 * "{A} ({n}), {B} ({n}) and {C} ({n})", and every count list on the pSEO
 * surfaces follows that shape. Empty input yields ''.
 */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

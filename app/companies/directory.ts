/**
 * Pure helpers for the /companies employer directory (P2 #11).
 *
 * The hub used to run a bare `take: 200` with no pagination and no index, so
 * once the employer table crossed 200 rows the tail silently vanished from the
 * only internal surface that links employer profiles — while app/sitemap.ts
 * kept submitting those profile URLs. Orphaned-but-submitted URLs are exactly
 * the "Discovered – currently not indexed" pattern in GSC.
 *
 * Directory shape is driven by the real inventory: 131 employers currently
 * carry at least one active job, so the whole set fits on one canonical page.
 * The A–Z index is what makes that page navigable; pagination exists as the
 * automatic overflow valve so the tail can never be dropped again.
 *
 * Kept here (a non-route module colocated with the page) so the bucketing and
 * pagination arithmetic can be unit-tested without rendering a server
 * component or touching the database.
 */

/**
 * Entries per page. Deliberately larger than the live employer count so the
 * directory stays a single self-canonical URL today — splitting 131 employers
 * across pages would fragment link equity for no user benefit. Pagination
 * engages on its own the moment inventory outgrows this.
 */
export const COMPANIES_PER_PAGE = 250;

/** Bucket label used for names that do not start with a Latin letter. */
export const NON_ALPHA_LETTER = '#';

/** Display order for the jump nav: non-alpha bucket first, then A–Z. */
export const DIRECTORY_LETTERS: readonly string[] = [
  NON_ALPHA_LETTER,
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
];

/**
 * First-letter bucket for a directory entry. Diacritics are folded so
 * "Ålesund Health" files under A rather than the catch-all bucket.
 */
export function directoryLetter(name: string): string {
  const first = name
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .charAt(0)
    .toUpperCase();
  return first >= 'A' && first <= 'Z' ? first : NON_ALPHA_LETTER;
}

export interface LetterGroup<T> {
  letter: string;
  items: T[];
}

/**
 * Group entries into A–Z sections in DIRECTORY_LETTERS order, dropping empty
 * buckets. Section order is therefore independent of the database collation
 * that produced the input ordering.
 */
export function groupByLetter<T extends { name: string }>(
  items: readonly T[],
): LetterGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const letter = directoryLetter(item.name);
    const bucket = buckets.get(letter);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(letter, [item]);
    }
  }
  return DIRECTORY_LETTERS.filter((letter) => buckets.has(letter)).map((letter) => ({
    letter,
    items: buckets.get(letter) as T[],
  }));
}

/** DOM id for a letter section, used by the jump nav anchors. */
export function letterAnchorId(letter: string): string {
  return letter === NON_ALPHA_LETTER ? 'letter-other' : `letter-${letter.toLowerCase()}`;
}

/**
 * Parse the `?page=` query value. Anything absent, non-numeric, zero or
 * negative resolves to page 1 rather than throwing — crawlers and pasted links
 * routinely carry junk params, and a 500 there is worse than a redirectless 1.
 */
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Page count for a total, never below 1 so an empty directory still renders. */
export function totalPageCount(
  totalItems: number,
  perPage: number = COMPANIES_PER_PAGE,
): number {
  if (totalItems <= 0) return 1;
  return Math.ceil(totalItems / perPage);
}

/**
 * Canonical URL for a directory page. Page 1 is the bare path — never
 * `?page=1` — so the hub has exactly one canonical form.
 */
export function buildCompaniesPath(page: number): string {
  return page > 1 ? `/companies?page=${page}` : '/companies';
}

/**
 * Human range label ("1–131 of 131") for the page's honest count sentence.
 * `shown` is the number of rows actually rendered, so the label can never
 * over-claim when the last page is short.
 */
export function pageRangeLabel(page: number, shown: number, total: number, perPage: number = COMPANIES_PER_PAGE): string {
  if (total <= 0 || shown <= 0) return '0';
  const start = (page - 1) * perPage + 1;
  const end = start + shown - 1;
  return start === 1 && end === total
    ? total.toLocaleString()
    : `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`;
}

/**
 * Highest-volume employers for the page-1 spotlight strip. Ranks on the LIVE
 * active-job count that the cards display, not the denormalized Company.jobCount
 * column used to shortlist candidates — so the strip's ordering always matches
 * the numbers next to it.
 */
export function topByActiveJobs<T extends { activeJobs: number }>(
  rows: readonly T[],
  limit: number,
): T[] {
  return [...rows].sort((a, b) => b.activeJobs - a.activeJobs).slice(0, limit);
}

/**
 * Count-noun agreement for pSEO copy. Live inventory counts reach every
 * template, and a long-tail page with exactly one job printed "1 positions",
 * "1 live roles" and "There are currently 1 ... positions".
 */

/** Singular when count is exactly 1, otherwise the plural (default: +s). */
export function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** "1 position", "12 positions". */
export function formatCount(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}

/** "is" for exactly one, "are" otherwise. */
export function isAre(count: number): 'is' | 'are' {
  return count === 1 ? 'is' : 'are';
}

/**
 * Stat value for a list capped by a query `take`. When the list hit the cap
 * there may be more rows, so it reads "8+"; below the cap the exact length is
 * the true count and gets no padding.
 */
export function cappedCount(length: number, cap: number): string {
  return length >= cap ? `${cap}+` : `${length}`;
}

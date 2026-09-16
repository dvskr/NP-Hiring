/**
 * Count badge text for tiles and pills. A number renders only above zero
 * (a "0" badge is padding, never shown); a string renders as given, so
 * callers can pass capped counts such as "8+" (lib/pseo/plural.ts cappedCount).
 */
export function countText(count: number | string | undefined): string | null {
  if (typeof count === 'number') return count > 0 ? count.toLocaleString('en-US') : null;
  return count ? count : null;
}

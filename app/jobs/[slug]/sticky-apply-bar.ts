/**
 * Bottom clearance for the job-detail mobile sticky apply bar.
 *
 * The bar is `position: fixed` at the bottom of the viewport below `lg`
 * (Apply CTA plus the Save / Message row, roughly 130px, plus the iOS safe
 * area). The site footer renders AFTER <main>, so padding inside <main> can
 * never lift the footer's last links out from under the bar. The clearance is
 * therefore applied to <body> while the bar is mounted: the page scrolls far
 * enough that the final footer control sits above the bar.
 *
 * Before hydration the `:has()` rule uses a conservative static estimate;
 * once the client measures the rendered bar it publishes the exact height
 * through a CSS custom property, which the same rule prefers.
 */

export const STICKY_APPLY_BAR_CLASS = 'job-detail-apply-bar';
export const STICKY_APPLY_BAR_HEIGHT_VAR = '--job-apply-bar-h';

/** Static estimate used until the bar has been measured (px, excludes safe area). */
export const STICKY_APPLY_BAR_FALLBACK_PX = 140;

/** Tailwind `lg` is 1024px; the bar carries `lg:hidden`. */
const BELOW_LG_MEDIA = '(max-width: 1023.98px)';

export const STICKY_APPLY_BAR_CLEARANCE_CSS =
  `@media ${BELOW_LG_MEDIA} { body:has(.${STICKY_APPLY_BAR_CLASS}) { ` +
  `padding-bottom: var(${STICKY_APPLY_BAR_HEIGHT_VAR}, calc(${STICKY_APPLY_BAR_FALLBACK_PX}px + env(safe-area-inset-bottom))); } }`;

/**
 * Converts a measured bar height into the custom property value. Returns null
 * for a non-finite or non-positive measurement (bar hidden at `lg`, or not
 * laid out yet) so the caller clears the property and the fallback applies.
 */
export function stickyApplyBarClearance(measuredHeightPx: number): string | null {
  if (!Number.isFinite(measuredHeightPx) || measuredHeightPx <= 0) return null;
  return `${Math.ceil(measuredHeightPx)}px`;
}

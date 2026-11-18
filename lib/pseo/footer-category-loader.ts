/**
 * lib/pseo/footer-category-loader.ts
 *
 * Server-only read behind the footer's category columns
 * (lib/pseo/footer-category-links.ts): the category landings the primary
 * sitemap submits, read through the shared rule in
 * lib/pseo/landing-verdicts.ts (the fresh 'category-landing' PseoStats
 * verdict, re-checked against the listing floor over its stored counts).
 *
 * The footer renders on every page, so the read is cached for a day across
 * requests (one small indexed query a day, not one per render). A day, not
 * an hour: the shortest cache window in a page's tree becomes the page's, so
 * an hourly read here held every job page to an hour (2026-11-17, see
 * FOOTER_LANDING_VERDICT_CACHE_SECONDS). A failed read returns null, and the
 * footer falls back to its fixed list of standing landings instead of
 * rendering no category links.
 */

import { FOOTER_LANDING_VERDICT_CACHE_SECONDS, loadIndexableLandingSlugsDaily } from './landing-verdicts';

/** Seconds the verdict list is reused across requests. */
export const FOOTER_VERDICT_CACHE_SECONDS = FOOTER_LANDING_VERDICT_CACHE_SECONDS;

/** Indexable category landing slugs, or null when the verdicts cannot be read. */
export async function loadFooterIndexableLandings(): Promise<ReadonlySet<string> | null> {
  return loadIndexableLandingSlugsDaily('footer');
}

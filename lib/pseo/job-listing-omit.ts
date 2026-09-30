/**
 * lib/pseo/job-listing-omit.ts — Perf1 and indexing audit L-06.
 *
 * Listing pages render job cards (components/JobCard.tsx, a client
 * component), and every prop a client component receives is serialized into
 * the page's RSC payload. The cards never render the multi-KB `description`
 * HTML, yet /jobs shipped 52 of them (a 404 KB flight payload on a 926 KB
 * page). Passing this omit to the listing findMany calls drops that column
 * from the SQL SELECT and from the payload.
 *
 * Runtime object (not `as const`) on purpose: the column exclusion happens at the
 * DB layer regardless of TypeScript inference, so callers keep the full Job type
 * and need no cast.
 */
import { truncateOnWord } from '@/lib/display-text';

export const JOB_LISTING_OMIT = { description: true };

/** The longest summary a listing card ships (L-06: 200 characters or fewer). */
export const CARD_SUMMARY_MAX = 200;

/**
 * A listing card's summary, cut on a word boundary to CARD_SUMMARY_MAX
 * characters, or null when there is none. Server side, so the full
 * summary never reaches the client payload.
 */
export function cardSummary(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const text = summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? truncateOnWord(text, CARD_SUMMARY_MAX) : null;
}

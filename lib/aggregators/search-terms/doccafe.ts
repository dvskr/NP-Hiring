/**
 * DocCafe search terms.
 *
 * ⛔ SOURCE DISABLED ON THIS BOARD — NP Hiring runs ATS-only ingestion
 * (see DISABLED_SOURCES in config/cron-schedule.ts). No cron schedules
 * doccafe; the adapter and this file remain in the engine for other
 * boards. The terms below are the inherited PMHNP set and are inert
 * here — refresh them for the niche if a board re-enables the source.
 *
 * Each entry becomes one GET against DocCafe's public, unauthenticated
 * RSS endpoint (https://www.doccafe.com/jobs/rss?q={query}). DocCafe's
 * `?q=` filter is loose — many returned items are physician/non-PMHNP —
 * so the orchestrator's relevance gate does the real filtering; these
 * queries just control what lands in the candidate pool.
 *
 * FORK NOTE: new niches replace these terms.
 *
 * Edit this file to add or remove a search term. Adapter unchanged.
 */

// Several keyword queries to maximize PMHNP coverage. RSS is capped at
// ~30 items per call, so multiple targeted queries help.
export const DOCCAFE_SEARCH_QUERIES: readonly string[] = [
    'PMHNP',
    'psychiatric mental health nurse practitioner',
    'psychiatric nurse practitioner',
    'mental health nurse practitioner',
    'behavioral health nurse practitioner',
];

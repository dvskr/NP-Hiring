/**
 * Health eCareer Center (Naylor association job board) search terms.
 *
 * Each entry becomes one paginated keywords search against the shared
 * Naylor platform root
 * (https://jobs.healthcareercenter.com/jobs/search?keywords={q}&page={N}).
 * Results are server-rendered HTML and every hit costs a detail-page
 * fetch, so keep the list targeted — the adapter also runs a title-only
 * relevance gate before accepting a posting.
 *
 * FORK NOTE: new niches replace these terms.
 *
 * Edit this file to add or remove a search term. Adapter unchanged.
 */

export const HCC_SEARCH_QUERIES: readonly string[] = [
    'PMHNP',
    'psychiatric mental health nurse practitioner',
    'psychiatric nurse practitioner',
    'mental health nurse practitioner',
    'behavioral health nurse practitioner',
];

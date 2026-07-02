/**
 * Workday search terms.
 *
 * Workday career sites are scraped directly via their hidden JSON API
 * (POST https://{slug}.wd{instance}.myworkdayjobs.com/wday/cxs/{slug}/{site}/jobs).
 * Two distinct lists live here:
 *
 *   WORKDAY_SEARCH_TERMS — query terms. Each entry becomes one
 *     `searchText` value POSTed per tenant (paginated 20 at a time).
 *     Workday search is fuzzy, so the strategy is to cast a wide net
 *     and let isRelevantJob filter precisely downstream.
 *
 *   WORKDAY_TITLE_PREFILTER_TERMS — title pre-screen. Lowercase
 *     substrings used to cheaply screen result titles BEFORE the
 *     per-job detail fetch (the expensive part: one HTTP request per
 *     posting for description + real posted date). A title passes if
 *     it contains ANY of these substrings (case-insensitive; the
 *     adapter lowercases titles before matching).
 *
 * FORK NOTE: new niches replace these terms. When adapting, keep the
 * title pre-screen list PERMISSIVE — broader than the query terms. If
 * it is too strict it silently starves the detail fetches and postings
 * are dropped before the real relevance gate ever sees them. See the
 * pre-filter comments in lib/aggregators/workday.ts.
 *
 * Edit this file to add or remove terms. Adapter unchanged.
 */

// PMHNP search terms - cast a wide net, let isRelevantJob filter precisely
export const WORKDAY_SEARCH_TERMS: readonly string[] = [
    'Psychiatric Nurse Practitioner',
    'PMHNP',
    'Psychiatric Mental Health',
    'Behavioral Health Nurse Practitioner',
    'Psychiatric APRN',
    'Psych NP',
];

export const WORKDAY_TITLE_PREFILTER_TERMS: readonly string[] = [
    'pmhnp',
    'psychiatric',
    'psych',
    'mental health',
    'behavioral health',
    'nurse practitioner',
];

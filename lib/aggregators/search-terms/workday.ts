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
 * NP HIRING (2026-11-12): the terms were first ported verbatim from the
 * donor board's single-specialty list, on the assumption that Workday's
 * fuzzy search would surface plain "Nurse Practitioner" postings for a
 * narrower specialty query. It does not. A probe of all 112 tenants found
 * 439 NP/APRN-titled postings through the six inherited terms and 3,867
 * through the role terms below: about 3,400 open NP, CRNA, midwife and
 * CNS postings at tenants already on the list were never fetched. The
 * inherited terms stay (they are cheap and guarantee no regression for
 * the original niche); the role terms cover every credential the board
 * lists (config/niche/relevance.ts).
 *
 * A multi-word term matches any of its words, so "Advanced Practice
 * Provider" returns 1,500 results at a large system, title matches first.
 * The adapter therefore stops paging a term once the results stop carrying
 * a title that passes the pre-screen (WORKDAY_MAX_PAGES_PER_TERM,
 * WORKDAY_EMPTY_PAGES_BEFORE_STOP in lib/aggregators/workday.ts).
 *
 * Edit this file to add or remove terms. Adapter unchanged.
 */

export const WORKDAY_SEARCH_TERMS: readonly string[] = [
    // Role terms: every NP specialty and the APRN cohort.
    'Nurse Practitioner',
    'APRN',
    'Advanced Practice Provider',
    'Advanced Practice Registered Nurse',
    'ARNP',
    'Nurse Anesthetist',
    'CRNA',
    'Nurse Midwife',
    'Clinical Nurse Specialist',
    // The inherited donor list, kept whole.
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
    // APRN cohort, spelled out. Abbreviations are matched on word
    // boundaries by WORKDAY_TITLE_PREFILTER_REGEX instead: as bare
    // substrings 'np', 'app' and 'cns' hit "inpatient", "application"
    // and "licensed".
    'advanced practice',
    'nurse anesthetist',
    'midwife',
    'clinical nurse specialist',
];

/**
 * Credential abbreviations a title may carry instead of the spelled-out
 * role ("APRN Cardiology", "CRNA", "Hospitalist NP/PA", "APP - Urgent
 * Care"). Tested against the lowercased title.
 */
export const WORKDAY_TITLE_PREFILTER_REGEX =
    /\b(?:np|aprn|arnp|fnp|agnp|agpcnp|agacnp|pnp|acpnp|cpnp|nnp|whnp|acnp|enp|crna|cnm|cns|apn|app)\b/;

/** True when a Workday result title is worth a detail fetch. */
export function passesWorkdayTitlePrefilter(title: string): boolean {
    const lower = title.toLowerCase();
    return (
        WORKDAY_TITLE_PREFILTER_TERMS.some((term) => lower.includes(term)) ||
        WORKDAY_TITLE_PREFILTER_REGEX.test(lower)
    );
}

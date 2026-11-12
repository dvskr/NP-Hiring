/**
 * Adzuna search terms.
 *
 * Scheduled on this board since 2026-11-12, once a day (config/cron-schedule.ts).
 * Until then the source was disabled and this file held the donor board's
 * single-specialty list.
 *
 * Each entry is one TITLE search (Adzuna's `title_only` parameter): every
 * word must appear in the job title. A title search returns far fewer
 * off-target postings than a keyword search, so the specialty variants
 * ("Family Nurse Practitioner" and so on) are not listed: the first term
 * already returns them. The abbreviations are listed because a title can
 * carry only the abbreviation.
 *
 * ORDER MATTERS. A run makes at most ADZUNA_MAX_CALLS_PER_RUN calls
 * (lib/aggregators/adzuna.ts), newest postings first, up to
 * ADZUNA_MAX_PAGES_PER_QUERY pages per term. The broadest term comes
 * first, then the small terms, and the anesthesia terms last because they
 * are large and are the ones to cut when the call budget runs out.
 *
 * Edit this file to add or remove a search term. Adapter unchanged.
 */

export const ADZUNA_SEARCH_QUERIES: readonly string[] = [
    'Nurse Practitioner',
    'APRN',
    'ARNP',
    'PMHNP',
    'FNP',
    'Advanced Practice Provider',
    'Advanced Practice Registered Nurse',
    'Nurse Midwife',
    'Clinical Nurse Specialist',
    'CRNA',
    'Nurse Anesthetist',
];

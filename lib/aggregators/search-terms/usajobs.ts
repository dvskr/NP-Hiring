/**
 * USAJobs search terms.
 *
 * Scheduled on this board since 2026-11-12, once a day (config/cron-schedule.ts).
 * Until then the source was disabled and this file held the donor board's
 * single-specialty list.
 *
 * Each entry becomes one paginated Keyword query against the USAJobs
 * Search API (https://data.usajobs.gov/api/search). All queries are
 * additionally constrained to JobCategoryCode=0610 (Nurse) inside the
 * adapter so we don't have to repeat that filter here.
 *
 * The federal occupational series 0610 captures every nursing role
 * across VA, IHS, BoP, DoD, etc. Combining it with a role keyword
 * surfaces the NP, nurse-midwife and clinical nurse specialist postings
 * without the staff-nurse ones.
 *
 * NOT COVERED: nurse anesthetists. The federal government files CRNA
 * postings under series 0605, and the adapter sends 0610 only. Reaching
 * them is an adapter change (a second category code), to be made and
 * checked against the live API once the board has a key.
 */

export const USAJOBS_SEARCH_QUERIES: readonly string[] = [
    'Nurse Practitioner',
    'Advanced Practice Nurse',
    'Advanced Practice Registered Nurse',
    'APRN',
    'Certified Nurse Midwife',
    'Clinical Nurse Specialist',
    'Psychiatric Mental Health Nurse Practitioner',
    'PMHNP',
];

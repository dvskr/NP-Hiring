/**
 * Adzuna search terms — NP / APRN broad cohort.
 *
 * Each entry becomes one search query against the Adzuna API. Adzuna's
 * search supports keywords + location filters but each call is a single
 * literal phrase, so each variant is its own paginated query.
 *
 * Adding a term costs ~20 extra API calls per cron run (max 20 pages
 * each at 500ms throttle = ~10s wall-time per term).
 *
 * Edit this file to add or remove a search term. Adapter unchanged.
 *
 * Strategy: keep query list under ~30 terms to stay inside daily Adzuna
 * quota. We cover the highest-volume NP specialty titles + generic NP
 * markers + the APRN cohort (CRNA / CNM / CNS). The relevance filter at
 * lib/utils/job-filter.ts is the last line of defence.
 */

export const ADZUNA_SEARCH_QUERIES: readonly string[] = [
    // Generic NP markers — broadest reach
    'Nurse Practitioner',
    'APRN',
    'ARNP',

    // Top NP specialties (high job volume)
    'Family Nurse Practitioner',
    'FNP',
    'Adult-Gerontology Nurse Practitioner',
    'AGNP',
    'AGACNP',
    'Pediatric Nurse Practitioner',
    'PNP',
    'Acute Care Nurse Practitioner',
    'ACNP',
    'Women\'s Health Nurse Practitioner',
    'WHNP',
    'Neonatal Nurse Practitioner',
    'NNP',

    // Setting-driven specialty searches (high CPM)
    'Emergency Nurse Practitioner',
    'Hospitalist Nurse Practitioner',
    'Oncology Nurse Practitioner',
    'Cardiology Nurse Practitioner',
    'Geriatric Nurse Practitioner',
    'Urgent Care Nurse Practitioner',

    // Mode / engagement type (high search intent)
    'Telehealth Nurse Practitioner',
    'Remote Nurse Practitioner',
    'Locum Tenens Nurse Practitioner',
    'Travel Nurse Practitioner',
    'Per Diem Nurse Practitioner',

    // PMHNP (still in scope — the founding niche)
    'PMHNP',
    'Psychiatric Nurse Practitioner',

    // APRN cohort beyond NPs
    'CRNA',
    'Certified Registered Nurse Anesthetist',
    'Certified Nurse Midwife',
    'Clinical Nurse Specialist',
];

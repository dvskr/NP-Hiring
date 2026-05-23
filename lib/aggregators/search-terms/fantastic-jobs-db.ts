/**
 * Fantastic-Jobs-DB (Active Jobs DB via RapidAPI) search terms — NP / APRN broad.
 *
 * Two-pass strategy:
 *   PASS A — TITLE_TERMS: literal title-phrase matches. The API only
 *     accepts a single literal phrase per `title_filter`, so each
 *     variant is its own paginated query. Most variants resolve in
 *     1-3 pages.
 *
 *   PASS B — TITLE_FILTERS_BROAD + DESCRIPTION_FILTER_NP:
 *     title=NP/APRN/APP, description filter widens the catch.
 *     description_filter supports OR.
 *
 * Cost per term: ~5 API calls. Budget cap is 200 calls/run, monthly
 * cap is 20k. Currently using ~80-120/run; broader NP scope may push
 * to ~140-180/run.
 *
 * Edit this file to broaden or tighten coverage. Adapter unchanged.
 */

export const FANTASTIC_TITLE_TERMS: readonly string[] = [
    // High-volume NP specialty titles
    'Family Nurse Practitioner',
    'FNP-BC',
    'Adult-Gerontology Nurse Practitioner',
    'AGNP-C',
    'AGACNP',
    'Pediatric Nurse Practitioner',
    'PNP-BC',
    'Acute Care Nurse Practitioner',
    'ACNP-BC',
    "Women's Health Nurse Practitioner",
    'WHNP-BC',
    'Neonatal Nurse Practitioner',
    'Emergency Nurse Practitioner',
    'Hospitalist Nurse Practitioner',
    'Oncology Nurse Practitioner',
    'Cardiology Nurse Practitioner',
    'Geriatric Nurse Practitioner',
    'Primary Care Nurse Practitioner',
    'Urgent Care Nurse Practitioner',
    'Telehealth Nurse Practitioner',

    // PMHNP cohort (still in scope)
    'PMHNP',
    'Psychiatric Nurse Practitioner',
    'Psychiatric Mental Health Nurse Practitioner',
    'Mental Health Nurse Practitioner',
    'Behavioral Health Nurse Practitioner',
    'Psychiatric APRN',

    // APRN cohort beyond NPs
    'CRNA',
    'Certified Registered Nurse Anesthetist',
    'Nurse Anesthetist',
    'Certified Nurse Midwife',
    'Clinical Nurse Specialist',
];

export const FANTASTIC_TITLE_FILTERS_BROAD: readonly string[] = [
    'Nurse Practitioner',
    'APRN',
    'ARNP',
    'Advanced Practice Provider',
    'Advanced Practice Nurse',
];

// Broad NP / APRN description filter (replaces the PMHNP-specific psych-only
// filter). The relevance classifier at lib/utils/job-filter.ts handles
// downstream precision.
export const FANTASTIC_DESCRIPTION_FILTER_NP =
    '"nurse practitioner" OR "APRN" OR "ARNP" OR "FNP" OR "AGNP" OR "PNP" OR "WHNP" OR "ACNP" OR "PMHNP" OR "NNP" OR "CRNA" OR "advanced practice provider" OR "certified nurse midwife"';

// Backward-compat export name so any importer that still references the
// PSYCH version doesn't break at import time. Same value as the broad NP
// filter above.
export const FANTASTIC_DESCRIPTION_FILTER_PSYCH = FANTASTIC_DESCRIPTION_FILTER_NP;

/**
 * USAJobs search terms — NP / APRN broad cohort.
 *
 * Each entry becomes one paginated Keyword query against the USAJobs
 * Search API (https://data.usajobs.gov/api/search). All queries are
 * additionally constrained to JobCategoryCode=0610 (Nurse) inside the
 * adapter so we don't have to repeat that filter here.
 *
 * The federal occupational series 0610 captures every nursing role
 * across VA, IHS, BoP, DoD, etc. Combining it with NP-specific keywords
 * surfaces APRN-level postings without scraping unrelated nursing roles.
 *
 * VA is by far the largest federal employer of NPs. Roles tend to follow
 * VA's clinical mission (mental health, primary care, geriatric, polytrauma)
 * so the term list weights those areas.
 */

export const USAJOBS_SEARCH_QUERIES: readonly string[] = [
    // Generic NP markers
    'Nurse Practitioner',
    'Advanced Practice Registered Nurse',
    'APRN',

    // Top federal NP specialties
    'Family Nurse Practitioner',
    'Adult Nurse Practitioner',
    'Adult-Gerontology Nurse Practitioner',
    'Pediatric Nurse Practitioner',
    'Acute Care Nurse Practitioner',
    "Women's Health Nurse Practitioner",
    'Geriatric Nurse Practitioner',
    'Mental Health Nurse Practitioner',
    'Psychiatric Mental Health Nurse Practitioner',
    'Psychiatric Nurse Practitioner',
    'PMHNP',
    'Primary Care Nurse Practitioner',
    'Emergency Nurse Practitioner',
    'Hospitalist Nurse Practitioner',

    // APRN cohort beyond NPs
    'Certified Registered Nurse Anesthetist',
    'CRNA',
    'Certified Nurse Midwife',
    'Clinical Nurse Specialist',
];

/**
 * SmartRecruiters tenant config.
 *
 * Extracted 2026-05-05 from lib/aggregators/smartrecruiters.ts so the
 * adapter can stay focused on fetch logic. Edit this file to add or
 * remove a company.
 *
 * Each entry is a SmartRecruiters company identifier (slug) plus its
 * display name. Slug appears in the SmartRecruiters URL:
 *   https://api.smartrecruiters.com/v1/companies/{slug}/postings
 */

export interface SmartRecruitersTenant {
    slug: string;
    name: string;
}

export const SMARTRECRUITERS_TENANTS: readonly SmartRecruitersTenant[] = [
    // === ADDED 2026-02-20 — Production DB apply_link mining ===
    // 3 with PMHNP jobs in sample
    { slug: 'karecruitinginc', name: 'K.A. Recruiting' },                                // 60 total, 7 PMHNP
    { slug: 'oleskyassociates', name: 'Olesky Associates' },                              // 299 total, 7 PMHNP
    { slug: 'newyorkpsychotherapyandcounselingcenter', name: 'NY Psychotherapy & Counseling' }, // 11 total, 6 PMHNP

    // 3 alive, monitoring for PMHNP
    { slug: 'internationalsosgovernmentmedicalservices', name: 'International SOS' },     // 598 total
    { slug: 'kittitasvalleyhealthcare', name: 'Kittitas Valley Healthcare' },             // 63 total
    { slug: 'mascmedicalrecruitmentfirm', name: 'MASC Medical' },                         // 82 total

    // === ADDED 2026-05-12 — prod DB discovery (scripts/discover-ats-tenants-from-db.ts) ===
    // Live boards confirmed via scripts/probe-greenhouse-smartrecruiters-candidates.ts.
    { slug: 'ahrcnyc1', name: 'AHRC NYC' },                                                // 1/72 live (24 historical)
    { slug: 'smitharnoldpartners', name: 'Smith Arnold Partners' },                        // 7/10 live — recruiter firm
    { slug: 'vericare', name: 'Vericare' },                                                // 1/2 live
    { slug: 'covista', name: 'Covista' },                                                  // 302 total / 0 PMHNP at probe (35 historical) — monitor
    { slug: 'northwesternmedicine', name: 'Northwestern Memorial Healthcare' },            // 1213 total / 0 PMHNP at probe (31 historical) — monitor

    // === Added 2026-11-12: NP-wide expansion, each verified live ===
    { slug: 'integrateddermatology', name: 'Integrated Dermatology' },                         // 40 NP / 113 total
    { slug: 'munsonhealthcare1', name: 'Munson Healthcare' },                                  // 23 NP / 650 total
    { slug: 'stanfordmedicinechildrenshealth', name: 'Stanford Medicine Children\'s Health' }, // 22 NP / 140 total
    { slug: 'saludfamilyhealthcenters', name: 'Salud Family Health' },                         // 5 NP / 24 total
    { slug: 'cityofnewyork', name: 'City of New York' },                                       // 2 NP / 1712 total — low yield on a large board
    { slug: 'cityandcountyofsanfrancisco1', name: 'City and County of San Francisco' },        // 1 NP / 161 total
    { slug: 'daretocaretoollc', name: 'Dare to Care Too' },                                    // 1 NP / 7 total
    { slug: 'usphysicaltherapy2', name: 'U.S. Physical Therapy' },                             // 1 NP / 628 total — low yield on a large board
];

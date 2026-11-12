/**
 * JazzHR tenant config.
 *
 * Endpoint: https://{slug}.applytojob.com/  (HTML scrape)
 * JazzHR has no public JSON board API — we parse the HTML root page
 * for /apply/{id}/{title-slug} URLs and the surrounding job-title text.
 *
 * Seeded 2026-05-12 from prod DB discovery
 * (scripts/discover-ats-tenants-from-db.ts).
 */

export interface JazzHrTenant {
    slug: string;
    name: string;
}

export const JAZZHR_TENANTS: readonly JazzHrTenant[] = [
    // ── CONFIRMED PMHNP PRODUCERS (historical pmhnp count) ──
    { slug: 'mastercenterforaddictionmedicine', name: 'Master Center for Addiction Medicine' }, // 446
    { slug: 'mindifywellnessandcare', name: 'Mindify Wellness And Care' },                       // 147
    { slug: 'myspectrum', name: 'MySpectrum' },                                                  // 16
    { slug: 'perimeterhealthcare', name: 'Perimeter Healthcare' },                               // 15
    { slug: 'bostonneurobehavioralassociates', name: 'Boston Neurobehavioral Associates' },      // 15
    { slug: 'totalmens', name: 'Total Primary Care' },                                           // 15
    { slug: 'novamedicalservices', name: 'Nova Medical Services' },                              // 15
    { slug: 'cmadc', name: 'Community Medical and Dental Care' },                                // 14
    { slug: 'sambarecovery', name: 'Samba Recovery' },                                           // 14
    { slug: 'marysolmentalhealthexperts', name: 'Mar Y Sol Mental Health' },                     // 14
    { slug: 'eduventionmentoringandcounseling', name: 'Eduvention Mentoring & Counseling' },     // 13
    { slug: 'itrustwellnessgroup', name: 'iTrust Wellness Group' },                              // 11
    { slug: 'addictionrecoverycare', name: 'Addiction Recovery Care' },                          // 7
    { slug: 'brightwayscounselinggroup', name: 'Brightways Counseling Group' },                  // 6
    { slug: 'onebehavioral', name: 'OneBehavioral' },                                            // 6
    { slug: 'bethanymedical', name: 'Bethany Medical' },                                         // 6
    { slug: 'familyservicesny', name: 'Family Services NY' },                                    // 3

    // === Added 2026-11-12: NP-wide expansion, each verified live ===
    { slug: 'harmonyunitedhc', name: 'Harmony United Psychiatric Care' },                                  // 59 NP / 381 total
    { slug: 'themedservgroup', name: 'The MedServ Group' },                                                // 44 NP / 188 total
    { slug: 'mabsrx', name: 'Elaya Health' },                                                              // 39 NP / 63 total
    { slug: 'triadcompletehealthcare', name: 'TRIAD MSO' },                                                // 24 NP / 81 total
    { slug: 'healthcarerecruitmentcounselors', name: 'Healthcare Recruitment Counselors' },                // 22 NP / 174 total
    { slug: 'midwestexpressclinic', name: 'Midwest Express Clinic' },                                      // 19 NP / 66 total
    { slug: 'agelessmenshealth', name: 'Ageless Men\'s Health' },                                          // 17 NP / 31 total
    { slug: 'westcoastwound', name: 'West Coast Wound' },                                                  // 17 NP / 71 total
    { slug: 'chsrecruiting', name: 'CHS Recruiting' },                                                     // 17 NP / 123 total
    { slug: 'bloomhealthcare', name: 'Bloom Healthcare' },                                                 // 16 NP / 51 total
    { slug: 'cardiovascularassociatesofamerica', name: 'Cardiovascular Associates of America' },           // 16 NP / 93 total
    { slug: 'synergenx', name: 'SynergenX Health' },                                                       // 14 NP / 30 total
    { slug: 'cerebrocare', name: 'Cerebrocare' },                                                          // 8 NP / 13 total
    { slug: 'httpsladgovcomjobopenings', name: 'Ladgov Corporation' },                                     // 8 NP / 626 total
    { slug: 'simedhealth', name: 'SIMEDHealth' },                                                          // 7 NP / 46 total
    { slug: 'aspenmedical', name: 'Aspen Medical' },                                                       // 7 NP / 30 total
    { slug: 'compasspalliativecare', name: 'Compass Palliative Care' },                                    // 6 NP / 18 total
    { slug: 'dmcnh', name: 'DMC Primary Care' },                                                           // 6 NP / 23 total
    { slug: 'msaphy', name: 'Bayview Physicians Group' },                                                  // 6 NP / 61 total
    { slug: 'goodsidehealthurgentcareforkids', name: 'Goodside Health / Urgent Care for Kids' },           // 5 NP / 15 total
    { slug: 'qualitycorrectional', name: 'Quality Correctional Care' },                                    // 5 NP / 99 total
    { slug: 'edwardmkennedycommunityhealthcenterinc', name: 'Edward M. Kennedy Community Health Center' }, // 4 NP / 27 total
    { slug: 'laclinicadefamiliainc', name: 'La Clinica de Familia' },                                      // 4 NP / 59 total
    { slug: 'legacycommunityhealth', name: 'Legacy Community Health' },                                    // 4 NP / 98 total
    { slug: 'proactivemd', name: 'Proactive MD' },                                                         // 4 NP / 25 total
    { slug: 'cortextbi', name: 'Cortex TBI' },                                                             // 3 NP / 10 total
    { slug: 'gastrocarepartners', name: 'Gastro Care Partners' },                                          // 3 NP / 3 total
    { slug: 'novellainfusion', name: 'Novella Infusion' },                                                 // 3 NP / 13 total
    { slug: 'removery', name: 'Removery' },                                                                // 3 NP / 14 total
    { slug: 'spectrummanagementservicescompany', name: 'Spectrum Healthcare Partners' },                   // 3 NP / 23 total
    { slug: 'ansiblegovernmentsolutions', name: 'Ansible Government Solutions' },                          // 2 NP / 282 total
    { slug: 'availhealth', name: 'Avail Health' },                                                         // 2 NP / 3 total
    { slug: 'bhchpjobs', name: 'Boston Health Care for the Homeless Program' },                            // 2 NP / 35 total
    { slug: 'crossroadshospice', name: 'Crossroads Hospice & Palliative Care' },                           // 2 NP / 26 total
    { slug: 'fairhavencommunityhealthcare', name: 'Fair Haven Community Health Care' },                    // 2 NP / 17 total
    { slug: 'firstchoicechc', name: 'First Choice Community Health Centers' },                             // 2 NP / 36 total
    { slug: 'franklinmedicalcenter', name: 'Franklin Medical Center' },                                    // 2 NP / 24 total
    { slug: 'herahealth', name: 'Hera Women\'s Health' },                                                  // 2 NP / 16 total
    { slug: 'lilachealth', name: 'Lilac Health' },                                                         // 2 NP / 4 total
    { slug: 'middletonfamilymedicineurgentcarellc', name: 'MFM Health' },                                  // 2 NP / 13 total
    { slug: 'nanahealthcare', name: 'NANA Healthcare Management' },                                        // 2 NP / 36 total
    { slug: 'youareaccountable', name: 'You Are Accountable' },                                            // 2 NP / 6 total
    { slug: 'getbastion', name: 'Bastion Health' },                                                        // 1 NP / 3 total
    { slug: 'herenowhealth', name: 'Here Now Health' },                                                    // 1 NP / 5 total
    { slug: 'inpatientpsychsolutions', name: 'Integrated Psych Solutions' },                               // 1 NP / 27 total
    { slug: 'mdperm', name: 'MDPerm' },                                                                    // 1 NP / 53 total
    { slug: 'missionareahealthassociates', name: 'Mission Neighborhood Health Center' },                   // 1 NP / 11 total
    { slug: 'northkeycommunitycare', name: 'NorthKey Community Care' },                                    // 1 NP / 20 total
    { slug: 'pediatricsondemand', name: 'Pediatrics On Demand' },                                          // 1 NP / 19 total
    { slug: 'princetonmedspapartners', name: 'Princeton MedSpa Partners' },                                // 1 NP / 5 total
    { slug: 'ramphealth', name: 'Ramp Health' },                                                           // 1 NP / 59 total
    { slug: 'resolvepainsolutions', name: 'Resolve Pain Solutions' },                                      // 1 NP / 15 total
    { slug: 'totalcareconnect', name: 'Total Care Connect' },                                              // 1 NP / 2 total
    { slug: 'troyregionalmedicalcenter', name: 'Troy Regional Medical Center' },                           // 1 NP / 14 total
    { slug: 'vitabella', name: 'Vita Bella' },                                                             // 1 NP / 5 total
];

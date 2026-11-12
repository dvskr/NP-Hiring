/**
 * Greenhouse tenant config — slugs + display names.
 *
 * Trimmed 2026-05-05 from 63 → 50 slugs based on a 180-day production
 * audit. Slugs that hadn't added a single PMHNP job in 6 months were
 * dropped to cut compute (greenhouse fetches were 86k/wk for 47 adds —
 * 0.054% pass rate). The 50 keepers all had ≥1 hit in last 180d.
 *
 * If a dropped slug starts producing again later, add it back here.
 *
 * Slug appears in greenhouse URLs:
 *   https://job-boards.greenhouse.io/{slug}/jobs/{id}
 *
 * The name override (`GREENHOUSE_NAMES`) is optional — if missing, the
 * adapter title-cases the slug.
 */

export const GREENHOUSE_SLUGS: readonly string[] = [
    // ── HIGH PRODUCERS (≥10 jobs/180d) ──
    'blueskytelepsych',                       // 200/180d, last 2026-05-01
    'talkspacepsychiatry',                    // 51/180d, last 2026-03-27
    'blackbirdhealth',                        // 21/180d, last 2026-05-05
    'betterhelp',                             // 20/180d, last 2026-04-30
    'solmentalhealth',                        // 17/180d, last 2026-04-30
    'moodhealth',                             // 13/180d, last 2026-04-11
    'compasspathways',                        // ~10+ via externalId pattern
    'onemedical',                             // ~10 via externalId pattern
    'ascendhealthcare',                       // 10/180d, last 2026-04-29

    // ── MID PRODUCERS (4–9 jobs/180d) ──
    'tia',                                    // 9/180d, last 2026-05-02
    'ennoblecare',                            // 7/180d, last 2026-04-29
    'hellobackpack',                          // 6/180d, last 2026-03-12
    'firsthand',                              // 5/180d, last 2026-03-21
    'compasshealthcenter',                    // 5/180d, last 2026-04-29
    'guidelighthealth',                       // 4/180d, last 2026-04-30
    'akidolabs',                              // 4/180d, last 2026-04-29
    'cloverhealth',                           // 4/180d, last 2026-02-14
    'strivehealth',                           // 4/180d, last 2026-03-25
    'northpointrecoveryholdingsllc',          // 4/180d, last 2026-04-10
    'charliehealth',                          // ~4 via externalId pattern

    // ── LOW PRODUCERS (1–3 jobs/180d) — kept for coverage ──
    'amaehealth',                             // 3/180d
    'mentalhealthcenterofdenver',             // 3/180d
    'aspirehealthalliance',                   // 2/180d
    'overstoryhealth',                        // 1/180d
    'oshihealth',                             // 1/180d
    'folxhealth',                             // 1/180d
    'nursing',                                // 1/180d
    'hopscotchprimarycare',                   // 1/180d
    'thejanepauleycommunityhealthcenterinc',  // 1/180d
    'welbehealth',                            // 1/180d
    'dianahealth94',                          // 1/180d
    'bouldercare',                            // 1/180d
    'vailclinicincdbavailhealthhospital',     // 1/180d
    'imaginepediatrics',                      // 1/180d
    'khealthcareers',                         // 1/180d
    'medelitellc',                            // 1/180d
    'valerahealth',                           // 1/180d
    'mantrahealth',                           // 1/180d (last 2025-12-15 — borderline)
    'lonestarcircleofcare',                   // 1/180d
    'pairteam',                               // 1/180d
    'bicyclehealth',                          // ~1 via externalId pattern
    'foresightmentalhealth',                  // ~1 via externalId pattern

    // ── DROPPED 2026-05-05 (no PMHNP adds in last 180d) ──
    // modernhealth, cerebral, twochairs, talkspace, ayahealthcare, amwell,
    // octave, growtherapy, springhealth66, prenuvo, riviamind, skildai-careers,
    // purposemed, silvus-international-opportunites, walleyecapital-external-students
    // If any restart producing, re-add to the list above.

    // ── ADDED 2026-05-12 — prod DB discovery (scripts/discover-ats-tenants-from-db.ts) ──
    // Surfaced from rejected_jobs.applyLink, then live-probed via
    // scripts/probe-greenhouse-smartrecruiters-candidates.ts. Each
    // confirmed HTTP 200 with ≥1 live PMHNP-relevant title at probe.
    'riviamind1',                              // 2 PMHNP / 11 live (110 historical) — replaces dropped 'riviamind'
    'joinaffect',                              // 9 / 33 live
    'familywell',                              // 3 / 12 live
    'telemed2u',                               // 1 / 12 live
    'onepeakmedical',                          // 1 / 22 live
    'psychiatricproviders',                    // 1 / 3 live

    // ── ADDED 2026-05-12 — live boards, monitoring for PMHNP ──
    'mind247',                                 // 5 jobs live / 0 PMHNP at probe (18 historical)
    'eliotcommunityhumanservices',             // 172 jobs live / 0 PMHNP at probe (community MH)

    // === Added 2026-11-12: NP-wide expansion, each verified live ===
    'thegialliancemanagementllccompany',  // 81 NP / 194 total
    'essential',                          // 61 NP / 83 total
    'convenientmd',                       // 56 NP / 378 total
    'oneoncology',                        // 51 NP / 165 total
    'theoriamedical',                     // 29 NP / 67 total
    'ivxhealth',                          // 26 NP / 67 total
    'midihealth',                         // 24 NP / 58 total
    'connectionshealthsolutions',         // 15 NP / 174 total
    'modenaallergyasthma',                // 13 NP / 34 total
    'optimalcare',                        // 8 NP / 41 total
    'optimalcare-evergreen',              // 11 NP / 58 total — separate evergreen board, different postings
    'unitedveincenters',                  // 10 NP / 147 total
    'oscar',                              // 8 NP / 184 total
    'nobleanesthesiapartners',            // 7 NP / 32 total
    'platinumdermpapp',                   // 7 NP / 7 total
    'steadfasthealth',                    // 7 NP / 21 total
    'daymarkhealth',                      // 6 NP / 29 total
    'oulahealth',                         // 6 NP / 18 total
    'praxis-health',                      // 6 NP / 45 total
    'theoncologyinstitute',               // 5 NP / 55 total
    'vitalcaringgroup',                   // 5 NP / 441 total
    'find',                               // 5 NP / 10 total
    'ophelia',                            // 5 NP / 14 total
    'mtccare',                            // 5 NP / 26 total
    'zarminalihealth',                    // 5 NP / 57 total
    'sollishealth',                       // 4 NP / 37 total
    'physiciansandproviders',             // 3 NP / 28 total
    'comprehensivemobilecare',            // 3 NP / 267 total
    'workithealth',                       // 3 NP / 9 total
    'peachy',                             // 3 NP / 4 total
    'neurahealth',                        // 3 NP / 7 total
    'silverado',                          // 2 NP / 146 total
    'aizerhealth',                        // 2 NP / 24 total
    'accompanyhealth',                    // 2 NP / 7 total
    'premiermedical',                     // 2 NP / 9 total
    'centrumhealth',                      // 2 NP / 19 total
    'cadencehealth',                      // 2 NP / 20 total
    'galileo',                            // 2 NP / 11 total
    'southshoreskin',                     // 2 NP / 6 total
    'frontierdermatologyprovidercareers', // 1 NP / 28 total
    'dreemhealth',                        // 1 NP / 7 total
    'sleepdoctor',                        // 1 NP / 4 total
    'wwclinic',                           // 1 NP / 3 total
    'caretalkhealth',                     // 1 NP / 5 total
    'hopeandhealingcliniccareers',        // 1 NP / 3 total
    'equummedical',                       // 1 NP / 10 total
    'upwardhealth',                       // 1 NP / 40 total
    'tuesdayhealth',                      // 1 NP / 16 total
    'usenourish',                         // 1 NP / 97 total
    'twinhealth',                         // 1 NP / 43 total
    'prenuvo',                            // 1 NP / 49 total — re-added (dropped 2026-05-05); US-remote NP contract role
];

export const GREENHOUSE_NAMES: Record<string, string> = {
    // Verified companies
    'talkspace': 'Talkspace',
    'modernhealth': 'Modern Health',
    'cerebral': 'Cerebral',
    'amwell': 'Amwell',
    'ayahealthcare': 'Aya Healthcare',
    'mantrahealth': 'Mantra Health',
    'twochairs': 'Two Chairs',
    'octave': 'Octave',
    'growtherapy': 'Grow Therapy',
    'blueskytelepsych': 'Blue Sky Telepsych',
    'bicyclehealth': 'Bicycle Health',
    'springhealth66': 'Spring Health',
    'omadahealth': 'Omada Health',
    'brave': 'Brave Health',
    'betterhelp': 'BetterHelp',
    'firsthand': 'Firsthand',
    'compasspathways': 'COMPASS Pathways',
    'alma': 'Alma',
    'cortica': 'Cortica',
    'galileo': 'Galileo',
    'amaehealth': 'Amae Health',
    'pelago': 'Pelago',
    'bouldercare': 'Boulder Care',
    'daybreakhealth': 'Daybreak Health',
    'parallellearning': 'Parallel Learning',
    'legion': 'Legion',
    'array': 'Array Behavioral Care',
    'neuroflow': 'NeuroFlow',
    'forgehealth': 'Forge Health',
    'iris': 'Iris',
    'strivehealth': 'Strive Health',
    'medelitellc': 'MedElite LLC',
    'solmentalhealth': 'Sol Mental Health',
    'cloverhealth': 'Clover Health',
    'prenuvo': 'Prenuvo',
    'moodhealth': 'Moodhealth',
    'compasshealthcenter': 'Compass Health Center',
    'onemedical': 'One Medical',
    'ascendhealthcare': 'Ascend Healthcare',
    'lonestarcircleofcare': 'Lone Star Circle of Care',
    'hellobackpack': 'Backpack Healthcare',
    'northpointrecoveryholdingsllc': 'Northpoint Recovery',
    'thejanepauleycommunityhealthcenterinc': 'Jane Pauley Community Health Center',
    'riviamind': 'RIVIA Mind',
    'mentalhealthcenterofdenver': 'Mental Health Center of Denver',
    'overstoryhealth': 'Overstory Health',
    'nursing': 'Nursing Wellness Center',
    'vitalcaringgroup': 'VitalCaring Group',
    'peregrinehealth': 'Peregrine Health',
    'tia': 'Tia',
    'lts': 'LTS',
    'prosperhealth': 'Prosper Health',
    'pma': 'Pathlight Mood & Anxiety',
    'carbon': 'Carbon Health',
    'veterans': 'Veterans Affairs',
    'summit': 'Summit Healthcare',
    'universal': 'Universal Health Services',
    'calm': 'Calm',
    'theoriamedical': 'Theoria Medical',
    'talkspacepsychiatry': 'Talkspace Psychiatry',
    'midihealth': 'Midi Health',
    'luminishealth': 'Luminis Health',
    'ennoblecare': 'Ennoble Care',
    'integrityrehabgroup': 'Integrity Rehab Group',
    'formhealth': 'Form Health',
    'guidelighthealth': 'Guidelight Health',
    'optimalcare': 'Optimal Care',
    'healthlink': 'HealthLink',
    'engageseniortherapy': 'Engage Senior Therapy',
    'pairteam': 'Pair Team',
    'sollishealth': 'Sollis Health',
    'dianahealth94': 'Diana Health',
    'vailclinicincdbavailhealthhospital': 'Vail Health Hospital',
    'axisteletherapy': 'Axis Teletherapy',
    'folxhealth': 'FOLX Health',
    'neurahealth': 'Neura Health',
    'centrumhealth': 'Centrum Health',
    'reemahealth': 'Reema Health',
    'welbehealth': 'Welbe Health',
    'blackbirdhealth': 'Blackbird Health',
    'akidolabs': 'Akido Labs',
    'oshihealth': 'Oshi Health',
    'hopscotchprimarycare': 'Hopscotch Primary Care',
    'imaginepediatrics': 'Imagine Pediatrics',
    'khealthcareers': 'K Health',
    'valerahealth': 'Valera Health',
    'charliehealth': 'Charlie Health',
    'foresightmentalhealth': 'Foresight Mental Health',

    // Added 2026-05-12 — prod DB discovery
    'riviamind1': 'Rivia Mind',
    'joinaffect': 'Affect',
    'familywell': 'FamilyWell',
    'telemed2u': 'TeleMed2U',
    'onepeakmedical': 'OnePeak Medical',
    'psychiatricproviders': 'WellPower',
    'mind247': 'MIND 24-7',
    'eliotcommunityhumanservices': 'Eliot Community Human Services',

    // === Added 2026-11-12: NP-wide expansion, each verified live ===
    'thegialliancemanagementllccompany': 'The Specialty Alliance (GI Alliance)',
    'essential': 'Essential Anesthesia Management',
    'convenientmd': 'ConvenientMD',
    'oneoncology': 'OneOncology',
    'ivxhealth': 'IVX Health',
    'connectionshealthsolutions': 'Connections Health Solutions',
    'modenaallergyasthma': 'Modena Allergy + Asthma',
    'optimalcare-evergreen': 'Optimal Care',
    'unitedveincenters': 'United Vein & Vascular Centers',
    'oscar': 'Oscar Health',
    'nobleanesthesiapartners': 'AAC Southwest (Noble Anesthesia Partners)',
    'platinumdermpapp': 'Platinum Dermatology Partners',
    'steadfasthealth': 'Steadfast Health',
    'daymarkhealth': 'Daymark Health',
    'oulahealth': 'Oula',
    'praxis-health': 'Praxis Health',
    'theoncologyinstitute': 'Starling Oncology',
    'find': 'FIND Healthcareers',
    'ophelia': 'Ophelia',
    'mtccare': 'MTC Care',
    'zarminalihealth': 'Zarminali Pediatrics',
    'physiciansandproviders': 'Optima Dermatology',
    'comprehensivemobilecare': 'Comprehensive Mobile Care',
    'workithealth': 'Workit Health',
    'peachy': 'Peachy',
    'silverado': 'Silverado',
    'aizerhealth': 'Aizer Health',
    'accompanyhealth': 'Accompany Health',
    'premiermedical': 'Premier Medical',
    'cadencehealth': 'Cadence',
    'southshoreskin': 'South Shore Skin Center',
    'frontierdermatologyprovidercareers': 'Frontier Dermatology',
    'dreemhealth': 'Dreem Health',
    'sleepdoctor': 'Sleep Doctor',
    'wwclinic': 'Weight Watchers Med+',
    'caretalkhealth': 'CareTalk Health',
    'hopeandhealingcliniccareers': 'Hope and Healing Clinic',
    'equummedical': 'Equum Medical',
    'upwardhealth': 'Upward Health',
    'tuesdayhealth': 'Tuesday Health',
    'usenourish': 'Nourish',
    'twinhealth': 'Twin Health',
};

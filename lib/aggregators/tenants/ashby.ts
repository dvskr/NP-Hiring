/**
 * Ashby tenant config — org slugs + display names.
 *
 * Endpoint shape:
 *   https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 *
 * Public unauthenticated API. No key required.
 *
 * Seeded 2026-05-12 from scripts/discover-ashby-tenants.ts. The probe
 * ran 68 candidate healthcare/mental-health slugs and these were the
 * ones with a live Ashby board AND ≥1 PMHNP-relevant title at probe
 * time. Re-run the discovery script whenever adding new slugs.
 */

export interface AshbyTenant {
    slug: string;
    name: string;
}

export const ASHBY_TENANTS: readonly AshbyTenant[] = [
    // ── CONFIRMED PMHNP PRODUCERS (probe 2026-05-12) ──
    { slug: 'bravehealth', name: 'Brave Health' },           // 3 PMHNP / 26 total
    { slug: 'equip', name: 'Equip Health' },                  // 4 NP-eating-disorder roles / 38 total

    // ── ADDED 2026-05-12 — prod DB discovery (scripts/discover-ats-tenants-from-db.ts) ──
    // Slugs surfaced from rejected_jobs.applyLink, then live-probed via
    // scripts/probe-ashby-candidates.ts. All confirmed responding 200
    // with ≥1 PMHNP-relevant title at probe time.
    { slug: 'sondermind', name: 'SonderMind' },              // 46/147 — biggest catch; migrated off Greenhouse
    { slug: 'talkiatry', name: 'Talkiatry' },                // 53/176 — migrated off Lever
    { slug: 'reklamehealth', name: 'Reklame Health' },       // 3/6
    { slug: 'legionhealth', name: 'Legion Health' },         // 3/9
    { slug: 'claritypediatrics', name: 'Clarity Pediatrics' },// 2/11
    { slug: 'blossom-health', name: 'Blossom Health' },      // 1/16
    { slug: 'salma-health', name: 'Salma Health' },          // 2/14
    { slug: 'hellobrightline', name: 'Brightline' },         // 3/24
    { slug: 'third-space-therapy', name: 'Third Space Therapy' }, // 2/26
    { slug: 'sunflower-sober', name: 'Sunflower Sober' },    // 1/2

    // ── LIVE BOARD, MONITORING for PMHNP ──
    // Mental-health focused boards with active postings but 0 PMHNP at
    // probe time. Worth scanning each cron so we catch PMHNP postings
    // the day they go up.
    { slug: 'rula', name: 'Rula Health' },                    // 27 total / 0 PMHNP at probe
    { slug: 'array-behavioral-care', name: 'Array Behavioral Care' }, // 30 total / 0 PMHNP at probe

    // === Added 2026-11-12: NP-wide expansion, each verified live ===
    { slug: 'allarahealth', name: 'Allara Health' },                      // 95 NP / 437 total
    { slug: 'pomelo-care', name: 'Pomelo Care' },                         // 16 NP / 95 total
    { slug: 'neko-health', name: 'Neko Health' },                         // 5 NP / 128 total — Swedish parent; NP roles are at US clinics
    { slug: 'matter-health', name: 'Matter Health' },                     // 4 NP / 21 total
    { slug: 'nest-health', name: 'Nest Health' },                         // 3 NP / 8 total
    { slug: 'thyme-care', name: 'Thyme Care' },                           // 3 NP / 45 total
    { slug: 'vanna-health-inc', name: 'Vanna Health' },                   // 3 NP / 13 total
    { slug: 'baba', name: 'Baba' },                                       // 3 NP / 13 total
    { slug: 'brunswick', name: 'Sevaro' },                                // 2 NP / 7 total
    { slug: 'tembo-health', name: 'Tembo Health' },                       // 2 NP / 4 total
    { slug: 'proterahealth', name: 'Protera Health' },                    // 2 NP / 5 total
    { slug: 'vynca', name: 'Vynca' },                                     // 2 NP / 42 total
    { slug: 'superpower', name: 'Superpower' },                           // 2 NP / 29 total
    { slug: 'blueberrypediatrics', name: 'Blueberry Pediatrics' },        // 2 NP / 9 total
    { slug: 'ayblehealth', name: 'Ayble Health' },                        // 1 NP / 3 total
    { slug: 'general-medicine', name: 'General Medicine' },               // 1 NP / 15 total
    { slug: 'goldenscript', name: 'GoldenScript' },                       // 1 NP / 1 total
    { slug: 'haven-headache', name: 'Haven Headache & Migraine Center' }, // 1 NP / 1 total
    { slug: 'knownwell', name: 'knownwell' },                             // 1 NP / 8 total
    { slug: 'nabihealth', name: 'Nabi' },                                 // 1 NP / 40 total
    { slug: 'niramedical', name: 'Nira Medical' },                        // 1 NP / 16 total
    { slug: 'sprinter-health', name: 'Sprinter Health' },                 // 1 NP / 68 total
    { slug: 'summerhealth', name: 'Summer Health' },                      // 1 NP / 2 total
    { slug: 'you-health', name: 'You Health' },                           // 1 NP / 2 total
];

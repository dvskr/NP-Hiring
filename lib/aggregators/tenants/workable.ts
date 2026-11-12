/**
 * Workable tenant config.
 *
 * Endpoint:
 *   POST https://apply.workable.com/api/v2/accounts/{slug}/jobs
 *   body: {"query":"","department":[],"location":[],"remote":[]}
 *
 * Response: { total, results: [...] }
 *
 * Public, unauthenticated. The `total` field is page-relative — pages
 * use `?limit=N&offset=N` query params on the same POST URL.
 *
 * Seeded 2026-05-12 from prod DB discovery. Many of the slugs in the
 * scan had 0 current PMHNP titles but were live boards with mental-
 * health-adjacent inventory — worth monitoring.
 */

export interface WorkableTenant {
    slug: string;
    name: string;
}

export const WORKABLE_TENANTS: readonly WorkableTenant[] = [
    // ── KNOWN PMHNP-positive at probe ──
    // The 'jobs' slug in discovery (5,385 historical PMHNP) is NOT a real
    // Workable account — it was an artifact of URL parsing the apply
    // path. The real slug is `greenlife-healthcare-staffing-1`.
    { slug: 'greenlife-healthcare-staffing-1', name: 'Greenlife Healthcare Staffing' },

    // ── LIVE BOARDS, MONITORING for PMHNP ──
    { slug: 'gotham-enterprises', name: 'Gotham Enterprises' },
    { slug: 'mental-health-association-western-ma', name: 'Mental Health Association Western MA' },
    { slug: 'advantmed', name: 'Advantmed' },
    { slug: 'mrg-exams', name: 'MRG Exams' },
    { slug: 'advisacare-2', name: 'AdvisaCare' },
    { slug: 'atria-health', name: 'Atria Physician Practice' },
    { slug: 'lifemdcareers', name: 'LifeMD' },
    { slug: 'firefly-health', name: 'Firefly Health' },

    // === Added 2026-11-12: NP-wide expansion, each verified live ===
    { slug: 'commonwealth-medical-services', name: 'Commonwealth Medical Services' }, // 139 NP / 890 total — NP count is a lower bound (473 of 890 read)
    { slug: 'integrated-wound-care-1', name: 'Integrated Wound Care' },               // 33 NP / 34 total
    { slug: 'summit-healthcare-staffing', name: 'Summit Healthcare Staffing' },       // 4 NP / 25 total
    { slug: 'denis-development', name: 'Denis Development' },                         // 4 NP / 22 total
];

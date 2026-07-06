/**
 * Pure category-tag classifier.
 *
 * Why this exists: pre-P9, taxonomy×city and taxonomy×state pages used
 * `OR title.contains 'X' OR description.contains 'X'` matchers at QUERY
 * time. A typical ${brand.niche.short} description mentions "behavioral health",
 * "outpatient", "community health", and "mental health" all at once, so
 * the same job appeared on 4–5 different taxonomy pages with near-
 * identical chrome. Google's quality model flags this as duplicate.
 *
 * The fix: classify each job ONCE (at ingest, plus a one-shot backfill
 * for existing rows) into a precomputed `Job.categoryTags` array, then
 * query with `categoryTags: { has: 'X' }` — exact match, no false
 * positives, no cross-taxonomy bleed.
 *
 * This function is the single source of truth for tag derivation.
 * Callers:
 *   - lib/job-normalizer.ts (ingest path, every external job)
 *   - app/api/jobs/route.ts via post-job submit (employer-posted jobs)
 *   - scripts/backfill-category-tags.ts (one-shot for existing rows)
 *
 * Pure function. No DB access. Easy to unit-test.
 *
 * ── NP HIRING (2026-07) ──────────────────────────────────────────────
 * Rules migrated from the donor PMHNP tag set (29 slugs) to this board's
 * 42-slug all-NP taxonomy (lib/pseo/taxonomy-registry.ts). Carried-over
 * slugs (settings, job types, experience, employer types, populations)
 * keep their donor-proven rules; the 14 NP specialties + 3 APRN roles
 * are new, title-anchored rules built from the config/niche/relevance.ts
 * NP vocabulary. Dropped donor slugs: addiction, substance-abuse,
 * child-adolescent, behavioral-health, crisis (their roles fold into
 * psychiatric-mental-health on this board).
 *
 * WORD-BOUNDARY CONVENTION (engine note): matching is still substring-
 * based, but the haystack is padded with one leading + trailing space,
 * so short credential abbreviations use the space/punctuation-padded
 * forms from config/niche/relevance.ts (' fnp', '(crna', '/cnm', …).
 * A bare short token like 'prn' or 'cns' is NEVER safe ('aprn',
 * "CNS depressants") — always anchor it on at least one side.
 */

export interface ClassifiableJob {
    title: string;
    description?: string | null;
    descriptionSummary?: string | null;
    jobType?: string | null;
    isRemote?: boolean | null;
    setting?: string | null;        // populated for employer-posted jobs
    population?: string | null;     // populated for employer-posted jobs
}

/**
 * All canonical category slugs the classifier can emit — the 42-slug NP
 * taxonomy, in axis order (must stay in sync with CATEGORY_AXES in
 * lib/pseo/taxonomy-registry.ts; tests/pseo/category-tagger.test.ts
 * enforces set-equality). Order matters twice: returned tags are stored
 * in this order (stable Postgres text[] diffs), and the second-pass
 * mutual-exclusion loop walks it top-to-bottom.
 */
export const CANONICAL_CATEGORY_SLUGS = [
    // Settings / modality
    'remote', 'telehealth', 'inpatient', 'outpatient', 'travel',
    'urgent-care', 'home-health',
    // Job types
    'full-time', 'part-time', 'contract', 'per-diem', 'locum-tenens', '1099',
    // NP specialties
    'family-practice', 'adult-gerontology', 'pediatric', 'neonatal',
    'women-health', 'acute-care', 'emergency', 'psychiatric-mental-health',
    'oncology', 'cardiology', 'primary-care', 'hospitalist',
    'dermatology', 'orthopedic',
    // APRN cohort (CRNA / CNM / CNS)
    'anesthesia', 'midwifery', 'clinical-nurse-specialist',
    // Experience
    'entry-level', 'new-grad', 'mid-career', 'senior',
    // Employer types
    'hospital', 'private-practice', 'community-health', 'va', 'correctional',
    // Populations
    'geriatric', 'veterans', 'lgbtq',
] as const;

export type CategoryTag = typeof CANONICAL_CATEGORY_SLUGS[number];

/**
 * Substring rules per category, applied case-insensitively against title +
 * description. Keep these tightly scoped — broader matchers re-introduce
 * the duplication problem this whole feature fixes.
 *
 * Rule of thumb: title-only patterns are highest quality. Description-only
 * patterns should be obvious enough that no false positives slip in
 * (e.g. "FQHC" is unambiguous; "community" alone would over-tag).
 */
interface CategoryRule {
    /** Case-insensitive substrings — match if ANY appears in title or description. */
    keywords: string[];
    /** If true, also accept matches anywhere in description. Default true. */
    matchDescription?: boolean;
    /** Direct conditions on structured fields (highest priority — bypass keyword scan). */
    structural?: (job: ClassifiableJob) => boolean;
    /**
     * Mutual-exclusion list. If the job already qualified for any of these
     * categories, do NOT also tag this one. Used to break cross-taxonomy
     * duplication (e.g. inpatient excludes outpatient/private-practice).
     */
    excludeIfAlsoTagged?: CategoryTag[];
}

const RULES: Partial<Record<CategoryTag, CategoryRule>> = {
    // ── Settings (mutually exclusive in spirit: a job is one of these) ──
    inpatient: {
        keywords: ['inpatient', 'in-patient', 'acute care', 'acute psych', 'crisis stabilization', 'inpatient unit'],
        matchDescription: false, // title-only — description noise is rampant
    },
    outpatient: {
        keywords: ['outpatient', 'out-patient', 'community mental health'],
        matchDescription: false,
        excludeIfAlsoTagged: ['inpatient'],
    },
    'urgent-care': {
        keywords: ['urgent care', 'walk-in clinic', 'immediate care'],
        matchDescription: false,
    },
    'home-health': {
        keywords: ['home health', 'home-based', 'house call', 'house-call', 'home visit', 'in-home'],
        matchDescription: false,
    },
    'private-practice': {
        keywords: ['private practice', 'group practice', 'solo practice', 'independent practice'],
        matchDescription: false,
        excludeIfAlsoTagged: ['inpatient', 'hospital'],
    },
    hospital: {
        keywords: ['hospital', 'medical center', 'health system'],
        matchDescription: false,
        // 'hospitalist' contains 'hospital' as a substring — without the
        // exclusion every hospitalist role would double-tag the hospital
        // employer page (P9 sibling-duplication lesson).
        excludeIfAlsoTagged: ['outpatient', 'private-practice', 'hospitalist'],
    },
    'community-health': {
        keywords: ['FQHC', 'federally qualified health center', 'community health center'],
        matchDescription: true, // FQHC etc. are unambiguous in description
    },
    va: {
        keywords: ['VA medical center', 'veterans affairs', 'department of veterans', 'VHA'],
        matchDescription: true,
    },
    correctional: {
        keywords: ['correctional', 'corrections', 'prison', 'forensic', 'jail', 'detention', 'incarcerat'],
        matchDescription: false,
    },

    // ── Modality (job can simultaneously be remote AND telehealth) ──
    remote: {
        keywords: ['remote', 'work from home', 'WFH'],
        structural: (j) => j.isRemote === true,
    },
    telehealth: {
        keywords: ['telehealth', 'telemedicine', 'telepsychiatry', 'telepsych', 'virtual care'],
        matchDescription: false,
    },
    travel: {
        keywords: ['travel position', 'travel assignment', 'travel nurse practitioner', 'travel np', 'travel crna'],
        matchDescription: false,
    },

    // ── Job type (mutually exclusive in spirit) ──
    'full-time': {
        keywords: ['full-time', 'full time'],
        structural: (j) =>
            (j.jobType || '').toLowerCase().includes('full'),
    },
    'part-time': {
        keywords: ['part-time', 'part time'],
        structural: (j) =>
            (j.jobType || '').toLowerCase().includes('part'),
        excludeIfAlsoTagged: ['full-time'],
    },
    contract: {
        keywords: ['contract position', 'temp-to-perm', 'temporary assignment'],
        structural: (j) =>
            (j.jobType || '').toLowerCase().includes('contract'),
    },
    'per-diem': {
        // 'PRN' must stay boundary-anchored: bare 'prn' is a substring of
        // 'APRN', which appears in virtually every posting on this board.
        keywords: ['per diem', 'per-diem', ' prn', '(prn', '/prn', '-prn'],
        structural: (j) =>
            (j.jobType || '').toLowerCase().includes('per diem'),
    },
    'locum-tenens': {
        keywords: ['locum tenens', 'locums'],
    },
    '1099': {
        keywords: ['1099', 'independent contractor', 'IC position'],
        matchDescription: true,
    },

    // ── NP specialties (title-anchored — precision over recall) ──
    'family-practice': {
        keywords: [
            'family nurse practitioner', 'family practice', 'family medicine', 'family np',
            ' fnp', '(fnp', '/fnp', '-fnp',
        ],
        matchDescription: false,
    },
    'adult-gerontology': {
        keywords: [
            'adult-gerontology', 'adult gerontology', 'gerontological', 'adult nurse practitioner',
            ' agnp', '(agnp', '/agnp', ' agpcnp', '(agpcnp', ' agacnp', '(agacnp',
        ],
        matchDescription: false,
    },
    pediatric: {
        keywords: [
            'pediatric', 'paediatric', 'peds np',
            ' pnp', '(pnp', '/pnp', 'cpnp',
        ],
        matchDescription: false,
        // "Pediatric Psychiatric NP" / "Pediatric Mental Health NP" belong
        // to the psych page (donor child-adolescent lineage); combo
        // "Neonatal/Pediatric NP" titles belong to the more specific
        // neonatal page. One winner per sibling pair (P9 lesson).
        excludeIfAlsoTagged: ['psychiatric-mental-health', 'neonatal'],
    },
    neonatal: {
        keywords: [
            'neonatal', ' nicu', '(nicu', '/nicu',
            ' nnp', '(nnp', '/nnp',
        ],
        matchDescription: false,
    },
    'women-health': {
        keywords: [
            "women's health", 'womens health', 'women’s health', 'obstetric',
            'ob/gyn', 'obgyn', 'ob-gyn',
            ' whnp', '(whnp', '/whnp',
        ],
        matchDescription: false,
    },
    'acute-care': {
        keywords: [
            // Leading-space anchor keeps ' icu' from matching NICU/PICU.
            'acute care', 'critical care', 'intensive care', ' icu', '(icu', '/icu',
            ' acnp', '(acnp', '/acnp',
        ],
        matchDescription: false,
    },
    emergency: {
        keywords: [
            'emergency', ' er np', ' enp', '(enp', '/enp',
        ],
        matchDescription: false,
        // Psychiatric emergency services / psych-ED roles read as psych
        // jobs, not ER jobs — keep them off the emergency page.
        excludeIfAlsoTagged: ['psychiatric-mental-health'],
    },
    'psychiatric-mental-health': {
        keywords: [
            'pmhnp', 'psychiatric', 'psychiatry', 'psych np', 'psych nurse practitioner',
            'mental health nurse practitioner', 'mental health np',
            'behavioral health nurse practitioner', 'behavioral health np',
        ],
        matchDescription: false,
    },
    oncology: {
        keywords: ['oncology', 'oncologic', 'hematology'],
        matchDescription: false,
    },
    cardiology: {
        keywords: ['cardiology', 'cardiovascular', 'cardiac', 'heart failure', 'electrophysiology'],
        matchDescription: false,
    },
    'primary-care': {
        keywords: ['primary care', 'internal medicine'],
        matchDescription: false,
        // "FNP - Primary Care" style titles land on the more specific
        // family-practice page only.
        excludeIfAlsoTagged: ['family-practice'],
    },
    hospitalist: {
        keywords: ['hospitalist', 'inpatient medicine'],
        matchDescription: false,
    },
    dermatology: {
        keywords: ['dermatology', 'dermatologic', ' derm '],
        matchDescription: false,
    },
    orthopedic: {
        keywords: ['orthopedic', 'orthopaedic', ' ortho '],
        matchDescription: false,
    },

    // ── APRN cohort ──
    anesthesia: {
        keywords: ['nurse anesthetist', 'anesthesia', 'anesthetist', ' crna', '(crna', '/crna'],
        matchDescription: false,
    },
    midwifery: {
        keywords: ['midwife', 'midwifery', ' cnm', '(cnm', '/cnm'],
        matchDescription: false,
    },
    'clinical-nurse-specialist': {
        // Title-only + anchored: bare 'cns' collides with "CNS depressants/
        // stimulants" vocabulary in psych descriptions (relevance-pack lesson).
        keywords: ['clinical nurse specialist', ' cns ', ' cns,', ' cns-', '(cns', '/cns'],
        matchDescription: false,
    },

    // ── Experience tier (mutually exclusive) ──
    'new-grad': {
        keywords: ['new grad', 'new graduate', 'recent graduate', 'fellowship', 'residency'],
        matchDescription: false,
    },
    'entry-level': {
        keywords: ['entry level', 'entry-level'],
        matchDescription: false,
        excludeIfAlsoTagged: ['new-grad'], // new-grad is the canonical tag; entry-level is its alias
    },
    senior: {
        keywords: [
            'senior nurse practitioner', 'senior np', 'senior aprn',
            'lead nurse practitioner', 'lead np', 'clinical lead', 'clinical leader',
            'np supervisor', 'nurse practitioner supervisor', 'aprn supervisor',
            'medical director', 'clinical director', 'program director', 'clinic director',
        ],
        matchDescription: false,
    },
    'mid-career': {
        keywords: ['experienced', 'lead clinician'],
        matchDescription: false,
        excludeIfAlsoTagged: ['senior', 'new-grad'], // mid-career is the leftover after senior + new-grad
    },

    // ── Populations ──
    geriatric: {
        keywords: ['geriatric', 'geropsych', 'elderly', 'senior living', 'nursing home'],
        matchDescription: false,
    },
    lgbtq: {
        keywords: ['LGBTQ', 'transgender', 'gender-affirming', 'gender affirming', 'gender identity', 'affirming care'],
        matchDescription: true,
    },
    veterans: {
        keywords: ['veterans', 'PTSD', 'military mental health'],
        matchDescription: true,
        excludeIfAlsoTagged: ['va'], // VA is more specific than generic "veterans"
    },
};

function matchesKeyword(haystack: string, keyword: string): boolean {
    return haystack.toLowerCase().includes(keyword.toLowerCase());
}

/**
 * Classify a job into the set of category tags it qualifies for.
 *
 * Determinism: same input → same output. Order of returned tags follows
 * CANONICAL_CATEGORY_SLUGS for stability across runs (the array is
 * stored in Postgres `text[]` and we don't want spurious diffs).
 *
 * Mutual exclusion is applied in slug order — if a category lists
 * `excludeIfAlsoTagged: ['inpatient']`, the rule fires only after the
 * `inpatient` rule has already been evaluated.
 */
export function classifyJobTags(job: ClassifiableJob): CategoryTag[] {
    const title = job.title || '';
    const description = job.description || job.descriptionSummary || '';
    const titleLower = title.toLowerCase();
    const descLower = description.toLowerCase();

    const tagged = new Set<CategoryTag>();

    // First pass: structural + keyword rules, no exclusion logic yet.
    for (const slug of CANONICAL_CATEGORY_SLUGS) {
        const rule = RULES[slug];
        if (!rule) continue;

        // Structural fast path — overrides keyword scan when truthy.
        if (rule.structural?.(job)) {
            tagged.add(slug);
            continue;
        }

        const matchDesc = rule.matchDescription !== false;
        // Space-pad the haystack so space-anchored abbreviation keywords
        // (' fnp', ' prn', ' cns ') also match at title start/end.
        const haystack = matchDesc
            ? ` ${titleLower} ${descLower} `
            : ` ${titleLower} `;
        for (const kw of rule.keywords) {
            if (matchesKeyword(haystack, kw)) {
                tagged.add(slug);
                break;
            }
        }
    }

    // Second pass: apply mutual-exclusion rules. Iterate in slug order so
    // earlier-priority categories win.
    for (const slug of CANONICAL_CATEGORY_SLUGS) {
        if (!tagged.has(slug)) continue;
        const rule = RULES[slug];
        if (!rule?.excludeIfAlsoTagged) continue;
        if (rule.excludeIfAlsoTagged.some((other) => tagged.has(other))) {
            tagged.delete(slug);
        }
    }

    // Return tags in canonical order for stable storage.
    return CANONICAL_CATEGORY_SLUGS.filter((s) => tagged.has(s));
}

/**
 * Build a Prisma WHERE fragment that matches via the legacy keyword OR
 * matchers. Used as the backward-compat fallback for buildWhere callers
 * during the deploy → backfill window: rows with empty `categoryTags`
 * (i.e. not yet backfilled) still render correctly.
 *
 * Once `scripts/backfill-category-tags.ts --apply` has populated every
 * row, this fallback is dead code and can be removed in a follow-up PR.
 *
 * Note: the classifier's `excludeIfAlsoTagged` mutual-exclusion isn't
 * replicable at query time — pre-backfill pages may slightly over-match
 * across taxonomies, but that's strictly better than rendering empty
 * during the gap. Post-backfill, the precomputed tags enforce exclusion.
 *
 * Space-anchored keywords (' fnp', '(crna', …) under-match at query time
 * (Prisma `contains` can't see the classifier's haystack padding) — also
 * acceptable for the same reason: the fallback arm only exists for
 * not-yet-backfilled rows.
 */
function legacyKeywordOr(tag: CategoryTag): Record<string, unknown>[] {
    const rule = RULES[tag];
    if (!rule) return [];
    const matchDesc = rule.matchDescription !== false;
    return rule.keywords.flatMap((kw) =>
        matchDesc
            ? [
                { title: { contains: kw, mode: 'insensitive' } },
                { description: { contains: kw, mode: 'insensitive' } },
            ]
            : [{ title: { contains: kw, mode: 'insensitive' } }],
    );
}

/**
 * Returns a Prisma WHERE fragment to spread into a buildWhere result.
 * The fragment matches:
 *   • rows with `categoryTags has '<tag>'` (post-backfill, primary path), OR
 *   • rows with empty `categoryTags` AND any legacy keyword/structural match
 *     (pre-backfill fallback so pages don't render empty during the deploy
 *      window).
 *
 * Usage:
 *   buildWhere: (stateName) => ({
 *     isPublished: true,
 *     state: { equals: stateName, mode: 'insensitive' },
 *     ...withTagFallback('remote'),
 *   })
 */
export function withTagFallback(tag: CategoryTag): Record<string, unknown> {
    const rule = RULES[tag];
    const legacyConditions: Record<string, unknown>[] = [];
    // Legacy keyword matchers (title + optionally description).
    const kw = legacyKeywordOr(tag);
    if (kw.length > 0) legacyConditions.push({ OR: kw });
    // Structural fallbacks for tags whose primary classifier signal is a
    // structured field (e.g. remote → isRemote=true; full-time → jobType
    // contains 'Full'). These are the only legacy conditions we can express
    // in a Prisma where without re-running the classifier per row.
    if (tag === 'remote') legacyConditions.push({ isRemote: true });
    if (tag === 'full-time') legacyConditions.push({ jobType: { contains: 'Full', mode: 'insensitive' } });
    if (tag === 'part-time') legacyConditions.push({ jobType: { contains: 'Part', mode: 'insensitive' } });
    if (tag === 'contract') legacyConditions.push({ jobType: { contains: 'Contract', mode: 'insensitive' } });
    if (tag === 'per-diem') legacyConditions.push({ jobType: { contains: 'Per Diem', mode: 'insensitive' } });

    // Suppress unused warning for `rule` if classifier rule is missing for
    // an exotic tag — we still emit a tag-only path so post-backfill works.
    void rule;

    return {
        OR: [
            { categoryTags: { has: tag } },
            ...(legacyConditions.length > 0
                ? [{
                    AND: [
                        { categoryTags: { isEmpty: true } },
                        ...(legacyConditions.length === 1
                            ? legacyConditions
                            : [{ OR: legacyConditions }]),
                    ],
                }]
                : []),
        ],
    };
}

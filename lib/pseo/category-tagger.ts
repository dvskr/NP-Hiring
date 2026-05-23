/**
 * Pure category-tag classifier — NP / APRN broad cohort.
 *
 * Forked from the PMHNP-only taxonomy (2026-05-23) and broadened to cover
 * the full Nurse Practitioner specialty landscape plus the APRN cohort
 * (CRNA, CNM, CNS).
 *
 * Why this exists: pSEO taxonomy×city and taxonomy×state pages used
 * `OR title.contains 'X' OR description.contains 'X'` at QUERY time. A
 * typical NP description mentions multiple settings + populations, so
 * the same job appeared on 4–5 different taxonomy pages with near-
 * identical chrome. Google's quality model flags this as duplicate.
 *
 * The fix: classify each job ONCE (at ingest, plus a one-shot backfill
 * for existing rows) into a precomputed `Job.categoryTags` array, then
 * query with `categoryTags: { has: 'X' }` — exact match, no false
 * positives, no cross-taxonomy bleed.
 *
 * Callers:
 *   - lib/job-normalizer.ts (ingest path, every external job)
 *   - app/api/jobs/route.ts via post-job submit (employer-posted jobs)
 *   - scripts/backfill-category-tags.ts (one-shot for existing rows)
 *
 * Pure function. No DB access. Easy to unit-test.
 */

export interface ClassifiableJob {
    title: string;
    description?: string | null;
    descriptionSummary?: string | null;
    jobType?: string | null;
    isRemote?: boolean | null;
    setting?: string | null;
    population?: string | null;
}

/**
 * All canonical category slugs the classifier can emit.
 *
 * Ordering note: order here defines mutual-exclusion priority in the
 * second-pass below. Earlier-priority categories win when a job qualifies
 * for both A and B where B `excludeIfAlsoTagged: ['A']`.
 *
 * URL-stable: changing a slug requires a redirect + sitemap regenerate.
 */
export const CANONICAL_CATEGORY_SLUGS = [
    // ── Modality / setting (mode of practice) ──
    'remote',
    'telehealth',
    'inpatient',
    'outpatient',
    'travel',
    'hospital',
    'private-practice',
    'community-health',
    'va',
    'correctional',
    'urgent-care',
    'home-health',

    // ── Job type ──
    'full-time',
    'part-time',
    'contract',
    'per-diem',
    'locum-tenens',
    '1099',

    // ── NP specialty (the broadening — these are the heart of the NP board) ──
    'family-practice',
    'adult-gerontology',
    'pediatric',
    'neonatal',
    'women-health',
    'acute-care',
    'emergency',
    'psychiatric-mental-health',
    'geriatric',
    'oncology',
    'cardiology',
    'primary-care',
    'hospitalist',
    'dermatology',
    'orthopedic',

    // ── APRN cohort beyond NPs ──
    'anesthesia',           // CRNA
    'midwifery',            // CNM
    'clinical-nurse-specialist',  // CNS

    // ── Population ──
    'veterans',
    'lgbtq',

    // ── Experience tier ──
    'entry-level',
    'new-grad',
    'mid-career',
    'senior',
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
    keywords: string[];
    matchDescription?: boolean;
    structural?: (job: ClassifiableJob) => boolean;
    excludeIfAlsoTagged?: CategoryTag[];
}

const RULES: Partial<Record<CategoryTag, CategoryRule>> = {
    // ── Settings (mutually exclusive within the setting axis) ──
    inpatient: {
        keywords: ['inpatient', 'in-patient', 'acute care', 'crisis stabilization', 'inpatient unit', 'med-surg', 'ICU', 'CCU', 'PCU', 'step-down'],
        matchDescription: false,
    },
    outpatient: {
        keywords: ['outpatient', 'out-patient', 'ambulatory', 'clinic-based'],
        matchDescription: false,
        excludeIfAlsoTagged: ['inpatient'],
    },
    'private-practice': {
        keywords: ['private practice', 'group practice', 'solo practice', 'independent practice', 'physician group'],
        matchDescription: false,
        excludeIfAlsoTagged: ['inpatient', 'hospital'],
    },
    hospital: {
        keywords: ['hospital', 'medical center', 'health system', 'academic medical center'],
        matchDescription: false,
        excludeIfAlsoTagged: ['outpatient', 'private-practice', 'va'],
    },
    'community-health': {
        keywords: ['FQHC', 'federally qualified health center', 'community health center', 'community clinic', 'safety net'],
        matchDescription: true,
    },
    va: {
        keywords: ['VA medical center', 'veterans affairs', 'department of veterans', 'VHA', 'VA hospital', 'VA clinic'],
        matchDescription: true,
    },
    correctional: {
        keywords: ['correctional', 'corrections', 'prison', 'forensic', 'jail', 'detention', 'incarcerat'],
        matchDescription: false,
    },
    'urgent-care': {
        keywords: ['urgent care', 'walk-in clinic'],
        matchDescription: false,
        excludeIfAlsoTagged: ['hospital'],
    },
    'home-health': {
        keywords: ['home health', 'home-based care', 'house calls', 'in-home care'],
        matchDescription: false,
    },

    // ── Modality (job can simultaneously be remote AND telehealth) ──
    remote: {
        keywords: ['remote', 'work from home', 'WFH', '100% remote'],
        structural: (j) => j.isRemote === true,
    },
    telehealth: {
        keywords: ['telehealth', 'telemedicine', 'telepsychiatry', 'telepsych', 'virtual care', 'virtual visits'],
        matchDescription: false,
    },
    travel: {
        keywords: ['travel position', 'travel assignment', 'travel NP', 'travel nurse practitioner'],
        matchDescription: false,
    },

    // ── Job type ──
    'full-time': {
        keywords: ['full-time', 'full time'],
        structural: (j) => (j.jobType || '').toLowerCase().includes('full'),
    },
    'part-time': {
        keywords: ['part-time', 'part time'],
        structural: (j) => (j.jobType || '').toLowerCase().includes('part'),
        excludeIfAlsoTagged: ['full-time'],
    },
    contract: {
        keywords: ['contract position', 'temp-to-perm', 'temporary assignment'],
        structural: (j) => (j.jobType || '').toLowerCase().includes('contract'),
    },
    'per-diem': {
        keywords: ['per diem', 'per-diem', 'PRN'],
        structural: (j) => (j.jobType || '').toLowerCase().includes('per diem'),
    },
    'locum-tenens': {
        keywords: ['locum tenens', 'locums'],
    },
    '1099': {
        keywords: ['1099', 'independent contractor', 'IC position'],
        matchDescription: true,
    },

    // ── NP specialty (matched primarily off title; description as fallback only for very clean signals) ──
    'family-practice': {
        keywords: ['family nurse practitioner', 'family np', 'FNP-BC', 'FNP-C', 'family medicine NP'],
        matchDescription: false,
    },
    'adult-gerontology': {
        keywords: ['adult-gerontology', 'adult gerontology', 'AGNP', 'AGPCNP', 'AGACNP', 'adult NP'],
        matchDescription: false,
    },
    pediatric: {
        keywords: ['pediatric nurse practitioner', 'pediatric NP', 'PNP-BC', 'CPNP', 'pediatrics NP', 'child health NP'],
        matchDescription: false,
    },
    neonatal: {
        keywords: ['neonatal nurse practitioner', 'neonatal NP', 'NNP-BC', 'NICU NP'],
        matchDescription: false,
    },
    'women-health': {
        keywords: ["women's health nurse practitioner", "women's health NP", 'WHNP', 'WHNP-BC', "women's health"],
        matchDescription: false,
    },
    'acute-care': {
        keywords: ['acute care nurse practitioner', 'ACNP', 'ACNP-BC', 'AGACNP'],
        matchDescription: false,
    },
    emergency: {
        keywords: ['emergency nurse practitioner', 'emergency NP', 'ENP-C', 'emergency department NP', 'ED NP', 'ER NP'],
        matchDescription: false,
    },
    'psychiatric-mental-health': {
        keywords: ['psychiatric nurse practitioner', 'psych nurse practitioner', 'mental health nurse practitioner', 'PMHNP', 'PMHNP-BC', 'psych NP', 'mental health NP', 'behavioral health NP', 'behavioral health nurse practitioner'],
        matchDescription: false,
    },
    geriatric: {
        keywords: ['geriatric', 'geropsych', 'elderly', 'senior living', 'nursing home'],
        matchDescription: false,
    },
    oncology: {
        keywords: ['oncology nurse practitioner', 'oncology NP', 'hem-onc NP', 'hematology oncology'],
        matchDescription: false,
    },
    cardiology: {
        keywords: ['cardiology nurse practitioner', 'cardiology NP', 'cardiovascular NP', 'cardiac NP', 'heart failure NP'],
        matchDescription: false,
    },
    'primary-care': {
        keywords: ['primary care nurse practitioner', 'primary care NP'],
        matchDescription: false,
        excludeIfAlsoTagged: ['family-practice', 'adult-gerontology'],
    },
    hospitalist: {
        keywords: ['hospitalist nurse practitioner', 'hospitalist NP', 'inpatient hospitalist'],
        matchDescription: false,
    },
    dermatology: {
        keywords: ['dermatology nurse practitioner', 'dermatology NP', 'derm NP', 'aesthetics NP'],
        matchDescription: false,
    },
    orthopedic: {
        keywords: ['orthopedic nurse practitioner', 'orthopedic NP', 'ortho NP', 'orthopaedic NP', 'sports medicine NP'],
        matchDescription: false,
    },

    // ── APRN cohort beyond NPs ──
    anesthesia: {
        keywords: ['certified registered nurse anesthetist', 'nurse anesthetist', 'CRNA', 'anesthesia'],
        matchDescription: false,
    },
    midwifery: {
        keywords: ['certified nurse midwife', 'nurse midwife', 'midwife', 'CNM'],
        matchDescription: false,
    },
    'clinical-nurse-specialist': {
        keywords: ['clinical nurse specialist', 'CNS'],
        matchDescription: false,
    },

    // ── Population ──
    veterans: {
        keywords: ['veterans', 'PTSD', 'military health'],
        matchDescription: true,
        excludeIfAlsoTagged: ['va'],
    },
    lgbtq: {
        keywords: ['LGBTQ', 'transgender', 'gender-affirming', 'gender affirming', 'gender identity', 'affirming care'],
        matchDescription: true,
    },

    // ── Experience tier (mutually exclusive) ──
    'new-grad': {
        keywords: ['new grad', 'new graduate', 'recent graduate', 'fellowship', 'NP residency'],
        matchDescription: false,
    },
    'entry-level': {
        keywords: ['entry level', 'entry-level'],
        matchDescription: false,
        excludeIfAlsoTagged: ['new-grad'],
    },
    senior: {
        keywords: ['senior NP', 'senior nurse practitioner', 'lead NP', 'clinical lead', 'NP supervisor', 'nurse practitioner supervisor', 'lead nurse practitioner', 'medical director', 'clinical director', 'program director', 'clinic director'],
        matchDescription: false,
    },
    'mid-career': {
        keywords: ['experienced NP', 'experienced nurse practitioner', 'lead clinician'],
        matchDescription: false,
        excludeIfAlsoTagged: ['senior', 'new-grad'],
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
 */
export function classifyJobTags(job: ClassifiableJob): CategoryTag[] {
    const title = job.title || '';
    const description = job.description || job.descriptionSummary || '';
    const titleLower = title.toLowerCase();
    const descLower = description.toLowerCase();

    const tagged = new Set<CategoryTag>();

    for (const slug of CANONICAL_CATEGORY_SLUGS) {
        const rule = RULES[slug];
        if (!rule) continue;

        if (rule.structural?.(job)) {
            tagged.add(slug);
            continue;
        }

        const matchDesc = rule.matchDescription !== false;
        const haystack = matchDesc ? `${titleLower} ${descLower}` : titleLower;
        for (const kw of rule.keywords) {
            if (matchesKeyword(haystack, kw)) {
                tagged.add(slug);
                break;
            }
        }
    }

    for (const slug of CANONICAL_CATEGORY_SLUGS) {
        if (!tagged.has(slug)) continue;
        const rule = RULES[slug];
        if (!rule?.excludeIfAlsoTagged) continue;
        if (rule.excludeIfAlsoTagged.some((other) => tagged.has(other))) {
            tagged.delete(slug);
        }
    }

    return CANONICAL_CATEGORY_SLUGS.filter((s) => tagged.has(s));
}

/**
 * Build a Prisma WHERE fragment that matches via the legacy keyword OR
 * matchers. Used as the backward-compat fallback for buildWhere callers
 * during the deploy → backfill window: rows with empty `categoryTags`
 * (not yet backfilled) still render correctly.
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
 */
export function withTagFallback(tag: CategoryTag): Record<string, unknown> {
    const rule = RULES[tag];
    const legacyConditions: Record<string, unknown>[] = [];
    const kw = legacyKeywordOr(tag);
    if (kw.length > 0) legacyConditions.push({ OR: kw });
    if (tag === 'remote') legacyConditions.push({ isRemote: true });
    if (tag === 'full-time') legacyConditions.push({ jobType: { contains: 'Full', mode: 'insensitive' } });
    if (tag === 'part-time') legacyConditions.push({ jobType: { contains: 'Part', mode: 'insensitive' } });
    if (tag === 'contract') legacyConditions.push({ jobType: { contains: 'Contract', mode: 'insensitive' } });
    if (tag === 'per-diem') legacyConditions.push({ jobType: { contains: 'Per Diem', mode: 'insensitive' } });

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

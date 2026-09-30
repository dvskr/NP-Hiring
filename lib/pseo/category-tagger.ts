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
 * 45-slug all-NP taxonomy (lib/pseo/taxonomy-registry.ts). Carried-over
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
 *
 * ── ONE PREDICATE PER CATEGORY (indexing audit CQ-05, CQ-14, 2026-09) ──
 * Remote, telehealth, the job types and new grad are decided by structured
 * fields (lib/pseo/category-structural.ts, lib/pseo/new-grad-clause.ts),
 * never by description keywords: 'remote' is the fully remote work mode,
 * the job types read jobType (title keywords only when jobType is blank),
 * and LGBTQ+ and veterans read the title and the employer's population
 * only. Description matching that remains (community-health, va, 1099)
 * runs on the description with its EEO boilerplate removed.
 * categoryPredicate() below is THE clause every page, sitemap, cron verdict
 * and in-memory tally counts a category with; withTagFallback is its
 * historical name and returns the same clause.
 */

import type { Prisma } from '@prisma/client';
import { CATEGORY_AXES } from './taxonomy-registry';
import {
    FULLY_REMOTE_WHERE,
    isFullyRemote,
    isJobTypeCategory,
    jobTypeCategoriesOf,
    jobTypeCategoryWhere,
    stripEeoBoilerplate,
    titleKeywordWhere,
} from './category-structural';
import { newGradWhereClause } from './new-grad-clause';

export interface ClassifiableJob {
    title: string;
    description?: string | null;
    descriptionSummary?: string | null;
    jobType?: string | null;
    /** Fully remote only together with isHybrid !== true (reconcileWorkMode keeps them exclusive). */
    isRemote?: boolean | null;
    isHybrid?: boolean | null;
    /** Employer "open to new grads" flag (a structured new grad signal). */
    newGradFriendly?: boolean | null;
    /** Structured minimum years; 0 is the "New grad accepted" bucket. */
    minYearsExperience?: number | null;
    /**
     * The employer name. Only the VA rule reads it: a Department of Veterans
     * Affairs posting is a VA job whatever its description says (the legacy
     * /jobs/va filter matched the employer the same way).
     */
    employer?: string | null;
    setting?: string | null;        // populated for employer-posted jobs
    population?: string | null;     // populated for employer-posted jobs
    /**
     * Explicit NP specialty slug picked by the employer on /post-job
     * (a CATEGORY_AXES.specialty or CATEGORY_AXES.aprn slug). When
     * present and valid, the classifier trusts it INSTEAD of substring-
     * guessing the specialty from title/description — see classifyJobTags.
     */
    specialty?: string | null;
}

/**
 * All canonical category slugs the classifier can emit — the 45-slug NP
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
    'aesthetics', 'pain-management', 'palliative-hospice',
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
        structural: (j) => isVaEmployer(j.employer),
    },
    correctional: {
        keywords: ['correctional', 'corrections', 'prison', 'forensic', 'jail', 'detention', 'incarcerat'],
        matchDescription: false,
    },

    // ── Modality (job can simultaneously be remote AND telehealth) ──
    // 'remote' has no keyword rule: it is the fully remote work mode
    // (isFullyRemote, CQ-05). "Hybrid role, 1 to 2 days remotely", "remote
    // patient monitoring" and "remote and austere environments" all used to
    // tag it. See the structural branch in classifyJobTags.
    telehealth: {
        // Title only. categoryPredicate('telehealth') also requires the fully
        // remote work mode at query time, so a stale isRemote on the stored
        // tag can never put an on-site job on a telehealth page.
        keywords: ['telehealth', 'telemedicine', 'telepsychiatry', 'telepsych', 'virtual care'],
        matchDescription: false,
    },
    travel: {
        keywords: [
            'travel position', 'travel assignment', 'travel nurse practitioner', 'travel np', 'travel crna',
            'traveling nurse practitioner', 'traveling np', 'travel contract',
        ],
        matchDescription: false,
    },

    // ── Job type: full-time, part-time, contract, per-diem and locum-tenens
    // are decided by lib/pseo/category-structural.ts jobTypeCategoriesOf
    // (jobType first; title keywords only when jobType is blank), never by
    // a description keyword ("Full-time employees qualify for benefits" used
    // to strip real part-time jobs of their tag).
    '1099': {
        // ' ic position' stays anchored: a bare 'ic position' matched
        // "clinic position" and "medic position".
        keywords: ['1099', 'independent contractor', ' ic position'],
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
        // "Aesthetic Dermatology NP" / injector-at-derm-practice titles are
        // aesthetics jobs first — the more specific sibling wins (P9 lesson,
        // same shape as primary-care deferring to family-practice).
        excludeIfAlsoTagged: ['aesthetics'],
    },
    orthopedic: {
        keywords: ['orthopedic', 'orthopaedic', ' ortho '],
        matchDescription: false,
    },
    // ── 2026-07 P1 #15 verticals (title-anchored, precision over recall) ──
    aesthetics: {
        // 'aesthetic' must stay boundary-anchored: bare 'aesthetic' is a
        // substring of the British spelling 'anaesthetic'/'anaesthetist',
        // which belongs to the anesthesia (CRNA) page.
        keywords: [
            ' aesthetic', '(aesthetic', '/aesthetic', '-aesthetic',
            'med spa', 'med-spa', 'medspa', 'medical spa',
            'botox', 'cosmetic injector', 'nurse injector', 'injectables',
            'dermal filler',
        ],
        matchDescription: false,
    },
    'pain-management': {
        keywords: [
            'pain management', 'interventional pain', 'pain medicine',
            'pain clinic', 'chronic pain',
        ],
        matchDescription: false,
    },
    'palliative-hospice': {
        keywords: [
            'palliative', 'hospice', 'end-of-life', 'end of life',
        ],
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
        // Aligned with lib/pseo/new-grad-clause.ts, the predicate the pages
        // count with: bare 'fellowship' and 'residency' matched post-graduate
        // APP fellowships that require years of NP experience. The structured
        // signals (newGradFriendly, a 0-year minimum) tag it too.
        keywords: [
            'new grad', 'new graduate', 'recent graduate',
            'fellowship program', 'residency program', 'training program',
        ],
        matchDescription: false,
        structural: (j) => j.newGradFriendly === true || j.minYearsExperience === 0,
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
    // Title and the employer-declared population only (CQ-05): "gender
    // identity" and "protected veterans" sit in nearly every EEO statement,
    // which is how Nashville read "LGBTQ+ (3)".
    lgbtq: {
        keywords: ['LGBTQ', 'transgender', 'gender-affirming', 'gender affirming'],
        matchDescription: false,
    },
    veterans: {
        keywords: ['veterans', 'PTSD', 'military mental health'],
        matchDescription: false,
        excludeIfAlsoTagged: ['va'], // VA is more specific than generic "veterans"
    },
};

function matchesKeyword(haystack: string, keyword: string): boolean {
    return haystack.toLowerCase().includes(keyword.toLowerCase());
}

/** The employer is the Department of Veterans Affairs (the legacy /jobs/va employer test). */
function isVaEmployer(employer: string | null | undefined): boolean {
    const name = (employer ?? '').trim().toLowerCase();
    return name.includes('veterans affairs') || name.includes('department of veterans')
        || /\bvha\b/.test(name) || name.startsWith('va ');
}

/** Rules whose tag is decided outside RULES (category-structural.ts). */
function isStructuralOnlySlug(slug: CategoryTag): boolean {
    return slug === 'remote' || isJobTypeCategory(slug);
}

// ── Explicit employer-declared fields (2026-07 P1 #20) ──────────────────────
//
// The /post-job form collects three structured signals — specialty, clinical
// setting, patient population — that are far higher-quality than substring
// guessing. These maps are the single source of truth for BOTH sides:
//   - app/post-job/page.tsx derives its <select> option lists from the keys,
//   - classifyJobTags() maps a stored value straight to its canonical tag.
// A `null` tag means "honest option with no taxonomy page" (e.g. Academic).
// Keys are the exact display strings persisted on Job.setting / .population.

/** Slugs the /post-job specialty picker may submit (specialty + APRN axes). */
export const EMPLOYER_SPECIALTY_SLUGS: readonly string[] = [
    ...CATEGORY_AXES.specialty,
    ...CATEGORY_AXES.aprn,
];

const EMPLOYER_SPECIALTY_SLUG_SET: ReadonlySet<string> = new Set(EMPLOYER_SPECIALTY_SLUGS);

/** Clinical-setting options offered on /post-job → canonical tag (or null). */
export const EMPLOYER_SETTING_TAGS: Readonly<Record<string, CategoryTag | null>> = {
    'Outpatient': 'outpatient',
    'Inpatient': 'inpatient',
    'Hospital': 'hospital',
    'Private Practice': 'private-practice',
    'Community Health / FQHC': 'community-health',
    'Urgent Care': 'urgent-care',
    'Home Health': 'home-health',
    'Telehealth': 'telehealth',
    'Skilled Nursing / Long-Term Care': 'geriatric',
    'VA / Military': 'va',
    'Correctional': 'correctional',
    'Academic / University': null,
};

/** Patient-population options offered on /post-job → canonical tag (or null). */
export const EMPLOYER_POPULATION_TAGS: Readonly<Record<string, CategoryTag | null>> = {
    'Adults': null,
    'Pediatric & Adolescent': 'pediatric',
    'Geriatric / Older Adults': 'geriatric',
    "Women's Health": 'women-health',
    'Veterans': 'veterans',
    'LGBTQ+': 'lgbtq',
    'All Ages': null,
};

// Values already stored on Job rows that the form no longer offers.
// Resolution-only — two sources feed them:
//   1. the pre-P1-#20 /post-job option strings (employer-posted rows), and
//   2. the LLM enrichment vocabulary that writes Job.setting /
//      Job.population for scraped rows (lib/llm-enrichment.ts:57-58).
// Mapping them here means a backfill re-run keeps the signal instead of
// dropping it. Values with no NP taxonomy page (Residential, Forensic,
// "Substance Use / Dual Diagnosis", Academic) are deliberately absent —
// unmapped resolves to null, which is the honest answer.
const LEGACY_SETTING_ALIASES: Readonly<Record<string, CategoryTag>> = {
    'Community Health': 'community-health',
    'Corrections': 'correctional',
    // LLM clinical_setting vocabulary — an ED posting belongs on the
    // emergency category page.
    'Emergency': 'emergency',
};

const LEGACY_POPULATION_ALIASES: Readonly<Record<string, CategoryTag>> = {
    // Pre-P1-#20 form option.
    'Child & Adolescent': 'pediatric',
    'Geriatric': 'geriatric',
    // LLM patient_population vocabulary.
    'Children': 'pediatric',
    'Adolescents': 'pediatric',
};

/**
 * Resolve the employer-declared fields to canonical tags. The specialty is
 * only honored when it is a real specialty/APRN-axis slug — free-text or
 * stale values are ignored rather than trusted.
 */
function explicitTags(job: ClassifiableJob): {
    specialty: CategoryTag | null;
    others: CategoryTag[];
} {
    const specialty = job.specialty && EMPLOYER_SPECIALTY_SLUG_SET.has(job.specialty)
        ? (job.specialty as CategoryTag)
        : null;
    const others: CategoryTag[] = [];
    const settingTag = job.setting
        ? (EMPLOYER_SETTING_TAGS[job.setting] ?? LEGACY_SETTING_ALIASES[job.setting] ?? null)
        : null;
    if (settingTag) others.push(settingTag);
    const populationTag = job.population
        ? (EMPLOYER_POPULATION_TAGS[job.population] ?? LEGACY_POPULATION_ALIASES[job.population] ?? null)
        : null;
    if (populationTag) others.push(populationTag);
    return { specialty, others };
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
    // Description rules never read EEO or legal boilerplate (CQ-05).
    const description = stripEeoBoilerplate(job.description || job.descriptionSummary || '');
    const titleLower = title.toLowerCase();
    const descLower = description.toLowerCase();

    const tagged = new Set<CategoryTag>();

    // Structured categories (lib/pseo/category-structural.ts): the fully
    // remote work mode and the job types. They take no keyword pass below.
    if (isFullyRemote(job)) tagged.add('remote');
    for (const slug of jobTypeCategoriesOf(job)) tagged.add(slug);

    // Explicit employer-declared fields (P1 #20). An explicit specialty
    // REPLACES substring guessing across the whole specialty/APRN axis —
    // the employer's structured answer beats keyword heuristics, so no
    // other specialty-axis slug is keyword-scanned and the explicit tag
    // is exempt from the mutual-exclusion pass.
    const explicit = explicitTags(job);
    const explicitSet = new Set<CategoryTag>(explicit.others);
    if (explicit.specialty) explicitSet.add(explicit.specialty);
    for (const tag of explicitSet) tagged.add(tag);

    // First pass: structural + keyword rules, no exclusion logic yet.
    for (const slug of CANONICAL_CATEGORY_SLUGS) {
        // Explicit specialty present → skip keyword guessing for every
        // OTHER specialty/APRN-axis slug (the explicit one already won).
        if (explicit.specialty && slug !== explicit.specialty
            && EMPLOYER_SPECIALTY_SLUG_SET.has(slug)) {
            continue;
        }
        if (isStructuralOnlySlug(slug)) continue;

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
    // earlier-priority categories win. Explicit employer-declared tags are
    // never deleted — the employer said so.
    for (const slug of CANONICAL_CATEGORY_SLUGS) {
        if (!tagged.has(slug)) continue;
        if (explicitSet.has(slug)) continue;
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
 * The legacy keyword OR for rows whose categoryTags is still empty (not yet
 * tagged by ingest or scripts/indexing-fixes/retag-category-tags.ts).
 * Title-only rules use the padded title twin (titleKeywordWhere), so the
 * query matches exactly the titles the classifier matches; description
 * rules keep a plain contains (Prisma cannot strip boilerplate), which is
 * acceptable because the arm only exists for untagged rows.
 */
function legacyKeywordOr(tag: CategoryTag): Record<string, unknown>[] {
    const rule = RULES[tag];
    if (!rule || rule.keywords.length === 0) return [];
    if (rule.matchDescription === false) return [titleKeywordWhere(rule.keywords) as Record<string, unknown>];
    return rule.keywords.flatMap((kw) => [
        { title: { contains: kw, mode: 'insensitive' } },
        { description: { contains: kw, mode: 'insensitive' } },
    ]);
}

/**
 * The stored-tag clause: rows tagged `tag`, or untagged rows that match the
 * legacy keywords. The predicate of every keyword category; the structured
 * categories wrap or replace it in categoryPredicate.
 */
export function tagOrLegacyFallback(tag: CategoryTag): Record<string, unknown> {
    const legacy = legacyKeywordOr(tag);
    return {
        OR: [
            { categoryTags: { has: tag } },
            ...(legacy.length > 0
                ? [{
                    AND: [
                        { categoryTags: { isEmpty: true } },
                        legacy.length === 1 ? legacy[0] : { OR: legacy },
                    ],
                }]
                : []),
        ],
    };
}

/**
 * THE predicate for a category (CQ-14, fixSoon 11): the clause the landing
 * (`/jobs/{slug}`), its state and city pages, the aggregate-pseo verdicts,
 * the sitemaps (through those verdicts), the /jobs ?category= filter and the
 * in-memory category tallies (lib/pseo/category-row-match.ts) all count
 * with. Always a single top-level `OR` key, so callers can keep spreading it
 * beside `isPublished`, `state` and `city`.
 *
 *   remote       the fully remote work mode (isRemote and not isHybrid);
 *   telehealth   the telehealth tag AND the fully remote work mode;
 *   job types    jobType, else title keywords (category-structural.ts);
 *   new-grad     lib/pseo/new-grad-clause.ts (the /jobs facet clause);
 *   every other  the stored tag, with the legacy fallback for untagged rows.
 */
export function categoryPredicate(tag: CategoryTag): Record<string, unknown> {
    if (tag === 'remote') return { OR: [FULLY_REMOTE_WHERE] };
    if (tag === 'telehealth') return { OR: [{ AND: [tagOrLegacyFallback('telehealth'), FULLY_REMOTE_WHERE] }] };
    if (isJobTypeCategory(tag)) return { OR: [jobTypeCategoryWhere(tag)] };
    if (tag === 'new-grad') return { OR: [newGradWhereClause()] };
    return tagOrLegacyFallback(tag);
}

/**
 * The category predicate under its historical name (it used to be the tag
 * plus legacy fallback for every slug). Kept so the setting x state and
 * category x city configs, the widget, the salary guide tables and the /jobs
 * specialty facet all read categoryPredicate without a code change.
 *
 * Usage:
 *   buildWhere: (stateName) => ({
 *     isPublished: true,
 *     state: { equals: stateName, mode: 'insensitive' },
 *     ...withTagFallback('remote'),
 *   })
 */
export function withTagFallback(tag: CategoryTag): Record<string, unknown> {
    return categoryPredicate(tag);
}

/** categoryPredicate typed for Prisma callers. */
export function categoryPredicateWhere(tag: CategoryTag): Prisma.JobWhereInput {
    return categoryPredicate(tag) as Prisma.JobWhereInput;
}

/**
 * Niche relevance pack — ALL keyword data consumed by the relevance
 * engine (lib/utils/job-filter.ts) and its query-time mirror
 * (lib/filters.ts GLOBAL_EXCLUSIONS). This file is DATA ONLY; the
 * tier/veto/rescue mechanics live in the engine and are niche-agnostic.
 *
 * ── NP HIRING (board #2) ──────────────────────────────────────────────
 * Retuned 2026-07-02 for the ALL-NP + APRN-cohort niche (FNP, AGNP,
 * PMHNP, PNP, NNP, WHNP, ACNP, AGACNP + CRNA, CNM, CNS). Vocabulary is
 * harvested from the donor fork's broadened classifier
 * (PMHNP-Job-Board-Fork lib/utils/job-filter.ts, phase 4b "all-NP +
 * APRN cohort", 2026-05-23) and adapted to this template's SUBSTRING
 * engine (the donor used word-boundary regexes; see per-knob notes).
 *
 * Key semantic shift vs the PMHNP pack this replaces: the board WANTS
 * every NP specialty, so "niche context" now means "NP/APRN credential
 * context" (not psych context), and the off-specialty veto shrinks to
 * roles that are not human-NP jobs at all. Wrong-role vetoes now target
 * only non-NP provider classes (physician, PA-only, RN-only, LPN,
 * therapists, admin/sales) — donor job-filter.ts:163-169.
 *
 * ── MECHANISM MAP (which knob feeds which engine layer) ───────────────
 *   POSITIVE_KEYWORDS            Tier 1: instant pass signal
 *   MENTAL_HEALTH_CONTEXT_TERMS  Tier 2: loose context (NP-title + NP-credential context)
 *   ROLE_TITLE_MARKERS/_REGEX    Tier 2: "is this an NP-role title at all"
 *   CATCH_ALL_TERM               Tier 3: last-chance substring anywhere
 *   PSYCH_EMPLOYER_PATTERNS      Tier 2.5: employer-name heuristic
 *   PSYCH_EMPLOYER_ALLOWLIST     Tier 2.5: named employers w/o pattern words
 *   OFF_SPECIALTY_TITLE_MARKERS  Veto: title defines a NON-NP role
 *   STRONG_PSYCH_DESC_TERMS      Rescue: NP-credential-specific description terms
 *   STRONG_PSYCH_CONTEXT_MIN_HITS Rescue: repeated loose-context threshold
 *   TITLE_CONTEXT_WORDS          Rescue: NP-credential word in the title itself
 *   GENERIC_NP_TITLES            Guard: too-generic titles need title/employer NP signal
 *   NEGATIVE_KEYWORDS            Wrong-role kill list (title match)
 *   DUAL_ROLE_PATTERNS/_NEGATIVE_KEYWORDS  Exception: "NP or PA" postings
 *   APRN_TITLE_MARKERS/_NEGATIVE_OVERRIDES Exception: APRN titles vs RN negatives
 *   WRONG_ROLE_CO_OCCURRENCE_EXCEPTIONS    Exception: negative allowed when indicators co-occur
 *   NON_PROVIDER_TITLE_MARKERS   Query-time mirror only (lib/filters.ts)
 */

/**
 * Tier-1 positives: specialty-specific NP titles + credential strings.
 * Donor job-filter.ts:33-156 with substring-engine adaptations:
 *   - Donor's bare word-boundary tokens (' np ', '(np)', ' cns ', 'app - ')
 *     are NOT safe as raw substrings against title+description text
 *     ('scrna', 'CNS depressants', 'whatsapp-based'), so they moved to
 *     ROLE_TITLE_REGEX (title-only, word-boundary) — engine adaptation.
 *   - Bare 'nurse practitioner' is deliberately NOT Tier-1: it reaches
 *     Tier 2 via ROLE_TITLE_MARKERS + context instead, so wrong-role
 *     negatives (veterinary, medical director, talent community) can
 *     still veto titles that merely contain the phrase. Donor's
 *     title-positive short-circuit accepted those; this is stricter on
 *     purpose (substring engine keeps the template's layered guards).
 *   - Short credential abbreviations keep the template's space-padding
 *     convention (like the old pack's ' pa ' / ' rn ') where donor used
 *     regex boundaries.
 */
export const POSITIVE_KEYWORDS = [
    // Generic APRN markers (donor job-filter.ts:33-45)
    'aprn',
    'arnp',
    'advanced practice registered nurse',
    'advanced practice nurse',
    'advanced practice provider',
    'nurse practitioner - ', // donor:154 "Nurse Practitioner - <specialty>" pattern
    'np - ',                 // donor:155 "NP - <specialty>" pattern

    // Common NP specialty title keywords, full forms (donor:47-88)
    'family nurse practitioner',
    'family np',
    'adult-gerontology nurse practitioner',
    'adult gerontology nurse practitioner',
    'adult-gerontology primary care nurse practitioner',
    'adult-gerontology acute care nurse practitioner',
    'pediatric nurse practitioner',
    'pediatric np',
    'pediatrics nurse practitioner',
    'neonatal nurse practitioner',
    "women's health nurse practitioner",
    'womens health nurse practitioner',
    "women's health np",
    // Curly-apostrophe variants — aggregator titles often use U+2019
    // (lesson carried over from the PMHNP pack's off-specialty list).
    'women’s health nurse practitioner',
    'women’s health np',
    'acute care nurse practitioner',
    'acute care np',
    'emergency nurse practitioner',
    'emergency np',
    'oncology nurse practitioner',
    'cardiology nurse practitioner',
    'cardiovascular nurse practitioner',
    'geriatric nurse practitioner',
    'geriatrics nurse practitioner',
    'hospice nurse practitioner',
    'palliative care nurse practitioner',
    'primary care nurse practitioner',
    'urgent care nurse practitioner',
    'hospitalist nurse practitioner',
    'urology nurse practitioner',
    'dermatology nurse practitioner',
    'orthopedic nurse practitioner',
    'pulmonology nurse practitioner',
    'gastroenterology nurse practitioner',
    'rheumatology nurse practitioner',
    'nephrology nurse practitioner',
    'endocrinology nurse practitioner',
    'neurology nurse practitioner',
    'occupational health nurse practitioner',
    'telehealth nurse practitioner',
    'telemedicine nurse practitioner',
    'travel nurse practitioner',
    'locum tenens nurse practitioner',

    // PMHNP / behavioral health — the original niche, still in scope (donor:90-106)
    'pmhnp',   // substring also covers donor's 'pmhnp-bc' / 'fpmhnp' suffix forms
    'fpmhnp',
    'pmnhp',   // common misspelling (donor:94)
    'psychiatric nurse practitioner',
    'psych nurse practitioner',
    'mental health nurse practitioner',
    'psychiatric mental health nurse practitioner',
    'psychiatric-mental health nurse practitioner',
    'psychiatric aprn',
    'psych aprn',
    'behavioral health nurse practitioner',
    'behavioral health np',
    'psych np',
    'mental health np',
    'psychiatric np',

    // NP specialty abbreviations (donor:108-133; space-padded per the
    // template convention — the join `${title} ${description}` supplies
    // an interior space, so mid-text tokens match; parenthesized forms
    // are covered by ROLE_TITLE_REGEX at the title level)
    ' fnp ',
    ' fnp,',
    ' fnp-',
    'fnp-bc',
    'fnp-c',
    ' agnp ',
    'agnp-c',
    ' agpcnp ',
    'agpcnp-bc',
    ' agacnp ',
    'agacnp-bc',
    ' pnp ',
    'pnp-bc',
    ' acpnp ',
    'cpnp-pc',
    'cpnp-ac',
    ' nnp ',
    'nnp-bc',
    ' whnp ',
    'whnp-bc',
    ' acnp ',
    'acnp-bc',
    ' enp ',
    'enp-c',
    ' onp ',

    // APRN cohort — CRNA / CNM / CNS (donor:135-148). Bare ' cns ' is
    // dropped: it collides with "CNS depressants/stimulants" vocabulary
    // in psych JDs under substring matching; CNS titles are caught by
    // ROLE_TITLE_REGEX + 'clinical nurse specialist'.
    'certified registered nurse anesthetist',
    'nurse anesthetist',
    ' crna ',
    'crna,',
    'crna -',
    'certified nurse midwife',
    'certified nurse-midwife',
    'nurse midwife',
    'nurse-midwife',
    ' cnm ',
    'cnm,',
    'clinical nurse specialist',
];

/**
 * Wrong-role kill list (title match). Donor job-filter.ts:170-261 —
 * only NON-NP provider classes and non-provider roles remain. Every
 * other-NP-specialty negative from the PMHNP pack (pediatric NP,
 * women's health NP, FNP, travel NP, oncology, cardiology, urgent care,
 * anesthesia, acute care, hospitalist, ICU, primary care, clinical
 * nurse specialist, midwife, …) is REMOVED because those ARE NP/APRN
 * roles — donor:163-169.
 */
export const NEGATIVE_KEYWORDS = [
    // Wrong provider class (donor:171-181)
    'physician',
    'medical doctor',
    ' m.d.',
    ' d.o.',
    'psychiatrist',
    'psychologist',
    'physician assistant',
    'pa-c',
    ' pa ',
    'medical pa',

    // Non-advanced nursing — lower tier than NP (donor:183-195)
    'registered nurse',
    ' rn ',
    ' rn,',
    ' rn-',
    '-rn ',
    'practical nurse',
    ' lpn',
    ' lvn',
    ' cna',
    'nursing assistant',
    'patient care technician',
    ' pct',

    // Allied / non-nursing clinicians (donor:197-219)
    'social worker',
    'lcsw',
    'licsw',
    'lmsw',
    'therapist',
    'counselor',
    'lmft',
    ' lpc',
    'lcpc',
    'lgpc',
    'occupational therapist',
    'physical therapist',
    'speech therapist',
    'speech-language pathologist',
    'dietitian',
    'nutritionist',
    'medical assistant',
    'chiropractor',
    'pharmacist',
    'pharmacy technician',
    'radiologic technologist',
    'rad tech',

    // Admin / support roles (donor:221-249)
    'receptionist',
    'scheduler',
    'scheduling coordinator',
    'intake coordinator',
    'referral coordinator',
    'case manager',
    'office manager',
    'facility manager',
    'practice manager',
    'program director',
    'medical director',
    'director of nursing',
    'director of operations',
    'director of finance',
    'interim cfo',
    ' cfo ',
    ' ceo ',
    'recruiter',
    'bookings specialist',
    'medical science liaison',
    'lecturer',
    'instructor',
    'technician',
    'verify insurance',
    'driver',
    'building automation',
    'project sales',
    'prospect application',

    // Title artifacts that aren't a real job (donor:251-252)
    'talent community',

    // Other healthcare-adjacent roles that aren't NP (donor:254-257)
    'neurologist',
    'collaborating psychiatrist',
    'nocturnist',

    // Non-human "nurse practitioner" roles. NOT in the donor list —
    // added because this engine's Tier 2 accepts any 'nurse
    // practitioner' title, so vet-clinic postings ("Veterinary Nurse
    // Practitioner", a UK-style vet-nurse role) need an explicit veto.
    'veterinary',
    'veterinarian',

    // Common typo (donor:260)
    'centralized nurse practioner',
];

/**
 * Titles too generic to confirm an NP/APRN role — need an NP-credential
 * word in the title itself (TITLE_CONTEXT_WORDS) or an NP-ish employer.
 * The PMHNP pack listed bare 'nurse practitioner' here; that entry is
 * REMOVED because generic NP titles now pass on their own (donor
 * job-filter.ts:8-9,21). What remains are APP/APN forms the donor also
 * did NOT accept bare (donor Tier-1 required 'app - ' with a specialty
 * suffix, donor:150-152): "APP" alone could be a PA-only posting.
 */
export const GENERIC_NP_TITLES = [
    'app',
    'apn',
    'inpatient app',
    'outpatient app',
    'advanced practice professional',
    'advanced practice clinician', // was a PMHNP-pack NEGATIVE; APCs are NP-or-PA, so guard instead of veto
];

/**
 * Loose NP-credential context — checked in title and description for
 * Tier 2 (NP-title + credential-context) and the generic-title guard.
 *
 * Semantic shift: the PMHNP pack put psych vocabulary here; for the
 * all-NP board the "context" that confirms relevance is NP/APRN
 * credential vocabulary (donor POSITIVE_KEYWORDS, job-filter.ts:33-156).
 * Because the engine checks context against title+description combined,
 * any title containing an NP role marker self-satisfies Tier 2 — which
 * reproduces the donor's "generic Nurse Practitioner passes on its own"
 * behavior (donor:8-9) without engine changes.
 */
export const MENTAL_HEALTH_CONTEXT_TERMS = [
    'nurse practitioner',
    'aprn',
    'arnp',
    'advanced practice',
    'np-c',
    'np-bc',
    'fnp',
    'agnp',
    'agacnp',
    'pmhnp',
    'whnp',
    'nnp-bc',
    'crna',
    'nurse anesthetist',
    'nurse midwife',
    'nurse-midwife',
    'certified nurse midwife',
    'clinical nurse specialist',
    'dnp',
    // Dual-role tokens so bare "NP/PA"-style titles satisfy Tier 2
    // (donor accepted these via its \bnp\b positive, donor:37-40)
    'np/pa',
    'np or pa',
    'pa/np',
    'pa or np',
    'np - ',
];

/**
 * Veto: title defines a role that is NOT a human-NP job at all. For the
 * all-NP board this list shrinks drastically — FNP / women's-health /
 * pediatric / oncology / geriatric NP titles from the PMHNP pack are
 * all IN scope now (donor job-filter.ts:10-13,163-169). What remains is
 * the veterinary "nurse practitioner" title class (also vetoed by
 * NEGATIVE_KEYWORDS, which is the harder stop because TITLE_CONTEXT_WORDS
 * legitimately rescues 'nurse practitioner' titles from this veto).
 * This list also feeds the query-time off-specialty exclusion in
 * lib/filters.ts, hiding already-ingested vet rows.
 */
export const OFF_SPECIALTY_TITLE_MARKERS = [
    'veterinary',
    'veterinarian',
];

/**
 * Non-provider / non-NP roles that are not NP postings even when the JD
 * mentions nurse practitioners (e.g. a recruiter sourcing NPs).
 * Excluded at query time unless the title carries an NP/PA credential.
 * PMHNP-pack list retained (psychometrist / mental-health coordinator /
 * epileptologist still leak from the board's psych segment) plus the
 * donor's admin/sales cluster (donor job-filter.ts:221-249).
 */
export const NON_PROVIDER_TITLE_MARKERS = [
    'epileptologist', 'recruitment', 'recruiter', 'patient acquisition',
    'talent acquisition', 'director of growth', 'psychometrist',
    'mental health coordinator', 'patient access', 'sales representative',
    'account executive', 'business development', 'medical science liaison',
    'bookings specialist',
];

/**
 * Description terms specific enough that their presence means the role
 * really recruits an NP/APRN — used to RESCUE off-specialty / generic
 * dual-role titles. For the all-NP board these are explicit credential
 * strings (donor job-filter.ts:33-156): a JD that spells out
 * "nurse practitioner", "APRN", "FNP-C", "CRNA" etc. is recruiting one.
 */
export const STRONG_PSYCH_DESC_TERMS = [
    'nurse practitioner', 'aprn', 'arnp', 'advanced practice registered nurse',
    'pmhnp', 'fnp-c', 'fnp-bc', 'np-c', 'agacnp', 'whnp',
    'crna', 'nurse anesthetist', 'certified nurse midwife', 'nurse midwife',
    'clinical nurse specialist', 'dnp',
];

/**
 * Repeated-loose-context threshold for hasStrongPsychContext. Context
 * terms are now credential strings, so TWO independent NP-vocabulary
 * hits in a posting is a strong recruit signal (a JD that merely
 * mentions "collaborates with the NP team" once stays below it).
 * Lowered from the PMHNP pack's 3 (its loose psych vocabulary needed a
 * higher bar); rationale: donor treated a single credential mention as
 * sufficient (donor Tier-1 on description, job-filter.ts:442-447).
 */
export const STRONG_PSYCH_CONTEXT_MIN_HITS = 2;

/**
 * Employer name patterns that suggest a clinical / NP-employing org.
 * The donor had NO employer heuristics (donor classifyRelevance ignores
 * its employer param, job-filter.ts:391), so this is a conservative
 * minimal set: it only fires Tier 2.5 when the TITLE already carries an
 * NP role marker, and it rescues generic APP/APN titles at obviously
 * clinical employers.
 */
export const PSYCH_EMPLOYER_PATTERNS = [
    'health',
    'medical',
    'clinic',
    'hospital',
    'healthcare',
    'medicine',
    'wellness',
    'nursing',
    'physicians',
];

/**
 * Named NP-employing orgs whose NAMES carry no clinical keyword, so
 * PSYCH_EMPLOYER_PATTERNS misses them. Donor had no allowlist; the
 * PMHNP pack's telehealth/psych orgs are retained — they are real NP
 * employers (PMHNPs are NPs) posting generic "Prescribing NP or PA"
 * contractor titles.
 */
export const PSYCH_EMPLOYER_ALLOWLIST = [
    'lyra health',
    'talkiatry',
    'brightside health',
    'sondermind',
    'cerebral',
    'two chairs',
    'grow therapy',
];

/**
 * Title patterns indicating a dual-role posting (NP OR PA, NP/PA, etc.).
 * When a title is dual-role, the negative-keyword check skips
 * `physician`, `physician assistant`, `pa-c`, ` pa ` — those words are
 * structurally part of the dual-role offer, not a wrong-role signal.
 * Identical in donor (job-filter.ts:269-292) and the PMHNP pack.
 */
export const DUAL_ROLE_PATTERNS = [
    'nurse practitioner or physician assistant',
    'physician assistant or nurse practitioner',
    'np or pa',
    'pa or np',
    'np / pa',
    'pa / np',
    'np /pa',
    'pa /np',
    'np/ pa',
    'pa/ np',
    'np/pa',
    'pa/np',
    'np-pa',
    'pa-np',
    'nurse practitioner / physician assistant',
    'physician assistant / nurse practitioner',
    'nurse practitioner /pa',
    'nurse practitioner / pa',
    'pa / nurse practitioner',
    'pa /nurse practitioner',
    'np / physician assistant',
    'physician assistant / np',
];

/** Negative keywords skipped for dual-role titles (donor job-filter.ts:294-300). */
export const DUAL_ROLE_NEGATIVE_KEYWORDS = [
    'physician',
    'physician assistant',
    'pa-c',
    ' pa ',
    'medical pa',
];

/**
 * Title markers identifying an advanced-practice-nurse role. APRNs ARE
 * registered nurses with advanced training, so bare RN negatives must not
 * catch these titles (see APRN_NEGATIVE_OVERRIDES).
 * 'advanced practice nurse' added per donor isAprnTitle (job-filter.ts:315-322).
 */
export const APRN_TITLE_MARKERS = [
    'advanced practice registered nurse',
    'advanced practice nurse',
    'aprn',
    'arnp',
];

/**
 * Negative keywords that should be skipped when the title clearly
 * announces an advanced-practice nurse role.
 * ' rn,' added per donor (job-filter.ts:307-313).
 */
export const APRN_NEGATIVE_OVERRIDES = [
    'registered nurse',
    ' rn ',
    ' rn,',
    ' rn-',
    '-rn ',
];

/**
 * Tier-2 "is this a role title at all" markers: substring markers plus a
 * word-boundary regex covering the donor's short abbreviation tokens
 * (donor job-filter.ts:37-40,108-155 used space-padded/regex forms; a
 * title-only word-boundary regex is the substring-engine-safe home for
 * them — 'cns'/'app'/'cnm' are unsafe as description substrings).
 */
export const ROLE_TITLE_MARKERS = [
    'nurse practitioner',
    'aprn',
    'arnp',
    'nurse anesthetist',
    'nurse midwife',
    'nurse-midwife',
    'clinical nurse specialist',
    'advanced practice provider',
    'advanced practice nurse',
];
export const ROLE_TITLE_REGEX =
    /\b(?:np|fnp|agnp|agpcnp|agacnp|pnp|acpnp|cpnp|nnp|whnp|acnp|enp|onp|pmhnp|crna|cnm|cns|apn|app)\b/;

/**
 * Tier-3 catch-all: a mention ANYWHERE (title or description) passes
 * Tier 1. 'nurse practitioner' spelled out is the donor's #1 positive
 * (job-filter.ts:35) and is safe as a substring; wrong-role titles that
 * merely mention it in the description are still killed by
 * NEGATIVE_KEYWORDS (same net behavior as donor steps 1+3).
 */
export const CATCH_ALL_TERM = 'nurse practitioner';

/**
 * Words that count as "the title itself carries an NP signal" — used by
 * the off-specialty veto rescue, the generic-title guard, and the
 * dual-role guard. NP-credential vocabulary (donor job-filter.ts:33-156);
 * short tokens here are title-only, where 'fnp'/'crna'/'cnm' substrings
 * are unambiguous.
 */
export const TITLE_CONTEXT_WORDS = [
    'nurse practitioner',
    'aprn',
    'arnp',
    'pmhnp',
    'fnp',
    'crna',
    'cnm',
    'nurse anesthetist',
    'nurse midwife',
    'nurse-midwife',
    'clinical nurse specialist',
    'np-c',
    'np/pa',
    'np or pa',
    'pa/np',
    'pa or np',
    'np - ',
];

/**
 * Negative keywords that are ALLOWED when specific indicator terms co-occur
 * anywhere in the posting. Retained from the PMHNP pack (donor dropped the
 * mechanism, relying on its title-positive short-circuit): 'psychiatrist'
 * is fine in collaborative-care / dual-role psychiatrist+NP postings,
 * which the board's psych segment still ingests.
 */
export const WRONG_ROLE_CO_OCCURRENCE_EXCEPTIONS: Record<string, readonly string[]> = {
    psychiatrist: [
        'pmhnp',
        'nurse practitioner',
        'np-bc',
        'aprn',
        'arnp',
        'psych np',
    ],
};

// ─── Query-time mirror vocabularies (lib/filters.ts GLOBAL_EXCLUSIONS) ──────
// The query-time gate protects rows ALREADY in the database (ingested before
// a filter fix) without a data migration. For the all-NP board these become
// NP-credential vocabularies; description text is intentionally NOT
// consulted at query time.

/**
 * NP-credential signal in the TITLE that rescues a title from the
 * query-time off-specialty (veterinary) and dual-role exclusions.
 * Historical export name retained — lib/filters.ts imports it by name.
 */
export const PSYCH_TITLE_SIGNALS = [
    'nurse practitioner', 'pmhnp', 'aprn', 'arnp', 'fnp', 'crna', 'cnm',
    'nurse anesthetist', 'nurse midwife', 'clinical nurse specialist',
    ' np', 'np-c', 'np/pa', 'np or pa',
];

/**
 * NP/PA credential signals that protect a real provider from the query-time
 * non-provider exclusion (a recruiter/psychometrist title carries none).
 */
export const NP_CREDENTIAL_SIGNALS = [
    'nurse practitioner', 'pmhnp', 'aprn', 'arnp', ' np', 'np-c', 'fnp',
    'crna', 'cnm', 'nurse anesthetist', 'nurse midwife',
    'clinical nurse specialist', 'physician assistant', 'pa-c',
];

/**
 * Confirmed non-NP employers emitting "nurse"-adjacent titles that are
 * not human-NP roles (veterinary chains). The PMHNP pack's entries
 * (ChenMed etc.) are REMOVED — senior/primary-care orgs ARE in-scope NP
 * employers on this board. Donor had no employer blocklist; this is a
 * conservative seed, to be grown from rejected_jobs/audit data.
 */
export const NON_PSYCH_EMPLOYER_BLOCKLIST = [
    'banfield pet hospital',
    'vca animal hospital',
    'bluepearl',
    'thrive pet healthcare',
];

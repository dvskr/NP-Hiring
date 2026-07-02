/**
 * Niche relevance pack — ALL keyword data consumed by the relevance
 * engine (lib/utils/job-filter.ts) and its query-time mirror
 * (lib/filters.ts GLOBAL_EXCLUSIONS). This file is DATA ONLY; the
 * tier/veto/rescue mechanics live in the engine and are niche-agnostic.
 *
 * ── FOR FORKS ─────────────────────────────────────────────────────────
 * This is the single most quality-critical file to retune per niche.
 * The PMHNP values below encode months of dated production-audit fixes
 * (see inline notes). A new niche needs:
 *   1. Its own positive keywords (role titles + credential strings +
 *      common misspellings seen in real postings).
 *   2. Its own negative keywords (wrong provider types, wrong
 *      specialties, non-provider roles) — START STRICT and loosen with
 *      rejected_jobs data; every REMOVED note below is a false-positive
 *      class someone had to discover in production.
 *   3. Context/rescue vocabularies sized to the niche (loose context
 *      terms, strong "definitely this specialty" terms, employer name
 *      patterns, employer allowlist).
 *   4. Its own audit cycle: run scripts/deep-relevance-audit.ts (and
 *      the rejected_jobs funnel) weekly for the first month.
 * Every list keeps its historical name — the engine imports them by
 * name, and lib/filters.ts mirrors four of them into SQL WHERE clauses,
 * so ingest-time and query-time gates can never drift apart.
 *
 * ── MECHANISM MAP (which knob feeds which engine layer) ───────────────
 *   POSITIVE_KEYWORDS            Tier 1: instant pass signal
 *   MENTAL_HEALTH_CONTEXT_TERMS  Tier 2: loose context (title-NP + context)
 *   ROLE_TITLE_MARKERS/_REGEX    Tier 2: "is this an NP-role title at all"
 *   CATCH_ALL_TERM               Tier 3: last-chance substring anywhere
 *   PSYCH_EMPLOYER_PATTERNS      Tier 2.5: employer-name heuristic
 *   PSYCH_EMPLOYER_ALLOWLIST     Tier 2.5: named employers w/o psych words
 *   OFF_SPECIALTY_TITLE_MARKERS  Veto: title defines ANOTHER specialty
 *   STRONG_PSYCH_DESC_TERMS      Rescue: specialty-specific description terms
 *   STRONG_PSYCH_CONTEXT_MIN_HITS Rescue: repeated loose-context threshold
 *   TITLE_CONTEXT_WORDS          Rescue: psych word in the title itself
 *   GENERIC_NP_TITLES            Guard: too-generic titles need title/employer psych signal
 *   NEGATIVE_KEYWORDS            Wrong-role kill list (title match)
 *   DUAL_ROLE_PATTERNS/_NEGATIVE_KEYWORDS  Exception: "NP or PA" postings
 *   APRN_TITLE_MARKERS/_NEGATIVE_OVERRIDES Exception: APRN titles vs RN negatives
 *   WRONG_ROLE_CO_OCCURRENCE_EXCEPTIONS    Exception: negative allowed when indicators co-occur
 *   NON_PROVIDER_TITLE_MARKERS   Query-time mirror only (lib/filters.ts)
 */

export const POSITIVE_KEYWORDS = [
    'pmhnp',
    'psychiatric nurse practitioner',
    'psych nurse practitioner',
    'mental health nurse practitioner',
    'psychiatric mental health nurse practitioner',
    'psychiatric-mental health nurse practitioner',
    'psychiatric aprn',
    'psychiatric prescriber',
    'behavioral health nurse practitioner',
    'behavioral health np',
    'psych np',
    'mental health np',
    'psychiatric np',
    'pmhnp-bc',
    'fpmhnp',
    'pmnhp', // Common misspelling of PMHNP
    'app - psychiatry',
    'advanced practice provider - psychiatry',
    'nurse practitioner - psychiatry',
    'nurse practitioner - mental health',
    'nurse practitioner - behavioral health',
    'np - psychiatry',
    'np - mental health',
    'nurse practitioner psychiatry',
    'nurse practitioner mental health',
    'nurse practitioner behavioral health',
    'np psychiatry',
    'np mental health',
    'np behavioral health',
    // Headway/Jooble title variants (previously rejected by normalizer)
    'licensed psychiatric np',
    'licensed psychiatric nurse practitioner',
];

export const NEGATIVE_KEYWORDS = [
    // Wrong provider type
    'physician',
    'medical doctor',
    ' m.d.',
    ' d.o.',
    'social worker',
    'therapist',
    'counselor',
    'psychiatrist',
    'practical nurse',
    ' lpn',
    ' lvn',
    ' cna',
    'medical assistant',
    'verify insurance',
    'receptionist',
    'scheduler',
    'driver',
    'dietitian',
    'nutritionist',
    'occupational therapist',
    'physical therapist',
    'speech therapist',
    'primary care',
    // NOTE: 'fnp' and 'family nurse practitioner' REMOVED — many dual-certified PMHNP/FNP postings exist
    'home based',
    'community care clinic',
    'emergency medicine',
    'acute care',
    'cardiology',
    'dermatology',
    'surgical',
    'orthopedic',
    'urology',
    'occupational health',
    // Non-provider roles
    'registered nurse',
    ' rn ',
    ' rn-',
    '-rn ',
    'lecturer',
    'instructor',
    'technician',
    // NOTE: 'coordinator' narrowed — 'scheduling coordinator', 'intake coordinator' etc still blocked
    'scheduling coordinator',
    'intake coordinator',
    'referral coordinator',
    'case manager',
    'program director',
    // NOTE: 'manager' narrowed — clinical roles like 'Clinical Manager - PMHNP' now allowed
    'office manager',
    'facility manager',
    'practice manager',
    // NOTE: 'associate' REMOVED — blocks legitimate roles like 'Associate Clinical Director - PMHNP'
    // NOTE: 'assistant' REMOVED — blocks dual-role 'Physician Assistant / PMHNP' postings
    'lcsw',
    'lmft',
    'licsw',
    'lpc',
    'phd',
    'psy d',
    'psychologist',
    'medical director',
    // NOTE: 'director of' narrowed — 'Director of Psychiatric Services' (with NP req) now allowed
    'director of nursing',
    'director of operations',
    'director of finance',
    // NOTE: 'graduate' REMOVED — blocks 'New Graduate PMHNP' positions
    // NOTE: 'child adolescent' REMOVED — blocks 'Child & Adolescent PMHNP' subspecialty
    // NOTE: 'outpatient position' REMOVED — blocks 'Outpatient PMHNP Position'
    // Gap closing: titles leaking from adzuna, jooble, lever, etc.
    'chiropractor',
    'hospitalist',
    'physician assistant',
    'pa-c',
    ' pa ',
    'locum tenens psychiatrist',
    'clinical nurse specialist',
    'medical front office',
    'talent community',
    ' icu ',
    'anesthesia',
    'pain management',
    'advanced practice clinician',
    // NOTE: 'family medicine' REMOVED — some PMHNP roles coexist with family medicine depts
    'nocturnist',
    'pediatric icu',
    'collaborating psychiatrist',
    // Gap closing round 3: from Feb 2026 audit of leaked jobs
    'neurologist',
    'interim cfo',
    'cfo',
    'building automation',
    'project sales',
    'recruiter',
    'recruitment',
    'patient acquisition',
    'talent acquisition',
    'director of growth',
    'patient access',
    'psychometrist',
    'mental health coordinator',
    'epileptologist',
    'business development',
    'bookings specialist',
    'medical science liaison',
    'lmsw',
    'lcpc',
    'lgpc',
    'prospect application',
    'pediatric nurse practitioner',
    'pediatric np',
    'pediatrics nurse practitioner',
    'women\'s health nurse practitioner',
    'women\'s health np',
    'certified nurse midwife',
    'nurse midwife',
    'midwife',
    'substance abuse nurse practitioner',
    'addiction medicine nurse practitioner',
    'travel nurse practitioner',
    'outpatient rn',
    'inpatient rn',
    'skilled nursing',
    'walk-in clinic',
    'urgent care',
    'oncology',
    'endocrinology',
    'gastroenterology',
    'nephrology',
    'pulmonology',
    'rheumatology',
    'hematology',
    'neurology',
    'bariatric',
    'neonatal',
    'labor and delivery',
    ' pace ',
    'wound care',
    'palliative',
    // NOTE: 'hospice' REMOVED — psychiatric hospice roles exist
    'nursing home',
    'long term care',
    'long-term care',
    'home health',
    'infusion',
    'dialysis',
    'transplant',
    // NOTE: 'float' REMOVED — 'Float PMHNP' is a common staffing model
    'medical np',
    'medical pa',
    'centralized nurse practioner', // Typo in Firsthand posting
];

/** Titles that are so generic they need STRONG psychiatric context in both title and description */
export const GENERIC_NP_TITLES = [
    'nurse practitioner',
    'advanced practice provider',
    'advanced practice nurse',
    'advanced practice professional',
    'app',
    'apn',
    'inpatient app',
    'outpatient app',
    'prn nurse practitioner',
    'part time nurse practitioner',
    'part-time nurse practitioner',
    'weekend nurse practitioner',
    'clinical nurse practitioner',
    'pnp',
    'lpnp',
];

/**
 * Mental-health context terms — checked in title and description for
 * Tier 2 (NP-in-title + psych-context) and the generic-title guard.
 *
 * Extended 2026-05-05 to cover substance-abuse / addiction / MAT
 * vocabulary — these were missed before, causing roles at recovery
 * centers and substance-abuse clinics to be rejected.
 */
export const MENTAL_HEALTH_CONTEXT_TERMS = [
    'mental health',
    'psychiatric',
    'behavioral health',
    'psychiatry',
    'addiction',
    'substance use',
    'substance abuse',
    'mat program',
    'medication-assisted treatment',
    'medication assisted treatment',
    'recovery center',
    'dual diagnosis',
    'suboxone',
    'buprenorphine',
];

/**
 * Specialties that, when they DEFINE the role in the TITLE, mean the posting is
 * NOT psychiatric — unless a STRONG psych signal rescues it (psych in the title,
 * a positive PMHNP keyword, a psych employer, or psych-specific description
 * terms). This closes the biggest leak: primary-care / hospice NP JDs (One
 * Medical, Ennoble Care) that merely list "behavioral health" once among many
 * services tripped the loose Tier-2 mental-health-context check and passed.
 */
export const OFF_SPECIALTY_TITLE_MARKERS = [
    'family nurse practitioner', 'family np', 'fnp',
    'primary care', 'internal medicine', 'family medicine', 'family practice',
    'hospice', 'palliative',
    "women's health", 'whnp', 'nurse midwife', 'midwife', 'ob/gyn', 'obgyn',
    'urgent care', 'walk-in clinic',
    'dermatology', 'aesthetic', 'med spa', 'medspa',
    'wound care', 'occupational health',
    'dialysis', 'nephrology', 'oncology', 'hematology', 'cardiology',
    'gastroenterology', 'endocrinology', 'pulmonology', 'rheumatology',
    'orthopedic', 'urology', 'neonatal', 'labor and delivery',
    'pediatric nurse practitioner', 'pediatric np', 'pediatrics nurse practitioner',
    'geriatric', 'geriatrics', 'gerontology',
    // Curly-apostrophe variant — aggregator titles often use U+2019, which the
    // straight-quote "women's health" above misses.
    'women’s health',
];

/**
 * Non-provider / non-NP roles that are not PMHNP postings even when the JD
 * mentions psychiatry (e.g. a recruiter sourcing PMHNPs, a psychometrist doing
 * testing). Excluded unless the title actually carries an NP/PA credential.
 */
export const NON_PROVIDER_TITLE_MARKERS = [
    'epileptologist', 'recruitment', 'recruiter', 'patient acquisition',
    'talent acquisition', 'director of growth', 'psychometrist',
    'mental health coordinator', 'patient access', 'sales representative',
    'account executive', 'business development',
];

/**
 * Psych terms specific enough that their presence means the role really is
 * psychiatric — vs a primary-care JD that lists "behavioral health" once. These
 * RESCUE off-specialty / generic titles where the loose MENTAL_HEALTH_CONTEXT_TERMS
 * (which includes a bare "behavioral health"/"mental health" mention) must not.
 */
export const STRONG_PSYCH_DESC_TERMS = [
    'psychiatric', 'psychiatry', 'pmhnp', 'telepsychiatry', 'telepsych',
    'psychotropic', 'psychotherapy', 'mental illness', 'bipolar', 'schizophren',
    // Addiction / SUD is in-scope for this board, and these terms are specific
    // enough that primary care won't carry them — so they rescue an off-specialty
    // or generic title (e.g. "Family NP — Telehealth SUD", "NP/PA (OTP)").
    'substance use disorder', 'opioid use disorder', 'alcohol use disorder',
    'suboxone', 'buprenorphine', 'methadone', 'opioid treatment',
    'medication-assisted treatment', 'medication assisted treatment',
    'addiction medicine', ' otp ',
];

/**
 * Repeated-loose-context threshold for hasStrongPsychContext: a real psych
 * JD mentions mental-health vocabulary throughout; a primary-care JD lists
 * "behavioral health" once among many services.
 */
export const STRONG_PSYCH_CONTEXT_MIN_HITS = 3;

/**
 * Employer name patterns that strongly suggest a psych-focused org.
 * Used as an additional Tier 2.5 signal — a generic NP title at
 * "Senior PsychCare" or "Kanza Mental Health" should pass even
 * though title alone lacks psych context.
 */
export const PSYCH_EMPLOYER_PATTERNS = [
    'psych',          // PsychCare, Psychiatric, Psychotherapy, etc.
    'mental health',
    'behavioral health',
    'behavioral',     // Behavioral Center / Behavioral Wellness
    'recovery',       // Recovery centers, addiction
    'addiction',
    'substance',
    'counseling',     // Counseling & Wellness centers
];

/**
 * Well-known psychiatric / mental-health employers whose NAMES carry no psych
 * keyword, so PSYCH_EMPLOYER_PATTERNS misses them. They post real PMHNP roles
 * (often generic "Prescribing NP or PA" contractor titles), so without this
 * allowlist the generic-title / off-specialty guards wrongly reject them.
 * Keep names specific enough not to collide with unrelated companies.
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

/** Negative keywords skipped for dual-role titles (see DUAL_ROLE_PATTERNS). */
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
 */
export const APRN_TITLE_MARKERS = [
    'advanced practice registered nurse',
    'aprn',
    'arnp',
];

/**
 * Negative keywords that should be skipped when the title clearly
 * announces an advanced-practice nurse role.
 */
export const APRN_NEGATIVE_OVERRIDES = [
    'registered nurse',
    ' rn ',
    ' rn-',
    '-rn ',
];

/**
 * Tier-2 "is this a role title at all" markers: substring markers plus a
 * word-boundary regex so titles starting with NP / NP- match too.
 */
export const ROLE_TITLE_MARKERS = ['nurse practitioner', 'aprn', 'arnp'];
export const ROLE_TITLE_REGEX = /\bnp\b/;

/** Tier-3 catch-all: a mention ANYWHERE (title or description) passes Tier 1. */
export const CATCH_ALL_TERM = 'pmhnp';

/**
 * Words that count as "the title itself carries a psych signal" — used by
 * the off-specialty veto rescue and the generic-title guard.
 */
export const TITLE_CONTEXT_WORDS = ['psych', 'mental health', 'behavioral health', 'pmhnp', 'telepsych'];

/**
 * Negative keywords that are ALLOWED when specific indicator terms co-occur
 * anywhere in the posting. PMHNP case: 'psychiatrist' is fine in
 * collaborative-care / dual-role psychiatrist+PMHNP postings.
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
// a filter fix) without a data migration. Its vocabularies are deliberately
// slightly different from the ingest engine's — title signals include the
// addiction/SUD rescue terms, and description text is intentionally NOT
// consulted at query time.

/**
 * Psychiatric signal in the TITLE that rescues an off-specialty title from
 * the query-time off-specialty exclusion (e.g. "Psychiatric Family NP",
 * "Family NP - Substance Use Disorder"). Addiction/SUD is in-scope,
 * mirroring the ingest gate's addiction rescue.
 */
export const PSYCH_TITLE_SIGNALS = [
    'psych', 'mental health', 'behavioral health', 'pmhnp', 'telepsych',
    'substance use', 'addiction', 'suboxone', 'opioid treatment', 'otp',
];

/**
 * NP/PA credential signals that protect a real provider from the query-time
 * non-provider exclusion (a recruiter/psychometrist title carries none).
 */
export const NP_CREDENTIAL_SIGNALS = [
    'nurse practitioner', 'pmhnp', 'aprn', 'arnp', ' np', 'physician assistant', 'pa-c',
];

/**
 * Confirmed non-psychiatric aggregator employers (senior / primary care, SNF,
 * general federal staffing) that emit generic "Nurse Practitioner" titles with
 * no psych signal. Hidden at query time UNLESS the posting itself carries a
 * psych title. Stopgap for confirmed offenders — the durable controls are the
 * ingest gate + the periodic audit (scripts/audit/audit-non-pmhnp.ts).
 */
export const NON_PSYCH_EMPLOYER_BLOCKLIST = ['chenmed', 'akido labs', 'truhealth', 'akicita'];

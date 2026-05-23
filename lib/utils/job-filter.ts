/**
 * Relevance filter for NP Hiring — accepts all Nurse Practitioner specialties
 * + the APRN cohort (CRNA, CNM, CNS).
 *
 * Forked from PMHNP-only filter (2026-05-23). Key broadening changes:
 *   - POSITIVE_KEYWORDS now covers FNP, AGNP, PNP, NNP, WHNP, ACNP, AGACNP,
 *     CPNP, ENP, ONP plus the broader APRN cohort.
 *   - Generic "Nurse Practitioner" now PASSES on its own (was rejected when
 *     this was PMHNP-only). The board's job is to surface NP jobs, period.
 *   - NEGATIVE_KEYWORDS pruned: other NP specialties that were rejected
 *     by the PMHNP filter (pediatric NP, women's health NP, family NP,
 *     travel NP, oncology, cardiology, etc.) are now accepted because they
 *     ARE NPs — just in different specialties.
 *   - MENTAL_HEALTH_CONTEXT_TERMS retained for one tier-bump case but no
 *     longer required for acceptance.
 *
 * Criteria (in order):
 *   1. NEGATIVE keyword in title indicating clearly-not-an-NP role → REJECT
 *      (with dual-role and APRN exceptions)
 *   2. Explicit NP/APRN specialty in title or description → ACCEPT
 *   3. Generic "Nurse Practitioner" / "NP" / "APRN" in title → ACCEPT
 *   4. Default → REJECT
 */

/**
 * Titles/abbreviations that affirmatively mark a job as NP or APRN.
 * Match anywhere in title or description.
 *
 * Why these ordering choices: short tokens like ' np ' have to be space-padded
 * (caller substring-matches against ` ${title} ${description} ` lowercased) to
 * avoid matching inside words like 'snp' (Special Needs Plan).
 */
const POSITIVE_KEYWORDS = [
    // Generic NP / APRN markers
    'nurse practitioner',
    ' np ',
    ' np,',
    ' np-',
    '-np ',
    '(np)',
    'aprn',
    'arnp',
    'advanced practice registered nurse',
    'advanced practice nurse',
    'advanced practice provider',

    // Common NP specialty title keywords (full forms)
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
    'women\'s health nurse practitioner',
    'womens health nurse practitioner',
    'women\'s health np',
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

    // PMHNP / behavioral health (the original niche — still in scope)
    'pmhnp',
    'pmhnp-bc',
    'fpmhnp',
    'pmnhp', // common misspelling
    'psychiatric nurse practitioner',
    'psych nurse practitioner',
    'mental health nurse practitioner',
    'psychiatric mental health nurse practitioner',
    'psychiatric-mental health nurse practitioner',
    'psychiatric aprn',
    'behavioral health nurse practitioner',
    'behavioral health np',
    'psych np',
    'mental health np',
    'psychiatric np',
    'psych aprn',

    // NP specialty abbreviations (require space padding — caller adds spaces)
    ' fnp ',
    ' fnp,',
    'fnp-bc',
    'fnp-c',
    ' fnp-',
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

    // APRN cohort (broader than NP — these are still advanced-practice nurses
    // with master's/doctoral training, prescribing in most cases)
    'certified registered nurse anesthetist',
    ' crna ',
    'crna,',
    'crna ',
    'nurse anesthetist',
    'certified nurse midwife',
    ' cnm ',
    'cnm,',
    'nurse midwife',
    'clinical nurse specialist',
    ' cns ',
    'cns,',

    // Common "APP - Specialty" patterns (advanced practice provider)
    'app - ',
    'app-',
    'advanced practice provider - ',
    'nurse practitioner - ',
    'np - ',
];

/**
 * Disqualifying keywords. If found in the TITLE only (not description), the
 * job is rejected unless the title also has a positive NP indicator, or one
 * of the dual-role / APRN exception predicates fires.
 *
 * What was REMOVED (compared to the PMHNP filter): other NP specialties.
 * Pediatric NP, family NP, women's-health NP, travel NP, acute care, oncology,
 * cardiology, etc. ARE NPs — they're now in scope.
 *
 * What is RETAINED: roles that are not NPs at all (physicians, RNs, LPNs,
 * therapists, admin staff).
 */
const NEGATIVE_KEYWORDS = [
    // Wrong provider class
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

    // Non-advanced nursing (lower tier than NP)
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
    'pct',

    // Allied / non-nursing clinicians
    'social worker',
    ' lcsw',
    ' licsw',
    ' lmsw',
    'therapist',
    'counselor',
    ' lmft',
    ' lpc',
    ' lcpc',
    ' lgpc',
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

    // Admin / support roles
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

    // Title artifacts that aren't a real job
    'talent community',

    // Other healthcare-adjacent roles that aren't NP
    'neurologist',
    'collaborating psychiatrist',
    'nocturnist',

    // Common typo
    'centralized nurse practioner',
];

/**
 * Title patterns indicating a dual-role posting (NP OR PA, NP/PA, etc.).
 * When a title is dual-role, the negative-keyword check skips
 * `physician`, `physician assistant`, `pa-c`, ` pa ` — those words are
 * structurally part of the dual-role offer, not a wrong-role signal.
 */
const DUAL_ROLE_PATTERNS = [
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

const DUAL_ROLE_NEGATIVE_KEYWORDS = new Set([
    'physician',
    'physician assistant',
    'pa-c',
    ' pa ',
    'medical pa',
]);

/**
 * APRNs are technically registered nurses with advanced training, so bare
 * 'registered nurse' / ' rn ' negatives wrongly catch valid APRN titles.
 * Skip those negatives when the title clearly announces APRN status.
 */
const APRN_NEGATIVE_OVERRIDES = new Set([
    'registered nurse',
    ' rn ',
    ' rn,',
    ' rn-',
    '-rn ',
]);

function isAprnTitle(titleLower: string): boolean {
    return (
        titleLower.includes('advanced practice registered nurse') ||
        titleLower.includes('advanced practice nurse') ||
        titleLower.includes('aprn') ||
        titleLower.includes('arnp')
    );
}

function isDualRoleTitle(titleLower: string): boolean {
    return DUAL_ROLE_PATTERNS.some((p) => titleLower.includes(p));
}

/**
 * Build word-boundary regex matchers for each keyword.
 *
 * Why: substring `.includes()` matching is fragile around punctuation.
 * Example failures we observed in the 2026-05-23 smoke test:
 *   - " lpn" (space-padded) did NOT match "(LPN)" in title "Care
 *     Manager (LPN)" because the leading char is "(" not " ".
 *   - " pa " did NOT match "PA-C, Bilingual" for the same reason.
 *
 * Word-boundary `\b` matches at any non-alphanumeric transition, so
 * "(LPN)" / "PA-C" / "[FNP-BC]" / "NP," / "NP." all match correctly.
 *
 * Built once at module-load; runtime cost is one regex test per keyword
 * per filter call (~150 negatives × 1 title = ~150 cheap regex tests).
 */
function buildBoundaryPattern(keyword: string): RegExp {
    // Trim surrounding whitespace (legacy keyword lists used space-padding
    // as a poor-man's word boundary); regex \b handles boundaries proper.
    const trimmed = keyword.trim();
    // Escape regex metacharacters (parens, periods, hyphens, etc.).
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // \b only fires at alphanumeric→non-alphanumeric edges. For tokens
    // starting/ending with a non-word char (e.g. "(np)"), use a tolerant
    // boundary that also accepts string start/end + whitespace + punctuation.
    const startsWithWord = /^\w/.test(trimmed);
    const endsWithWord = /\w$/.test(trimmed);
    const leftBoundary = startsWithWord ? '\\b' : '';
    const rightBoundary = endsWithWord ? '\\b' : '';
    return new RegExp(`${leftBoundary}${escaped}${rightBoundary}`, 'i');
}

const POSITIVE_PATTERNS = POSITIVE_KEYWORDS.map(buildBoundaryPattern);
const NEGATIVE_PATTERNS_INDEXED: Array<[string, RegExp]> = NEGATIVE_KEYWORDS.map(
    (kw) => [kw, buildBoundaryPattern(kw)],
);

/**
 * Reasons a job can be rejected at the relevance gate.
 *
 * `relevance_filter` is kept as a catch-all for backward compat — new
 * code paths emit one of the more specific values so rejected_jobs
 * audit becomes actionable. See lib/ingestion-service.ts for the caller.
 */
export type RelevanceReason =
    | 'pass'
    | 'relevance_no_keyword'    // No NP/APRN signal anywhere
    | 'relevance_wrong_role';   // Negative-keyword in title without override

export interface RelevanceResult {
    passes: boolean;
    reason: RelevanceReason;
}

/**
 * Classify a job's relevance for the NP Hiring board.
 *
 * @param title       Job title (raw from source).
 * @param description Job description (raw — HTML is fine, we lowercase-substring).
 * @param employer    Employer name. Optional but improves edge cases.
 */
export function classifyRelevance(
    title: string = '',
    description: string = '',
    _employer: string = '',
): RelevanceResult {
    // Pad with spaces so word-boundary patterns like ' np ' match at edges.
    const combinedText = ` ${title} ${description} `.toLowerCase();
    const titleLower = ` ${title} `.toLowerCase();
    const dualRole = isDualRoleTitle(titleLower);
    const aprn = isAprnTitle(titleLower);

    // 1. Strong wrong-role filter on TITLE.
    // Exceptions:
    //   - Dual-role NP/PA titles skip the PA-related negatives.
    //   - APRN-marked titles skip the bare-RN negatives.
    //   - Title that itself contains a positive NP signal short-circuits this
    //     check (handled below — checked first so a "Family NP" title with
    //     stray 'medical director' in description still passes).
    const titleHasPositive = POSITIVE_PATTERNS.some((re) => re.test(titleLower));

    if (!titleHasPositive) {
        const isWrongRole = NEGATIVE_PATTERNS_INDEXED.some(([neg, re]) => {
            if (!re.test(titleLower)) return false;
            if (dualRole && DUAL_ROLE_NEGATIVE_KEYWORDS.has(neg)) return false;
            if (aprn && APRN_NEGATIVE_OVERRIDES.has(neg)) return false;
            return true;
        });

        if (isWrongRole) {
            return { passes: false, reason: 'relevance_wrong_role' };
        }
    }

    // 2. Positive signal anywhere → ACCEPT.
    // Title-positive short-circuits even if description has stray negatives.
    if (titleHasPositive) {
        return { passes: true, reason: 'pass' };
    }

    // 3. Description-only positive: require TITLE to be clinical-sounding
    // (no obvious admin/sales/eng tell) — guards against jobs at NP-employing
    // companies where the title is "Engagement Specialist" / "General
    // Manager" / "Credentialing Associate" but the description recruits NPs
    // elsewhere in the JD body.
    const titleHasNegative = NEGATIVE_PATTERNS_INDEXED.some(([neg, re]) => {
        if (!re.test(titleLower)) return false;
        if (dualRole && DUAL_ROLE_NEGATIVE_KEYWORDS.has(neg)) return false;
        if (aprn && APRN_NEGATIVE_OVERRIDES.has(neg)) return false;
        return true;
    });
    if (titleHasNegative) {
        return { passes: false, reason: 'relevance_wrong_role' };
    }

    const descriptionHasPositive = POSITIVE_PATTERNS.some((re) =>
        re.test(combinedText),
    );
    if (descriptionHasPositive) {
        return { passes: true, reason: 'pass' };
    }

    // 4. Default → REJECT.
    return { passes: false, reason: 'relevance_no_keyword' };
}

/** Boolean wrapper around classifyRelevance for legacy callers. */
export function isRelevantJob(title: string = '', description: string = ''): boolean {
    return classifyRelevance(title, description, '').passes;
}

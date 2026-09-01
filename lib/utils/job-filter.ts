
/**
 * Strict Job Relevance Filter — ENGINE ONLY.
 *
 * All keyword data lives in config/niche/relevance.ts (the per-niche
 * pack). This file holds the niche-agnostic mechanics:
 *
 * 1. MUST match a "Positive Keyword" (Tier 1), or NP-title + context
 *    (Tier 2), or NP-title + niche employer (Tier 2.5), or the
 *    catch-all term anywhere (Tier 3).
 * 2. Off-specialty title veto with strong-signal rescue.
 * 3. Generic titles MUST carry niche context in the title itself (or a
 *    niche employer); generic dual-role titles may also be rescued by a
 *    strong description signal.
 * 4. Negative-keyword wrong-role check with dual-role / APRN /
 *    co-occurrence exceptions.
 *
 * DO NOT add keyword strings here — put them in the pack so ingest-time
 * and query-time (lib/filters.ts) gates stay in lockstep.
 */

import {
    POSITIVE_KEYWORDS,
    CONDITIONAL_POSITIVE_KEYWORDS,
    NEGATIVE_KEYWORDS,
    GENERIC_NP_TITLES,
    MENTAL_HEALTH_CONTEXT_TERMS,
    OFF_SPECIALTY_TITLE_MARKERS,
    NON_PROVIDER_TITLE_MARKERS,
    STRONG_PSYCH_DESC_TERMS,
    STRONG_PSYCH_CONTEXT_MIN_HITS,
    PSYCH_EMPLOYER_PATTERNS,
    PSYCH_EMPLOYER_ALLOWLIST,
    DUAL_ROLE_PATTERNS,
    DUAL_ROLE_NEGATIVE_KEYWORDS,
    APRN_TITLE_MARKERS,
    APRN_NEGATIVE_OVERRIDES,
    ROLE_TITLE_MARKERS,
    ROLE_TITLE_REGEX,
    CATCH_ALL_TERM,
    TITLE_CONTEXT_WORDS,
    WRONG_ROLE_CO_OCCURRENCE_EXCEPTIONS,
    NON_NP_PROVIDER_TITLE_PATTERNS,
    PA_ONLY_TITLE_PATTERNS,
    PA_BARE_TITLE_PATTERN,
} from '@/config/niche/relevance';

// Re-exports for existing consumers (lib/filters.ts mirrors these four
// into Prisma WHERE clauses; scripts/tests import them too).
export { OFF_SPECIALTY_TITLE_MARKERS, NON_PROVIDER_TITLE_MARKERS, PSYCH_EMPLOYER_ALLOWLIST, DUAL_ROLE_PATTERNS };

const DUAL_ROLE_NEGATIVE_SET: ReadonlySet<string> = new Set(DUAL_ROLE_NEGATIVE_KEYWORDS);
const APRN_NEGATIVE_OVERRIDE_SET: ReadonlySet<string> = new Set(APRN_NEGATIVE_OVERRIDES);

/**
 * Reasons a job can be rejected at the relevance gate.
 *
 * `relevance_filter` is kept as a catch-all for backward compat — new
 * code paths emit one of the more specific values so rejected_jobs
 * audit becomes actionable. See lib/ingestion-service.ts for the
 * caller that writes these strings.
 */
export type RelevanceReason =
    | 'pass'
    | 'relevance_no_keyword'           // No positive keyword AND no Tier-2/3 match
    | 'relevance_generic_title'         // Tier passed but title is generic + no psych context in title itself
    | 'relevance_wrong_role';           // Negative-keyword match (physician, social worker, etc.) without dual-role override

export interface RelevanceResult {
    passes: boolean;
    reason: RelevanceReason;
}

function isAprnTitle(titleLower: string): boolean {
    return APRN_TITLE_MARKERS.some((m) => titleLower.includes(m));
}

/**
 * Positive-keyword check with conditional-token support (live-review fix
 * #1d). Plain POSITIVE_KEYWORDS match as before; CONDITIONAL_POSITIVE
 * tokens (bare ' cnm ') only count when one of their context witnesses
 * ('midwife', …) appears in the full posting — so 'Clinical Nurse
 * Manager – CNM' can no longer claim a Tier-1 positive.
 *
 * @param haystack     Text the token must appear in (title or combined).
 * @param combinedText Full posting text the context witness may appear in.
 */
function hasPositiveKeyword(haystack: string, combinedText: string): boolean {
    if (POSITIVE_KEYWORDS.some((kw) => haystack.includes(kw))) return true;
    return CONDITIONAL_POSITIVE_KEYWORDS.some(
        ({ tokens, requiresAny }) =>
            tokens.some((t) => haystack.includes(t)) &&
            requiresAny.some((ctx) => combinedText.includes(ctx)),
    );
}

/**
 * Hard provider-class veto (live-review fix #1a/#1c) — runs BEFORE the
 * title-positive short-circuit, because a Tier-1 positive like 'advanced
 * practice provider' must not exempt a '(PA)' or 'Podiatrist (DPM)' title.
 *
 *   - NON_NP_PROVIDER_TITLE_PATTERNS (podiatrist/DPM/dentist/…): vetoed
 *     unless the title itself carries an NP credential token.
 *   - PA patterns: vetoed unless the title carries an NP credential token
 *     OR is a dual-role NP-or-PA posting (those are wanted by design).
 */
function hasHardProviderClassVeto(titleLower: string, dualRole: boolean): boolean {
    const titleHasNpToken =
        TITLE_CONTEXT_WORDS.some((t) => titleLower.includes(t)) ||
        ROLE_TITLE_REGEX.test(titleLower);

    if (NON_NP_PROVIDER_TITLE_PATTERNS.some((re) => re.test(titleLower))) {
        if (!titleHasNpToken) return true;
    }

    const paSignal =
        PA_ONLY_TITLE_PATTERNS.some((re) => re.test(titleLower)) ||
        PA_BARE_TITLE_PATTERN.test(titleLower);
    if (paSignal && !titleHasNpToken && !dualRole) {
        return true;
    }

    return false;
}

function hasMentalHealthContext(combinedText: string): boolean {
    return MENTAL_HEALTH_CONTEXT_TERMS.some((term) => combinedText.includes(term));
}

function isPsychEmployer(employer: string | null | undefined): boolean {
    if (!employer) return false;
    const lower = employer.toLowerCase();
    return (
        PSYCH_EMPLOYER_PATTERNS.some((p) => lower.includes(p)) ||
        PSYCH_EMPLOYER_ALLOWLIST.some((p) => lower.includes(p))
    );
}

function isDualRoleTitle(titleLower: string): boolean {
    return DUAL_ROLE_PATTERNS.some((p) => titleLower.includes(p));
}

function hasOffSpecialtyTitle(titleLower: string): boolean {
    return OFF_SPECIALTY_TITLE_MARKERS.some((m) => titleLower.includes(m));
}

function titleHasPsychWord(titleLower: string): boolean {
    return TITLE_CONTEXT_WORDS.some((t) => titleLower.includes(t));
}

/**
 * Psych-specific description signal — stronger than a stray "behavioral health"
 * mention. True when either (a) a psych/addiction-specific term is present, or
 * (b) the loose mental-health vocabulary appears REPEATEDLY. A primary-care JD
 * lists "behavioral health" once among many services; a real psych JD (e.g.
 * Lyra Health) mentions mental-health terms throughout.
 */
function hasStrongPsychContext(combinedText: string): boolean {
    if (STRONG_PSYCH_DESC_TERMS.some((t) => combinedText.includes(t))) return true;
    let hits = 0;
    for (const term of MENTAL_HEALTH_CONTEXT_TERMS) {
        let idx = combinedText.indexOf(term);
        while (idx !== -1) {
            hits += 1;
            if (hits >= STRONG_PSYCH_CONTEXT_MIN_HITS) return true;
            idx = combinedText.indexOf(term, idx + term.length);
        }
    }
    return false;
}

/**
 * Classify a job's relevance and return the reason. The boolean
 * `isRelevantJob` is preserved as a thin wrapper for legacy callers.
 *
 * @param title       Job title (raw from source).
 * @param description Job description (raw — HTML is fine, we just lowercase-substring).
 * @param employer    Employer name. Optional but improves Tier 2.5 detection.
 */
export function classifyRelevance(
    title: string = '',
    description: string = '',
    employer: string = '',
): RelevanceResult {
    const combinedText = `${title} ${description}`.toLowerCase();
    const titleLower = title.toLowerCase().trim();
    const employerLower = employer.toLowerCase();
    const dualRole = isDualRoleTitle(titleLower);
    const aprn = isAprnTitle(titleLower);

    // 1. MUST have a Positive Keyword in Title OR Description
    let hasPositive = hasPositiveKeyword(combinedText, combinedText);

    if (!hasPositive) {
        const psychContext = hasMentalHealthContext(combinedText);
        // Word-boundary role check so titles starting with NP/NP- match too.
        const titleHasNP =
            ROLE_TITLE_MARKERS.some((m) => titleLower.includes(m)) ||
            ROLE_TITLE_REGEX.test(titleLower);

        // Tier 2: NP-in-title + psych-context-anywhere
        if (psychContext && titleHasNP) {
            hasPositive = true;
        } else if (combinedText.includes(CATCH_ALL_TERM)) {
            // Tier 3: catch-all mention anywhere
            hasPositive = true;
        } else if (titleHasNP && isPsychEmployer(employer)) {
            // Tier 2.5: NP-in-title + psych-employer (covers cases where
            // title and description don't say psych but the employer
            // clearly is one — e.g. Senior PsychCare, Kanza Mental Health).
            hasPositive = true;
        }
    }

    if (!hasPositive) {
        return { passes: false, reason: 'relevance_no_keyword' };
    }

    // 1a. HARD PROVIDER-CLASS VETO (live-review fix #1a/#1c) — evaluated
    // before every rescue/short-circuit below. A '(PA),' / 'Podiatrist
    // (DPM)' / 'Psychologist' title is a different profession no matter
    // what Tier-1 positive ('advanced practice provider') or description
    // boilerplate the posting carries.
    if (hasHardProviderClassVeto(titleLower, dualRole)) {
        return { passes: false, reason: 'relevance_wrong_role' };
    }

    const titleHasPositiveKeyword = hasPositiveKeyword(titleLower, combinedText);

    // 1b. OFF-SPECIALTY VETO
    // A title that DEFINES another specialty (Family NP, primary care, hospice,
    // women's health, oncology, …) is a psychiatric posting ONLY if a STRONG
    // psych signal rescues it: psych in the title, a positive PMHNP keyword, a
    // psych employer, or psych-specific description terms. A primary-care /
    // hospice JD that merely lists "behavioral health" once does NOT qualify.
    if (hasOffSpecialtyTitle(titleLower) && !titleHasPositiveKeyword) {
        const rescued =
            titleHasPsychWord(titleLower) ||
            isPsychEmployer(employer) ||
            hasStrongPsychContext(combinedText);
        if (!rescued) {
            return { passes: false, reason: 'relevance_wrong_role' };
        }
    }

    // 2. GENERIC TITLE CHECK
    const isGenericTitle = GENERIC_NP_TITLES.some((generic) => {
        return (
            titleLower === generic ||
            titleLower.startsWith(generic + ' -') ||
            titleLower.startsWith(generic + ' –') ||
            titleLower.startsWith(generic + ' (') ||
            titleLower.startsWith(generic + ',') ||
            titleLower.startsWith(generic + ' $') ||
            titleLower.endsWith(' ' + generic) ||
            titleLower.startsWith(generic + ' sign') ||
            titleLower.startsWith(generic + ' travel') ||
            titleLower.startsWith(generic + ' prn') ||
            titleLower.startsWith(generic + ' weekend') ||
            titleLower.startsWith(generic + ' part') ||
            titleLower.startsWith(generic + ' full')
        );
    });

    // A bare dual-role post ("Nurse Practitioner or Physician Assistant") with
    // no specialty or psych word is just as generic — One Medical / Ennoble
    // emit these for primary-care / hospice roles. Treat them as generic so the
    // same psych-signal requirement applies.
    const isGenericDualRole =
        dualRole && !titleHasPsychWord(titleLower) && !hasOffSpecialtyTitle(titleLower) && !titleHasPositiveKeyword;

    // Generic SINGLE-role titles ("Nurse Practitioner") need psych in the title
    // or a psych employer — a description-only mention is too weak (it leaks
    // primary-care NPs whose JD lists psych among many services).
    if (isGenericTitle) {
        if (!titleHasPsychWord(titleLower) && !isPsychEmployer(employer)) {
            return { passes: false, reason: 'relevance_generic_title' };
        }
    } else if (isGenericDualRole) {
        // Bare dual-role "NP or PA" posts (One Medical, Ennoble): same psych
        // requirement, but ALSO accept a strong/addiction description signal —
        // the employer allowlist covers known psych orgs (Lyra), strong context
        // covers SUD / OTP roles, while primary-care/hospice still fall through.
        const rescued =
            titleHasPsychWord(titleLower) ||
            isPsychEmployer(employer) ||
            hasStrongPsychContext(combinedText);
        if (!rescued) {
            return { passes: false, reason: 'relevance_wrong_role' };
        }
    }

    // 3. Strong filter on TITLE for wrong roles.
    // Exception: title itself contains a positive keyword → trust it.
    // (The hard provider-class veto at step 1a already ran, so this
    // short-circuit can no longer pass '(PA)' / podiatrist-class titles.)
    if (titleHasPositiveKeyword) {
        return { passes: true, reason: 'pass' };
    }

    const isWrongRole = NEGATIVE_KEYWORDS.some((neg) => {
        if (!titleLower.includes(neg)) return false;

        // Exception A: a negative keyword is allowed when its configured
        // indicator terms co-occur IN THE TITLE (e.g. dual-role
        // 'Psychiatrist/PMHNP' postings). Live-review fix #1b: indicators
        // used to be checked against title+description, which admitted any
        // bare 'Psychiatrist' posting whose JD mentioned 'nurse
        // practitioner' in boilerplate — 207 published physician rows.
        const coOccurrenceIndicators = WRONG_ROLE_CO_OCCURRENCE_EXCEPTIONS[neg];
        if (coOccurrenceIndicators) {
            const hasIndicator = coOccurrenceIndicators.some((indicator) =>
                titleLower.includes(indicator),
            );
            return !hasIndicator;
        }

        // Exception B (NEW 2026-05-05): physician / PA negative keywords
        // are skipped for dual-role NP-or-PA postings. Adzuna in particular
        // emits many "Nurse Practitioner or Physician Assistant - Psychiatry"
        // titles that the old filter killed because of the bare 'physician' /
        // ' pa ' rules. Dual-role posts are exactly what we want to catch.
        if (dualRole && DUAL_ROLE_NEGATIVE_SET.has(neg)) {
            return false;
        }

        // Exception C (NEW 2026-05-05): APRN titles legitimately contain
        // 'registered nurse' / ' rn ' as part of "Advanced Practice
        // Registered Nurse" — those negatives target staff RNs, not
        // advanced-practice nurses. Skip them when the title is APRN-marked.
        if (aprn && APRN_NEGATIVE_OVERRIDE_SET.has(neg)) {
            return false;
        }

        return true;
    });

    if (isWrongRole) {
        return { passes: false, reason: 'relevance_wrong_role' };
    }

    return { passes: true, reason: 'pass' };
}

/** Boolean wrapper around classifyRelevance for legacy callers. */
export function isRelevantJob(title: string = '', description: string = ''): boolean {
    return classifyRelevance(title, description, '').passes;
}

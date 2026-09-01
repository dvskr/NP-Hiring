/**
 * Deterministic profession classifier (live-review fix #1 — quarantine).
 *
 * Assigns every job posting the PROFESSION it actually recruits, so the
 * board can stop serving podiatrists, psychiatrists, PA-only and
 * nonclinical roles under the "NP jobs" banner. Pure ordered rules over
 * title + description with a confidence score — NO LLM calls, no network,
 * no DB. The same function runs at ingest (lib/ingestion-service.ts), in
 * the backfill (scripts/backfill-profession-class.ts), and as a render-time
 * fallback for rows the backfill has not reached yet
 * (app/jobs/[slug]/page.tsx display conditioning).
 *
 * Output classes mirror the Prisma `ProfessionClass` enum exactly
 * (prisma/schema.prisma). `null` means "no rule fired" — the caller treats
 * it as unclassified (kept-as-is at query time, quarantined at ingest when
 * confidence is below the publish floor).
 *
 * RULE ORDER IS THE CONTRACT (first match wins):
 *   1. CRNA           — anesthetist credentials outrank everything
 *   2. CNM            — ONLY with midwife context ("Clinical Nurse Manager –
 *                       CNM" must NOT land here; it is a manager)
 *   3. nonclinical    — educator / manager / recruiter / admin titles beat
 *                       credential tokens ("Nurse Practitioner Educator"
 *                       recruits an educator, not a practicing NP). EXCEPT:
 *                       when the title carries an NP credential, only
 *                       education/recruiting tokens win — leadership /
 *                       coordination tokens ("NP - Program Director",
 *                       "Nurse Practitioner Care Coordinator") describe a
 *                       practicing NP and fall through to rule 4
 *   4. np_eligible    — NP / APRN-NP credential in the TITLE (includes
 *                       dual-role "NP or PA" and "Psychiatrist/PMHNP")
 *   5. CNS            — clinical nurse specialist
 *   6. physician      — psychiatrist / physician / MD-DO titles. Reaching
 *                       this rule means the title carries NO NP token, so a
 *                       'nurse practitioner' mention in JD boilerplate can
 *                       never rescue a bare "Psychiatrist" posting. Bare MD
 *                       excludes state-abbreviation "…, MD" (Maryland) forms.
 *   7. pa_only        — physician assistant / PA-C / "(PA)" / bare PA
 *                       (state-abbreviation "…, PA" forms excluded)
 *   8. other_clinical — podiatrist/DPM, dentist/DDS, optometrist,
 *                       psychologist, staff RN, therapists, pharmacists, …
 *   9. description fallback — generic APP/provider titles whose JD
 *                       explicitly recruits an NP/APRN
 */

export type ProfessionClass =
    | 'np_eligible'
    | 'aprn_midwife'
    | 'aprn_crna'
    | 'aprn_cns'
    | 'pa_only'
    | 'physician'
    | 'other_clinical'
    | 'nonclinical';

export interface ProfessionClassification {
    professionClass: ProfessionClass | null;
    /** 0..1 — how sure the rule set is about the class above. */
    confidence: number;
    /** Stable id of the rule that fired, for audit rows and CSVs. */
    rule: string;
}

/** Classes that must never be served on NP listing surfaces. */
export const NON_NP_PROFESSION_CLASSES = [
    'pa_only',
    'physician',
    'other_clinical',
    'nonclinical',
] as const satisfies readonly ProfessionClass[];

const NON_NP_SET: ReadonlySet<ProfessionClass> = new Set(NON_NP_PROFESSION_CLASSES);

/** Classes the board serves by design (NP + APRN cohort). */
export const NP_ELIGIBLE_PROFESSION_CLASSES = [
    'np_eligible',
    'aprn_midwife',
    'aprn_crna',
    'aprn_cns',
] as const satisfies readonly ProfessionClass[];

/**
 * Publish floor for ingest: a freshly classified row below this confidence
 * is inserted UNPUBLISHED (quarantined, never deleted) with an audit row.
 * NULL-class rows carry confidence 0 and therefore quarantine too — at
 * ingest we have the luxury of being conservative; the backfill over
 * existing inventory deliberately does NOT use this floor (it only
 * quarantines confident non-NP classes; see the script header).
 */
export const PROFESSION_PUBLISH_CONFIDENCE_FLOOR = 0.5;

/** Version stamp written to JobHealthCheck audit rows. Bump on rule changes. */
export const PROFESSION_CLASSIFIER_VERSION = 'profession-classifier-v1.1.0';

/** True when the class may be served/branded on NP surfaces. NULL passes
 *  (pre-backfill safety: unclassified rows keep their current behavior). */
export function isNpServableClass(professionClass: string | null | undefined): boolean {
    if (professionClass === null || professionClass === undefined) return true;
    return !NON_NP_SET.has(professionClass as ProfessionClass);
}

// ─── Title vocabulary ────────────────────────────────────────────────────────

/** NP / APRN-NP credential tokens in the title (word-boundary). */
const NP_TITLE_RE =
    /nurse\s+practitioner|\b(?:np|fnp|agnp|agpcnp|agacnp|pnp|acpnp|cpnp|nnp|whnp|acnp|enp|onp|pmhnp|fpmhnp|aprn|arnp)\b|np-c\b|np-bc\b/i;

/** Dual-role "NP or PA" title shapes — np_eligible by design. */
const DUAL_ROLE_RE =
    /np\s*[/-]\s*pa|pa\s*[/-]\s*np|\bnp\s+or\s+pa\b|\bpa\s+or\s+np\b|nurse\s+practitioner\s+(?:or|\/)\s*physician\s+assistant|physician\s+assistant\s+(?:or|\/)\s*nurse\s+practitioner/i;

const CRNA_RE = /\bcrna\b|nurse\s+anesthetist/i;

/** CNM tokens are ambiguous ("Clinical Nurse Manager – CNM"): the bare
 *  abbreviation only counts WITH midwife context somewhere in the posting. */
const CNM_ABBREV_RE = /\bcnm\b/i;
const MIDWIFE_CONTEXT_RE = /midwife|midwifery|cnm-certified|obstetric|labor\s*(?:&|and)\s*delivery/i;
const MIDWIFE_TITLE_RE = /nurse[-\s]midwife|midwife|midwifery/i;

const CNS_RE = /clinical\s+nurse\s+specialist|\bcns\b/i;

/** Educator / manager / recruiter / admin — recruits a nonclinical role
 *  when NO NP credential is in the title. When one IS, only the tokens in
 *  NONCLINICAL_BEATS_NP_CREDENTIAL_RE below may still win (see rule 3). */
const NONCLINICAL_TITLE_RE =
    /\b(?:educator|faculty|professor|instructor|lecturer|preceptor)\b|nurse\s+manager|clinical\s+nurse\s+manager|\b(?:office|practice|program|project|case)\s+manager\b|\bdirector\b|\brecruiter\b|recruitment|talent\s+(?:acquisition|community)|\b(?:scheduler|receptionist|coordinator|administrator|biller|coder)\b|business\s+development|account\s+executive|sales\s+representative/i;

/**
 * Nonclinical tokens that beat an NP credential in the SAME title — the
 * documented educator-beats-credential intent ("Nurse Practitioner
 * Educator" recruits an educator) plus recruiting/talent roles. Leadership
 * and coordination tokens (director, coordinator, manager, …) are
 * DELIBERATELY absent: "Nurse Practitioner / Medical Director", "NP -
 * Program Director" and "Nurse Practitioner Care Coordinator" are common
 * practicing-NP roles (live-verified; exact titles pinned in
 * tests/regressions/p9-quarantine-profession-class.test.ts) and must
 * fall through to np_eligible, not quarantine as nonclinical.
 */
const NONCLINICAL_BEATS_NP_CREDENTIAL_RE =
    /\b(?:educator|faculty|professor|instructor|lecturer|preceptor)\b|\brecruiter\b|recruitment|talent\s+(?:acquisition|community)/i;

/**
 * Physician titles. `physician` must not match "physician assistant". The
 * BARE `md` token carries the same state-abbreviation lookbehind guard as
 * PA_BARE_RE below: "…, MD" / "… - MD" location suffixes are Maryland, not
 * a medical doctor — "Advanced Practice Provider - Baltimore, MD" over an
 * NP-recruiting JD must not classify physician. Punctuation-free MD
 * ("Internal Medicine MD") and the M.D. / MD/DO credential forms still match.
 */
const PHYSICIAN_RE =
    /\bpsychiatrist\b|\bphysician\b(?!\s+assistant)|medical\s+doctor|(?<![,\-–—])(?<![,\-–—]\s)\bmd\b|\bm\.d\.(?!\w)|md\s*\/\s*do\b|\bnocturnist\b|\bneurologist\b|\bhospitalist\s+physician\b/i;

/**
 * PA-only signals. Unambiguous forms first; the BARE `pa` token counts only
 * when it is NOT a state abbreviation — "…, PA" / "… - PA" location suffixes
 * (Philadelphia, PA) are excluded via lookbehind. This is the fix for the
 * space-padded ' pa ' negative that could not see '(PA),' (Ascend case).
 */
const PA_STRONG_RE = /physician\s+assistant|\bpa-c\b|\(pa\)/i;
const PA_BARE_RE = /(?<![,\-–—])(?<![,\-–—]\s)\bpa\b/i;

/** Non-NP/PA/MD clinicians. Word-boundary so DPM/DDS abbreviations are safe. */
const OTHER_CLINICAL_RE =
    /\bpodiatrist\b|\bpodiatric\b|\bdpm\b|\bdentist\b|\bdds\b|\bdmd\b|\boptometrist\b|\bchiropractor\b|\bpsychologist\b|\bpharmacist\b|physical\s+therapist|occupational\s+therapist|speech[-\s]language|\btherapist\b|\bcounselor\b|social\s+worker|\blcsw\b|\bdietitian\b|\bnutritionist\b|registered\s+nurse|\brn\b|\blpn\b|\blvn\b|\bcna\b|medical\s+assistant|\bparamedic\b|\bphlebotomist\b/i;

/** Description strings that mean "this JD explicitly recruits an NP/APRN". */
const NP_DESC_RE =
    /nurse\s+practitioner|\baprn\b|\barnp\b|advanced\s+practice\s+registered\s+nurse|\b(?:fnp|pmhnp|agacnp|whnp)\b|np-c\b|fnp-c\b|fnp-bc\b|\bdnp\b/i;

const PA_DESC_RE = /physician\s+assistant|\bpa-c\b/i;

// ─── Classifier ──────────────────────────────────────────────────────────────

/**
 * Classify which profession a posting recruits. Deterministic: same inputs
 * always produce the same output. See the module header for rule order.
 */
export function classifyProfession(
    title: string = '',
    description: string = '',
): ProfessionClassification {
    const titleText = title.trim();
    const combined = `${title} ${description}`;

    // 1. CRNA — the credential is unambiguous wherever it appears in a title.
    if (CRNA_RE.test(titleText)) {
        return { professionClass: 'aprn_crna', confidence: 0.95, rule: 'title_crna' };
    }

    // 2. CNM — spelled-out midwife titles always count; the bare CNM
    //    abbreviation needs midwife context ('Clinical Nurse Manager – CNM –
    //    Inpatient Psychiatry' has none and falls through to nonclinical).
    if (MIDWIFE_TITLE_RE.test(titleText)) {
        return { professionClass: 'aprn_midwife', confidence: 0.95, rule: 'title_midwife' };
    }
    if (CNM_ABBREV_RE.test(titleText) && MIDWIFE_CONTEXT_RE.test(combined)) {
        return { professionClass: 'aprn_midwife', confidence: 0.85, rule: 'title_cnm_with_context' };
    }

    // 3. Nonclinical — educator/manager/recruiter/admin titles recruit that
    //    role ('Clinical Nurse Manager – CNM', 'Nurse Manager - Homeless
    //    Services', 'Clinical Educator'). When the title ALSO carries an NP
    //    credential, only education/recruiting tokens still win ('Nurse
    //    Practitioner Educator' recruits an educator) — leadership and
    //    coordination tokens describe a practicing NP ('NP - Program
    //    Director', 'Nurse Practitioner Care Coordinator') and fall
    //    through to rule 4.
    if (NONCLINICAL_TITLE_RE.test(titleText)) {
        const titleHasNpCredential = NP_TITLE_RE.test(titleText) || DUAL_ROLE_RE.test(titleText);
        if (!titleHasNpCredential || NONCLINICAL_BEATS_NP_CREDENTIAL_RE.test(titleText)) {
            return { professionClass: 'nonclinical', confidence: 0.9, rule: 'title_nonclinical' };
        }
    }

    // 4. NP-eligible — NP/APRN credential or dual-role NP-or-PA in the TITLE.
    //    This is the rule that keeps 'Psychiatrist/PMHNP' in scope while
    //    rule 6 below kills bare 'Psychiatrist'.
    if (NP_TITLE_RE.test(titleText) || DUAL_ROLE_RE.test(titleText)) {
        return { professionClass: 'np_eligible', confidence: 0.95, rule: 'title_np_credential' };
    }

    // 5. CNS.
    if (CNS_RE.test(titleText)) {
        return { professionClass: 'aprn_cns', confidence: 0.9, rule: 'title_cns' };
    }

    // 6. Physician — reaching here means NO NP token in the title, so a
    //    'nurse practitioner' mention in description boilerplate can never
    //    rescue a bare Psychiatrist/Physician/MD-DO posting.
    if (PHYSICIAN_RE.test(titleText)) {
        return { professionClass: 'physician', confidence: 0.9, rule: 'title_physician' };
    }

    // 7. PA-only — '(PA)', 'PA-C', 'physician assistant', or a bare PA token
    //    that is not a state abbreviation.
    if (PA_STRONG_RE.test(titleText)) {
        return { professionClass: 'pa_only', confidence: 0.9, rule: 'title_pa_strong' };
    }
    if (PA_BARE_RE.test(titleText)) {
        return { professionClass: 'pa_only', confidence: 0.7, rule: 'title_pa_bare' };
    }

    // 8. Other clinicians (podiatrist/DPM, dentist, optometrist,
    //    psychologist, staff RN, therapists, …).
    if (OTHER_CLINICAL_RE.test(titleText)) {
        return { professionClass: 'other_clinical', confidence: 0.9, rule: 'title_other_clinical' };
    }

    // 9. Description fallback — generic titles ('Advanced Practice
    //    Provider', 'Outpatient APP') classified by who the JD recruits.
    const descRecruitsNp = NP_DESC_RE.test(description);
    const descRecruitsPa = PA_DESC_RE.test(description);
    if (descRecruitsNp) {
        return { professionClass: 'np_eligible', confidence: 0.6, rule: 'desc_np_credential' };
    }
    if (descRecruitsPa) {
        return { professionClass: 'pa_only', confidence: 0.55, rule: 'desc_pa_only' };
    }

    return { professionClass: null, confidence: 0, rule: 'unclassified' };
}

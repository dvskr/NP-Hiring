/**
 * lib/job-type-detection.ts: the employment type a posting states (indexing
 * audit H-03 and M-06).
 *
 * THE BUG THIS REPLACES. The old detectJobType took the first substring hit
 * anywhere in title + description + location, checking per diem and
 * contract before full time. Boilerplate therefore decided the type:
 *   - Advocate Health's benefits note "(e.g., full-time, part-time, per diem,
 *     temporary...)" made every Advocate row PER_DIEM, although the posting
 *     says "Status: Full time ... Hours Per Week: 40";
 *   - Highmark's "Employees, Contractors, and Applicants Notice", Centene's
 *     "contractual" and MultiCare's "union contract" made full-time roles
 *     CONTRACTOR;
 *   - Thriveworks' "Fee For Service (W2)" made W-2 roles CONTRACTOR;
 *   - Corewell's "PRN coverage" (a duty) beat "Employment Type Full time";
 *   - "PRN" as a medication order ("PRN medication orders", "as needed
 *     (PRN)") made full-time clinical roles PER_DIEM.
 *
 * WHAT DECIDES NOW, strongest first (resolveJobType):
 *   1. the ATS's structured field (Workday timeType, the Greenhouse
 *      employment-type metadata, Lever commitment, SmartRecruiters
 *      typeOfEmployment), through canonicalizeJobType;
 *   2. the title ("Nurse Practitioner - Full Time");
 *   3. a labelled line in the description ("Status: Full time", "Employment
 *      Type Full time", "Job Type: Part-time", "Hours Per Week: 40", "FTE:
 *      1.0");
 *   4. a free-text scan of the description with EEO, privacy and benefits
 *      policy sentences removed, and with any clause that enumerates three or
 *      more types ignored ("full-time, part-time, per diem"). A sentence
 *      about this job itself ("This is a full-time position", "The position
 *      is part-time") outranks a bare mention elsewhere;
 *   5. a stated W-2 relationship, read as full time only when nothing else
 *      states a type and the posting says nothing of a contract or a
 *      temporary assignment (a "W-2 contract" is not a full-time job).
 *
 * Every pattern is anchored on word boundaries: "prn" never matches inside
 * a word, "contract" never inside "contractual".
 *
 * PRN in free text is a schedule only in a schedule context (an allowlist):
 * a schedule word after it ("PRN position", "on a PRN basis", "as needed
 * (PRN) position", "PRN coverage", "PRN weekends", "PRN NPs"), a schedule
 * word before it ("cover shifts PRN", "available PRN", "work PRN", "is a
 * PRN", "the position is PRN"), or another schedule beside it ("full-time
 * and PRN", "FT/PRN", "PRN or part-time"). Any other PRN states no type
 * ("PRN protocols", "PRN documentation", "PRN Haldol", "order medications
 * as needed (PRN)", "the medication is PRN"), and even in a schedule
 * context it never counts where it names a medication order, whether the
 * clinical word follows it ("PRN medications", "PRN and scheduled meds",
 * "PRN IM medication orders", "PRN/as needed medications", "PRN
 * restraints") or comes before it ("order medications PRN", "administer
 * medications on a PRN basis"), nor in the duty "provide PRN coverage". A
 * title or a labelled value ("Status: As Needed (PRN)") states the schedule
 * outright, so there only the medication reading is excluded.
 *
 * CONTRACT, in free text, is read only from "1099" or "independent
 * contractor". "Contract position", "6-month contract", bare "contract",
 * "contractor(s)", "contractual", "union contract" and "fee for service"
 * never are: a fixed-term W-2 contract is not an independent contractor, and
 * Google's CONTRACTOR type means one. A title or a labelled value that says
 * "Contract" (or "1099", or "independent contractor") is the employer's own
 * statement and still counts; "Temporary" or "Temp" does not, because a
 * temporary employee is not a contractor. Nothing is read as a contract,
 * from any source, when the posting states W-2 employment.
 *
 * BOTH TYPES. A posting that offers two schedules ("Full-Time or
 * Part-Time", "FT/PRN") yields both, primary first (the first one the text
 * names). The Job row stores one jobType, the primary: the filters, alert
 * matching, facet counts and category predicates all key on one value. The
 * job page re-derives the second type at render (resolveEmploymentTypes in
 * app/jobs/[slug]/job-posting-facts.ts) so the chip and employmentType can
 * name both.
 *
 * Pure: no database, no network.
 */

export type JobTypeLabel = 'Full-Time' | 'Part-Time' | 'Contract' | 'Per Diem' | 'Locum Tenens';

/** Where a resolved type came from, for logs and the re-derive script. */
export type JobTypeSource = 'ats' | 'title' | 'label' | 'text' | 'w2';

export interface JobTypeResolution {
  /** The primary type, or null when nothing states one. */
  jobType: string | null;
  /** Every type the deciding source states, primary first (at most two). */
  types: string[];
  source: JobTypeSource | null;
}

/* ─── Type words ────────────────────────────────────────────────────────── */

/** "per diem" as a travel or meal allowance is pay, not a schedule. */
const PER_DIEM_WORDS =
  String.raw`\bper[\s-]?diem\b(?!\s+(?:allowances?|stipends?|rates?|meals?|lodging|housing|reimburse\w*|payments?|expenses?)\b)`;
/**
 * What a medication or order "PRN" qualifies ("PRN medication orders", "PRN
 * usage", "PRN effectiveness", "PRN restraints and seclusion", "PRN
 * interventions").
 */
const PRN_CLINICAL_NOUN =
  String.raw`(?:medications?|meds?|orders?|dos(?:e|es|ing)|administration|psychotropics?|antipsychotics?|analgesics?|sedatives?|drugs?|prescri\w*|requests?|use|usage|utilization|effectiveness|efficacy|responses?|reassessments?|regimens?|injections?|restraints?|seclusions?|interventions?|anxiolytics?|benzodiazepines?|hypnotics?|labs?)`;
/**
 * A drug class or a route that may sit between PRN and its noun ("PRN psych
 * meds", "PRN pain medication", "PRN IM medication orders", "PRN chemical
 * restraint").
 */
const PRN_DRUG_CLASS =
  String.raw`(?:psych(?:iatric)?|pain|anxiety|sleep|oral|rescue|comfort|behavioral|im|iv|po|intramuscular|emergency|stat|chemical|physical)`;
/**
 * A medication, an order or a dosing verb written directly before PRN
 * ("order medications PRN", "administer meds (PRN)", "prescribe PRN").
 * "Shifts PRN" and "available PRN" are schedules and are not listed.
 */
const PRN_AFTER_CLINICAL_WORD =
  String.raw`(?<!\b(?:medications?|meds?|orders?|ordered|drugs?|dos(?:e|es|ing)|analgesics?|sedatives?|antipsychotics?|psychotropics?|injections?|prescrib\w*|administer\w*|dispens\w*|titrat\w*)(?:\s+|\s*\(\s*))`;
/**
 * "Administer medications on a PRN basis", "meds given on an as-needed (PRN)
 * basis": a medication or an order word, then "on a" (and an optional "as
 * needed" gloss), directly before PRN. "Work on a PRN basis" has no such
 * word and stays a schedule.
 */
const PRN_AFTER_ON_A_BASIS =
  String.raw`(?<!\b(?:medications?|meds?|drugs?|orders?|given|administered|prescribed|ordered)\s+on\s+an?\s+(?:as[\s-]needed\s*\(?\s*)?)`;
/**
 * "PRN" that does not qualify a medication or an order: none is written
 * right before it, and none follows it directly, through a drug class or a
 * route, or through "and scheduled" / "(as needed)" / "/as needed" ("manage
 * PRN and scheduled medications", "PRN (as needed) orders", "PRN/as needed
 * medications", "PRN psych meds", "PRN IM medication orders"). "PRN as
 * clinically indicated" is an order too.
 */
const PRN_NOT_CLINICAL =
  PRN_AFTER_CLINICAL_WORD +
  PRN_AFTER_ON_A_BASIS +
  String.raw`\bprn\b` +
  String.raw`(?!\s*(?:[(/]?\s*as[\s-]needed\s*\)?\s*)?(?:(?:and|or|/)\s*(?:scheduled|routine|standing)\s+)?(?:${PRN_DRUG_CLASS}\s+)?${PRN_CLINICAL_NOUN}\b)` +
  String.raw`(?!\s*\)?\s*as\s+clinically\s+indicated\b)`;
/** What a schedule "PRN" describes ("as needed (PRN) position", "PRN basis"). */
const PRN_SCHEDULE_NOUN =
  String.raw`(?:basis|positions?|roles?|jobs?|schedules?|shifts?|status|employment|opportunit(?:y|ies)|openings?|pool|team|staff)`;
/** The clinician a schedule "PRN" can describe ("PRN Nurse Practitioner", "PRN NPs"). */
const PRN_ROLE_NOUN =
  String.raw`(?:(?:psychiatric\s+)?nurse\s+practitioners?|nps?|aprns?|pmhnps?|fnps?|providers?|apps?|clinicians?)`;
/**
 * A schedule word directly after PRN ("PRN position", "PRN coverage", "PRN
 * weekends", "PRN NPs"), except the duty "provide PRN coverage". The
 * parentheses are optional because the boilerplate pass splits clauses on
 * them ("an as needed (PRN) position").
 */
const PRN_SCHEDULE_AFTER =
  String.raw`(?=\s*\)?\s*(?:${PRN_SCHEDULE_NOUN}|coverage|weekends?|nights?|evenings?|hours|${PRN_ROLE_NOUN})\b)` +
  String.raw`(?!(?<=\bprovid(?:e|es|ed|ing)\s+prn)\s+coverage\b)`;
/**
 * A schedule context directly before PRN ("cover shifts PRN", "available
 * PRN", "work PRN", "is a PRN"), or the job itself said to be PRN ("the
 * position is PRN", "this role will be PRN", "the schedule is PRN"). A bare
 * "is PRN" is not one: "the medication is PRN" and "Haldol is PRN for
 * agitation" are orders.
 */
const PRN_SCHEDULE_BEFORE =
  String.raw`(?<=\b(?:shifts?|available|availability|work|working|is\s+an?|as\s+an?|(?:position|role|job|opportunity|opening|schedule|shift|status)\s+(?:is|will\s+be))\s+\(?\s*prn)`;
/**
 * PRN offered beside another schedule, on either side ("full-time and PRN",
 * "FT/PRN", "PRN or part-time", "PRN/full-time").
 */
const PRN_BESIDE_SCHEDULE =
  String.raw`(?:(?<=\b(?:full[\s-]?time|part[\s-]?time|ft|pt)\s*(?:\/|,|and|or|&)\s*prn)|(?=\s*(?:\/|,|and|or|&)\s*(?:full[\s-]?time|part[\s-]?time)\b))`;
/**
 * "PRN" as a schedule in free text, an ALLOWLIST: PRN counts only in one of
 * the schedule contexts above, and never as a medication or order term
 * (PRN_NOT_CLINICAL). A blocklist of clinical nouns kept missing phrasings
 * ("PRN protocols", "PRN documentation", "PRN Haldol", "PRN parameters"),
 * so any PRN with no schedule context now states no type: a missed schedule
 * phrasing omits a type, where a missed medication phrasing put "Per Diem"
 * on a full-time job.
 */
const PRN_SCHEDULE_TEXT =
  PRN_NOT_CLINICAL + `(?:${PRN_SCHEDULE_AFTER}|${PRN_SCHEDULE_BEFORE}|${PRN_BESIDE_SCHEDULE})`;
/** Free text: per diem wording or a schedule PRN. */
const PER_DIEM_TEXT_RE = new RegExp(`${PER_DIEM_WORDS}|${PRN_SCHEDULE_TEXT}`, 'gi');
/** A title or a labelled value: any PRN that is not a medication term. */
const PER_DIEM_VALUE_RE = new RegExp(`${PER_DIEM_WORDS}|${PRN_NOT_CLINICAL}`, 'gi');
const PART_TIME_RE = /\bpart[\s-]?time\b|\bp\/t\b/gi;
/** "permanent resident" is a work authorization, not a schedule. */
const FULL_TIME_RE =
  /\bfull[\s-]?time\b|\bf\/t\b|\bpermanent\b(?!\s+(?:residents?|residency|residence|address|disability|records?|licen[cs]e))/gi;
const LOCUM_RE = /\blocum(?:s|\s+tenens)?\b/gi;
/** In free text, only an independent contractor arrangement (see the header). */
const CONTRACT_TEXT_RE = /\b1099\b|\bindependent[\s-]contractors?\b/gi;
/**
 * In a title or a labelled value, the bare word is an explicit statement.
 * "Temporary" and "Temp" are not: a temporary employee is not a contractor.
 */
const CONTRACT_VALUE_RE = /\bcontract(?:ors?)?\b|\b1099\b/gi;
const W2_RE = /\bw[\s-]?2\b/i;
/**
 * Wording that a W-2 posting may still be a fixed-term or temporary
 * arrangement ("W-2 contract", "temporary assignment"), so a stated W-2
 * relationship is not read as full time.
 */
const FIXED_TERM_WORDING_RE = /\bcontract(?:ors?|s)?\b|\btemporary\b|\btemp\b|\bfixed[\s-]term\b|\blocums?\b/i;
/**
 * Upper-case "FT" / "PT" in a title or a labelled value ("FNP (FT/PRN)").
 * Never in free text, where "ft" is also feet and "PT" physical therapy.
 */
const FT_ABBREVIATION_RE = /\bFT\b/g;
const PT_ABBREVIATION_RE = /\bPT\b/g;

interface TypeHit {
  type: JobTypeLabel;
  index: number;
}

function hitsOf(re: RegExp, type: JobTypeLabel, text: string): TypeHit[] {
  re.lastIndex = 0;
  const hits: TypeHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    hits.push({ type, index: m.index });
    if (m[0].length === 0) re.lastIndex++;
  }
  re.lastIndex = 0;
  return hits;
}

/**
 * Every type a stretch of text names, first mention first. `explicitValue`
 * is true for a title or a labelled value, where a bare "Contract" is the
 * employer's statement; in free text only an explicit arrangement counts.
 * A stated W-2 relationship removes every contract reading.
 */
function typeHits(text: string, explicitValue: boolean): TypeHit[] {
  const w2 = W2_RE.test(text);
  const hits: TypeHit[] = [
    ...hitsOf(LOCUM_RE, 'Locum Tenens', text),
    ...hitsOf(explicitValue ? PER_DIEM_VALUE_RE : PER_DIEM_TEXT_RE, 'Per Diem', text),
    ...hitsOf(PART_TIME_RE, 'Part-Time', text),
    ...hitsOf(FULL_TIME_RE, 'Full-Time', text),
    ...(explicitValue ? hitsOf(FT_ABBREVIATION_RE, 'Full-Time', text) : []),
    ...(explicitValue ? hitsOf(PT_ABBREVIATION_RE, 'Part-Time', text) : []),
    ...(w2 ? [] : hitsOf(explicitValue ? CONTRACT_VALUE_RE : CONTRACT_TEXT_RE, 'Contract', text)),
  ];
  return hits.sort((a, b) => a.index - b.index);
}

/** Schedules a posting can offer side by side ("Full-Time or Part-Time", "FT/PRN"). */
const COMBINABLE: ReadonlySet<JobTypeLabel> = new Set(['Full-Time', 'Part-Time', 'Per Diem']);

/**
 * The types to report for a set of hits: the first one named, plus a second
 * schedule when both are schedules the posting offers side by side.
 */
function typesFromHits(hits: readonly TypeHit[]): JobTypeLabel[] {
  const ordered: JobTypeLabel[] = [];
  for (const hit of hits) if (!ordered.includes(hit.type)) ordered.push(hit.type);
  if (ordered.length === 0) return [];
  const [primary, secondary] = ordered;
  if (secondary && COMBINABLE.has(primary) && COMBINABLE.has(secondary)) return [primary, secondary];
  return [primary];
}

/* ─── Boilerplate ───────────────────────────────────────────────────────── */

/** Equal opportunity, legal and privacy sentences say nothing about the role. */
const LEGAL_BOILERPLATE_RE =
  /equal (?:employment )?opportunit|\beeo\b|affirmative action|without regard to|protected veteran|veteran status|sexual orientation|gender identity|national origin|genetic information|reasonable accommodation|e-verify|pay transparency|drug[- ]free workplace|know your rights|\bprivacy\b|\bccpa\b|\bnotice\b|applicants? with (?:a )?disabilit/i;

/**
 * Benefits policy: a sentence about which employees receive what. "Full-time
 * and part-time team members are eligible for..." describes the employer's
 * policy, not this job. "This is a full-time, benefits-eligible position"
 * names no employee group and is kept.
 */
const EMPLOYEE_GROUP_RE = /\b(?:employees?|team\s+members?|staff\s+members?|colleagues?|associates|caregivers|workers|teammates)\b/i;
const BENEFIT_WORD_RE = /\b(?:eligib\w*|benefits?|qualif\w*|receive|pto|paid\s+time\s+off|insurance|401\s*\(?k\)?|403\s*\(?b\)?|retirement|tuition|discounts?)\b/i;
/** "(e.g., full-time, part-time, per diem...)": an example list, not this job. */
const EXAMPLE_LIST_RE = /\be\.\s?g\.|\bi\.\s?e\.|\bsuch as\b|\bincluding\b/i;

function isBoilerplate(sentence: string): boolean {
  if (LEGAL_BOILERPLATE_RE.test(sentence)) return true;
  return EMPLOYEE_GROUP_RE.test(sentence) && BENEFIT_WORD_RE.test(sentence);
}

/** Sentences and lines of a description (bullets and periods both split). */
function sentencesOf(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .replace(/([.!?])\s+(?=[A-Z(])/g, '$1\n')
    .split(/\n+|\s[•·]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The description with boilerplate removed and every clause that
 * enumerates three or more types (or lists types as examples) dropped.
 * Returned as one string so hit positions keep the text's order.
 */
export function stripJobTypeBoilerplate(text: string | null | undefined): string {
  if (!text) return '';
  const kept: string[] = [];
  for (const sentence of sentencesOf(text)) {
    if (isBoilerplate(sentence)) continue;
    const clauses = sentence.split(/[;()]/).filter((clause) => {
      const distinct = new Set(typeHits(clause, false).map((h) => h.type));
      if (distinct.size >= 3) return false;
      if (distinct.size >= 2 && EXAMPLE_LIST_RE.test(clause)) return false;
      return true;
    });
    if (clauses.length > 0) kept.push(clauses.join(' '));
  }
  return kept.join('\n');
}

/* ─── Labelled lines ────────────────────────────────────────────────────── */

/**
 * "Status: Full time", "Job Type: Part-time", "Schedule: Part-time",
 * "Employment Type Full time" (a two-word label may omit the colon; a
 * one-word label may not, so "status of" or "schedule a" never reads as one).
 */
const TWO_WORD_LABEL =
  '(?:employment|job|position|employee|worker|work|time)\\s+(?:type|status|category|schedule|classification)|work\\s+schedule';
const ONE_WORD_LABEL = '(?:status|schedule|commitment|shift\\s+type)';
/** A label and the value after it, up to the end of its line or clause. */
const LABELLED_VALUE_RE = new RegExp(
  `\\b(?:(?:${TWO_WORD_LABEL})\\s*[:\\-–|]?|${ONE_WORD_LABEL}\\s*[:\\-–|])\\s*([^\\n|•·;.]{2,48})`,
  'gi',
);
const HOURS_PER_WEEK_RE =
  /\b(?:hours?\s*(?:per|\/|a|each)\s*week|weekly\s+hours|scheduled\s+hours(?:\s+per\s+week)?|standard\s+hours)\s*[:\-–]?\s*(\d{1,2}(?:\.\d+)?)\b/i;
const FTE_RE = /\bfte\s*[:\-–]?\s*(1(?:\.0+)?|0?\.\d+)\b/i;

/** Weekly hours at or above this read as full time. */
export const FULL_TIME_MIN_WEEKLY_HOURS = 36;
/** Weekly hours at or below this (and above zero) read as part time. */
export const PART_TIME_MAX_WEEKLY_HOURS = 30;
/** An FTE at or above this reads as full time. */
export const FULL_TIME_MIN_FTE = 0.9;
/** An FTE at or below this (and above zero) reads as part time. */
export const PART_TIME_MAX_FTE = 0.75;

/** A labelled value's types ("Full time", "Regular Full-Time", "PRN", "Contract"). */
export function interpretJobTypeValue(value: string | null | undefined): JobTypeLabel[] {
  const v = (value ?? '').trim();
  if (!v) return [];
  const casual = /\bcasual\b/i.test(v) ? [{ type: 'Per Diem' as const, index: v.search(/\bcasual\b/i) }] : [];
  return typesFromHits([...typeHits(v, true), ...casual].sort((a, b) => a.index - b.index));
}

/**
 * Types from labelled lines, hours per week or FTE, in that order. Read from
 * the description with boilerplate removed, so a benefits sentence such as
 * "Employee status: full-time employees are eligible..." never counts.
 */
export function labelledJobTypes(description: string | null | undefined): JobTypeLabel[] {
  const text = stripJobTypeBoilerplate(description);
  if (!text) return [];
  LABELLED_VALUE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABELLED_VALUE_RE.exec(text)) !== null) {
    const types = interpretJobTypeValue(m[1]);
    if (types.length > 0) {
      LABELLED_VALUE_RE.lastIndex = 0;
      return types;
    }
  }
  LABELLED_VALUE_RE.lastIndex = 0;
  const hours = text.match(HOURS_PER_WEEK_RE);
  if (hours) {
    const h = Number(hours[1]);
    if (h >= FULL_TIME_MIN_WEEKLY_HOURS && h <= 80) return ['Full-Time'];
    if (h > 0 && h <= PART_TIME_MAX_WEEKLY_HOURS) return ['Part-Time'];
  }
  const fte = text.match(FTE_RE);
  if (fte) {
    const f = Number(fte[1]);
    if (f >= FULL_TIME_MIN_FTE && f <= 1) return ['Full-Time'];
    if (f > 0 && f <= PART_TIME_MAX_FTE) return ['Part-Time'];
  }
  return [];
}

/* ─── Public API ────────────────────────────────────────────────────────── */

/**
 * A sentence about this job itself: "This is a full-time position", "This
 * full-time role", "The position is part-time", "This role offers per diem
 * shifts".
 */
const SELF_STATEMENT_RE =
  /\bthis\s+(?:is\s+an?\s+)?(?:[\w/-]+[\s,]+){0,4}?(?:position|role|job|opportunity|opening)\b|\b(?:this|the)\s+(?:position|role|job|opportunity|opening)\s+(?:is|offers)\b/i;

/**
 * Every type a stretch of free text states, primary first, after removing
 * boilerplate and enumerations. The first sentence about this job itself
 * that names a type decides ("...as part-time faculty. This full-time role
 * ..." is full time); otherwise the first mention does. Empty when none.
 */
export function detectJobTypes(text: string | null | undefined): JobTypeLabel[] {
  const stripped = stripJobTypeBoilerplate(text);
  for (const sentence of stripped.split('\n')) {
    if (!SELF_STATEMENT_RE.test(sentence)) continue;
    const stated = typesFromHits(typeHits(sentence, false));
    if (stated.length > 0) return stated;
  }
  return typesFromHits(typeHits(stripped, false));
}

/**
 * True when the posting states W-2 employment in its title or in the
 * description outside boilerplate. Such a posting is never read as a
 * contract, from any source (the stored type included: see
 * resolveEmploymentTypes in app/jobs/[slug]/job-posting-facts.ts).
 */
export function statesW2Employment(title: string | null | undefined, description: string | null | undefined): boolean {
  return W2_RE.test(`${title ?? ''}\n${stripJobTypeBoilerplate(description)}`);
}

/**
 * True when a stated W-2 relationship may be read as full time: W-2 is
 * stated and nothing speaks of a contract or a temporary assignment.
 */
function w2ReadsAsFullTime(title: string | null | undefined, description: string | null | undefined): boolean {
  if (!statesW2Employment(title, description)) return false;
  return !FIXED_TERM_WORDING_RE.test(`${title ?? ''}\n${stripJobTypeBoilerplate(description)}`);
}

/**
 * The employment type a stretch of text states, or null. Free-text rules
 * (see the header); a stated W-2 relationship reads as full time only when
 * nothing else names a type and nothing speaks of a contract.
 */
export function detectJobType(text: string | null | undefined): string | null {
  const types = detectJobTypes(text);
  if (types.length > 0) return types[0];
  return w2ReadsAsFullTime('', text) ? 'Full-Time' : null;
}

/** The types a title states (a bare "Contract" counts here). */
export function titleJobTypes(title: string | null | undefined): JobTypeLabel[] {
  return typesFromHits(typeHits(title ?? '', true));
}

/**
 * The employment type of a posting, strongest source first (see the
 * header). `canonicalAts` is the ATS field already run through
 * canonicalizeJobType (null when absent or unrecognised).
 */
export function resolveJobType(input: {
  canonicalAts: string | null;
  title: string;
  description: string | null | undefined;
}): JobTypeResolution {
  // A stated W-2 relationship anywhere in the posting rules out a contract
  // reading from every source, the ATS field and the title included.
  const w2Stated = statesW2Employment(input.title, input.description);
  const allowed = (types: readonly string[]): string[] =>
    w2Stated ? types.filter((type) => type !== 'Contract') : [...types];

  const sources: ReadonlyArray<readonly [JobTypeSource, () => readonly string[]]> = [
    ['ats', () => (input.canonicalAts ? [input.canonicalAts] : [])],
    ['title', () => titleJobTypes(input.title)],
    ['label', () => labelledJobTypes(input.description)],
    ['text', () => detectJobTypes(input.description)],
  ];
  let contractVetoed = false;
  for (const [source, read] of sources) {
    const stated = read();
    const types = allowed(stated);
    if (types.length < stated.length) contractVetoed = true;
    if (types.length > 0) return { jobType: types[0], types, source };
  }
  // A vetoed "Contract" beside W-2 ("NP - Contract", an ATS "Contract"
  // field, "W-2 contract position") is a fixed-term arrangement of unknown
  // schedule: it is never read as full time.
  if (!contractVetoed && w2ReadsAsFullTime(input.title, input.description)) {
    return { jobType: 'Full-Time', types: ['Full-Time'], source: 'w2' };
  }
  return { jobType: null, types: [], source: null };
}

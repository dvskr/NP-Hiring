/**
 * lib/work-mode-detection.ts: the work mode a posting's text states
 * (indexing audit GFJ-01, GFJ-02, H-03).
 *
 * THE BUGS THIS FIXES in the old detectMode (lib/job-normalizer.ts):
 *   - "home-based" counted as remote, so home-visit field roles (Clover
 *     "Home-Based Care", "This is a home-based position. You will travel to
 *     patients' homes") published TELECOMMUTE. Home-based is remote only when
 *     the posting says remote too;
 *   - "flexible schedule" counted as hybrid and was checked before remote,
 *     so Seven Starling's "Flexible Schedule, 100% Remote" became Hybrid and
 *     lost TELECOMMUTE;
 *   - negations were read as claims: LifeStance's "this is NOT a 100% remote
 *     position and requires some level of in-office presence" read Remote,
 *     and so did the VA announcement template on USAJOBS ("Telework: Not
 *     Available", "Virtual: This is not a virtual position."), "This is not
 *     a work from home position", "No telecommuting", "Remote Job: No",
 *     "Telework isn't available", "We are unable to offer work from home",
 *     a dash field such as "Telework - No" with text after it on the line,
 *     and "not eligible for telework": in-person jobs stored remote and
 *     listed on /jobs/remote;
 *   - negations were matched only by listed phrasings, so any other wording
 *     ("This is not currently a remote position", "There is no option to
 *     work from home", "Telework will not be considered", "Work from home is
 *     prohibited", "Telework: Not at this time") still read as a claim. Two
 *     general forms now catch a negator shortly before a term in the same
 *     clause, and a term followed by a negated verb, a prohibition or a
 *     "not" field value (see NEGATED_MODE_RES);
 *   - a telework negation also outvoted a job's own remote statement, so a
 *     federal remote job ("Remote job: Yes / Telework eligible: No") and the
 *     VA virtual template ("Telework: Not Available / Virtual: This is a
 *     virtual position.") stored In-Person;
 *   - an ATS "Remote Type: Onsite" field (Mass General Brigham, Workday) was
 *     outvoted by any remote word elsewhere in the text.
 *
 * ORDER NOW:
 *   1. an ATS remote-type field in the text ("Remote Type: Onsite",
 *      "Remote Type Hybrid") decides outright;
 *   2. negated statements are removed before anything else is read, and
 *      remembered: "not 100% remote" means partly remote (Hybrid); a negated
 *      remote, virtual or work from home statement ("not a remote position",
 *      "no work from home", "not eligible for remote work", "Virtual: This
 *      is not a virtual position.") means on site; a negated telework
 *      statement ("Telework: Not Available", "not a telework position"), or
 *      occasional telework only ("Telework: Ad hoc", "situational
 *      telework"), means on site unless the job says it is remote; "not a
 *      hybrid role" is simply not hybrid. Beyond the listed forms, any
 *      negator up to four words before a term in the same clause, or a term
 *      followed by a negated verb or a prohibition, is a negation of that
 *      term; a negator that governs something else (a perk, an obligation,
 *      a condition, a contrast, a question) is not. "5 days on-site a week"
 *      is on site, not hybrid;
 *   3. an explicit full-remote statement ("100% remote", "fully remote",
 *      "fully virtual") beats hybrid wording;
 *   4. hybrid wording ("hybrid", "3 days in office", "partially remote");
 *   5. a negated full-remote statement reads Hybrid;
 *   6. telework offered as an option ("Telework eligible: Yes", "Telework:
 *      Available", "eligible for telework") reads Hybrid: the job keeps a
 *      duty station;
 *   7. a negated remote, virtual or work from home statement reads
 *      In-Person, whatever other remote wording is left;
 *   8. a statement that the job is remote ("remote position", "virtual
 *      role", "Remote job: Yes", "Remote with occasional travel");
 *   9. a negated telework statement reads In-Person;
 *  10. other remote wording ("work from home", "telework");
 *  11. on-site wording.
 *
 * Pure: no database, no network.
 */

export type WorkMode = 'Remote' | 'Hybrid' | 'In-Person';

/** An ATS remote-type field copied into the description by the feed. */
const ATS_REMOTE_TYPE_RE =
  /\bremote\s*type\s*[:\-–]?\s*(on[\s-]?site|onsite|in[\s-]?person|in[\s-]?office|office|hybrid|remote|fully\s+remote|virtual)\b/i;

/** "not a 100% remote position", "not fully remote": partly remote. */
const NEGATED_FULL_REMOTE_RE =
  /\b(?:not|isn['’]t|is\s+not)\s+(?:a\s+|an\s+)?(?:100\s*%|100\s+percent|fully|completely|entirely|totally)[\s-]*(?:remote|virtual|tele[\s-]?work(?:ing)?|work(?:ing)?[\s-]+from[\s-]+home|tele(?:health|medicine|psychiatry))\b/gi;

/**
 * A telework term: telework, telecommuting, work from home or WFH. After a
 * dash any "No" value is a field value ("Telework - No Tampa, FL"), and only
 * these may take an occasional-only value ("Telework: Ad hoc").
 */
const TELEWORK_TERM = String.raw`(?:tele[\s-]?work(?:ing)?|tele[\s-]?commut\w*|work(?:ing)?[\s-]+(?:from|at)[\s-]+home|wfh)`;
/**
 * A work-mode term a negation can govern: a telework term, virtual, remote
 * or hybrid. "Remote work", "working from home" and "teleworking" are one
 * term.
 */
const MODE_TERM = String.raw`(?:${TELEWORK_TERM}|virtual|remote(?:[\s-]+work(?:ing)?)?|hybrid(?:[\s-]+work(?:ing)?)?)`;
/** One or more terms and a separator, ahead of the last term of a list. */
const MODE_TERM_LIST_HEAD = String.raw`(?:${MODE_TERM}\s*(?:,|\/|\bor\b|\band\b)\s*)`;
/** A list of terms: "telework or remote work", "hybrid or remote work", "telework/telecommuting". */
const MODE_TERMS = String.raw`${MODE_TERM_LIST_HEAD}*${MODE_TERM}`;
/** The nouns a field label can carry: "Remote Job: No", "Telework eligible: No". */
const LABEL_NOUN = String.raw`(?:eligible|eligibility|option|options|status|availability|available|job|position|role|arrangements?|opportunit(?:y|ies))`;
/** What a term can be followed by before its negated value. */
const MODE_TERM_NOUN = String.raw`(?:[\s-]+${LABEL_NOUN})?`;
/**
 * A negated availability: "not available", "isn't an option", "aren't
 * permitted", "not currently offered", "will not be authorized", "cannot be
 * approved".
 */
const NOT_OFFERED =
  String.raw`(?:(?:not|isn['’]t|aren['’]t)\s+(?:be\s+)?|(?:cannot|can['’]t|won['’]t)\s+be\s+)(?:currently\s+)?` +
  String.raw`(?:available|an\s+option|permitted|offered|authorized|authorised|allowed|possible|supported|approved|eligible|applicable)`;
/**
 * A "No" field value. Not when a perk follows it: "Work from home - no
 * commute", "Remote work: no travel required" say what the job spares you.
 */
const NO_WORD =
  String.raw`(?:no|none)\b(?!\s+(?:travel\w*|commut\w*|driving|relocation|weekends?|nights?|evenings?|holidays?|overnights?|` +
  String.raw`on[\s-]?call|call|office|scrubs|experience|prior|previous)\b)`;
/** A field value that says no: "No", "None", "N/A", a negated availability, "ineligible". */
const NO_VALUE = String.raw`(?:${NO_WORD}|n\/a|${NOT_OFFERED}|ineligible|unavailable)\b`;
/**
 * A label that is a field whatever follows its dash: a telework term, a list
 * of terms, or remote, virtual or hybrid with a noun ("Remote Job", "Remote
 * Work Eligible", "Virtual Position").
 */
const DASH_FIELD_LABEL =
  String.raw`(?:${MODE_TERM_LIST_HEAD}+${MODE_TERM}${MODE_TERM_NOUN}|${TELEWORK_TERM}${MODE_TERM_NOUN}|` +
  String.raw`(?:remote|virtual|hybrid)(?:[\s-]+work(?:ing)?)?[\s-]+${LABEL_NOUN}|(?:remote|hybrid)[\s-]+work(?:ing)?)`;

/** A word that negates what follows it in its clause; a perk after "no" is not one (NO_WORD). */
const NEGATOR =
  String.raw`(?:not|never|cannot|can['’]t|won['’]t|doesn['’]t|don['’]t|isn['’]t|aren['’]t|wasn['’]t|unable|neither|nor|${NO_WORD})`;
/**
 * A word that ends a negation's reach, or shows the negation is about
 * something else: a conjunction or contrast ("not onsite but hybrid", "not
 * sure if"), a focus word ("not only", "not just"), a limit ("not limited
 * to"), an obligation ("don't have to relocate to work from home", "no need
 * to"), or a marketing idiom ("no matter where", "don't miss", "no better").
 */
const NEGATION_SCOPE_END =
  String.raw`(?:(?:but|yet|and|rather|instead|however|although|though|while|whereas|except|if|unless|when|whenever|where|wherever|` +
  String.raw`whether|because|since|so|until|than|only|just|merely|simply|even|also|limited|restricted|better|best|stranger|new|miss|matter)\b|` +
  String.raw`(?:need|needs|needed|have|has|had|required|obligated|expected)\s+to\b)`;
/**
 * What an affirmative idiom puts after "is not" or "doesn't": "Remote work
 * isn't for everyone", "Remote doesn't mean alone", "Work from home is not
 * just a perk", "Remote work is not new to us".
 */
/**
 * The job itself named by a mode term: "this remote position", "our remote
 * role", "the work from home job". A negation after it ("This remote
 * position does not require travel", "is not open to residents of
 * California") governs something else, and a negator before it ("You will
 * never feel isolated in this remote role") governs the verb between.
 */
const JOB_ITSELF_AHEAD =
  String.raw`(?!(?<=\b(?:this|these|that|our|your|their|its|the)\s+)${MODE_TERMS}[\s-]+(?:positions?|roles?|jobs?|opportunit(?:y|ies))\b)`;
const NOT_AFTER_DETERMINER = String.raw`(?<!\b(?:this|these|that|our|your|their|its|my)[^\S\r\n]+)`;

const AFFIRMATIVE_AFTER_NOT =
  String.raw`(?!\s+(?:be\s+)?(?:only|just|merely|simply|limited|restricted|new|uncommon|unusual|for\s+everyone|the\s+same|` +
  String.raw`(?:(?:have|need)\s+to\s+)?(?:mean|means|equal|equals)|a\s+(?:problem|barrier|perk|substitute)|an\s+(?:issue|afterthought|excuse))\b)`;

/**
 * Negated remote, telework, virtual, work from home and hybrid statements.
 * Each match is removed from the text before it is read. The part of a
 * match that names what it negates (the named group "head" when there is
 * one, else the whole match) decides what it denies: remote, virtual or work from home
 * marks the posting on site outright; telework or telecommuting only marks
 * it on site unless the posting says it is a remote job (see detectMode).
 * The trailing text a labelled field carries on its line is removed with it
 * but never read.
 */
const NEGATED_MODE_RES: readonly RegExp[] = [
  // A labelled field with a negative value after a colon, a bar or a question mark:
  // "Telework: Not Available", "Telework eligible: No", "Remote Job: No", "Work From Home: No",
  // "WFH: N/A", "Is this position remote? No."
  new RegExp(String.raw`\b(?<head>${MODE_TERMS}${MODE_TERM_NOUN}\s*[:|?]\s*${NO_VALUE})[^.\n;]*`, 'gi'),
  // The same after a dash, whatever follows on the line, for a field label:
  // "Telework - No", "Work From Home - No", "WFH - No", "Remote Job - No", "Telework Eligible - No".
  new RegExp(String.raw`\b(?<head>${DASH_FIELD_LABEL}\s*[\-–—]\s*${NO_VALUE})[^.\n;]*`, 'gi'),
  // A bare "Remote - No" or "Virtual - No" only when the value stands alone, so "Remote - no
  // travel required" is not one; "Remote - Not available" always is.
  new RegExp(
    String.raw`\b(?<head>${MODE_TERM_LIST_HEAD}*(?:remote|virtual|hybrid)\s*[\-–—]\s*` +
      String.raw`(?:(?:no|none|n\/a)(?=\s*(?:$|[.\n;,)]))|(?:${NOT_OFFERED}|ineligible|unavailable)\b))[^.\n;]*`,
    'gim',
  ),
  // Occasional telework only, as a field value: "Telework: Ad hoc", "Telework - Situational".
  new RegExp(
    String.raw`\b(?<head>${TELEWORK_TERM}${MODE_TERM_NOUN}\s*[:|?\-–—]\s*(?:ad[\s-]?hoc|situational|occasional)\b)[^.\n;]*`,
    'gi',
  ),
  // A labelled field whose value denies it, removed with its label: "Virtual: This is not a virtual position."
  // The term the value denies decides what it negates; the words before the negation stay
  // ("Telework: This is a remote position, not a telework position").
  new RegExp(
    String.raw`\b${MODE_TERMS}${MODE_TERM_NOUN}\s*:(?<keep>[^.\n;:]*?)\b(?:not|non)[\s-]+(?:a\s+|an\s+)?(?<head>${MODE_TERMS})[^.\n;]*`,
    'gi',
  ),
  // "Telecommuting is not available", "Work from home isn't an option", "Remote work not permitted",
  // "Hybrid or remote work is not available", "Remote options are not available".
  new RegExp(String.raw`\b${JOB_ITSELF_AHEAD}${MODE_TERMS}${MODE_TERM_NOUN}\s+(?:is\s+|are\s+|will\s+|may\s+)?${NOT_OFFERED}\b`, 'gi'),
  // "This is not a work from home position", "not remote-eligible", "not a telework position",
  // "Non-remote position", "This role is not remote", "not telework eligible", "not a hybrid role".
  new RegExp(
    String.raw`\b(?:not|isn['’]t|non)[\s-]+(?:a\s+|an\s+)?${MODE_TERMS}(?:[\s-]+(?:eligible|friendly|first|based))?(?:\s+(?:position|role|job|opportunity|option|eligible|work))?\b`,
    'gi',
  ),
  // "not eligible for telework or remote work", "ineligible for work from home".
  new RegExp(String.raw`\b(?:not\s+eligible|ineligible)\s+(?:for|to)\s+(?:a\s+|an\s+|any\s+)?${MODE_TERMS}\b`, 'gi'),
  // "No telecommuting", "no work from home", "No WFH", "no remote option", "no remote work".
  new RegExp(
    String.raw`\bno\s+${MODE_TERMS}(?:\s+(?:options?|opportunit(?:y|ies)|flexibility|positions?|arrangements?|work|days?))?\b`,
    'gi',
  ),
  // "We do not offer telework", "does not allow remote work", "cannot accommodate work from home",
  // "We are unable to offer work from home", "We are not able to offer telework".
  new RegExp(
    String.raw`\b(?:(?:does|do|will|can)\s+not|doesn['’]t|don['’]t|won['’]t|cannot|can['’]t|(?:unable|not\s+able)\s+to)\s+` +
      String.raw`(?:offer|allow|permit|provide|support|accommodate)\s+(?:a\s+|an\s+|any\s+)?${MODE_TERMS}\b`,
    'gi',
  ),
  // "This role cannot be performed remotely", "cannot be remote".
  /\b(?:cannot|can\s+not|can['’]t|may\s+not|will\s+not)\s+be\s+(?:(?:performed|done|worked|completed)\s+)?(?:remote(?:ly)?|virtual(?:ly)?|from\s+home)\b/gi,
  // Occasional telework only: "situational telework", "ad hoc telework may be authorized",
  // "occasional work from home". Never "occasional virtual team meetings".
  new RegExp(String.raw`\b(?:situational|ad[\s-]?hoc|occasional|episodic|intermittent)\s+${TELEWORK_TERM}\b`, 'gi'),
  // The general forms, last so every labelled or specific form above is read first; the wording
  // is not enumerated. A negator up to four plain words before a term, on the same line and in
  // the same clause: "This is not currently a remote position", "There is no option to work from
  // home", "You will not be able to work from home", "This role is not open to telework". A word
  // must start with a letter, so a comma, colon, semicolon, dash, digit or sentence end breaks the
  // window, and a scope word (NEGATION_SCOPE_END) ends it. "Whether or not" negates nothing, and
  // neither does a question ("Never held a remote position?").
  new RegExp(
    String.raw`(?<!\bor\s+)\b${NEGATOR}\b` +
      String.raw`(?:[^\S\r\n]+(?!${MODE_TERM}\b)(?!${NEGATION_SCOPE_END})[A-Za-z][A-Za-z'’-]*){0,4}?` +
      String.raw`[^\S\r\n]+${NOT_AFTER_DETERMINER}(?<head>${MODE_TERMS})\b(?![^.!?\n;:]*\?)`,
    'gi',
  ),
  // A term followed by a negated verb or a prohibition: "Telework will not be considered", "Work
  // from home is prohibited", "Telework is not granted", "Telework does not apply to this position",
  // "Telework is unavailable"; or a field whose value starts with not or never: "Telework: Not at
  // this time", "Telework | Not currently". Not an affirmative idiom (AFFIRMATIVE_AFTER_NOT).
  new RegExp(
    String.raw`\b${JOB_ITSELF_AHEAD}(?<head>${MODE_TERMS})${MODE_TERM_NOUN}(?:\s+` +
      String.raw`(?:(?:(?:(?:is|are|was|will|would|may|shall|can|must|does|do)\s+(?:not|never))|isn['’]t|aren['’]t|won['’]t|wouldn['’]t|` +
      String.raw`doesn['’]t|don['’]t|cannot|can['’]t)${AFFIRMATIVE_AFTER_NOT}|` +
      String.raw`(?:is|are)\s+(?:strictly\s+)?(?:prohibited|forbidden|unavailable|disallowed))|` +
      String.raw`\s*[:|]\s*(?:not|never)${AFFIRMATIVE_AFTER_NOT})\b`,
    'gi',
  ),
];

/**
 * Occasional remote or virtual work on a job that is not remote ("on-site
 * role with occasional remote opportunity"): removed so it is not read as a
 * remote statement, but it denies nothing ("Remote position with occasional
 * virtual team meetings" stays remote).
 */
const OCCASIONAL_MODE_RE = /\b(?:situational|ad[\s-]?hoc|occasional|episodic|intermittent)\s+(?:remote|virtual)(?:[\s-]+work(?:ing)?)?\b/gi;

/** A negation that names remote, virtual, work from home or WFH: on site outright. */
const NAMES_REMOTE_RE = /remote|virtual|home|wfh/i;
/** A negation that names only telework or telecommuting: on site unless the posting says it is a remote job. */
const NAMES_TELEWORK_RE = /tele[\s-]?work|tele[\s-]?commut/i;

/**
 * A statement that the job itself is remote: "remote position", "virtual
 * role", "work from home position", "Remote job: Yes", "Remote with
 * occasional travel", "Remote: occasional onsite meetings". A federal remote
 * job is not telework eligible ("Remote job: Yes / Telework eligible: No"),
 * so a negated telework statement does not outvote one.
 */
const EXPLICIT_REMOTE_RE =
  /\b(?:remote|virtual|work[\s-]from[\s-]home|wfh)[\s-]+(?:position|role|job|opportunity)\b|\b(?:remote|virtual)(?:\s+(?:job|position))?\s*[:?]\s*yes\b|\b(?:remote|virtual)\s*(?:[:,\-–—]|\bwith\b)\s*(?:only\s+)?(?:occasional|periodic|infrequent|quarterly|annual|monthly)\s+(?:on[\s-]?site|in[\s-]?person|in[\s-]?office|office|travel|visits?|meetings?|trips?)\b/i;

/** "5 days on-site a week", "on-site five days per week": a full on-site week, not hybrid. */
const FULL_WEEK_ONSITE_RE =
  /\b(?:5|five)\s*days?\s*(?:(?:a|per|each|every)\s+week\s*)?(?:on[\s-]?site|onsite|in[\s-]?person|in[\s-]?(?:the\s+)?office|in[\s-]?clinic)\b(?:\s*(?:a|per|each|every)\s+week\b)?|\b(?:on[\s-]?site|onsite|in[\s-]?person|in[\s-]?(?:the\s+)?office)\s+(?:5|five)\s+days?\s*(?:a|per|each|every)\s+week\b/gi;

/** Explicit statements that the job is 100% remote. */
const FULL_REMOTE_RE =
  /\b(?:100\s*%\s*remote|100\s+percent\s+remote|fully\s+remote|fully\s+virtual|completely\s+remote|entirely\s+remote|100\s*%\s*(?:virtual|telework|work\s+from\s+home)|(?:100\s*%|fully)[\s-]?tele(?:health|medicine|psychiatry))\b/i;

/**
 * Hybrid wording. "Flexible schedule" is a schedule, not a work mode, and is
 * no longer here.
 */
const HYBRID_RE =
  /\b(?:hybrid|split\s+between|days?\s+(?:in[\s-]office|remote)|(?:\d+\s*)?days?\s+(?:on[\s-]site|in[\s-]person)|partial(?:ly)?\s+remote|(?:\d+|one|two|three|four)\s*days?\s*(?:per|a)\s*week\s*(?:remote|on[\s-]?site|in[\s-]?office))\b/i;

/**
 * Telework offered as an option on a job that keeps a duty station: the
 * federal "Telework eligible: Yes", the VA "Telework: Available", "eligible
 * for telework", "telework-eligible position".
 */
const TELEWORK_OPTION_RE =
  /\btele[\s-]?(?:work(?:ing)?|commut\w*)(?:[\s-]+(?:eligible|eligibility|option|options|status|availability|available))?\s*[:\-–—]\s*(?:yes|available|eligible|authorized|authorised|approved|permitted|allowed|optional)\b|\btele[\s-]?(?:work|commut\w*)[\s-]+eligible\b|\beligible\s+(?:for|to)\s+tele[\s-]?(?:work|commut\w*)\b/i;

/**
 * Remote wording. "Home-based" is not here: a home-based position is often
 * a home-visit field role ("home-based care", "home-based primary care"),
 * and it reads remote only when the posting also says remote. Bare "remote"
 * and bare "telehealth" never count (service-line mentions).
 */
const REMOTE_RE =
  /\b(?:wfh|work[\s-]from[\s-]home|remote[\s-]?friendly|remote[\s-]?eligible|remote[\s-]?first|remote\s+(?:position|role|opportunity|job)|telecommut\w*|telework|virtual\s+(?:position|role)|work\s+from\s+anywhere|distributed\s+team|wherever\s+you\s+are|fully\s+distributed)\b|\bremote(?:\s+(?:job|position))?\s*[:?]\s*yes\b/i;

const ONSITE_RE =
  /\b(?:on[\s-]?site|onsite|in[\s-]?person|office[\s-]?based|in[\s-]?office|office\s+location|clinic[\s-]?based|hospital[\s-]?based|outpatient\s+(?:clinic|setting)|brick[\s-]and[\s-]mortar|on[\s-]premises?)\b/i;

/** The mode an ATS remote-type value names, or null. */
function modeOfAtsValue(value: string): WorkMode | null {
  const v = value.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  if (/^(?:on ?site|onsite|in person|in office|office|on premises?)$/.test(v)) return 'In-Person';
  if (/^(?:hybrid(?: remote)?|remote hybrid|partial(?:ly)? remote)$/.test(v)) return 'Hybrid';
  if (/^(?:remote|fully remote|virtual|telecommute|work from home)$/.test(v)) return 'Remote';
  return null;
}

/**
 * The work mode an ATS "Remote Type" field in the text states, or null.
 * Feeds (Workday, Mass General Brigham) copy the field into the description
 * as "Remote Type Onsite"; it is the employer's structured value, so ingest
 * treats it as the structured mode (reconcileWorkMode's first rule).
 */
export function detectAtsRemoteType(text: string | null | undefined): WorkMode | null {
  const m = (text ?? '').match(ATS_REMOTE_TYPE_RE);
  return m ? modeOfAtsValue(m[1]) : null;
}

/**
 * The work mode an ATS structured field holds (Lever workplaceType
 * 'remote' | 'hybrid' | 'on-site' | 'unspecified', Workday remoteType
 * 'Onsite' | 'Hybrid' | 'Hybrid Remote' | 'Remote'), or null for an absent,
 * unspecified or unrecognised value.
 */
export function mapAtsWorkMode(value: unknown): WorkMode | null {
  return typeof value === 'string' && value.trim() ? modeOfAtsValue(value) : null;
}

interface NegationScan {
  /** The text with every negated statement removed. */
  text: string;
  /** "not 100% remote", "not fully remote": partly remote. */
  negatedFull: boolean;
  /** A negated remote, virtual or work from home statement: on site. */
  negatedRemote: boolean;
  /** A negated telework or telecommuting statement only: on site unless the job is said to be remote. */
  negatedTelework: boolean;
  /** "5 days on-site a week". */
  fullWeekOnsite: boolean;
}

/**
 * The named groups of a String.prototype.replace callback: its last
 * argument when the pattern has any, else an empty record.
 */
function replaceGroups(replaceArgs: readonly unknown[]): Record<string, string | undefined> {
  const groups = replaceArgs[replaceArgs.length - 1];
  return groups && typeof groups === 'object' ? (groups as Record<string, string | undefined>) : {};
}

/** Remove negated statements (and a full on-site week) and remember what they said. */
function scanNegations(source: string): NegationScan {
  let negatedFull = false;
  let text = source.replace(NEGATED_FULL_REMOTE_RE, () => {
    negatedFull = true;
    return ' ';
  });
  let negatedRemote = false;
  let negatedTelework = false;
  for (const re of NEGATED_MODE_RES) {
    text = text.replace(re, (match: string, ...rest: unknown[]) => {
      const { head, keep } = replaceGroups(rest);
      const denied = head || match;
      if (NAMES_REMOTE_RE.test(denied)) negatedRemote = true;
      else if (NAMES_TELEWORK_RE.test(denied)) negatedTelework = true;
      return ` ${keep ?? ''} `;
    });
  }
  text = text.replace(OCCASIONAL_MODE_RE, ' ');
  let fullWeekOnsite = false;
  text = text.replace(FULL_WEEK_ONSITE_RE, () => {
    fullWeekOnsite = true;
    return ' ';
  });
  return { text, negatedFull, negatedRemote, negatedTelework, fullWeekOnsite };
}

/**
 * The text with every negated work-mode statement removed ("Telework: Not
 * Available", "This is not a remote position", "no work from home"), so a
 * check for remote wording does not count a statement that denies it.
 */
export function withoutNegatedModeStatements(text: string | null | undefined): string {
  return scanNegations(text ?? '').text;
}

/** The work mode a posting's text states, or null (see the header for the order). */
export function detectMode(text: string): WorkMode | null {
  const source = text ?? '';
  const ats = detectAtsRemoteType(source);
  if (ats) return ats;

  const { text: stripped, negatedFull, negatedRemote, negatedTelework, fullWeekOnsite } = scanNegations(source);

  if (FULL_REMOTE_RE.test(stripped)) return 'Remote';
  if (HYBRID_RE.test(stripped)) return 'Hybrid';
  if (negatedFull) return 'Hybrid';
  if (TELEWORK_OPTION_RE.test(stripped)) return 'Hybrid';
  if (negatedRemote) return 'In-Person';
  if (EXPLICIT_REMOTE_RE.test(stripped)) return 'Remote';
  if (negatedTelework) return 'In-Person';
  if (REMOTE_RE.test(stripped)) return 'Remote';
  if (fullWeekOnsite || ONSITE_RE.test(stripped)) return 'In-Person';
  return null;
}

/**
 * Anything in a posting that could mean the work is done away from a site:
 * "remote", "work from home", "telehealth", "virtual", "home-based",
 * "anywhere". Deliberately broader than detectMode: a row flagged remote
 * with none of these words anywhere has no support for the flag at all.
 */
const REMOTE_EVIDENCE_RE =
  /\bremote\b|\bwork(?:ing)?[\s-]from[\s-]home\b|\bwfh\b|\bfrom\s+(?:your\s+|their\s+|the\s+)?home\b|\bhome[\s-]?based\b|\btele(?:health|medicine|psychiatry|psych|work|commut\w*)\b|\bvirtual(?:ly)?\b|\banywhere\b/i;

/** True when the text carries any remote wording at all (see REMOTE_EVIDENCE_RE). */
export function hasRemoteEvidence(text: string | null | undefined): boolean {
  return REMOTE_EVIDENCE_RE.test(text ?? '');
}

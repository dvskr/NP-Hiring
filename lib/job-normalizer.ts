import { Job } from '@/lib/types';
import { salaryConfig } from '@/config/niche/salary';
import {
  normalizeSalary,
  detectSalaryConflict,
  SALARY_CONFLICT_CONFIDENCE,
} from './salary-normalizer';
import { parseLocation, detectNonUsWorkSite } from './location-parser';
import { formatDisplaySalary } from './salary-display';
import { cleanDescription } from './description-cleaner';
import { findCanonicalName } from './company-normalizer';
import { classifyJobTags } from './pseo/category-tagger';
import { interpretJobTypeValue, resolveJobType as resolveJobTypeFromSources } from './job-type-detection';
import { detectMode, detectAtsRemoteType, mapAtsWorkMode, withoutNegatedModeStatements } from './work-mode-detection';
import { resolveLocationFallback, storedLocality } from './location-fallback';

type NormalizedJob = Omit<Job, 'id' | 'createdAt' | 'updatedAt' | 'viewCount' | 'applyClickCount'> & {
  originalPostedAt?: Date | null;
};

/*
// Helper function to strip HTML tags (currently unused)
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
*/



/** A pay figure read from posting text. */
export interface ExtractedSalary {
  min: number | null;
  max: number | null;
  period: string | null;
  /**
   * True when the text STATES the figure as pay: an explicit period token
   * ("per hour", "annually") or a pay label ("Compensation", "Salary",
   * "Pay range"). False for a bare range whose period was only inferred
   * from its magnitude. Only a stated figure may override a structured
   * source value (see normalizeJobWithReason).
   */
  stated: boolean;
}

// Words that mark an amount as something other than base pay: education
// budgets, bonuses, relocation, retirement, insurance, company finances.
// The Sol rows (audit FB-3) published "$30k/yr" (then "$48k/yr" after a
// second clamp) because "CEU budget of $1,500 annually" was read as salary
// ahead of "Compensation $140,000 - $228,400+" (indexing audit CQ-02).
const BENEFIT_CONTEXT_RE =
  /\b(?:ceus?|cmes?|continuing\s+(?:medical\s+)?education|sign[\s-]?on|signing|bonus(?:es)?|relocation|relocat\w*|stipends?|401\s*\(?k\)?|403\s*\(?b\)?|retirement|reimburse\w*|tuition|allowances?|budget|pto|insurance|deductible|malpractice|funding|raised|revenue|investment|loan\s+repayment|referral|incentives?)\b/gi;
const SALARY_CONTEXT_RE = /\b(?:salary|salaries|compensation|pay|base|rate|wages?|earn\w*|income|range)\b/gi;
/** Clause breaks: pay context never carries across these. */
const CLAUSE_BREAK_RE = /[.;\n,()|]/g;
const BENEFIT_BEFORE_WINDOW = 40;
const BENEFIT_AFTER_WINDOW = 25;
/**
 * Where the text right after an amount stops describing it: a clause break,
 * "+", or a joining word. "$150,000 per year plus bonus" and "$65/hr. PTO
 * and 401(k)." are pay followed by a separate benefit, not a benefit.
 */
const AFTER_CLAUSE_BREAK_RE = /[.;\n,()|+]|\b(?:plus|and|with)\b/i;
/**
 * The amount itself is named as a non-pay figure by the words right after
 * it, optionally behind one qualifier: "$5,000 sign-on bonus", "$10,000 in
 * relocation assistance", "$1,500 annual CEU budget".
 */
const BENEFIT_AFTER_AMOUNT_RE =
  /^\s*(?:[a-z-]+\s+)?(?:sign[\s-]?on|signing|bonus(?:es)?|stipends?|allowances?|budget|reimburse\w*|relocation|ceus?|cmes?|tuition|incentives?|referral|loan\s+(?:repayment|forgiveness))\b/i;

/** The words right after an amount, up to the first clause break or joining word. */
function clauseAfter(text: string, end: number, window: number = BENEFIT_AFTER_WINDOW): string {
  return text.slice(end, end + window).split(AFTER_CLAUSE_BREAK_RE)[0];
}

function lastMatchIndex(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) idx = m.index;
  re.lastIndex = 0;
  return idx;
}

/** The clause in front of an amount: at most 40 chars, cut at the last clause break. */
function clauseBefore(text: string, start: number): string {
  const window = text.slice(Math.max(0, start - BENEFIT_BEFORE_WINDOW), start);
  const cut = lastMatchIndex(CLAUSE_BREAK_RE, window);
  return cut >= 0 ? window.slice(cut + 1) : window;
}

/**
 * True when the amount at [start, end) is a benefit, bonus or other
 * non-pay figure: a benefit word closer to it than any pay word in its own
 * clause, or words in its own after-clause that name it as one ("$5,000
 * sign-on bonus"). A benefit in the NEXT clause or sentence ("$120,000 per
 * year. 401k match.", "$150,000 plus bonus") says nothing about the amount.
 */
function inBenefitContext(text: string, start: number, end: number): boolean {
  const before = clauseBefore(text, start);
  const lastBenefit = lastMatchIndex(BENEFIT_CONTEXT_RE, before);
  const lastPay = lastMatchIndex(SALARY_CONTEXT_RE, before);
  if (lastBenefit >= 0 && lastBenefit > lastPay) return true;
  return BENEFIT_AFTER_AMOUNT_RE.test(clauseAfter(text, end));
}

const EXTRACT_PERIOD_TO_BOUNDS_KEY: Readonly<Record<string, string>> = {
  hour: 'hourly', day: 'daily', week: 'weekly', biweekly: 'biweekly', month: 'monthly', year: 'annual',
};

/**
 * Whether a figure is believable as pay for its period, using the same
 * per-period bounds the validator applies (config/niche/salary.ts). An
 * out-of-band figure is not pay ("$1,500 annually" is a CEU budget, not a
 * salary), so the scan moves on to the next candidate instead of
 * returning it.
 */
function isPlausiblePay(value: number | null, period: string): boolean {
  if (value == null) return true;
  const key = EXTRACT_PERIOD_TO_BOUNDS_KEY[period] ?? period;
  const bounds = (salaryConfig.jobNormalizer.periodBounds as Readonly<Record<string, { min: number; max: number }>>)[key];
  if (!bounds) return true;
  return value >= bounds.min && value <= bounds.max;
}

export function extractSalary(text: string): ExtractedSalary {
  const NONE: ExtractedSalary = { min: null, max: null, period: null, stated: false };
  if (!text) return NONE;

  // Helper to parse a dollar amount string like "120,000", "120k", "55.50"
  function parseDollar(s: string): number {
    const cleaned = s.replace(/,/g, '').trim();
    if (/k$/i.test(cleaned)) {
      return parseFloat(cleaned.replace(/k$/i, '')) * 1000;
    }
    return parseFloat(cleaned);
  }

  // Common separator pattern: -, –, —, to, through
  const sep = '(?:\\s*[-–—]\\s*|\\s+to\\s+|\\s+through\\s+)';
  // Dollar amount: $120,000 or $120k or $55.50
  const amt = '\\$([\\d,]+(?:\\.\\d{1,2})?(?:k)?)';
  const secondAmt = '\\$?([\\d,]+(?:\\.\\d{1,2})?(?:k)?)';

  /**
   * Every match of `pattern`, in order, as a candidate. `build` returns the
   * candidate or null to skip that match. The first candidate that is not
   * a benefit figure and is plausible for its period wins; the scan does
   * not stop at the first match of a pattern any more, so a CEU budget in
   * front of the salary line can no longer hide it.
   */
  function scan(
    pattern: RegExp,
    build: (m: RegExpExecArray) => ExtractedSalary | null,
  ): ExtractedSalary | null {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const candidate = build(m);
      if (!candidate || !candidate.period) continue;
      // Context is read around the first amount, so a pay label inside the
      // match ("Compensation $140,000") counts as the nearest pay word.
      const start = m.index + Math.max(0, m[0].indexOf('$'));
      const end = m.index + m[0].length;
      if (inBenefitContext(text, start, end)) continue;
      if (!isPlausiblePay(candidate.min, candidate.period) || !isPlausiblePay(candidate.max, candidate.period)) continue;
      return candidate;
    }
    return null;
  }

  const contextOf = (m: RegExpExecArray, before: number, after: number): string =>
    text.substring(Math.max(0, m.index - before), m.index + m[0].length + after).toLowerCase();
  /**
   * Bonus context for a single-value cap or floor: the 80 chars before it
   * and the match, plus only its own after-clause, so "up to $250k
   * annually plus bonus" is still a salary cap.
   */
  const bonusContextOf = (m: RegExpExecArray): string =>
    `${contextOf(m, 80, 0)} ${clauseAfter(text, m.index + m[0].length, 30)}`.toLowerCase();
  const looksLikeSalary = (context: string): boolean =>
    context.includes('salary') || context.includes('compensation') || context.includes('pay') ||
    context.includes('rate') || context.includes('wage') || context.includes('earn') ||
    context.includes('income') || /\bper\s*(year|hour|hr)\b/.test(context);
  const looksLikeBonus = (context: string): boolean =>
    context.includes('sign-on') || context.includes('sign on') || context.includes('bonus') ||
    context.includes('relocat') || context.includes('cme') || context.includes('stipend');
  const periodOf = (explicit: string | undefined, value: number): string => {
    const p = explicit?.toLowerCase() ?? null;
    if (p === 'year') return 'year';
    if (p === 'hour' || p === 'hr') return 'hour';
    return value > 1000 ? 'year' : 'hour';
  };

  // 0a. SINGLE-VALUE CAP: "up to $150k", "max $150,000", "up to $150k per year"
  // Runs first so cap-style phrasing isn't intercepted by the period-specific
  // patterns below (which would store the value as min instead of max).
  // Requires salary context within ~80 chars; rejects sign-on / relocation / CME bonuses.
  const capped = scan(
    new RegExp('(?:up\\s+to|max(?:imum)?\\s+(?:of\\s+)?)\\s*' + amt + '\\s*(?:per\\s*(year|hour|hr))?', 'gi'),
    (m) => {
      const context = contextOf(m, 80, 30);
      if (!looksLikeSalary(context) || looksLikeBonus(bonusContextOf(m))) return null;
      const max = parseDollar(m[1]);
      return { min: null, max, period: periodOf(m[2], max), stated: true };
    },
  );
  if (capped) return capped;

  // 0b. SINGLE-VALUE FLOOR: "starting at $120k", "from $90,000"
  const floored = scan(
    new RegExp('(?:starting\\s+at|starting\\s+from|from|at\\s+least|min(?:imum)?\\s+(?:of\\s+)?)\\s*' + amt + '\\s*(?:per\\s*(year|hour|hr))?', 'gi'),
    (m) => {
      const context = contextOf(m, 80, 30);
      if (!looksLikeSalary(context) || looksLikeBonus(bonusContextOf(m))) return null;
      const min = parseDollar(m[1]);
      return { min, max: null, period: periodOf(m[2], min), stated: true };
    },
  );
  if (floored) return floored;

  // 1-6. Explicit period tokens, most specific first.
  const periodPatterns: ReadonlyArray<[string, string]> = [
    // HOURLY: "$50/hour", "$45 - $55 per hour", "$40/hr"
    ['(?:per\\s*hour|per\\s*hr|\\/\\s*(?:hour|hr)|hourly)', 'hour'],
    // DAILY: "$490 - $680 per day", "$500/day"
    ['(?:per\\s*day|\\/\\s*day|daily|per\\s*diem)', 'day'],
    // WEEKLY: "$2,000/week", "$1,800 - $2,500 per week"
    ['(?:per\\s*week|\\/\\s*(?:week|wk)|weekly)', 'week'],
    // BIWEEKLY: "$3,500 biweekly", "$3,000 - $4,000 biweekly"
    ['(?:bi-?weekly|every\\s*(?:two|2)\\s*weeks)', 'biweekly'],
    // MONTHLY: "$8,000/month", "$7,000 - $10,000 per month"
    ['(?:per\\s*month|\\/\\s*(?:month|mo)|monthly)', 'month'],
    // ANNUAL (explicit): "$120,000/year", "$100k - $150k annually", "$120,000 per annum"
    ['(?:per\\s*year|\\/\\s*(?:year|yr)|annual(?:ly)?|yearly|per\\s*annum|p\\.?a\\.?)', 'year'],
  ];
  for (const [token, period] of periodPatterns) {
    const found = scan(
      new RegExp(amt + '(?:' + sep + secondAmt + ')?\\s*' + token, 'gi'),
      (m) => ({ min: parseDollar(m[1]), max: m[2] ? parseDollar(m[2]) : null, period, stated: true }),
    );
    if (found) return found;
  }

  // 7. RANGE WITH SALARY CONTEXT (no explicit period): "Salary: $100,000 - $150,000"
  // "compensation: $120k-$140k", "Pay Range: $107,785.60 - $312,000.00",
  // "Base pay range: $130,000 to $150,000". The label may carry "range", then
  // "of" / "is", then a colon, in that order (the old prefix allowed only one
  // of them, so "range:" fell through to the unlabelled branch as not stated).
  const labelled = scan(
    new RegExp(
      '\\b(?:salary|compensation|pay|earnings?|income|wages?|rate)(?:\\s+range)?\\s*(?:of|is)?\\s*:?\\s*(?:up\\s+to\\s+)?' +
      amt + '(?:' + sep + secondAmt + ')?',
      'gi',
    ),
    (m) => {
      const min = parseDollar(m[1]);
      const max = m[2] ? parseDollar(m[2]) : null;
      // Infer period from value magnitude
      return { min, max, period: min > 500 ? 'year' : 'hour', stated: true };
    },
  );
  if (labelled) return labelled;

  // 8. GENERIC RANGE (no period keyword): "$120,000 - $150,000" or "$120k-$150k"
  // Only match if values look like salaries (not funding, deductibles, etc.)
  const generic = scan(new RegExp(amt + sep + secondAmt, 'gi'), (m) => {
    const min = parseDollar(m[1]);
    const max = parseDollar(m[2]);
    // Filter false positives: skip funding amounts, insurance, sign-on bonuses
    const context = contextOf(m, 50, 50);
    const isFalsePositive =
      context.includes('funding') || context.includes('raised') || context.includes('series') ||
      context.includes('deductible') || context.includes('malpractice') || context.includes('insurance') ||
      context.includes('sign-on') || context.includes('sign on') || context.includes('bonus') ||
      context.includes('revenue') || context.includes('investment');
    if (isFalsePositive) return null;
    // Infer period from value magnitude
    if (min >= 15 && min <= 200 && max >= 15 && max <= 500) return { min, max, period: 'hour', stated: false };
    if (min >= 200 && min <= 5000 && max >= 200 && max <= 10000) {
      // Could be daily or weekly
      return { min, max, period: min <= 1000 ? 'day' : 'week', stated: false };
    }
    if (min >= 20000) return { min, max, period: 'year', stated: false };
    return null;
  });
  if (generic) return generic;

  return NONE;
}

// Employment type detection lives in lib/job-type-detection.ts (indexing
// audit H-03): word boundaries, labelled lines before free text, benefits
// and EEO boilerplate removed, contract only on an explicit arrangement and
// never beside a stated W-2. Re-exported so existing callers keep one import.
export { detectJobType, detectJobTypes, resolveJobType } from './job-type-detection';

/**
 * Map raw aggregator-supplied jobType values to the canonical taxonomy.
 * Without this, Workday's enum values (FULL_TIME, OTHER_EMPLOYMENT_TYPE,
 * UNAVAILABLE, etc.) leak straight into the DB and split the facet filter.
 *
 * Returns the canonical string, or null if the input is unrecognized /
 * a sentinel value that means "no information" — in which case the caller
 * should fall back to detectJobType(fullText).
 */
export function canonicalizeJobType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase().replace(/[\s_-]+/g, '_');

  // Workday + generic "no info" sentinels — discard.
  if (upper === 'OTHER' || upper === 'OTHER_EMPLOYMENT_TYPE' || upper === 'UNAVAILABLE' || upper === 'NA' || upper === 'N_A' || upper === 'UNKNOWN') {
    return null;
  }

  // Canonical taxonomy.
  if (upper === 'FULL_TIME' || upper === 'FULLTIME' || upper === 'PERMANENT') return 'Full-Time';
  if (upper === 'PART_TIME' || upper === 'PARTTIME') return 'Part-Time';
  if (upper === 'CONTRACT' || upper === 'CONTRACTOR' || upper === 'TEMPORARY' || upper === 'TEMP') return 'Contract';
  if (upper === 'PER_DIEM' || upper === 'CASUAL') return 'Per Diem';
  if (upper === 'PRN') return 'PRN';
  if (upper === 'LOCUM_TENENS' || upper === 'LOCUMS' || upper === 'LOCUM') return 'Locum Tenens';
  if (upper === 'INTERN' || upper === 'INTERNSHIP') return 'Internship';

  // "Healthcare" and similar industry tags — discard.
  if (upper === 'HEALTHCARE' || upper === 'MEDICAL' || upper === 'NURSING') return null;

  // Already-canonical pass-through.
  const passthrough = ['Full-Time', 'Part-Time', 'Contract', 'Per Diem', 'PRN', 'Locum Tenens', 'Internship'];
  if (passthrough.includes(trimmed)) return trimmed;

  // A free-form ATS value ("Full-Time Salaried", "Regular Part Time",
  // "Full time - Exempt", Lever commitments): read it as a labelled value.
  // Anything that names no type returns null and the text scan decides.
  return interpretJobTypeValue(trimmed)[0] ?? null;
}

// Work-mode detection lives in lib/work-mode-detection.ts (indexing audit
// GFJ-01): an ATS "Remote Type" field decides outright, negations ("NOT a
// 100% remote position", "Telework: Not Available", "no work from home",
// "not eligible for remote work") are read as negations, an explicit "100% remote"
// beats hybrid wording, and neither "home-based" (home visits) nor
// "flexible schedule" (a schedule) is a work mode. Re-exported so existing
// callers keep one import.
export { detectMode, detectAtsRemoteType, mapAtsWorkMode } from './work-mode-detection';

// Title-level mode tokens for reconcileWorkMode. The TITLE is the strongest
// text signal we have — 'NP - Los Angeles - Onsite' is an explicit
// employer statement, unlike a keyword buried in description boilerplate.
const TITLE_ONSITE_RE = /\bon[\s-]?site\b|\bin[\s-]person\b/i;
// "Remote" names the work mode, not a service line: "Remote Patient
// Monitoring" and "Remote Patient Manager" are programs often run on site,
// and "Non-Remote" or "Not Remote" says the opposite. Those defer to the
// description (indexing audit GFJ-01).
const TITLE_REMOTE_RE =
  /(?<!\bnon[\s-]?)(?<!\bnot\s+)\b(?:remote|work\s+from\s+home|100%\s*remote|telecommute)\b(?!\s+(?:patients?|monitoring|physiologic|therapeutic|care\s+management)\b)/i;
const TITLE_HYBRID_RE = /\bhybrid\b/i;

export interface ReconciledWorkMode {
  mode: string | null;
  isRemote: boolean;
  isHybrid: boolean;
}

function flagsForMode(mode: string): ReconciledWorkMode {
  if (mode === 'Remote') return { mode, isRemote: true, isHybrid: false };
  if (mode === 'Hybrid') return { mode, isRemote: false, isHybrid: true };
  return { mode: 'In-Person', isRemote: false, isHybrid: false };
}

/**
 * Single source of truth for mode ↔ isRemote/isHybrid consistency
 * (live-review item 1e / 7-iv).
 *
 * The previous sync only ratcheted TOWARD remote: a location-parser false
 * positive ('…, United States' → isRemote=true) could never be cleared by a
 * detected 'In-Person' mode, which is how verifiably onsite rows (the Tia
 * '- Onsite' listings) shipped TELECOMMUTE structured data.
 *
 * Precedence, most → least authoritative:
 *   1. `structuredMode` — an explicit machine-readable mode (the employer
 *      post-job form's required work-mode field). Wins over ALL keyword
 *      inference, in both directions.
 *   2. Explicit token in the TITLE (Hybrid > Onsite > Remote; a title
 *      carrying both onsite and remote tokens is ambiguous and defers).
 *   3. Mode detected from full text (`detectMode`).
 *   4. Location-string flags from parseLocation.
 *
 * Output invariants: isRemote and isHybrid are never both true, and the
 * returned mode always agrees with the returned flags. isRemote=true means
 * FULLY remote — that is what /jobs/remote filters on and what JobPosting
 * jobLocationType TELECOMMUTE asserts to Google.
 *
 * Employer create routes (app/api/jobs/post-free, app/api/create-checkout)
 * should call this with their form's mode as `structuredMode` instead of
 * deriving flags from free-text location, so the three write paths cannot
 * drift.
 */
export function reconcileWorkMode(input: {
  title: string;
  detectedMode: string | null;
  locationIsRemote: boolean;
  locationIsHybrid: boolean;
  structuredMode?: string | null;
}): ReconciledWorkMode {
  const { title, detectedMode, locationIsRemote, locationIsHybrid, structuredMode } = input;

  if (structuredMode === 'Remote' || structuredMode === 'Hybrid' || structuredMode === 'In-Person') {
    return flagsForMode(structuredMode);
  }

  // Read the title with its negated mode statements removed, so a title such
  // as "NP - Not Remote" or "Onsite (Not Hybrid)" is not taken as the mode it
  // denies. detectMode already reads these titles this way.
  const titleText = withoutNegatedModeStatements(title);
  const titleOnsite = TITLE_ONSITE_RE.test(titleText);
  const titleRemote = TITLE_REMOTE_RE.test(titleText);
  if (TITLE_HYBRID_RE.test(titleText)) return flagsForMode('Hybrid');
  if (titleOnsite && !titleRemote) return flagsForMode('In-Person');
  if (titleRemote && !titleOnsite) return flagsForMode('Remote');

  if (detectedMode === 'Remote' || detectedMode === 'Hybrid' || detectedMode === 'In-Person') {
    return flagsForMode(detectedMode);
  }

  // No mode signal anywhere in the text — fall back to the location string.
  // Hybrid first: a hybrid location ('Hybrid — Austin, TX') is not fully
  // remote, so the flags stay mutually exclusive.
  if (locationIsHybrid) return flagsForMode('Hybrid');
  if (locationIsRemote) return flagsForMode('Remote');
  return { mode: null, isRemote: false, isHybrid: false };
}

/**
 * Detect experience level from job title + description.
 * Returns: 'New Grad' | 'Mid-Level' | 'Senior' | null
 * 
 * Priority: Senior > Mid-Level > New Grad (most jobs don't specify)
 */
export function detectExperienceLevel(title: string, description: string): string | null {
  const text = `${title} ${description}`.toLowerCase();

  // ── Senior (5+ years) ──
  const seniorPatterns = [
    'senior pmhnp', 'senior psychiatric', 'senior nurse practitioner',
    'lead pmhnp', 'lead psychiatric', 'lead nurse practitioner',
    'supervisor', 'supervisory', 'director',
    'clinical lead', 'program director', 'medical director',
    'chief', 'manager', 'management',
    '5+ years', '5-7 years', '5-10 years', '7+ years', '7-10 years',
    '10+ years', '8+ years', '6+ years',
    'minimum 5 years', 'minimum of 5 years', 'at least 5 years',
    'minimum 7 years', 'minimum of 7 years',
    'senior level', 'advanced practice leader',
  ];
  if (seniorPatterns.some(p => text.includes(p))) return 'Senior';

  // ── Mid-Level (1-5 years) ──
  // Note: "1 year experience" is a Mid-Level *floor*, not a new-grad
  // signal. Previously it lived in newGradPatterns and mis-classified
  // jobs like "PMHNP — 1 year experience required" as New Grad.
  const midPatterns = [
    '1-2 years', '1-3 years', '2-5 years', '3-5 years', '2-4 years', '3-4 years',
    '1+ years', '2+ years', '3+ years', '4+ years',
    'minimum 1 year', 'minimum of 1 year', 'at least 1 year',
    'minimum 2 years', 'minimum of 2 years', 'at least 2 years',
    'minimum 3 years', 'minimum of 3 years', 'at least 3 years',
    'mid-level', 'mid level', 'experienced pmhnp', 'experienced psychiatric',
    '1 year of experience', '1 year experience',
    '2 years of experience', '3 years of experience', '4 years of experience',
    '2 years experience', '3 years experience', '4 years experience',
    'one year', 'two years', 'three years', 'four years',
  ];
  if (midPatterns.some(p => text.includes(p))) return 'Mid-Level';

  // ── New Grad / Entry ──
  // Strictly entry-level signals. Bare "1 year experience" was removed
  // 2026-05-14 because a 1-year minimum is a Mid-Level floor, not a
  // new-grad welcome signal. Keep 0-year ranges and explicit new-grad
  // phrasing only.
  const newGradPatterns = [
    'new grad', 'new graduate', 'entry level', 'entry-level',
    'no experience required', 'no experience necessary',
    '0-1 year', '0-2 year', '0 years of experience',
    'recent graduate', 'newly graduated', 'recent grad',
    // Require "program" after residency/fellowship — bare words also
    // match post-grad APP fellowships requiring prior NP experience.
    'residency program', 'fellowship program', 'training program',
    'mentorship', 'preceptor', 'will train',
    'welcome new grads', 'new grads welcome', 'open to new grads',
    'graduate nurse practitioner',
    'first job', 'just graduated', 'fresh out of school',
  ];
  if (newGradPatterns.some(p => text.includes(p))) return 'New Grad';

  // ── "Open to all levels" / "any experience" — common pattern that
  // indicates the employer doesn't restrict by experience. We return
  // 'Mid-Level' as a safe default since these listings are broadly
  // accessible (covering mid + senior). Returning null would leave
  // the field empty, which our completeness score penalizes.
  const anyLevelPatterns = [
    'open to all levels', 'all levels welcome', 'any experience level',
    'any level', 'experience varies', 'flexible experience',
    'open to candidates of all experience levels',
  ];
  if (anyLevelPatterns.some(p => text.includes(p))) return 'Mid-Level';

  return null;
}

/*
// Commented out functions below (currently unused)
/*
// Helper function to generate job description summary (currently unused)
function generateSummary(description: string, maxLength: number = 300): string {
  const cleanDescription = stripHtml(description);
  if (cleanDescription.length <= maxLength) {
    return cleanDescription;
  }
  
  // Try to cut at a sentence boundary
  const truncated = cleanDescription.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastPeriod > maxLength * 0.7) {
    return truncated.substring(0, lastPeriod + 1);
  }
  
  if (lastSpace > 0) {
    return truncated.substring(0, lastSpace) + '...';
  }
  
  return truncated + '...';
}
*/

export function validateAndNormalizeSalary(
  minSalary: number | null,
  maxSalary: number | null,
  description: string,
  title: string,
  extractedPeriod?: string | null
): { minSalary: number | null; maxSalary: number | null; salaryPeriod: string | null } {
  let min = minSalary;
  let max = maxSalary;
  let period: string | null = null;

  // If no salary data, return nulls
  if (!min && !max) {
    return { minSalary: null, maxSalary: null, salaryPeriod: null };
  }

  // Map extractSalary period names to normalized names
  const periodMap: Record<string, string> = {
    'hour': 'hourly', 'hourly': 'hourly',
    'day': 'daily', 'daily': 'daily',
    'week': 'weekly', 'weekly': 'weekly',
    'biweekly': 'biweekly',
    'month': 'monthly', 'monthly': 'monthly',
    'year': 'annual', 'annual': 'annual',
  };

  // Use extracted period if available, otherwise detect from magnitude.
  // Inference cutoffs derive from the niche's pay levels — see
  // config/niche/salary.ts (jobNormalizer.inference).
  //
  // Review P9 #2a — two fixes in this block:
  //   1. The annual check is INCLUSIVE (>=): the old strict `>` at the
  //      $40,000 boundary combined with the monthly branch's `<=` to tag
  //      exactly $40,000 as monthly → ×12 → a published $480k/yr salary.
  //   2. MONTHLY is never magnitude-inferred. A bare value in the old
  //      monthly band (weeklyBelow..annualAbove) becomes period='unknown':
  //      raw values are kept for the record, but normalizeSalary refuses
  //      to annualize a guess, so the row carries no normalized salary and
  //      is excluded from analytics and salary filtering. Monthly ×12 now
  //      requires an explicit token (source period field or "/month" in
  //      the posting text — both arrive via `extractedPeriod`).
  const INFER = salaryConfig.jobNormalizer.inference;
  if (extractedPeriod && periodMap[extractedPeriod]) {
    period = periodMap[extractedPeriod];
  } else if ((min && min >= INFER.annualAbove) || (max && max >= INFER.annualAbove)) {
    period = 'annual';
  } else {
    const ref = min || max || 0;
    if (ref < INFER.hourlyBelow) {
      period = 'hourly';
    } else if (ref < INFER.weeklyBelow) {
      period = 'weekly';
    } else {
      period = 'unknown';
    }
  }

  // Step 2: DROP out-of-range values. Clamping them to the period's bound
  // (the 2026-05-05 behaviour) published figures no employer stated: "CEU
  // budget of $1,500 annually" became "$30k/yr", and a $40k to $44k posting
  // was marked up to the normalizer's floor (indexing audit CQ-02). A figure
  // outside the plausible band for its period is not pay, so it is removed
  // and, where the posting states a range elsewhere, normalizeJobWithReason
  // takes that instead. Bounds live in config/niche/salary.ts.
  // Widened to a string-indexed Record at the use site (the config object
  // stays deep-readonly); unknown periods fall through the !bounds guard.
  const PERIOD_BOUNDS: Readonly<Record<string, { readonly min: number; readonly max: number }>> =
    salaryConfig.jobNormalizer.periodBounds;

  const dropOutOfBounds = (salary: number | null, p: string): number | null => {
    if (!salary) return null;
    const bounds = PERIOD_BOUNDS[p];
    if (!bounds) return salary; // unknown period — leave alone
    if (salary < bounds.min || salary > bounds.max) {
      console.log(`[Salary] Dropped implausible ${p} figure ${salary} (plausible ${bounds.min} to ${bounds.max})`);
      return null;
    }
    return salary;
  };

  min = dropOutOfBounds(min, period);
  max = dropOutOfBounds(max, period);
  if (!min && !max) {
    return { minSalary: null, maxSalary: null, salaryPeriod: null };
  }

  // Step 3: Swap if minSalary > maxSalary
  if (min && max && min > max) {
    console.log(`Swapping salary range for ${title}: ${min}-${max}`);
    [min, max] = [max, min];
  }

  return {
    minSalary: min ? Math.round(min) : null,
    maxSalary: max ? Math.round(max) : null,
    salaryPeriod: period,
  };
}

// ── Source field mapping config — add new sources here instead of if/else ──
interface SourceFieldConfig {
  title: string[];        // Field names to try for title
  employer: string[];     // Field names to try for employer
  location: string[];     // Field names to try for location
  description: string[];  // Field names to try for description
  applyLink: string[];    // Field names to try for apply link
  externalId: string[];   // Field names to try for external ID
  salaryMin: string[];    // Field names to try for salary min
  salaryMax: string[];    // Field names to try for salary max
  /**
   * Field names to try for the salary period when the source supplies it
   * (e.g. Adzuna sets salaryPeriod='annual'). Without this hint, the
   * validator infers period from magnitude — which gets fooled by the
   * $30k–$40k range (mistakenly classified as monthly).
   */
  salaryPeriod: string[];
  datePosted: string[];   // Field names to try for posted date
  defaultEmployer: string;
  defaultLocation: string;
}

const DEFAULT_CONFIG: SourceFieldConfig = {
  title: ['title', 'job_title', 'jobOpeningName', 'positionName'],
  employer: ['company', 'employer'],
  location: ['location'],
  description: ['description'],
  applyLink: ['applyLink', 'url', 'redirect_url', 'apply_link'],
  externalId: ['externalId', 'id', 'external_id'],
  salaryMin: ['minSalary'],
  salaryMax: ['maxSalary'],
  salaryPeriod: ['salaryPeriod', 'salary_period', 'salaryUnit'],
  datePosted: ['postedAt', 'postedDate', 'posted_at', 'updated_at', 'createdAt', 'updated'],
  defaultEmployer: 'Unknown Company',
  defaultLocation: 'Unknown Location',
};

const SOURCE_CONFIGS: Record<string, Partial<SourceFieldConfig>> = {
  adzuna: {
    applyLink: ['applyLink', 'redirect_url'],
    datePosted: ['postedAt'],
    salaryPeriod: ['salaryPeriod'],
  },
  jsearch: {
    datePosted: ['postedDate'],
    defaultEmployer: 'Company Not Listed',
    defaultLocation: 'United States',
  },
  jooble: {
    employer: ['company'],
    datePosted: ['postedDate'],
    defaultEmployer: 'Company Not Listed',
    defaultLocation: 'United States',
  },
  greenhouse: { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  lever: { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  ashby: { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  smartrecruiters: { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  icims: { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  jazzhr: { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  workday: { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  'fantastic-jobs-db': { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  'ats-jobs-db': { employer: ['company', 'employer'], datePosted: ['postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  usajobs: { employer: ['employer'], datePosted: ['postedAt'], defaultEmployer: 'Federal Government', defaultLocation: 'United States' },
  bamboohr: { employer: ['employer', 'company'], datePosted: ['postedAt', 'postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  workable: { employer: ['employer', 'company'], datePosted: ['postedAt', 'postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  doccafe: { employer: ['employer', 'company'], datePosted: ['postedAt', 'postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
  healthcareercenter: { employer: ['employer', 'company'], datePosted: ['postedAt', 'postedDate'], defaultEmployer: 'Company Not Listed', defaultLocation: 'United States' },
};

function getConfig(source: string): SourceFieldConfig {
  const override = SOURCE_CONFIGS[source] || {};
  return { ...DEFAULT_CONFIG, ...override };
}

function extractField(rawJob: Record<string, unknown>, fields: string[], defaultValue: string): string {
  for (const field of fields) {
    const val = rawJob[field];
    if (val !== undefined && val !== null && val !== '') {
      // Handle nested objects (e.g., adzuna company.display_name)
      if (typeof val === 'object' && val !== null && 'display_name' in (val as Record<string, unknown>)) {
        return String((val as Record<string, unknown>).display_name || defaultValue);
      }
      return String(val);
    }
  }
  return defaultValue;
}

function extractNumericField(rawJob: Record<string, unknown>, fields: string[]): number | null {
  for (const field of fields) {
    if (typeof rawJob[field] === 'number') return rawJob[field] as number;
  }
  return null;
}

function extractDateField(rawJob: Record<string, unknown>, fields: string[]): Date | null {
  for (const field of fields) {
    if (rawJob[field]) {
      const d = new Date(String(rawJob[field]));
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

// Return type with rejection reason for tracking
export interface NormalizeResult {
  job: NormalizedJob | null;
  rejectionReason?: string;
}

/**
 * Canonical rejection reasons emitted by `normalizeJobWithReason`.
 * Stable strings — written verbatim to `rejected_jobs.rejection_reason`
 * so admin queries / pipeline-event metrics can pivot on them.
 *
 * Old free-form strings ("missing_fields:title_or_apply_link",
 * "stale_90d:2026-01-15", "error:...") are retired in favor of these.
 */
export type NormalizerRejectionReason =
  | 'normalizer_missing_required_field'  // title or applyLink absent
  | 'normalizer_missing_description'      // description empty / < MIN_DESCRIPTION_LENGTH
  | 'normalizer_stale_post'               // originalPostedAt > 60 days ago
  | 'normalizer_indirect_apply'           // applyLink points at a known wrapper/redirect host
  | 'normalizer_low_completeness'         // not enough data points (see computeCompleteness)
  | 'normalizer_stub_description'         // title plus metadata lines only (see analyzeDescriptionStub)
  | 'normalizer_non_us_location'          // work site outside the US (owner decision: US jobs only)
  | 'normalizer_exception';               // try/catch caught a runtime error

const MIN_DESCRIPTION_LENGTH = 50;

// ── Stub descriptions (indexing audit GFJ-04) ──────────────────────────
// BambooHR's list endpoint carries no description, and the adapter used to
// compose one from its own metadata: "<role>, Remote TX Part Time, Up to 90
// an Hour / Employer: Televero Health / Department: Clinical / Employment:
// Part-Time / Location: United States" (137 characters). It passed the
// 50-character floor and published as a full JobPosting. Google does not
// allow "job postings with incomplete job descriptions", so a description
// that is only the title and "Key: Value" metadata is rejected at ingest.
// The test is structural, not a bare length floor: Google sets no
// character count, and a short but real paragraph is not a stub.

/** Below this many characters of prose, a title-plus-metadata description is a stub. */
export const STUB_PROSE_FLOOR = 300;
/** Below this many characters of prose, any description is a stub. */
export const MIN_PROSE_CHARS = 80;
const METADATA_LINE_RE = /^[A-Z][A-Za-z /&()'-]{1,40}:\s*\S.{0,100}$/;

export interface DescriptionStubAnalysis {
  isStub: boolean;
  /** Characters left after removing title lines and "Key: Value" lines. */
  proseLength: number;
  metadataLines: number;
  titleLines: number;
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Whether a description is a synthesized stub rather than the employer's
 * posting: it is a stub when fewer than MIN_PROSE_CHARS of prose remain, or
 * when fewer than STUB_PROSE_FLOOR remain and the rest of the text is the
 * title repeated or "Employer: / Department: / Location:" style metadata.
 */
export function analyzeDescriptionStub(description: string | null | undefined, title: string | null | undefined): DescriptionStubAnalysis {
  const text = (description ?? '').replace(/\r/g, '');
  const titleKey = normalizeForCompare(title ?? '');
  let metadataLines = 0;
  let titleLines = 0;
  const prose: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (titleKey && normalizeForCompare(line) === titleKey) {
      titleLines++;
      continue;
    }
    if (line.length < 120 && METADATA_LINE_RE.test(line)) {
      metadataLines++;
      continue;
    }
    prose.push(line);
  }
  const proseLength = prose.join(' ').replace(/\s+/g, ' ').trim().length;
  const structuralStub = (metadataLines >= 2 || titleLines > 0) && proseLength < STUB_PROSE_FLOOR;
  return {
    isStub: proseLength < MIN_PROSE_CHARS || structuralStub,
    proseLength,
    metadataLines,
    titleLines,
  };
}

/**
 * Two-tier completeness gating.
 *
 *   Hard floor (this file)       — score < 20 → reject as truly unsalvageable.
 *   Soft floor (orchestrator)    — score < 40 → try inline LLM rescue, then
 *                                    re-score and decide. See lib/ingestion-service.ts.
 *
 * Calibrated 2026-05-05 against the typical catalog distribution:
 *   - greenhouse / lever:  avg ~50 (description + location + jobType + mode)
 *   - adzuna:              avg ~70 (almost always has salary)
 *   - fantastic-jobs-db:   avg ~38 (often missing mode + salary; LLM rescue tries)
 */

/**
 * Score a normalized job 0-100 by which fields it has populated.
 * Used by the two-tier completeness gate (hard floor here, soft floor
 * in the orchestrator) and as a sortable signal in the admin panel.
 *
 * Weights reflect what users actually need to evaluate a job:
 *   - description (15) — cannot read the role without this
 *   - location (15)    — city OR state required for relevance
 *   - salary (20)      — top user-asked-for filter
 *   - jobType (10)     — FT/PT/Contract distinction matters for fit
 *   - mode (10)        — Remote vs On-site is a hard filter
 *   - clinical setting (10) — what kind of practice
 *   - patient pop (5)
 *   - benefits (5)
 *   - experience level (5)
 *   - employer linked  (5)
 *
 * Title and applyLink are required gates upstream — not counted here.
 */
export function computeCompleteness(job: {
    description?: string | null;
    descriptionSummary?: string | null;
    city?: string | null;
    state?: string | null;
    isRemote?: boolean;
    isHybrid?: boolean;
    normalizedMinSalary?: number | null;
    normalizedMaxSalary?: number | null;
    jobType?: string | null;
    mode?: string | null;
    setting?: string | null;
    population?: string | null;
    benefits?: string[] | null;
    experienceLevel?: string | null;
    companyId?: string | null;
}): number {
    let score = 0;

    if ((job.description?.length ?? 0) >= 200) score += 15;
    else if ((job.description?.length ?? 0) >= 50) score += 8;

    const hasLocation = !!job.city || !!job.state || job.isRemote || job.isHybrid;
    if (hasLocation) score += 15;

    const hasSalary = job.normalizedMinSalary != null || job.normalizedMaxSalary != null;
    if (hasSalary) score += 20;

    if (job.jobType) score += 10;
    if (job.mode) score += 10;
    if (job.setting) score += 10;
    if (job.population) score += 5;
    if (job.benefits && job.benefits.length > 0) score += 5;
    if (job.experienceLevel) score += 5;
    if (job.companyId) score += 5;

    return score;
}

/**
 * Apply-link hosts we reject as "indirect" — these wrap the real
 * employer page in their own preview/login flow, hurting attribution
 * and click-through. Adzuna's redirect_url single-hops to the real
 * employer site so it stays out of this list.
 */
const INDIRECT_APPLY_HOST_PATTERNS = [
    'indeed.com/rc/clk',
    'indeed.com/cmp/',
    'indeed.com/viewjob',
    'glassdoor.com/job-listing/',
    'glassdoor.com/Job/',
    'simplyhired.com/job/',
    'ziprecruiter.com/c/',
    'linkedin.com/jobs/view/',
    'monster.com/job-openings/',
    'dice.com/jobs/detail/',
];

function isIndirectApplyLink(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return INDIRECT_APPLY_HOST_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Light-touch employer-name canonicalization. Two stages:
 *   1. Strip legal suffixes + whitespace ("LifeStance Health, LLC" →
 *      "LifeStance Health").
 *   2. Look up the result in the hand-vetted KNOWN_COMPANIES list via
 *      findCanonicalName (e.g. "Lifestance" → "LifeStance Health",
 *      "Blue Sky Telepsych" → "BlueSky Telepsych"). If unknown, return
 *      the suffix-stripped string unchanged.
 *
 * Stage 2 was added 2026-05-06 after a prod audit found cards displaying
 * the same company under different spellings depending on which source
 * inserted the row first. Heavier company-record linking still happens
 * later via `linkJobToCompany`; this just makes the displayed string
 * canonical at ingest time.
 */
const EMPLOYER_LEGAL_SUFFIX_RE =
    /[,\s]+(?:llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|co\.?|llp|p\.?l\.?l\.?c\.?|p\.?c\.?|p\.?a\.?)\.?$/i;

export function canonicalizeEmployerName(raw: string | null | undefined): string {
    if (!raw) return '';
    let s = String(raw).trim();
    // Collapse repeated whitespace.
    s = s.replace(/\s+/g, ' ');
    // Strip trailing legal suffix (one pass — multiple suffixes are rare).
    s = s.replace(EMPLOYER_LEGAL_SUFFIX_RE, '').trim();
    // Strip dangling trailing comma if any.
    s = s.replace(/,$/, '').trim();
    // Apply curated alias map (LifeStance / BlueSky / SonderMind / …).
    const canonical = findCanonicalName(s);
    return canonical ?? s;
}

/**
 * Section markers used to skip leading "About us" / "Equal Opportunity"
 * boilerplate before truncating the SEO summary. If found within the
 * first 800 chars, the summary starts from the marker.
 */
const SUMMARY_SECTION_MARKERS = [
    'position summary',
    'job description',
    'job summary',
    'job overview',
    'role summary',
    'responsibilities',
    'what you will do',
    "what you'll do",
    'what you will be doing',
    "what you'll be doing",
    'we are seeking',
    'we are looking for',
    'looking for',
    'in this role',
    'as a ',
    'the role',
    'duties include',
    'primary duties',
];

function smartSummarize(fullDescription: string, maxLength: number = 300): string {
    if (!fullDescription) return '';
    const lower = fullDescription.toLowerCase();
    let bestIdx = -1;
    for (const marker of SUMMARY_SECTION_MARKERS) {
        const idx = lower.indexOf(marker);
        if (idx >= 0 && idx <= 800 && (bestIdx === -1 || idx < bestIdx)) {
            bestIdx = idx;
        }
    }
    const start = bestIdx >= 0 ? bestIdx : 0;
    const slice = fullDescription.slice(start, start + maxLength);
    return slice + (fullDescription.length > start + maxLength ? '...' : '');
}

export function normalizeJob(rawJob: Record<string, unknown>, source: string): NormalizedJob | null {
  const result = normalizeJobWithReason(rawJob, source);
  return result.job;
}

export function normalizeJobWithReason(rawJob: Record<string, unknown>, source: string): NormalizeResult {
  try {
    const config = getConfig(source);

    // Extract fields using config
    const title = extractField(rawJob, config.title, '');
    const employer = extractField(rawJob, config.employer, config.defaultEmployer);
    const location = extractField(rawJob, config.location, config.defaultLocation);
    const description = extractField(rawJob, config.description, '');
    const applyLink = extractField(rawJob, config.applyLink, '');
    const externalId = extractField(rawJob, config.externalId, '');
    let salaryMin = extractNumericField(rawJob, config.salaryMin);
    let salaryMax = extractNumericField(rawJob, config.salaryMax);
    const sourceSuppliedPeriod = extractField(rawJob, config.salaryPeriod, '') || null;
    const originalPostedAt = extractDateField(rawJob, config.datePosted);

    // Gate 1: required fields
    if (!title || !applyLink) {
      return { job: null, rejectionReason: 'normalizer_missing_required_field' };
    }

    // Gate 2: indirect-apply check (catch wrapper hosts before any
    // expensive parsing). Adzuna's redirect URL single-hops and is
    // explicitly NOT in the indirect list — see INDIRECT_APPLY_HOST_PATTERNS.
    if (isIndirectApplyLink(applyLink)) {
      return { job: null, rejectionReason: 'normalizer_indirect_apply' };
    }

    // Gate 3: Stale-post (30 days). Tightened 2026-05-06 from 60 → 30d
    // to align ingest inventory with user-facing "Posted Within" filter
    // ceiling and reduce drift between source-claimed dates and what we
    // present as "fresh". Applies to every source.
    if (originalPostedAt && !isNaN(originalPostedAt.getTime())) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (originalPostedAt < thirtyDaysAgo) {
        return { job: null, rejectionReason: 'normalizer_stale_post' };
      }
    }

    // Clean the description with proper formatting
    const fullDescription = cleanDescription(description);

    // Gate 4: missing description. Empty / boilerplate-only descriptions
    // hurt SEO + LLM enrichment + user trust. The threshold is intentionally
    // low (50 chars) to drop only the worst cases.
    if (fullDescription.length < MIN_DESCRIPTION_LENGTH) {
      return { job: null, rejectionReason: 'normalizer_missing_description' };
    }

    // Gate 4b: stub description (indexing audit GFJ-04). A description that
    // is only the title and "Employer: / Department: / Location:" metadata
    // is not a job posting; it must never publish as one.
    if (analyzeDescriptionStub(fullDescription, title).isStub) {
      return { job: null, rejectionReason: 'normalizer_stub_description' };
    }

    // Gate 4c: non-US work site (owner decision 2026-09-28: US jobs only).
    // The ATS country field, the location string, a title segment such as
    // "CRNA - (Iraq)" and work-site phrases in the description all count;
    // see detectNonUsWorkSite for what does not.
    const nonUsWorkSite = detectNonUsWorkSite({
      title,
      description: fullDescription,
      location,
      atsCountry: rawJob.country ?? rawJob.countries,
    });
    if (nonUsWorkSite) {
      return { job: null, rejectionReason: 'normalizer_non_us_location' };
    }

    // Smart summary — skip leading boilerplate when possible.
    const summary = smartSummarize(fullDescription, 300);
    const fullText = `${title} ${fullDescription} ${location}`;

    // Review P9 #2e: extractSalary now ALWAYS runs, so the posting text
    // can challenge a wrong structured value (previously it only ran when
    // structured salary was absent, meaning the description could never
    // contradict a bad ×12).
    const textSalary = extractSalary(fullText);
    const hasStructuredSalary = !!salaryMin || !!salaryMax;

    // Period hint priority:
    //   1. Source-supplied (e.g. adzuna sets salaryPeriod='annual')
    //   2. Regex-extracted from the posting text — adopted outright when
    //      the source had no salary, or as the explicit-period token when
    //      the text is describing the SAME figures the source sent
    //      (values within 5%). This is what lets "$8,000/month" in a
    //      description still annualize ×12 now that magnitude-based
    //      monthly inference is gone.
    //   3. null → magnitude-based inference inside the validator
    let extractedPeriod: string | null = sourceSuppliedPeriod;
    if (hasStructuredSalary && !extractedPeriod && textSalary.period) {
      const sameFigure = (a: number | null, b: number | null): boolean =>
        a != null && b != null && Math.abs(a - b) / Math.max(a, b) <= 0.05;
      if (sameFigure(salaryMin, textSalary.min) || sameFigure(salaryMax, textSalary.max)) {
        extractedPeriod = textSalary.period;
      }
    }

    // Validate both candidates. The validator DROPS a figure outside the
    // plausible band for its period (it no longer clamps one into it).
    const structuredValidated = hasStructuredSalary
      ? validateAndNormalizeSalary(salaryMin, salaryMax, fullText, title, extractedPeriod)
      : null;
    const textValidated = textSalary.min || textSalary.max
      ? validateAndNormalizeSalary(
          textSalary.min,
          textSalary.max,
          fullText,
          title,
          hasStructuredSalary ? textSalary.period : (sourceSuppliedPeriod ?? textSalary.period),
        )
      : null;
    const hasFigure = (v: { minSalary: number | null; maxSalary: number | null } | null): boolean =>
      !!v && (v.minSalary != null || v.maxSalary != null);

    // Review P9 #2e: structured-vs-text conflict check. When the posting
    // text annualizes to a materially different figure (>1.5×) than the
    // structured value, the row is flagged approximate:
    // salaryIsEstimated=true renders the "~" display prefix, and the
    // conflict-floor confidence keeps it out of every published aggregate
    // (npSalaryAnalyticsWhere gates on confidence ≥ 0.8). Deterministic
    // rules only — no schema column, no external calls.
    const salaryConflict = hasFigure(structuredValidated) && detectSalaryConflict(
      { min: structuredValidated!.minSalary, max: structuredValidated!.maxSalary, period: structuredValidated!.salaryPeriod },
      { min: textSalary.min, max: textSalary.max, period: textSalary.period },
    );

    // Which figure the row carries (indexing audit CQ-02: "take pay from the
    // stated range in the description when the structured value is wrong"):
    //   - no structured value → the text figure, as before;
    //   - the structured value was implausible and dropped → the text figure;
    //   - the two conflict and the text STATES its figure as pay (an explicit
    //     period or a pay label) → the text figure, still flagged approximate;
    //   - otherwise the structured value.
    let validatedSalary: { minSalary: number | null; maxSalary: number | null; salaryPeriod: string | null };
    if (!hasStructuredSalary) {
      validatedSalary = textValidated ?? { minSalary: null, maxSalary: null, salaryPeriod: null };
    } else if (!hasFigure(structuredValidated)) {
      validatedSalary = hasFigure(textValidated)
        ? textValidated!
        : { minSalary: null, maxSalary: null, salaryPeriod: null };
    } else if (salaryConflict && textSalary.stated && hasFigure(textValidated)) {
      validatedSalary = textValidated!;
    } else {
      validatedSalary = structuredValidated!;
    }
    salaryMin = validatedSalary.minSalary;
    salaryMax = validatedSalary.maxSalary;
    const salaryPeriod = validatedSalary.salaryPeriod;

    // Employment type (indexing audit H-03), strongest source first: the
    // ATS's structured field (Workday timeType, Greenhouse employment-type
    // metadata, Lever commitment, SmartRecruiters typeOfEmployment; Workday
    // enums like OTHER_EMPLOYMENT_TYPE are discarded), then the title, then
    // a labelled line ("Status: Full time", "Hours Per Week: 40"), then the
    // description with boilerplate removed (lib/job-type-detection.ts).
    const jobType = resolveJobTypeFromSources({
      canonicalAts: canonicalizeJobType(rawJob.jobType ? String(rawJob.jobType) : null),
      title,
      description: fullDescription,
    }).jobType;
    const detectedMode = detectMode(fullText);
    const experienceLevel = detectExperienceLevel(title, fullText);


    // Expiration policy.
    //   Source provided a date  → expiresAt = originalPostedAt + 60 days
    //   Source did NOT          → expiresAt = now + 30 days  (shorter half-life
    //                              for jobs we don't actually know the age of)
    // Single clock — no renewal extensions. Once set, expiresAt stays.
    const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const expiresAt =
      originalPostedAt && !isNaN(originalPostedAt.getTime())
        ? new Date(originalPostedAt.getTime() + SIXTY_DAYS_MS)
        : new Date(Date.now() + THIRTY_DAYS_MS);

    // Normalize salary to annual equivalent
    const normalizedSalaryData = normalizeSalary({
      salaryRange: salaryMin && salaryMax ? `$${salaryMin.toLocaleString()} to $${salaryMax.toLocaleString()}` : null,
      minSalary: salaryMin,
      maxSalary: salaryMax,
      salaryPeriod,
      title,
    });

    if (salaryConflict) {
      console.log(
        `[Salary] Conflict for "${title}": structured ${structuredValidated!.minSalary ?? '?'}-${structuredValidated!.maxSalary ?? '?'} (${structuredValidated!.salaryPeriod ?? 'no period'}) vs text ${textSalary.min ?? '?'}-${textSalary.max ?? '?'} (${textSalary.period ?? 'no period'}); kept ${salaryMin ?? '?'}-${salaryMax ?? '?'}, flagged approximate`,
      );
      normalizedSalaryData.salaryIsEstimated = true;
      normalizedSalaryData.salaryConfidence = Math.min(
        normalizedSalaryData.salaryConfidence ?? SALARY_CONFLICT_CONFIDENCE,
        SALARY_CONFLICT_CONFIDENCE,
      );
    }

    // Parse location into structured data. A posting that passed the non-US
    // gate is a US job (owner decision 2026-09-29), so its stored country is
    // 'US' even when its location field names only its other place ("Canada"
    // on a posting titled "Nurse Practitioner - US, Canada"); the job page
    // reads a non-US country as a non-US listing (isUsListing).
    let parsedLocationData = parseLocation(location);
    if (parsedLocationData.country !== 'US') {
      parsedLocationData = { ...parsedLocationData, country: 'US' };
    }

    // Reconcile mode ↔ isRemote/isHybrid bidirectionally (live-review item
    // 1e). Replaces the previous one-way ratchet, which could only ADD the
    // remote flag — an explicit onsite title ('… - Onsite') or a detected
    // In-Person mode now clears a location-parser false positive instead of
    // being silently outvoted by it. The structured mode is the ATS's own
    // work-mode field when the adapter carries one (Lever workplaceType,
    // Workday remoteType), else an ATS "Remote Type: Onsite" field the feed
    // copied into the description (GFJ-01); the employer create routes pass
    // their form's required work-mode field here instead.
    const workMode = reconcileWorkMode({
      title,
      detectedMode,
      locationIsRemote: parsedLocationData.isRemote,
      locationIsHybrid: parsedLocationData.isHybrid,
      structuredMode: mapAtsWorkMode(rawJob.workMode) ?? detectAtsRemoteType(fullDescription),
    });
    const mode = workMode.mode;
    const isRemote = workMode.isRemote;
    const isHybrid = workMode.isHybrid;

    // CS-03 / GFJ-02: a location field that names no US state ("2
    // Locations", "United States", a facility name) on a job that is not
    // fully remote. The place is often written in the title or on a
    // labelled description line; without it the JobPosting has no
    // jobLocation. The title has authority: a description address in
    // another state than the title names is never used. The stored
    // location text becomes "City, ST" so the page shows the place it is
    // filed under (lib/location-fallback.ts).
    //
    // A location field that itself says remote ("Remote") keeps its text:
    // only the title may place such a job. A text-only In-Person reading
    // ("outpatient setting", "in-person") can clear the remote flag above,
    // and the description then names the employer's office ("based in New
    // York, NY"), not a work site; storing that would publish an on-site
    // address the employer never stated (the CQ-02 false-location class).
    let storedLocation = location;
    if (!parsedLocationData.stateCode && !(isRemote && !isHybrid)) {
      const locationSaysRemote = parsedLocationData.isRemote;
      const fallback = resolveLocationFallback({ title, description: locationSaysRemote ? '' : fullDescription });
      if (fallback && (!locationSaysRemote || fallback.source === 'title')) {
        storedLocation = fallback.label;
        parsedLocationData = {
          ...parsedLocationData,
          city: fallback.city,
          state: fallback.state,
          stateCode: fallback.stateCode,
          country: 'US',
          confidence: fallback.city ? 0.9 : 0.8,
        };
      }
    }

    // No junk city is stored (indexing audit CQ-02): a street fragment,
    // digits, a facility or specialty word, a sentence fragment ("must
    // reside in") or list debris ("or Canada") from any source is dropped
    // here, and the state is kept. The stored city feeds the city pages and
    // JobPosting addressLocality. A town the city dataset knows in that
    // state is kept even when a facility word is part of its name.
    const storedCity = storedLocality(parsedLocationData.city, parsedLocationData.stateCode);
    if (storedCity !== parsedLocationData.city) {
      parsedLocationData = { ...parsedLocationData, city: storedCity };
    }

    // Generate display salary
    const displaySalary = formatDisplaySalary(
      normalizedSalaryData.normalizedMinSalary,
      normalizedSalaryData.normalizedMaxSalary,
      salaryPeriod
    );

    // Gate 5: completeness score. Soft floor — reject if score < threshold.
    // The score is computed against the about-to-be-returned shape, so
    // changes to NormalizedJob fields should be reflected in computeCompleteness.
    // setting/population/benefits are filled later by enrich-jobs cron, so
    // they don't count against fresh ingests; same for companyId.
    const completenessScore = computeCompleteness({
      description: fullDescription,
      descriptionSummary: summary,
      city: parsedLocationData.city,
      state: parsedLocationData.state,
      isRemote,
      isHybrid,
      normalizedMinSalary: normalizedSalaryData.normalizedMinSalary,
      normalizedMaxSalary: normalizedSalaryData.normalizedMaxSalary,
      jobType,
      mode,
      experienceLevel,
      // setting/population/benefits/companyId are populated AFTER ingest by
      // the enrich-jobs cron, so we don't pass them — gate would be too strict.
    });

    // Hard floor: anything under 20 is unsalvageable (no description signal,
    // no location, nothing). Reject immediately without bothering LLM.
    // Soft 40-floor enforcement is moved to the orchestrator (after the
    // inline-LLM rescue pass) so borderline jobs get one chance at LLM
    // enrichment before being rejected.
    const HARD_COMPLETENESS_FLOOR = 20;
    if (completenessScore < HARD_COMPLETENESS_FLOOR) {
      return { job: null, rejectionReason: 'normalizer_low_completeness' };
    }

    // P9: pre-compute canonical category tags so taxonomy×city / taxonomy×state
    // queries can use exact array containment (`categoryTags has 'X'`) instead
    // of brittle OR-on-`title.contains` matchers that produced 5x duplication
    // across pages. Pure function — easy to unit-test, no DB access.
    //
    // CQ-05: the classifier sees the same structured fields the row stores:
    // the reconciled work mode (isRemote and isHybrid, so a hybrid role is
    // never tagged remote) and the stored employer name (the VA rule reads
    // it). Aggregated ingest does not know newGradFriendly or
    // minYearsExperience yet; the enrichment pass that fills them recomputes
    // the tags (lib/ingestion-service.ts).
    const canonicalEmployer = canonicalizeEmployerName(employer);
    const categoryTags = classifyJobTags({
      title,
      description: fullDescription,
      descriptionSummary: summary,
      jobType,
      isRemote,
      isHybrid,
      employer: canonicalEmployer,
    });

    return {
      job: {
        title,
        // Strip legal suffixes ("LifeStance Health, LLC" → "LifeStance Health")
        // so dedup's fuzzy match doesn't split the same company across rows.
        employer: canonicalEmployer,
        location: storedLocation,
        jobType,
        mode,
        experienceLevel,
        // Phase 0 (runbook §2). Aggregated ingest leaves these null;
        // the cron enrichment job in Phase 2 (#4) + backfill (P0.4)
        // populate them downstream.
        minYearsExperience: null,
        maxYearsExperience: null,
        newGradFriendly: false,
        experienceQualifier: null,
        experienceLabel: null,
        description: fullDescription,
        descriptionSummary: summary,
        categoryTags,
        salaryRange: salaryMin && salaryMax ? `$${salaryMin.toLocaleString()} to $${salaryMax.toLocaleString()}` : null,
        minSalary: salaryMin,
        maxSalary: salaryMax,
        salaryPeriod,
        normalizedMinSalary: normalizedSalaryData.normalizedMinSalary,
        normalizedMaxSalary: normalizedSalaryData.normalizedMaxSalary,
        salaryIsEstimated: normalizedSalaryData.salaryIsEstimated,
        salaryConfidence: normalizedSalaryData.salaryConfidence,
        displaySalary,
        city: parsedLocationData.city,
        state: parsedLocationData.state,
        stateCode: parsedLocationData.stateCode,
        country: parsedLocationData.country,
        isRemote: isRemote,
        isHybrid: isHybrid,
        applyLink,
        applyOnPlatform: false,
        isFeatured: false,
        isPublished: true,
        isVerifiedEmployer: false,
        sourceType: 'external',
        sourceProvider: source,
        sourceSite: rawJob.sourceSite ? String(rawJob.sourceSite) : null,
        externalId,
        // Default to "now" when the source doesn't provide a date — keeps
        // every row with a non-null originalPostedAt so user-facing
        // freshness filters and "Posted N days ago" labels are
        // consistent across all sources. The value is essentially
        // equivalent to createdAt for these rows.
        originalPostedAt: originalPostedAt && !isNaN(originalPostedAt.getTime()) ? originalPostedAt : new Date(),
        expiresAt,
        companyId: null,
      }
    };
  } catch (error) {
    console.error('Error normalizing job:', error);
    return { job: null, rejectionReason: 'normalizer_exception' };
  }
}


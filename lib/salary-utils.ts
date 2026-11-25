// ===========================================
// SALARY UTILITIES - Store Both Approach
// ===========================================

import type { Prisma } from '@prisma/client';
import { salaryConfig } from '@/config/niche/salary';

// Niche-specific thresholds — values live in config/niche/salary.ts
const THRESHOLDS = {
  MIN_HOURLY: salaryConfig.utils.minHourly,
  MAX_HOURLY: salaryConfig.utils.maxHourly,
  MIN_ANNUAL: salaryConfig.utils.minAnnual,
  MAX_ANNUAL: salaryConfig.utils.maxAnnual,
};

// Conversion factor for hourly → annual
// 40 hrs/week × 52 weeks = 2,080 hours (standard full-time)
// This matches the conversion in lib/salary-normalizer.ts
const HOURLY_TO_ANNUAL_HOURS = salaryConfig.hoursPerYear;

// ============================================
// TYPES
// ============================================

export interface RawSalaryInput {
  min?: number | null;
  max?: number | null;
  raw?: string | null;
  type?: string | null;
}

export interface ProcessedSalary {
  normalizedMin: number | null;      // For filtering (annual)
  normalizedMax: number | null;      // For filtering (annual)
  displaySalary: string | null;      // For display ("150 to 200/hr")
  salaryType: 'hourly' | 'annual' | 'daily' | 'unknown';
  isValid: boolean;
}

// ============================================
// MAIN PROCESSING FUNCTION
// ============================================

export function processSalary(input: RawSalaryInput): ProcessedSalary {
  const { min, max, raw, type } = input;

  // Default result
  const result: ProcessedSalary = {
    normalizedMin: null,
    normalizedMax: null,
    displaySalary: null,
    salaryType: 'unknown',
    isValid: false,
  };

  // Nothing to process
  if (!min && !max && !raw) {
    return result;
  }

  // Detect salary type
  const detectedType = detectSalaryType(type, raw, min, max);
  result.salaryType = detectedType;

  // Process based on type
  if (detectedType === 'hourly') {
    return processHourlySalary(min, max);
  } else if (detectedType === 'annual') {
    return processAnnualSalary(min, max);
  } else if (detectedType === 'daily') {
    return processDailySalary(min, max);
  }

  // Try to infer from values
  if (min || max) {
    const value = min || max;
    if (value && value >= THRESHOLDS.MIN_HOURLY && value <= THRESHOLDS.MAX_HOURLY) {
      return processHourlySalary(min, max);
    }
    if (value && value >= THRESHOLDS.MIN_ANNUAL) {
      return processAnnualSalary(min, max);
    }
  }

  return result;
}

// ============================================
// SALARY TYPE DETECTION
// ============================================

function detectSalaryType(
  explicitType?: string | null,
  raw?: string | null,
  min?: number | null,
  max?: number | null
): 'hourly' | 'annual' | 'daily' | 'unknown' {

  const typeLower = (explicitType || '').toLowerCase();
  const rawLower = (raw || '').toLowerCase();

  // Check explicit type first
  if (typeLower.includes('hour') || typeLower === 'hourly') return 'hourly';
  if (typeLower.includes('year') || typeLower.includes('annual')) return 'annual';
  if (typeLower.includes('day') || typeLower === 'daily') return 'daily';

  // Check raw string
  if (rawLower.includes('/hr') || rawLower.includes('per hour') || rawLower.includes('hourly')) return 'hourly';
  if (rawLower.includes('/yr') || rawLower.includes('per year') || rawLower.includes('annual')) return 'annual';
  if (rawLower.includes('/day') || rawLower.includes('per day') || rawLower.includes('daily')) return 'daily';

  // Infer from numeric values
  const value = min || max;
  if (value) {
    if (value >= THRESHOLDS.MIN_HOURLY && value <= THRESHOLDS.MAX_HOURLY) return 'hourly';
    if (value >= THRESHOLDS.MIN_ANNUAL) return 'annual';
  }

  return 'unknown';
}

// ============================================
// PROCESS BY TYPE
// ============================================

function processHourlySalary(
  min?: number | null,
  max?: number | null
): ProcessedSalary {
  // Validate range
  const minRate = min || null;
  const maxRate = max || min || null;

  // Check if rates are reasonable
  if (minRate && (minRate < THRESHOLDS.MIN_HOURLY || minRate > THRESHOLDS.MAX_HOURLY)) {
    return {
      normalizedMin: null,
      normalizedMax: null,
      displaySalary: null,
      salaryType: 'hourly',
      isValid: false,
    };
  }

  // Create display string (without $ since icon is used)
  let displaySalary: string;
  if (minRate && maxRate && minRate !== maxRate) {
    displaySalary = `${minRate} to ${maxRate}/hr`;
  } else {
    displaySalary = `${minRate || maxRate}/hr`;
  }

  // Convert to annual for filtering
  const normalizedMin = minRate ? Math.round(minRate * HOURLY_TO_ANNUAL_HOURS) : null;
  const normalizedMax = maxRate ? Math.round(maxRate * HOURLY_TO_ANNUAL_HOURS) : null;

  return {
    normalizedMin,
    normalizedMax,
    displaySalary,
    salaryType: 'hourly',
    isValid: true,
  };
}

function processAnnualSalary(
  min?: number | null,
  max?: number | null
): ProcessedSalary {
  const minSalary = min || null;
  const maxSalary = max || min || null;

  // Validate range
  if (minSalary && (minSalary < THRESHOLDS.MIN_ANNUAL || minSalary > THRESHOLDS.MAX_ANNUAL)) {
    return {
      normalizedMin: null,
      normalizedMax: null,
      displaySalary: null,
      salaryType: 'annual',
      isValid: false,
    };
  }

  // Create display string (without $ since icon is used)
  let displaySalary: string;
  if (minSalary && maxSalary && minSalary !== maxSalary) {
    displaySalary = `${formatK(minSalary)} to ${formatK(maxSalary)}/yr`;
  } else {
    const salaryValue = minSalary || maxSalary;
    if (!salaryValue) {
      return {
        normalizedMin: null,
        normalizedMax: null,
        displaySalary: null,
        salaryType: 'annual',
        isValid: false,
      };
    }
    displaySalary = `${formatK(salaryValue)}/yr`;
  }

  return {
    normalizedMin: minSalary,
    normalizedMax: maxSalary,
    displaySalary,
    salaryType: 'annual',
    isValid: true,
  };
}

function processDailySalary(
  min?: number | null,
  max?: number | null
): ProcessedSalary {
  const minRate = min || null;
  const maxRate = max || min || null;

  // Validate against the niche's daily-rate band (config/niche/salary.ts)
  if (minRate && (minRate < salaryConfig.utils.minDaily || minRate > salaryConfig.utils.maxDaily)) {
    return {
      normalizedMin: null,
      normalizedMax: null,
      displaySalary: null,
      salaryType: 'daily',
      isValid: false,
    };
  }

  // Create display string (without $ since icon is used)
  let displaySalary: string;
  if (minRate && maxRate && minRate !== maxRate) {
    displaySalary = `${minRate} to ${maxRate}/day`;
  } else {
    displaySalary = `${minRate || maxRate}/day`;
  }

  // Convert to annual (assume 200 working days for per diem)
  const normalizedMin = minRate ? Math.round(minRate * 200) : null;
  const normalizedMax = maxRate ? Math.round(maxRate * 200) : null;

  return {
    normalizedMin,
    normalizedMax,
    displaySalary,
    salaryType: 'daily',
    isValid: true,
  };
}

// ============================================
// EXTRACT FROM DESCRIPTION
// ============================================

export function extractSalaryFromDescription(description: string): RawSalaryInput | null {
  if (!description) return null;

  const text = description.replace(/,/g, '');

  // Pattern 1: $XXX - $XXX per hour
  const hourlyRangeMatch = text.match(
    /\$(\d{2,3})(?:\.\d{2})?\s*[-–to]+\s*\$(\d{2,3})(?:\.\d{2})?\s*(?:\/|\s*per\s*)?(?:hr|hour|hourly)/i
  );
  if (hourlyRangeMatch) {
    return {
      min: parseInt(hourlyRangeMatch[1]),
      max: parseInt(hourlyRangeMatch[2]),
      type: 'hourly',
      raw: hourlyRangeMatch[0],
    };
  }

  // Pattern 2: $XXX/hr (single)
  const hourlySingleMatch = text.match(
    /\$(\d{2,3})(?:\.\d{2})?\s*(?:\/|\s*per\s*)(?:hr|hour|hourly)/i
  );
  if (hourlySingleMatch) {
    const rate = parseInt(hourlySingleMatch[1]);
    return { min: rate, max: rate, type: 'hourly', raw: hourlySingleMatch[0] };
  }

  // Pattern 3: $XXXk - $XXXk (annual)
  const annualKMatch = text.match(
    /\$(\d{2,3})k\s*[-–to]+\s*\$(\d{2,3})k/i
  );
  if (annualKMatch) {
    return {
      min: parseInt(annualKMatch[1]) * 1000,
      max: parseInt(annualKMatch[2]) * 1000,
      type: 'annual',
      raw: annualKMatch[0],
    };
  }

  // Pattern 4: $XXX,XXX - $XXX,XXX (annual)
  const annualFullMatch = text.match(
    /\$(\d{2,3})(\d{3})\s*[-–to]+\s*\$(\d{2,3})(\d{3})/i
  );
  if (annualFullMatch) {
    return {
      min: parseInt(annualFullMatch[1] + annualFullMatch[2]),
      max: parseInt(annualFullMatch[3] + annualFullMatch[4]),
      type: 'annual',
      raw: annualFullMatch[0],
    };
  }

  // Pattern 5: $XXX/day (daily/per diem)
  const dailyMatch = text.match(
    /\$(\d{3,4})(?:\.\d{2})?\s*(?:\/|\s*per\s*)(?:day|diem)/i
  );
  if (dailyMatch) {
    const rate = parseInt(dailyMatch[1]);
    return { min: rate, max: rate, type: 'daily', raw: dailyMatch[0] };
  }

  return null;
}

// ============================================
// HELPERS
// ============================================

function formatK(value: number): string {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return value.toString();
}

/* ═══════════════════════════════════════════════════════════════════════
 * PUBLISHED-AGGREGATE SAFETY (review P9 #2c / #2d, salary build 2026-11)
 *
 * Every posting-derived salary figure that reaches a public surface
 * (salary-guide hub, 51 state pages, specialty pages, reports, tools) is
 * computed over THIS pool and summarized by the one engine
 * (lib/salary-report/stats.ts through components/tools/benchmark-model.ts):
 * each employer counts once, a median at 5 or more employers, quartiles at
 * 10 or more. lib/salary-analytics.ts composes it with
 * activeIndexableJobWhere() (the dead-link health check and
 * GLOBAL_EXCLUSIONS every listing surface applies); that composition lives
 * there because this module is also imported by client components, and the
 * listing predicate pulls the Prisma runtime in. The old aggregates ran
 * mean-of-min/max over every published row: 37.5% of the salaried pool
 * was psychiatrist/PA/podiatrist/CNM pay, hourly locum rows annualized
 * to $728k, and 11 states published an "average" of exactly one posting.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Rows below this confidence never enter a published aggregate. */
export const SALARY_ANALYTICS_MIN_CONFIDENCE = 0.8;

/**
 * Contract-cadence periods (locum/1099/per-diem comp). An hourly rate
 * ×2080 is not a W-2 salary — these rows keep their hourly display but
 * are excluded from every published salary aggregate.
 */
export const CONTRACT_CADENCE_PERIODS = [
  'hourly', 'hour', 'daily', 'day', 'weekly', 'week', 'biweekly',
] as const;

/**
 * The role a posted-pay figure describes. Nurse practitioners are the
 * board's figure everywhere; nurse anesthetists and nurse midwives have
 * their own BLS occupations (29-1151, 29-1161) and are reported only on
 * their own specialty pages, never inside an NP figure. CNS postings belong
 * to neither and enter no figure.
 */
export type SalaryRoleScope = 'np' | 'aprn_crna' | 'aprn_midwife';

/** The classifier's ProfessionClass for each scope (prisma/schema.prisma). */
export const SALARY_SCOPE_PROFESSION_CLASS: Readonly<Record<SalaryRoleScope, string>> = {
  np: 'np_eligible',
  aprn_crna: 'aprn_crna',
  aprn_midwife: 'aprn_midwife',
};

/**
 * Prisma predicate for the analytics-eligible salary pool: non-expired,
 * non-estimated, confidence at or above the analytics threshold,
 * annual-cadence, with BOTH normalized bounds (a single figure has no range
 * and does not count, the engine's rule), and the scope's profession class
 * or a NULL class that the title screen judges over the fetched rows
 * (isInSalaryRoleScope). lib/salary-analytics.ts ANDs this with
 * activeIndexableJobWhere(), which carries isPublished, the dead-link health
 * check and GLOBAL_EXCLUSIONS.
 */
export function npSalaryAnalyticsWhere(now: Date = new Date(), scope: SalaryRoleScope = 'np'): Prisma.JobWhereInput {
  return {
    isPublished: true,
    normalizedMinSalary: { not: null },
    normalizedMaxSalary: { not: null },
    salaryIsEstimated: false,
    salaryConfidence: { gte: SALARY_ANALYTICS_MIN_CONFIDENCE },
    AND: [
      // Expired rows advertise pay nobody can get any more.
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      // notIn alone would drop NULL-period legacy rows (SQL NOT IN + NULL);
      // those are annual-cadence rows from before period storage existed.
      { OR: [{ salaryPeriod: null }, { salaryPeriod: { notIn: [...CONTRACT_CADENCE_PERIODS] } }] },
      // The role: the classifier's verdict, or an unclassified row whose
      // title the screen below judges in memory.
      { OR: [{ professionClass: SALARY_SCOPE_PROFESSION_CLASS[scope] as Prisma.JobWhereInput['professionClass'] }, { professionClass: null }] },
    ],
  };
}

/**
 * Title screen for rows the profession classifier has not reached
 * (professionClass NULL); a classified row is judged by its class alone.
 *
 * A title is NP-eligible when it carries an NP credential token, no non-NP
 * provider veto and no other APRN role token. The veto wins on dual-role
 * titles ("Psychiatrist/PMHNP", "CRNA/NP"): conservative by design for
 * ANALYTICS, because a CRNA posting (BLS median $236,590) pulls an NP median
 * up exactly as psychiatrist pay did. This heuristic gates aggregates only;
 * it never unpublishes a listing.
 */
const NP_TITLE_POSITIVE_RE =
  /\b(nurse\s+practitioner|np|aprn|arnp|pmhnp|fnp|agnp|agacnp|agpcnp|whnp|pnp|nnp|acnp|acnpc|enp|dnp)\b/i;

const NP_TITLE_VETO_RE =
  /\b(psychiatrist|physician|psychologist|podiatrist|podiatric|dpm|dentist|dds|dmd|optometrist|chiropractor|physician\s+assistant|physician\s+associate|pa-c|rn\s+only|medical\s+director)\b|\(pa\)/i;

/** The other APRN roles: never inside an NP figure, and each scope's own positive token. */
const CRNA_TITLE_RE = /\b(crna|nurse\s+anesthetists?)\b/i;
const MIDWIFE_TITLE_RE = /\b(cnm|nurse[\s-]+midwi(?:fe|ves|fery))\b/i;
const CNS_TITLE_RE = /\b(cns|clinical\s+nurse\s+specialists?)\b/i;
const APRN_OTHER_ROLE_RE = new RegExp(`${CRNA_TITLE_RE.source}|${MIDWIFE_TITLE_RE.source}|${CNS_TITLE_RE.source}`, 'i');

/**
 * MD/DO are vetoed ONLY in credential context — never as bare tokens.
 *
 * The dominant aggregator title format is "<Role> - <City>, <ST>", so a bare
 * \bmd\b veto silently excluded every Maryland posting ("Family Nurse
 * Practitioner - Baltimore, MD") from the analytics pool — systematically
 * biasing or emptying that state's published median — and a bare \bdo\b
 * vetoed any title containing the English word "do". Credential context is:
 *   - dotted forms:            "M.D.", "D.O."
 *   - slash-paired with another provider credential: "MD/DO", "NP/MD"
 *     (NOT "DC/MD/VA" — the other side must be a credential token)
 *   - parenthesized:           "(MD)", "(DO)"
 *   - or/and conjunctions:     "MD or NP", "Nurse Practitioner or DO"
 *     (NOT "…, MD or Baltimore" — a token preceded by ", " is the
 *     city-comma-state suffix, excluded via lookbehind; the trailing-token
 *     form requires list/end punctuation after it)
 */
// `[a-z]*np` covers the whole np-suffixed credential family (NP, FNP,
// AGACNP, DNP, the psych credential, …) without hardcoding niche literals.
// 'pa' is deliberately NOT in this list: PA is also the Pennsylvania state
// code, and "…, PA/MD region" titles would false-veto exactly like the bare
// \bmd\b bug this regex replaces. PA-credential titles are handled by the
// base veto's \(pa\) / pa-c / "physician assistant" patterns.
const NP_CRED_TOKENS = '[a-z]*np|aprn|arnp|crna|cnm|cns';
const NP_TITLE_MD_DO_CREDENTIAL_RE = new RegExp(
  [
    String.raw`\bm\.\s?d\.?(?=\W|$)`,
    String.raw`\bd\.\s?o\.?(?=\W|$)`,
    String.raw`\b(?:md|do)\s*\/\s*(?:md|do|${NP_CRED_TOKENS})\b`,
    String.raw`\b(?:${NP_CRED_TOKENS})\s*\/\s*(?:md|do)\b`,
    String.raw`\(\s*(?:md|do)\s*\)`,
    String.raw`(?<!,)(?<!,\s)\b(?:md|do)\b(?=\s+(?:or|and)\b)`,
    String.raw`\b(?:or|and)\s+(?:md|do)\b(?=\s*(?:$|[,/)\-–—]))`,
  ].join('|'),
  'i',
);

export function isNpEligibleTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  if (NP_TITLE_VETO_RE.test(title)) return false;
  if (NP_TITLE_MD_DO_CREDENTIAL_RE.test(title)) return false;
  if (APRN_OTHER_ROLE_RE.test(title)) return false;
  return NP_TITLE_POSITIVE_RE.test(title);
}

/** The title screen for an unclassified row in one of the two APRN scopes. */
function isAprnRoleTitle(title: string | null | undefined, scope: Exclude<SalaryRoleScope, 'np'>): boolean {
  if (!title) return false;
  if (NP_TITLE_VETO_RE.test(title) || NP_TITLE_MD_DO_CREDENTIAL_RE.test(title)) return false;
  return (scope === 'aprn_crna' ? CRNA_TITLE_RE : MIDWIFE_TITLE_RE).test(title);
}

/**
 * True when a fetched row belongs in the scope's figure: its profession
 * class when the classifier set one, else the title screen.
 */
export function isInSalaryRoleScope(
  row: { title: string | null; professionClass?: string | null },
  scope: SalaryRoleScope = 'np',
): boolean {
  if (row.professionClass != null) return row.professionClass === SALARY_SCOPE_PROFESSION_CLASS[scope];
  return scope === 'np' ? isNpEligibleTitle(row.title) : isAprnRoleTitle(row.title, scope);
}

/** Row shape the aggregate pages fetch: benchmark-model's input plus the screen's columns. */
export interface NpSalaryAnalyticsRow {
  state: string | null;
  employer: string | null;
  title: string | null;
  professionClass?: string | null;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
}

/** Select fragment matching NpSalaryAnalyticsRow. */
export const NP_SALARY_ANALYTICS_SELECT = {
  state: true,
  employer: true,
  title: true,
  professionClass: true,
  normalizedMinSalary: true,
  normalizedMaxSalary: true,
} as const;

/** Keep the fetched rows that belong in the scope's figure (isInSalaryRoleScope). */
export function filterSalaryScopeRows<T extends { title: string | null; professionClass?: string | null }>(
  rows: readonly T[],
  scope: SalaryRoleScope = 'np',
): T[] {
  return rows.filter((row) => isInSalaryRoleScope(row, scope));
}

/**
 * Review P9 #2f: published estimates round to the nearest $1,000 — an
 * exact-dollar figure ("$188,221") claims precision no posting mean or
 * median possesses.
 */
export function roundSalaryToNearestThousand(value: number): number {
  return Math.round(value / 1000) * 1000;
}

// Format for display in job cards (without $ since icon is used)
export function formatSalaryDisplay(
  displaySalary: string | null,
  normalizedMin: number | null,
  normalizedMax: number | null,
  salaryType: string | null
): string | null {
  // If we have a pre-formatted display string, use it
  if (displaySalary) return displaySalary;

  // Otherwise, format from normalized values
  if (!normalizedMin && !normalizedMax) return null;

  if (salaryType === 'hourly') {
    const minHr = normalizedMin ? Math.round(normalizedMin / HOURLY_TO_ANNUAL_HOURS) : null;
    const maxHr = normalizedMax ? Math.round(normalizedMax / HOURLY_TO_ANNUAL_HOURS) : null;
    if (minHr && maxHr && minHr !== maxHr) {
      return `${minHr} to ${maxHr}/hr`;
    }
    const hrRate = minHr || maxHr;
    return hrRate ? `${hrRate}/hr` : null;
  }

  // Default to annual format
  if (normalizedMin && normalizedMax && normalizedMin !== normalizedMax) {
    return `${formatK(normalizedMin)} to ${formatK(normalizedMax)}/yr`;
  }
  
  const salaryValue = normalizedMin || normalizedMax;
  return salaryValue ? `${formatK(salaryValue)}/yr` : null;
}

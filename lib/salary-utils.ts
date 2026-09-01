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
  displaySalary: string | null;      // For display ("$150-$200/hr")
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
    displaySalary = `${minRate}-${maxRate}/hr`;
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
    displaySalary = `${formatK(minSalary)}-${formatK(maxSalary)}/yr`;
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
    displaySalary = `${minRate}-${maxRate}/day`;
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
 * PUBLISHED-AGGREGATE SAFETY (review P9 #2c / #2d)
 *
 * Every posting-derived salary figure that reaches a public surface
 * (salary-guide hub, 51 state pages, calculator base) must be computed
 * over THIS pool and gated by components/tools/benchmark-model.ts
 * (n ≥ 5 postings, ≥ 3 distinct employers, median/p25/p75 — the one
 * surface the live review found built right). The old aggregates ran
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
 * Prisma predicate for the analytics-eligible salary pool: published,
 * non-expired, non-estimated, confidence at or above the analytics
 * threshold, annual-cadence, with a normalized salary present.
 *
 * PROFESSION SCOPING IS NOT IN THIS PREDICATE — no professionClass column
 * exists yet (quarantine package owns that migration). Callers MUST also
 * apply `isNpEligibleTitle` over the fetched rows (deterministic title
 * heuristic) until the column lands, and label figures accordingly.
 */
export function npSalaryAnalyticsWhere(now: Date = new Date()): Prisma.JobWhereInput {
  return {
    isPublished: true,
    normalizedMinSalary: { not: null },
    salaryIsEstimated: false,
    salaryConfidence: { gte: SALARY_ANALYTICS_MIN_CONFIDENCE },
    AND: [
      // Expired rows advertise pay nobody can get any more.
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      // notIn alone would drop NULL-period legacy rows (SQL NOT IN + NULL);
      // those are annual-cadence rows from before period storage existed.
      { OR: [{ salaryPeriod: null }, { salaryPeriod: { notIn: [...CONTRACT_CADENCE_PERIODS] } }] },
    ],
  };
}

/**
 * INTERIM profession gate (deterministic, title-only) until the
 * quarantine package's `professionClass` column + backfill land.
 *
 * A title is NP-eligible when it carries an NP/APRN credential token and
 * no non-NP provider veto. The veto wins on dual-role titles
 * ("Psychiatrist/PMHNP") — conservative by design for ANALYTICS: better
 * to drop a genuine NP row from an average than to average psychiatrist
 * pay into "NP salary" again. This heuristic gates aggregates only; it
 * never unpublishes a listing.
 */
const NP_TITLE_POSITIVE_RE =
  /\b(nurse\s+practitioner|np|aprn|arnp|pmhnp|fnp|agnp|agacnp|agpcnp|whnp|pnp|nnp|acnp|acnpc|enp|dnp|crna|cnm|cns|nurse\s+midwife|nurse\s+anesthetist|clinical\s+nurse\s+specialist)\b/i;

const NP_TITLE_VETO_RE =
  /\b(psychiatrist|physician|psychologist|podiatrist|podiatric|dpm|dentist|dds|dmd|optometrist|chiropractor|physician\s+assistant|physician\s+associate|pa-c|rn\s+only|medical\s+director)\b|\(pa\)/i;

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
  return NP_TITLE_POSITIVE_RE.test(title);
}

/** Row shape the aggregate pages fetch — matches benchmark-model's input. */
export interface NpSalaryAnalyticsRow {
  state: string | null;
  employer: string | null;
  title: string | null;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
}

/** Select fragment matching NpSalaryAnalyticsRow. */
export const NP_SALARY_ANALYTICS_SELECT = {
  state: true,
  employer: true,
  title: true,
  normalizedMinSalary: true,
  normalizedMaxSalary: true,
} as const;

/** Apply the interim profession gate over fetched rows. */
export function filterNpEligibleRows<T extends { title: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((row) => isNpEligibleTitle(row.title));
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
      return `${minHr}-${maxHr}/hr`;
    }
    const hrRate = minHr || maxHr;
    return hrRate ? `${hrRate}/hr` : null;
  }

  // Default to annual format
  if (normalizedMin && normalizedMax && normalizedMin !== normalizedMax) {
    return `${formatK(normalizedMin)}-${formatK(normalizedMax)}/yr`;
  }
  
  const salaryValue = normalizedMin || normalizedMax;
  return salaryValue ? `${formatK(salaryValue)}/yr` : null;
}

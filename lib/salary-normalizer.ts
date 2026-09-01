/**
 * Comprehensive Salary Normalizer
 * Converts all salary formats to annual equivalent
 *
 * All validation/clamp bands come from config/niche/salary.ts — the
 * single source of truth shared with salary-utils, job-normalizer, and
 * llm-enrichment. Retune that file (not this one) per niche.
 */

import { salaryConfig } from '@/config/niche/salary';

export interface SalaryNormalizationResult {
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
  salaryIsEstimated: boolean;
  salaryConfidence: number | null;
}

const BAND = salaryConfig.normalizer;
const HOURS_PER_YEAR = salaryConfig.hoursPerYear;

// Conversion multipliers to annual salary.
// ORDER MATTERS: detectSalaryPeriod matches with `String.includes`, so
// 'biweekly' MUST precede 'weekly' — otherwise a biweekly period string
// matches the 'weekly' key first and gets annualized ×52 instead of ×26
// (a silent 2× overstatement; review P9 #2 / WP-6 biweekly).
const PERIOD_MULTIPLIERS: Record<string, number> = {
  'annual': 1,
  'yearly': 1,
  'year': 1,
  'monthly': 12,
  'month': 12,
  'biweekly': 26,
  'weekly': 52,
  'week': 52,
  'daily': 260, // Assuming 260 working days/year
  'day': 260,
  'hourly': HOURS_PER_YEAR, // 40 hours/week * 52 weeks
  'hour': HOURS_PER_YEAR,
};

// Niche salary ranges for validation — values live in config/niche/salary.ts
const NICHE_SALARY_RANGES = {
  // W-2 / Salaried positions
  min: BAND.annualMin,
  max: BAND.annualMax,

  // Contract / Hourly positions (these convert to higher annual equivalents)
  contractorHourlyMin: BAND.contractorHourlyMin,
  contractorHourlyMax: BAND.contractorHourlyMax,

  typical: BAND.typical,
};

/**
 * Detect salary period from salary string or context
 */
function detectSalaryPeriod(
  salaryStr: string | null | undefined,
  salaryPeriod: string | null | undefined,
  minSalary: number | null | undefined,
  maxSalary: number | null | undefined
): string {
  // If period is explicitly provided, use it
  if (salaryPeriod) {
    const normalized = salaryPeriod.toLowerCase().trim();
    // Review P9 #2a: an upstream 'unknown' is a DECISION, not a missing
    // value — the validator already established there is no trustworthy
    // period token for this figure. Re-deriving by magnitude here would
    // resurrect exactly the guessing the 'unknown' state exists to stop
    // (values in the validator's $6k–$40k tokenless band were falling
    // through to this function's own magnitude rule and coming back as
    // clamped "annual" salaries).
    if (normalized === 'unknown') {
      return 'unknown';
    }
    for (const [period] of Object.entries(PERIOD_MULTIPLIERS)) {
      if (normalized.includes(period)) {
        return period;
      }
    }
  }

  // Try to detect from salary string
  if (salaryStr) {
    const lower = salaryStr.toLowerCase();
    if (lower.includes('/hour') || lower.includes('per hour') || lower.includes('hourly')) {
      return 'hourly';
    }
    if (lower.includes('/week') || lower.includes('per week') || lower.includes('weekly')) {
      return 'weekly';
    }
    if (lower.includes('/month') || lower.includes('per month') || lower.includes('monthly')) {
      return 'monthly';
    }
    if (lower.includes('/year') || lower.includes('per year') || lower.includes('annually') || lower.includes('annual')) {
      return 'annual';
    }
    if (lower.includes('/day') || lower.includes('per day') || lower.includes('daily')) {
      return 'daily';
    }
  }

  // Infer from salary magnitude — thresholds derive from the niche's pay
  // levels (config/niche/salary.ts); wrong thresholds multiply salaries
  // by 12x–2080x in the annualizer.
  //
  // Review P9 #2a: MONTHLY is never magnitude-inferred any more. A bare
  // number in the former "monthly" band ($5k–$20k here) is returned as
  // 'unknown' — no ×12, normalized values stay null, and the row is
  // excluded from analytics. Monthly annualization now requires an
  // explicit monthly token (source period field or "/month" in text),
  // which the explicit branches above already handle.
  const salary = minSalary || maxSalary;
  if (salary) {
    if (salary < BAND.magnitude.hourlyBelow) {
      return 'hourly';
    }
    if (salary < BAND.magnitude.weeklyBelow) {
      return 'weekly';
    }
    if (salary < BAND.magnitude.monthlyBelow) {
      return 'unknown';
    }
    return 'annual';
  }

  // Default to annual
  return 'annual';
}

/**
 * Normalize a single salary value to annual.
 *
 * Changed 2026-05-05: out-of-range annuals are CLAMPED to the
 * confidence-band bounds rather than dropped to null. The source
 * tried to give us a number, so a clamped usable value is better
 * than no signal. Behavior:
 *
 *   - Hourly $20–$300 stays as-is, then × 2080 to annual
 *   - Annual < $64k → clamped UP to $64k (high-confidence floor)
 *   - Annual > $550k → clamped DOWN to $550k
 *   - confidence drops to 0.5 when we clamp (signals "approximate")
 */
function normalizeSingleSalary(
  salary: number,
  period: string,
  isEstimated: boolean
): { value: number; confidence: number } | null {
  // Review P9 #2a: 'unknown' period means the magnitude sat in the old
  // "monthly" band with no explicit period token anywhere. Annualizing a
  // guess fabricated $480k salaries; refusing to normalize is the honest
  // outcome — the row keeps its raw values but never enters analytics
  // or salary filtering.
  if (period === 'unknown') {
    console.log(`[Salary] No explicit period for $${salary} — normalized values withheld`);
    return null;
  }

  const multiplier = PERIOD_MULTIPLIERS[period] || 1;
  let annualSalary = Math.round(salary * multiplier);

  let confidence = isEstimated ? 0.6 : 1.0;

  const isHourly = period === 'hourly' || period === 'hour';

  if (isHourly) {
    // Hourly: validate the hourly RATE against the contractor band first.
    const minHourly = NICHE_SALARY_RANGES.contractorHourlyMin;
    const maxHourly = NICHE_SALARY_RANGES.contractorHourlyMax;
    if (salary < minHourly) {
      console.log(`[Salary] Clamped low hourly: $${salary}/hr → $${minHourly}/hr`);
      annualSalary = minHourly * HOURS_PER_YEAR;
      confidence = 0.5;
    } else if (salary > maxHourly) {
      console.log(`[Salary] Clamped high hourly: $${salary}/hr → $${maxHourly}/hr`);
      annualSalary = maxHourly * HOURS_PER_YEAR;
      confidence = 0.5;
    }
    // Review P9 #2b: an in-band contractor rate can still annualize past
    // the W-2 cap ($350/hr × 2080 = $728k). The value is NOT clamped —
    // clamping would corrupt the hourly display (formatDisplaySalary
    // divides the annual back by 2080) — but confidence drops below the
    // analytics threshold so the row can never enter a published average.
    // Contract-cadence rows are ALSO excluded from aggregates outright by
    // salaryPeriod (see npSalaryAnalyticsWhere in lib/salary-utils.ts):
    // a locum ×2080 is not a W-2 salary.
    else if (annualSalary > BAND.highConfidenceAnnualCap) {
      console.log(
        `[Salary] Hourly $${salary}/hr annualizes to $${annualSalary} (over the $${BAND.highConfidenceAnnualCap} W-2 cap) — flagged approximate`,
      );
      confidence = 0.5;
    }
  } else {
    // Single annual sanity choke point (review P9 #2b): after ANY period
    // conversion (annual, monthly ×12, weekly ×52, biweekly ×26, daily
    // ×260) the annual band applies exactly once. No conversion path can
    // bypass the cap.
    const minAnnual = confidence < 0.5
      ? NICHE_SALARY_RANGES.min * BAND.lowConfidenceFloorFactor
      : NICHE_SALARY_RANGES.min * BAND.highConfidenceFloorFactor;
    const maxAnnual = confidence < 0.5 ? BAND.lowConfidenceAnnualCap : BAND.highConfidenceAnnualCap;
    if (annualSalary < minAnnual) {
      console.log(`[Salary] Clamped low annual: $${annualSalary} → $${minAnnual}`);
      annualSalary = minAnnual;
      confidence = 0.5;
    } else if (annualSalary > maxAnnual) {
      console.log(`[Salary] Clamped high annual: $${annualSalary} → $${maxAnnual}`);
      annualSalary = maxAnnual;
      confidence = 0.5;
    }
  }

  // Adjust confidence based on period (annual is most reliable)
  if (isHourly) {
    confidence *= 0.9; // Hourly conversions slightly less certain
  } else if (period === 'daily' || period === 'weekly' || period === 'day' || period === 'week' || period === 'biweekly') {
    confidence *= 0.85; // Weekly/biweekly/daily conversions less certain
  }

  return { value: annualSalary, confidence };
}

/**
 * Main function: Normalize salary data for a job
 */
export function normalizeSalary(job: {
  salaryRange?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string | null;
  title?: string;
}): SalaryNormalizationResult {
  const result: SalaryNormalizationResult = {
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    salaryIsEstimated: false,
    salaryConfidence: null,
  };

  // Check if salary is marked as estimated/predicted
  const isEstimated = job.salaryRange?.toLowerCase().includes('estimated') ||
    job.salaryRange?.toLowerCase().includes('predicted') ||
    false;

  result.salaryIsEstimated = isEstimated;

  // If no salary data, return early
  if (!job.minSalary && !job.maxSalary) {
    return result;
  }

  // Detect the salary period
  const period = detectSalaryPeriod(
    job.salaryRange,
    job.salaryPeriod,
    job.minSalary,
    job.maxSalary
  );

  // Normalize min salary
  if (job.minSalary) {
    const normalized = normalizeSingleSalary(job.minSalary, period, isEstimated);
    if (normalized) {
      result.normalizedMinSalary = normalized.value;
      result.salaryConfidence = normalized.confidence;
    }
  }

  // Normalize max salary
  if (job.maxSalary) {
    const normalized = normalizeSingleSalary(job.maxSalary, period, isEstimated);
    if (normalized) {
      result.normalizedMaxSalary = normalized.value;
      // Use the lower confidence of the two
      if (result.salaryConfidence !== null) {
        result.salaryConfidence = Math.min(result.salaryConfidence, normalized.confidence);
      } else {
        result.salaryConfidence = normalized.confidence;
      }
    }
  }

  // If we have both min and max, validate the range
  if (result.normalizedMinSalary && result.normalizedMaxSalary) {
    if (result.normalizedMinSalary > result.normalizedMaxSalary) {
      // Swap min and max if they're reversed
      [result.normalizedMinSalary, result.normalizedMaxSalary] =
        [result.normalizedMaxSalary, result.normalizedMinSalary];
    }

    // Check if range is too wide (indicates bad data)
    const rangeRatio = result.normalizedMaxSalary / result.normalizedMinSalary;
    if (rangeRatio > 2.5) {
      // Wide salary range detected - reduce confidence
      if (result.salaryConfidence) {
        result.salaryConfidence *= 0.7;
      }
    }
  }

  return result;
}

/**
 * Format normalized salary for display
 */
export function formatNormalizedSalary(
  min: number | null,
  max: number | null,
  isEstimated: boolean = false
): string {
  if (!min && !max) return 'Not specified';

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  const estimatedLabel = isEstimated ? ' (estimated)' : '';

  if (min && max) {
    return `${formatter.format(min)} - ${formatter.format(max)}${estimatedLabel}`;
  }
  if (min) {
    return `From ${formatter.format(min)}${estimatedLabel}`;
  }
  if (max) {
    return `Up to ${formatter.format(max)}${estimatedLabel}`;
  }

  return 'Not specified';
}

/**
 * Get the niche's typical salary range for comparison
 */
export function getTypicalPMHNPRange(): { min: number; max: number } {
  return NICHE_SALARY_RANGES.typical;
}

/* ═══════════════════════════════════════════════════════════════════════
 * STRUCTURED-vs-TEXT CONFLICT DETECTION (review P9 #2a/#2e)
 *
 * The $40,000/month → $480k/yr defect survived because the description's
 * own six-figure per-year salary text was never allowed to challenge
 * the structured value (extractSalary only ran when structured salary was
 * absent). These helpers give the ingest path — and any read-time surface
 * such as the JobPosting schema emitter — a deterministic way to notice
 * that the two sources disagree materially. On conflict the row is
 * flagged (salaryIsEstimated=true, salaryConfidence ≤ 0.4), which pushes
 * it below the analytics threshold; no schema column is required.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Structured-vs-text annualized figures diverging by more than this ratio are a conflict. */
export const SALARY_CONFLICT_RATIO = 1.5;

/** Confidence assigned to a row whose structured and text salaries conflict. */
export const SALARY_CONFLICT_CONFIDENCE = 0.4;

export interface ComparableSalary {
  min: number | null;
  max: number | null;
  /** Period name in either the extractSalary ('hour'/'year'…) or normalized ('hourly'/'annual'…) vocabulary. */
  period: string | null;
}

/**
 * Annualize a single value for comparison purposes only (no clamping, no
 * confidence). Returns null when the period is unknown/unrecognized —
 * an unannualizable figure can neither confirm nor contradict anything.
 */
export function annualizeForComparison(value: number | null, period: string | null): number | null {
  if (value == null || value <= 0) return null;
  if (!period || period === 'unknown') return null;
  const multiplier = PERIOD_MULTIPLIERS[period.toLowerCase().trim()];
  if (!multiplier) return null;
  return Math.round(value * multiplier);
}

/** Midpoint of a min/max pair annualized, or null when nothing is comparable. */
function annualizedMidpoint(salary: ComparableSalary): number | null {
  const min = annualizeForComparison(salary.min, salary.period);
  const max = annualizeForComparison(salary.max, salary.period);
  if (min != null && max != null) return Math.round((min + max) / 2);
  return min ?? max;
}

/**
 * True when the structured salary and the description-derived salary
 * annualize to materially different figures (ratio > SALARY_CONFLICT_RATIO).
 * Either side missing or unannualizable → false (no evidence of conflict).
 */
export function detectSalaryConflict(
  structured: ComparableSalary,
  textDerived: ComparableSalary,
): boolean {
  const structuredMid = annualizedMidpoint(structured);
  const textMid = annualizedMidpoint(textDerived);
  if (structuredMid == null || textMid == null) return false;
  const ratio = Math.max(structuredMid, textMid) / Math.min(structuredMid, textMid);
  return ratio > SALARY_CONFLICT_RATIO;
}


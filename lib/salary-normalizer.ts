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

// Conversion multipliers to annual salary
const PERIOD_MULTIPLIERS: Record<string, number> = {
  'annual': 1,
  'yearly': 1,
  'year': 1,
  'monthly': 12,
  'month': 12,
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
  const salary = minSalary || maxSalary;
  if (salary) {
    if (salary < BAND.magnitude.hourlyBelow) {
      return 'hourly';
    }
    if (salary < BAND.magnitude.weeklyBelow) {
      return 'weekly';
    }
    if (salary < BAND.magnitude.monthlyBelow) {
      return 'monthly';
    }
    return 'annual';
  }

  // Default to annual
  return 'annual';
}

/**
 * Validate if salary is reasonable for PMHNP role
 * Handles hourly contractor rates and annual salaries differently
 */
function isReasonableSalary(
  annual: number,
  originalPeriod: string,
  originalSalary: number,
  confidence: number = 1.0
): boolean {
  // For hourly rates, validate the hourly amount (not the annual conversion)
  // Contractors earn well above W-2 annual equivalents when annualized
  if (originalPeriod === 'hourly' || originalPeriod === 'hour') {
    const hourlyRate = originalSalary;
    const minHourly = NICHE_SALARY_RANGES.contractorHourlyMin;
    const maxHourly = NICHE_SALARY_RANGES.contractorHourlyMax;

    const isValid = hourlyRate >= minHourly && hourlyRate <= maxHourly;

    if (!isValid) {
      console.log(
        `[Salary] Rejected hourly rate: $${hourlyRate}/hr (outside $${minHourly}-${maxHourly}/hr range)`
      );
    }

    return isValid;
  }

  // For annual salaries, validate against annual thresholds
  // Allow wider ranges for estimated/low-confidence salaries
  const minThreshold = confidence < 0.5
    ? NICHE_SALARY_RANGES.min * BAND.lowConfidenceFloorFactor
    : NICHE_SALARY_RANGES.min * BAND.highConfidenceFloorFactor;

  // Caps raised 2026-05-05 from $400k (audit: locum / 1099 roles in HCOL
  // markets legitimately reached $450k–$500k+ and were being dropped by
  // the old cap). Values live in config/niche/salary.ts.
  const maxThreshold = confidence < 0.5
    ? BAND.lowConfidenceAnnualCap
    : BAND.highConfidenceAnnualCap;

  const isValid = annual >= minThreshold && annual <= maxThreshold;

  if (!isValid) {
    console.log(
      `[Salary] Rejected annual salary: $${annual.toLocaleString()} (outside $${minThreshold.toLocaleString()}-${maxThreshold.toLocaleString()} range, confidence: ${confidence})`
    );
  }

  return isValid;
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
  const multiplier = PERIOD_MULTIPLIERS[period] || 1;
  let annualSalary = Math.round(salary * multiplier);

  let confidence = isEstimated ? 0.6 : 1.0;

  // Hourly: validate the hourly rate itself, not the annual conversion.
  if (period === 'hourly' || period === 'hour') {
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
  } else {
    // Annual + other-period-converted-to-annual: clamp to the niche band.
    // Use the same caps as isReasonableSalary used to.
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
  if (period === 'hourly' || period === 'hour') {
    confidence *= 0.9; // Hourly conversions slightly less certain
  } else if (period === 'daily' || period === 'weekly' || period === 'day' || period === 'week') {
    confidence *= 0.85; // Weekly/daily conversions less certain
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


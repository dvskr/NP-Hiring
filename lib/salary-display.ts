/**
 * Generate user-friendly salary display string
 * Examples:
 *  - "$145 to $200/hr"
 *  - "$150k to $180k/yr"
 *  - "$150k/yr"
 *  - "Competitive"
 */
export function formatDisplaySalary(
  normalizedMin: number | null,
  normalizedMax: number | null,
  salaryPeriod: string | null
): string | null {
  if (!normalizedMin && !normalizedMax) {
    return null;
  }

  const period = salaryPeriod?.toLowerCase() || 'annual';
  
  // For hourly rates, convert from annual back to hourly
  if (period === 'hourly' || period === 'hour' || period === 'hr') {
    const hourlyMin = normalizedMin ? Math.round(normalizedMin / 2080) : null;
    const hourlyMax = normalizedMax ? Math.round(normalizedMax / 2080) : null;
    
    if (hourlyMin && hourlyMax && hourlyMin !== hourlyMax) {
      return `$${hourlyMin} to $${hourlyMax}/hr`;
    } else if (hourlyMax) {
      return `$${hourlyMax}/hr`;
    } else if (hourlyMin) {
      return `$${hourlyMin}/hr`;
    }
  }
  
  // For annual salaries, show in thousands (k)
  const formatAnnual = (value: number): string => {
    if (value >= 1000) {
      return `$${Math.round(value / 1000)}k`;
    }
    return `$${value.toLocaleString()}`;
  };
  
  if (normalizedMin && normalizedMax && normalizedMin !== normalizedMax) {
    return `${formatAnnual(normalizedMin)} to ${formatAnnual(normalizedMax)}/yr`;
  } else if (normalizedMax) {
    return `${formatAnnual(normalizedMax)}/yr`;
  } else if (normalizedMin) {
    return `${formatAnnual(normalizedMin)}/yr`;
  }
  
  return null;
}

/**
 * Stored displaySalary strings written by earlier ingests join the two ends
 * of a range with a hyphen or a dash ("$112k-$140k/yr", "$58k – $75k").
 * Owner direction (2026-09-12): no dashes in visible text, so every render
 * point passes the stored string through this before printing it. New
 * ingests already write " to "; the helper is idempotent on those. Single
 * values ("$150k/yr", "$60/hr+") pass through untouched.
 */
export function normalizeDisplaySalary(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/(\$?\d[\d,.]*[kK]?)\s*[-\u2013\u2014]\s*(?=\$?\d)/g, '$1 to ');
}

/**
 * Format salary for display with optional estimate indicator
 */
export function formatSalaryWithEstimate(
  displaySalary: string | null,
  isEstimated: boolean
): string {
  if (!displaySalary) {
    return 'Competitive';
  }
  
  const shown = normalizeDisplaySalary(displaySalary) ?? displaySalary;
  return isEstimated ? `~${shown}` : shown;
}


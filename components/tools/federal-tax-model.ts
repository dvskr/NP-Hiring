/**
 * Federal tax model for the 1099-vs-W2 take-home calculator (P2 #4).
 *
 * WHY THIS FILE EXISTS
 * The calculator publishes dollar figures on a YMYL surface. Every rate,
 * threshold, and bracket boundary it uses is pinned HERE with its statutory
 * or IRS/SSA source so that (a) nothing is typed inline in a component, and
 * (b) a reviewer can verify the whole model by reading one file. The visible
 * assumptions panel on the tool renders `TAX_MODEL_YEAR`, `TAX_MODEL_SOURCES`,
 * and `TAX_MODEL_EXCLUSIONS` from this module — the page cannot claim a tax
 * year the math does not use.
 *
 * UPDATE PROTOCOL (mirrors lib/stats-sources.ts)
 *   1. When the IRS publishes the next year's inflation-adjusted amounts
 *      (an annual Rev. Proc., usually October) and the SSA publishes the next
 *      year's taxable maximum, update the tables below.
 *   2. Bump TAX_MODEL_YEAR and TAX_MODEL_REVIEWED together.
 *   3. tests/regressions/p2-tools-calculators-models.test.ts pins BOTH the
 *      structural invariants (monotonic brackets, statutory rates) and the
 *      literal dollar values below — every bracket boundary for both filing
 *      statuses, both standard deductions, and the Social Security wage base.
 *      Bumping the year without retyping the tables fails there, loudly, with
 *      the numbers in the diff. Update the test in the same commit and check
 *      the new values against the Rev. Proc. yourself; the test pins what the
 *      model claims, it cannot know what the IRS published.
 *
 * SCOPE RULE — anything this model does NOT compute is listed in
 * TAX_MODEL_EXCLUSIONS and rendered on the page. Do not silently add a
 * deduction to the math without adding it to that list (or removing it from
 * the exclusions).
 */

/** Tax year the tables below describe. Rendered on the tool. */
export const TAX_MODEL_YEAR = 2026;

/** Date this model was last checked against its sources. */
export const TAX_MODEL_REVIEWED = '2026-07-29';

export type FilingStatus = 'single' | 'marriedJoint';

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  marriedJoint: 'Married filing jointly',
};

export interface TaxBracket {
  /** Upper bound of taxable income for this bracket (inclusive). */
  upTo: number;
  /** Marginal rate applied within the bracket. */
  rate: number;
}

/**
 * Ordinary-income brackets, tax year 2026 (IRS inflation-adjusted amounts).
 * Rates themselves (10/12/22/24/32/35/37) are statutory; only the dollar
 * boundaries move with inflation each year.
 */
export const FEDERAL_BRACKETS: Record<FilingStatus, readonly TaxBracket[]> = {
  single: [
    { upTo: 12_400, rate: 0.10 },
    { upTo: 50_400, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 },
    { upTo: 201_775, rate: 0.24 },
    { upTo: 256_225, rate: 0.32 },
    { upTo: 640_600, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
  marriedJoint: [
    { upTo: 24_800, rate: 0.10 },
    { upTo: 100_800, rate: 0.12 },
    { upTo: 211_400, rate: 0.22 },
    { upTo: 403_550, rate: 0.24 },
    { upTo: 512_450, rate: 0.32 },
    { upTo: 768_700, rate: 0.35 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.37 },
  ],
};

/** Standard deduction, tax year 2026. The model assumes the standard deduction. */
export const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 16_100,
  marriedJoint: 32_200,
};

/**
 * Payroll / self-employment tax parameters.
 *
 * All rates here are statutory and stable year to year; only
 * `socialSecurityWageBase` is indexed (SSA announces it each October).
 * The Additional Medicare Tax thresholds are NOT indexed — they have been
 * $200,000 / $250,000 since the tax took effect.
 */
export const PAYROLL_TAX = {
  /** Net earnings from self-employment = net profit x 92.35%. */
  seNetEarningsFactor: 0.9235,
  /** Social Security portion (OASDI): 12.4% self-employed, 6.2% each side on W-2. */
  socialSecurityRate: 0.124,
  /** Employee-side Social Security withholding on W-2 wages. */
  employeeSocialSecurityRate: 0.062,
  /** Social Security taxable maximum (SSA), tax year 2026. */
  socialSecurityWageBase: 184_500,
  /** Medicare portion: 2.9% self-employed, 1.45% each side on W-2. No cap. */
  medicareRate: 0.029,
  /** Employee-side Medicare withholding on W-2 wages. */
  employeeMedicareRate: 0.0145,
  /** Additional Medicare Tax on wages / SE income above the threshold. */
  additionalMedicareRate: 0.009,
  /** Additional Medicare Tax thresholds (statutory, not inflation-indexed). */
  additionalMedicareThreshold: {
    single: 200_000,
    marriedJoint: 250_000,
  } as Record<FilingStatus, number>,
} as const;

/** Visible citations rendered in the tool's assumptions panel. */
export const TAX_MODEL_SOURCES: ReadonlyArray<{ label: string; url: string }> = [
  {
    label: `IRS — ${TAX_MODEL_YEAR} inflation-adjusted brackets and standard deduction`,
    url: 'https://www.irs.gov/filing/federal-income-tax-rates-and-brackets',
  },
  {
    label: `Social Security Administration — ${TAX_MODEL_YEAR} contribution and benefit base`,
    url: 'https://www.ssa.gov/oact/cola/cbb.html',
  },
  {
    label: 'IRS — Self-employment tax (Social Security and Medicare)',
    url: 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes',
  },
];

/**
 * Everything the model deliberately does NOT compute. Rendered verbatim on
 * the tool so a reader can never mistake the estimate for a filing-grade
 * number. Every exclusion here makes the 1099 column CONSERVATIVE (lower)
 * except the state-tax one, which is neutral between the two columns.
 */
export const TAX_MODEL_EXCLUSIONS: readonly string[] = [
  'State and local income tax. Rates, brackets, and local add-ons vary by jurisdiction and are not modeled — the estimate below is federal only, so both columns are overstated by whatever your state charges.',
  'The Section 199A qualified business income (QBI) deduction. Clinical practice is a specified service trade or business, so eligibility phases out with income and depends on facts this tool does not collect. Excluding it makes the 1099 column conservative.',
  'Retirement contributions as a deduction. Money you put into a SEP-IRA or solo 401(k) is treated here as cash out of pocket, not as a deduction — another conservative simplification on the 1099 side.',
  'Itemized deductions, dependents, credits, other income, and any income taxed at capital-gains rates. The model applies the standard deduction to a single stream of earned income.',
  'Quarterly estimated-payment timing, penalties, and entity choice (sole proprietor vs S corp). Electing S-corp treatment changes the self-employment tax picture materially and is out of scope.',
];

/** Progressive tax on a taxable-income figure using the pinned bracket table. */
export function federalIncomeTax(taxableIncome: number, status: FilingStatus): number {
  if (taxableIncome <= 0) return 0;
  const brackets = FEDERAL_BRACKETS[status];
  let tax = 0;
  let lowerBound = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= lowerBound) break;
    const taxedInThisBracket = Math.min(taxableIncome, bracket.upTo) - lowerBound;
    tax += taxedInThisBracket * bracket.rate;
    lowerBound = bracket.upTo;
  }
  return tax;
}

/** The marginal rate a given taxable income lands in (the "bracket" readout). */
export function marginalRate(taxableIncome: number, status: FilingStatus): number {
  const brackets = FEDERAL_BRACKETS[status];
  const income = Math.max(0, taxableIncome);
  for (const bracket of brackets) {
    if (income <= bracket.upTo) return bracket.rate;
  }
  return brackets[brackets.length - 1].rate;
}

export interface SelfEmploymentTax {
  /** Net earnings subject to SE tax (net profit x 92.35%). */
  netEarnings: number;
  /** Social Security portion, capped at the wage base. */
  socialSecurity: number;
  /** Medicare portion (uncapped). */
  medicare: number;
  /** Additional Medicare Tax above the statutory threshold. */
  additionalMedicare: number;
  /** All three combined — what lands on the return. */
  total: number;
  /**
   * Above-the-line deduction for one-half of SE tax. Computed on the
   * Social Security + Medicare portions only: the Additional Medicare Tax
   * is not deductible.
   */
  halfDeduction: number;
}

export function selfEmploymentTax(netProfit: number, status: FilingStatus): SelfEmploymentTax {
  if (netProfit <= 0) {
    return { netEarnings: 0, socialSecurity: 0, medicare: 0, additionalMedicare: 0, total: 0, halfDeduction: 0 };
  }
  const netEarnings = netProfit * PAYROLL_TAX.seNetEarningsFactor;
  const socialSecurity =
    Math.min(netEarnings, PAYROLL_TAX.socialSecurityWageBase) * PAYROLL_TAX.socialSecurityRate;
  const medicare = netEarnings * PAYROLL_TAX.medicareRate;
  const threshold = PAYROLL_TAX.additionalMedicareThreshold[status];
  const additionalMedicare = Math.max(0, netEarnings - threshold) * PAYROLL_TAX.additionalMedicareRate;
  return {
    netEarnings,
    socialSecurity,
    medicare,
    additionalMedicare,
    total: socialSecurity + medicare + additionalMedicare,
    halfDeduction: (socialSecurity + medicare) / 2,
  };
}

export interface EmployeePayrollTax {
  socialSecurity: number;
  medicare: number;
  additionalMedicare: number;
  total: number;
}

/** Employee-side FICA withheld from W-2 wages (the employer pays a matching half). */
export function employeePayrollTax(wages: number, status: FilingStatus): EmployeePayrollTax {
  if (wages <= 0) return { socialSecurity: 0, medicare: 0, additionalMedicare: 0, total: 0 };
  const socialSecurity =
    Math.min(wages, PAYROLL_TAX.socialSecurityWageBase) * PAYROLL_TAX.employeeSocialSecurityRate;
  const medicare = wages * PAYROLL_TAX.employeeMedicareRate;
  const threshold = PAYROLL_TAX.additionalMedicareThreshold[status];
  const additionalMedicare = Math.max(0, wages - threshold) * PAYROLL_TAX.additionalMedicareRate;
  return {
    socialSecurity,
    medicare,
    additionalMedicare,
    total: socialSecurity + medicare + additionalMedicare,
  };
}

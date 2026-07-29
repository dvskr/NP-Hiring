/**
 * Pure take-home math for the 1099-vs-W2 calculator (P2 #4).
 *
 * Kept free of React so the model can be unit-tested directly
 * (tests/regressions/p2-tools-calculators-models.test.ts). Every rate and
 * threshold comes from ./federal-tax-model.ts — nothing is typed inline here.
 *
 * COMPARISON BASIS (rendered on the page, see TAKE_HOME_ASSUMPTIONS)
 *  - Both columns work the SAME hours. Time off is paid on the W-2 side and
 *    unpaid on the 1099 side, which is where the "days off" input lands.
 *  - Both columns report `cashAfterTax` on ONE definition: what is left of
 *    gross after taxes, business expenses, and insurance premiums, and BEFORE
 *    any retirement money is set aside. The two columns are only comparable if
 *    that line means the same thing on both sides — an earlier revision showed
 *    the 1099 figure net of the user's own retirement contribution and the W-2
 *    figure gross of it, under one shared "Spendable cash" label.
 *  - Net position = cashAfterTax plus retirement dollars the EMPLOYER adds.
 *    On W-2 that is the match. On 1099 there is no employer, so a contractor's
 *    own contribution adds nothing — it is a reallocation of cash already
 *    counted in cashAfterTax, not extra money. Hence contract.netPosition ===
 *    contract.cashAfterTax by construction.
 *  - Employer-paid health premium never appears as income on either side. It
 *    shows up as the 1099 column paying its own premium out of pocket.
 */
import {
  STANDARD_DEDUCTION,
  employeePayrollTax,
  federalIncomeTax,
  marginalRate,
  selfEmploymentTax,
  type FilingStatus,
} from './federal-tax-model';

/** A standard work year in days, used to convert days off into hours off. */
const WORK_DAYS_PER_WEEK = 5;
const WEEKS_PER_YEAR = 52;

export interface TakeHomeInputs {
  filingStatus: FilingStatus;
  /** Hours worked per week on both sides. */
  hoursPerWeek: number;
  /** Paid time off + holidays, days per year. Paid on W-2, unpaid on 1099. */
  paidDaysOff: number;
  /** W-2 annual base salary. */
  w2Salary: number;
  /** Employer retirement match, percent of salary. */
  w2EmployerMatchPct: number;
  /** Your annual share of the employer health premium (pre-tax payroll deduction). */
  w2EmployeePremium: number;
  /** 1099 contract hourly rate. */
  contractHourlyRate: number;
  /** Annual deductible business expenses (malpractice, CME, licensure, home office, equipment). */
  contractBusinessExpenses: number;
  /** Annual health insurance premium you buy yourself. */
  contractHealthPremium: number;
  /** Annual retirement contribution you make yourself (cash out of pocket). */
  contractRetirement: number;
}

export interface W2Result {
  gross: number;
  employeePremium: number;
  payrollTax: number;
  taxableIncome: number;
  federalTax: number;
  marginalRate: number;
  /** Cash in hand after premium, FICA, and federal income tax. */
  cashAfterTax: number;
  /** Employer retirement match in dollars. */
  employerMatch: number;
  /** cashAfterTax + employerMatch. */
  netPosition: number;
}

export interface ContractResult {
  billableHours: number;
  gross: number;
  businessExpenses: number;
  netProfit: number;
  selfEmploymentTax: number;
  halfSeDeduction: number;
  healthPremiumDeduction: number;
  taxableIncome: number;
  federalTax: number;
  marginalRate: number;
  healthPremium: number;
  /** What the contractor chooses to set aside from `cashAfterTax`. */
  retirement: number;
  /**
   * Cash in hand after expenses, SE tax, federal income tax, and premium —
   * BEFORE retirement is set aside, so this is the same measure as
   * W2Result.cashAfterTax and the two columns can be read against each other.
   */
  cashAfterTax: number;
  /**
   * Equal to cashAfterTax: a contractor's own retirement contribution is money
   * already counted here being moved into a retirement account, not an
   * employer adding to the total the way a W-2 match does.
   */
  netPosition: number;
}

export interface TakeHomeResult {
  billableHours: number;
  w2: W2Result;
  contract: ContractResult;
  /** contract.netPosition - w2.netPosition. Positive means 1099 comes out ahead. */
  netPositionDelta: number;
  /** Net position per hour worked, both sides working the same hours. */
  w2EffectiveHourly: number;
  contractEffectiveHourly: number;
  /**
   * The 1099 hourly rate at which the two net positions are equal, holding
   * every other input constant. `null` when no rate in the searched range
   * closes the gap (e.g. expenses alone exceed any plausible gross).
   */
  breakEvenHourlyRate: number | null;
}

/** Hours actually worked once unpaid/paid days off are removed. */
export function billableHours(hoursPerWeek: number, paidDaysOff: number): number {
  const hoursPerDay = hoursPerWeek / WORK_DAYS_PER_WEEK;
  return Math.max(0, hoursPerWeek * WEEKS_PER_YEAR - paidDaysOff * hoursPerDay);
}

function computeW2(input: TakeHomeInputs): W2Result {
  const gross = Math.max(0, input.w2Salary);
  const employeePremium = Math.min(Math.max(0, input.w2EmployeePremium), gross);
  // Section 125 pre-tax premium: reduces both FICA wages and taxable income.
  const ficaWages = gross - employeePremium;
  const payroll = employeePayrollTax(ficaWages, input.filingStatus);
  const taxableIncome = Math.max(0, ficaWages - STANDARD_DEDUCTION[input.filingStatus]);
  const federalTax = federalIncomeTax(taxableIncome, input.filingStatus);
  const cashAfterTax = gross - employeePremium - payroll.total - federalTax;
  const employerMatch = gross * (Math.max(0, input.w2EmployerMatchPct) / 100);
  return {
    gross,
    employeePremium,
    payrollTax: payroll.total,
    taxableIncome,
    federalTax,
    marginalRate: marginalRate(taxableIncome, input.filingStatus),
    cashAfterTax,
    employerMatch,
    netPosition: cashAfterTax + employerMatch,
  };
}

function computeContract(input: TakeHomeInputs, hourlyRate: number): ContractResult {
  const hours = billableHours(input.hoursPerWeek, input.paidDaysOff);
  const gross = Math.max(0, hourlyRate) * hours;
  const businessExpenses = Math.max(0, input.contractBusinessExpenses);
  const netProfit = Math.max(0, gross - businessExpenses);
  const se = selfEmploymentTax(netProfit, input.filingStatus);
  const healthPremium = Math.max(0, input.contractHealthPremium);
  const retirement = Math.max(0, input.contractRetirement);

  // Self-employed health insurance deduction is limited to earned income from
  // the business (net profit less the deductible half of SE tax).
  const healthDeductionCeiling = Math.max(0, netProfit - se.halfDeduction);
  const healthPremiumDeduction = Math.min(healthPremium, healthDeductionCeiling);

  const taxableIncome = Math.max(
    0,
    netProfit - se.halfDeduction - healthPremiumDeduction - STANDARD_DEDUCTION[input.filingStatus],
  );
  const federalTax = federalIncomeTax(taxableIncome, input.filingStatus);
  // Same basis as the W-2 column: before retirement is set aside. The
  // retirement contribution is shown separately as a call on this cash.
  const cashAfterTax = gross - businessExpenses - se.total - federalTax - healthPremium;

  return {
    billableHours: hours,
    gross,
    businessExpenses,
    netProfit,
    selfEmploymentTax: se.total,
    halfSeDeduction: se.halfDeduction,
    healthPremiumDeduction,
    taxableIncome,
    federalTax,
    marginalRate: marginalRate(taxableIncome, input.filingStatus),
    healthPremium,
    retirement,
    cashAfterTax,
    netPosition: cashAfterTax,
  };
}

/** Highest hourly rate the break-even search will consider. */
const BREAK_EVEN_MAX_RATE = 2_000;
const BREAK_EVEN_ITERATIONS = 60;

/**
 * Bisection search for the 1099 rate that matches the W-2 net position.
 * Net position rises monotonically with the hourly rate, so bisection is
 * exact to within a cent for the iteration count above.
 */
function findBreakEvenRate(input: TakeHomeInputs, target: number): number | null {
  const atMax = computeContract(input, BREAK_EVEN_MAX_RATE).netPosition;
  if (atMax < target) return null;
  const atZero = computeContract(input, 0).netPosition;
  if (atZero >= target) return 0;

  let low = 0;
  let high = BREAK_EVEN_MAX_RATE;
  for (let i = 0; i < BREAK_EVEN_ITERATIONS; i += 1) {
    const mid = (low + high) / 2;
    if (computeContract(input, mid).netPosition < target) low = mid;
    else high = mid;
  }
  return high;
}

export function computeTakeHome(input: TakeHomeInputs): TakeHomeResult {
  const w2 = computeW2(input);
  const contract = computeContract(input, input.contractHourlyRate);
  const hours = contract.billableHours;
  return {
    billableHours: hours,
    w2,
    contract,
    netPositionDelta: contract.netPosition - w2.netPosition,
    w2EffectiveHourly: hours > 0 ? w2.netPosition / hours : 0,
    contractEffectiveHourly: hours > 0 ? contract.netPosition / hours : 0,
    breakEvenHourlyRate: findBreakEvenRate(input, w2.netPosition),
  };
}

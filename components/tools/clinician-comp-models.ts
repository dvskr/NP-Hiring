/**
 * Pure compensation, shift conversion, travel stipend, total-comp, and
 * student-loan wealth models for Clinician & Student tools:
 *  1. Job Offer Competitiveness Grader
 *  2. Hourly <-> Shift <-> Annual Pay Converter
 *  3. Side-by-Side Offer A vs Offer B Total Compensation Comparator
 *  4. Locum & Travel FY2026 GSA Per Diem Stipend + Tax-Home Screener
 *  5. 10-Year Student Loan Repayment & Net Wealth Modeler (PSLF vs NHSC vs NURSE Corps vs Private)
 *
 * Pure TypeScript: reuses federal-tax-model.ts for statutory TY2026 federal tax math.
 */
import {
  STANDARD_DEDUCTION,
  employeePayrollTax,
  federalIncomeTax,
  type FilingStatus,
} from './federal-tax-model';

// ═══════════════════════════════════════════════════════════════════════════
// 1. JOB OFFER COMPETITIVENESS GRADER
// ═══════════════════════════════════════════════════════════════════════════

export interface OfferAnalyzerInputs {
  baseSalary: number;
  annualBonus: number;
  signOnBonus: number;
  signOnCommitmentYears: number;
  ptoDays: number;
  cmeDollars: number;
  yearsExperience: number;
  hasUnpaidCall: boolean;
  unpaidChartingHoursPerWeek: number;
}

export interface OfferMarketAnchor {
  state: string;
  liveMedian: number | null;
  liveP25: number | null;
  liveP75: number | null;
  liveEmployers: number;
  blsMedian: number | null;
  blsP10: number | null;
  blsP25: number | null;
  blsP75: number | null;
  blsP90: number | null;
}

export interface OfferAnalyzerResult {
  annualizedDirectCash: number;
  totalPackageValue: number;
  trueHourlyRate: number;
  estimatedPercentile: number;
  tierLabel: 'Top Quartile (75th+)' | 'Above Market Median' | 'Competitive Mid-Market' | 'Below Market Median' | 'Below 25th Percentile';
  referenceSourceUsed: 'live_and_bls' | 'bls_only';
  anchorMedian: number;
  anchorP25: number;
  anchorP75: number;
  gapToMedian: number;
  negotiationLevers: string[];
}

function interpolatePercentile(
  value: number,
  p10: number,
  p25: number,
  p50: number,
  p75: number,
  p90: number,
): number {
  if (value <= p10) return Math.max(5, Math.round((value / Math.max(1, p10)) * 10));
  if (value <= p25) return Math.round(10 + ((value - p10) / Math.max(1, p25 - p10)) * 15);
  if (value <= p50) return Math.round(25 + ((value - p25) / Math.max(1, p50 - p25)) * 25);
  if (value <= p75) return Math.round(50 + ((value - p50) / Math.max(1, p75 - p50)) * 25);
  if (value <= p90) return Math.round(75 + ((value - p75) / Math.max(1, p90 - p75)) * 15);
  return Math.min(98, Math.round(90 + ((value - p90) / Math.max(1, p90 * 0.2)) * 8));
}

export function gradeClinicianOffer(
  inputs: OfferAnalyzerInputs,
  anchor: OfferMarketAnchor,
  fallbackNationalMedian = 132_300,
): OfferAnalyzerResult {
  const base = Math.max(0, inputs.baseSalary);
  const bonus = Math.max(0, inputs.annualBonus);
  const commitYrs = Math.max(1, inputs.signOnCommitmentYears);
  const annualizedSignOn = Math.max(0, inputs.signOnBonus) / commitYrs;
  const annualizedDirectCash = base + bonus + annualizedSignOn;
  const totalPackageValue = annualizedDirectCash + Math.max(0, inputs.cmeDollars);

  const ptoWeeks = Math.min(12, Math.max(0, inputs.ptoDays / 5));
  const workedWeeks = Math.max(1, 52 - ptoWeeks);
  const weeklyHours = 40 + Math.max(0, inputs.unpaidChartingHoursPerWeek) + (inputs.hasUnpaidCall ? 4 : 0);
  const trueHourlyRate = annualizedDirectCash / (workedWeeks * weeklyHours);

  const hasLiveFull = anchor.liveMedian !== null && anchor.liveP25 !== null && anchor.liveP75 !== null;
  const anchorMedian = anchor.liveMedian ?? anchor.blsMedian ?? fallbackNationalMedian;
  const anchorP25 = hasLiveFull ? anchor.liveP25! : anchor.blsP25 ?? Math.round(anchorMedian * 0.87);
  const anchorP75 = hasLiveFull ? anchor.liveP75! : anchor.blsP75 ?? Math.round(anchorMedian * 1.15);
  const p10 = anchor.blsP10 ?? Math.round(anchorP25 * 0.88);
  const p90 = anchor.blsP90 ?? Math.round(anchorP75 * 1.14);

  // Compare base + recurring bonus against posted/BLS wage percentiles
  const benchmarkableCash = base + bonus;
  const estimatedPercentile = interpolatePercentile(benchmarkableCash, p10, anchorP25, anchorMedian, anchorP75, p90);

  let tierLabel: OfferAnalyzerResult['tierLabel'] = 'Competitive Mid-Market';
  if (benchmarkableCash >= anchorP75) tierLabel = 'Top Quartile (75th+)';
  else if (benchmarkableCash >= anchorMedian * 1.03) tierLabel = 'Above Market Median';
  else if (benchmarkableCash >= anchorP25) tierLabel = 'Competitive Mid-Market';
  else if (benchmarkableCash >= p10) tierLabel = 'Below Market Median';
  else tierLabel = 'Below 25th Percentile';

  const levers: string[] = [];
  if (benchmarkableCash < anchorMedian) {
    levers.push(
      `Base plus recurring bonus sits below the ${anchor.state} market median; consider anchoring your counter-offer near the state median or 75th percentile.`,
    );
  }
  if (inputs.yearsExperience >= 3 && benchmarkableCash < anchorP75) {
    levers.push(
      `With ${inputs.yearsExperience} years of autonomous clinical experience, your ramp time is shorter than a new graduate’s; ask to step into the upper half of the employer’s band.`,
    );
  }
  if (inputs.hasUnpaidCall) {
    levers.push(
      'Uncompensated evening or weekend call dilutes your effective hourly pay; negotiate a flat per-shift call stipend or post-call administrative time.',
    );
  }
  if (inputs.unpaidChartingHoursPerWeek >= 4) {
    levers.push(
      `Adding ${inputs.unpaidChartingHoursPerWeek} hours a week of after-hours charting lowers your true hourly rate; ask for protected administrative blocks or AI scribe support.`,
    );
  }
  if (inputs.ptoDays < 20) {
    levers.push(
      'Paid time off below 20 days (4 weeks) plus separate paid CME days is a low-friction counter-ask when HR base bands are rigid.',
    );
  }
  if (inputs.signOnBonus > 0 && inputs.signOnCommitmentYears >= 2) {
    levers.push(
      `Verify that the ${inputs.signOnCommitmentYears}-year sign-on commitment prorates monthly rather than requiring a 100% cliff repayment on early exit.`,
    );
  }
  if (levers.length === 0) {
    levers.push(
      'Cash compensation clears key market benchmarks; confirm malpractice tail coverage, wRVU bonus thresholds, and non-compete radius before signing.',
    );
  }

  return {
    annualizedDirectCash,
    totalPackageValue,
    trueHourlyRate,
    estimatedPercentile,
    tierLabel,
    referenceSourceUsed: anchor.liveMedian !== null ? 'live_and_bls' : 'bls_only',
    anchorMedian,
    anchorP25,
    anchorP75,
    gapToMedian: benchmarkableCash - anchorMedian,
    negotiationLevers: levers,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. HOURLY <-> SHIFT <-> ANNUAL SALARY CONVERTER
// ═══════════════════════════════════════════════════════════════════════════

export type PayInputUnit = 'hourly' | 'shift' | 'weekly' | 'biweekly' | 'monthly' | 'annual';

export type ShiftSchedulePresetId = '5x8' | '4x10' | '3x12' | '7on7off' | 'custom';

export interface ShiftSchedulePreset {
  id: ShiftSchedulePresetId;
  label: string;
  shiftsPerWeek: number;
  hoursPerShift: number;
  note: string;
}

export const SHIFT_SCHEDULE_PRESETS: readonly ShiftSchedulePreset[] = [
  { id: '5x8', label: '5x8 Outpatient (40 hrs/wk)', shiftsPerWeek: 5, hoursPerShift: 8, note: 'Standard 5-day clinic schedule' },
  { id: '4x10', label: '4x10 Clinic (40 hrs/wk)', shiftsPerWeek: 4, hoursPerShift: 10, note: 'Four 10-hour days with one weekday off' },
  { id: '3x12', label: '3x12 Urgent / Acute (36 hrs/wk)', shiftsPerWeek: 3, hoursPerShift: 12, note: 'Three 12-hour shifts per week (1,872 scheduled hrs/yr)' },
  { id: '7on7off', label: '7-on / 7-off Hospitalist (12-hr)', shiftsPerWeek: 3.5, hoursPerShift: 12, note: '26 weeks on (182 shifts, 2,184 scheduled hrs/yr)' },
];

export interface SalaryConverterInputs {
  amount: number;
  unit: PayInputUnit;
  shiftsPerWeek: number;
  hoursPerShift: number;
  paidPtoWeeks: number;
  unpaidAdminHoursPerWeek: number;
  isHourlyUnpaidTimeOff: boolean;
}

export interface SalaryConverterResult {
  scheduledWeeklyHours: number;
  scheduledAnnualHours: number;
  actualWorkedWeeks: number;
  actualClinicalHoursWorked: number;
  totalHoursIncludingUnpaidCharting: number;
  annualGross: number;
  monthlyGross: number;
  biweeklyGross: number;
  weeklyGross: number;
  perShiftGross: number;
  nominalHourlyRate: number;
  trueWorkedHourlyRate: number;
  unpaidChartingAnnualDragHours: number;
}

export function convertClinicianPay(raw: SalaryConverterInputs): SalaryConverterResult {
  const amt = Math.max(0, raw.amount);
  const shiftsWk = Math.max(0.5, raw.shiftsPerWeek);
  const hrsShift = Math.max(1, raw.hoursPerShift);
  const ptoWeeks = Math.min(20, Math.max(0, raw.paidPtoWeeks));
  const unpaidWk = Math.max(0, raw.unpaidAdminHoursPerWeek);

  const scheduledWeeklyHours = shiftsWk * hrsShift;
  const scheduledAnnualHours = scheduledWeeklyHours * 52;
  const actualWorkedWeeks = Math.max(1, 52 - ptoWeeks);
  const paidWeeksForHourly = raw.isHourlyUnpaidTimeOff ? actualWorkedWeeks : 52;

  let annualGross = 0;
  switch (raw.unit) {
    case 'annual':
      annualGross = amt;
      break;
    case 'monthly':
      annualGross = amt * 12;
      break;
    case 'biweekly':
      annualGross = amt * 26;
      break;
    case 'weekly':
      annualGross = amt * paidWeeksForHourly;
      break;
    case 'shift':
      annualGross = amt * shiftsWk * paidWeeksForHourly;
      break;
    case 'hourly':
      annualGross = amt * scheduledWeeklyHours * paidWeeksForHourly;
      break;
  }

  const actualClinicalHoursWorked = scheduledWeeklyHours * actualWorkedWeeks;
  const unpaidChartingAnnualDragHours = unpaidWk * actualWorkedWeeks;
  const totalHoursIncludingUnpaidCharting = actualClinicalHoursWorked + unpaidChartingAnnualDragHours;

  const nominalHourlyRate = scheduledAnnualHours > 0 ? annualGross / scheduledAnnualHours : 0;
  const trueWorkedHourlyRate =
    totalHoursIncludingUnpaidCharting > 0 ? annualGross / totalHoursIncludingUnpaidCharting : 0;

  return {
    scheduledWeeklyHours,
    scheduledAnnualHours,
    actualWorkedWeeks,
    actualClinicalHoursWorked,
    totalHoursIncludingUnpaidCharting,
    annualGross,
    monthlyGross: annualGross / 12,
    biweeklyGross: annualGross / 26,
    weeklyGross: paidWeeksForHourly > 0 ? annualGross / paidWeeksForHourly : 0,
    perShiftGross: shiftsWk * paidWeeksForHourly > 0 ? annualGross / (shiftsWk * paidWeeksForHourly) : 0,
    nominalHourlyRate,
    trueWorkedHourlyRate,
    unpaidChartingAnnualDragHours,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. TOTAL COMPENSATION COMPARATOR (OFFER A VS OFFER B)
// ═══════════════════════════════════════════════════════════════════════════

export interface TotalCompOfferInput {
  label: string;
  baseSalary: number;
  annualProductivityBonus: number;
  signOnBonus: number;
  signOnClawbackYears: number;
  ptoDays: number;
  cmeAllowance: number;
  cmeDays: number;
  employerRetirementMatchPct: number;
  employerHealthContributionAnnual: number;
  tailCoverageIncluded: boolean;
  estimatedTailValueIfExcluded: number;
  clinicalHoursPerWeek: number;
  unpaidChartingAndCallHoursPerWeek: number;
}

export interface EvaluatedCompOffer {
  label: string;
  steadyStateCash: number;
  yearOneCash: number;
  retirementMatchDollars: number;
  benefitsAndCmeValue: number;
  ptoImpliedValue: number;
  yearOneTotalEconomicValue: number;
  steadyStateTotalEconomicValue: number;
  threeYearCumulativeValue: number;
  workedWeeksPerYear: number;
  annualWorkedHours: number;
  trueSteadyStateHourly: number;
}

export interface OfferComparisonResult {
  offerA: EvaluatedCompOffer;
  offerB: EvaluatedCompOffer;
  threeYearDeltaBMinusA: number;
  hourlyDeltaBMinusA: number;
  winner: 'A' | 'B' | 'tie';
}

export function evaluateSingleCompOffer(o: TotalCompOfferInput): EvaluatedCompOffer {
  const base = Math.max(0, o.baseSalary);
  const bonus = Math.max(0, o.annualProductivityBonus);
  const signOn = Math.max(0, o.signOnBonus);
  const steadyStateCash = base + bonus;
  const yearOneCash = steadyStateCash + signOn;

  const retirementMatchDollars = base * (Math.max(0, o.employerRetirementMatchPct) / 100);
  const tailDrag = o.tailCoverageIncluded ? 0 : Math.max(0, o.estimatedTailValueIfExcluded) / 3;
  const benefitsAndCmeValue =
    Math.max(0, o.cmeAllowance) + Math.max(0, o.employerHealthContributionAnnual) - tailDrag;

  const totalPaidOffDays = Math.min(60, Math.max(0, o.ptoDays) + Math.max(0, o.cmeDays));
  const dailyBaseRate = base / 260;
  const ptoImpliedValue = totalPaidOffDays * dailyBaseRate;

  // Avoid double-counting PTO inside base salary: base salary ALREADY pays for PTO weeks;
  // PTO increases hourly value by reducing worked weeks!
  const workedWeeksPerYear = Math.max(1, 52 - totalPaidOffDays / 5);
  const weeklyHours = Math.max(1, o.clinicalHoursPerWeek + Math.max(0, o.unpaidChartingAndCallHoursPerWeek));
  const annualWorkedHours = workedWeeksPerYear * weeklyHours;

  const steadyStateTotalEconomicValue = steadyStateCash + retirementMatchDollars + benefitsAndCmeValue;
  const yearOneTotalEconomicValue = steadyStateTotalEconomicValue + signOn;
  const threeYearCumulativeValue = steadyStateTotalEconomicValue * 3 + signOn;
  const trueSteadyStateHourly = annualWorkedHours > 0 ? steadyStateTotalEconomicValue / annualWorkedHours : 0;

  return {
    label: o.label,
    steadyStateCash,
    yearOneCash,
    retirementMatchDollars,
    benefitsAndCmeValue,
    ptoImpliedValue,
    yearOneTotalEconomicValue,
    steadyStateTotalEconomicValue,
    threeYearCumulativeValue,
    workedWeeksPerYear,
    annualWorkedHours,
    trueSteadyStateHourly,
  };
}

export function compareTwoOffers(a: TotalCompOfferInput, b: TotalCompOfferInput): OfferComparisonResult {
  const offerA = evaluateSingleCompOffer(a);
  const offerB = evaluateSingleCompOffer(b);
  const threeYearDeltaBMinusA = offerB.threeYearCumulativeValue - offerA.threeYearCumulativeValue;
  const hourlyDeltaBMinusA = offerB.trueSteadyStateHourly - offerA.trueSteadyStateHourly;

  let winner: OfferComparisonResult['winner'] = 'tie';
  if (Math.abs(threeYearDeltaBMinusA) >= 500) {
    winner = threeYearDeltaBMinusA > 0 ? 'B' : 'A';
  }
  return {
    offerA,
    offerB,
    threeYearDeltaBMinusA,
    hourlyDeltaBMinusA,
    winner,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. TRAVEL & LOCUM GSA PER DIEM STIPEND CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════

export interface GsaDestinationPreset {
  id: string;
  label: string;
  /** Daily max tax-free lodging (FY2026 GSA baseline or illustrative metro tier). */
  dailyLodging: number;
  /** Daily Meals & Incidental Expenses (FY2026 GSA). */
  dailyMie: number;
}

/**
 * FY2026 GSA standard CONUS baseline ($110/night lodging + $68/day M&IE,
 * effective Oct 1, 2025 through Sep 30, 2026) plus editable metro tier presets.
 */
export const GSA_DESTINATION_PRESETS: readonly GsaDestinationPreset[] = [
  { id: 'standard-conus', label: 'FY2026 Standard CONUS Rate ($110 lodging / $68 M&IE)', dailyLodging: 110, dailyMie: 68 },
  { id: 'mid-metro', label: 'Mid-Cost Metro Tier ($165 lodging / $80 M&IE)', dailyLodging: 165, dailyMie: 80 },
  { id: 'high-metro', label: 'High-Cost Coastal / Seasonal Metro ($245 lodging / $86 M&IE)', dailyLodging: 245, dailyMie: 86 },
  { id: 'peak-metro', label: 'Peak Metro Tier ($310 lodging / $92 M&IE)', dailyLodging: 310, dailyMie: 92 },
];

export interface TravelStipendInputs {
  filingStatus: FilingStatus;
  taxedHourlyRate: number;
  weeklyHours: number;
  dailyLodgingStipend: number;
  dailyMieStipend: number;
  stipendDaysPerWeek: number;
  assignmentWeeksPerYear: number;
  monthlyDuplicatedHousingCost: number;
  roundTripTravelReimbursement: number;
  permanentW2ComparisonSalary: number;
}

export interface TravelStipendResult {
  weeklyTaxedPay: number;
  weeklyTaxFreeStipend: number;
  weeklyGrossBlended: number;
  blendedGrossHourly: number;
  annualTaxedWages: number;
  annualTaxFreeStipends: number;
  annualGrossPackage: number;
  estimatedFederalAndFicaTax: number;
  annualDuplicatedHousingOutlay: number;
  travelNetTakeHomeAfterHousing: number;
  permanentW2NetTakeHome: number;
  netAdvantageOverPerm: number;
  equivalentPermW2GrossNeeded: number;
  lowTaxedBaseWarning: boolean;
}

function w2NetAfterFederalTax(grossWages: number, status: FilingStatus): { net: number; tax: number } {
  const fica = employeePayrollTax(grossWages, status).total;
  const taxable = Math.max(0, grossWages - STANDARD_DEDUCTION[status]);
  const incomeTax = federalIncomeTax(taxable, status);
  const totalTax = fica + incomeTax;
  return { net: grossWages - totalTax, tax: totalTax };
}

export function computeTravelStipend(raw: TravelStipendInputs): TravelStipendResult {
  const hourly = Math.max(0, raw.taxedHourlyRate);
  const hrsWk = Math.max(0, raw.weeklyHours);
  const daysStipend = Math.min(7, Math.max(0, raw.stipendDaysPerWeek));
  const weeksYr = Math.min(52, Math.max(0, raw.assignmentWeeksPerYear));

  const weeklyTaxedPay = hourly * hrsWk;
  const weeklyTaxFreeStipend = (Math.max(0, raw.dailyLodgingStipend) + Math.max(0, raw.dailyMieStipend)) * daysStipend;
  const weeklyGrossBlended = weeklyTaxedPay + weeklyTaxFreeStipend;
  const blendedGrossHourly = hrsWk > 0 ? weeklyGrossBlended / hrsWk : 0;

  const annualTaxedWages = weeklyTaxedPay * weeksYr;
  const annualTaxFreeStipends = weeklyTaxFreeStipend * weeksYr + Math.max(0, raw.roundTripTravelReimbursement);
  const annualGrossPackage = annualTaxedWages + annualTaxFreeStipends;

  const travelTax = w2NetAfterFederalTax(annualTaxedWages, raw.filingStatus);
  const monthsOnAssignment = (weeksYr / 52) * 12;
  const annualDuplicatedHousingOutlay = Math.max(0, raw.monthlyDuplicatedHousingCost) * monthsOnAssignment;

  const travelNetTakeHomeAfterHousing =
    annualTaxedWages - travelTax.tax + annualTaxFreeStipends - annualDuplicatedHousingOutlay;

  const permEval = w2NetAfterFederalTax(Math.max(0, raw.permanentW2ComparisonSalary), raw.filingStatus);

  // Solve via binary search for the W-2 gross salary that yields `travelNetTakeHomeAfterHousing`
  let lo = 0;
  let hi = 800_000;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (w2NetAfterFederalTax(mid, raw.filingStatus).net < travelNetTakeHomeAfterHousing) lo = mid;
    else hi = mid;
  }

  return {
    weeklyTaxedPay,
    weeklyTaxFreeStipend,
    weeklyGrossBlended,
    blendedGrossHourly,
    annualTaxedWages,
    annualTaxFreeStipends,
    annualGrossPackage,
    estimatedFederalAndFicaTax: travelTax.tax,
    annualDuplicatedHousingOutlay,
    travelNetTakeHomeAfterHousing,
    permanentW2NetTakeHome: permEval.net,
    netAdvantageOverPerm: travelNetTakeHomeAfterHousing - permEval.net,
    equivalentPermW2GrossNeeded: (lo + hi) / 2,
    // IRS wage-recharacterization caution if taxed hourly is artificially low for an APRN
    lowTaxedBaseWarning: hourly > 0 && hourly < 35,
  };
}

export interface TaxHomeScreenInput {
  regularWorkAtTaxHome: boolean;
  duplicatedLivingExpenses: boolean;
  hasNotAbandonedHistoricalHome: boolean;
  underOneYearAtSingleLocation: boolean;
}

export interface TaxHomeScreenResult {
  factorCount: number;
  eligibleForTaxFreeStipends: boolean;
  statusHeadline: string;
  explanation: string;
}

export function evaluateIrsTaxHome(input: TaxHomeScreenInput): TaxHomeScreenResult {
  const factors = [
    input.regularWorkAtTaxHome,
    input.duplicatedLivingExpenses,
    input.hasNotAbandonedHistoricalHome,
  ].filter(Boolean).length;

  if (!input.underOneYearAtSingleLocation) {
    return {
      factorCount: factors,
      eligibleForTaxFreeStipends: false,
      statusHeadline: '12-Month Rule Triggered: Stipends Become Taxable',
      explanation:
        'Under IRS rules (IRC 162(a)), once an assignment at a single metropolitan location is realistically expected to exceed (or actually exceeds) 12 months, that location becomes your new tax home and per diem stipends become fully taxable wages.',
    };
  }

  if (!input.duplicatedLivingExpenses) {
    return {
      factorCount: factors,
      eligibleForTaxFreeStipends: false,
      statusHeadline: 'Itinerant Risk: No Duplicated Housing Expense',
      explanation:
        'Tax-free lodging and meal stipends reimburse duplicated travel expenses while away from a permanent tax home. Without substantial duplicated housing expenses at your primary residence, stipends must generally be taxed.',
    };
  }

  if (factors >= 2) {
    return {
      factorCount: factors,
      eligibleForTaxFreeStipends: true,
      statusHeadline: `Meets ${factors} of 3 IRS Rev. Rul. 73-529 Factors`,
      explanation:
        'Satisfying at least two of the three IRS factors (including duplicated living expenses) while working away from home for 12 months or less supports tax-free GSA per diem treatment. Keep lease/mortgage, utility, and voter/driver records.',
    };
  }

  return {
    factorCount: factors,
    eligibleForTaxFreeStipends: false,
    statusHeadline: 'High Audit Risk: Only 1 of 3 IRS Factors Met',
    explanation:
      'Meeting only one IRS Rev. Rul. 73-529 factor requires a closer facts-and-circumstances review with a healthcare CPA before accepting untaxed stipends.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 10-YEAR STUDENT LOAN REPAYMENT & NET WEALTH MODELER
// ═══════════════════════════════════════════════════════════════════════════

export const NHSC_AWARD_AMOUNTS = {
  fullTimeHighHpsa: 75_000, // Primary care 2-year full-time HPSA 14+ tier
  fullTimeStandardHpsa: 50_000, // Standard 2-year full-time HPSA tier
  halfTimeStandardHpsa: 25_000,
} as const;

export type NhscTierKey = keyof typeof NHSC_AWARD_AMOUNTS;

export interface LoanRepaymentInputs {
  loanBalance: number;
  interestRatePct: number;
  filingStatus: FilingStatus;
  nonprofitOrFqhcSalary: number;
  privateClinicSalary: number;
  nhscTier: NhscTierKey;
  annualSalaryGrowthPct: number;
}

export interface LoanStrategyResult {
  id: 'pslf' | 'nhsc' | 'nurse-corps' | 'private-payoff';
  label: string;
  tenYearGrossEarnings: number;
  tenYearFederalTax: number;
  totalOutOfPocketLoanPaid: number;
  forgivenOrAwardedPrincipal: number;
  awardTaxCost: number;
  remainingDebtAtYear10: number;
  tenYearNetCashAfterDebtAndTax: number;
  note: string;
}

/**
 * Models 10-year (120-month) cumulative net cash after federal tax and loan
 * payments across PSLF, HRSA NHSC, HRSA NURSE Corps, and Private Practice payoff.
 */
export function computeLoanStrategies(raw: LoanRepaymentInputs): LoanStrategyResult[] {
  const startPrincipal = Math.max(0, raw.loanBalance);
  const annualRate = Math.max(0, raw.interestRatePct) / 100;
  const monthlyRate = annualRate / 12;
  const fqhcStart = Math.max(0, raw.nonprofitOrFqhcSalary);
  const privStart = Math.max(0, raw.privateClinicSalary);
  const growth = Math.max(0, raw.annualSalaryGrowthPct) / 100;

  // Standard 10-year (120-month) amortized monthly payment helper
  const standardMonthlyPayment = (principal: number, months = 120): number => {
    if (principal <= 0) return 0;
    if (monthlyRate === 0) return principal / months;
    return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  };

  // Sum 10 years of salary & federal tax
  const sumTenYearsIncome = (baseYr1: number) => {
    let gross = 0;
    let tax = 0;
    const annualSalaries: number[] = [];
    for (let yr = 0; yr < 10; yr += 1) {
      const sal = baseYr1 * Math.pow(1 + growth, yr);
      annualSalaries.push(sal);
      gross += sal;
      tax += w2NetAfterFederalTax(sal, raw.filingStatus).tax;
    }
    return { gross, tax, annualSalaries };
  };

  const fqhcInc = sumTenYearsIncome(fqhcStart);
  const privInc = sumTenYearsIncome(privStart);

  // 1. PSLF (120 qualifying IDR payments at 10% of discretionary income above 150% poverty line ~$23,475 single / $31,725 married, capped at 10-yr standard payment)
  const povertyExclusion = raw.filingStatus === 'marriedJoint' ? 31_725 : 23_475;
  const stdCapMonthly = standardMonthlyPayment(startPrincipal, 120);
  let pslfBalance = startPrincipal;
  let pslfPaid = 0;
  for (let yr = 0; yr < 10; yr += 1) {
    const discIncome = Math.max(0, fqhcInc.annualSalaries[yr] - povertyExclusion);
    const idrMonthly = Math.min(stdCapMonthly, (discIncome * 0.10) / 12);
    for (let m = 0; m < 12; m += 1) {
      if (pslfBalance <= 0) break;
      const interest = pslfBalance * monthlyRate;
      const pay = Math.min(pslfBalance + interest, idrMonthly);
      pslfBalance = pslfBalance + interest - pay;
      pslfPaid += pay;
    }
  }
  const pslfForgiven = Math.max(0, pslfBalance);

  // 2. HRSA NHSC (tax-free lump-sum award applied to principal in Year 1 for a 2-year HPSA commitment, then standard payoff over remaining years)
  const nhscAward = Math.min(startPrincipal, NHSC_AWARD_AMOUNTS[raw.nhscTier]);
  const postNhscPrincipal = Math.max(0, startPrincipal - nhscAward);
  const nhscMonthly = standardMonthlyPayment(postNhscPrincipal, 120);
  const nhscTotalPaid = postNhscPrincipal > 0 ? nhscMonthly * 120 : 0;

  // 3. HRSA NURSE Corps (60% over Years 1 to 2 + optional 25% Year 3 = 85% of qualifying nursing debt; award IS federally taxable!)
  const nurseCorpsAward = startPrincipal * 0.85;
  const postNurseCorpsPrincipal = Math.max(0, startPrincipal - nurseCorpsAward);
  const ncMonthly = standardMonthlyPayment(postNurseCorpsPrincipal, 120);
  const ncTotalPaid = postNurseCorpsPrincipal > 0 ? ncMonthly * 120 : 0;
  // Approximate federal income + FICA tax hit on the taxable NURSE Corps grant spread across 3 years
  const annualGrantSlice = nurseCorpsAward / 3;
  const taxWithGrant = w2NetAfterFederalTax(fqhcStart + annualGrantSlice, raw.filingStatus).tax;
  const taxWithoutGrant = w2NetAfterFederalTax(fqhcStart, raw.filingStatus).tax;
  const nurseCorpsTaxCost = Math.max(0, (taxWithGrant - taxWithoutGrant) * 3);

  // 4. Higher-Paying Private Clinic (10-year standard amortization, 0 forgiveness)
  const privMonthly = standardMonthlyPayment(startPrincipal, 120);
  const privTotalPaid = startPrincipal > 0 ? privMonthly * 120 : 0;

  return [
    {
      id: 'pslf',
      label: 'PSLF (120 Qualifying Payments at 501(c)(3) / Public Employer)',
      tenYearGrossEarnings: fqhcInc.gross,
      tenYearFederalTax: fqhcInc.tax,
      totalOutOfPocketLoanPaid: pslfPaid,
      forgivenOrAwardedPrincipal: pslfForgiven,
      awardTaxCost: 0,
      remainingDebtAtYear10: 0,
      tenYearNetCashAfterDebtAndTax: fqhcInc.gross - fqhcInc.tax - pslfPaid,
      note: 'Tax-free federal Direct Loan forgiveness under IRC 108(f) after 120 qualifying monthly IDR payments.',
    },
    {
      id: 'nhsc',
      label: 'HRSA NHSC Loan Repayment (2-Year HPSA Commitment)',
      tenYearGrossEarnings: fqhcInc.gross,
      tenYearFederalTax: fqhcInc.tax,
      totalOutOfPocketLoanPaid: nhscTotalPaid,
      forgivenOrAwardedPrincipal: nhscAward,
      awardTaxCost: 0,
      remainingDebtAtYear10: 0,
      tenYearNetCashAfterDebtAndTax: fqhcInc.gross - fqhcInc.tax - nhscTotalPaid,
      note: 'NHSC awards are exempt from federal income and employment tax; remainder amortized over 10 years.',
    },
    {
      id: 'nurse-corps',
      label: 'HRSA NURSE Corps (85% Over 3 Years at Critical Shortage Facility)',
      tenYearGrossEarnings: fqhcInc.gross,
      tenYearFederalTax: fqhcInc.tax,
      totalOutOfPocketLoanPaid: ncTotalPaid,
      forgivenOrAwardedPrincipal: nurseCorpsAward,
      awardTaxCost: nurseCorpsTaxCost,
      remainingDebtAtYear10: 0,
      tenYearNetCashAfterDebtAndTax: fqhcInc.gross - fqhcInc.tax - ncTotalPaid - nurseCorpsTaxCost,
      note: 'Pays 60% over 2 years plus 25% in optional Year 3; unlike NHSC and PSLF, NURSE Corps awards are federally taxable.',
    },
    {
      id: 'private-payoff',
      label: 'Private Clinic Salary + Standard 10-Year Payoff',
      tenYearGrossEarnings: privInc.gross,
      tenYearFederalTax: privInc.tax,
      totalOutOfPocketLoanPaid: privTotalPaid,
      forgivenOrAwardedPrincipal: 0,
      awardTaxCost: 0,
      remainingDebtAtYear10: 0,
      tenYearNetCashAfterDebtAndTax: privInc.gross - privInc.tax - privTotalPaid,
      note: 'No employer restriction or service obligation; full principal and interest repaid from after-tax cash flow.',
    },
  ];
}

/**
 * Pure calculation and regulatory models for the Employer & Clinic-Owner tools.
 *
 * Covers:
 *  1. 51-Jurisdiction Job-Posting Pay Transparency & Salary-History Ban Checker
 *  2. Unfilled Seat Cost-of-Vacancy & Locum Bridge Calculator
 *  3. Clinic Hire Break-Even & W-2 vs 1099 Split Modeler
 *  4. Medicare 85% Direct vs 100% Compliant Incident-To Billing Modeler
 *  5. Reverse Go-Live Credentialing & Payer Paneling Timeline + .ics Exporter
 *  6. Structured Clinical Interview Question Bank & Weighted Scorecard Scorer
 *
 * Pure TypeScript: no React, no Prisma, safe in server and client bundles.
 */
import { brand } from '@/config/brand';

// ═══════════════════════════════════════════════════════════════════════════
// 1. PAY TRANSPARENCY & SALARY-HISTORY BAN (51 JURISDICTIONS, 2026 TO 2027)
// ═══════════════════════════════════════════════════════════════════════════

export type PayTransparencyTier =
  | 'posting_required'
  | 'upcoming_posting_law'
  | 'milestone_disclosure'
  | 'no_statewide_posting_mandate';

export interface PayTransparencyRule {
  state: string;
  stateCode: string;
  tier: PayTransparencyTier;
  /** Minimum employer headcount for the posting rule to apply (0 when no posting mandate). */
  minEmployees: number;
  /** Whether benefits / general compensation description must also appear in the posting. */
  requiresBenefitsInPost: boolean;
  /** Effective date or statutory status label. */
  effectiveLabel: string;
  /** Statewide private-employer salary-history ban status. */
  salaryHistoryBan: 'statewide_ban' | 'public_employers_only' | 'none_or_preempted';
  /** Concise statutory summary (no dashes). */
  summary: string;
}

const ALL_STATES_BASE: ReadonlyArray<{ state: string; code: string }> = [
  { state: 'Alabama', code: 'AL' },
  { state: 'Alaska', code: 'AK' },
  { state: 'Arizona', code: 'AZ' },
  { state: 'Arkansas', code: 'AR' },
  { state: 'California', code: 'CA' },
  { state: 'Colorado', code: 'CO' },
  { state: 'Connecticut', code: 'CT' },
  { state: 'Delaware', code: 'DE' },
  { state: 'District of Columbia', code: 'DC' },
  { state: 'Florida', code: 'FL' },
  { state: 'Georgia', code: 'GA' },
  { state: 'Hawaii', code: 'HI' },
  { state: 'Idaho', code: 'ID' },
  { state: 'Illinois', code: 'IL' },
  { state: 'Indiana', code: 'IN' },
  { state: 'Iowa', code: 'IA' },
  { state: 'Kansas', code: 'KS' },
  { state: 'Kentucky', code: 'KY' },
  { state: 'Louisiana', code: 'LA' },
  { state: 'Maine', code: 'ME' },
  { state: 'Maryland', code: 'MD' },
  { state: 'Massachusetts', code: 'MA' },
  { state: 'Michigan', code: 'MI' },
  { state: 'Minnesota', code: 'MN' },
  { state: 'Mississippi', code: 'MS' },
  { state: 'Missouri', code: 'MO' },
  { state: 'Montana', code: 'MT' },
  { state: 'Nebraska', code: 'NE' },
  { state: 'Nevada', code: 'NV' },
  { state: 'New Hampshire', code: 'NH' },
  { state: 'New Jersey', code: 'NJ' },
  { state: 'New Mexico', code: 'NM' },
  { state: 'New York', code: 'NY' },
  { state: 'North Carolina', code: 'NC' },
  { state: 'North Dakota', code: 'ND' },
  { state: 'Ohio', code: 'OH' },
  { state: 'Oklahoma', code: 'OK' },
  { state: 'Oregon', code: 'OR' },
  { state: 'Pennsylvania', code: 'PA' },
  { state: 'Rhode Island', code: 'RI' },
  { state: 'South Carolina', code: 'SC' },
  { state: 'South Dakota', code: 'SD' },
  { state: 'Tennessee', code: 'TN' },
  { state: 'Texas', code: 'TX' },
  { state: 'Utah', code: 'UT' },
  { state: 'Vermont', code: 'VT' },
  { state: 'Virginia', code: 'VA' },
  { state: 'Washington', code: 'WA' },
  { state: 'West Virginia', code: 'WV' },
  { state: 'Wisconsin', code: 'WI' },
  { state: 'Wyoming', code: 'WY' },
];

const SPECIFIC_TRANSPARENCY_RULES: Readonly<Record<string, Omit<PayTransparencyRule, 'state' | 'stateCode'>>> = {
  California: {
    tier: 'posting_required',
    minEmployees: 15,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Active (SB 1162)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 15 or more employees (with at least one in California) must include a good-faith hourly or salary pay scale in every external and internal job posting, and may never ask applicants for prior pay.',
  },
  Colorado: {
    tier: 'posting_required',
    minEmployees: 1,
    requiresBenefitsInPost: true,
    effectiveLabel: 'Active (Equal Pay for Equal Work Act)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 1 or more employees in Colorado must publish the good-faith compensation range, a general description of bonuses or commissions, a general description of benefits, and the application deadline window.',
  },
  Connecticut: {
    tier: 'posting_required',
    minEmployees: 1,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Active disclosure + Oct 2026 posting rule',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Connecticut requires wage-range disclosure upon applicant request or before an offer (whichever comes first), with expanded public job-posting disclosure taking effect in October 2026 alongside a strict salary-history ban.',
  },
  Delaware: {
    tier: 'upcoming_posting_law',
    minEmployees: 25,
    requiresBenefitsInPost: true,
    effectiveLabel: 'Enacted (HS 2 for HB 105, effective Sep 26, 2027)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Delaware bans salary-history inquiries today and enacted a job-posting pay and benefits range mandate for employers with more than 25 employees taking effect September 26, 2027.',
  },
  'District of Columbia': {
    tier: 'posting_required',
    minEmployees: 1,
    requiresBenefitsInPost: true,
    effectiveLabel: 'Active (Wage Transparency Omnibus Act)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'All employers with at least 1 employee in DC must state the minimum and maximum projected pay in every job listing and disclose healthcare benefits before the first interview. Salary-history questions are prohibited.',
  },
  Hawaii: {
    tier: 'posting_required',
    minEmployees: 50,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Active (SB 1057)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 50 or more employees must disclose an hourly rate or salary range that reasonably reflects expected compensation in job listings, and may not inquire into an applicant’s wage history.',
  },
  Illinois: {
    tier: 'posting_required',
    minEmployees: 15,
    requiresBenefitsInPost: true,
    effectiveLabel: 'Active (HB 3129, effective Jan 1, 2025)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 15 or more employees must include both the pay scale and a general description of benefits and other compensation in any posting for work performed in Illinois or reporting to an Illinois supervisor.',
  },
  Maryland: {
    tier: 'posting_required',
    minEmployees: 1,
    requiresBenefitsInPost: true,
    effectiveLabel: 'Active (Wage Range Transparency Act)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'All employers posting roles physically performed at least partly in Maryland must publish the good-faith wage range, a general description of benefits, and any other compensation offered.',
  },
  Massachusetts: {
    tier: 'posting_required',
    minEmployees: 25,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Active (Frances Perkins Workplace Equity Act, Oct 29, 2025)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 25 or more employees in Massachusetts must disclose the annual salary or hourly wage range in all job postings, promotions, and transfers, in addition to Massachusetts’s longstanding salary-history ban.',
  },
  Minnesota: {
    tier: 'posting_required',
    minEmployees: 30,
    requiresBenefitsInPost: true,
    effectiveLabel: 'Active (Minn. Stat. 181.173, effective Jan 1, 2025)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 30 or more employees in Minnesota must list a starting salary range (open-ended ranges are not permitted) plus a general description of all benefits and other compensation in every job posting.',
  },
  Nevada: {
    tier: 'milestone_disclosure',
    minEmployees: 1,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Active post-interview disclosure (SB 293)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Nevada does not mandate ranges on initial external ads, but employers must automatically provide the wage or salary range to every applicant who has completed an interview for the position, and may never seek wage history.',
  },
  'New Jersey': {
    tier: 'posting_required',
    minEmployees: 10,
    requiresBenefitsInPost: true,
    effectiveLabel: 'Active (S2310, effective June 1, 2025)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 10 or more employees over 20 calendar weeks doing business or taking applications in New Jersey must publish the hourly wage or salary range and a general description of benefits in every job posting.',
  },
  'New York': {
    tier: 'posting_required',
    minEmployees: 4,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Active (NY Labor Law 194-b)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 4 or more employees must publish the good-faith minimum and maximum annual salary or hourly wage in advertisements for roles performed in New York or reporting to a New York office.',
  },
  'Rhode Island': {
    tier: 'milestone_disclosure',
    minEmployees: 1,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Active request & pre-offer disclosure',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers must provide the wage range upon applicant request and prior to discussing compensation (and at hire or transfer), and are barred from relying on or inquiring into prior wage history.',
  },
  Vermont: {
    tier: 'posting_required',
    minEmployees: 5,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Active (H.704, effective July 1, 2025)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 5 or more employees must include the good-faith minimum and maximum compensation in written advertisements for jobs physically located in Vermont or remote roles predominantly performing work for a Vermont office.',
  },
  Virginia: {
    tier: 'posting_required',
    minEmployees: 1,
    requiresBenefitsInPost: false,
    effectiveLabel: 'Updated July 2026 pay-transparency rule + pay discussion protection',
    salaryHistoryBan: 'public_employers_only',
    summary:
      'Virginia protects employee pay-discussion rights, bars state-agency salary-history questions, and tracks July 2026 statutory pay-range transparency requirements for covered job postings.',
  },
  Washington: {
    tier: 'posting_required',
    minEmployees: 15,
    requiresBenefitsInPost: true,
    effectiveLabel: 'Active (RCW 49.58.110, updated July 2025)',
    salaryHistoryBan: 'statewide_ban',
    summary:
      'Employers with 15 or more employees (with at least one Washington-based employee) must publish the wage scale or salary range and a general description of all benefits and other compensation in every job posting.',
  },
};

const EXTRA_SALARY_HISTORY_BANS: Readonly<Record<string, PayTransparencyRule['salaryHistoryBan']>> = {
  Alabama: 'statewide_ban', // Prohibits retaliation for refusing to disclose pay history
  Maine: 'statewide_ban',
  Oregon: 'statewide_ban',
  Puerto_Rico: 'statewide_ban',
  Georgia: 'public_employers_only',
  Michigan: 'public_employers_only',
  'North Carolina': 'public_employers_only',
  Pennsylvania: 'public_employers_only',
};

export const PAY_TRANSPARENCY_JURISDICTIONS: readonly PayTransparencyRule[] = ALL_STATES_BASE.map(({ state, code }) => {
  const custom = SPECIFIC_TRANSPARENCY_RULES[state];
  if (custom) {
    return { state, stateCode: code, ...custom };
  }
  const ban = EXTRA_SALARY_HISTORY_BANS[state] ?? 'none_or_preempted';
  return {
    state,
    stateCode: code,
    tier: 'no_statewide_posting_mandate',
    minEmployees: 0,
    requiresBenefitsInPost: false,
    effectiveLabel: 'No statewide ad-range mandate (check municipal ordinances)',
    salaryHistoryBan: ban,
    summary:
      ban === 'statewide_ban'
        ? `${state} has no statewide requirement to print a salary range in initial job advertisements, though statewide equal-pay rules restrict relying on or compelling prior salary history.`
        : `${state} currently imposes no statewide salary-range mandate on private-employer job postings. Local city or county ordinances may still apply, and multi-state remote ads trigger stricter states.`,
  };
});

export interface PayTransparencyVerdict {
  rule: PayTransparencyRule;
  mustPublishRangeNow: boolean;
  mustIncludeBenefitsDescription: boolean;
  mustAvoidSalaryHistoryQuestions: boolean;
  strictestRemoteTriggered: boolean;
  headline: string;
  checklist: string[];
}

export function evaluatePayTransparency(params: {
  state: string;
  employerHeadcount: number;
  workMode: 'In-Person' | 'Hybrid' | 'Remote';
  remoteNationwide?: boolean;
}): PayTransparencyVerdict {
  const rule =
    PAY_TRANSPARENCY_JURISDICTIONS.find((r) => r.state === params.state) ?? PAY_TRANSPARENCY_JURISDICTIONS[0];
  const headcount = Math.max(1, Math.round(params.employerHeadcount));
  const isRemoteEverywhere = params.workMode === 'Remote' && (params.remoteNationwide ?? true);

  if (isRemoteEverywhere) {
    // Nationwide remote postings can be filled by residents in CO (1+), DC (1+), MD (1+), NY (4+), VT (5+), NJ (10+), CA/IL/WA (15+)
    return {
      rule,
      mustPublishRangeNow: true,
      mustIncludeBenefitsDescription: true,
      mustAvoidSalaryHistoryQuestions: true,
      strictestRemoteTriggered: true,
      headline: 'Strictest-State Remote Rule Applies: Publish Pay Range & Benefits',
      checklist: [
        'Include a good-faith minimum and maximum salary or hourly range (no open-ended "and up" phrasing).',
        'Include a general description of benefits (health, PTO, CME, malpractice, retirement) to satisfy Colorado, Washington, Illinois, Maryland, New Jersey, and Minnesota rules.',
        'Include any bonus, wRVU productivity, or sign-on structure in the compensation summary.',
        'Remove all prior-salary questions from your application form and screening script.',
      ],
    };
  }

  const meetsThreshold = rule.tier === 'posting_required' && headcount >= rule.minEmployees;
  const mustIncludeBenefits = meetsThreshold && rule.requiresBenefitsInPost;
  const avoidHistory = rule.salaryHistoryBan !== 'none_or_preempted';

  const checklist: string[] = [];
  if (meetsThreshold) {
    checklist.push(
      `Publish a good-faith minimum and maximum pay range in the ${rule.state} posting (applies at ${rule.minEmployees}+ employees; you entered ${headcount}).`,
    );
  } else if (rule.tier === 'posting_required') {
    checklist.push(
      `${rule.state}'s posting law triggers at ${rule.minEmployees}+ employees (you entered ${headcount}), though publishing a range is still recommended for ${brand.niche.short} applicant conversion.`,
    );
  } else if (rule.tier === 'upcoming_posting_law') {
    checklist.push(
      `${rule.state}'s enacted posting law (${rule.effectiveLabel}) applies at ${rule.minEmployees}+ employees; adopting compliant pay bands early avoids re-templating.`,
    );
  } else if (rule.tier === 'milestone_disclosure') {
    checklist.push(
      `${rule.state} requires wage-range disclosure at defined hiring milestones (${rule.effectiveLabel}); publishing upfront streamlines compliance.`,
    );
  } else {
    checklist.push(
      `No statewide range-in-ad mandate in ${rule.state}, though listing a transparent pay range avoids wasted screening calls.`,
    );
  }

  if (mustIncludeBenefits) {
    checklist.push(`List a general summary of health, retirement, PTO, CME, and bonus benefits directly in the job ad.`);
  }
  if (avoidHistory) {
    checklist.push(`Do not ask candidates for current or historical compensation during screening or on your ATS form.`);
  }

  let headline = `Optional in ${rule.state} (Recommended for Conversion)`;
  if (meetsThreshold) {
    headline = mustIncludeBenefits
      ? `Pay Range + Benefits Summary Required in ${rule.state}`
      : `Good-Faith Pay Range Required in ${rule.state}`;
  } else if (rule.tier === 'milestone_disclosure') {
    headline = `Milestone Pay Disclosure Required in ${rule.state}`;
  } else if (rule.tier === 'upcoming_posting_law') {
    headline = `Upcoming Statutory Mandate in ${rule.state}`;
  }

  return {
    rule,
    mustPublishRangeNow: meetsThreshold,
    mustIncludeBenefitsDescription: mustIncludeBenefits,
    mustAvoidSalaryHistoryQuestions: avoidHistory,
    strictestRemoteTriggered: false,
    headline,
    checklist,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. COST OF VACANCY & LOCUM BRIDGE CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════

export interface VacancyCostInputs {
  completedVisitsPerDay: number;
  netCollectionPerVisit: number;
  clinicalDaysPerWeek: number;
  vacancyCalendarDays: number;
  annualBaseSalary: number;
  benefitsAndPayrollLoadPct: number;
  locumDailyRate: number;
  locumDaysCoveredPct: number;
  locumProductivityPct: number;
}

export interface VacancyMilestonePoint {
  days: number;
  netRevenueLostNoLocum: number;
  netCostWithLocum: number;
  lostPatientVisits: number;
}

export interface VacancyCostResult {
  clinicalWorkdaysMissed: number;
  totalVisitsUnfilled: number;
  grossCollectionsForegone: number;
  savedSalaryAndBenefits: number;
  netVacancyLossNoLocum: number;
  dailyNetBleed: number;
  locumDaysWorked: number;
  locumVisitsRecovered: number;
  locumCollectionsRecovered: number;
  locumTotalSpend: number;
  netPositionWithLocum: number;
  locumNetAdvantage: number;
  milestones: VacancyMilestonePoint[];
}

export function computeVacancyCost(raw: VacancyCostInputs): VacancyCostResult {
  const visitsPerDay = Math.max(0, raw.completedVisitsPerDay);
  const collection = Math.max(0, raw.netCollectionPerVisit);
  const daysPerWeek = Math.min(7, Math.max(0, raw.clinicalDaysPerWeek));
  const vacancyDays = Math.max(0, raw.vacancyCalendarDays);
  const annualLoadedComp = Math.max(0, raw.annualBaseSalary) * (1 + Math.max(0, raw.benefitsAndPayrollLoadPct) / 100);
  const locumDaily = Math.max(0, raw.locumDailyRate);
  const locumShare = Math.min(100, Math.max(0, raw.locumDaysCoveredPct)) / 100;
  const locumProd = Math.min(150, Math.max(0, raw.locumProductivityPct)) / 100;

  const calcForDays = (calDays: number) => {
    const workdays = (calDays / 7) * daysPerWeek;
    const visits = workdays * visitsPerDay;
    const grossLost = visits * collection;
    const savedComp = (calDays / 365) * annualLoadedComp;
    const netLossNoLocum = grossLost - savedComp;

    const lDays = workdays * locumShare;
    const lVisits = lDays * visitsPerDay * locumProd;
    const lRecovered = lVisits * collection;
    const lSpend = lDays * locumDaily;
    // Net loss when using locum = (grossLost - lRecovered) + lSpend - savedComp
    const netLossWithLocum = grossLost - lRecovered + lSpend - savedComp;

    return {
      workdays,
      visits,
      grossLost,
      savedComp,
      netLossNoLocum,
      lDays,
      lVisits,
      lRecovered,
      lSpend,
      netLossWithLocum,
    };
  };

  const cur = calcForDays(vacancyDays);
  const dailyBleed = vacancyDays > 0 ? cur.netLossNoLocum / vacancyDays : ((daysPerWeek / 7) * visitsPerDay * collection) - annualLoadedComp / 365;

  const milestones: VacancyMilestonePoint[] = [30, 60, 90, 120].map((d) => {
    const m = calcForDays(d);
    return {
      days: d,
      netRevenueLostNoLocum: m.netLossNoLocum,
      netCostWithLocum: m.netLossWithLocum,
      lostPatientVisits: Math.round(m.visits),
    };
  });

  return {
    clinicalWorkdaysMissed: cur.workdays,
    totalVisitsUnfilled: cur.visits,
    grossCollectionsForegone: cur.grossLost,
    savedSalaryAndBenefits: cur.savedComp,
    netVacancyLossNoLocum: cur.netLossNoLocum,
    dailyNetBleed: dailyBleed,
    locumDaysWorked: cur.lDays,
    locumVisitsRecovered: cur.lVisits,
    locumCollectionsRecovered: cur.lRecovered,
    locumTotalSpend: cur.lSpend,
    netPositionWithLocum: cur.netLossWithLocum,
    locumNetAdvantage: cur.netLossNoLocum - cur.netLossWithLocum,
    milestones,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. CLINIC PROFITABILITY & W-2 VS 1099 SPLIT MODELER
// ═══════════════════════════════════════════════════════════════════════════

export interface ClinicProfitabilityInputs {
  scheduledVisitsPerDay: number;
  noShowPct: number;
  clinicalDaysPerWeek: number;
  workingWeeksPerYear: number;
  netCollectionPerVisit: number;
  w2BaseSalary: number;
  benefitsAndPayrollPct: number;
  annualCmeAndMalpractice: number;
  contractorClinicianSplitPct: number;
  collaboratingMdMonthlyRetainer: number;
  monthlySupportAndEhrOverhead: number;
}

export interface ClinicProfitabilityResult {
  clinicalDaysPerYear: number;
  completedVisitsPerDay: number;
  completedVisitsPerYear: number;
  grossAnnualCollections: number;
  annualFixedPracticeSupportCost: number;
  // W-2 model
  w2TotalClinicianCost: number;
  w2TotalClinicExpense: number;
  w2AnnualNetMargin: number;
  w2MonthlyNetMargin: number;
  w2MarginPct: number;
  w2BreakEvenCompletedVisitsPerDay: number;
  // 1099 % split model
  split1099ClinicianPayout: number;
  split1099TotalClinicExpense: number;
  split1099AnnualNetMargin: number;
  split1099MonthlyNetMargin: number;
  split1099MarginPct: number;
  split1099BreakEvenCompletedVisitsPerDay: number;
}

export function computeClinicProfitability(raw: ClinicProfitabilityInputs): ClinicProfitabilityResult {
  const schedDay = Math.max(0, raw.scheduledVisitsPerDay);
  const noShow = Math.min(100, Math.max(0, raw.noShowPct)) / 100;
  const daysWk = Math.min(7, Math.max(0, raw.clinicalDaysPerWeek));
  const weeksYr = Math.min(52, Math.max(0, raw.workingWeeksPerYear));
  const netPerVisit = Math.max(0, raw.netCollectionPerVisit);

  const clinicalDaysPerYear = daysWk * weeksYr;
  const completedVisitsPerDay = schedDay * (1 - noShow);
  const completedVisitsPerYear = completedVisitsPerDay * clinicalDaysPerYear;
  const grossAnnualCollections = completedVisitsPerYear * netPerVisit;

  const annualFixedPracticeSupportCost =
    Math.max(0, raw.collaboratingMdMonthlyRetainer) * 12 +
    Math.max(0, raw.monthlySupportAndEhrOverhead) * 12;

  // W-2 side
  const w2TotalClinicianCost =
    Math.max(0, raw.w2BaseSalary) * (1 + Math.max(0, raw.benefitsAndPayrollPct) / 100) +
    Math.max(0, raw.annualCmeAndMalpractice);
  const w2TotalClinicExpense = w2TotalClinicianCost + annualFixedPracticeSupportCost;
  const w2AnnualNetMargin = grossAnnualCollections - w2TotalClinicExpense;
  const w2MarginPct = grossAnnualCollections > 0 ? (w2AnnualNetMargin / grossAnnualCollections) * 100 : 0;
  const w2BreakEvenCompletedVisitsPerDay =
    clinicalDaysPerYear > 0 && netPerVisit > 0
      ? w2TotalClinicExpense / (clinicalDaysPerYear * netPerVisit)
      : 0;

  // 1099 split side (clinic retains 100% - splitPct, pays fixed support/MD retainer)
  const splitShare = Math.min(100, Math.max(0, raw.contractorClinicianSplitPct)) / 100;
  const split1099ClinicianPayout = grossAnnualCollections * splitShare;
  const split1099TotalClinicExpense = split1099ClinicianPayout + annualFixedPracticeSupportCost;
  const split1099AnnualNetMargin = grossAnnualCollections - split1099TotalClinicExpense;
  const split1099MarginPct =
    grossAnnualCollections > 0 ? (split1099AnnualNetMargin / grossAnnualCollections) * 100 : 0;
  const clinicRetainedPerVisit = netPerVisit * (1 - splitShare);
  const split1099BreakEvenCompletedVisitsPerDay =
    clinicalDaysPerYear > 0 && clinicRetainedPerVisit > 0
      ? annualFixedPracticeSupportCost / (clinicalDaysPerYear * clinicRetainedPerVisit)
      : 0;

  return {
    clinicalDaysPerYear,
    completedVisitsPerDay,
    completedVisitsPerYear,
    grossAnnualCollections,
    annualFixedPracticeSupportCost,
    w2TotalClinicianCost,
    w2TotalClinicExpense,
    w2AnnualNetMargin,
    w2MonthlyNetMargin: w2AnnualNetMargin / 12,
    w2MarginPct,
    w2BreakEvenCompletedVisitsPerDay,
    split1099ClinicianPayout,
    split1099TotalClinicExpense,
    split1099AnnualNetMargin,
    split1099MonthlyNetMargin: split1099AnnualNetMargin / 12,
    split1099MarginPct,
    split1099BreakEvenCompletedVisitsPerDay,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. MEDICARE 85% DIRECT VS 100% INCIDENT-TO BILLING MODELER
// ═══════════════════════════════════════════════════════════════════════════

export const CMS_DIRECT_NP_RATE = 0.85;
export const CMS_INCIDENT_TO_RATE = 1.0;

export interface IncidentToInputs {
  annualTotalVisits: number;
  medicarePayerSharePct: number;
  medicarePhysicianFeeScheduleAllowed: number;
  commercialFollows85SharePct: number;
  commercialPhysicianAllowed: number;
  /** Share of visits that strictly meet ALL CMS 42 CFR 410.26 incident-to rules. */
  compliantQualifyingVisitsPct: number;
  mdSupervisionHoursPerWeek: number;
  mdHourlyCost: number;
  workingWeeksPerYear: number;
}

export interface IncidentToResult {
  medicareVisits: number;
  commercial85Visits: number;
  unaffectedCommercialVisits: number;
  qualifyingIncidentToMedicareVisits: number;
  nonQualifyingMedicareVisits: number;
  allDirect85Revenue: number;
  hybridCompliantIncidentToRevenue: number;
  grossIncidentToLift: number;
  annualMdSupervisionCost: number;
  netAnnualLiftAfterSupervision: number;
  perQualifyingVisitMedicareGain: number;
}

export const INCIDENT_TO_COMPLIANCE_RULES: readonly { title: string; detail: string }[] = [
  {
    title: 'Non-facility office setting (POS 11)',
    detail:
      'Medicare incident-to billing applies in a physician office (Place of Service 11), never in a hospital inpatient, outpatient department, or emergency department (split/shared rules govern facility settings instead).',
  },
  {
    title: 'Established patient, established diagnosis & plan of care',
    detail:
      'A physician must have personally performed the initial service, established the diagnosis and treatment plan, and remain actively involved. New patients and new clinical problems must be billed directly under the clinician’s own NPI at 85%.',
  },
  {
    title: 'Direct physician supervision in the office suite',
    detail:
      'A supervising physician in the group must be physically present in the same office suite (or meet current CMS supervision regulations) and immediately available to furnish assistance and direction throughout the encounter.',
  },
  {
    title: 'Employment or qualifying W-2 / leased / contracted relationship',
    detail:
      'Both the rendering clinician and the supervising physician must satisfy 42 CFR 410.26 relationship rules with the billing entity.',
  },
  {
    title: 'Commercial payers set independent credentialing rules',
    detail:
      'Never assume commercial insurers mirror Medicare incident-to rules; several major commercial plans require billing strictly under the rendering clinician’s NPI.',
  },
];

export function computeIncidentToRoi(raw: IncidentToInputs): IncidentToResult {
  const totalVisits = Math.max(0, raw.annualTotalVisits);
  const medShare = Math.min(100, Math.max(0, raw.medicarePayerSharePct)) / 100;
  const comm85Share = Math.min(100 - medShare * 100, Math.max(0, raw.commercialFollows85SharePct)) / 100;
  const unaffectedShare = Math.max(0, 1 - medShare - comm85Share);

  const medPfs = Math.max(0, raw.medicarePhysicianFeeScheduleAllowed);
  const commPfs = Math.max(0, raw.commercialPhysicianAllowed);
  const qualifyingPct = Math.min(100, Math.max(0, raw.compliantQualifyingVisitsPct)) / 100;

  const medicareVisits = totalVisits * medShare;
  const commercial85Visits = totalVisits * comm85Share;
  const unaffectedCommercialVisits = totalVisits * unaffectedShare;

  const qualifyingIncidentToMedicareVisits = medicareVisits * qualifyingPct;
  const nonQualifyingMedicareVisits = medicareVisits - qualifyingIncidentToMedicareVisits;

  const qualifyingCommVisits = commercial85Visits * qualifyingPct;
  const nonQualifyingCommVisits = commercial85Visits - qualifyingCommVisits;

  const allDirect85Revenue =
    medicareVisits * (medPfs * CMS_DIRECT_NP_RATE) +
    commercial85Visits * (commPfs * CMS_DIRECT_NP_RATE) +
    unaffectedCommercialVisits * commPfs;

  const hybridCompliantIncidentToRevenue =
    qualifyingIncidentToMedicareVisits * (medPfs * CMS_INCIDENT_TO_RATE) +
    nonQualifyingMedicareVisits * (medPfs * CMS_DIRECT_NP_RATE) +
    qualifyingCommVisits * (commPfs * CMS_INCIDENT_TO_RATE) +
    nonQualifyingCommVisits * (commPfs * CMS_DIRECT_NP_RATE) +
    unaffectedCommercialVisits * commPfs;

  const grossIncidentToLift = hybridCompliantIncidentToRevenue - allDirect85Revenue;
  const annualMdSupervisionCost =
    Math.max(0, raw.mdSupervisionHoursPerWeek) *
    Math.max(0, raw.mdHourlyCost) *
    Math.min(52, Math.max(0, raw.workingWeeksPerYear));

  return {
    medicareVisits,
    commercial85Visits,
    unaffectedCommercialVisits,
    qualifyingIncidentToMedicareVisits,
    nonQualifyingMedicareVisits,
    allDirect85Revenue,
    hybridCompliantIncidentToRevenue,
    grossIncidentToLift,
    annualMdSupervisionCost,
    netAnnualLiftAfterSupervision: grossIncidentToLift - annualMdSupervisionCost,
    perQualifyingVisitMedicareGain: medPfs * (CMS_INCIDENT_TO_RATE - CMS_DIRECT_NP_RATE),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. CREDENTIALING & PAYER PANELING REVERSE GO-LIVE TIMELINE PLANNER
// ═══════════════════════════════════════════════════════════════════════════

export interface CredentialingInputs {
  /** YYYY-MM-DD target first billable patient day. */
  targetGoLiveIso: string;
  alreadyLicensedInState: boolean;
  needsHospitalPrivileges: boolean;
  stateBonDays: number;
  deaAndCsrDays: number;
  caqhAndMalpracticeDays: number;
  payerPanelingDays: number;
  hospitalPrivilegingDays: number;
  ehrAndOnboardingDays: number;
}

export interface CredentialingMilestone {
  id: string;
  label: string;
  startIso: string;
  endIso: string;
  durationDays: number;
  offsetStartDaysBeforeGoLive: number;
  offsetEndDaysBeforeGoLive: number;
  criticalPath: boolean;
  note: string;
}

export interface CredentialingPlan {
  targetGoLiveIso: string;
  latestOfferSignIso: string;
  totalLeadTimeCalendarDays: number;
  milestones: CredentialingMilestone[];
}

function addDaysIso(baseIso: string, deltaDays: number): string {
  const parts = baseIso.split('-').map(Number);
  const d =
    parts.length === 3 && parts.every((n) => Number.isFinite(n))
      ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
      : new Date(Date.UTC(2027, 2, 1));
  d.setUTCDate(d.getUTCDate() + Math.round(deltaDays));
  return d.toISOString().slice(0, 10);
}

export function computeCredentialingTimeline(raw: CredentialingInputs): CredentialingPlan {
  const goLive = /^\d{4}-\d{2}-\d{2}$/.test(raw.targetGoLiveIso) ? raw.targetGoLiveIso : '2027-03-01';
  const bonDays = raw.alreadyLicensedInState ? 0 : Math.max(0, Math.round(raw.stateBonDays));
  const deaDays = Math.max(0, Math.round(raw.deaAndCsrDays));
  const caqhDays = Math.max(0, Math.round(raw.caqhAndMalpracticeDays));
  const payerDays = Math.max(0, Math.round(raw.payerPanelingDays));
  const privDays = raw.needsHospitalPrivileges ? Math.max(0, Math.round(raw.hospitalPrivilegingDays)) : 0;
  const onboardingDays = Math.max(0, Math.round(raw.ehrAndOnboardingDays));

  // Reverse dependencies from Day 0 (Go-Live):
  // Payer enrollment & Hospital privileging both finish on Go-Live (can run in parallel once license + CAQH are ready).
  const postLicenseTail = Math.max(payerDays, privDays, deaDays, onboardingDays);
  // CAQH packet & malpractice binder happen right after offer acceptance (in parallel with BON endorsement if needed, or before payer filing).
  const prePayerPrep = Math.max(bonDays, caqhDays);
  const totalLeadDays = prePayerPrep + postLicenseTail;

  const milestones: CredentialingMilestone[] = [];

  if (!raw.alreadyLicensedInState && bonDays > 0) {
    const startOff = totalLeadDays;
    const endOff = totalLeadDays - bonDays;
    milestones.push({
      id: 'state-bon',
      label: 'State RN & APRN Licensure / Endorsement',
      startIso: addDaysIso(goLive, -startOff),
      endIso: addDaysIso(goLive, -endOff),
      durationDays: bonDays,
      offsetStartDaysBeforeGoLive: startOff,
      offsetEndDaysBeforeGoLive: endOff,
      criticalPath: bonDays >= caqhDays,
      note: 'Submit transcripts, national certification verification, and fingerprints immediately upon offer signature.',
    });
  }

  if (caqhDays > 0) {
    const startOff = totalLeadDays;
    const endOff = totalLeadDays - caqhDays;
    milestones.push({
      id: 'caqh-malpractice',
      label: 'NPI Taxonomy, CAQH Attestation & Malpractice Certificate',
      startIso: addDaysIso(goLive, -startOff),
      endIso: addDaysIso(goLive, -endOff),
      durationDays: caqhDays,
      offsetStartDaysBeforeGoLive: startOff,
      offsetEndDaysBeforeGoLive: endOff,
      criticalPath: caqhDays >= bonDays,
      note: 'Update NPPES address/taxonomy, obtain malpractice binder COI, and re-attest CAQH ProView with zero work-history gaps.',
    });
  }

  if (deaDays > 0) {
    const startOff = postLicenseTail;
    const endOff = Math.max(0, postLicenseTail - deaDays);
    milestones.push({
      id: 'dea-csr',
      label: 'Federal DEA & State Controlled-Substance Registration',
      startIso: addDaysIso(goLive, -startOff),
      endIso: addDaysIso(goLive, -endOff),
      durationDays: deaDays,
      offsetStartDaysBeforeGoLive: startOff,
      offsetEndDaysBeforeGoLive: endOff,
      criticalPath: deaDays === postLicenseTail,
      note: 'File state CSR/CDS (where required) and federal DEA using practice site address once active state APRN license posts.',
    });
  }

  if (payerDays > 0) {
    const startOff = payerDays;
    milestones.push({
      id: 'payer-paneling',
      label: 'Medicare PECOS, State Medicaid & Commercial Payer Enrollment',
      startIso: addDaysIso(goLive, -startOff),
      endIso: goLive,
      durationDays: payerDays,
      offsetStartDaysBeforeGoLive: startOff,
      offsetEndDaysBeforeGoLive: 0,
      criticalPath: payerDays >= privDays && payerDays >= deaDays,
      note: 'Submit 855I/PECOS reassignment, Medicaid provider enrollment, and commercial roster additions.',
    });
  }

  if (raw.needsHospitalPrivileges && privDays > 0) {
    const startOff = privDays;
    milestones.push({
      id: 'hospital-priv',
      label: 'Medical Staff Credentialing & Bylaws Privileging Committee',
      startIso: addDaysIso(goLive, -startOff),
      endIso: goLive,
      durationDays: privDays,
      offsetStartDaysBeforeGoLive: startOff,
      offsetEndDaysBeforeGoLive: 0,
      criticalPath: privDays >= payerDays,
      note: 'Align complete packet submission ahead of the monthly Medical Executive Committee (MEC) and Governing Board calendar.',
    });
  }

  if (onboardingDays > 0) {
    const startOff = onboardingDays;
    milestones.push({
      id: 'ehr-onboarding',
      label: 'EHR Templates, EPCS Token, Collaborative Protocol & Orientation',
      startIso: addDaysIso(goLive, -startOff),
      endIso: goLive,
      durationDays: onboardingDays,
      offsetStartDaysBeforeGoLive: startOff,
      offsetEndDaysBeforeGoLive: 0,
      criticalPath: false,
      note: 'Execute state collaborative/supervisory agreement (if required), activate EPCS two-factor token, and build ramped schedule.',
    });
  }

  return {
    targetGoLiveIso: goLive,
    latestOfferSignIso: addDaysIso(goLive, -totalLeadDays),
    totalLeadTimeCalendarDays: totalLeadDays,
    milestones,
  };
}

export function buildCredentialingIcs(plan: CredentialingPlan, roleTitle = 'Clinician Onboarding'): string {
  const cleanDate = (iso: string) => iso.replace(/-/g, '');
  const stamp = '20261126T120000Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${brand.name}//Credentialing Timeline Planner//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:offer-deadline-${cleanDate(plan.latestOfferSignIso)}@nphiring.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${cleanDate(plan.latestOfferSignIso)}`,
    `DTEND;VALUE=DATE:${cleanDate(addDaysIso(plan.latestOfferSignIso, 1))}`,
    `SUMMARY:${roleTitle}: Target Signed Offer & Kickoff Packet`,
    `DESCRIPTION:Reverse go-live milestone (${plan.totalLeadTimeCalendarDays} calendar days before ${plan.targetGoLiveIso}).`,
    'END:VEVENT',
  ];

  for (const m of plan.milestones) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${m.id}-${cleanDate(m.startIso)}@nphiring.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${cleanDate(m.startIso)}`,
      `DTEND;VALUE=DATE:${cleanDate(addDaysIso(m.startIso, 1))}`,
      `SUMMARY:${roleTitle}: Start ${m.label}`,
      `DESCRIPTION:${m.note} (Planned completion ${m.endIso}).`,
      'END:VEVENT',
    );
  }

  lines.push(
    'BEGIN:VEVENT',
    `UID:golive-${cleanDate(plan.targetGoLiveIso)}@nphiring.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${cleanDate(plan.targetGoLiveIso)}`,
    `DTEND;VALUE=DATE:${cleanDate(addDaysIso(plan.targetGoLiveIso, 1))}`,
    `SUMMARY:${roleTitle}: First Billable Patient Day`,
    'DESCRIPTION:Target clinical go-live date.',
    'END:VEVENT',
    'END:VCALENDAR',
  );

  return lines.join('\r\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. STRUCTURED CLINICAL INTERVIEW SCORECARD BUILDER
// ═══════════════════════════════════════════════════════════════════════════

export type InterviewTrackId =
  | 'primary-care'
  | 'urgent-care'
  | 'acute-inpatient'
  | 'derm-aesthetics'
  | 'telehealth';

export interface InterviewQuestionItem {
  id: string;
  competency: string;
  weight: number;
  prompt: string;
  strongSignal: string;
}

export interface InterviewTrack {
  id: InterviewTrackId;
  label: string;
  settingNote: string;
  questions: readonly InterviewQuestionItem[];
}

export const INTERVIEW_TRACKS: readonly InterviewTrack[] = [
  {
    id: 'primary-care',
    label: 'Primary Care & Family Practice',
    settingNote: 'Longitudinal panel ownership, chronic-disease titration, preventive care, and safe escalation.',
    questions: [
      {
        id: 'pc-1',
        competency: 'Diagnostic Reasoning',
        weight: 25,
        prompt:
          'Walk through how you evaluate an adult presenting with three months of fatigue, unintended weight loss, and borderline microcytic anemia.',
        strongSignal:
          'Builds prioritized differential (occult GI bleed, malignancy, celiac, iron deficiency), orders iron/ferritin/stool/GI workup, sets closed-loop follow-up.',
      },
      {
        id: 'pc-2',
        competency: 'Polypharmacy & Chronic Care',
        weight: 25,
        prompt:
          'An older adult with type 2 diabetes, stage 3b CKD, and heart failure has a rising A1c and frequent dizziness. How do you adjust the regimen?',
        strongSignal:
          'Checks orthostatics and eGFR thresholds, prioritizes SGLT2i/GLP-1 evidence, de-escalates hypoglycemia/fall culprits, engages caregiver.',
      },
      {
        id: 'pc-3',
        competency: 'Scope & Escalation Judgment',
        weight: 20,
        prompt:
          'Tell me about a complex outpatient case where you consulted a collaborating physician or specialist urgently rather than waiting for routine referral.',
        strongSignal:
          'Clear red-flag recognition, SBAR-style concise presentation, ego-free collaboration, documented safety net.',
      },
      {
        id: 'pc-4',
        competency: 'Panel Throughput & In-Basket',
        weight: 15,
        prompt:
          'How do you structure a 18 to 22 patient day so charts, critical lab results, and refill requests do not spill into late nights?',
        strongSignal:
          'Pre-charting habits, MA rooming protocols, point-of-care documentation, clear patient portal boundaries.',
      },
      {
        id: 'pc-5',
        competency: 'Controlled-Substance Stewardship',
        weight: 15,
        prompt:
          'A new-to-clinic patient requests an immediate refill of a chronic benzodiazepine or stimulant with no outside records yet. What is your workflow?',
        strongSignal:
          'Checks state PDMP, verifies prior pharmacy/records, screens for withdrawal risk vs diversion, sets clear controlled-substance agreement expectations.',
      },
    ],
  },
  {
    id: 'urgent-care',
    label: 'Urgent Care & Emergency Fast-Track',
    settingNote: 'High-acuity red-flag exclusion, minor procedures, rapid disposition, and autonomous shift flow.',
    questions: [
      {
        id: 'uc-1',
        competency: 'Red-Flag Triage & Disposition',
        weight: 30,
        prompt:
          'A 52-year-old walks into urgent care with epigastric discomfort, diaphoresis, and normal initial vitals asking for antacids. Walk through your first 10 minutes.',
        strongSignal:
          'Immediate 12-lead ECG, ACS rule-out mindset, aspirin/EMS transfer protocol rather than outpatient GI assumptions.',
      },
      {
        id: 'uc-2',
        competency: 'Procedural Readiness',
        weight: 25,
        prompt:
          'Which laceration repairs, abscess drainages, splints, and foreign-body removals do you perform independently, and which anatomical sites do you refer out?',
        strongSignal:
          'Specific suture layers, digital nerve blocks, tendon/neurovascular exam, honest boundaries on deep facial/hand/joint involvement.',
      },
      {
        id: 'uc-3',
        competency: 'Antibiotic Stewardship',
        weight: 15,
        prompt:
          'How do you maintain patient satisfaction when declining antibiotics for acute viral bronchitis or uncomplicated sinusitis?',
        strongSignal:
          'Empathetic validation, symptomatic relief plan, concrete return precautions or delayed-prescription criteria.',
      },
      {
        id: 'uc-4',
        competency: 'Pediatric & Lifespan Comfort',
        weight: 15,
        prompt:
          'Describe your approach to a febrile, irritable 14-month-old during a high-volume weekend shift.',
        strongSignal:
          'Pediatric assessment triangle, hydration/meningeal/urinary occult source check, weight-based dosing accuracy.',
      },
      {
        id: 'uc-5',
        competency: 'High-Volume Shift Flow',
        weight: 15,
        prompt:
          'When four walk-ins arrive simultaneously while a laceration tray is open, how do you direct the MA/RN team?',
        strongSignal:
          'Rapid eyeball triage, delegation of standing orders (vitals, rapid swabs, X-ray), calm team communication.',
      },
    ],
  },
  {
    id: 'acute-inpatient',
    label: 'Acute Care & Hospitalist Service',
    settingNote: 'Admissions, acute decompensation, multidisciplinary rounding, and safe transitions of care.',
    questions: [
      {
        id: 'ac-1',
        competency: 'Acute Decompensation',
        weight: 30,
        prompt:
          'You are paged at 2:00 p.m. for an admitted pneumonia patient whose blood pressure dropped to 86/50 with new confusion and lactate of 3.8. Walk through your first hour.',
        strongSignal:
          'Bedside evaluation, sepsis bundle (cultures, broad-spectrum antimicrobials, crystalloid resuscitation), ICU/attending escalation triggers.',
      },
      {
        id: 'ac-2',
        competency: 'Admission Workup & Medical Necessity',
        weight: 20,
        prompt:
          'How do you distinguish observation vs inpatient status and structure a clean admission H&P for decompensated heart failure?',
        strongSignal:
          'Precipitant search, volume assessment, IV diuretic titration, telemetry/electrolyte monitoring, clear clinical severity documentation.',
      },
      {
        id: 'ac-3',
        competency: 'Multidisciplinary Rounding & Goals of Care',
        weight: 20,
        prompt:
          'Describe a time you led a difficult family goals-of-care or code-status meeting alongside attending physicians and palliative or social-work colleagues.',
        strongSignal:
          'Structured communication, eliciting patient values, accurate prognosis alignment, thorough advance-care documentation.',
      },
      {
        id: 'ac-4',
        competency: 'Safe Discharge & Readmission Prevention',
        weight: 15,
        prompt:
          'What specific checks do you run before signing discharge orders on a high-risk patient with five medication changes?',
        strongSignal:
          'Teach-back medication reconciliation, affordability check, 7-day outpatient bridge appointment, clear red-flag instructions.',
      },
      {
        id: 'ac-5',
        competency: 'Handoffs & Night/Cross-Cover Safety',
        weight: 15,
        prompt:
          'What makes a shift handoff actionable for the night-float or oncoming clinician?',
        strongSignal:
          'I-PASS format, explicit contingency "if X then Y" plans rather than narrative history dumps.',
      },
    ],
  },
  {
    id: 'derm-aesthetics',
    label: 'Dermatology & Medical Aesthetics',
    settingNote: 'Lesion triage, biopsy/procedural safety, complication management, and realistic patient expectations.',
    questions: [
      {
        id: 'da-1',
        competency: 'Pigmented Lesion & Malignancy Triage',
        weight: 25,
        prompt:
          'How do you evaluate a changing pigmented lesion during a cosmetic consult, and when do you choose shave vs punch vs excisional referral?',
        strongSignal:
          'Dermoscopy fundamentals, ABCDE criteria, full-thickness punch/saucerization when melanoma is suspected rather than superficial shave.',
      },
      {
        id: 'da-2',
        competency: 'Vascular Occlusion & Complication Protocol',
        weight: 30,
        prompt:
          'During or shortly after a dermal filler treatment, a patient reports disproportionate pain and livedo blanching. Walk through your exact emergency protocol.',
        strongSignal:
          'Immediate cessation, high-dose pulsed hyaluronidase protocol, capillary refill monitoring, ophthalmology/ED escalation for visual symptoms.',
      },
      {
        id: 'da-3',
        competency: 'Patient Selection & Saying No',
        weight: 20,
        prompt:
          'Tell me about a time you declined an elective procedure due to medical contraindications or unrealistic body-image expectations.',
        strongSignal:
          'Ethical clinical boundary setting, screening for contraindications, calm documentation.',
      },
      {
        id: 'da-4',
        competency: 'Medical Dermatology Breadth',
        weight: 15,
        prompt:
          'Outline your workup and systemic monitoring for severe nodulocystic acne or moderate-to-severe psoriasis.',
        strongSignal:
          'iPLEDGE / baseline labs / biologic TB & hepatitis screening, stepwise evidence-based escalation.',
      },
      {
        id: 'da-5',
        competency: 'Documentation & Photography Standards',
        weight: 10,
        prompt:
          'How do you standardize informed consent, lot-number tracking, and anatomical mapping in the chart?',
        strongSignal:
          'Consistent pre-procedure photos, lot/expiration/units per site, post-care instructions.',
      },
    ],
  },
  {
    id: 'telehealth',
    label: 'Telehealth & Multi-State Virtual Care',
    settingNote: 'Virtual physical exam limits, in-person escalation thresholds, multi-state EPCS compliance, and async safety.',
    questions: [
      {
        id: 'th-1',
        competency: 'Virtual Clinical Boundaries',
        weight: 30,
        prompt:
          'Which chief complaints do you immediately redirect from a video visit to an emergency department or brick-and-mortar exam, even when the patient asks for a prescription?',
        strongSignal:
          'Clear clinical guardrails (chest pain, focal neuro deficits, acute abdomen, pediatric respiratory distress, unverified vitals) and warm local escalation.',
      },
      {
        id: 'th-2',
        competency: 'Multi-State Regulatory & PDMP Diligence',
        weight: 25,
        prompt:
          'Before starting a telehealth visit, what state-location and regulatory checks do you verify?',
        strongSignal:
          'Verifies patient physical location at time of visit matches active state APRN license, local emergency address on file, state PDMP/EPCS rules.',
      },
      {
        id: 'th-3',
        competency: 'Video-Guided Exam Technique',
        weight: 15,
        prompt:
          'How do you gather objective clinical data over video when you cannot palpate or auscultate directly?',
        strongSignal:
          'Home BP/pulse-ox/temp verification, respiratory effort count, guided range-of-motion, lighting/camera positioning.',
      },
      {
        id: 'th-4',
        competency: 'Asynchronous Messaging Safety',
        weight: 15,
        prompt:
          'How do you handle a patient portal message containing subtle acute symptoms sent on a Friday afternoon?',
        strongSignal:
          'Refuses to manage unstable symptoms asynchronously, triggers synchronous phone/urgent escalation, documents safety instructions.',
      },
      {
        id: 'th-5',
        competency: 'Remote Autonomy & Quality Metrics',
        weight: 15,
        prompt:
          'Working remotely without a hallway colleague, how do you stay aligned on clinical protocols and peer review?',
        strongSignal:
          'Proactive chart-review participation, guideline adherence, timely Slack/clinical-lead escalation.',
      },
    ],
  },
];

export interface ScorecardRatingEntry {
  questionId: string;
  weight: number;
  /** 0 = unrated, 1 to 5 = scored */
  score: number;
}

export interface ScorecardSummary {
  ratedCount: number;
  totalQuestions: number;
  weightedAverage1To5: number;
  normalizedScore100: number;
  recommendation: 'Strong Hire' | 'Hire with Focused Onboarding' | 'Hold / Second Clinical Screen' | 'Do Not Advance' | 'Incomplete';
}

export function scoreInterviewCandidate(entries: readonly ScorecardRatingEntry[]): ScorecardSummary {
  const rated = entries.filter((e) => e.score >= 1 && e.score <= 5 && e.weight > 0);
  if (rated.length === 0) {
    return {
      ratedCount: 0,
      totalQuestions: entries.length,
      weightedAverage1To5: 0,
      normalizedScore100: 0,
      recommendation: 'Incomplete',
    };
  }
  const totalWeight = rated.reduce((sum, e) => sum + e.weight, 0);
  const weightedSum = rated.reduce((sum, e) => sum + e.score * e.weight, 0);
  const avg = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const pct = Math.round((avg / 5) * 100);

  let recommendation: ScorecardSummary['recommendation'] = 'Do Not Advance';
  if (avg >= 4.2) recommendation = 'Strong Hire';
  else if (avg >= 3.5) recommendation = 'Hire with Focused Onboarding';
  else if (avg >= 2.8) recommendation = 'Hold / Second Clinical Screen';

  return {
    ratedCount: rated.length,
    totalQuestions: entries.length,
    weightedAverage1To5: Math.round(avg * 100) / 100,
    normalizedScore100: pct,
    recommendation,
  };
}

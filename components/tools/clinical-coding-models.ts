/**
 * Pure clinical productivity and coding models:
 *  1. CMS CY2026 Physician Fee Schedule work RVU (wRVU) & Productivity Bonus Modeler
 *  2. 2023+ AMA CPT Outpatient Office E/M Leveling (99202 to 99215) via 2-of-3 MDM & Total Time
 *
 * Pure TypeScript: zero network calls, zero PHI, safe in server and client bundles.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. CMS CY2026 WORK RVU TABLE & PRODUCTIVITY BONUS CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════

export interface CmsWrvuCode {
  cpt: string;
  category: 'Outpatient E/M' | 'Inpatient & Critical Care' | 'Emergency' | 'Preventive' | 'Procedures';
  label: string;
  /** Published CMS PFS work RVU value. */
  wrvu: number;
}

/**
 * Curated CMS Physician Fee Schedule work RVU values for high-frequency NP
 * encounters and procedures (CMS PFS CY2026 RVU schedule).
 */
export const CMS_WRVU_TABLE: readonly CmsWrvuCode[] = [
  // Outpatient Office / Other Outpatient E/M
  { cpt: '99202', category: 'Outpatient E/M', label: 'New patient, straightforward (15 to 29 min)', wrvu: 0.93 },
  { cpt: '99203', category: 'Outpatient E/M', label: 'New patient, low MDM (30 to 44 min)', wrvu: 1.60 },
  { cpt: '99204', category: 'Outpatient E/M', label: 'New patient, moderate MDM (45 to 59 min)', wrvu: 2.60 },
  { cpt: '99205', category: 'Outpatient E/M', label: 'New patient, high MDM (60 to 74 min)', wrvu: 3.50 },
  { cpt: '99212', category: 'Outpatient E/M', label: 'Established patient, straightforward (10 to 19 min)', wrvu: 0.70 },
  { cpt: '99213', category: 'Outpatient E/M', label: 'Established patient, low MDM (20 to 29 min)', wrvu: 1.30 },
  { cpt: '99214', category: 'Outpatient E/M', label: 'Established patient, moderate MDM (30 to 39 min)', wrvu: 1.92 },
  { cpt: '99215', category: 'Outpatient E/M', label: 'Established patient, high MDM (40 to 54 min)', wrvu: 2.80 },
  // Preventive Visits
  { cpt: '99385', category: 'Preventive', label: 'Initial preventive medicine, adult 18 to 39 yrs', wrvu: 1.92 },
  { cpt: '99395', category: 'Preventive', label: 'Periodic preventive medicine, established 18 to 39 yrs', wrvu: 1.50 },
  { cpt: '99396', category: 'Preventive', label: 'Periodic preventive medicine, established 40 to 64 yrs', wrvu: 1.60 },
  // Inpatient / Hospitalist & Critical Care
  { cpt: '99221', category: 'Inpatient & Critical Care', label: 'Initial hospital care, straightforward/low', wrvu: 2.00 },
  { cpt: '99222', category: 'Inpatient & Critical Care', label: 'Initial hospital care, moderate MDM', wrvu: 2.61 },
  { cpt: '99223', category: 'Inpatient & Critical Care', label: 'Initial hospital care, high MDM', wrvu: 3.86 },
  { cpt: '99231', category: 'Inpatient & Critical Care', label: 'Subsequent hospital care, straightforward/low', wrvu: 1.00 },
  { cpt: '99232', category: 'Inpatient & Critical Care', label: 'Subsequent hospital care, moderate MDM', wrvu: 1.59 },
  { cpt: '99233', category: 'Inpatient & Critical Care', label: 'Subsequent hospital care, high MDM', wrvu: 2.40 },
  { cpt: '99238', category: 'Inpatient & Critical Care', label: 'Hospital discharge day management, 30 min or less', wrvu: 1.50 },
  { cpt: '99239', category: 'Inpatient & Critical Care', label: 'Hospital discharge day management, more than 30 min', wrvu: 2.15 },
  { cpt: '99291', category: 'Inpatient & Critical Care', label: 'Critical care, evaluation and management, first 30 to 74 min', wrvu: 4.50 },
  // Emergency Department
  { cpt: '99283', category: 'Emergency', label: 'Emergency dept visit, low MDM', wrvu: 1.60 },
  { cpt: '99284', category: 'Emergency', label: 'Emergency dept visit, moderate MDM', wrvu: 2.74 },
  { cpt: '99285', category: 'Emergency', label: 'Emergency dept visit, high MDM', wrvu: 4.00 },
  // Common Outpatient / Urgent Care / Derm / Ortho Procedures
  { cpt: '11102', category: 'Procedures', label: 'Tangential skin biopsy, single lesion', wrvu: 0.64 },
  { cpt: '17000', category: 'Procedures', label: 'Destruction of premalignant lesion, first lesion', wrvu: 0.61 },
  { cpt: '10060', category: 'Procedures', label: 'Incision and drainage of abscess, simple or single', wrvu: 1.22 },
  { cpt: '12001', category: 'Procedures', label: 'Simple repair of superficial wound, 2.5 cm or less', wrvu: 0.84 },
  { cpt: '20610', category: 'Procedures', label: 'Arthrocentesis, aspiration and/or injection, major joint', wrvu: 0.79 },
];

export type WrvuSpecialtyPresetId =
  | 'family-practice'
  | 'urgent-care'
  | 'dermatology'
  | 'orthopedics'
  | 'hospitalist';

export interface WrvuSpecialtyPreset {
  id: WrvuSpecialtyPresetId;
  label: string;
  clinicalDaysPerWeek: number;
  workingWeeksPerYear: number;
  /** Daily count per CPT code (editable starting illustration). */
  dailyCounts: Readonly<Record<string, number>>;
}

export const WRVU_SPECIALTY_PRESETS: readonly WrvuSpecialtyPreset[] = [
  {
    id: 'family-practice',
    label: 'Family Practice / Outpatient Primary Care',
    clinicalDaysPerWeek: 4.5,
    workingWeeksPerYear: 46,
    dailyCounts: {
      '99203': 1,
      '99204': 2,
      '99213': 6,
      '99214': 8,
      '99215': 1,
      '99396': 2,
    },
  },
  {
    id: 'urgent-care',
    label: 'Urgent Care (3x12 Shifts)',
    clinicalDaysPerWeek: 3,
    workingWeeksPerYear: 48,
    dailyCounts: {
      '99203': 6,
      '99204': 4,
      '99213': 12,
      '99214': 8,
      '12001': 2,
      '10060': 1,
    },
  },
  {
    id: 'dermatology',
    label: 'Dermatology Clinic & Procedures',
    clinicalDaysPerWeek: 4,
    workingWeeksPerYear: 46,
    dailyCounts: {
      '99203': 5,
      '99213': 14,
      '99214': 5,
      '11102': 6,
      '17000': 8,
    },
  },
  {
    id: 'orthopedics',
    label: 'Orthopedics Outpatient Clinic',
    clinicalDaysPerWeek: 4.5,
    workingWeeksPerYear: 46,
    dailyCounts: {
      '99203': 4,
      '99204': 3,
      '99213': 10,
      '99214': 5,
      '20610': 5,
    },
  },
  {
    id: 'hospitalist',
    label: 'Hospitalist / Acute Inpatient (7-on / 7-off)',
    clinicalDaysPerWeek: 3.5,
    workingWeeksPerYear: 52,
    dailyCounts: {
      '99222': 1,
      '99223': 2,
      '99232': 6,
      '99233': 4,
      '99239': 2,
      '99291': 0.5,
    },
  },
];

export interface WrvuCalculationInputs {
  dailyCounts: Readonly<Record<string, number>>;
  clinicalDaysPerWeek: number;
  workingWeeksPerYear: number;
  baseSalary: number;
  annualWrvuThreshold: number;
  conversionRatePerWrvu: number;
}

export interface WrvuCalculationResult {
  clinicalDaysPerYear: number;
  dailyEncounters: number;
  dailyWrvus: number;
  weeklyWrvus: number;
  annualWrvus: number;
  averageWrvuPerEncounter: number;
  bonusEligibleWrvus: number;
  annualProductivityBonus: number;
  totalAnnualCashComp: number;
  effectiveDollarsPerWrvu: number;
  /** Daily encounters at the current CPT wRVU mix needed to reach the bonus threshold. */
  breakEvenDailyEncountersForThreshold: number;
}

const WRVU_BY_CPT: ReadonlyMap<string, number> = new Map(CMS_WRVU_TABLE.map((c) => [c.cpt, c.wrvu]));

export function computeWrvuCompensation(inputs: WrvuCalculationInputs): WrvuCalculationResult {
  const daysWk = Math.min(7, Math.max(0, inputs.clinicalDaysPerWeek));
  const weeksYr = Math.min(52, Math.max(0, inputs.workingWeeksPerYear));
  const clinicalDaysPerYear = daysWk * weeksYr;

  let dailyEncounters = 0;
  let dailyWrvus = 0;
  for (const [cpt, rawCount] of Object.entries(inputs.dailyCounts)) {
    const count = Math.max(0, Number(rawCount) || 0);
    const unit = WRVU_BY_CPT.get(cpt) ?? 0;
    dailyEncounters += count;
    dailyWrvus += count * unit;
  }

  const weeklyWrvus = dailyWrvus * daysWk;
  const annualWrvus = dailyWrvus * clinicalDaysPerYear;
  const averageWrvuPerEncounter = dailyEncounters > 0 ? dailyWrvus / dailyEncounters : 0;

  const base = Math.max(0, inputs.baseSalary);
  const threshold = Math.max(0, inputs.annualWrvuThreshold);
  const rate = Math.max(0, inputs.conversionRatePerWrvu);

  const bonusEligibleWrvus = Math.max(0, annualWrvus - threshold);
  const annualProductivityBonus = bonusEligibleWrvus * rate;
  const totalAnnualCashComp = base + annualProductivityBonus;
  const effectiveDollarsPerWrvu = annualWrvus > 0 ? totalAnnualCashComp / annualWrvus : 0;

  const breakEvenDailyEncountersForThreshold =
    clinicalDaysPerYear > 0 && averageWrvuPerEncounter > 0
      ? threshold / (clinicalDaysPerYear * averageWrvuPerEncounter)
      : 0;

  return {
    clinicalDaysPerYear,
    dailyEncounters,
    dailyWrvus,
    weeklyWrvus,
    annualWrvus,
    averageWrvuPerEncounter,
    bonusEligibleWrvus,
    annualProductivityBonus,
    totalAnnualCashComp,
    effectiveDollarsPerWrvu,
    breakEvenDailyEncountersForThreshold,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 2023+ AMA OUTPATIENT E/M LEVELING CALCULATOR (99202 TO 99215)
// ═══════════════════════════════════════════════════════════════════════════

export type EmPatientType = 'established' | 'new';
export type MdmComplexity = 'straightforward' | 'low' | 'moderate' | 'high';

export interface MdmElementOption {
  level: MdmComplexity;
  rank: 2 | 3 | 4 | 5;
  title: string;
  examples: string;
}

export const MDM_PROBLEMS_OPTIONS: readonly MdmElementOption[] = [
  {
    level: 'straightforward',
    rank: 2,
    title: 'Minimal (1 self-limited or minor problem)',
    examples: 'Uncomplicated viral URI, minor abrasion, suture removal.',
  },
  {
    level: 'low',
    rank: 3,
    title: 'Low (2+ minor, 1 stable chronic, or 1 acute uncomplicated)',
    examples: '1 stable hypertension visit, uncomplicated cystitis, acute ankle sprain.',
  },
  {
    level: 'moderate',
    rank: 4,
    title: 'Moderate (1+ chronic w/ exacerbation, 2+ stable chronic, or 1 undiagnosed new problem)',
    examples: '2+ stable chronic conditions (HTN + DM2), asthma exacerbation, new breast lump workup, acute illness w/ systemic symptoms.',
  },
  {
    level: 'high',
    rank: 5,
    title: 'High (1+ chronic w/ severe exacerbation, or acute illness posing threat to life/bodily function)',
    examples: 'Severe COPD exacerbation, acute chest pain/PE rule-out, acute pyelonephritis w/ sepsis concern.',
  },
];

export const MDM_DATA_OPTIONS: readonly MdmElementOption[] = [
  {
    level: 'straightforward',
    rank: 2,
    title: 'Minimal or None',
    examples: 'No external records, tests, or independent interpretations ordered or reviewed.',
  },
  {
    level: 'low',
    rank: 3,
    title: 'Limited (Meet 1 of 2 categories)',
    examples: 'Combination of 2 unique tests/external notes reviewed or ordered (e.g. CBC + CMP), OR assessment requiring an independent historian.',
  },
  {
    level: 'moderate',
    rank: 4,
    title: 'Moderate (Meet 1 of 3 categories)',
    examples: 'Any 3 from external notes/unique tests/independent historian; OR independent interpretation of a test performed by another provider; OR discussion of management with external clinician.',
  },
  {
    level: 'high',
    rank: 5,
    title: 'Extensive (Meet 2 of 3 categories)',
    examples: 'Meets at least 2 of the Moderate data categories (e.g. 3+ tests/notes PLUS discussion of management with an external specialist or independent radiograph interpretation).',
  },
];

export const MDM_RISK_OPTIONS: readonly MdmElementOption[] = [
  {
    level: 'straightforward',
    rank: 2,
    title: 'Minimal risk of morbidity',
    examples: 'Rest, gargles, superficial elastic bandages, reassurance.',
  },
  {
    level: 'low',
    rank: 3,
    title: 'Low risk of morbidity',
    examples: 'Over-the-counter medications, physical or occupational therapy, minor superficial procedure without identified risk factors.',
  },
  {
    level: 'moderate',
    rank: 4,
    title: 'Moderate risk of morbidity',
    examples: 'Prescription drug management (initiating, titrating, or continuing Rx), minor surgery w/ risk factors, elective major surgery without risk factors, or SDOH significantly limiting diagnosis/treatment.',
  },
  {
    level: 'high',
    rank: 5,
    title: 'High risk of morbidity',
    examples: 'Drug therapy requiring intensive monitoring for toxicity, decision regarding hospitalization or ED escalation, decision regarding emergency major surgery, or DNR/de-escalation due to poor prognosis.',
  },
];

export interface EmLevelResult {
  patientType: EmPatientType;
  mdmOverallComplexity: MdmComplexity;
  mdmCode: string;
  mdmWrvu: number;
  timeMinutes: number;
  timeCode: string | null;
  timeWrvu: number;
  recommendedCode: string;
  recommendedMethod: 'MDM (2 of 3 elements)' | 'Total Time on Date of Encounter' | 'Tie (MDM & Time agree)' | 'Below minimum time (use MDM)';
  recommendedWrvu: number;
  prolongedCommercial99417Units: number;
  prolongedMedicareG2212Units: number;
  nextTimeTierHint: string;
}

const RANK_TO_COMPLEXITY: Record<number, MdmComplexity> = {
  2: 'straightforward',
  3: 'low',
  4: 'moderate',
  5: 'high',
};

const COMPLEXITY_TO_RANK: Record<MdmComplexity, 2 | 3 | 4 | 5> = {
  straightforward: 2,
  low: 3,
  moderate: 4,
  high: 5,
};

function codeForRank(patientType: EmPatientType, rank: number): string {
  const prefix = patientType === 'new' ? '9920' : '9921';
  const clamped = Math.min(5, Math.max(2, rank));
  return `${prefix}${clamped}`;
}

function rankByTime(patientType: EmPatientType, minutes: number): { rank: number | null; nextHint: string; c99417: number; g2212: number } {
  const m = Math.max(0, Math.floor(minutes));
  if (patientType === 'established') {
    if (m < 10) return { rank: null, nextHint: `${10 - m} more min reaches 99212 (10 to 19 min)`, c99417: 0, g2212: 0 };
    if (m <= 19) return { rank: 2, nextHint: `${20 - m} more min reaches 99213 (20 to 29 min)`, c99417: 0, g2212: 0 };
    if (m <= 29) return { rank: 3, nextHint: `${30 - m} more min reaches 99214 (30 to 39 min)`, c99417: 0, g2212: 0 };
    if (m <= 39) return { rank: 4, nextHint: `${40 - m} more min reaches 99215 (40 to 54 min)`, c99417: 0, g2212: 0 };
    // 99215 is 40 to 54 min.
    // AMA 99417: 15 full minutes beyond minimum of 99215? Wait: since 2023/2024 CPT, 99417 starts at 55 min (15 min beyond 40? No: CPT 99417 table lists 55 to 69 min = 1 unit; CMS G2212 starts 15 full min beyond max of 99215: 54 + 15 = 69 min!).
    const c99417 = m >= 55 ? Math.floor((m - 40) / 15) : 0;
    const g2212 = m >= 69 ? Math.floor((m - 54) / 15) : 0;
    const nextHint =
      m < 55
        ? `${55 - m} more min reaches CPT 99417 prolonged threshold (55 min); Medicare G2212 starts at 69 min`
        : m < 69
          ? `Meets CPT 99417 (${c99417} unit); ${69 - m} more min reaches Medicare G2212 threshold (69 min)`
          : `Meets both CPT 99417 (${c99417} unit) and Medicare G2212 (${g2212} unit)`;
    return { rank: 5, nextHint, c99417, g2212 };
  }

  // New patient: 99202 (15 to 29), 99203 (30 to 44), 99204 (45 to 59), 99205 (60 to 74)
  if (m < 15) return { rank: null, nextHint: `${15 - m} more min reaches 99202 (15 to 29 min)`, c99417: 0, g2212: 0 };
  if (m <= 29) return { rank: 2, nextHint: `${30 - m} more min reaches 99203 (30 to 44 min)`, c99417: 0, g2212: 0 };
  if (m <= 44) return { rank: 3, nextHint: `${45 - m} more min reaches 99204 (45 to 59 min)`, c99417: 0, g2212: 0 };
  if (m <= 59) return { rank: 4, nextHint: `${60 - m} more min reaches 99205 (60 to 74 min)`, c99417: 0, g2212: 0 };
  const c99417 = m >= 75 ? Math.floor((m - 60) / 15) : 0;
  const g2212 = m >= 89 ? Math.floor((m - 74) / 15) : 0;
  const nextHint =
    m < 75
      ? `${75 - m} more min reaches CPT 99417 prolonged threshold (75 min); Medicare G2212 starts at 89 min`
      : m < 89
        ? `Meets CPT 99417 (${c99417} unit); ${89 - m} more min reaches Medicare G2212 threshold (89 min)`
        : `Meets both CPT 99417 (${c99417} unit) and Medicare G2212 (${g2212} unit)`;
  return { rank: 5, nextHint, c99417, g2212 };
}

export function computeEmLevel(params: {
  patientType: EmPatientType;
  problems: MdmComplexity;
  data: MdmComplexity;
  risk: MdmComplexity;
  totalMinutes: number;
}): EmLevelResult {
  const ranks = [
    COMPLEXITY_TO_RANK[params.problems],
    COMPLEXITY_TO_RANK[params.data],
    COMPLEXITY_TO_RANK[params.risk],
  ].sort((a, b) => b - a);
  // 2-of-3 rule: the second-highest rank is the highest level met or exceeded by at least 2 of the 3 elements!
  const mdmRank = ranks[1];
  const mdmOverallComplexity = RANK_TO_COMPLEXITY[mdmRank];
  const mdmCode = codeForRank(params.patientType, mdmRank);
  const mdmWrvu = WRVU_BY_CPT.get(mdmCode) ?? 0;

  const timeEval = rankByTime(params.patientType, params.totalMinutes);
  const timeCode = timeEval.rank !== null ? codeForRank(params.patientType, timeEval.rank) : null;
  const timeWrvu = timeCode ? (WRVU_BY_CPT.get(timeCode) ?? 0) : 0;

  let recommendedCode = mdmCode;
  let recommendedMethod: EmLevelResult['recommendedMethod'] = 'MDM (2 of 3 elements)';
  if (timeEval.rank === null) {
    recommendedCode = mdmCode;
    recommendedMethod = 'Below minimum time (use MDM)';
  } else if (timeEval.rank > mdmRank) {
    recommendedCode = timeCode!;
    recommendedMethod = 'Total Time on Date of Encounter';
  } else if (timeEval.rank === mdmRank) {
    recommendedCode = mdmCode;
    recommendedMethod = 'Tie (MDM & Time agree)';
  }

  return {
    patientType: params.patientType,
    mdmOverallComplexity,
    mdmCode,
    mdmWrvu,
    timeMinutes: Math.max(0, Math.floor(params.totalMinutes)),
    timeCode,
    timeWrvu,
    recommendedCode,
    recommendedMethod,
    recommendedWrvu: WRVU_BY_CPT.get(recommendedCode) ?? 0,
    prolongedCommercial99417Units: timeEval.c99417,
    prolongedMedicareG2212Units: timeEval.g2212,
    nextTimeTierHint: timeEval.nextHint,
  };
}

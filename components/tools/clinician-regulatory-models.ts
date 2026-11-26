/**
 * Pure regulatory, education, and contract-exit models for Clinician & Student tools:
 *  1. 51-Jurisdiction Prescriptive Authority, Schedule II to V & State CSR/CDS Lookup
 *  2. Student Clinical Rotation Hours Tracker & ANCC vs AANPCB Certification Planner
 *  3. State Healthcare Non-Compete Lookup & Claims-Made Malpractice Tail Calculator
 *
 * Practice authority tiers and state details read directly from
 * lib/state-practice-authority.ts so AANP classifications never drift.
 */
import { brand } from '@/config/brand';
import {
  STATE_PRACTICE_AUTHORITY,
  getAuthorityLabel,
  type PracticeAuthority,
} from '@/lib/state-practice-authority';

// ═══════════════════════════════════════════════════════════════════════════
// 1. 51-JURISDICTION PRESCRIPTIVE AUTHORITY & CONTROLLED SUBSTANCES LOOKUP
// ═══════════════════════════════════════════════════════════════════════════

export type Schedule2Pathway =
  | 'independent_upon_licensure'
  | 'independent_after_transition'
  | 'collaborative_or_delegated'
  | 'schedule_2_specific_limits';

export interface StatePrescriptiveRule {
  state: string;
  authority: PracticeAuthority;
  authorityLabel: string;
  /** Sourced verbatim from lib/state-practice-authority.ts. */
  practiceDetails: string;
  /** Whether the state requires a separate State Controlled Substance Registration (CSR / CDS / BNDD) in addition to BON APRN + Federal DEA. */
  separateStateCsrRequired: boolean;
  stateCsrAgencyLabel: string;
  schedule2Pathway: Schedule2Pathway;
  scheduleSummary: string;
}

/**
 * Jurisdictions that require a separate state-level controlled-substance
 * registration (CSR, CDS, BNDD, OBNND, or MCSR) in addition to the APRN license
 * and federal DEA registration.
 */
const SEPARATE_STATE_CSR_AGENCIES: Readonly<Record<string, string>> = {
  Alabama: 'Alabama Board of Medical Examiners / QACSC (for Schedule III to V; separate LPSP for Schedule II)',
  Connecticut: 'Connecticut DCP Controlled Substance Practitioner Registration',
  Delaware: 'Delaware Office of Controlled Substances CSR',
  'District of Columbia': 'DC Health Controlled Substance Registration',
  Hawaii: 'Hawaii Department of Public Safety Narcotics Enforcement Division CSR',
  Idaho: 'Idaho Board of Pharmacy Controlled Substance Registration (check current BOP integration)',
  Illinois: 'Illinois IDFPR Controlled Substances License',
  Indiana: 'Indiana Professional Licensing Agency CSR',
  Iowa: 'Iowa Board of Pharmacy Controlled Substances Act Registration',
  Louisiana: 'Louisiana Board of Pharmacy CDS License',
  Maryland: 'Maryland Office of Controlled Substances Administration (OCSA) CDS',
  Massachusetts: 'Massachusetts Controlled Substances Registration (MCSR)',
  Michigan: 'Michigan LARA Controlled Substance License',
  Missouri: 'Missouri Bureau of Narcotics and Dangerous Drugs (BNDD) Registration',
  Nevada: 'Nevada State Board of Pharmacy Prescribing Registration',
  'New Jersey': 'New Jersey Consumer Affairs CDS Registration',
  'New Mexico': 'New Mexico Board of Pharmacy Controlled Substance Registration',
  Oklahoma: 'Oklahoma Bureau of Narcotics and Dangerous Drugs (OBNDD) Registration',
  'Rhode Island': 'Rhode Island Department of Health CSR',
  'South Carolina': 'South Carolina DHEC Bureau of Drug Control Registration',
  'South Dakota': 'South Dakota Department of Health Controlled Substance Registration',
  Utah: 'Utah DOPL Controlled Substance License',
  Wyoming: 'Wyoming State Board of Pharmacy Controlled Substance Registration',
};

const TRANSITION_STATES = new Set([
  'Colorado',
  'Connecticut',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Minnesota',
  'Nebraska',
  'Nevada',
  'New York',
  'South Dakota',
  'Vermont',
]);

const SCHEDULE_2_NUANCE_NOTES: Readonly<Record<string, string>> = {
  Arkansas:
    'Schedule III to V under collaborative practice agreement (or independent certificate after 6,240 hours); Schedule II hydrocodone/stimulant prescribing carries narrow statutory day-supply and protocol conditions. Confirm current rules with the Arkansas State Board of Nursing.',
  Georgia:
    'Prescribing under nurse protocol agreement; Schedule II prescribing is sharply restricted under Georgia nurse protocol law (verify exact formulary exceptions with the Georgia Composite Medical Board and Board of Nursing).',
  Oklahoma:
    'Schedules III to V under written physician supervision (or independent prescriptive authority after 6,240 supervised hours); Oklahoma formulary excludes Schedule II drugs from routine APRN prescribing.',
  Texas:
    'Schedules III to V under a Prescriptive Authority Agreement (PAA); Schedule II prescribing in Texas is restricted primarily to qualifying hospital facility/emergency/hospice settings rather than general outpatient clinics.',
  Alabama:
    'Requires a Qualified Alabama Controlled Substances Certificate (QACSC) for Schedules III to V and an additional Limited Purpose Schedule II Permit (LPSP) for approved Schedule II medications.',
  Florida:
    'Schedules II to V require controlled-substance CE and protocol compliance; Schedule II for acute pain carries statutory day-supply limits (and behavioral or pediatric Schedule II caveats under Florida law).',
  Kentucky:
    'Separate CAPA-NS (legend drugs) and CAPA-CS (controlled substances) collaborative agreements, with statutory day-supply limits on Schedule II and III controlled substances; eligible to apply to discontinue agreements after 4 years.',
  'West Virginia':
    'Schedules III to V plus limited Schedule II supply rules; confirm current formulary caps and 3-year collaborative removal pathway with the West Virginia RN Board.',
};

export const PRESCRIPTIVE_AUTHORITY_RULES: readonly StatePrescriptiveRule[] = Object.entries(STATE_PRACTICE_AUTHORITY)
  .map(([state, info]) => {
    const csrAgency = SEPARATE_STATE_CSR_AGENCIES[state] ?? null;
    const customNote = SCHEDULE_2_NUANCE_NOTES[state];
    let pathway: Schedule2Pathway = 'collaborative_or_delegated';
    if (customNote) {
      pathway = 'schedule_2_specific_limits';
    } else if (info.authority === 'full') {
      pathway = TRANSITION_STATES.has(state) ? 'independent_after_transition' : 'independent_upon_licensure';
    }

    const defaultScheduleSummary =
      pathway === 'independent_upon_licensure'
        ? `Full Schedule II to V prescriptive authority under ${brand.niche.short} board licensure and active federal DEA registration${csrAgency ? ' plus state CSR' : ''}.`
        : pathway === 'independent_after_transition'
          ? `Schedule II to V authority transitions to independent prescribing once ${state}'s statutory transition/mentorship hours are completed${csrAgency ? ' (requires state CSR + federal DEA)' : ' (requires active BON authority + federal DEA)'}.`
          : `Schedule II to V controlled-substance prescribing operates under ${state}'s collaborative, supervisory, or delegated protocol framework (with experience pathways where noted below).`;

    return {
      state,
      authority: info.authority,
      authorityLabel: getAuthorityLabel(info.authority),
      practiceDetails: info.details,
      separateStateCsrRequired: csrAgency !== null,
      stateCsrAgencyLabel: csrAgency ?? `${state} Board of Nursing prescriptive authority + federal DEA (no separate state CSR agency)`,
      schedule2Pathway: pathway,
      scheduleSummary: customNote ?? defaultScheduleSummary,
    };
  })
  .sort((a, b) => a.state.localeCompare(b.state));

// ═══════════════════════════════════════════════════════════════════════════
// 2. CLINICAL ROTATION HOURS TRACKER & ANCC VS AANPCB PLANNER
// ═══════════════════════════════════════════════════════════════════════════

export type RotationDomain =
  | 'Adult & Chronic Care'
  | 'Pediatrics & Adolescent'
  | "Women's Health & Perinatal"
  | 'Geriatrics & Complex Care'
  | 'Acute / Urgent / Specialty';

export const ROTATION_DOMAINS: readonly RotationDomain[] = [
  'Adult & Chronic Care',
  'Pediatrics & Adolescent',
  "Women's Health & Perinatal",
  'Geriatrics & Complex Care',
  'Acute / Urgent / Specialty',
];

export interface ClinicalLogEntry {
  id: string;
  dateIso: string;
  domain: RotationDomain;
  siteLabel: string;
  preceptorInitials: string;
  directHours: number;
}

export interface ClinicalHoursProgress {
  targetTotalHours: number;
  loggedDirectHours: number;
  remainingHours: number;
  completionPct: number;
  byDomain: Readonly<Record<RotationDomain, number>>;
  estimatedWeeksToFinish: number;
}

export function computeClinicalHoursProgress(
  entries: readonly ClinicalLogEntry[],
  targetTotalHours: number,
  plannedWeeklyHours: number,
): ClinicalHoursProgress {
  const target = Math.max(100, targetTotalHours);
  const byDomain: Record<RotationDomain, number> = {
    'Adult & Chronic Care': 0,
    'Pediatrics & Adolescent': 0,
    "Women's Health & Perinatal": 0,
    'Geriatrics & Complex Care': 0,
    'Acute / Urgent / Specialty': 0,
  };

  let total = 0;
  for (const e of entries) {
    const h = Math.max(0, Number(e.directHours) || 0);
    total += h;
    if (e.domain in byDomain) {
      byDomain[e.domain] += h;
    }
  }

  const remaining = Math.max(0, target - total);
  const pct = Math.min(100, Math.round((total / target) * 1000) / 10);
  const wk = Math.max(0, plannedWeeklyHours);
  const weeks = wk > 0 ? Math.ceil(remaining / wk) : 0;

  return {
    targetTotalHours: target,
    loggedDirectHours: Math.round(total * 10) / 10,
    remainingHours: Math.round(remaining * 10) / 10,
    completionPct: pct,
    byDomain,
    estimatedWeeksToFinish: weeks,
  };
}

export function formatClinicalHoursCsv(entries: readonly ClinicalLogEntry[]): string {
  const escape = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
  const header = ['Date', 'Rotation Domain', 'Site / Clinic', 'Preceptor Initials', 'Direct Patient Hours'].join(',');
  const rows = entries.map((e) =>
    [e.dateIso, e.domain, e.siteLabel, e.preceptorInitials, e.directHours].map(escape).join(','),
  );
  return [header, ...rows].join('\n');
}

export interface CertBoardComparison {
  board: 'ANCC' | 'AANPCB';
  fullName: string;
  credentials: string;
  minimumDirectGradHours: number;
  renewalCycleYears: number;
  renewalCeHours: number;
  pharmacologyCeHours: number;
  practiceHoursOption: string;
  focusSummary: string;
}

export const CERTIFICATION_BOARD_RULES: readonly CertBoardComparison[] = [
  {
    board: 'ANCC',
    fullName: 'American Nurses Credentialing Center',
    credentials: 'FNP-BC, AGPCNP-BC, AGACNP-BC',
    minimumDirectGradHours: 500,
    renewalCycleYears: 5,
    renewalCeHours: 75,
    pharmacologyCeHours: 25,
    practiceHoursOption:
      '75 CH (including 25 pharmacotherapeutic CH) PLUS 1 of 8 renewal categories (such as 1,000 clinical practice hours, academic credits, precepting 120+ student hours, publication, or re-examination).',
    focusSummary:
      'Covers clinical diagnosis and management alongside professional role, health policy, quality improvement, and evidence-based practice.',
  },
  {
    board: 'AANPCB',
    fullName: 'American Academy of Nurse Practitioners Certification Board',
    credentials: 'FNP-C, AGNP-C, ENP-C',
    minimumDirectGradHours: 500,
    renewalCycleYears: 5,
    renewalCeHours: 100,
    pharmacologyCeHours: 25,
    practiceHoursOption:
      '1,000 clinical practice hours in population focus PLUS 100 contact hours of advanced CE (including 25 pharmacotherapeutic hours) every 5 years, or re-examination. Precepting hours may offset a portion per current AANPCB handbook.',
    focusSummary:
      'Concentrates heavily on direct clinical assessment, differential diagnosis, diagnostic plan, and pharmacologic therapeutics.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 3. HEALTHCARE NON-COMPETE & CLAIMS-MADE MALPRACTICE TAIL CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════

export type NonCompeteStatus =
  | 'broad_statutory_ban'
  | 'healthcare_restricted_or_threshold'
  | 'fact_specific_reasonableness';

export interface NonCompeteStateInfo {
  state: string;
  status: NonCompeteStatus;
  badgeLabel: string;
  summary: string;
}

const BROAD_BAN_STATES = new Set(['California', 'Minnesota', 'North Dakota', 'Oklahoma']);

const HEALTHCARE_RESTRICTED_NOTES: Readonly<Record<string, string>> = {
  Colorado:
    'Colorado restricts non-competes to highly compensated workers meeting annual statutory earnings thresholds and protects healthcare providers’ right to notify continuing patients of new contact details (subject to statutory damages formulas).',
  Connecticut:
    'Connecticut caps healthcare non-compete duration (1 year) and geographic radius (15 miles from primary site) and restricts enforceability when an employer terminates without cause.',
  Delaware:
    'Delaware voids covenants prohibiting healthcare clinicians from practicing, though tailored liquidated-damages provisions in qualifying agreements require legal review.',
  'District of Columbia':
    'DC bans non-competes for most employees below the statutory medical-specialist/highly-compensated threshold and enforces strict written notice timings.',
  Florida:
    'Florida generally enforces written non-competes under Fla. Stat. 542.335, with narrow statutory healthcare monopoly exceptions in underserved counties.',
  Illinois:
    'Illinois Freedom to Work Act sets inflation-adjusted minimum earnings thresholds, mandatory 14-day pre-signing review notice, and adequate consideration rules.',
  Indiana:
    'Indiana restricts primary-care physician non-competes and expanded statutory buyout/termination protections across healthcare practitioner agreements.',
  Iowa:
    'Iowa enacted statutory limits on healthcare employment agency and certain practitioner restrictive covenants; review direct hospital/clinic employment exemptions with counsel.',
  Kentucky:
    'Kentucky restricts healthcare staffing agency non-competes while evaluating direct-employment covenants on geographic and patient-interest reasonableness.',
  Louisiana:
    'Louisiana La. R.S. 23:921 strictly requires naming specific parishes/municipalities and caps duration (with additional statutory limits enacted for physicians/healthcare providers).',
  Maine:
    'Maine imposes statutory wage floors, advance disclosure in the job offer, and delayed effective periods before a non-compete takes effect.',
  Maryland:
    'Maryland voids non-competes for healthcare clinicians providing direct patient care who earn $350,000 or less in total annual compensation, and caps duration/geography above that threshold.',
  Massachusetts:
    'Massachusetts explicitly prohibits non-compete clauses for nurses (M.G.L. c. 112, s. 74D) and physicians, making post-employment clinical practice bans unenforceable against APRNs.',
  'New Hampshire':
    'New Hampshire voids non-compete agreements for nurses and podiatrists/physicians upon contract renewal or termination under statutory practitioner protections.',
  'New Mexico':
    'New Mexico prohibits non-compete provisions restricting clinical healthcare practitioners (including certified nurse practitioners) upon termination of employment.',
  Oregon:
    'Oregon requires advance written pre-hire notice, statutory compensation minimums, and limits post-employment restriction to 12 months.',
  Pennsylvania:
    'Pennsylvania’s Fair Contracting for Health Care Practitioners Act (effective Jan 1, 2025) restricts healthcare practitioner non-competes over 1 year and voids them when the practitioner is dismissed by the employer.',
  'Rhode Island':
    'Rhode Island enacted statutory bans/restrictions on APRN and physician non-compete covenants in clinical employment agreements.',
  'South Dakota':
    'South Dakota restricts non-compete agreements for healthcare practitioners (including nurse practitioners) practicing clinical care.',
  Texas:
    'Texas Bus. & Com. Code 15.50 sets strict buyout, patient-list access, and medical-records rules for physicians, while APRN covenants are scrutinized on scope, radius, and consideration.',
  Virginia:
    'Virginia bans non-competes for lower-wage/non-exempt categories and scrutinizes clinical geographic/functional breadth narrowly against the employer.',
  Washington:
    'Washington voids employee non-competes below an annually indexed W-2 earnings threshold (~$123,000+ employee / ~$308,000+ contractor, adjusted yearly) and requires separate consideration if presented after hire.',
  'West Virginia':
    'West Virginia restricts duration and mile radius on clinical restrictive covenants and voids them upon employer-initiated termination without cause.',
};

export const NON_COMPETE_STATE_RULES: readonly NonCompeteStateInfo[] = Object.keys(STATE_PRACTICE_AUTHORITY)
  .sort((a, b) => a.localeCompare(b))
  .map((state) => {
    if (BROAD_BAN_STATES.has(state)) {
      return {
        state,
        status: 'broad_statutory_ban',
        badgeLabel: 'Broad Statutory Non-Compete Ban',
        summary: `${state} generally voids post-employment non-compete clauses by statute across professions (narrow sale-of-business exceptions apply). Non-solicitation and confidentiality clauses still require review.`,
      };
    }
    const hc = HEALTHCARE_RESTRICTED_NOTES[state];
    if (hc) {
      return {
        state,
        status: 'healthcare_restricted_or_threshold',
        badgeLabel: 'Healthcare Cap / Statutory Threshold',
        summary: hc,
      };
    }
    return {
      state,
      status: 'fact_specific_reasonableness',
      badgeLabel: 'Common-Law Reasonableness Test',
      summary: `${state} evaluates clinical non-competes case by case on duration, mile radius around actual practice sites, legitimate business interest, and public access to care. Always have a local healthcare employment attorney review before signing.`,
    };
  });

export interface TailCoverageInputs {
  policyType: 'claims_made' | 'occurrence';
  matureAnnualPremium: number;
  yearsOnPolicy: 1 | 2 | 3 | 4 | 5;
  tailMultiplier: number;
  employerPaysTailPct: number;
  contractBuyoutOrRelocationCost: number;
  marginalTaxRatePct: number;
}

export interface TailCoverageResult {
  stepFactorPct: number;
  estimatedCurrentAnnualPremium: number;
  grossTailPremium: number;
  employerCoveredDollars: number;
  clinicianOutOfPocketTail: number;
  totalAfterTaxExitCost: number;
  grossedUpSigningBonusCounterAsk: number;
}

const CLAIMS_MADE_STEP_FACTORS: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 0.35,
  2: 0.60,
  3: 0.80,
  4: 0.92,
  5: 1.00,
};

export function computeTailCoverage(raw: TailCoverageInputs): TailCoverageResult {
  if (raw.policyType === 'occurrence') {
    const buyout = Math.max(0, raw.contractBuyoutOrRelocationCost);
    const taxRate = Math.min(0.55, Math.max(0, raw.marginalTaxRatePct / 100));
    return {
      stepFactorPct: 100,
      estimatedCurrentAnnualPremium: Math.max(0, raw.matureAnnualPremium),
      grossTailPremium: 0,
      employerCoveredDollars: 0,
      clinicianOutOfPocketTail: 0,
      totalAfterTaxExitCost: buyout,
      grossedUpSigningBonusCounterAsk: taxRate < 1 ? buyout / (1 - taxRate) : buyout,
    };
  }

  const mature = Math.max(0, raw.matureAnnualPremium);
  const step = CLAIMS_MADE_STEP_FACTORS[raw.yearsOnPolicy] ?? 1;
  const currentAnnual = mature * step;
  const mult = Math.max(0.5, raw.tailMultiplier);

  // Tail is priced off the expiring/mature step-rated premium (Year 1 exits carry a smaller tail than mature Year 5+ exits)
  const tailBaseFactor = Math.min(1, step + 0.15);
  const grossTailPremium = mature * tailBaseFactor * mult;

  const empShare = Math.min(100, Math.max(0, raw.employerPaysTailPct)) / 100;
  const employerCoveredDollars = grossTailPremium * empShare;
  const clinicianOutOfPocketTail = grossTailPremium - employerCoveredDollars;

  const totalAfterTaxExitCost = clinicianOutOfPocketTail + Math.max(0, raw.contractBuyoutOrRelocationCost);
  const taxRate = Math.min(0.55, Math.max(0, raw.marginalTaxRatePct / 100));
  const grossedUpSigningBonusCounterAsk = taxRate < 1 ? totalAfterTaxExitCost / (1 - taxRate) : totalAfterTaxExitCost;

  return {
    stepFactorPct: Math.round(step * 100),
    estimatedCurrentAnnualPremium: currentAnnual,
    grossTailPremium,
    employerCoveredDollars,
    clinicianOutOfPocketTail,
    totalAfterTaxExitCost,
    grossedUpSigningBonusCounterAsk,
  };
}

/**
 * Setting × State pSEO Configuration
 * 
 * Defines each "setting" category (remote, telehealth, inpatient, outpatient, travel)
 * and the Prisma `where` clause used to filter jobs for that setting.
 * A shared template factory uses these configs to render ~255 state pages.
 */

// ─── State Utilities ───────────────────────────────────────────────────────────

export const STATE_CODES: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
};

export const CODE_TO_STATE: Record<string, string> = Object.entries(STATE_CODES)
  .reduce((acc, [state, code]) => ({ ...acc, [code]: state }), {} as Record<string, string>);

export const URL_TO_STATE: Record<string, string> = Object.keys(STATE_CODES)
  .reduce((acc, state) => {
    const urlFriendly = state.toLowerCase().replace(/\s+/g, '-');
    acc[urlFriendly] = state;
    return acc;
  }, {} as Record<string, string>);

/** Convert a URL slug like "new-york" to the full state name "New York" */
export function resolveStateSlug(slug: string): string | null {
  // Try exact URL match first
  if (URL_TO_STATE[slug]) return URL_TO_STATE[slug];
  // Try state code (e.g. "ny" → "New York")
  const upper = slug.toUpperCase();
  if (CODE_TO_STATE[upper]) return CODE_TO_STATE[upper];
  return null;
}

/** Convert a state name to a URL slug */
export function stateToSlug(stateName: string): string {
  return stateName.toLowerCase().replace(/\s+/g, '-');
}

/** Get all state slugs for generateStaticParams */
export function getAllStateSlugs(): string[] {
  return Object.keys(URL_TO_STATE);
}

// ─── Neighboring States ────────────────────────────────────────────────────────

export const NEIGHBORING_STATES: Record<string, string[]> = {
  'Alabama': ['Florida', 'Georgia', 'Tennessee', 'Mississippi'],
  'Alaska': ['Washington', 'California', 'Oregon'],
  'Arizona': ['California', 'Nevada', 'Utah', 'Colorado', 'New Mexico'],
  'Arkansas': ['Texas', 'Oklahoma', 'Missouri', 'Tennessee', 'Mississippi', 'Louisiana'],
  'California': ['Oregon', 'Nevada', 'Arizona', 'Washington'],
  'Colorado': ['Utah', 'Wyoming', 'Nebraska', 'Kansas', 'Oklahoma', 'New Mexico', 'Arizona'],
  'Connecticut': ['New York', 'Massachusetts', 'Rhode Island'],
  'Delaware': ['Pennsylvania', 'New Jersey', 'Maryland'],
  'District of Columbia': ['Maryland', 'Virginia'],
  'Florida': ['Georgia', 'Alabama'],
  'Georgia': ['Florida', 'Alabama', 'Tennessee', 'North Carolina', 'South Carolina'],
  'Hawaii': ['California', 'Washington', 'Oregon'],
  'Idaho': ['Washington', 'Oregon', 'Montana', 'Wyoming', 'Utah', 'Nevada'],
  'Illinois': ['Wisconsin', 'Indiana', 'Kentucky', 'Missouri', 'Iowa'],
  'Indiana': ['Michigan', 'Ohio', 'Kentucky', 'Illinois'],
  'Iowa': ['Minnesota', 'Wisconsin', 'Illinois', 'Missouri', 'Nebraska', 'South Dakota'],
  'Kansas': ['Nebraska', 'Missouri', 'Oklahoma', 'Colorado'],
  'Kentucky': ['Indiana', 'Ohio', 'West Virginia', 'Virginia', 'Tennessee', 'Missouri', 'Illinois'],
  'Louisiana': ['Texas', 'Arkansas', 'Mississippi'],
  'Maine': ['New Hampshire', 'Massachusetts'],
  'Maryland': ['Pennsylvania', 'Delaware', 'Virginia', 'West Virginia', 'District of Columbia'],
  'Massachusetts': ['New Hampshire', 'Vermont', 'New York', 'Connecticut', 'Rhode Island'],
  'Michigan': ['Ohio', 'Indiana', 'Wisconsin'],
  'Minnesota': ['Wisconsin', 'Iowa', 'South Dakota', 'North Dakota'],
  'Mississippi': ['Louisiana', 'Arkansas', 'Tennessee', 'Alabama'],
  'Missouri': ['Iowa', 'Illinois', 'Kentucky', 'Tennessee', 'Arkansas', 'Oklahoma', 'Kansas', 'Nebraska'],
  'Montana': ['North Dakota', 'South Dakota', 'Wyoming', 'Idaho'],
  'Nebraska': ['South Dakota', 'Iowa', 'Missouri', 'Kansas', 'Colorado', 'Wyoming'],
  'Nevada': ['California', 'Oregon', 'Idaho', 'Utah', 'Arizona'],
  'New Hampshire': ['Maine', 'Vermont', 'Massachusetts'],
  'New Jersey': ['New York', 'Pennsylvania', 'Delaware'],
  'New Mexico': ['Arizona', 'Utah', 'Colorado', 'Oklahoma', 'Texas'],
  'New York': ['Vermont', 'Massachusetts', 'Connecticut', 'New Jersey', 'Pennsylvania'],
  'North Carolina': ['Virginia', 'Tennessee', 'Georgia', 'South Carolina'],
  'North Dakota': ['Montana', 'South Dakota', 'Minnesota'],
  'Ohio': ['Michigan', 'Indiana', 'Kentucky', 'West Virginia', 'Pennsylvania'],
  'Oklahoma': ['Kansas', 'Missouri', 'Arkansas', 'Texas', 'New Mexico', 'Colorado'],
  'Oregon': ['Washington', 'California', 'Nevada', 'Idaho'],
  'Pennsylvania': ['New York', 'New Jersey', 'Delaware', 'Maryland', 'West Virginia', 'Ohio'],
  'Rhode Island': ['Massachusetts', 'Connecticut'],
  'South Carolina': ['North Carolina', 'Georgia'],
  'South Dakota': ['North Dakota', 'Minnesota', 'Iowa', 'Nebraska', 'Wyoming', 'Montana'],
  'Tennessee': ['Kentucky', 'Virginia', 'North Carolina', 'Georgia', 'Alabama', 'Mississippi', 'Arkansas', 'Missouri'],
  'Texas': ['New Mexico', 'Oklahoma', 'Arkansas', 'Louisiana'],
  'Utah': ['Idaho', 'Wyoming', 'Colorado', 'New Mexico', 'Arizona', 'Nevada'],
  'Vermont': ['New Hampshire', 'Massachusetts', 'New York'],
  'Virginia': ['Maryland', 'District of Columbia', 'West Virginia', 'Kentucky', 'Tennessee', 'North Carolina'],
  'Washington': ['Oregon', 'Idaho'],
  'West Virginia': ['Pennsylvania', 'Maryland', 'Virginia', 'Kentucky', 'Ohio'],
  'Wisconsin': ['Michigan', 'Minnesota', 'Iowa', 'Illinois'],
  'Wyoming': ['Montana', 'South Dakota', 'Nebraska', 'Colorado', 'Utah', 'Idaho'],
};

// ─── Setting Configurations ────────────────────────────────────────────────────

export interface SettingConfig {
  /** URL path segment: "remote", "telehealth", etc. */
  slug: string;
  /** Display name: "Remote", "Telehealth", etc. */
  label: string;
  /** Longer display: "Remote NP", "Telehealth NP", etc. */
  fullLabel: string;
  /** Hero subtitle for the state page */
  heroSubtitle: string;
  /** Target salary range for metadata */
  salaryRange: string;
  /** SEO keywords for metadata */
  keywords: string[];
  /** FAQ category key passed to CategoryFAQ component */
  faqCategory: string;
  /**
   * Build the Prisma `where` clause to filter jobs for this setting.
   * `stateName` is the full state name (e.g. "California").
   */
  buildWhere: (stateName: string) => Record<string, unknown>;
  /** Three benefits to show in the hero section */
  benefits: Array<{
    title: string;
    description: string;
    iconName: string; // lucide icon name
  }>;
  /** Tips shown in sidebar */
  tips: string[];
}

/**
 * Build a state-scoped where clause for a given canonical category tag.
 *
 * P9: queries `categoryTags has '<tag>'` for backfilled rows, with the
 * legacy keyword OR matcher as fallback for rows whose categoryTags is
 * still empty (deploy → backfill window). See `withTagFallback` in
 * lib/pseo/category-tagger.ts. Once backfill is complete the fallback
 * is dead code and can be removed.
 *
 * The legacy `keywords` parameter is preserved as a positional `_legacy`
 * for call-site compatibility — it is no longer consulted at query time
 * (the keyword list now lives inside category-tagger.ts RULES).
 */
import { withTagFallback, type CategoryTag } from './category-tagger';

function buildKeywordWhere(_legacy: string[], stateName: string, tag: CategoryTag): Record<string, unknown> {
  return {
    isPublished: true,
    state: { equals: stateName, mode: 'insensitive' },
    ...withTagFallback(tag),
  };
}

// ─── NP specialty / APRN state configs (2026-07 taxonomy migration) ──────────
//
// P1 #5 content pass (2026-07-29): every specialty entry now carries
// bespoke benefits/tips with real occupational texture — the shared
// factory defaults that rendered byte-identical copy across all specialty
// × state page sets were removed (benefits/tips are required inputs now).
// Salary ranges remain broad national figures pending per-board research.
//
// QUERY NOTE: lib/pseo/category-tagger.ts now emits the 42-slug NP taxonomy
// (2026-07 classifier migration), so these buildWhere clauses go through the
// normal withTagFallback() path like every other config: precomputed
// `categoryTags` containment first, legacy keyword fallback only for rows
// whose tags haven't been backfilled yet.

interface NpSpecialtyConfigInput {
  slug: CategoryTag;
  label: string;
  fullLabel: string;
  heroSubtitle: string;
  salaryRange: string;
  keywords: string[];
  /**
   * Bespoke per-specialty benefit cards (P1 #5, 2026-07-29). Required —
   * the previous shared defaults rendered byte-identical benefits/tips
   * across all nine specialty × state page sets.
   */
  benefits: SettingConfig['benefits'];
  /** Bespoke per-specialty sidebar tips (P1 #5, 2026-07-29). Required. */
  tips: string[];
}

function buildNpSpecialtyConfig(input: NpSpecialtyConfigInput): SettingConfig {
  return {
    ...input,
    // FAQ wiring: each specialty slug maps to its builder in
    // lib/pseo/category-faq-data.ts (2026-07 P0 content pass). The psych
    // specialty slug is the one remaining unmapped key — CategoryFAQ renders
    // nothing for it until the niche-copy ratchet ceiling for the FAQ data
    // file sanctions the specialty copy.
    faqCategory: input.slug,
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback(input.slug),
    }),
  };
}

const NP_SPECIALTY_STATE_CONFIGS: Record<string, SettingConfig> = {
  'family-practice': buildNpSpecialtyConfig({
    slug: 'family-practice',
    label: 'Family Practice',
    fullLabel: 'Family Practice NP (FNP)',
    heroSubtitle: 'Family practice nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['family practice nurse practitioner', 'FNP jobs', 'family nurse practitioner'],
    benefits: [
      { title: 'Lifespan Panels', description: 'Care for children, adults, and older adults on one continuity panel — the widest scope of any NP track.', iconName: 'Users' },
      { title: 'Setting Flexibility', description: 'Clinics, FQHCs, urgent care, retail health, and telehealth panels across the state all hire FNPs.', iconName: 'Building2' },
      { title: 'Career Foundation', description: 'Family practice experience underwrites later moves into specialty care, leadership, or independent practice.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Ask about panel size, daily visit expectations, and documentation time',
      'Confirm RVU or quality-bonus structures beyond base salary',
      'FQHC roles may add NHSC loan repayment and PSLF eligibility — ask',
      'Clarify walk-in and same-day coverage expectations',
      'Verify collaborative or supervisory agreement requirements in this state',
    ],
  }),
  'adult-gerontology': buildNpSpecialtyConfig({
    slug: 'adult-gerontology',
    label: 'Adult-Gerontology',
    fullLabel: 'Adult-Gerontology NP (AGNP)',
    heroSubtitle: 'Adult-gerontology nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['adult gerontology nurse practitioner', 'AGNP jobs', 'AGACNP', 'AGPCNP'],
    benefits: [
      { title: 'Two Career Tracks', description: 'Primary care (AGPCNP) clinic panels or acute care (AGACNP) hospital services — both hire across the state.', iconName: 'Activity' },
      { title: 'Aging Demand Curve', description: 'An aging patient population keeps both the primary care and acute care tracks in steady demand.', iconName: 'TrendingUp' },
      { title: 'Complex-Care Depth', description: 'Multimorbidity, polypharmacy, and geriatric syndromes reward strong clinical reasoning.', iconName: 'Lightbulb' },
    ],
    tips: [
      'Match the role to your track — AGPCNP for clinic panels, AGACNP for hospital services',
      'SNF and long-term-care roles vary in facility load — ask how many buildings you cover',
      'Confirm geriatric support resources: pharmacy review, care management, social work',
      'Hospital roles: ask about credentialing timelines and procedure privileges',
      'Verify collaborative agreement requirements for this state',
    ],
  }),
  pediatric: buildNpSpecialtyConfig({
    slug: 'pediatric',
    label: 'Pediatric',
    fullLabel: 'Pediatric NP (PNP)',
    heroSubtitle: 'Pediatric nurse practitioner positions',
    salaryRange: '$105K-145K',
    keywords: ['pediatric nurse practitioner', 'PNP jobs', 'peds NP'],
    benefits: [
      { title: 'Kid-First Practice', description: 'Well-child care, development, and family-centered visits define the day.', iconName: 'Heart' },
      { title: 'Community Reach', description: 'Pediatric clinics, school-based health centers, and children’s hospitals across the state all hire PNPs.', iconName: 'Home' },
      { title: 'Prevention Focus', description: 'Immunization schedules and developmental surveillance anchor the role in prevention.', iconName: 'Shield' },
    ],
    tips: [
      'Confirm the acuity mix — primary care panels versus acute or specialty clinics',
      'Ask about after-hours nurse-line or call expectations',
      'School-based roles follow academic calendars — clarify summer scheduling',
      'Verify PALS requirements and vaccine-program workflows',
      'Check collaborative agreement requirements for this state',
    ],
  }),
  'women-health': buildNpSpecialtyConfig({
    slug: 'women-health',
    label: "Women's Health",
    fullLabel: "Women's Health NP (WHNP)",
    heroSubtitle: "Women's health nurse practitioner positions",
    salaryRange: '$105K-145K',
    keywords: ["women's health nurse practitioner", 'WHNP jobs', 'OB/GYN nurse practitioner'],
    benefits: [
      { title: 'Procedural Clinic Days', description: 'Colposcopy, LARC insertion, and biopsies keep office practice hands-on.', iconName: 'Activity' },
      { title: 'Lifespan Continuity', description: 'Patients often stay with the same WHNP from first exams through menopause.', iconName: 'Heart' },
      { title: 'Program Variety', description: 'OB/GYN groups, family planning clinics, fertility centers, and public health programs all hire WHNPs.', iconName: 'Building2' },
    ],
    tips: [
      'Confirm scope: gynecology-only versus prenatal and postpartum panels',
      'Ask whether obstetric call or rounding is expected',
      'Procedure training support — colposcopy and LARC skills — raises market value',
      'Check malpractice coverage details for any obstetric scope',
      'Clarify collaborative agreement requirements in this state',
    ],
  }),
  'acute-care': buildNpSpecialtyConfig({
    slug: 'acute-care',
    label: 'Acute Care',
    fullLabel: 'Acute Care NP (ACNP)',
    heroSubtitle: 'Acute care nurse practitioner positions',
    salaryRange: '$115K-160K',
    keywords: ['acute care nurse practitioner', 'ACNP jobs', 'ICU nurse practitioner'],
    benefits: [
      { title: 'High-Acuity Practice', description: 'ICUs, step-down units, and hospital specialty services — the most complex adult patients.', iconName: 'Activity' },
      { title: 'Procedural Scope', description: 'Lines, airway support, and bedside procedures within hospital privileges.', iconName: 'Shield' },
      { title: 'Differential Pay', description: 'Night, weekend, and holiday differentials stack on hospital base pay.', iconName: 'DollarSign' },
    ],
    tips: [
      'Ask about orientation length, procedure training, and overnight support',
      'Negotiate shift differentials for nights, weekends, and holidays',
      'Clarify patient load per shift and escalation/backup structures',
      'Confirm credentialing and privileging timelines before your start date',
      'ICU, ED, or step-down RN experience strengthens candidacy — highlight it',
    ],
  }),
  emergency: buildNpSpecialtyConfig({
    slug: 'emergency',
    label: 'Emergency',
    fullLabel: 'Emergency NP (ENP)',
    heroSubtitle: 'Emergency nurse practitioner positions',
    salaryRange: '$115K-160K',
    keywords: ['emergency nurse practitioner', 'ENP jobs', 'ER nurse practitioner'],
    benefits: [
      { title: 'Full-Spectrum Acuity', description: 'Fast-track through resuscitation support — no two shifts repeat.', iconName: 'Activity' },
      { title: 'Shift-Based Life', description: 'Block schedules with defined shifts and no patient panel to carry home.', iconName: 'Clock' },
      { title: 'Procedure Volume', description: 'Suturing, splinting, reductions, and point-of-care ultrasound keep skills sharp.', iconName: 'Shield' },
    ],
    tips: [
      'Clarify the day/overnight mix and holiday rotation up front',
      'Ask which procedures NPs own in this ED and what training is provided',
      'Confirm fast-track versus main-ED assignment expectations',
      'ACLS and PALS are standard; trauma course completion strengthens offers',
      'Negotiate night and weekend differentials — they are standard in EDs',
    ],
  }),
  'psychiatric-mental-health': buildNpSpecialtyConfig({
    slug: 'psychiatric-mental-health',
    label: 'Psychiatric Mental Health',
    fullLabel: 'Psychiatric Mental Health NP (PMHNP)',
    heroSubtitle: 'Psychiatric mental health nurse practitioner positions',
    salaryRange: '$120K-170K',
    keywords: ['psychiatric nurse practitioner', 'PMHNP jobs', 'psych NP'],
    // Copy below is deliberately phrased without the reference-niche
    // literals — the ceiling in niche-copy-pseo-templates.test.ts caps
    // this file's count at the existing intentional mentions above.
    benefits: [
      { title: 'Telehealth Reach', description: 'Virtual-care platforms recruit this specialty heavily, opening multi-state caseloads from home.', iconName: 'Globe' },
      { title: 'Sustained Demand', description: 'Provider shortages keep openings high across outpatient, hospital, and telehealth settings statewide.', iconName: 'TrendingUp' },
      { title: 'Therapeutic Continuity', description: 'Longitudinal medication management builds deep, ongoing patient relationships.', iconName: 'Heart' },
    ],
    tips: [
      'Clarify caseload mix — medication management versus integrated therapy time',
      'Ask about crisis coverage, after-hours call, and escalation support',
      'Verify controlled-substance prescribing workflows and collaboration requirements in this state',
      'For telehealth panels, confirm which state licenses the employer expects you to hold',
      'Compare supervision and consultation structures — they vary widely by employer',
    ],
  }),
  anesthesia: buildNpSpecialtyConfig({
    slug: 'anesthesia',
    label: 'Nurse Anesthetist',
    fullLabel: 'Nurse Anesthetist (CRNA)',
    heroSubtitle: 'Certified registered nurse anesthetist positions',
    salaryRange: '$180K-250K',
    keywords: ['CRNA jobs', 'nurse anesthetist', 'certified registered nurse anesthetist'],
    benefits: [
      { title: 'Top APRN Compensation', description: 'CRNA pay anchors the highest tier of advanced practice nursing.', iconName: 'DollarSign' },
      { title: 'Case Autonomy', description: 'Full anesthetic responsibility, especially in independent and rural practices.', iconName: 'Shield' },
      { title: 'Setting Variety', description: 'Hospital ORs, surgery centers, obstetric units, and procedural suites statewide.', iconName: 'Building2' },
    ],
    tips: [
      'Compare call burden and post-call time across offers — they drive real total pay',
      'Ask whether the practice model is independent, care-team, or supervised',
      'Verify state supervision or opt-out rules and facility policies',
      'Clarify case mix — cardiac, OB, regional blocks — against your training',
      'Keep NBCRNA Continued Professional Certification (CPC) requirements current',
    ],
  }),
  midwifery: buildNpSpecialtyConfig({
    slug: 'midwifery',
    label: 'Nurse Midwife',
    fullLabel: 'Nurse Midwife (CNM)',
    heroSubtitle: 'Certified nurse midwife positions',
    salaryRange: '$105K-140K',
    keywords: ['CNM jobs', 'certified nurse midwife', 'nurse midwifery'],
    benefits: [
      { title: 'Birth-Centered Work', description: 'Attending births in hospitals, birth centers, or home practices.', iconName: 'Heart' },
      { title: 'Continuity of Care', description: 'Prenatal through postpartum, plus gynecologic care between pregnancies.', iconName: 'Users' },
      { title: 'Model Choice', description: 'Hospital-employed, birth-center, and independent practice models each hire CNMs.', iconName: 'Home' },
    ],
    tips: [
      'Ask about call frequency, backup arrangements, and expected birth volume',
      'Clarify hospital privileges and physician consultation structures',
      'Compare practice models — employed versus birth-center versus independent',
      'Verify state rules for CNM practice and prescriptive authority',
      'Confirm malpractice coverage terms, including tail coverage, for obstetric scope',
    ],
  }),
  // ── 2026-07 P1 #14: [state] tier extension ──────────────────────────────
  // Salary ranges mirror the same slugs' NP_CATEGORY_CONFIGS entries in
  // lib/pseo/category-city-template.tsx so the two templates never disagree.
  'primary-care': buildNpSpecialtyConfig({
    slug: 'primary-care',
    label: 'Primary Care',
    fullLabel: 'Primary Care NP',
    heroSubtitle: 'Primary care nurse practitioner positions',
    salaryRange: '$100K-140K',
    keywords: ['primary care nurse practitioner', 'primary care NP jobs', 'internal medicine NP'],
    benefits: [
      { title: 'Continuity Panels', description: 'A panel of your own patients, followed across years — the core of primary care.', iconName: 'Heart' },
      { title: 'Urban to Rural Reach', description: 'Primary care roles post across urban FQHCs, suburban groups, and rural health clinics alike.', iconName: 'Building2' },
      { title: 'Loan-Repayment Pathways', description: 'FQHC and shortage-area roles frequently qualify for NHSC and PSLF programs.', iconName: 'Lightbulb' },
    ],
    tips: [
      'Ask about panel size, visit cadence, and documentation time',
      'Confirm quality-incentive and RVU bonus structures',
      'Shortage-area roles may add NHSC loan repayment — ask before negotiating',
      'Clarify chronic-care program support: pharmacists, care managers, social work',
      'Verify collaborative agreement requirements in this state',
    ],
  }),
  oncology: buildNpSpecialtyConfig({
    slug: 'oncology',
    label: 'Oncology',
    fullLabel: 'Oncology NP',
    heroSubtitle: 'Oncology nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['oncology nurse practitioner', 'oncology NP jobs', 'hematology oncology NP'],
    benefits: [
      { title: 'Longitudinal Relationships', description: 'Patients are followed across treatment arcs measured in years, not visits.', iconName: 'Heart' },
      { title: 'Science-Driven Field', description: 'Immunotherapy and targeted-agent pipelines mean treatment protocols change continually.', iconName: 'Lightbulb' },
      { title: 'Survivorship Care', description: 'Dedicated survivorship clinics are an established NP-led service line in many cancer programs.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Confirm the treatment-phase focus — active treatment, infusion oversight, or survivorship',
      'Ask about chemotherapy and immunotherapy competency training',
      'Clarify after-hours triage and oncologic-emergency coverage expectations',
      'Academic centers may offer dedicated oncology NP fellowships — ask',
      'The optional AOCNP credential (ONCC) recognizes oncology practice hours',
    ],
  }),
  cardiology: buildNpSpecialtyConfig({
    slug: 'cardiology',
    label: 'Cardiology',
    fullLabel: 'Cardiology NP',
    heroSubtitle: 'Cardiology nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['cardiology nurse practitioner', 'cardiology NP jobs', 'cardiovascular NP'],
    benefits: [
      { title: 'Procedure-Adjacent Practice', description: 'Cath lab, EP, and device clinics keep the work technical and hands-on.', iconName: 'Activity' },
      { title: 'Chronic + Acute Mix', description: 'Longitudinal heart-failure panels balance against acute inpatient consults.', iconName: 'Monitor' },
      { title: 'High-Demand Subspecialty', description: 'Cardiovascular disease volume keeps cardiology teams hiring NPs continuously.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Confirm the setting mix — clinic-only, inpatient-only, or hybrid',
      'Ask about ECG and device-interrogation training support',
      'Inpatient roles: clarify call stipends and weekend rotation',
      'Guideline-directed heart-failure therapy fluency is the common screen — prepare for it',
      'ACLS is standard; verify credentialing timelines for hospital roles',
    ],
  }),
  hospitalist: buildNpSpecialtyConfig({
    slug: 'hospitalist',
    label: 'Hospitalist',
    fullLabel: 'Hospitalist NP',
    heroSubtitle: 'Inpatient medicine nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['hospitalist nurse practitioner', 'hospitalist NP jobs', 'inpatient medicine NP'],
    benefits: [
      { title: 'Block Scheduling', description: 'Seven-on/seven-off patterns concentrate work weeks and open real time off.', iconName: 'Calendar' },
      { title: 'Team Medicine', description: 'Co-managed services with physician hospitalists, pharmacists, and case management.', iconName: 'Users' },
      { title: 'Inpatient Breadth', description: 'Adult general medicine acuity without a procedure-suite subspecialty focus.', iconName: 'Building2' },
    ],
    tips: [
      'Clarify the night-shift share of the block schedule before signing',
      'Ask about admission versus rounding versus cross-cover distribution',
      'Confirm patient census expectations per shift',
      'Negotiate night-block and holiday differentials',
      'Acute care certification (AGACNP or ACNPC-AG) is the preferred track — highlight it',
    ],
  }),
  dermatology: buildNpSpecialtyConfig({
    slug: 'dermatology',
    label: 'Dermatology',
    fullLabel: 'Dermatology NP',
    heroSubtitle: 'Dermatology nurse practitioner positions',
    salaryRange: '$110K-155K',
    keywords: ['dermatology nurse practitioner', 'dermatology NP jobs', 'derm NP'],
    benefits: [
      { title: 'Procedure-Heavy Clinic Days', description: 'Biopsies, cryotherapy, and injectables keep clinic days hands-on.', iconName: 'Activity' },
      { title: 'Predictable Schedule', description: 'Weekday clinic hours with no inpatient call in most practices.', iconName: 'Clock' },
      { title: 'Productivity Upside', description: 'Volume- and cosmetic-service bonuses reward efficient, skilled clinicians.', iconName: 'DollarSign' },
    ],
    tips: [
      'Confirm the medical versus cosmetic mix in the practice',
      'Ask about structured derm training if you are new to the specialty',
      'Clarify biopsy, cryotherapy, and injectable procedure expectations',
      'Negotiate productivity bonuses — they are a standard lever in high-volume derm practices',
      'The optional DCNP credential recognizes dermatology practice hours',
    ],
  }),
  'urgent-care': buildNpSpecialtyConfig({
    slug: 'urgent-care',
    label: 'Urgent Care',
    fullLabel: 'Urgent Care NP',
    heroSubtitle: 'Walk-in clinic & urgent care nurse practitioner positions',
    salaryRange: '$105K-140K',
    keywords: ['urgent care nurse practitioner', 'urgent care NP jobs', 'walk-in clinic NP'],
    benefits: [
      { title: 'Shift-Based Schedules', description: 'Defined shifts with no after-hours panel work — when the clinic closes, the day is done.', iconName: 'Clock' },
      { title: 'Broad Case Mix', description: 'Procedures, radiograph reads, and undifferentiated complaints across the lifespan.', iconName: 'Activity' },
      { title: 'Everywhere Hiring', description: 'Urgent care chains and health systems staff new sites across the state continuously.', iconName: 'Building2' },
    ],
    tips: [
      'Clarify the evening, weekend, and holiday rotation up front',
      'Ask about patients-per-hour expectations at peak volume',
      'Confirm which procedures NPs own — lacerations, splinting, I&D',
      'Verify on-site radiograph and lab support',
      'Negotiate shift differentials for evenings and weekends',
    ],
  }),
  'home-health': buildNpSpecialtyConfig({
    slug: 'home-health',
    label: 'Home Health',
    fullLabel: 'Home Health NP',
    heroSubtitle: 'In-home visit & house-call nurse practitioner positions',
    salaryRange: '$100K-135K',
    keywords: ['home health nurse practitioner', 'home health NP jobs', 'house call NP'],
    benefits: [
      { title: 'Autonomy on the Road', description: 'Run your own visit schedule and practice at the top of your license in the field.', iconName: 'MapPin' },
      { title: 'Deep Patient Context', description: 'Seeing patients at home surfaces context a clinic visit never shows.', iconName: 'Home' },
      { title: 'Flexible Day Structure', description: 'Many programs let you set visit windows and documentation blocks around your own rhythm.', iconName: 'Calendar' },
    ],
    tips: [
      'Ask about daily visit expectations and territory size',
      'Confirm mileage or vehicle allowance terms',
      'Clarify per-visit versus salaried compensation models',
      'Verify EHR and connectivity support for field documentation',
      'Ask how after-hours patient calls are handled',
    ],
  }),
};

// Narrative fields (heroSubtitle/benefits/tips/keywords) in the legacy configs
// below were rewritten for the all-NP board (2026-07 awkward-phrase sweep).
// Salary bands retuned 2026-07 to the config/niche/salary.ts anchors (staff
// NP ≈ $95-140K W-2, typical comparison band $110K-170K, locum/IC $60-150/hr).
// TODO(content): refine bands with per-setting market data alongside the
// lib/stats-sources.ts salary re-sourcing pass.
export const SETTING_CONFIGS: Record<string, SettingConfig> = {
  remote: {
    slug: 'remote',
    label: 'Remote',
    fullLabel: 'Remote NP',
    heroSubtitle: 'Work from home nurse practitioner positions',
    salaryRange: '$110K-170K',
    keywords: ['remote nurse practitioner', 'work from home np', 'remote np jobs', 'telehealth np'],
    faqCategory: 'remote',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('remote'),
    }),
    benefits: [
      { title: 'Flexible Schedule', description: 'Set your own hours and work from the comfort of your home while serving patients across the state.', iconName: 'Clock' },
      { title: 'No Commute', description: 'Eliminate commute time and overhead costs. Remote NP roles let you practice from anywhere in the state.', iconName: 'Home' },
      { title: 'National Reach', description: 'Serve patients statewide and expand your impact beyond your local area with telehealth flexibility.', iconName: 'Globe' },
    ],
    tips: [
      'Ensure reliable high-speed internet for telehealth visits',
      'Create a private, HIPAA-compliant home office',
      'Verify state licensure requirements for remote practice',
      'Invest in quality telehealth equipment (webcam, headset)',
      'Set clear boundaries between work and personal time',
    ],
  },
  telehealth: {
    slug: 'telehealth',
    label: 'Telehealth',
    fullLabel: 'Telehealth NP',
    heroSubtitle: 'Virtual care nurse practitioner positions',
    salaryRange: '$110K-170K',
    keywords: ['telehealth nurse practitioner', 'telemedicine np', 'virtual care np', 'telehealth np jobs'],
    faqCategory: 'telehealth',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('telehealth'),
    }),
    benefits: [
      { title: 'Growing Demand', description: 'Telehealth care has seen explosive growth. Virtual providers are in high demand statewide.', iconName: 'TrendingUp' },
      { title: 'Patient Accessibility', description: 'Reach patients in rural and underserved areas who lack access to in-person care.', iconName: 'Users' },
      { title: 'Flexible Practice', description: 'Choose between full-time telehealth positions or supplement in-person work with virtual sessions.', iconName: 'Monitor' },
    ],
    tips: [
      'Master telehealth platforms (Zoom, Doxy.me)',
      'Develop strong virtual rapport and assessment skills',
      'Stay current on state-specific telehealth regulations',
      'Maintain proper documentation for virtual visits',
      'Consider multi-state licensure for broader reach',
    ],
  },
  inpatient: {
    slug: 'inpatient',
    label: 'Inpatient',
    fullLabel: 'Inpatient NP',
    heroSubtitle: 'Hospital & acute care positions',
    salaryRange: '$115K-180K',
    keywords: ['inpatient nurse practitioner', 'hospital np', 'acute care np', 'inpatient np jobs'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('inpatient'),
    }),
    benefits: [
      { title: 'Higher Base Pay', description: 'Hospital-based NP roles typically pay a premium over clinic equivalents, plus shift differentials.', iconName: 'DollarSign' },
      { title: 'Structured Environment', description: 'Hospital settings offer built-in support teams, protocols, and multidisciplinary care teams.', iconName: 'Shield' },
      { title: 'Defined Schedules', description: 'Many inpatient roles offer shift-based schedules (7-on/7-off, 3x12s) with no after-hours calls.', iconName: 'Clock' },
    ],
    tips: [
      'Get comfortable with rapid assessment and escalation protocols',
      'Build rapport with multidisciplinary teams',
      'Stay current on acute-care pharmacology',
      'Negotiate shift differentials for nights and weekends',
      'Consider inpatient fellowships for specialized training',
    ],
  },
  outpatient: {
    slug: 'outpatient',
    label: 'Outpatient',
    fullLabel: 'Outpatient NP',
    heroSubtitle: 'Clinic & private practice positions',
    salaryRange: '$105K-160K',
    keywords: ['outpatient nurse practitioner', 'clinic np', 'private practice np', 'outpatient np jobs'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('outpatient'),
    }),
    benefits: [
      { title: 'Work-Life Balance', description: 'Most outpatient positions offer M-F schedules with no nights, weekends, or on-call requirements.', iconName: 'Clock' },
      { title: 'Long-Term Relationships', description: 'Build meaningful patient relationships through ongoing primary, preventive, and chronic care.', iconName: 'Heart' },
      { title: 'Private Practice Path', description: 'Outpatient experience is the foundation for starting your own practice with full clinical and financial autonomy.', iconName: 'DollarSign' },
    ],
    tips: [
      'Start with structured clinic work before private practice',
      'Build expertise in chronic-disease management and preventive care',
      'Negotiate productivity bonuses for high patient volume',
      'Consider part-time private practice alongside W-2 work',
      'Get comfortable with brief counseling and patient education',
    ],
  },
  travel: {
    slug: 'travel',
    label: 'Travel',
    fullLabel: 'Travel NP',
    heroSubtitle: 'Locum tenens & travel assignment positions',
    salaryRange: '$80-150/hr',
    keywords: ['travel nurse practitioner', 'locum tenens np', 'travel np jobs', 'locum np'],
    faqCategory: 'travel',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      // Travel and locum-tenens are distinct canonical tags but the
      // /jobs/travel/{state} page semantically covers both. The two
      // withTagFallback(...) calls each return { OR: [...] }; we lift
      // them into a single OR via spread + flat-map.
      OR: [
        ...((withTagFallback('travel').OR as Record<string, unknown>[]) ?? []),
        ...((withTagFallback('locum-tenens').OR as Record<string, unknown>[]) ?? []),
      ],
    }),
    benefits: [
      { title: 'Premium Pay', description: 'Travel and locum tenens positions offer 20-40% higher compensation plus housing and travel stipends.', iconName: 'DollarSign' },
      { title: 'Flexible Assignments', description: 'Choose contract lengths from 4 weeks to 6+ months. Take breaks between assignments as needed.', iconName: 'Calendar' },
      { title: 'Explore New Places', description: 'Work across the state while experiencing different healthcare settings and patient populations.', iconName: 'MapPin' },
    ],
    tips: [
      'Maintain active licensure in the state',
      'Keep credentials updated and easily accessible',
      'Work with reputable staffing agencies',
      'Negotiate housing and travel stipends',
      'Build relationships for repeat assignments',
    ],
  },
  'full-time': {
    slug: 'full-time',
    label: 'Full-Time',
    fullLabel: 'Full-Time NP',
    heroSubtitle: 'Permanent full-time NP positions',
    salaryRange: '$110K-170K',
    keywords: ['full-time nurse practitioner', 'permanent np', 'full time np jobs', 'W-2 np'],
    faqCategory: 'full-time',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('full-time'),
    }),
    benefits: [
      { title: 'Benefits Package', description: 'Full-time positions include health insurance, 401K match, PTO, CME allowance, and malpractice coverage.', iconName: 'Shield' },
      { title: 'Career Stability', description: 'W-2 employment offers predictable income, regular schedules, and long-term career growth at a single organization.', iconName: 'TrendingUp' },
      { title: 'Professional Development', description: 'Most employers fund continuing education, conference attendance, and specialty certifications.', iconName: 'Lightbulb' },
    ],
    tips: [
      'Negotiate beyond salary — CME budget, PTO, and signing bonus matter',
      'Evaluate benefits packages including retirement match and insurance',
      'Ask about caseload expectations and documentation time',
      'Clarify on-call requirements and compensation',
      'Ensure the employer supports your professional growth',
    ],
  },
  'part-time': {
    slug: 'part-time',
    label: 'Part-Time',
    fullLabel: 'Part-Time NP',
    heroSubtitle: 'Flexible part-time NP positions',
    salaryRange: '$60-100/hr',
    keywords: ['part-time nurse practitioner', 'part time np', 'flexible np jobs', 'PRN np'],
    faqCategory: 'part-time',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('part-time'),
    }),
    benefits: [
      { title: 'Schedule Flexibility', description: 'Work 2-3 days per week, freeing time for private practice, family, or other commitments.', iconName: 'Clock' },
      { title: 'Higher Hourly Rates', description: 'Part-time NPs often earn $60-100+/hr — higher per-hour than full-time equivalents.', iconName: 'DollarSign' },
      { title: 'Stack Multiple Roles', description: 'Combine part-time positions across different settings to maximize income and clinical variety.', iconName: 'Activity' },
    ],
    tips: [
      'Consider stacking 2-3 part-time roles for variety and income',
      'Clarify whether benefits are offered (some PT roles include them)',
      'Negotiate guaranteed minimum hours per week',
      'Maintain your own malpractice insurance if not employer-provided',
      'Use part-time work to build your private practice referral base',
    ],
  },
  contract: {
    slug: 'contract',
    label: 'Contract',
    fullLabel: 'Contract NP',
    heroSubtitle: 'Contract & temp-to-perm NP positions',
    salaryRange: '$70-130/hr',
    keywords: ['contract nurse practitioner', 'temp np', 'contract np jobs', 'temp to perm np'],
    faqCategory: 'contract',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('contract'),
    }),
    benefits: [
      { title: 'Premium Rates', description: 'Contract NPs earn 20-50% more per hour than permanent staff, with rates of $70-130+/hr.', iconName: 'DollarSign' },
      { title: 'Try Before You Commit', description: 'Contract roles let you evaluate an employer, location, and patient population before converting to permanent.', iconName: 'Lightbulb' },
      { title: 'Tax Advantages', description: 'As a contract worker, deduct home office, travel, equipment, and continuing education from your taxes.', iconName: 'Shield' },
    ],
    tips: [
      'Negotiate contract length, extension clauses, and cancellation terms',
      'Work with reputable staffing agencies for protection',
      'Maintain your own benefits (health insurance, retirement)',
      'Keep detailed records of all business expenses for tax deductions',
      'Build relationships for contract-to-perm conversion opportunities',
    ],
  },
  'new-grad': {
    slug: 'new-grad',
    label: 'New Grad',
    fullLabel: 'New Grad NP',
    heroSubtitle: 'Entry-level positions for new NP graduates',
    salaryRange: '$95K-140K',
    keywords: ['new grad nurse practitioner', 'entry level np', 'new graduate np', 'np residency', 'np fellowship'],
    faqCategory: 'new-grad',
    buildWhere: (stateName: string) => buildKeywordWhere(
      ['new grad', 'new graduate', 'entry level', 'entry-level', 'residency', 'fellowship', 'recent graduate', 'no experience required'],
      stateName,
      'new-grad',
    ),
    benefits: [
      { title: 'Mentorship Programs', description: 'Many new grad positions include structured mentorship with experienced physicians and senior NPs.', iconName: 'Users' },
      { title: 'Competitive Starting Pay', description: 'New grad NPs start at $95K-140K with full benefits, signing bonuses, and loan repayment.', iconName: 'DollarSign' },
      { title: 'Clinical Growth', description: 'First roles build your clinical foundation — choose settings that offer diverse patient populations and supervision.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Prioritize positions with structured mentorship or supervision',
      'Negotiate signing bonuses and relocation assistance',
      'Choose diverse clinical settings for broad experience',
      'Explore NHSC loan repayment opportunities',
      'Start building your professional network early',
    ],
  },
  '1099': {
    slug: '1099',
    label: '1099',
    fullLabel: '1099 NP',
    heroSubtitle: 'Independent contractor nurse practitioner positions',
    salaryRange: '$60-150+/hr',
    keywords: ['1099 nurse practitioner', 'independent contractor np', 'self-employed np', 'IC nurse practitioner'],
    faqCategory: '1099',
    buildWhere: (stateName: string) => buildKeywordWhere(
      ['1099', 'independent contractor', 'contractor', 'self-employed', 'IC position'],
      stateName,
      '1099',
    ),
    benefits: [
      { title: 'Higher Gross Pay', description: '1099 NPs earn $60-150+/hr — often 20-40% higher than W-2 rates with significant tax deduction opportunities.', iconName: 'DollarSign' },
      { title: 'Schedule Control', description: 'Set your own hours, work with multiple clients, and control your patient volume and caseload.', iconName: 'Clock' },
      { title: 'Tax Advantages', description: 'Deduct business expenses, contribute $66K/year to SEP-IRA, and write off home office and mileage.', iconName: 'Shield' },
    ],
    tips: [
      'Form an LLC or PLLC before signing your first contract',
      'Set aside 25-30% of income for quarterly estimated taxes',
      'Maintain your own malpractice insurance (occurrence-based)',
      'Track all business expenses diligently for tax deductions',
      'Work with a healthcare-specialized CPA for tax optimization',
    ],
  },
  'per-diem': {
    slug: 'per-diem',
    label: 'Per Diem',
    fullLabel: 'Per Diem NP',
    // TODO(content): per-board editorial copy — see docs/pilot-fork-runbook.md §3
    heroSubtitle: 'Flexible per-diem and PRN nurse practitioner shifts',
    salaryRange: '$60-110/hr',
    keywords: ['per diem nurse practitioner', 'PRN nurse practitioner', 'per diem NP', 'PRN NP jobs'],
    faqCategory: 'per-diem',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('per-diem'),
    }),
    benefits: [
      { title: 'Shift Flexibility', description: 'Pick up shifts that fit your schedule — no fixed weekly commitment.', iconName: 'Clock' },
      { title: 'Higher Hourly Rates', description: 'Per-diem NPs typically earn a premium over salaried equivalents in exchange for forgoing benefits.', iconName: 'DollarSign' },
      { title: 'Setting Variety', description: 'Rotate across facilities and care settings while keeping your primary role or practice.', iconName: 'Activity' },
    ],
    tips: [
      'Clarify minimum-shift commitments and cancellation policies up front',
      'Maintain your own malpractice coverage if not facility-provided',
      'Track credentialing paperwork — each facility onboards separately',
      'Stack per-diem shifts across 2-3 facilities for steadier volume',
      'Confirm whether holiday and weekend differentials apply',
    ],
  },
  'locum-tenens': {
    slug: 'locum-tenens',
    label: 'Locum Tenens',
    fullLabel: 'Locum Tenens NP',
    // TODO(content): per-board editorial copy — see docs/pilot-fork-runbook.md §3
    heroSubtitle: 'Short-term locum tenens nurse practitioner assignments',
    salaryRange: '$80-150/hr',
    keywords: ['locum tenens nurse practitioner', 'locum NP', 'locum tenens NP jobs', 'temporary NP assignment'],
    faqCategory: 'locum-tenens',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('locum-tenens'),
    }),
    benefits: [
      { title: 'Premium Pay', description: 'Locum assignments typically pay 20-40% above permanent rates, often with housing and travel stipends.', iconName: 'DollarSign' },
      { title: 'Defined Terms', description: 'Assignments run from a few weeks to several months with clear start and end dates.', iconName: 'Calendar' },
      { title: 'Geographic Freedom', description: 'Work across states while an agency handles licensing and credentialing logistics.', iconName: 'MapPin' },
    ],
    tips: [
      'Work with reputable staffing agencies and compare contract terms',
      'Negotiate housing, travel, and completion bonuses',
      'Keep credentials and licensure documents ready for fast onboarding',
      'Understand IRS tax-home rules before taking travel stipends',
      'Build agency relationships for repeat assignments',
    ],
  },
  ...NP_SPECIALTY_STATE_CONFIGS,
};

/** Get all valid setting slugs */
export function getAllSettingSlugs(): string[] {
  return Object.keys(SETTING_CONFIGS);
}

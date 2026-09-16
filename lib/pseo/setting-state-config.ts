/**
 * Setting × State pSEO Configuration
 *
 * Defines each "setting" category (settings, job types and the state-tier
 * specialties) and the Prisma `where` clause used to filter jobs for it. A
 * shared template factory renders the /jobs/{setting}/{state} pages from it.
 *
 * COPY RULES (pSEO truth sweep, PLAN.md T0-4 and thin-spec 1 T9): every
 * benefit and tip is qualitative. No pay figure, percentage, caseload count,
 * contract length, or trend claim appears here; pay comes from the gated
 * median in lib/salary-analytics.ts or the cited BLS figure in
 * lib/stats-sources.ts. Professional English, no dashes, ranges read "to".
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
// The adjacency table lives in lib/pseo/neighboring-states.ts (the single
// copy, PLAN.md C.0); re-exported until the setting-state template imports it.

export { NEIGHBORING_STATES } from './neighboring-states';

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
  /**
   * @deprecated Removed by the state template rewrite (thin-spec 1 T4). The
   * hand-typed bands that used to live here had no source; pay now comes from
   * the gated median (lib/salary-analytics.ts) or the cited BLS figure. No
   * config populates this field; W4-INTEGRATE deletes it once the template
   * stops reading it.
   */
  salaryRange?: string;
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
 * for call-site compatibility; it is no longer consulted at query time
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
// P1 #5 content pass (2026-07-29): every specialty entry carries bespoke
// benefits/tips with real occupational texture; the shared factory defaults
// that rendered byte-identical copy across all specialty × state page sets
// were removed (benefits/tips are required inputs now).
//
// QUERY NOTE: lib/pseo/category-tagger.ts emits the 42-slug NP taxonomy, so
// these buildWhere clauses go through the normal withTagFallback() path:
// precomputed `categoryTags` first, legacy keyword fallback for unbackfilled rows.

interface NpSpecialtyConfigInput {
  slug: CategoryTag;
  label: string;
  fullLabel: string;
  heroSubtitle: string;
  keywords: string[];
  /**
   * Bespoke per-specialty benefit cards (P1 #5, 2026-07-29). Required, so
   * no two specialty × state page sets read byte-identical.
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
    // specialty slug is the one remaining unmapped key; CategoryFAQ renders
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
    keywords: ['family practice nurse practitioner', 'FNP jobs', 'family nurse practitioner'],
    benefits: [
      { title: 'Lifespan Panels', description: 'Care for children, adults, and older adults on one continuity panel.', iconName: 'Users' },
      { title: 'Setting Flexibility', description: 'Clinics, FQHCs, urgent care, retail health, and telehealth panels across the state post FNP roles.', iconName: 'Building2' },
      { title: 'Career Foundation', description: 'Family practice experience underwrites later moves into specialty care, leadership, or independent practice.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Ask about panel size, daily visit expectations, and documentation time',
      'Confirm RVU or quality-bonus structures beyond base salary',
      'Ask whether the site holds an active NHSC approval and whether the employer qualifies for PSLF',
      'Clarify walk-in and same-day coverage expectations',
      'Verify collaborative or supervisory agreement requirements in this state',
    ],
  }),
  'adult-gerontology': buildNpSpecialtyConfig({
    slug: 'adult-gerontology',
    label: 'Adult-Gerontology',
    fullLabel: 'Adult-Gerontology NP (AGNP)',
    heroSubtitle: 'Adult-gerontology nurse practitioner positions',
    keywords: ['adult gerontology nurse practitioner', 'AGNP jobs', 'AGACNP', 'AGPCNP'],
    benefits: [
      { title: 'Two Career Tracks', description: 'Primary care (AGPCNP) clinic panels or acute care (AGACNP) hospital services; both post roles across the state.', iconName: 'Activity' },
      { title: 'Lifespan Breadth', description: 'Patients range from young adults through advanced age, across primary care, long-term care, and hospital services.', iconName: 'Users' },
      { title: 'Complex-Care Depth', description: 'Multimorbidity, polypharmacy, and geriatric syndromes reward strong clinical reasoning.', iconName: 'Lightbulb' },
    ],
    tips: [
      'Match the role to your track: AGPCNP for clinic panels, AGACNP for hospital services',
      'SNF and long-term-care roles vary in facility load, so ask how many buildings you would cover',
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
    keywords: ['pediatric nurse practitioner', 'PNP jobs', 'peds NP'],
    benefits: [
      { title: 'Kid-First Practice', description: 'Well-child care, development, and family-centered visits define the day.', iconName: 'Heart' },
      { title: 'Community Reach', description: 'Pediatric clinics, school-based health centers, and children’s hospitals across the state post PNP roles.', iconName: 'Home' },
      { title: 'Prevention Focus', description: 'Immunization schedules and developmental surveillance anchor the role in prevention.', iconName: 'Shield' },
    ],
    tips: [
      'Confirm the acuity mix: primary care panels versus acute or specialty clinics',
      'Ask about after-hours nurse-line or call expectations',
      'School-based roles follow academic calendars, so clarify summer scheduling',
      'Verify PALS requirements and vaccine-program workflows',
      'Check collaborative agreement requirements for this state',
    ],
  }),
  'women-health': buildNpSpecialtyConfig({
    slug: 'women-health',
    label: "Women's Health",
    fullLabel: "Women's Health NP (WHNP)",
    heroSubtitle: "Women's health nurse practitioner positions",
    keywords: ["women's health nurse practitioner", 'WHNP jobs', 'OB/GYN nurse practitioner'],
    benefits: [
      { title: 'Procedural Clinic Days', description: 'Colposcopy, LARC insertion, and biopsies keep office practice hands-on.', iconName: 'Activity' },
      { title: 'Lifespan Continuity', description: 'Patients often stay with the same WHNP from first exams through menopause.', iconName: 'Heart' },
      { title: 'Program Variety', description: 'OB/GYN groups, family planning clinics, fertility centers, and public health programs post WHNP roles.', iconName: 'Building2' },
    ],
    tips: [
      'Confirm scope: gynecology-only versus prenatal and postpartum panels',
      'Ask whether obstetric call or rounding is expected',
      'Procedure training support (colposcopy and LARC skills) widens the roles you qualify for',
      'Check malpractice coverage details for any obstetric scope',
      'Clarify collaborative agreement requirements in this state',
    ],
  }),
  'acute-care': buildNpSpecialtyConfig({
    slug: 'acute-care',
    label: 'Acute Care',
    fullLabel: 'Acute Care NP (ACNP)',
    heroSubtitle: 'Acute care nurse practitioner positions',
    keywords: ['acute care nurse practitioner', 'ACNP jobs', 'ICU nurse practitioner'],
    benefits: [
      { title: 'High-Acuity Practice', description: 'ICUs, step-down units, and hospital specialty services, serving complex adult patients.', iconName: 'Activity' },
      { title: 'Procedural Scope', description: 'Lines, airway support, and bedside procedures within hospital privileges.', iconName: 'Shield' },
      { title: 'Shift Structure', description: 'Hospital services run around the clock, so shift patterns and differentials are part of the offer; confirm both in each listing.', iconName: 'Clock' },
    ],
    tips: [
      'Ask about orientation length, procedure training, and overnight support',
      'Negotiate shift differentials for nights, weekends, and holidays',
      'Clarify patient load per shift and escalation/backup structures',
      'Confirm credentialing and privileging timelines before your start date',
      'ICU, ED, or step-down RN experience strengthens candidacy, so highlight it',
    ],
  }),
  emergency: buildNpSpecialtyConfig({
    slug: 'emergency',
    label: 'Emergency',
    fullLabel: 'Emergency NP (ENP)',
    heroSubtitle: 'Emergency nurse practitioner positions',
    keywords: ['emergency nurse practitioner', 'ENP jobs', 'ER nurse practitioner'],
    benefits: [
      { title: 'Full-Spectrum Acuity', description: 'From fast-track through resuscitation support, no two shifts repeat.', iconName: 'Activity' },
      { title: 'Shift-Based Life', description: 'Block schedules with defined shifts and no patient panel to carry home.', iconName: 'Clock' },
      { title: 'Procedure Volume', description: 'Suturing, splinting, reductions, and point-of-care ultrasound keep skills sharp.', iconName: 'Shield' },
    ],
    tips: [
      'Clarify the day/overnight mix and holiday rotation up front',
      'Ask which procedures NPs own in this ED and what training is provided',
      'Confirm fast-track versus main-ED assignment expectations',
      'ACLS and PALS are standard; trauma course completion strengthens offers',
      'Ask how night and weekend differentials are structured',
    ],
  }),
  'psychiatric-mental-health': buildNpSpecialtyConfig({
    slug: 'psychiatric-mental-health',
    label: 'Psychiatric Mental Health',
    fullLabel: 'Psychiatric Mental Health NP (PMHNP)',
    heroSubtitle: 'Psychiatric mental health nurse practitioner positions',
    keywords: ['psychiatric nurse practitioner', 'PMHNP jobs', 'psych NP'],
    // Copy below is deliberately phrased without the reference-niche
    // literals: the ceiling in niche-copy-pseo-templates.test.ts caps
    // this file's count at the existing intentional mentions above.
    benefits: [
      { title: 'Telehealth Reach', description: 'Virtual-care platforms post roles for this specialty; each listing names the states where a license is required.', iconName: 'Globe' },
      { title: 'Setting Range', description: 'Outpatient clinics, hospital units, telehealth platforms, and integrated care teams all post roles for this specialty.', iconName: 'Building2' },
      { title: 'Therapeutic Continuity', description: 'Longitudinal medication management builds deep, ongoing patient relationships.', iconName: 'Heart' },
    ],
    tips: [
      'Clarify the caseload mix: medication management versus integrated therapy time',
      'Ask about crisis coverage, after-hours call, and escalation support',
      'Verify controlled-substance prescribing workflows and collaboration requirements in this state',
      'For telehealth panels, confirm which state licenses the employer expects you to hold',
      'Compare supervision and consultation structures, which vary by employer',
    ],
  }),
  anesthesia: buildNpSpecialtyConfig({
    slug: 'anesthesia',
    label: 'Nurse Anesthetist',
    fullLabel: 'Nurse Anesthetist (CRNA)',
    heroSubtitle: 'Certified registered nurse anesthetist positions',
    keywords: ['CRNA jobs', 'nurse anesthetist', 'certified registered nurse anesthetist'],
    benefits: [
      { title: 'Case Responsibility', description: 'Plan and deliver anesthesia care across surgical, obstetric, and procedural cases within the practice model the facility uses.', iconName: 'Shield' },
      { title: 'Setting Variety', description: 'Hospital ORs, surgery centers, obstetric units, and procedural suites across the state post CRNA roles.', iconName: 'Building2' },
      { title: 'Call Terms Matter', description: 'Call burden and post-call time change what an offer is worth, so compare them alongside the base rate.', iconName: 'Clock' },
    ],
    tips: [
      'Compare call burden and post-call time across offers, since they shape real total pay',
      'Ask whether the practice model is independent, care-team, or supervised',
      'Verify state supervision or opt-out rules and facility policies',
      'Clarify the case mix (cardiac, OB, regional blocks) against your training',
      'Keep NBCRNA Continued Professional Certification (CPC) requirements current',
    ],
  }),
  midwifery: buildNpSpecialtyConfig({
    slug: 'midwifery',
    label: 'Nurse Midwife',
    fullLabel: 'Nurse Midwife (CNM)',
    heroSubtitle: 'Certified nurse midwife positions',
    keywords: ['CNM jobs', 'certified nurse midwife', 'nurse midwifery'],
    benefits: [
      { title: 'Birth-Centered Work', description: 'Attending births in hospitals, birth centers, or home practices.', iconName: 'Heart' },
      { title: 'Continuity of Care', description: 'Prenatal through postpartum, plus gynecologic care between pregnancies.', iconName: 'Users' },
      { title: 'Model Choice', description: 'Hospital-employed, birth-center, and independent practice models each post CNM roles.', iconName: 'Home' },
    ],
    tips: [
      'Ask about call frequency, backup arrangements, and expected birth volume',
      'Clarify hospital privileges and physician consultation structures',
      'Compare practice models: employed versus birth-center versus independent',
      'Verify state rules for CNM practice and prescriptive authority',
      'Confirm malpractice coverage terms, including tail coverage, for obstetric scope',
    ],
  }),
  // ── 2026-07 P1 #14: [state] tier extension ──────────────────────────────
  'primary-care': buildNpSpecialtyConfig({
    slug: 'primary-care',
    label: 'Primary Care',
    fullLabel: 'Primary Care NP',
    heroSubtitle: 'Primary care nurse practitioner positions',
    keywords: ['primary care nurse practitioner', 'primary care NP jobs', 'internal medicine NP'],
    benefits: [
      { title: 'Continuity Panels', description: 'A panel of your own patients, followed across years, is the core of primary care.', iconName: 'Heart' },
      { title: 'Urban to Rural Reach', description: 'Primary care roles post across urban FQHCs, suburban groups, and rural health clinics alike.', iconName: 'Building2' },
      { title: 'Loan-Repayment Programs', description: 'Ask whether a site holds an active NHSC approval and whether the employer qualifies for PSLF; both depend on the specific site.', iconName: 'Lightbulb' },
    ],
    tips: [
      'Ask about panel size, visit cadence, and documentation time',
      'Confirm quality-incentive and RVU bonus structures',
      'Ask whether the site holds an active NHSC approval before negotiating',
      'Clarify chronic-care program support: pharmacists, care managers, social work',
      'Verify collaborative agreement requirements in this state',
    ],
  }),
  oncology: buildNpSpecialtyConfig({
    slug: 'oncology',
    label: 'Oncology',
    fullLabel: 'Oncology NP',
    heroSubtitle: 'Oncology nurse practitioner positions',
    keywords: ['oncology nurse practitioner', 'oncology NP jobs', 'hematology oncology NP'],
    benefits: [
      { title: 'Longitudinal Relationships', description: 'Patients are followed across treatment arcs measured in years, not visits.', iconName: 'Heart' },
      { title: 'Science-Driven Field', description: 'Immunotherapy and targeted-agent pipelines mean treatment protocols change continually.', iconName: 'Lightbulb' },
      { title: 'Survivorship Care', description: 'Dedicated survivorship clinics are an established NP-led service line in many cancer programs.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Confirm the treatment-phase focus: active treatment, infusion oversight, or survivorship',
      'Ask about chemotherapy and immunotherapy competency training',
      'Clarify after-hours triage and oncologic-emergency coverage expectations',
      'Ask whether academic centers offer dedicated oncology NP fellowships',
      'The optional AOCNP credential (ONCC) recognizes oncology practice hours',
    ],
  }),
  cardiology: buildNpSpecialtyConfig({
    slug: 'cardiology',
    label: 'Cardiology',
    fullLabel: 'Cardiology NP',
    heroSubtitle: 'Cardiology nurse practitioner positions',
    keywords: ['cardiology nurse practitioner', 'cardiology NP jobs', 'cardiovascular NP'],
    benefits: [
      { title: 'Procedure-Adjacent Practice', description: 'Cath lab, EP, and device clinics keep the work technical and hands-on.', iconName: 'Activity' },
      { title: 'Chronic + Acute Mix', description: 'Longitudinal heart-failure panels balance against acute inpatient consults.', iconName: 'Monitor' },
      { title: 'Guideline-Driven Care', description: 'Guideline-directed medical therapy anchors the clinic work, so fluency in it is what listings screen for.', iconName: 'Lightbulb' },
    ],
    tips: [
      'Confirm the setting mix: clinic-only, inpatient-only, or hybrid',
      'Ask about ECG and device-interrogation training support',
      'Inpatient roles: clarify call stipends and weekend rotation',
      'Fluency in guideline-directed heart-failure therapy is the common screen, so prepare for it',
      'ACLS is standard; verify credentialing timelines for hospital roles',
    ],
  }),
  hospitalist: buildNpSpecialtyConfig({
    slug: 'hospitalist',
    label: 'Hospitalist',
    fullLabel: 'Hospitalist NP',
    heroSubtitle: 'Inpatient medicine nurse practitioner positions',
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
      'Acute care certification (AGACNP or ACNPC-AG) is the preferred track, so highlight it',
    ],
  }),
  dermatology: buildNpSpecialtyConfig({
    slug: 'dermatology',
    label: 'Dermatology',
    fullLabel: 'Dermatology NP',
    heroSubtitle: 'Dermatology nurse practitioner positions',
    keywords: ['dermatology nurse practitioner', 'dermatology NP jobs', 'derm NP'],
    benefits: [
      { title: 'Procedure-Heavy Clinic Days', description: 'Biopsies, cryotherapy, and injectables keep clinic days hands-on.', iconName: 'Activity' },
      { title: 'Predictable Schedule', description: 'Weekday clinic hours with no inpatient call in most practices.', iconName: 'Clock' },
      { title: 'Productivity Upside', description: 'Volume- and cosmetic-service bonuses reward efficient, skilled clinicians.', iconName: 'DollarSign' },
    ],
    tips: [
      'Confirm the medical versus cosmetic mix in the practice',
      'Ask about structured dermatology training if you are new to the specialty',
      'Clarify biopsy, cryotherapy, and injectable procedure expectations',
      'Ask how productivity bonuses are calculated in high-volume practices',
      'The optional DCNP credential recognizes dermatology practice hours',
    ],
  }),
  'urgent-care': buildNpSpecialtyConfig({
    slug: 'urgent-care',
    label: 'Urgent Care',
    fullLabel: 'Urgent Care NP',
    heroSubtitle: 'Walk-in clinic & urgent care nurse practitioner positions',
    keywords: ['urgent care nurse practitioner', 'urgent care NP jobs', 'walk-in clinic NP'],
    benefits: [
      { title: 'Shift-Based Schedules', description: 'Defined shifts with no after-hours panel work; when the clinic closes, the day is done.', iconName: 'Clock' },
      { title: 'Broad Case Mix', description: 'Procedures, radiograph reads, and undifferentiated complaints across the lifespan.', iconName: 'Activity' },
      { title: 'Site Types', description: 'Urgent care chains, health-system clinics, and retail health sites all post these roles; each listing names the site and hours.', iconName: 'Building2' },
    ],
    tips: [
      'Clarify the evening, weekend, and holiday rotation up front',
      'Ask about patients-per-hour expectations at peak volume',
      'Confirm which procedures NPs own: lacerations, splinting, I&D',
      'Verify on-site radiograph and lab support',
      'Ask how evening and weekend differentials are structured',
    ],
  }),
  'home-health': buildNpSpecialtyConfig({
    slug: 'home-health',
    label: 'Home Health',
    fullLabel: 'Home Health NP',
    heroSubtitle: 'In-home visit & house-call nurse practitioner positions',
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

// Narrative fields in the legacy configs below were rewritten for the all-NP
// board (2026-07) and swept of every unsourced figure (2026-09 truth pass).
export const SETTING_CONFIGS: Record<string, SettingConfig> = {
  remote: {
    slug: 'remote',
    label: 'Remote',
    fullLabel: 'Remote NP',
    heroSubtitle: 'Work from home nurse practitioner positions',
    keywords: ['remote nurse practitioner', 'work from home np', 'remote np jobs', 'telehealth np'],
    faqCategory: 'remote',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('remote'),
    }),
    benefits: [
      { title: 'Flexible Schedule', description: 'Remote listings describe their own scheduling model, from fixed telehealth blocks to self-set hours; confirm which applies before applying.', iconName: 'Clock' },
      { title: 'No Commute', description: 'Practice from a home office anywhere in the state; each listing states the equipment and workspace it requires.', iconName: 'Home' },
      { title: 'Statewide Reach', description: 'Serve patients across the state by video and phone, subject to the licensure each listing requires.', iconName: 'Globe' },
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
    keywords: ['telehealth nurse practitioner', 'telemedicine np', 'virtual care np', 'telehealth np jobs'],
    faqCategory: 'telehealth',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('telehealth'),
    }),
    benefits: [
      { title: 'Virtual Visit Models', description: 'Listings range from scheduled video visits to asynchronous care; each states the platform and visit model it uses.', iconName: 'Monitor' },
      { title: 'Patient Accessibility', description: 'Reach patients in rural and underserved areas who lack access to in-person care.', iconName: 'Users' },
      { title: 'Flexible Practice', description: 'Choose between full-time telehealth positions or supplement in-person work with virtual sessions.', iconName: 'Clock' },
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
    keywords: ['inpatient nurse practitioner', 'hospital np', 'acute care np', 'inpatient np jobs'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('inpatient'),
    }),
    benefits: [
      { title: 'Shift Differentials', description: 'Hospital listings often state night, weekend, and holiday differentials separately from base pay; read both lines before comparing offers.', iconName: 'DollarSign' },
      { title: 'Structured Environment', description: 'Hospital settings offer built-in support teams, protocols, and multidisciplinary care teams.', iconName: 'Shield' },
      { title: 'Defined Schedules', description: 'Many inpatient roles run on shift-based schedules, such as seven on and seven off, with no after-hours calls.', iconName: 'Clock' },
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
    keywords: ['outpatient nurse practitioner', 'clinic np', 'private practice np', 'outpatient np jobs'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('outpatient'),
    }),
    benefits: [
      { title: 'Weekday Schedules', description: 'Clinic hours are set by the practice; listings state whether evenings, weekends, or call are part of the role.', iconName: 'Clock' },
      { title: 'Long-Term Relationships', description: 'Build meaningful patient relationships through ongoing primary, preventive, and chronic care.', iconName: 'Heart' },
      { title: 'Private Practice Path', description: 'Outpatient experience is the usual foundation for a later private practice, where state practice authority sets what independence looks like.', iconName: 'DollarSign' },
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
      { title: 'Packaged Pay', description: 'Travel packages combine an hourly rate with housing and travel stipends; compare the full package, not the rate alone.', iconName: 'DollarSign' },
      { title: 'Defined Assignments', description: 'Assignments have stated start and end dates; each listing says how long it runs and whether extensions are possible.', iconName: 'Calendar' },
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
    keywords: ['full-time nurse practitioner', 'permanent np', 'full time np jobs', 'W-2 np'],
    faqCategory: 'full-time',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('full-time'),
    }),
    benefits: [
      { title: 'Benefits Package', description: 'Full-time offers are where health insurance, retirement match, PTO, CME allowance, and malpractice coverage are negotiated; confirm each in the offer letter.', iconName: 'Shield' },
      { title: 'Career Stability', description: 'W-2 employment brings predictable income, regular schedules, and a long-term home at a single organization.', iconName: 'TrendingUp' },
      { title: 'Professional Development', description: 'Ask whether continuing education, conference attendance, and specialty certification fees are funded.', iconName: 'Lightbulb' },
    ],
    tips: [
      'Negotiate beyond salary: CME budget, PTO, and signing bonus all matter',
      'Evaluate benefits packages including retirement match and insurance',
      'Ask about caseload expectations and documentation time',
      'Clarify on-call requirements and compensation',
      'Ensure the employer supports your professional development',
    ],
  },
  'part-time': {
    slug: 'part-time',
    label: 'Part-Time',
    fullLabel: 'Part-Time NP',
    heroSubtitle: 'Flexible part-time NP positions',
    keywords: ['part-time nurse practitioner', 'part time np', 'flexible np jobs', 'PRN np'],
    faqCategory: 'part-time',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('part-time'),
    }),
    benefits: [
      { title: 'Schedule Flexibility', description: 'Part-time listings state the days or hours expected; the rest of the week stays open for private practice, family, or other work.', iconName: 'Clock' },
      { title: 'Hourly Pay', description: 'Part-time roles are usually paid hourly; weigh the posted rate against whatever benefits, if any, are included.', iconName: 'DollarSign' },
      { title: 'Stack Multiple Roles', description: 'Combine part-time positions across different settings for clinical variety and steadier income.', iconName: 'Activity' },
    ],
    tips: [
      'Consider stacking two or three part-time roles for variety and income',
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
    keywords: ['contract nurse practitioner', 'temp np', 'contract np jobs', 'temp to perm np'],
    faqCategory: 'contract',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('contract'),
    }),
    benefits: [
      { title: 'Hourly Terms', description: 'Contract pay is quoted hourly and trades off benefits and tenure; compare the full package against a permanent offer.', iconName: 'DollarSign' },
      { title: 'Try Before You Commit', description: 'Contract roles let you evaluate an employer, location, and patient population before converting to permanent.', iconName: 'Lightbulb' },
      { title: 'Know the Structure', description: 'Contract roles come as agency W-2 or 1099; the structure decides who handles taxes, malpractice, and benefits, so confirm it first.', iconName: 'Shield' },
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
    keywords: ['new grad nurse practitioner', 'entry level np', 'new graduate np', 'np residency', 'np fellowship'],
    faqCategory: 'new-grad',
    buildWhere: (stateName: string) => buildKeywordWhere(
      ['new grad', 'new graduate', 'entry level', 'entry-level', 'residency', 'fellowship', 'recent graduate', 'no experience required'],
      stateName,
      'new-grad',
    ),
    benefits: [
      { title: 'Mentorship Programs', description: 'Many new grad positions include structured mentorship with experienced physicians and senior NPs.', iconName: 'Users' },
      { title: 'Offer Components', description: 'Read a first offer as a package: base pay, benefits, any signing bonus, and whether the site holds an NHSC approval for loan repayment.', iconName: 'DollarSign' },
      { title: 'Clinical Foundation', description: 'First roles build your clinical foundation, so choose settings that offer diverse patient populations and supervision.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Prioritize positions with structured mentorship or supervision',
      'Negotiate signing bonuses and relocation assistance',
      'Choose diverse clinical settings for broad experience',
      'Ask whether the site holds an active NHSC approval for loan repayment',
      'Start building your professional network early',
    ],
  },
  '1099': {
    slug: '1099',
    label: '1099',
    fullLabel: '1099 NP',
    heroSubtitle: 'Independent contractor nurse practitioner positions',
    keywords: ['1099 nurse practitioner', 'independent contractor np', 'self-employed np', 'IC nurse practitioner'],
    faqCategory: '1099',
    buildWhere: (stateName: string) => buildKeywordWhere(
      ['1099', 'independent contractor', 'contractor', 'self-employed', 'IC position'],
      stateName,
      '1099',
    ),
    benefits: [
      { title: 'Gross Versus Net', description: 'Contractor rates are quoted before self-employment tax, malpractice, and the benefits you fund yourself; model the after-tax figure before comparing to W-2 pay.', iconName: 'DollarSign' },
      { title: 'Schedule Control', description: 'Set your own hours, work with multiple clients, and control your patient volume and caseload.', iconName: 'Clock' },
      { title: 'Business Structure', description: 'Business expenses and retirement contributions are handled as a self-employed clinician; an accountant who works with clinicians can map what applies to you.', iconName: 'Shield' },
    ],
    tips: [
      'Form an LLC or PLLC before signing your first contract',
      'Set aside part of every payment for quarterly estimated taxes',
      'Maintain your own malpractice insurance (occurrence-based)',
      'Track all business expenses diligently for tax deductions',
      'Work with a healthcare-specialized CPA for tax planning',
    ],
  },
  'per-diem': {
    slug: 'per-diem',
    label: 'Per Diem',
    fullLabel: 'Per Diem NP',
    heroSubtitle: 'Flexible per-diem and PRN nurse practitioner shifts',
    keywords: ['per diem nurse practitioner', 'PRN nurse practitioner', 'per diem NP', 'PRN NP jobs'],
    faqCategory: 'per-diem',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('per-diem'),
    }),
    benefits: [
      { title: 'Shift Flexibility', description: 'Pick up shifts that fit your schedule with no fixed weekly commitment.', iconName: 'Clock' },
      { title: 'Hourly Without Benefits', description: 'Per-diem pay is hourly and usually excludes benefits; weigh the posted rate against the coverage you fund yourself.', iconName: 'DollarSign' },
      { title: 'Setting Variety', description: 'Rotate across facilities and care settings while keeping your primary role or practice.', iconName: 'Activity' },
    ],
    tips: [
      'Clarify minimum-shift commitments and cancellation policies up front',
      'Maintain your own malpractice coverage if not facility-provided',
      'Track credentialing paperwork, since each facility onboards separately',
      'Stack per-diem shifts across two or three facilities for steadier volume',
      'Confirm whether holiday and weekend differentials apply',
    ],
  },
  'locum-tenens': {
    slug: 'locum-tenens',
    label: 'Locum Tenens',
    fullLabel: 'Locum Tenens NP',
    heroSubtitle: 'Short-term locum tenens nurse practitioner assignments',
    keywords: ['locum tenens nurse practitioner', 'locum NP', 'locum tenens NP jobs', 'temporary NP assignment'],
    faqCategory: 'locum-tenens',
    buildWhere: (stateName: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...withTagFallback('locum-tenens'),
    }),
    benefits: [
      { title: 'Packaged Pay', description: 'Locum packages pair an hourly rate with agency-covered malpractice and, often, travel and housing; compare the whole package.', iconName: 'DollarSign' },
      { title: 'Defined Terms', description: 'Assignments run from a few weeks to several months with clear start and end dates.', iconName: 'Calendar' },
      { title: 'Geographic Freedom', description: 'Work across states; agencies commonly help with licensing and credentialing paperwork, and each assignment state still issues its own APRN license.', iconName: 'MapPin' },
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

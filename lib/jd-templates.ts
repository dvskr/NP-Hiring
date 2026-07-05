/**
 * NP JD skeleton templates — bullet-structured starters, not finished
 * prose. Each is ~1,500-2,500 chars, organized by setting and sub-
 * specialty, with [bracketed] placeholders where the employer must
 * fill in their actual specifics.
 *
 * Design choices (vs. the prior long-prose approach, swapped 2026-05-14):
 *   - SHORT (~2k chars) so the employer is expected to customize before
 *     submitting — not paste-and-go.
 *   - BULLETS over prose to make placeholders visually scannable.
 *   - 12 templates covering real NP practice settings so the picker
 *     looks like a serious niche tool, not a generic 3-option drop-in.
 *   - [bracket] markers explicitly cue the recruiter to edit. Lower
 *     duplicate-content risk than identical prose across 50 employers.
 *   - Shared closing sections (Required quals, Comp, Apply) so the
 *     legally-stable boilerplate stays consistent and we don't have to
 *     update it in 12 places when DEA rules change.
 *
 * Token substitution: {{employer}}, {{city}}, {{state}} are replaced
 * by renderTemplate() at insert time using current form-field values.
 * Anything in [square brackets] is left as-is — those are prompts to
 * the human to fill in.
 */

import { brand } from '@/config/brand';

export type JdTemplateCategory = 'outpatient' | 'inpatient' | 'telehealth' | 'specialty';

export type JdTemplateId =
  | 'outpatient-adult'
  | 'outpatient-pediatric'
  | 'outpatient-geriatric'
  | 'outpatient-womens-health'
  | 'inpatient-adult-acute'
  | 'inpatient-pediatric'
  | 'telehealth-adult'
  | 'telehealth-multistate'
  | 'fqhc-community-health'
  | 'correctional-health'
  | 'urgent-care'
  | 'emergency-department';

export interface JdTemplate {
  id: JdTemplateId;
  category: JdTemplateCategory;
  label: string;
  summary: string;
  setting: string;
  population: string;
  /** Quill-compatible HTML. Tokens: {{employer}}, {{city}}, {{state}}. */
  body: string;
}

// ─── Shared sections ──────────────────────────────────────────────
// Boilerplate that should stay identical across all templates so legal/
// scope-of-practice language is reviewed once. Sub-specialty differences
// live in the responsibilities, preferred quals, schedule, and why-join
// sections.

const REQUIRED_QUALS_BLOCK = `<h3>Required qualifications</h3>
<ul>
<li>Master's or Doctoral degree (MSN, DNP) from an accredited ${brand.niche.short} program</li>
<li>Active, unrestricted national ${brand.niche.short} board certification (ANCC or AANP) in your population focus</li>
<li>Active RN and APRN/NP licensure in {{state}}</li>
<li>Active, unrestricted DEA registration with Schedule II authority (or willingness to obtain by start date)</li>
<li>[Set your experience requirement — e.g. "New grads welcome", "1+ year preferred", "3+ years required"]</li>
</ul>`;

const COMP_BENEFITS_BLOCK = `<h2>Compensation and benefits</h2>
<ul>
<li>Base salary: $[XXX,000 – XXX,000] commensurate with experience</li>
<li>[Bonus structure — e.g. quarterly outcomes bonus, productivity bonus, sign-on, none]</li>
<li>Health, dental, and vision insurance</li>
<li>$[X,XXX] annual CME stipend plus [X] paid CME days</li>
<li>Full malpractice with tail coverage</li>
<li>401(k) or 403(b) with employer match</li>
<li>[X] weeks paid time off plus [X] paid holidays</li>
<li>[Optional: loan repayment, relocation, parental leave specifics]</li>
</ul>`;

const APPLY_BLOCK = `<h2>How to apply</h2>
<p>Submit your CV with a brief cover note describing your interest in this role. We typically respond within [N] business days. Equal-opportunity employer; we strongly encourage applications from clinicians of all backgrounds.</p>`;

function buildTemplate(parts: {
  aboutBlurb: string;
  positionSummary: string;
  responsibilities: string[];
  preferredQuals: string[];
  schedule: string;
  whyJoin: string;
}): string {
  return [
    `<h2>About {{employer}}</h2><p>{{employer}} is hiring a ${brand.niche.long} (${brand.niche.short}) in {{city}}, {{state}}. ${parts.aboutBlurb}</p>`,
    `<h2>Position summary</h2><p>${parts.positionSummary}</p>`,
    `<h3>Key responsibilities</h3><ul>${parts.responsibilities.map((r) => `<li>${r}</li>`).join('')}</ul>`,
    REQUIRED_QUALS_BLOCK,
    `<h3>Preferred qualifications</h3><ul>${parts.preferredQuals.map((p) => `<li>${p}</li>`).join('')}</ul>`,
    `<h2>Schedule</h2><p>${parts.schedule}</p>`,
    COMP_BENEFITS_BLOCK,
    `<h2>Why join us</h2><p>${parts.whyJoin}</p>`,
    APPLY_BLOCK,
  ].join('');
}

// ─── Outpatient templates ────────────────────────────────────────

const OUTPATIENT_ADULT_BODY = buildTemplate({
  aboutBlurb:
    'We are a [mission/values phrase — e.g. clinician-led, evidence-based] outpatient primary-care practice serving adults with [patient mix — e.g. preventive care, chronic disease management, acute visits].',
  positionSummary:
    `This is a [full-time / part-time] outpatient ${brand.niche.short} role with autonomy over your panel and treatment decisions. You will conduct patient evaluations, manage acute and chronic conditions, and coordinate care with our [specialty / behavioral health / care management] team. Our EHR is [Athena / Epic / NextGen / specify] with [templated notes / AI-assisted documentation / specify any tooling].`,
  responsibilities: [
    'Conduct [30 / 45]-minute new-patient evaluations and [15 / 20]-minute follow-up visits',
    'Diagnose and manage [list common conditions you see — e.g. hypertension, diabetes, asthma, thyroid disorders]',
    'Prescribe and titrate medications, including controlled substances where clinically appropriate',
    'Order and interpret labs, imaging, and screening tests per evidence-based guidelines',
    'Provide preventive care, patient education, and chronic-disease counseling',
    'Coordinate referrals with behavioral health, specialty, and community resources',
    'Document encounters in the EHR within [24 / 48] hours',
  ],
  preferredQuals: [
    `[N]+ years of outpatient or primary-care ${brand.niche.short} experience`,
    'Experience with quality measures and value-based care metrics (HEDIS, MIPS)',
    '[Spanish / Mandarin / other language] fluency for our patient population',
    '[Specific procedural skill: joint injections, suturing, skin biopsies]',
  ],
  schedule:
    'Monday through Friday, [8:30 a.m. – 5:00 p.m. / your hours], with [one administrative half-day per week / specify]. [No weekend, on-call, or after-hours coverage required / specify any call duties].',
  whyJoin:
    '[1–2 sentences about what makes your practice distinctive — clinician-led leadership, manageable panel sizes, administrative support, growth path, etc.]',
});

const OUTPATIENT_PEDIATRIC_BODY = buildTemplate({
  aboutBlurb:
    'We are a pediatric outpatient practice serving patients ages [0–18 / 0–21 / specify] for [well-child care, acute visits, chronic-condition management — adjust to your population].',
  positionSummary:
    `This is a pediatric ${brand.niche.short} role focused on developmentally-informed care. You will conduct well-child and sick visits, manage common pediatric conditions, and partner closely with parents, schools, and specialty providers.`,
  responsibilities: [
    'Conduct well-child exams, developmental screenings, and immunization visits',
    'Diagnose and treat common pediatric conditions — [asthma, ADHD, infections, allergies — specify]',
    'Prescribe and dose medications appropriately for pediatric populations',
    'Counsel families on growth, development, nutrition, and safety',
    'Coordinate with schools, early-intervention programs, and pediatric specialists',
    'Document per [your state] pediatric care requirements',
  ],
  preferredQuals: [
    `[N]+ years of pediatric ${brand.niche.short} experience`,
    'CPNP-PC certification, or FNP certification with pediatric experience',
    'Experience with developmental screening tools (ASQ, M-CHAT)',
    '[Spanish / specify] fluency for our patient population',
  ],
  schedule:
    'Monday through Friday with [after-school slots / extended hours] to accommodate school schedules. [Weekend sick-visit rotation / no weekends]; [phone-triage rotation / no on-call].',
  whyJoin:
    '[Describe your practice: team culture, panel size, mission, training opportunities, etc.]',
});

const OUTPATIENT_GERIATRIC_BODY = buildTemplate({
  aboutBlurb:
    'We are a geriatric practice serving older adults (age [55+ / 65+]) across [clinic / long-term-care / home-based — specify] settings, with a focus on complex chronic disease and healthy aging.',
  positionSummary:
    `This is a geriatric ${brand.niche.short} role centered on careful medication management in medically complex older adults, often in collaboration with primary care, specialty, and skilled nursing teams.`,
  responsibilities: [
    'Conduct comprehensive geriatric assessments including cognitive screening (MoCA / MMSE), fall-risk review, and functional evaluation',
    'Diagnose and manage chronic conditions common in later life — [heart failure, COPD, diabetes, dementia — specify]',
    'Prescribe with attention to polypharmacy, renal/hepatic adjustments, and fall risk',
    'Coordinate with primary care, specialists, and [SNF / ALF / memory-care facility] staff',
    'Lead family meetings on diagnosis, prognosis, and goals of care',
    '[Optional: conduct in-facility visits at assisted-living or skilled-nursing partners]',
  ],
  preferredQuals: [
    `[N]+ years of geriatric or general adult ${brand.niche.short} experience`,
    'Familiarity with Beers Criteria and STOPP/START prescribing in older adults',
    'Comfort with dementia care, capacity assessments, and end-of-life conversations',
    '[Spanish / specify] fluency',
  ],
  schedule:
    'Monday through Friday daytime hours. [Some in-facility visits at partner sites / clinic-based only]. No weekends or on-call.',
  whyJoin:
    '[What makes your geriatric practice unique — interdisciplinary team, memory-care partnership, research, mission, etc.]',
});

const OUTPATIENT_WOMENS_HEALTH_BODY = buildTemplate({
  aboutBlurb:
    "We are an outpatient women's health practice providing [gynecologic care, family planning, prenatal and postpartum care, menopause management — adjust to your services].",
  positionSummary:
    `This is a women's health ${brand.niche.short} role with a focus on [well-woman care / family planning / obstetric support — specify]. You will manage a full spectrum of women's health visits and coordinate with our [OB/GYN / midwifery / primary-care] team.`,
  responsibilities: [
    'Conduct well-woman exams, contraceptive counseling, and preventive screenings',
    'Diagnose and manage common gynecologic conditions',
    'Provide [prenatal and postpartum care / menopause management — specify scope]',
    'Perform in-office procedures — [IUD insertion, implant placement, colposcopy — adjust to your privileges]',
    'Order and interpret labs, ultrasounds, and screening studies',
    'Coordinate referrals to OB/GYN, maternal-fetal medicine, and specialty care',
  ],
  preferredQuals: [
    "WHNP-BC certification, or FNP certification with women's health experience",
    "[N]+ years of women's health experience",
    'Procedural experience — [IUD / implant / colposcopy — specify]',
    '[Spanish / specify] fluency',
  ],
  schedule:
    'Monday through Friday, [8–5 / your hours]. [No call / shared phone-triage rotation — specify].',
  whyJoin:
    '[Describe your practice — collaborative team, patient population, procedural scope, growth path, etc.]',
});

// ─── Inpatient templates ─────────────────────────────────────────

const INPATIENT_ADULT_ACUTE_BODY = buildTemplate({
  aboutBlurb:
    'We are a [N]-bed [hospitalist / medical-surgical / step-down] service at [community hospital / academic medical center / specify], caring for acutely ill adult inpatients.',
  positionSummary:
    `This is an inpatient ${brand.niche.short} role with shared admitting and rounding responsibility alongside a [hospitalist physician group / attending team]. Caseload is [10–16] patients with average length of stay [N] days.`,
  responsibilities: [
    'Perform admission histories and physicals within [4] hours of arrival, including assessment and provisional diagnosis',
    'Round daily on assigned patients with progress notes documenting clinical status, response to treatment, and discharge readiness',
    'Manage acute medication regimens and titrations, including [anticoagulation / insulin protocols — specify]',
    'Order and interpret labs, imaging, and diagnostic studies',
    'Participate in daily multidisciplinary treatment-team rounds',
    'Respond to rapid-response and escalation calls per unit protocol',
    'Lead family meetings for discharge planning and goals-of-care conversations',
  ],
  preferredQuals: [
    `[N]+ years of acute-care or hospitalist ${brand.niche.short} experience`,
    'AGACNP-BC certification preferred for adult acute-care scope',
    'BLS required; ACLS preferred',
    'Experience with [bedside procedures — specify per your credentialing]',
  ],
  schedule:
    '[12-hour shifts on a 7-on/7-off rotation / Monday–Friday day shifts / specify]. [Weekend coverage shared equitably / specify]. Holiday rotation [details].',
  whyJoin:
    '[Distinctive features — teaching hospital, low readmission rates, clinical scholarship support, pension/benefits, etc.]',
});

const INPATIENT_PEDIATRIC_BODY = buildTemplate({
  aboutBlurb:
    'We are a [N]-bed pediatric inpatient unit serving patients ages [0–18 / specify] with acute medical conditions requiring hospitalization.',
  positionSummary:
    `This is a pediatric inpatient ${brand.niche.short} role focused on acute stabilization, family-centered care, and coordinated discharge into outpatient follow-up.`,
  responsibilities: [
    'Perform admissions including history, physical exam, and family interview',
    'Round daily; document clinical status, treatment response, and discharge criteria',
    'Manage medication regimens with pediatric weight-based dosing',
    'Lead daily multidisciplinary rounds with nursing, social work, and child-life teams',
    'Coordinate with parents/guardians, schools, and community providers as needed',
    'Lead family meetings on diagnosis, treatment, and post-discharge planning',
  ],
  preferredQuals: [
    `[N]+ years of pediatric ${brand.niche.short} experience (inpatient strongly preferred)`,
    'CPNP-AC certification or equivalent acute-care training',
    'BLS required; PALS preferred',
    'Comfort with family-centered communication in high-stress situations',
  ],
  schedule:
    '[Schedule details — 12-hour shifts, weekday days, weekend rotation, etc.]',
  whyJoin:
    '[Distinctive features of your program — family integration, child-life services, step-down partnership, etc.]',
});

// ─── Telehealth templates ────────────────────────────────────────

const TELEHEALTH_ADULT_BODY = buildTemplate({
  aboutBlurb:
    'We are a 100% remote telehealth practice serving adults in [single state / {{state}} only — specify if multi-state]. We operate exclusively over [HIPAA-compliant video platform] with [asynchronous messaging / chat as adjunct, specify].',
  positionSummary:
    `This is a fully-remote ${brand.niche.short} role. You see patients exclusively over video from a home office of your choosing. We have invested in [low panel cap / measurement-based care / clinician-led policy / specify your differentiator].`,
  responsibilities: [
    'Conduct [30–45]-minute initial telehealth evaluations and [15–20]-minute follow-ups',
    'Diagnose and treat [primary-care / urgent-care / chronic-condition — specify] presentations appropriate for virtual care',
    'Prescribe medications via [EPCS] in compliance with state telehealth and DEA controlled-substance rules',
    'Manage an active panel of approximately [250–350] patients',
    'Respond to asynchronous patient messages within [N] business days',
    'Escalate patients who need in-person evaluation to local care with clear documentation',
  ],
  preferredQuals: [
    `[N]+ years of clinical ${brand.niche.short} experience (any setting)`,
    'Existing multi-state licensure (compact RN preferred)',
    'Comfort with asynchronous patient messaging workflows',
    '[Spanish / specify] fluency',
  ],
  schedule:
    'Monday through Friday [hours]. [Optional Saturday morning availability]. Full-time defined as [N] clinical hours per week. No nights, no weekends, no call.',
  whyJoin:
    '[Telehealth-specific differentiators — clinician-led, measurement-based outcomes, no commute, home-office stipend, etc.]',
});

const TELEHEALTH_MULTISTATE_BODY = buildTemplate({
  aboutBlurb:
    'We are a multi-state telehealth practice licensed in [N] states, serving patients across the country. We invest heavily in licensing support — our credentialing team handles the paperwork for additional state licenses.',
  positionSummary:
    `This is a fully-remote multi-state ${brand.niche.short} role. You will see patients across multiple states using a unified video platform and EHR. We support clinicians in expanding their state portfolio over time.`,
  responsibilities: [
    'Conduct telehealth evaluations and follow-ups across [N] states',
    'Maintain awareness of state-specific prescribing restrictions and telehealth rules',
    'Prescribe controlled substances via EPCS in compliance with each state\'s requirements',
    'Manage a multi-state patient panel with our scheduling team',
    'Participate in monthly virtual case-consultation and clinical-supervision meetings',
  ],
  preferredQuals: [
    'Multi-state licensure (compact RN strongly preferred) — we support adding additional states',
    '[N]+ years clinical experience',
    'Comfort with state-by-state telehealth nuances',
    '[Spanish / specify] fluency',
  ],
  schedule:
    'Flexible. Full-time is [N] clinical hours per week within hours of operation across your licensed time zones.',
  whyJoin:
    '[What makes your multi-state operation distinctive — licensing support team, clinician-led policy, transparent outcomes, etc.]',
});

// ─── Specialty / setting templates ───────────────────────────────

const FQHC_COMMUNITY_HEALTH_BODY = buildTemplate({
  aboutBlurb:
    'We are a Federally Qualified Health Center (FQHC) serving [rural / urban underserved / specify] patients. Our care team integrates primary care, behavioral health, and [dental / pharmacy — specify] services under one roof.',
  positionSummary:
    `This is an ${brand.niche.short} role embedded in our primary-care team. You will see patients of all ages and acuity levels, with a strong emphasis on accessibility, harm reduction, and culturally responsive care.`,
  responsibilities: [
    'Conduct patient evaluations for adults [and pediatrics — specify scope]',
    'Provide warm hand-offs with behavioral-health and care-management colleagues',
    'Manage medications across diagnostic categories',
    'Coordinate with [care managers / community-health workers / social services]',
    'Document in our EHR ([NextGen / Epic / OCHIN / specify])',
    'Participate in clinic-wide quality-improvement initiatives',
  ],
  preferredQuals: [
    'Comfort with high-acuity, underserved populations',
    'Experience with [Medicaid / sliding-scale / HRSA-funded] care environments',
    '[Spanish / specify] strongly preferred',
    'Interest in HRSA NHSC service commitment a plus',
  ],
  schedule:
    'Monday through Friday [8–5 / specify]. No nights, weekends, or call. [X] weeks PTO plus paid CME.',
  whyJoin:
    'HRSA NHSC loan repayment eligible — up to $[50,000+] for a 2-year service commitment. [Add specifics about your mission and team.]',
});

const CORRECTIONAL_HEALTH_BODY = buildTemplate({
  aboutBlurb:
    'We provide healthcare within [state / county / federal] correctional settings, serving incarcerated adults with acute and chronic medical needs.',
  positionSummary:
    `This is a correctional ${brand.niche.short} role focused on patient evaluation, chronic-disease management, and urgent response within a [secure facility / specify]. You will work as part of a multidisciplinary team alongside corrections staff, behavioral-health providers, and medical colleagues.`,
  responsibilities: [
    'Conduct intake evaluations for newly incarcerated individuals and chronic-care follow-ups',
    'Diagnose and manage chronic conditions — [diabetes, hypertension, hepatitis C, HIV — specify]',
    'Respond to urgent medical needs and acute decompensations within the facility',
    'Coordinate with corrections officers, behavioral-health staff, and outside specialists',
    'Document per [your state DOC / NCCHC / ACA] standards',
    'Participate in facility health-review and quality-improvement processes',
  ],
  preferredQuals: [
    `[N]+ years of ${brand.niche.short} experience (correctional experience preferred)`,
    'Comfort with [NCCHC / ACA accreditation] requirements',
    'Trauma-informed care training',
    'Experience with [substance use / chronic infectious disease / complex populations]',
  ],
  schedule:
    '[Monday-Friday day shifts / specify]. [No on-call / on-call rotation specifics].',
  whyJoin:
    '[Mission language — public service, underserved population, loan repayment, retirement benefits, etc.]',
});

const URGENT_CARE_BODY = buildTemplate({
  aboutBlurb:
    'We operate [N] urgent-care clinics in and around {{city}}, treating walk-in patients for acute illness and minor injury [7 days a week / specify hours].',
  positionSummary:
    `This is an urgent-care ${brand.niche.short} role with high patient variety and procedural opportunity. You will evaluate and treat acute presentations, perform minor procedures, and disposition patients to emergency or follow-up care when needed.`,
  responsibilities: [
    'Evaluate and treat acute presentations — [respiratory illness, sprains, lacerations, infections — specify]',
    'Perform minor procedures: suturing, splinting, incision and drainage, [foreign-body removal — adjust to your scope]',
    'Order and interpret point-of-care labs, X-rays, and rapid diagnostics',
    'Disposition patients appropriately — discharge with follow-up, referral, or ED transfer',
    'Document efficiently in a high-throughput environment ([N] patients per shift)',
    'Complete [DOT / occupational-health / sports-physical] visits as applicable',
  ],
  preferredQuals: [
    `[N]+ years of urgent-care, emergency, or primary-care ${brand.niche.short} experience`,
    'Procedural competence: suturing, splinting, incision and drainage',
    'ENP certification, or FNP certification with emergency experience, a plus',
    'Comfort seeing all ages [if applicable to your clinics]',
  ],
  schedule:
    '[12-hour shifts / 10-hour shifts] on a rotating schedule including [weekends / holidays — specify rotation].',
  whyJoin:
    '[Distinctive features — shift flexibility, procedural variety, growth into lead-clinician roles, etc.]',
});

const EMERGENCY_DEPARTMENT_BODY = buildTemplate({
  aboutBlurb:
    'We are a [N]-bed emergency department at [community hospital / trauma center — specify], serving approximately [N] visits annually.',
  positionSummary:
    `This is an emergency ${brand.niche.short} role focused on rapid evaluation, risk stratification, disposition planning, and stabilization. You will work alongside ED physicians, nurses, and case managers.`,
  responsibilities: [
    'Evaluate patients in [fast-track / main ED — specify] with rapid assessment and disposition',
    'Initiate stabilization including medications, fluids, and [interventions within your credentialed scope]',
    'Order and interpret labs, imaging, and diagnostic studies under time pressure',
    'Coordinate admissions, transfers, and outpatient follow-up',
    'Perform procedures: [suturing, splinting, reductions — adjust to credentialing]',
    'Participate in team debriefs and quality reviews',
  ],
  preferredQuals: [
    `[N]+ years of emergency or acute-care ${brand.niche.short} experience`,
    'BLS and ACLS required; PALS preferred',
    'ENP-C or AGACNP-BC certification preferred',
    'Comfort with high-acuity, high-volume environments',
  ],
  schedule:
    '[12-hour shifts / 8-hour rotations / specify]. [Weekend and overnight coverage / day-shift only].',
  whyJoin:
    '[Distinctive features — interdisciplinary team, public-health mission, salary differentials for nights/weekends, etc.]',
});

// ─── Exported registry ────────────────────────────────────────────

export const JD_TEMPLATES: ReadonlyArray<JdTemplate> = Object.freeze([
  // Outpatient
  {
    id: 'outpatient-adult',
    category: 'outpatient',
    label: 'Outpatient — Adult / Primary Care',
    summary: 'General adult outpatient care. Chronic-disease management + preventive visits in a clinic setting.',
    setting: 'Outpatient',
    population: 'Adults',
    body: OUTPATIENT_ADULT_BODY,
  },
  {
    id: 'outpatient-pediatric',
    category: 'outpatient',
    label: 'Outpatient — Pediatrics',
    summary: 'Well-child and acute pediatric care. Developmentally-informed visits, parent/school collaboration.',
    setting: 'Outpatient',
    population: 'Pediatric',
    body: OUTPATIENT_PEDIATRIC_BODY,
  },
  {
    id: 'outpatient-geriatric',
    category: 'outpatient',
    label: 'Outpatient — Geriatrics',
    summary: 'Older-adult care. Complex chronic disease, cognitive screening, polypharmacy management.',
    setting: 'Outpatient',
    population: 'Geriatric',
    body: OUTPATIENT_GERIATRIC_BODY,
  },
  {
    id: 'outpatient-womens-health',
    category: 'outpatient',
    label: "Outpatient — Women's Health",
    summary: 'Well-woman care, family planning, and gynecologic visits with in-office procedures.',
    setting: 'Outpatient',
    population: "Women's Health",
    body: OUTPATIENT_WOMENS_HEALTH_BODY,
  },

  // Inpatient
  {
    id: 'inpatient-adult-acute',
    category: 'inpatient',
    label: 'Inpatient — Hospitalist / Acute Care',
    summary: 'Acute admissions and daily rounding on adult medical inpatients.',
    setting: 'Inpatient',
    population: 'Adults',
    body: INPATIENT_ADULT_ACUTE_BODY,
  },
  {
    id: 'inpatient-pediatric',
    category: 'inpatient',
    label: 'Inpatient — Pediatrics',
    summary: 'Acute pediatric inpatient care. Family-centered stabilization and discharge planning.',
    setting: 'Inpatient',
    population: 'Pediatric',
    body: INPATIENT_PEDIATRIC_BODY,
  },

  // Telehealth
  {
    id: 'telehealth-adult',
    category: 'telehealth',
    label: 'Telehealth — Adult',
    summary: 'Fully-remote video-based adult care, single state.',
    setting: 'Telehealth',
    population: 'Adults',
    body: TELEHEALTH_ADULT_BODY,
  },
  {
    id: 'telehealth-multistate',
    category: 'telehealth',
    label: 'Telehealth — Multi-State',
    summary: 'Multi-state telehealth with licensing-support team.',
    setting: 'Telehealth',
    population: 'Adults',
    body: TELEHEALTH_MULTISTATE_BODY,
  },

  // Specialty
  {
    id: 'fqhc-community-health',
    category: 'specialty',
    label: 'FQHC / Community Health',
    summary: 'Integrated primary care in a federally-qualified or community health center.',
    setting: 'Community Health',
    population: 'All Ages',
    body: FQHC_COMMUNITY_HEALTH_BODY,
  },
  {
    id: 'correctional-health',
    category: 'specialty',
    label: 'Correctional Health',
    summary: 'Healthcare within state, county, or federal correctional settings.',
    setting: 'Corrections',
    population: 'Adults',
    body: CORRECTIONAL_HEALTH_BODY,
  },
  {
    id: 'urgent-care',
    category: 'specialty',
    label: 'Urgent Care',
    summary: 'Walk-in acute care with minor procedures and rapid diagnostics.',
    setting: 'Urgent Care',
    population: 'All Ages',
    body: URGENT_CARE_BODY,
  },
  {
    id: 'emergency-department',
    category: 'specialty',
    label: 'Emergency Department',
    summary: 'ED-embedded rapid evaluation, stabilization, and disposition.',
    setting: 'Emergency',
    population: 'Adults',
    body: EMERGENCY_DEPARTMENT_BODY,
  },
]);

export const TEMPLATE_CATEGORY_LABELS: Readonly<Record<JdTemplateCategory, string>> = Object.freeze({
  outpatient: 'Outpatient',
  inpatient: 'Inpatient',
  telehealth: 'Telehealth',
  specialty: 'Specialty Settings',
});

/**
 * Replace `{{token}}` placeholders with values from the current form
 * draft. Falls back to a generic phrase for empty values so a template
 * inserted before the employer fills in their company name still reads
 * naturally. Anything in [square brackets] is left as-is — those are
 * intentional prompts to the human to fill in.
 */
export function renderTemplate(
  template: JdTemplate,
  vars: { employer?: string; city?: string; state?: string },
): string {
  return template.body
    .replace(/\{\{employer\}\}/g, vars.employer?.trim() || 'Our practice')
    .replace(/\{\{city\}\}/g, vars.city?.trim() || 'your area')
    .replace(/\{\{state\}\}/g, vars.state?.trim() || 'your state');
}

/**
 * Strip HTML and count visible characters. Mirrors the post-job form's
 * character counter so the template-quality check uses the same length
 * the employer sees.
 */
export function visibleLength(html: string): number {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().length;
}

/**
 * lib/pseo/category-landing-content.ts
 *
 * Bespoke editorial content for the template-driven category landing pages
 * (P1 #5 — content/SEO tracker): the 19 original shells plus the three
 * P1 #15 specialty verticals that wrap the same template. Consumed by
 * lib/pseo/category-landing-template.tsx, which renders these fields as
 * the About / Requirements / Highlights / Salary sections that used to be
 * a TODO placeholder.
 *
 * TRUTH RULES (non-negotiable):
 *   - The ONLY dollar figure allowed in this file is the cited BLS OEWS
 *     all-NP median from lib/stats-sources.ts. Everything else stays
 *     qualitative/relative, and describes how pay is STRUCTURED (base vs
 *     differentials, RVU/productivity, call stipends, loan repayment)
 *     rather than where a specialty "sits" in some band.
 *
 *     Do NOT reintroduce figures from config/niche/salary.ts. Those are
 *     ingest-time validation constants, not market research:
 *       · `normalizer.typical` ($110k–$170k) is documented in that file as
 *         the donor board's own reference-niche mid-band — a comparison
 *         window for the normalizer, not a measured market band. It
 *         was previously rendered on ~15 public landings as "the typical
 *         band" with per-specialty positioning claims that contradicted
 *         this package's own per-specialty salaryRange values (e.g.
 *         primary care "anchors the center" ≈ $140k against
 *         setting-state-config's '$100K-140K', and above the cited
 *         $129,210 all-NP median, which is directionally wrong).
 *       · `normalizer.annualMax` ($400k) is the clamp CEILING the parser
 *         rejects above — not a validated CRNA band. The board's own CRNA
 *         range is '$180K-250K' (setting-state-config.ts).
 *     tests/regressions/p1-category-editorial-landing-content.test.ts
 *     fails if either constant's formatted value reappears here.
 *   - No unsourced superlative or universal market claims ("more than any
 *     other track", "every state", "nearly every metro"). The repo has no
 *     data behind them; the same test file enforces a banned-phrase list.
 *   - Certification bodies are correct per specialty: AANP/ANCC for NP
 *     tracks, NBCRNA for CRNA, AMCB for CNM, NCC for NNP/WHNP, PNCB for
 *     PNP, AACN for acute-care credentials, ONCC/DNCB/ONCB for optional
 *     specialty credentials.
 *   - The behavioral-health specialty entry is keyed via
 *     PSYCH_SPECIALTY_SLUG (taxonomy-registry) and its copy avoids the
 *     reference-niche literals — the niche-copy ratchet forbids new files
 *     from carrying them (tests/regressions/niche-copy-debt.test.ts).
 */

import { STAT_SOURCES } from '@/lib/stats-sources';
import { PSYCH_SPECIALTY_SLUG } from './taxonomy-registry';

export interface CategoryHighlight {
    title: string;
    description: string;
    /** Key into the template's curated lucide icon map. */
    icon: string;
}

export interface CategoryLandingContent {
    /** Role-overview paragraphs: scope, settings, patient population. */
    intro: string[];
    /** Three "why this specialty" cards (text-first bento). */
    highlights: CategoryHighlight[];
    /** Requirements checklist — education, certification, licensure. */
    requirements: string[];
    /**
     * Pay narrative. Describes how compensation is STRUCTURED for the
     * specialty; the cited BLS all-NP median is the only dollar figure
     * permitted (see TRUTH RULES above — no band-position claims).
     */
    salaryNarrative: string;
}

// ─── Shared, citation-backed strings ────────────────────────────────────────

/** "$129,210 (BLS OEWS, …)" — the cited all-NP median. */
const NP_MEDIAN_CITED = `${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source})`;

const COMPARE_LISTINGS = 'Compare posted salary ranges on individual listings for current, real-world figures.';

const MEDIAN_SENTENCE = `Nationally, nurse practitioners earn a median annual wage of ${NP_MEDIAN_CITED}.`;

// ─── Per-category content ───────────────────────────────────────────────────

const BASE_CONTENT: Record<string, CategoryLandingContent> = {
    'urgent-care': {
        intro: [
            'Urgent care nurse practitioners handle episodic acute complaints — infections, minor injuries, lacerations, sprains, and flare-ups of chronic disease — for walk-in patients of all ages. Visits are self-contained: assess, treat, and disposition, with no longitudinal panel to carry between shifts.',
            'Most roles sit in freestanding urgent care centers, retail health clinics, and hospital-affiliated walk-in sites. Shifts often include evenings and weekends, and many clinics run providers on three or four longer shifts per week rather than a five-day clinic schedule.',
        ],
        highlights: [
            { title: 'Shift-Based Schedules', description: 'Defined shifts with no after-hours panel work — when the clinic closes, the day is done.', icon: 'Clock' },
            { title: 'Broad Case Mix', description: 'Procedures, radiograph interpretation, and undifferentiated complaints keep clinical skills sharp across the lifespan.', icon: 'Activity' },
            { title: 'Broad Employer Base', description: 'Urgent care chains, retail health brands, and hospital-affiliated walk-in sites all staff NP-led clinics.', icon: 'Building2' },
        ],
        requirements: [
            'Graduate NP degree (MSN or DNP), typically on the family track for all-ages scope',
            'National certification as FNP-C (AANP) or FNP-BC (ANCC); the ENP specialty credential strengthens candidacy for higher-acuity sites',
            'Active state APRN licensure and DEA registration for prescribing',
            'Procedural skills employers screen for: laceration repair, splinting, incision and drainage, and plain-film interpretation',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Urgent care compensation is usually hourly or shift-based, with evening and weekend differentials and per-visit volume bonuses common on top of base rates. ${COMPARE_LISTINGS}`,
    },
    'home-health': {
        intro: [
            'Home health nurse practitioners bring primary and transitional care to patients where they live — homebound older adults, medically complex patients recently discharged from the hospital, and house-call panels run by value-based care groups.',
            'The workday is territory-based: a route of home visits with independent assessment, medication reconciliation, and care-plan coordination with families, home-health agencies, and collaborating physicians. Annual wellness visits and chronic-care programs make up much of the volume.',
        ],
        highlights: [
            { title: 'Autonomy on the Road', description: 'You run your own visit schedule and practice at the top of your license in the field.', icon: 'MapPin' },
            { title: 'Deep Patient Relationships', description: 'Seeing patients in their homes surfaces context a clinic visit never shows — and builds real continuity.', icon: 'Heart' },
            { title: 'Flexible Day Structure', description: 'Many programs let you set visit windows and documentation blocks around your own rhythm.', icon: 'Calendar' },
        ],
        requirements: [
            'Graduate NP degree with national certification through AANP or ANCC (family or adult-gerontology track, matched to the patient population)',
            'Active state APRN licensure and DEA registration',
            'Comfort practicing independently — home visits mean assessing and deciding without an on-site team',
            'A valid driver’s license and willingness to cover a defined visit territory',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Home-based roles are paid either as salary or per completed visit; per-visit models can outrun clinic pay at higher volumes, and most employers add mileage or vehicle allowances. ${COMPARE_LISTINGS}`,
    },
    'family-practice': {
        intro: [
            'Family nurse practitioners (FNPs) deliver first-contact primary care across the entire lifespan — preventive visits, chronic disease management, and acute episodic care for children, adults, and older adults on one panel.',
            'Because the FNP scope spans the whole lifespan, the credential fits settings a population-narrow track cannot: primary care clinics, FQHCs, urgent care, retail health, telehealth panels, and specialty practices all hire it. That breadth makes family practice both a destination and a foundation for a later specialty move.',
        ],
        highlights: [
            { title: 'Lifespan Scope', description: 'One certification covers newborns through older adults — the widest patient population of any NP track.', icon: 'Users' },
            { title: 'Setting Flexibility', description: 'Clinics, FQHCs, urgent care, retail health, and telehealth all recruit FNPs continuously.', icon: 'Building2' },
            { title: 'Foundation for Any Path', description: 'Family practice experience underwrites later moves into specialty, leadership, or independent practice.', icon: 'GraduationCap' },
        ],
        requirements: [
            'Graduate FNP program (MSN or DNP) with supervised clinical hours across the lifespan',
            'National certification as FNP-C through AANP or FNP-BC through ANCC',
            'Active state APRN licensure and DEA registration for prescribing',
            'Employers commonly screen for panel-management and EHR fluency; new-grad-friendly roles add structured supervision',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Family practice offers are usually a clinic base plus productivity (RVU) and quality bonuses, so the same credential prices differently between a fee-for-service practice and a value-based group. ${COMPARE_LISTINGS}`,
    },
    'adult-gerontology': {
        intro: [
            'Adult-gerontology nurse practitioners (AGNPs) care for patients from adolescence through advanced age, with two distinct tracks: primary care (AGPCNP) managing prevention and chronic disease in outpatient settings, and acute care (AGACNP) managing complex and critically ill adults in hospitals.',
            'The aging population keeps both tracks in demand — internal medicine and geriatrics practices, long-term care and skilled nursing facilities, hospital medicine teams, and palliative programs all hire AGNPs.',
        ],
        highlights: [
            { title: 'Two Career Tracks', description: 'Choose clinic-based primary care or hospital-based acute care — or move between them over a career.', icon: 'Activity' },
            { title: 'Aging Demand Curve', description: 'An aging patient population keeps both the primary care and acute care tracks in steady demand.', icon: 'TrendingUp' },
            { title: 'Complex-Care Depth', description: 'Multimorbidity, polypharmacy, and geriatric syndromes reward clinicians who like hard clinical puzzles.', icon: 'Brain' },
        ],
        requirements: [
            'Graduate AGNP program (MSN or DNP) on the primary care or acute care track',
            'Primary care: AGPCNP-BC through ANCC or A-GNP through AANP',
            'Acute care: AGACNP-BC through ANCC or ACNPC-AG through AACN',
            'Active state APRN licensure and DEA registration; acute-care roles add hospital credentialing and privileging',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} The two tracks are paid differently: outpatient AGPCNP roles are typically salary plus productivity, while acute-care-track hospital roles add night, weekend, and holiday differentials on top of base. ${COMPARE_LISTINGS}`,
    },
    pediatric: {
        intro: [
            'Pediatric nurse practitioners (PNPs) care for infants, children, adolescents, and young adults — well-child visits, immunizations, developmental screening, and management of acute and chronic childhood conditions.',
            'Primary care PNPs practice in pediatric clinics, school-based health centers, and community programs; acute care PNPs work in children’s hospitals, PICUs, and inpatient specialty teams.',
        ],
        highlights: [
            { title: 'Kid-First Practice', description: 'Every visit is built around growth, development, and family-centered care.', icon: 'Baby' },
            { title: 'School & Community Reach', description: 'School-based clinics and community programs extend practice beyond the exam room.', icon: 'Home' },
            { title: 'Prevention Focus', description: 'Immunization schedules and developmental surveillance make prevention the core of the job.', icon: 'Shield' },
        ],
        requirements: [
            'Graduate pediatric NP program (MSN or DNP) on the primary care or acute care track',
            'National certification as CPNP-PC (primary care) or CPNP-AC (acute care) through PNCB — the ANCC pediatric primary care exam (PPCNP-BC) was retired, so it is no longer an entry route for new candidates',
            'Active state APRN licensure and DEA registration',
            'Pediatric acute-care roles typically expect PALS and children’s-hospital experience',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Pediatric primary care often posts modestly below adult-focused equivalents, while acute-care PNP roles in children’s hospitals close that gap with differentials and higher acuity. ${COMPARE_LISTINGS}`,
    },
    neonatal: {
        intro: [
            'Neonatal nurse practitioners (NNPs) manage premature and critically ill newborns in Level II–IV NICUs — attending high-risk deliveries, leading resuscitations, performing procedures such as line placement and intubation, and guiding families through intensive care courses.',
            'NNP practice is hospital-based and around-the-clock: rounding with neonatology teams, covering delivery services, and following infants from admission through discharge planning.',
        ],
        highlights: [
            { title: 'High-Acuity Practice', description: 'Resuscitations, procedures, and ventilator management put NNPs at the sharpest end of APRN practice.', icon: 'HeartPulse' },
            { title: 'Team-Based NICUs', description: 'Tight multidisciplinary teams — neonatologists, RNs, RTs, and pharmacists — share every case.', icon: 'Users' },
            { title: 'Differential-Heavy Pay', description: 'Nights, weekends, and call coverage add meaningful premiums to hospital base pay.', icon: 'Moon' },
        ],
        requirements: [
            'Graduate NNP program (MSN or DNP) — admission commonly requires Level III/IV NICU RN experience',
            'National certification as NNP-BC through the National Certification Corporation (NCC)',
            'Active state APRN licensure; NRP (Neonatal Resuscitation Program) is standard',
            'Hospital credentialing and privileging define the procedure scope for each role',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} NNP pay is hospital-scale and shift-structured: round-the-clock NICU coverage makes night, weekend, and call premiums a routine component of total pay rather than an occasional add-on. ${COMPARE_LISTINGS}`,
    },
    'women-health': {
        intro: [
            "Women's health nurse practitioners (WHNPs) provide gynecologic, reproductive, prenatal, and postpartum care — plus menopause management and well-person primary care across the lifespan.",
            'WHNPs practice in OB/GYN groups, family planning and reproductive health clinics, fertility centers, and public health programs. Some roles are gynecology-only; others carry prenatal and postpartum panels — scope varies by listing.',
        ],
        highlights: [
            { title: 'Reproductive-Health Depth', description: 'Contraception, fertility, prenatal, and menopause care in one focused scope.', icon: 'Heart' },
            { title: 'Procedures in Clinic', description: 'Colposcopy, LARC insertion, and biopsies keep office days procedural.', icon: 'Syringe' },
            { title: 'Lifespan Continuity', description: 'Patients often stay with the same WHNP from first exams through menopause.', icon: 'Users' },
        ],
        requirements: [
            "Graduate women's health NP program (MSN or DNP)",
            'National certification as WHNP-BC through the National Certification Corporation (NCC)',
            'Active state APRN licensure and DEA registration',
            'Employers commonly screen for colposcopy and LARC (IUD/implant) procedure skills',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} WHNP offers are usually a clinic salary; procedure-heavy practices and any obstetric call coverage add premiums, so scope details on the listing move the number more than geography alone. ${COMPARE_LISTINGS}`,
    },
    'acute-care': {
        intro: [
            'Acute care nurse practitioners (ACNPs) manage adults with complex, acute, and critical illness in ICUs, step-down units, emergency departments, and hospital specialty services — rapid assessment, diagnostics, treatment plans, and procedures within granted privileges.',
            'Day to day, that means rounding with intensivist or specialty teams, running admissions and cross-cover, responding to deteriorating patients, and performing procedures such as central lines and arterial lines where privileged.',
        ],
        highlights: [
            { title: 'ICU-Level Acuity', description: 'The sickest adult patients, managed as part of intensivist-led teams.', icon: 'HeartPulse' },
            { title: 'Procedural Practice', description: 'Lines, airway support, and bedside procedures per hospital privileges.', icon: 'Syringe' },
            { title: 'Differential Pay', description: 'Shift-based hospital schedules carry night, weekend, and holiday premiums.', icon: 'Moon' },
        ],
        requirements: [
            'Graduate adult-gerontology acute care NP program (MSN or DNP)',
            'National certification as AGACNP-BC through ANCC or ACNPC-AG through AACN',
            'Acute-care RN background (ICU, ED, or step-down) preferred by most hospitals',
            'Active state APRN licensure; hospital credentialing and privileging define the procedure scope',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Hospital-based acute care pay is built as a base plus shift differentials — nights, weekends, and holidays stack on top — so a posted base rate understates what a full shift rotation actually pays. ${COMPARE_LISTINGS}`,
    },
    emergency: {
        intro: [
            'Emergency nurse practitioners (ENPs) evaluate and treat the full acuity spectrum of the emergency department — fast-track injuries and infections through supporting higher-acuity resuscitation care — in hospital EDs, freestanding emergency centers, and high-acuity urgent care.',
            'The work is shift-based and undifferentiated by design: you see what comes through the door, stabilize, treat, and disposition. Procedural volume is high — suturing, splinting, reductions, and bedside ultrasound where trained.',
        ],
        highlights: [
            { title: 'Full-Spectrum Acuity', description: 'From fast-track to resus support, no two shifts present the same case mix.', icon: 'Zap' },
            { title: 'Shift-Based Life', description: 'Block schedules with defined shifts — and no panel following you home.', icon: 'Clock' },
            { title: 'Procedure Volume', description: 'Lacerations, reductions, and point-of-care ultrasound keep hands-on skills current.', icon: 'Activity' },
        ],
        requirements: [
            'Most ENPs certify first as FNPs (FNP-C via AANP or FNP-BC via ANCC) for all-ages scope',
            'The ENP-C specialty credential (AANP certification board) is earned by certified FNPs with emergency preparation; some roles accept acute-care certification instead',
            'Active state APRN licensure and DEA registration',
            'ACLS and PALS are standard; trauma course completion strengthens candidacy',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Emergency compensation is shift-structured rather than salaried in most departments, and night, weekend, and holiday differentials are a standing part of the package instead of an exception. ${COMPARE_LISTINGS}`,
    },
    oncology: {
        intro: [
            'Oncology nurse practitioners manage patients through cancer treatment and beyond — symptom management, treatment monitoring, toxicity checks for chemotherapy and immunotherapy, and survivorship care in partnership with medical oncologists.',
            'Roles span academic cancer centers, community oncology practices, infusion clinics, and survivorship programs. The relationships are long: oncology NPs often follow the same patients across years of active treatment and surveillance.',
        ],
        highlights: [
            { title: 'Longitudinal Relationships', description: 'Patients are followed across treatment arcs measured in years, not visits.', icon: 'Heart' },
            { title: 'Science-Driven Field', description: 'Immunotherapy and targeted-agent pipelines mean treatment protocols change continually.', icon: 'Microscope' },
            { title: 'Survivorship Care', description: 'Dedicated survivorship clinics are an established NP-led service line in many cancer programs.', icon: 'TrendingUp' },
        ],
        requirements: [
            'Graduate NP degree with national certification through AANP or ANCC, on the track matching the practice population (family or adult-gerontology; pediatric via PNCB in children’s centers)',
            'The optional AOCNP credential through ONCC (Oncology Nursing Certification Corporation) recognizes oncology NP practice hours',
            'Active state APRN licensure and DEA registration',
            'Employers screen for chemotherapy/immunotherapy competencies and oncologic emergency recognition',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Oncology offers turn mostly on setting: academic cancer centers, community oncology groups, and infusion-heavy practices each structure base, productivity, and call differently for the same credential. ${COMPARE_LISTINGS}`,
    },
    cardiology: {
        intro: [
            'Cardiology nurse practitioners manage cardiovascular disease across clinic and hospital settings — heart failure clinics, device and electrophysiology programs, cath lab teams, and cardiovascular surgery step-down units.',
            'Core work includes guideline-directed medication titration, risk-factor management, device checks, stress-test supervision, and pre/post-procedure care alongside cardiologists.',
        ],
        highlights: [
            { title: 'Procedure-Adjacent Practice', description: 'Cath lab, EP, and device clinics keep the work technical and hands-on.', icon: 'HeartPulse' },
            { title: 'Chronic + Acute Mix', description: 'Longitudinal heart failure panels balance against acute inpatient consults.', icon: 'Activity' },
            { title: 'NP-Staffed Service Lines', description: 'Heart failure, device, and consult services are routinely staffed by NPs alongside cardiologists.', icon: 'TrendingUp' },
        ],
        requirements: [
            'Graduate NP degree with national certification through AANP or ANCC (adult-gerontology or family track per the practice population)',
            'Inpatient and ICU cardiology roles typically require the acute care track: AGACNP-BC (ANCC) or ACNPC-AG (AACN)',
            'Active state APRN licensure and DEA registration; ACLS is standard',
            'Employers screen for ECG interpretation and guideline-directed heart-failure therapy fluency',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Cardiology packages frequently layer call stipends and procedural-clinic premiums onto base, so an inpatient or call-carrying role and a clinic-only role rarely price the same even in one system. ${COMPARE_LISTINGS}`,
    },
    'primary-care': {
        intro: [
            'Primary care nurse practitioners are the front door of the health system — first-contact assessment, prevention, chronic disease management, and care coordination for a continuity panel of patients.',
            'Outpatient clinics, FQHCs, value-based care groups, and telehealth panels all build their models on primary care NPs. The setting mix ranges from traditional fee-for-service practices to team-based, quality-incentivized care organizations.',
        ],
        highlights: [
            { title: 'Continuity of Care', description: 'A panel of your own patients, followed across years — the core of primary care.', icon: 'Heart' },
            { title: 'Urban to Rural Reach', description: 'Primary care roles post across urban FQHCs, suburban group practices, and rural health clinics alike.', icon: 'Building2' },
            { title: 'Loan-Repayment Pathways', description: 'FQHC and shortage-area roles frequently qualify for NHSC and PSLF programs.', icon: 'GraduationCap' },
        ],
        requirements: [
            'Graduate NP degree on a primary care track: FNP (all ages), AGPCNP (adults), or PNP-PC (pediatrics)',
            'National certification through AANP or ANCC for FNP/AGNP tracks, or PNCB for pediatric primary care',
            'Active state APRN licensure and DEA registration',
            'Panel-management, preventive-care, and EHR workflow fluency are the common screening criteria',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Primary care packages lean on panel size and quality incentives rather than shift differentials, and FQHC or shortage-area roles often add loan-repayment programs that change total compensation more than base alone suggests. ${COMPARE_LISTINGS}`,
    },
    hospitalist: {
        intro: [
            'Hospitalist nurse practitioners practice inpatient medicine — admissions, daily rounding, cross-cover, and discharge planning on hospital medicine teams, co-managing patients with physician hospitalists.',
            'Schedules are block-based, commonly seven-on/seven-off with day and night rotations. The patient population is adult general medicine: multimorbid, acutely ill, and turning over constantly.',
        ],
        highlights: [
            { title: 'Block Scheduling', description: 'Seven-on/seven-off patterns concentrate work weeks and open real time off.', icon: 'Calendar' },
            { title: 'Team Medicine', description: 'Co-managed services with physician hospitalists, pharmacists, and case management.', icon: 'Users' },
            { title: 'Inpatient Breadth', description: 'General medicine acuity without a procedure-suite subspecialty focus.', icon: 'Building2' },
        ],
        requirements: [
            'Graduate NP degree; adult inpatient medicine teams prefer the acute care track',
            'National certification as AGACNP-BC through ANCC or ACNPC-AG through AACN (some services consider FNPs with inpatient experience — check each listing)',
            'Active state APRN licensure; hospital credentialing and privileging define scope',
            'Employers screen for admission/discharge workflow fluency and cross-cover judgment',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Hospitalist pay is priced against a block schedule rather than an office week, with night-block and holiday differentials layered onto base — compare the shift commitment, not just the headline number. ${COMPARE_LISTINGS}`,
    },
    dermatology: {
        intro: [
            'Dermatology nurse practitioners manage medical dermatology — acne, psoriasis, eczema, and skin cancer surveillance — alongside procedural work: biopsies, cryotherapy, and, in many practices, cosmetic services.',
            'The setting is clinic-based with weekday schedules. Practices range from medical-only groups to high-volume medical/cosmetic hybrids, and appointment books are commonly scheduled weeks ahead.',
        ],
        highlights: [
            { title: 'Procedure-Heavy Clinic Days', description: 'Biopsies, cryotherapy, and injectables keep clinic days hands-on.', icon: 'Syringe' },
            { title: 'Predictable Schedule', description: 'Weekday clinic hours with no inpatient call in most practices.', icon: 'Sun' },
            { title: 'Productivity Upside', description: 'Volume- and cosmetic-service bonuses reward efficient, skilled clinicians.', icon: 'DollarSign' },
        ],
        requirements: [
            'Graduate NP degree with national certification through AANP or ANCC (family or adult-gerontology track)',
            'Dermatology is learned in practice: employers screen for derm experience or structured on-the-job training',
            'The optional DCNP credential through the Dermatology Nursing Certification Board recognizes dermatology NP practice hours',
            'Active state APRN licensure and DEA registration',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Dermatology offers commonly pair a base with productivity and cosmetic-service bonuses, so in high-volume practices the variable component can be a large share of total compensation. ${COMPARE_LISTINGS}`,
    },
    orthopedic: {
        intro: [
            'Orthopedic nurse practitioners work across sports medicine, joint replacement, and spine practices — fracture care, joint injections, pre- and post-operative management, and first-assist duties in the OR for surgical roles.',
            'The typical week mixes clinic (new injuries, post-op checks, injections) with OR days for NPs credentialed to first-assist. Patient populations run from student athletes to joint-replacement candidates.',
        ],
        highlights: [
            { title: 'Clinic + OR Mix', description: 'First-assist roles split time between clinic panels and the operating room.', icon: 'Bone' },
            { title: 'Active Populations', description: 'Athletes and active adults bring goal-driven, recovery-focused care plans.', icon: 'Zap' },
            { title: 'Hands-On Procedures', description: 'Casting, splinting, reductions, and image-guided injections fill clinic days.', icon: 'Activity' },
        ],
        requirements: [
            'Graduate NP degree with national certification through AANP or ANCC (family or adult-gerontology track per the practice population)',
            'The optional ONP-C credential through the Orthopaedic Nurses Certification Board (ONCB) recognizes orthopedic NP practice',
            'Surgical roles require RNFA or first-assist credentialing per hospital policy',
            'Active state APRN licensure; casting, splinting, and joint-injection skills are standard screens',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Orthopedic packages separate on OR involvement: surgical practices add call stipends and first-assist premiums that clinic-only roles do not carry. ${COMPARE_LISTINGS}`,
    },
    anesthesia: {
        intro: [
            'Certified registered nurse anesthetists (CRNAs) plan and deliver anesthesia care — general, regional, and sedation — across surgical, obstetric, and procedural settings, managing patients before, during, and after anesthesia.',
            'CRNAs staff hospital ORs, ambulatory surgery centers, obstetric units, and endoscopy and interventional suites. In many rural facilities they are the primary anesthesia providers, carrying full perioperative responsibility.',
        ],
        highlights: [
            { title: 'Top of APRN Pay', description: 'CRNA compensation anchors the highest tier of advanced practice nursing.', icon: 'DollarSign' },
            { title: 'OR Autonomy', description: 'Full anesthetic responsibility, case by case — especially in independent and rural practices.', icon: 'Shield' },
            { title: 'Case Variety', description: 'From outpatient endoscopy to major surgery and obstetrics, no two case lists match.', icon: 'Activity' },
        ],
        requirements: [
            'Graduate nurse anesthesia program accredited by the Council on Accreditation (COA) — admission requires critical-care RN experience',
            'Pass the National Certification Examination administered by NBCRNA',
            'Maintain certification through NBCRNA’s Continued Professional Certification (CPC) program',
            'Active state APRN/CRNA licensure; supervision rules are set by state law and facility policy',
        ],
        salaryNarrative: `CRNA compensation sits at the top of the APRN pay scale and is not benchmarked by the all-NP median of ${NP_MEDIAN_CITED}, which covers nurse practitioners rather than nurse anesthetists. Call burden, case mix, and supervision model drive most of the spread between offers. ${COMPARE_LISTINGS}`,
    },
    midwifery: {
        intro: [
            'Certified nurse midwives (CNMs) provide prenatal care, attend labor and birth, and deliver postpartum, newborn, gynecologic, and well-person care — many also provide contraceptive counseling and primary care for women across the lifespan.',
            'Practice models vary widely: hospital labor and delivery services, freestanding birth centers, OB/GYN group practices, community health programs, and home-birth practices — each with its own call structure and birth volume.',
        ],
        highlights: [
            { title: 'Birth-Centered Practice', description: 'Attending births is the heart of the role — across hospitals, birth centers, and homes.', icon: 'Baby' },
            { title: 'Continuity Across Life', description: 'Many patients keep their midwife for gynecologic and well-person care between pregnancies.', icon: 'Heart' },
            { title: 'Multiple Practice Models', description: 'Hospital-employed, birth-center, and independent models offer real choice in how you practice.', icon: 'Home' },
        ],
        requirements: [
            'Graduate midwifery program accredited by the Accreditation Commission for Midwifery Education (ACME)',
            'Pass the national certification examination of the American Midwifery Certification Board (AMCB)',
            'Maintain certification through AMCB’s recertification program, alongside state APRN licensure',
            'Call expectations and birth-volume commitments vary by model — clarify both before accepting',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} CNM pay varies more with call structure and birth volume than with geography alone — hospital-employed, birth-center, and private-practice models each price differently. ${COMPARE_LISTINGS}`,
    },
    // ── 2026-07 P1 #15 verticals (new taxonomy slugs) ────────────────────────
    // The three specialty folders added by the taxonomy expansion wrap the same
    // template, so they get editorial here too — otherwise they ship as the
    // byte-identical shells this package exists to eliminate.
    aesthetics: {
        intro: [
            'Aesthetic nurse practitioners deliver cosmetic and medical aesthetic care — neuromodulator and dermal filler injections, laser and energy-based treatments, skin rejuvenation, and medical-grade skincare planning — for patients seeking elective procedures.',
            'The setting is almost entirely outpatient: medical spas, dermatology and plastic surgery practices, and NP-owned aesthetic clinics. Roles are consultative and elective, so patient communication, photography and outcome documentation, and repeat-visit relationships matter as much as injection technique.',
        ],
        highlights: [
            { title: 'Elective, Scheduled Care', description: 'Booked appointments and no inpatient call make the schedule unusually predictable.', icon: 'Calendar' },
            { title: 'Procedure-Led Practice', description: 'Injectables, lasers, and energy-based devices make the work almost entirely hands-on.', icon: 'Syringe' },
            { title: 'Ownership Pathways', description: 'NP-owned aesthetic clinics are a well-established route out of employed practice.', icon: 'TrendingUp' },
        ],
        requirements: [
            'Graduate NP degree with national certification through AANP or ANCC (family or adult-gerontology track per the practice population)',
            'Aesthetics is learned in practice: employers screen for injectable training (neuromodulators and dermal fillers) and device experience, often via manufacturer-led programs',
            'The optional CANS credential through the Plastic Surgical Nursing Certification Board recognizes aesthetic practice hours',
            'Active state APRN licensure; medical-director, delegation, and supervision rules for cosmetic procedures are set by state law — check your state board of nursing',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Aesthetic roles frequently pair a base rate with commission on procedures and retail products, so total compensation depends heavily on patient volume and the practice's service mix. ${COMPARE_LISTINGS}`,
    },
    'pain-management': {
        intro: [
            'Pain management nurse practitioners evaluate and treat acute, chronic, and cancer-related pain — building multimodal plans that combine medication management, interventional procedures, physical rehabilitation, and behavioral approaches.',
            'Roles sit in interventional pain clinics, anesthesiology-led practices, spine and orthopedic groups, cancer centers, and hospital-based pain services. Much of the work is longitudinal: functional goal-setting, opioid stewardship, and coordination with surgery, physical therapy, and behavioral health.',
        ],
        highlights: [
            { title: 'Multimodal Practice', description: 'Medication, interventional, rehabilitative, and behavioral tools in one treatment plan.', icon: 'Brain' },
            { title: 'Procedure-Adjacent Clinics', description: 'Injections, blocks, and device programs keep interventional clinics technical.', icon: 'Syringe' },
            { title: 'Functional Outcomes', description: 'Success is measured in what patients can do again — not just a pain score.', icon: 'Activity' },
        ],
        requirements: [
            'Graduate NP degree with national certification through AANP or ANCC (family or adult-gerontology track per the practice population)',
            'Active state APRN licensure and DEA registration — controlled-substance prescribing is central to the role',
            'Controlled-substance rules, opioid-prescribing limits, and prescription drug monitoring program (PDMP) requirements are set state by state; confirm them with your state board before you start',
            'Employers screen for opioid stewardship, risk assessment, and interventional-procedure workflow experience',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Pain management pay varies with procedure mix — interventional, block-heavy practices carry productivity upside that medication-management-only roles do not. ${COMPARE_LISTINGS}`,
    },
    'palliative-hospice': {
        intro: [
            'Palliative and hospice nurse practitioners manage symptoms and goals of care for patients with serious, advanced, or life-limiting illness — pain and dyspnea control, advance care planning, and family support alongside interdisciplinary teams.',
            'Palliative roles run alongside active treatment in hospital consult services, clinics, and home-based programs; hospice roles focus on comfort-directed care at home, in facilities, and in inpatient hospice units. Both lean heavily on communication skills — goals-of-care conversations are the core clinical procedure.',
        ],
        highlights: [
            { title: 'Interdisciplinary by Design', description: 'Physicians, nurses, social workers, and chaplains share every plan of care.', icon: 'Users' },
            { title: 'Communication as Craft', description: 'Goals-of-care and advance care planning conversations are the central skill.', icon: 'Heart' },
            { title: 'Home and Facility Reach', description: 'Hospital consults, clinics, home visits, and inpatient units all hire for this specialty.', icon: 'Home' },
        ],
        requirements: [
            'Graduate NP degree with national certification through AANP or ANCC (adult-gerontology or family track per the patient population)',
            'The optional ACHPN credential through the Hospice and Palliative Credentialing Center (HPCC) recognizes advanced hospice and palliative practice',
            'Active state APRN licensure and DEA registration — symptom management relies on controlled-substance prescribing',
            'Employers screen for serious-illness communication skills and comfort with complex symptom management',
        ],
        salaryNarrative: `${MEDIAN_SENTENCE} Palliative and hospice programs commonly add mileage allowances or call stipends for home-based and on-call-carrying roles, which can change effective pay well beyond the posted base. ${COMPARE_LISTINGS}`,
    },
    'clinical-nurse-specialist': {
        intro: [
            'Clinical nurse specialists (CNSs) are APRNs who improve care at three levels at once: direct patient care in a specialty population, advancing nursing practice at the bedside, and driving system-level quality and safety outcomes.',
            'Health systems deploy CNSs across critical care, medical-surgical, pediatric, and other specialty lines — leading evidence-based practice changes, mentoring nursing staff, and owning quality metrics that span whole units.',
        ],
        highlights: [
            { title: 'System-Level Impact', description: 'CNS-led practice changes move outcomes for entire units, not single panels.', icon: 'TrendingUp' },
            { title: 'Evidence Into Practice', description: 'Translating research into bedside protocols is the core CNS craft.', icon: 'Microscope' },
            { title: 'Education & Mentorship', description: 'Developing nursing staff is built into the role, not squeezed around it.', icon: 'GraduationCap' },
        ],
        requirements: [
            'Graduate CNS program (MSN or DNP) in a defined specialty population',
            'National certification such as AGCNS-BC through ANCC or the ACCNS credentials through AACN',
            'Active state APRN licensure — CNS title recognition and prescriptive authority vary by state',
            'Employers screen for quality-improvement, evidence-based-practice, and staff-education experience',
        ],
        salaryNarrative: `CNS compensation varies with the health system's model for the role — clinical ladder placement, specialty line, and quality-program scope all move the number. ${COMPARE_LISTINGS}`,
    },
};

/**
 * Behavioral-health specialty entry — keyed via PSYCH_SPECIALTY_SLUG so the
 * reference-niche slug literal stays confined to the taxonomy registry
 * (same pattern as lib/pseo/city-narrative.ts). Copy deliberately avoids
 * the reference-niche terms the ratchet scans for.
 */
const PSYCH_LANDING_CONTENT: CategoryLandingContent = {
    intro: [
        'Behavioral-health nurse practitioners evaluate, diagnose, and treat conditions spanning mood, anxiety, trauma, and substance use across the lifespan — combining medication management with therapeutic intervention.',
        'The specialty is unusually setting-flexible: outpatient clinics, hospital units, integrated primary care, correctional health, and telepsychiatry platforms all hire for it, and virtual-first employers have made multi-state practice common.',
    ],
    highlights: [
        { title: 'Telehealth-Forward Specialty', description: 'Virtual-care platforms recruit heavily for this specialty, and multi-state licensure is common.', icon: 'Globe' },
        { title: 'Deep Therapeutic Relationships', description: 'Longitudinal medication management builds continuity most specialties rarely see.', icon: 'Brain' },
        { title: 'Broad Demand', description: 'Prescriber shortages keep hiring steady across a wide range of states and care settings.', icon: 'TrendingUp' },
    ],
    requirements: [
        'Graduate degree (MSN or DNP) in the specialty’s NP track',
        'National board certification for the specialty, administered by ANCC',
        'Active state APRN licensure and DEA registration — controlled-substance prescribing is central to the role',
        'Employers screen for both medication-management depth and therapy integration skills',
    ],
    salaryNarrative: `${MEDIAN_SENTENCE} Compensation in this specialty is shaped more by delivery model than by setting prestige: virtual-first employers price multi-state panels differently from site-based clinics, and prescriber demand keeps both competing for the same candidates. ${COMPARE_LISTINGS}`,
};

export const CATEGORY_LANDING_CONTENT: Record<string, CategoryLandingContent> = {
    ...BASE_CONTENT,
    ...(PSYCH_SPECIALTY_SLUG ? { [PSYCH_SPECIALTY_SLUG]: PSYCH_LANDING_CONTENT } : {}),
};

/** Slugs with bespoke landing editorial (every template-driven landing). */
export const CATEGORY_LANDING_CONTENT_SLUGS: readonly string[] = Object.keys(CATEGORY_LANDING_CONTENT);

/** Content for one landing slug, or null for slugs without editorial yet. */
export function getCategoryLandingContent(slug: string): CategoryLandingContent | null {
    return CATEGORY_LANDING_CONTENT[slug] ?? null;
}

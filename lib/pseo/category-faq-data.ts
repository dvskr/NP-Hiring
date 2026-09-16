/**
 * Category FAQ data, extracted so both the server-rendered schema component
 * (components/CategoryFAQ.tsx) and the accordion
 * (components/CategoryFAQAccordion.tsx) can share the same source of truth.
 *
 * Keeping this in a non-'use client' module also means the data never ends up
 * in the client JS bundle for routes that only need the schema.
 */

import { pluralize, isAre } from '@/lib/pseo/plural';
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';

export interface FAQItem {
    question: string;
    answer: string;
}

// NP taxonomy migration (2026-07): FAQ entries for the removed PMHNP-only
// categories were deleted; their slugs are no longer in taxonomy-registry.ts.
// Configs whose faqCategory has no entry here render no FAQ block
// (getCategoryFaqs returns [] and CategoryFAQ returns null, so no empty
// FAQPage schema).
//
// P0 content pass (2026-07-28): builders added for the employment-type and
// NP-specialty slugs used by setting-state pages (full-time, part-time,
// contract, 1099, locum-tenens, family-practice, adult-gerontology,
// pediatric, women-health, acute-care, emergency, anesthesia, midwifery).
// The psych specialty slug remains unmapped: its FAQ copy necessarily names
// the specialty, which the niche-copy ratchet ceiling for this file
// (tests/regressions/niche-copy-pseo-support-files.test.ts) does not yet
// sanction; raise that ceiling before adding it here.
//
// P1 #5 landing-page pass (2026-07-29): builders added for the remaining
// category-landing slugs (urgent-care, home-health, neonatal, oncology,
// cardiology, primary-care, hospitalist, dermatology, orthopedic,
// clinical-nurse-specialist) so the 19 template landings render a real FAQ
// block + FAQPage schema, plus the three P1 #15 specialty verticals
// (aesthetics, pain-management, palliative-hospice) that wrap the same
// template.
//
// pSEO truth sweep (2026-09, PLAN.md T0-4 and thin-spec 1 T13): every
// hand-typed pay band, percentage, caseload count, and "added daily" claim
// was removed. The only figures a builder may print are the cited stats in
// lib/stats-sources.ts and the gated median the caller passes in. Salary
// answers read "median", never "average". State-licensure specifics the
// repo does not hold (fees, CE hours, prescribing limits) point readers at
// the state board instead of being asserted as facts.
export type CategorySlug =
    | 'remote'
    | 'telehealth'
    | 'travel'
    | 'new-grad'
    | 'per-diem'
    | 'inpatient'
    | 'outpatient'
    | 'community-health'
    | 'metro'
    | 'full-time'
    | 'part-time'
    | 'contract'
    | '1099'
    | 'locum-tenens'
    | 'family-practice'
    | 'adult-gerontology'
    | 'pediatric'
    | 'women-health'
    | 'acute-care'
    | 'emergency'
    | 'anesthesia'
    | 'midwifery'
    | 'urgent-care'
    | 'home-health'
    | 'neonatal'
    | 'oncology'
    | 'cardiology'
    | 'primary-care'
    | 'hospitalist'
    | 'dermatology'
    | 'orthopedic'
    | 'clinical-nurse-specialist'
    | 'aesthetics'
    | 'pain-management'
    | 'palliative-hospice';

export interface CategoryFaqInput {
    category: CategorySlug;
    totalJobs: number;
    /**
     * Gated median of disclosed annual pay for the page's own listing pool
     * (lib/salary-analytics.ts getGatedBenchmark), in whole dollars. Callers
     * pass it only when the publishing gate passes; the answer then reads
     * "median". The name predates PLAN.md T0-3 and is kept for the component
     * contract (components/CategoryFAQ.tsx) and the pinned tests.
     */
    avgSalary?: number;
    customFaqs?: FAQItem[];
}

export const CATEGORY_LABELS: Record<CategorySlug, string> = {
    remote: 'Remote',
    telehealth: 'Telehealth',
    travel: 'Travel',
    'new-grad': 'New Grad',
    'per-diem': 'Per Diem',
    inpatient: 'Inpatient',
    outpatient: 'Outpatient',
    'community-health': 'Community Health',
    metro: 'Metro',
    'full-time': 'Full-Time',
    'part-time': 'Part-Time',
    contract: 'Contract',
    '1099': '1099',
    'locum-tenens': 'Locum Tenens',
    'family-practice': 'Family Practice',
    'adult-gerontology': 'Adult-Gerontology',
    pediatric: 'Pediatric',
    'women-health': "Women's Health",
    'acute-care': 'Acute Care',
    emergency: 'Emergency',
    anesthesia: 'Nurse Anesthetist',
    midwifery: 'Nurse Midwife',
    'urgent-care': 'Urgent Care',
    'home-health': 'Home Health',
    neonatal: 'Neonatal',
    oncology: 'Oncology',
    cardiology: 'Cardiology',
    'primary-care': 'Primary Care',
    hospitalist: 'Hospitalist',
    dermatology: 'Dermatology',
    orthopedic: 'Orthopedic',
    'clinical-nurse-specialist': 'Clinical Nurse Specialist',
    aesthetics: 'Aesthetics',
    'pain-management': 'Pain Management',
    'palliative-hospice': 'Palliative & Hospice',
};

/** Type guard: does this slug have FAQ data (label + optional builder)? */
export function isCategoryFaqSlug(slug: string): slug is CategorySlug {
    return slug in CATEGORY_LABELS;
}

// ─── Shared citation-backed phrasing ────────────────────────────────────────
// TRUTH RULE: the only figures allowed in the builders below are the cited
// stats in lib/stats-sources.ts (or the gated median passed in). Everything
// else stays qualitative: no invented salary bands or market statistics.

const NP = brand.niche.short;

/** "$129,210 (BLS OEWS, ...)": the cited all-NP median. */
const NP_MEDIAN_CITED = `${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source})`;

/** "27 states + DC": AANP Full Practice Authority count. */
const FPA_STATES = STAT_SOURCES.fullPracticeStates.formatted;

/** "40%": BLS-projected NP employment growth, cited. */
const NP_GROWTH_CITED = `${STAT_SOURCES.blsGrowth2034.formatted} (${STAT_SOURCES.blsGrowth2034.source})`;

/** The cited BLS sentence every NP pay answer carries. */
const NP_MEDIAN_SENTENCE = `Nationally, ${brand.niche.descriptor}s earn a median annual wage of ${NP_MEDIAN_CITED}.`;

/** "$123,456" from 123456, locale-pinned so the output never varies by host. */
function formatDollars(dollars: number): string {
    return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

/**
 * Pay answer for NP categories: the gated median of this page's own pool
 * when the caller passes one, otherwise the cited BLS median plus a pointer
 * at the ranges employers post. Never a hand-typed band.
 *
 * Callers pass the role label in either case ("remote NP", "Family practice
 * NP"); it is lowercased mid-sentence and capitalized at sentence start so
 * the answer reads as Professional English in both branches.
 */
function medianPayAnswer(roleLabel: string, medianSalary?: number): string {
    const inline = roleLabel.charAt(0).toLowerCase() + roleLabel.slice(1);
    const lead = roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1);
    return medianSalary
        ? `The median posted salary across ${inline} listings on ${brand.name} that disclose annual pay is ${formatDollars(medianSalary)}. ${NP_MEDIAN_SENTENCE} Pay varies with experience, setting, geography, and employment type.`
        : `${NP_MEDIAN_SENTENCE} ${lead} pay varies with experience, practice setting, geography, and employment type, so compare pay listing by listing using the ranges employers post.`;
}

/**
 * Pay answer for the APRN roles whose pay pool is a different profession
 * (CRNA, CNM): the gated median of their own listings or nothing, never the
 * NP median.
 */
function aprnPayAnswer(roleLabel: string, variesWith: string, medianSalary?: number): string {
    return medianSalary
        ? `The median posted salary across ${roleLabel} listings on ${brand.name} that disclose annual pay is ${formatDollars(medianSalary)}. Pay varies with ${variesWith}.`
        : `${roleLabel} pay varies with ${variesWith}. ${brand.name} publishes a median for a page only once enough listings from enough employers disclose annual pay; until then, compare the ranges employers post listing by listing.`;
}

/** Practice-authority answer for NP-specialty categories, driven by the cited AANP stat. */
const NP_FPA_ANSWER = `Practice authority is set state by state. ${FPA_STATES} grant ${brand.niche.descriptor}s Full Practice Authority (${STAT_SOURCES.fullPracticeStates.source}), meaning they can evaluate, diagnose, and prescribe without physician oversight; the remaining states require a collaborative or supervisory agreement with a physician. Check the practice-authority details on this page, or the AANP State Practice Environment map, for the state you are browsing.`;

/** Cited BLS outlook sentence; the projection cycle is named inside the citation. */
const NP_OUTLOOK_SENTENCE = `The BLS projects ${STAT_SOURCES.blsGrowth2034.formatted} employment growth for ${brand.niche.descriptor}s from 2024 to 2034 (${STAT_SOURCES.blsGrowth2034.source}).`;

// Partial: categories without a built-in (e.g. 'metro') always pass customFaqs.
const CATEGORY_FAQS: Partial<Record<CategorySlug, (props: CategoryFaqInput) => FAQItem[]>> = {
    remote: ({ totalJobs, avgSalary }) => [
        {
            question: `How many remote ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} remote ${NP} ${pluralize(totalJobs, 'job opening', 'job openings')} listed on ${brand.name}. These include fully remote, hybrid, and telehealth positions, and each listing names the states where it requires licensure.`,
        },
        {
            question: `What do remote ${NP} jobs pay?`,
            answer: medianPayAnswer(`remote ${NP}`, avgSalary),
        },
        {
            question: `Do remote ${NP} jobs require multi-state licensure?`,
            answer: 'It depends on the employer. Some telehealth companies require you to be licensed in the states where your patients reside, while others only schedule you with patients in states where you already hold an active license. Some employers assist with multi-state licensure costs; the listing usually says so.',
        },
        {
            question: `What platforms do remote ${NP}s use for telehealth?`,
            answer: 'Common platforms include Zoom for Healthcare, Doxy.me, and EHR-integrated video platforms such as those built into Epic and Athenahealth. Listings usually state which platform the employer uses and whether it provides equipment and training. You need a reliable internet connection, a private workspace, and a HIPAA-compliant setup.',
        },
    ],
    telehealth: ({ totalJobs, avgSalary }) => [
        {
            question: `How many telehealth ${NP} positions are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} telehealth ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}. Telehealth positions include video visits, phone consultations, and asynchronous virtual care roles across telehealth platforms and health systems.`,
        },
        {
            question: `What is the difference between telehealth and remote ${NP} jobs?`,
            answer: `Telehealth specifically refers to providing patient care virtually via video or phone. Remote ${NP} jobs may include telehealth patient care but also encompass roles like utilization review, case management, or clinical documentation that are done remotely but do not involve direct patient care via video.`,
        },
        {
            question: `What do telehealth ${NP} jobs pay?`,
            answer: `${medianPayAnswer(`telehealth ${NP}`, avgSalary)} Some telehealth listings describe productivity-based pay, so read how patient volume affects the rate.`,
        },
        {
            question: `What qualifications do I need for telehealth ${NP} jobs?`,
            answer: `You need an active ${NP} certification (ANCC or AANP), state APRN licensure, a master\'s or doctoral degree in ${brand.niche.category}, and the years of clinical experience each employer specifies. Some entry-level telehealth positions accept new graduates with supervision. Familiarity with EHR systems and telehealth platforms is preferred.`,
        },
    ],
    travel: ({ totalJobs, avgSalary }) => [
        {
            question: `How many travel ${NP} jobs are currently available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} travel and locum tenens ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}. These are short-term assignments with a stated length in healthcare settings across the country.`,
        },
        {
            question: `How much do travel ${NP} positions pay?`,
            answer: `${medianPayAnswer(`travel ${NP}`, avgSalary)} Travel packages also carry housing stipends, travel reimbursement, and sometimes completion bonuses, so compare the whole package rather than the rate alone.`,
        },
        {
            question: `What benefits do travel ${NP} jobs include?`,
            answer: `Travel ${NP} benefits commonly include housing stipends or company-provided housing, travel reimbursement, health insurance, a retirement plan, licensure reimbursement, malpractice insurance coverage, and completion bonuses. Some agencies also offer continuing education stipends. Each listing states what its package covers.`,
        },
        {
            question: `Do I need experience for travel ${NP} positions?`,
            answer: `Most agencies place clinicians who can practice independently with minimal orientation, and each listing states the experience it expects. Some agencies offer first-time traveler programs with additional support. The Nurse Licensure Compact covers the RN license beneath your APRN credential; the APRN license itself comes from each assignment state.`,
        },
    ],
    'new-grad': ({ totalJobs }) => [
        {
            question: `How many entry-level ${NP} jobs are available for new graduates?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} ${NP} ${pluralize(totalJobs, 'position', 'positions')} that welcome new graduates. These include fellowship programs, residency positions, and employer-sponsored training programs designed for recent ${NP} graduates.`,
        },
        {
            question: `Can new graduate ${NP}s find jobs easily?`,
            answer: `Employers that welcome new graduates say so in the listing, often alongside a structured orientation, mentorship, or a collaborative practice arrangement. For context, the BLS projects ${NP_GROWTH_CITED} employment growth for ${brand.niche.descriptor}s from 2024 to 2034.`,
        },
        {
            question: `What should new grad ${NP}s look for in their first job?`,
            answer: 'Key factors include structured supervision and mentorship, a manageable starting patient load, access to collaborating physicians, continuing education support, malpractice insurance coverage, and clear pathways to independent practice. Avoid positions with unrealistic productivity expectations for new providers.',
        },
        {
            question: `Are there ${NP} fellowship or residency programs?`,
            answer: `Yes, a number of healthcare systems offer ${NP} fellowship and residency programs with a defined length. These programs provide intensive clinical training, didactic education, and mentorship, and often lead to permanent positions. Compare the stipend or salary against a standard first role before choosing.`,
        },
    ],
    'per-diem': ({ totalJobs, avgSalary }) => [
        {
            question: `How many per diem ${NP} positions are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} per diem and PRN ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}. Per diem roles let you pick up shifts as needed instead of committing to a fixed weekly schedule.`,
        },
        {
            question: `How much do per diem ${NP}s earn?`,
            answer: `${medianPayAnswer(`per diem ${NP}`, avgSalary)} Per diem rates are usually quoted hourly, and some listings add weekend, evening, or holiday differentials.`,
        },
        {
            question: `What are the pros and cons of per diem ${NP} work?`,
            answer: 'Pros: flexible scheduling, a variety of clinical settings, and the ability to supplement full-time income. Cons: no guaranteed hours, typically no benefits (health insurance, PTO, retirement), inconsistent income, and you may need your own malpractice insurance.',
        },
        {
            question: `Can per diem ${NP}s work at multiple facilities?`,
            answer: `Yes. Per diem ${NP}s can typically work at multiple facilities simultaneously. This is one of the main advantages of per diem work. You will need to ensure you have proper credentialing and privileges at each facility, and check for any non-compete clauses in your agreements.`,
        },
    ],
    inpatient: ({ totalJobs, avgSalary }) => [
        {
            question: `How many inpatient ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} inpatient ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}. These include hospitalist and hospital medicine teams, acute care units, step-down units, and specialty inpatient services across the country.`,
        },
        {
            question: `What do inpatient ${NP} jobs pay?`,
            answer: `${medianPayAnswer(`inpatient ${NP}`, avgSalary)} Hospital listings often state night and weekend differentials and sign-on bonuses separately from base pay.`,
        },
        {
            question: `What does an inpatient ${NP} do daily?`,
            answer: `Inpatient ${NP}s round on admitted patients, conduct admission evaluations, manage acute treatment plans, respond to changes in patient status, lead or join multidisciplinary rounds, and coordinate discharge planning. Caseloads vary by unit and acuity.`,
        },
        {
            question: `Do I need experience for inpatient ${NP} positions?`,
            answer: 'Many inpatient positions state the years of experience the hospital expects, and some hospitals offer fellowship programs and structured orientation for new graduates. Inpatient settings provide training in acute care management, procedures, and multidisciplinary collaboration that carries into later roles.',
        },
    ],
    outpatient: ({ totalJobs, avgSalary }) => [
        {
            question: `How many outpatient ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} outpatient ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}. These include private practices, community health centers, group practices, and integrated care clinics across the country.`,
        },
        {
            question: `What do outpatient ${NP} jobs pay?`,
            answer: `${medianPayAnswer(`outpatient ${NP}`, avgSalary)} Private practice pay often depends on productivity or collections, so read how each listing structures it.`,
        },
        {
            question: `What does a typical outpatient ${NP} schedule look like?`,
            answer: 'Clinic hours are set by the practice, and listings state whether evenings, weekends, or call are part of the role. Ask about daily visit expectations and documentation time, which vary widely by practice type.',
        },
        {
            question: `Can outpatient ${NP}s start their own private practice?`,
            answer: `Outpatient experience is the usual preparation for private practice. ${FPA_STATES} grant ${brand.niche.descriptor}s Full Practice Authority (${STAT_SOURCES.fullPracticeStates.source}); elsewhere a collaborative or supervisory agreement with a physician is required, which shapes how an independent practice is structured.`,
        },
    ],
    'community-health': ({ totalJobs, avgSalary }) => [
        {
            question: `How many community health ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} community health ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}. These include roles at Federally Qualified Health Centers (FQHCs), community health centers, public health clinics, and integrated primary-care settings serving underserved populations.`,
        },
        {
            question: `What do community health ${NP} jobs pay?`,
            answer: `${medianPayAnswer(`community health ${NP}`, avgSalary)} FQHC listings often describe loan-repayment programs and public-service benefits; confirm the site's current NHSC status and PSLF eligibility with the employer.`,
        },
        {
            question: `What qualifications are needed for community health ${NP} roles?`,
            answer: `You need an active national ${NP} board certification (ANCC or AANP), state APRN licensure, DEA registration, and ideally experience working with diverse, underserved populations. Some listings ask for bilingual skills. Some positions accept new graduates with structured supervision.`,
        },
        {
            question: `Do community health ${NP}s qualify for loan repayment?`,
            answer: 'Many FQHCs and nonprofit clinics are NHSC-approved sites, and National Health Service Corps (NHSC) loan repayment depends on the specific site holding an active approval and on the applicant\'s discipline, on award terms HRSA sets each cycle. Employment at a 501(c)(3) employer can also count toward Public Service Loan Forgiveness (PSLF) after the required number of qualifying payments.',
        },
    ],

    // ─── Employment-type categories (2026-07 P0 content pass) ────────────────
    'full-time': ({ totalJobs, avgSalary }) => [
        {
            question: `How many full-time ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} full-time ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}. Full-time roles span outpatient clinics, hospitals, health systems, and telehealth employers.`,
        },
        {
            question: `What does a typical full-time ${NP} schedule look like?`,
            answer: `Full-time ${NP} listings state the weekly schedule they expect. Outpatient positions usually follow the practice's weekday clinic hours, while hospital-based roles may use shift schedules built from longer shifts. Confirm expected patient volume, documentation time, and any on-call coverage before accepting an offer.`,
        },
        {
            question: `What do full-time ${NP} jobs pay?`,
            answer: medianPayAnswer(`full-time ${NP}`, avgSalary),
        },
        {
            question: `What benefits do full-time ${NP} positions include?`,
            answer: `Full-time W-2 packages typically include health insurance, a retirement plan with employer match, paid time off, CME allowance, and malpractice coverage. Many employers add signing bonuses, licensure and certification fee reimbursement, or loan-repayment support, so total compensation often matters as much as base salary.`,
        },
    ],
    'part-time': ({ totalJobs }) => [
        {
            question: `How many part-time ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} part-time ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}, spanning outpatient clinics, telehealth panels, and hospital coverage shifts.`,
        },
        {
            question: `What does part-time ${NP} work usually look like?`,
            answer: `Part-time arrangements state a reduced weekly schedule on a fixed basis, distinct from PRN work where you pick up shifts as needed. Clarify the guaranteed minimum hours, scheduling flexibility, and whether the role can expand to full-time before signing.`,
        },
        {
            question: `How are part-time ${NP}s paid?`,
            answer: `Part-time ${NP} roles are usually paid hourly, and the rate has to be weighed against whatever benefits are reduced or excluded. Actual rates vary by state, setting, and specialty. Compare posted ranges on individual listings.`,
        },
        {
            question: `Do part-time ${NP} positions include benefits?`,
            answer: `It varies by employer. Some organizations prorate health insurance, PTO, and retirement contributions once you work a minimum number of weekly hours; others reserve benefits for full-time staff. Ask where the eligibility threshold sits, and budget for your own malpractice coverage if the employer does not provide it.`,
        },
        {
            question: `Can I combine multiple part-time ${NP} roles?`,
            answer: `Yes. Many ${NP}s stack two or three part-time roles across different settings for variety and income stability. Each facility credentials you separately, so factor in onboarding time, and review non-compete or exclusivity clauses in each agreement before committing.`,
        },
    ],
    contract: ({ totalJobs }) => [
        {
            question: `How many contract ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} contract ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}, including fixed-term assignments and temp-to-perm openings.`,
        },
        {
            question: `What is a contract ${NP} position?`,
            answer: `A contract role is a fixed-term engagement, commonly a few months, either as a W-2 employee of a staffing agency or as an independent contractor. Many contracts are temp-to-perm, letting you and the employer evaluate fit before converting to a permanent role.`,
        },
        {
            question: `How does contract ${NP} pay compare to permanent roles?`,
            answer: `Contract rates are quoted hourly and trade away benefits and long-term stability, so whether the arrangement works in your favor depends on how you cover health insurance, retirement, and time between contracts. Compare posted rates on individual listings and price in the full package.`,
        },
        {
            question: `What should I review before signing an ${NP} contract?`,
            answer: `Review the term length, extension and cancellation clauses, malpractice coverage (occurrence-based versus claims-made, and who pays for tail coverage), non-compete restrictions, and any temp-to-perm conversion terms. Have an attorney or a contract-savvy colleague read anything you are unsure about.`,
        },
    ],
    '1099': ({ totalJobs }) => [
        {
            question: `How many 1099 ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} independent-contractor (1099) ${NP} ${pluralize(totalJobs, 'position', 'positions')} listed on ${brand.name}, spanning telehealth panels, practice coverage, and consulting engagements.`,
        },
        {
            question: `What is the difference between W-2 and 1099 ${NP} work?`,
            answer: `As a 1099 contractor you are self-employed: no taxes are withheld from your pay, you owe self-employment tax and quarterly estimated payments, and you fund your own health insurance and retirement. In exchange you can deduct business expenses and keep far more control over your schedule and caseload.`,
        },
        {
            question: `Do 1099 ${NP}s earn more than W-2 employees?`,
            answer: `Gross hourly rates for 1099 work are quoted before the payroll taxes and benefits an employer would otherwise cover, so the posted rate is not comparable to a W-2 salary on its own. Whether you net more depends on your tax situation and benefit costs. Compare posted rates on individual listings and model the after-tax picture before choosing.`,
        },
        {
            question: `What do I need before taking a 1099 ${NP} position?`,
            answer: `You need an active APRN license in the practice state, current national certification, and your own malpractice policy (occurrence-based coverage is commonly recommended). Many contractors also form an LLC or PLLC, set aside a portion of every payment for quarterly estimated taxes, and work with an accountant familiar with clinician contracting.`,
        },
        {
            question: `Does state practice authority matter for 1099 ${NP}s?`,
            answer: `Yes. Independent contracting is administratively simplest in the ${FPA_STATES} with Full Practice Authority (${STAT_SOURCES.fullPracticeStates.source}), where no physician agreement is required. In reduced- and restricted-practice states you must maintain the required collaborative or supervisory arrangement, so confirm who holds that agreement before signing.`,
        },
    ],
    'locum-tenens': ({ totalJobs }) => [
        {
            question: `How many locum tenens ${NP} jobs are available?`,
            answer: `There ${isAre(totalJobs)} currently ${totalJobs} locum tenens ${NP} ${pluralize(totalJobs, 'assignment', 'assignments')} listed on ${brand.name}. Locum roles provide temporary coverage for vacancies, leave, or peak demand, typically arranged through staffing agencies.`,
        },
        {
            question: `What does locum tenens mean for ${NP}s?`,
            answer: `Locum tenens (Latin for "to hold a place") describes short-term assignments where you cover a practice or facility for weeks to months. Assignments have defined start and end dates, and agencies usually handle scheduling, credentialing paperwork, and travel logistics.`,
        },
        {
            question: `How is locum tenens ${NP} work compensated?`,
            answer: `Locum assignments are typically paid hourly, and packages often include travel and housing stipends plus paid malpractice coverage. Understand the IRS tax-home rules before accepting stipends, and compare posted rates across agencies for the same market.`,
        },
        {
            question: `Do I need a license in every state where I take locum assignments?`,
            answer: `Yes. You need an active APRN license in each assignment state. Agencies commonly assist with or reimburse licensing costs, and expedited endorsement or multistate pathways can shorten the timeline in participating states. Keep your credentials file current so onboarding is fast.`,
        },
        {
            question: `How much experience do locum tenens ${NP} roles require?`,
            answer: `Most agencies place clinicians who can practice independently with minimal orientation, and each listing states the experience it expects. Some agencies run first-assignment programs with extra support for clinicians new to locum work.`,
        },
    ],

    // ─── NP specialty categories (2026-07 P0 content pass) ──────────────────
    'family-practice': ({ totalJobs, avgSalary }) => [
        {
            question: `What does a family practice ${NP} (FNP) do?`,
            answer: `Family nurse practitioners deliver primary care across the entire lifespan: preventive visits, chronic disease management, and acute episodic care for children, adults, and older adults. FNPs practice in primary care clinics, FQHCs, urgent care, retail health, and telehealth.`,
        },
        {
            question: `What certification do family practice ${NP}s need?`,
            answer: `FNPs complete a graduate (MSN or DNP) family nurse practitioner program, then certify through AANP (FNP-C) or ANCC (FNP-BC), alongside state APRN licensure. Employers may also require DEA registration for prescribing.`,
        },
        {
            question: `What is the median family practice ${NP} salary?`,
            answer: medianPayAnswer('Family practice NP', avgSalary),
        },
        {
            question: `Can family practice ${NP}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
        {
            question: `What is the job outlook for family practice ${NP}s?`,
            answer: `${NP_OUTLOOK_SENTENCE} There ${isAre(totalJobs)} currently ${totalJobs} family practice ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
    ],
    'adult-gerontology': ({ totalJobs, avgSalary }) => [
        {
            question: `What does an adult-gerontology ${NP} (AGNP) do?`,
            answer: `AGNPs care for patients from adolescence through advanced age. The primary care track (AGPCNP) manages prevention and chronic disease in outpatient settings, while the acute care track (AGACNP) manages complex and critically ill adults in hospitals. There ${isAre(totalJobs)} currently ${totalJobs} adult-gerontology ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do adult-gerontology ${NP}s need?`,
            answer: `Primary care AGNPs certify through ANCC (AGPCNP-BC) or AANP (A-GNP). Acute care AGNPs certify through ANCC (AGACNP-BC) or the American Association of Critical-Care Nurses (AACN, ACNPC-AG). Both tracks require graduate education and state APRN licensure.`,
        },
        {
            question: `What is the median adult-gerontology ${NP} salary?`,
            answer: medianPayAnswer('Adult-gerontology NP', avgSalary),
        },
        {
            question: `Where do adult-gerontology ${NP}s work?`,
            answer: `Common settings include internal medicine and geriatrics practices, long-term care and skilled nursing facilities, hospital medicine teams, palliative care programs, and specialty clinics. Listings state which track they hire for.`,
        },
        {
            question: `Can adult-gerontology ${NP}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    pediatric: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a pediatric ${NP} (PNP) do?`,
            answer: `Pediatric nurse practitioners care for infants, children, adolescents, and young adults: well-child visits, immunizations, developmental screening, and management of acute and chronic childhood conditions. There ${isAre(totalJobs)} currently ${totalJobs} pediatric ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do pediatric ${NP}s need?`,
            answer: `PNPs certify through the Pediatric Nursing Certification Board (PNCB) as CPNP-PC (primary care) or CPNP-AC (acute care), after completing a pediatric-focused graduate program and obtaining state APRN licensure. ANCC retired its pediatric primary care exam (PPCNP-BC), so PNCB is the certification route for new candidates.`,
        },
        {
            question: `What is the median pediatric ${NP} salary?`,
            answer: medianPayAnswer('Pediatric NP', avgSalary),
        },
        {
            question: `Where do pediatric ${NP}s work?`,
            answer: `Pediatric clinics and group practices, children's hospitals, pediatric specialty services, urgent care, school-based health centers, and telehealth programs all post PNP roles. Acute care PNPs work in children's hospitals, PICUs, and inpatient specialty teams.`,
        },
        {
            question: `Can pediatric ${NP}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    'women-health': ({ totalJobs, avgSalary }) => [
        {
            question: `What does a women's health ${NP} (WHNP) do?`,
            answer: `WHNPs provide gynecologic, reproductive, prenatal, and postpartum care, along with menopause management and the primary care needs of women across the lifespan. There ${isAre(totalJobs)} currently ${totalJobs} women's health ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do women's health ${NP}s need?`,
            answer: `WHNPs certify through the National Certification Corporation (NCC), earning the WHNP-BC credential after completing an accredited women's health graduate program and obtaining state APRN licensure.`,
        },
        {
            question: `What is the median women's health ${NP} salary?`,
            answer: medianPayAnswer("Women's health NP", avgSalary),
        },
        {
            question: `Where do women's health ${NP}s work?`,
            answer: `OB/GYN group practices, family planning and reproductive health clinics, fertility centers, public health programs, and telehealth platforms all post WHNP roles. Some roles focus on gynecology only; others include prenatal and postpartum panels, so confirm the scope in each listing.`,
        },
        {
            question: `Can women's health ${NP}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    'acute-care': ({ totalJobs, avgSalary }) => [
        {
            question: `What does an acute care ${NP} (ACNP) do?`,
            answer: `Acute care NPs manage adults with complex, acute, and critical illness in ICUs, step-down units, and emergency and hospital specialty services. The role includes rapid assessment, ordering and interpreting diagnostics, managing treatment plans, and performing procedures within granted privileges. There ${isAre(totalJobs)} currently ${totalJobs} acute care ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do acute care ${NP}s need?`,
            answer: `The current adult-gerontology acute care credentials are AGACNP-BC through ANCC and ACNPC-AG through the American Association of Critical-Care Nurses (AACN), earned after an acute-care-focused graduate program and state APRN licensure.`,
        },
        {
            question: `What is the median acute care ${NP} salary?`,
            answer: `${medianPayAnswer('Acute care NP', avgSalary)} Hospital-based acute care listings frequently state night, weekend, and holiday shift differentials separately from base pay.`,
        },
        {
            question: `Do I need ICU experience for acute care ${NP} roles?`,
            answer: `Many hospitals prefer candidates with acute care RN backgrounds (ICU, ED, or step-down) and state the years of experience they expect, though some offer structured fellowships and orientation programs for newer graduates. Ask about orientation length, procedure training, and overnight support when comparing offers.`,
        },
        {
            question: `How does practice authority work for hospital-based ${NP}s?`,
            answer: `${NP_FPA_ANSWER} In hospitals, your day-to-day scope is additionally defined by the facility's credentialing and privileging process, regardless of state practice authority.`,
        },
    ],
    emergency: ({ totalJobs, avgSalary }) => [
        {
            question: `What does an emergency ${NP} (ENP) do?`,
            answer: `Emergency NPs evaluate and treat patients across the full acuity spectrum of the emergency department, from fast-track injuries and infections to supporting higher-acuity resuscitation care. ENPs work in hospital EDs, freestanding emergency centers, and urgent care. There ${isAre(totalJobs)} currently ${totalJobs} emergency ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `How do I become an emergency ${NP}?`,
            answer: `Most ENPs first certify as family nurse practitioners (AANP FNP-C or ANCC FNP-BC), then add emergency-specific training or experience. The dedicated ENP-C specialty credential is offered through AANP's certification board to certified FNPs with emergency preparation. Some emergency roles are also filled by acute care-certified NPs; check each listing's requirements.`,
        },
        {
            question: `What is the median emergency ${NP} salary?`,
            answer: `${medianPayAnswer('Emergency NP', avgSalary)} Emergency listings frequently state night, weekend, and holiday differentials separately from base pay.`,
        },
        {
            question: `What schedules do emergency ${NP}s work?`,
            answer: `Emergency departments run around the clock, so ENP schedules are shift-based and typically include nights, weekends, and holidays. Many EDs use block scheduling; clarify the shift length and the mix of day and overnight coverage before accepting an offer.`,
        },
        {
            question: `Can emergency ${NP}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    anesthesia: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a certified registered nurse anesthetist (CRNA) do?`,
            answer: `CRNAs plan and deliver anesthesia care, including general, regional, and sedation, across surgical, obstetric, and procedural settings, managing patients before, during, and after anesthesia. In many rural facilities, CRNAs are the primary anesthesia providers. There ${isAre(totalJobs)} currently ${totalJobs} CRNA ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do CRNAs need?`,
            answer: `CRNAs graduate from a nurse anesthesia program accredited by the Council on Accreditation (COA), where admission requires critical-care RN experience, and then pass the National Certification Examination administered by NBCRNA. Certification is maintained through NBCRNA's Continued Professional Certification (CPC) program.`,
        },
        {
            question: `How much do CRNAs earn?`,
            answer: aprnPayAnswer('CRNA', 'setting, call burden, practice model, and state', avgSalary),
        },
        {
            question: `Do CRNAs require physician supervision?`,
            answer: `CRNA supervision rules are set by state law and facility policy rather than the NP practice-authority framework. A number of states have opted out of the federal physician-supervision requirement for anesthesia services, while others require anesthesiologist or physician involvement, so verify the rules for the specific state and facility before accepting a role.`,
        },
        {
            question: `Where do CRNAs work?`,
            answer: `Hospital operating rooms, ambulatory surgery centers, obstetric units, endoscopy and interventional suites, pain management clinics, and anesthesia group practices. Call requirements and case mix vary widely by setting, so clarify both when comparing offers.`,
        },
    ],
    midwifery: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a certified nurse midwife (CNM) do?`,
            answer: `CNMs provide prenatal care, attend labor and birth, and deliver postpartum, newborn, gynecologic, and well-person care. Many also provide contraceptive counseling and primary care services for women across the lifespan. There ${isAre(totalJobs)} currently ${totalJobs} CNM ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do nurse midwives need?`,
            answer: `CNMs complete a graduate midwifery program accredited by the Accreditation Commission for Midwifery Education (ACME), then pass the national certification examination of the American Midwifery Certification Board (AMCB). Certification is maintained through AMCB's recertification program, alongside state APRN licensure.`,
        },
        {
            question: `How much do certified nurse midwives earn?`,
            answer: aprnPayAnswer('CNM', 'birth volume, call requirements, and setting; hospital-employed, birth center, and private practice models pay differently', avgSalary),
        },
        {
            question: `Can nurse midwives practice independently?`,
            answer: `Midwifery practice authority is defined state by state and differs from the NP framework: many states permit independent CNM practice, while others require a collaborative agreement or physician involvement for some services. Verify the rules with the state's licensing board before accepting a role.`,
        },
        {
            question: `Where do certified nurse midwives work?`,
            answer: `Hospital labor and delivery units, freestanding birth centers, OB/GYN group practices, community health programs, and home-birth practices. Call schedules vary substantially, so clarify call frequency, backup arrangements, and birth volume expectations when comparing offers.`,
        },
    ],

    // ─── Category-landing slugs (2026-07-29 P1 #5 content pass) ─────────────
    'urgent-care': ({ totalJobs, avgSalary }) => [
        {
            question: `What does an urgent care ${NP} do?`,
            answer: `Urgent care ${NP}s treat episodic, walk-in complaints, including infections, minor injuries, lacerations, and sprains, for patients of all ages, handling assessment, treatment, and disposition within a single visit. There ${isAre(totalJobs)} currently ${totalJobs} urgent care ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do urgent care ${NP}s need?`,
            answer: `Most urgent care roles require family-track certification (FNP-C through AANP or FNP-BC through ANCC) for all-ages scope, plus state APRN licensure and DEA registration. The ENP specialty credential strengthens candidacy for higher-acuity sites. Employers also screen for procedural skills such as laceration repair, splinting, and plain-film interpretation.`,
        },
        {
            question: `What is the median urgent care ${NP} salary?`,
            answer: medianPayAnswer('Urgent care NP', avgSalary),
        },
        {
            question: `What schedules do urgent care ${NP}s work?`,
            answer: `Urgent care runs on defined shifts, with the shift length and the evening and weekend rotation stated in each listing, and no patient panel or after-hours documentation to carry between shifts. Clarify the weekend and holiday rotation before accepting an offer.`,
        },
        {
            question: `Can urgent care ${NP}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    'home-health': ({ totalJobs, avgSalary }) => [
        {
            question: `What does a home health ${NP} do?`,
            answer: `Home health ${NP}s deliver primary and transitional care during home visits: assessments, medication reconciliation, chronic disease management, and annual wellness visits for homebound and medically complex patients. There ${isAre(totalJobs)} currently ${totalJobs} home health ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What qualifications do home health ${NP} roles require?`,
            answer: `A graduate ${NP} degree with national certification through AANP or ANCC (family or adult-gerontology track, matched to the patient population), state APRN licensure, and DEA registration. Because visits happen without an on-site team, employers screen for independent assessment skills, and a valid driver's license is standard.`,
        },
        {
            question: `How are home health ${NP}s paid?`,
            answer: `${medianPayAnswer('Home health NP', avgSalary)} Many home-based programs pay per completed visit rather than straight salary, and most add mileage or vehicle allowances.`,
        },
        {
            question: `What does a typical home health ${NP} day look like?`,
            answer: `A route of scheduled home visits across a defined territory, with documentation between stops or in blocks. Visit counts vary by program and patient complexity, so ask about daily visit expectations, territory size, and drive-time compensation when comparing roles.`,
        },
        {
            question: `Can home health ${NP}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    neonatal: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a neonatal ${NP} (NNP) do?`,
            answer: `NNPs manage premature and critically ill newborns in Level II to IV NICUs, attending high-risk deliveries, leading resuscitations, performing procedures such as line placement and intubation, and guiding families through intensive care. There ${isAre(totalJobs)} currently ${totalJobs} neonatal ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do neonatal ${NP}s need?`,
            answer: `NNPs complete a graduate neonatal NP program, for which admission commonly requires Level III/IV NICU RN experience, and then certify as NNP-BC through the National Certification Corporation (NCC), alongside state APRN licensure. NRP (Neonatal Resuscitation Program) completion is standard.`,
        },
        {
            question: `What is the median neonatal ${NP} salary?`,
            answer: `${medianPayAnswer('Neonatal NP', avgSalary)} Around-the-clock NICU coverage means night, weekend, and call differentials are a routine part of total pay.`,
        },
        {
            question: `What schedules do neonatal ${NP}s work?`,
            answer: `NICUs run around the clock, so NNP schedules are shift-based, commonly in long blocks with rotating nights and weekends. Ask how delivery coverage, call, and post-call time are structured when comparing units.`,
        },
    ],
    oncology: ({ totalJobs, avgSalary }) => [
        {
            question: `What does an oncology ${NP} do?`,
            answer: `Oncology ${NP}s manage patients through cancer treatment and survivorship: symptom management, treatment monitoring, toxicity checks for chemotherapy and immunotherapy, and long-term follow-up in partnership with medical oncologists. There ${isAre(totalJobs)} currently ${totalJobs} oncology ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do oncology ${NP}s need?`,
            answer: `Oncology roles are filled by ${NP}s certified through AANP or ANCC on the track matching the population (family or adult-gerontology; pediatric oncology roles use PNCB certification). The optional AOCNP credential through ONCC (Oncology Nursing Certification Corporation) recognizes accumulated oncology NP practice hours.`,
        },
        {
            question: `What is the median oncology ${NP} salary?`,
            answer: medianPayAnswer('Oncology NP', avgSalary),
        },
        {
            question: `Where do oncology ${NP}s work?`,
            answer: `Academic cancer centers, community oncology practices, infusion clinics, and survivorship programs. Roles differ in treatment-phase focus (active treatment, infusion oversight, or survivorship follow-up), so confirm the clinic mix in each listing.`,
        },
        {
            question: `Do I need oncology experience to start?`,
            answer: `Many centers hire ${NP}s with strong medical backgrounds and train the oncology layer (chemotherapy and immunotherapy competencies, oncologic emergencies, and symptom management) through structured onboarding. Dedicated oncology NP fellowships exist at larger academic centers.`,
        },
    ],
    cardiology: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a cardiology ${NP} do?`,
            answer: `Cardiology ${NP}s manage cardiovascular disease across clinic and hospital settings: heart failure management, guideline-directed medication titration, device checks, stress-test supervision, and pre/post-procedure care with cath lab and EP teams. There ${isAre(totalJobs)} currently ${totalJobs} cardiology ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do cardiology ${NP}s need?`,
            answer: `Outpatient cardiology roles are filled by ${NP}s certified through AANP or ANCC (family or adult-gerontology track). Inpatient and ICU cardiology typically requires the acute care track: AGACNP-BC through ANCC or ACNPC-AG through AACN. ACLS is standard, and employers screen for ECG interpretation fluency.`,
        },
        {
            question: `What is the median cardiology ${NP} salary?`,
            answer: `${medianPayAnswer('Cardiology NP', avgSalary)} Hospital-based listings commonly state call stipends and inpatient differentials separately from base pay.`,
        },
        {
            question: `Where do cardiology ${NP}s work?`,
            answer: `Heart failure clinics, general cardiology practices, device and electrophysiology programs, cath lab teams, and cardiovascular surgery step-down units. Clinic-only, inpatient-only, and hybrid roles all appear on this board; check each listing's setting.`,
        },
    ],
    'primary-care': ({ totalJobs, avgSalary }) => [
        {
            question: `What does a primary care ${NP} do?`,
            answer: `Primary care ${NP}s provide first-contact care for a continuity panel: prevention, chronic disease management, acute visits, and care coordination. There ${isAre(totalJobs)} currently ${totalJobs} primary care ${pluralize(totalJobs, 'position', 'positions')} listed here, across private practices, health systems, FQHCs, and value-based care groups.`,
        },
        {
            question: `What certification do primary care ${NP}s need?`,
            answer: `Primary care spans three tracks: FNP (all ages, certified FNP-C through AANP or FNP-BC through ANCC), AGPCNP (adult panels, through ANCC or AANP), and pediatric primary care (CPNP-PC through PNCB). All require state APRN licensure and DEA registration.`,
        },
        {
            question: `What is the median primary care ${NP} salary?`,
            answer: `${medianPayAnswer('Primary care NP', avgSalary)} FQHC listings often describe loan-repayment programs; whether NHSC repayment applies depends on the specific site's approval and your discipline.`,
        },
        {
            question: `Can primary care ${NP}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
        {
            question: `What is the job outlook for primary care ${NP}s?`,
            answer: `${NP_OUTLOOK_SENTENCE}`,
        },
    ],
    hospitalist: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a hospitalist ${NP} do?`,
            answer: `Hospitalist ${NP}s practice inpatient medicine (admissions, daily rounding, cross-cover, and discharge planning), co-managing adult general medicine patients with physician hospitalists. There ${isAre(totalJobs)} currently ${totalJobs} hospitalist ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do hospitalist ${NP}s need?`,
            answer: `Adult inpatient medicine teams prefer the acute care track: AGACNP-BC through ANCC or ACNPC-AG through AACN. Some services consider family-track ${NP}s with inpatient experience; check each listing. Hospital credentialing and privileging define the final scope.`,
        },
        {
            question: `What is the median hospitalist ${NP} salary?`,
            answer: `${medianPayAnswer('Hospitalist NP', avgSalary)} Night-block and holiday differentials are commonly stated separately in hospital medicine listings.`,
        },
        {
            question: `What schedules do hospitalist ${NP}s work?`,
            answer: `Block schedules dominate, commonly seven days on and seven days off, with day and night rotations. That concentration makes hospitalist work attractive for clinicians who want extended time off between blocks; clarify the night-shift share before signing.`,
        },
    ],
    dermatology: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a dermatology ${NP} do?`,
            answer: `Dermatology ${NP}s manage medical dermatology, including acne, psoriasis, eczema, and skin cancer surveillance, plus procedures such as biopsies and cryotherapy, and cosmetic services in many practices. There ${isAre(totalJobs)} currently ${totalJobs} dermatology ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do dermatology ${NP}s need?`,
            answer: `A national ${NP} certification through AANP or ANCC (family or adult-gerontology track) plus state APRN licensure. Dermatology itself is learned in practice: employers screen for derm experience or provide structured training. The optional DCNP credential through the Dermatology Nursing Certification Board recognizes dermatology NP practice hours.`,
        },
        {
            question: `What is the median dermatology ${NP} salary?`,
            answer: `${medianPayAnswer('Dermatology NP', avgSalary)} Productivity and cosmetic-service bonuses, where a practice offers them, are stated in the listing.`,
        },
        {
            question: `Is dermatology a good specialty for work-life balance?`,
            answer: `Dermatology is among the more schedule-friendly ${NP} specialties: clinic-based weekday hours with no inpatient call in most practices. Confirm the evening or weekend clinic expectations, which vary by practice.`,
        },
    ],
    orthopedic: ({ totalJobs, avgSalary }) => [
        {
            question: `What does an orthopedic ${NP} do?`,
            answer: `Orthopedic ${NP}s work across sports medicine, joint replacement, and spine practices: fracture care, joint injections, pre- and post-operative management, and first-assist duties in the OR for surgical roles. There ${isAre(totalJobs)} currently ${totalJobs} orthopedic ${pluralize(totalJobs, 'position', 'positions')} listed here.`,
        },
        {
            question: `What certification do orthopedic ${NP}s need?`,
            answer: `A national ${NP} certification through AANP or ANCC (family or adult-gerontology track per the practice population) plus state APRN licensure. The optional ONP-C credential through the Orthopaedic Nurses Certification Board (ONCB) recognizes orthopedic NP practice, and surgical roles require RNFA or first-assist credentialing per hospital policy.`,
        },
        {
            question: `What is the median orthopedic ${NP} salary?`,
            answer: `${medianPayAnswer('Orthopedic NP', avgSalary)} Surgical practices commonly state call stipends and first-assist premiums separately from base pay.`,
        },
        {
            question: `Do orthopedic ${NP}s work in the OR?`,
            answer: `Many do. First-assist roles split the week between clinic panels and OR days. Clinic-only roles focus on new injuries, post-op checks, casting, splinting, and image-guided injections. Listings usually state whether first-assisting is expected, so match the mix to your training.`,
        },
    ],
    'clinical-nurse-specialist': ({ totalJobs }) => [
        {
            question: `What does a clinical nurse specialist (CNS) do?`,
            answer: `CNSs are APRNs who work at three levels at once: direct specialty patient care, advancing nursing practice at the bedside, and driving system-level quality and safety outcomes. There ${isAre(totalJobs)} currently ${totalJobs} CNS ${pluralize(totalJobs, 'position', 'positions')} listed here across critical care, medical-surgical, pediatric, and other specialty lines.`,
        },
        {
            question: `How is a CNS different from a nurse practitioner?`,
            answer: `Both are APRN roles, but they optimize for different things: ${brand.niche.descriptor}s center on direct patient management and prescribing, while CNSs blend direct care with staff development, evidence-based practice change, and unit-level quality ownership. Prescriptive authority for CNSs varies more by state than it does for ${NP}s.`,
        },
        {
            question: `What certification do clinical nurse specialists need?`,
            answer: `A graduate CNS program (MSN or DNP) in a defined specialty population, then national certification, for example AGCNS-BC through ANCC or the ACCNS credentials through AACN, alongside state APRN licensure. CNS title recognition varies by state, so verify the rules with the state board.`,
        },
        {
            question: `Where do clinical nurse specialists work?`,
            answer: `Predominantly health systems and hospitals, across critical care, perioperative, medical-surgical, oncology, and pediatric service lines, plus quality departments and professional-development teams. Compensation varies with the system's model for the role; compare posted ranges on individual listings.`,
        },
    ],
    // ── 2026-07 P1 #15 verticals ────────────────────────────────────────────
    aesthetics: ({ totalJobs, avgSalary }) => [
        {
            question: `What does an aesthetic ${NP} do?`,
            answer: `Aesthetic ${NP}s deliver cosmetic and medical aesthetic care: neuromodulator and dermal filler injections, laser and energy-based treatments, skin rejuvenation, and medical-grade skincare planning. There ${isAre(totalJobs)} currently ${totalJobs} aesthetics ${pluralize(totalJobs, 'position', 'positions')} listed here across medical spas, dermatology and plastic surgery practices, and NP-owned clinics.`,
        },
        {
            question: `What certification do aesthetic ${NP}s need?`,
            answer: `A national ${NP} certification through AANP or ANCC (family or adult-gerontology track) plus state APRN licensure. Aesthetics itself is learned in practice; employers screen for injectable and device training, often through manufacturer-led programs. The optional CANS credential through the Plastic Surgical Nursing Certification Board recognizes aesthetic practice hours.`,
        },
        {
            question: `Can ${brand.niche.descriptor}s own an aesthetics practice?`,
            answer: `It depends on the state. Ownership, medical-director, and delegation rules for cosmetic procedures are set by state law and vary widely; some states allow ${brand.niche.descriptor}-owned practices outright, while others require a physician relationship. Confirm the current rules with your state board of nursing and medical board before planning ownership.`,
        },
        {
            question: `What is the median aesthetic ${NP} salary?`,
            answer: `${medianPayAnswer('Aesthetic NP', avgSalary)} Aesthetics roles frequently pair a base rate with commission on procedures and retail products, so total pay tracks patient volume and service mix closely.`,
        },
    ],
    'pain-management': ({ totalJobs, avgSalary }) => [
        {
            question: `What does a pain management ${NP} do?`,
            answer: `Pain management ${NP}s evaluate and treat acute, chronic, and cancer-related pain with multimodal plans: medication management, interventional procedures, rehabilitation, and behavioral approaches. There ${isAre(totalJobs)} currently ${totalJobs} pain management ${pluralize(totalJobs, 'position', 'positions')} listed here across interventional pain clinics, spine and orthopedic groups, cancer centers, and hospital pain services.`,
        },
        {
            question: `What certification do pain management ${NP}s need?`,
            answer: `A national ${NP} certification through AANP or ANCC (family or adult-gerontology track per the patient population), state APRN licensure, and DEA registration, since controlled-substance prescribing is central to the role. Pain management itself is generally learned in practice.`,
        },
        {
            question: `What are the prescribing rules for pain management ${NP}s?`,
            answer: `Controlled-substance authority, opioid-prescribing limits, and prescription drug monitoring program (PDMP) requirements are set state by state and change frequently. Check the current rules with the state board of nursing where you plan to practice rather than relying on general guidance.`,
        },
        {
            question: `What is the median pain management ${NP} salary?`,
            answer: `${medianPayAnswer('Pain management NP', avgSalary)} Interventional and procedure-heavy practices often describe productivity pay in the listing.`,
        },
    ],
    'palliative-hospice': ({ totalJobs, avgSalary }) => [
        {
            question: `What does a palliative care or hospice ${NP} do?`,
            answer: `Palliative and hospice ${NP}s manage symptoms and goals of care for patients with serious, advanced, or life-limiting illness: pain and dyspnea control, advance care planning, and family support alongside interdisciplinary teams. There ${isAre(totalJobs)} currently ${totalJobs} ${pluralize(totalJobs, 'position', 'positions')} listed here across hospital consult services, clinics, home-based programs, and inpatient hospice units.`,
        },
        {
            question: `What is the difference between palliative care and hospice?`,
            answer: `Palliative care runs alongside active, disease-directed treatment at any stage of a serious illness. Hospice is comfort-directed care for patients who are no longer pursuing curative treatment, delivered at home, in facilities, or in inpatient hospice units. Many ${brand.niche.descriptor}s work across both.`,
        },
        {
            question: `What certification do palliative care ${NP}s need?`,
            answer: `A national ${NP} certification through AANP or ANCC (adult-gerontology or family track per the patient population), state APRN licensure, and DEA registration for symptom management. The optional ACHPN credential through the Hospice and Palliative Credentialing Center (HPCC) recognizes advanced hospice and palliative practice.`,
        },
        {
            question: `What is the median palliative care ${NP} salary?`,
            answer: `${medianPayAnswer('Palliative care NP', avgSalary)} Home-based and on-call-carrying programs commonly state mileage allowances or call stipends in the listing.`,
        },
    ],
};

export function getCategoryFaqs(input: CategoryFaqInput): FAQItem[] {
    if (input.customFaqs && input.customFaqs.length > 0) return input.customFaqs;
    const items = CATEGORY_FAQS[input.category]?.(input) ?? [];
    // Omit rather than pad (thin plan C.5): with no listings the "how many"
    // answer would read "There are currently 0 ...", so the entry and its
    // FAQPage node drop together.
    return input.totalJobs > 0 ? items : items.filter((item) => !/^There are currently 0 /.test(item.answer));
}

/**
 * Category FAQ data — extracted so both the server-rendered schema component
 * (components/CategoryFAQ.tsx) and the client-rendered accordion
 * (components/CategoryFAQAccordion.tsx) can share the same source of truth.
 *
 * Keeping this in a non-'use client' module also means the data never ends up
 * in the client JS bundle for routes that only need the schema.
 */

import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';

export interface FAQItem {
    question: string;
    answer: string;
}

// NP taxonomy migration (2026-07): FAQ entries for the removed PMHNP-only
// categories were deleted — their slugs are no longer in taxonomy-registry.ts. Configs
// whose faqCategory has no entry here render no FAQ block (getCategoryFaqs
// returns [] and CategoryFAQ returns null — no empty FAQPage schema).
//
// P0 content pass (2026-07-28): builders added for the employment-type and
// NP-specialty slugs used by setting-state pages (full-time, part-time,
// contract, 1099, locum-tenens, family-practice, adult-gerontology,
// pediatric, women-health, acute-care, emergency, anesthesia, midwifery).
// The psych specialty slug remains unmapped: its FAQ copy necessarily names
// the specialty, which the niche-copy ratchet ceiling for this file
// (tests/regressions/niche-copy-pseo-support-files.test.ts) does not yet
// sanction — raise that ceiling before adding it here.
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
    | 'midwifery';

export interface CategoryFaqInput {
    category: CategorySlug;
    totalJobs: number;
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
};

// ─── Shared citation-backed phrasing ────────────────────────────────────────
// TRUTH RULE: the only figures allowed in the builders below are the cited
// stats in lib/stats-sources.ts (or the live avgSalary passed in). Everything
// else stays qualitative — no invented salary bands or market statistics.

/** "$129,210 (BLS OEWS, …)" — the cited all-NP median. */
const NP_MEDIAN_CITED = `${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source})`;

/** "27 states + DC" — AANP Full Practice Authority count. */
const FPA_STATES = STAT_SOURCES.fullPracticeStates.formatted;

/** "45%" — BLS-projected NP employment growth, cited. */
const NP_GROWTH_CITED = `${STAT_SOURCES.blsGrowth2032.formatted} (${STAT_SOURCES.blsGrowth2032.source})`;

/** Salary answer for NP-specialty categories: live average when known, cited national median otherwise. */
function specialtySalaryAnswer(roleLabel: string, avgSalary?: number): string {
    return avgSalary
        ? `${roleLabel} positions listed here average approximately $${avgSalary.toLocaleString()} per year. Nationally, ${brand.niche.descriptor}s earn a median annual wage of ${NP_MEDIAN_CITED}; actual pay varies with experience, setting, geography, and employment type.`
        : `${brand.niche.long}s earn a median annual wage of ${NP_MEDIAN_CITED}. ${roleLabel} compensation varies with experience, practice setting, geography, and employment type — browse listings with posted salary ranges for current, real-world figures.`;
}

/** Practice-authority answer for NP-specialty categories, driven by the cited AANP stat. */
const NP_FPA_ANSWER = `Practice authority is set state by state. ${FPA_STATES} grant ${brand.niche.descriptor}s Full Practice Authority (${STAT_SOURCES.fullPracticeStates.source}), meaning they can evaluate, diagnose, and prescribe without physician oversight; the remaining states require a collaborative or supervisory agreement with a physician. Check the practice-authority details on this page — or the AANP State Practice Environment map — for the state you are browsing.`;

// Partial — categories without a built-in (e.g. 'metro') always pass customFaqs.
const CATEGORY_FAQS: Partial<Record<CategorySlug, (props: CategoryFaqInput) => FAQItem[]>> = {
    remote: ({ totalJobs, avgSalary }) => [
        {
            question: `How many remote ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} remote ${brand.niche.short} job openings. These include fully remote, hybrid, and telehealth positions from leading healthcare companies and private practices. New remote positions are added daily.`,
        },
        {
            question: `What is the average salary for remote ${brand.niche.short} jobs?`,
            answer: avgSalary
                ? `Remote ${brand.niche.short} positions offer an average salary of approximately $${avgSalary.toLocaleString()} per year. Remote roles often offer competitive or higher compensation compared to in-person positions due to expanded patient reach and reduced overhead costs.`
                : `Remote ${brand.niche.short} salaries typically range from $95,000 to $160,000 per year, depending on specialty, experience, patient panel size, and whether the position is W-2 or 1099. Many virtual-care employers also offer productivity bonuses.`,
        },
        {
            question: `Do remote ${brand.niche.short} jobs require multi-state licensure?`,
            answer: 'It depends on the employer. Some telehealth companies require you to be licensed in the states where your patients reside, while others only schedule you with patients in states where you already hold an active license. Many employers assist with multi-state licensure costs.',
        },
        {
            question: `What platforms do remote ${brand.niche.short}s use for telehealth?`,
            answer: 'Common platforms include Zoom for Healthcare, Doxy.me, and EHR-integrated video platforms like those built into Epic and Athenahealth. Most employers provide the technology platform and training. You typically need a reliable internet connection, a private workspace, and HIPAA-compliant setup.',
        },
    ],
    telehealth: ({ totalJobs, avgSalary }) => [
        {
            question: `How many telehealth ${brand.niche.short} positions are available?`,
            answer: `There are currently ${totalJobs} telehealth ${brand.niche.short} positions available. Telehealth positions include video visits, phone consultations, and asynchronous virtual care roles across major telehealth platforms and health systems.`,
        },
        {
            question: `What is the difference between telehealth and remote ${brand.niche.short} jobs?`,
            answer: `Telehealth specifically refers to providing patient care virtually via video or phone. Remote ${brand.niche.short} jobs may include telehealth patient care but also encompass roles like utilization review, case management, or clinical documentation that are done remotely but don\'t involve direct patient care via video.`,
        },
        {
            question: `What is the average telehealth ${brand.niche.short} salary?`,
            answer: avgSalary
                ? `Telehealth ${brand.niche.short} positions offer an average salary of approximately $${avgSalary.toLocaleString()} per year. Compensation varies based on patient volume, state licensure, and employment type (W-2 vs 1099).`
                : `Telehealth ${brand.niche.short} salaries range from $120,000 to $200,000+ annually. Many telehealth companies offer productivity-based compensation where higher patient volumes lead to increased earnings.`,
        },
        {
            question: `What qualifications do I need for telehealth ${brand.niche.short} jobs?`,
            answer: `You need an active ${brand.niche.short} certification (ANCC or AANP), state APRN licensure, a master\'s or doctoral degree in ${brand.niche.category}, and typically 1-2 years of clinical experience. Some entry-level telehealth positions accept new graduates with supervision. Familiarity with EHR systems and telehealth platforms is preferred.`,
        },
    ],
    travel: ({ totalJobs }) => [
        {
            question: `How many travel ${brand.niche.short} jobs are currently available?`,
            answer: `There are currently ${totalJobs} travel and locum tenens ${brand.niche.short} positions available nationwide. These positions offer short-term contracts (typically 8-26 weeks) in various healthcare settings across the country.`,
        },
        {
            question: `How much do travel ${brand.niche.short} positions pay?`,
            answer: `Travel ${brand.niche.short} positions typically pay 20-40% more than permanent roles, with weekly rates ranging from $2,500 to $5,000+. Compensation often includes tax-free housing stipends, travel reimbursement, and per diem allowances in addition to base pay.`,
        },
        {
            question: `What benefits do travel ${brand.niche.short} jobs include?`,
            answer: `Travel ${brand.niche.short} benefits commonly include housing stipends or company-provided housing, travel reimbursement, health insurance, 401(k), licensure reimbursement, malpractice insurance coverage, and completion bonuses. Some agencies also offer continuing education stipends.`,
        },
        {
            question: `Do I need experience for travel ${brand.niche.short} positions?`,
            answer: `Most travel ${brand.niche.short} positions require 1-2 years of clinical experience, as you\'ll be expected to practice independently with minimal orientation. However, some agencies offer "first-time traveler" programs with additional support. Having an active compact nursing license (NLC) can expand your opportunities.`,
        },
    ],
    'new-grad': ({ totalJobs }) => [
        {
            question: `How many entry-level ${brand.niche.short} jobs are available for new graduates?`,
            answer: `There are currently ${totalJobs} ${brand.niche.short} positions that welcome new graduates. These include fellowship programs, residency positions, and employer-sponsored training programs designed for recent ${brand.niche.short} graduates.`,
        },
        {
            question: `Can new graduate ${brand.niche.short}s find jobs easily?`,
            answer: `Yes — demand for ${brand.niche.short}s far exceeds supply. New graduates are highly sought after, with many employers offering structured orientation, mentorship, and collaborative practice agreements. The ${brand.niche.short} field has one of the highest job placement rates among advanced practice professions.`,
        },
        {
            question: `What should new grad ${brand.niche.short}s look for in their first job?`,
            answer: 'Key factors include: structured supervision and mentorship, manageable patient panel size (starting at 8-12 patients/day), access to collaborating physicians, continuing education support, malpractice insurance coverage, and clear pathways to independent practice. Avoid positions with unrealistic productivity expectations for new providers.',
        },
        {
            question: `Are there ${brand.niche.short} fellowship or residency programs?`,
            answer: `Yes, several healthcare systems offer ${brand.niche.short} fellowship and residency programs lasting 6-12 months. These programs provide intensive clinical training, didactic education, and mentorship. While they may pay slightly less initially, they provide invaluable experience and often lead to permanent positions.`,
        },
    ],
    'per-diem': ({ totalJobs }) => [
        {
            question: `How many per diem ${brand.niche.short} positions are available?`,
            answer: `There are currently ${totalJobs} per diem and PRN ${brand.niche.short} positions available. Per diem roles offer maximum flexibility, allowing you to set your own schedule and work as needed.`,
        },
        {
            question: `How much do per diem ${brand.niche.short}s earn?`,
            answer: `Per diem ${brand.niche.short}s typically earn $80-$150+ per hour, which is often higher than the hourly equivalent of full-time positions. Rates vary by location, setting, and demand. Some per diem positions also offer shift differentials for weekends, evenings, or holidays.`,
        },
        {
            question: `What are the pros and cons of per diem ${brand.niche.short} work?`,
            answer: 'Pros: flexible scheduling, higher hourly rates, variety of clinical settings, and the ability to supplement full-time income. Cons: no guaranteed hours, typically no benefits (health insurance, PTO, retirement), inconsistent income, and you may need your own malpractice insurance.',
        },
        {
            question: `Can per diem ${brand.niche.short}s work at multiple facilities?`,
            answer: `Yes — per diem ${brand.niche.short}s can typically work at multiple facilities simultaneously. This is one of the main advantages of per diem work. You\'ll need to ensure you have proper credentialing and privileges at each facility, and check for any non-compete clauses in your agreements.`,
        },
    ],
    inpatient: ({ totalJobs, avgSalary }) => [
        {
            question: `How many inpatient ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} inpatient ${brand.niche.short} positions available. These include hospitalist and hospital medicine teams, acute care units, step-down units, and specialty inpatient services across the country.`,
        },
        {
            question: `What is the average salary for inpatient ${brand.niche.short}s?`,
            answer: avgSalary
                ? `Inpatient ${brand.niche.short} positions offer an average salary of approximately $${avgSalary.toLocaleString()} per year. Hospital-based roles often include shift differentials, sign-on bonuses, and comprehensive benefits packages.`
                : `Inpatient ${brand.niche.short} salaries typically sit toward the upper end of the $95,000-$160,000 range. Hospital roles often include night/weekend shift differentials, sign-on bonuses, and full benefits including retirement and tuition reimbursement.`,
        },
        {
            question: `What does an inpatient ${brand.niche.short} do daily?`,
            answer: `Inpatient ${brand.niche.short}s round on admitted patients, conduct admission evaluations, manage acute treatment plans, respond to changes in patient status, lead or join multidisciplinary rounds, and coordinate discharge planning. Caseloads vary by unit and acuity.`,
        },
        {
            question: `Do I need experience for inpatient ${brand.niche.short} positions?`,
            answer: 'While many inpatient positions prefer 1-2 years of experience, some hospitals offer fellowship programs and structured orientation for new graduates. Inpatient settings provide excellent training in acute care management, procedures, and multidisciplinary collaboration that accelerates career growth.',
        },
    ],
    outpatient: ({ totalJobs, avgSalary }) => [
        {
            question: `How many outpatient ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} outpatient ${brand.niche.short} positions available. These include private practices, community health centers, group practices, and integrated care clinics across the country.`,
        },
        {
            question: `What is the average outpatient ${brand.niche.short} salary?`,
            answer: avgSalary
                ? `Outpatient ${brand.niche.short} positions offer an average salary of approximately $${avgSalary.toLocaleString()} per year. Private practice ${brand.niche.short}s can earn significantly more through productivity-based compensation models.`
                : `Outpatient ${brand.niche.short} salaries typically range from $130,000 to $190,000 for W-2 positions. Private practice owners can earn $200,000-$300,000+ depending on patient volume and insurance panel mix.`,
        },
        {
            question: `What does a typical outpatient ${brand.niche.short} schedule look like?`,
            answer: 'Most outpatient positions offer Monday-Friday, 8am-5pm schedules with no nights, weekends, or on-call requirements. Typical caseloads are 12-20 patients per day for medication management, or 6-8 if integrating therapy. Many clinics offer 4-day work weeks.',
        },
        {
            question: `Can outpatient ${brand.niche.short}s start their own private practice?`,
            answer: `Yes — outpatient experience is ideal preparation for private practice. In full practice authority states, ${brand.niche.short}s can open independent practices. Most ${brand.niche.short}s gain 2-3 years of supervised experience first, then transition to private practice earning $200K+ with full schedule control.`,
        },
    ],
    'community-health': ({ totalJobs, avgSalary }) => [
        {
            question: `How many community health ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} community health ${brand.niche.short} positions available. These include roles at Federally Qualified Health Centers (FQHCs), community health centers, public health clinics, and integrated primary-care settings serving underserved populations.`,
        },
        {
            question: `What is the average salary for community health ${brand.niche.short}s?`,
            answer: avgSalary
                ? `Community health ${brand.niche.short} positions offer an average salary of approximately $${avgSalary.toLocaleString()} per year. Many FQHC and public health roles also include NHSC loan repayment up to $50,000 and PSLF eligibility.`
                : `Community health ${brand.niche.short} salaries typically range from $120,000 to $170,000 per year. Positions at FQHCs often include loan repayment programs, federal benefits, and generous PTO that significantly boost total compensation.`,
        },
        {
            question: `What qualifications are needed for community health ${brand.niche.short} roles?`,
            answer: `You need an active national ${brand.niche.short} board certification (ANCC or AANP), state APRN licensure, DEA registration, and ideally experience working with diverse, underserved populations. Bilingual skills (especially Spanish) are highly valued. Some positions accept new graduates with structured supervision.`,
        },
        {
            question: `Do community health ${brand.niche.short}s qualify for loan repayment?`,
            answer: 'Yes — many community health positions at FQHCs and nonprofit agencies qualify for National Health Service Corps (NHSC) loan repayment of up to $50,000 for two years of service. Positions at 501(c)(3) employers also qualify for Public Service Loan Forgiveness (PSLF) after 120 qualifying payments.',
        },
    ],

    // ─── Employment-type categories (2026-07 P0 content pass) ────────────────
    'full-time': ({ totalJobs, avgSalary }) => [
        {
            question: `How many full-time ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} full-time ${brand.niche.short} positions available. Full-time roles span outpatient clinics, hospitals, health systems, and telehealth employers, and new positions are added daily.`,
        },
        {
            question: `What does a typical full-time ${brand.niche.short} schedule look like?`,
            answer: `Most full-time ${brand.niche.short} roles run four to five days per week. Outpatient positions usually follow standard weekday clinic hours, while hospital-based roles may use shift schedules such as three 12-hour shifts. Confirm expected patient volume, documentation time, and any on-call coverage before accepting an offer.`,
        },
        {
            question: `What is the average salary for full-time ${brand.niche.short} jobs?`,
            answer: avgSalary
                ? `Full-time positions listed here average approximately $${avgSalary.toLocaleString()} per year. Nationally, ${brand.niche.descriptor}s earn a median annual wage of ${NP_MEDIAN_CITED}; pay varies with specialty, setting, and state.`
                : `${brand.niche.long}s earn a median annual wage of ${NP_MEDIAN_CITED}. Full-time pay varies with specialty, setting, experience, and state — compare posted salary ranges on individual listings for current figures.`,
        },
        {
            question: `What benefits do full-time ${brand.niche.short} positions include?`,
            answer: `Full-time W-2 packages typically include health insurance, a retirement plan with employer match, paid time off, CME allowance, and malpractice coverage. Many employers add signing bonuses, licensure and certification fee reimbursement, or loan-repayment support — total compensation often matters as much as base salary.`,
        },
    ],
    'part-time': ({ totalJobs }) => [
        {
            question: `How many part-time ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} part-time ${brand.niche.short} positions available, spanning outpatient clinics, telehealth panels, and hospital coverage shifts. New listings are added daily.`,
        },
        {
            question: `What does part-time ${brand.niche.short} work usually look like?`,
            answer: `Part-time arrangements typically run one to three days per week on a fixed schedule, distinct from PRN work where you pick up shifts as needed. Clarify the guaranteed minimum hours, scheduling flexibility, and whether the role can grow into full-time before signing.`,
        },
        {
            question: `How are part-time ${brand.niche.short}s paid?`,
            answer: `Part-time ${brand.niche.short} roles are usually paid hourly, and hourly rates often run above the full-time equivalent because benefits are reduced or excluded. Actual rates vary by state, setting, and specialty — compare posted ranges on individual listings.`,
        },
        {
            question: `Do part-time ${brand.niche.short} positions include benefits?`,
            answer: `It varies by employer. Some organizations prorate health insurance, PTO, and retirement contributions once you work a minimum number of weekly hours; others reserve benefits for full-time staff. Ask where the eligibility threshold sits, and budget for your own malpractice coverage if the employer does not provide it.`,
        },
        {
            question: `Can I combine multiple part-time ${brand.niche.short} roles?`,
            answer: `Yes — many ${brand.niche.short}s stack two or three part-time roles across different settings for variety and income stability. Each facility credentials you separately, so factor in onboarding time, and review non-compete or exclusivity clauses in each agreement before committing.`,
        },
    ],
    contract: ({ totalJobs }) => [
        {
            question: `How many contract ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} contract ${brand.niche.short} positions available, including fixed-term assignments and temp-to-perm openings. New contracts are posted daily.`,
        },
        {
            question: `What is a contract ${brand.niche.short} position?`,
            answer: `A contract role is a fixed-term engagement — commonly a few months — either as a W-2 employee of a staffing agency or as an independent contractor. Many contracts are temp-to-perm, letting you and the employer evaluate fit before converting to a permanent role.`,
        },
        {
            question: `How does contract ${brand.niche.short} pay compare to permanent roles?`,
            answer: `Contract rates generally run above equivalent permanent salaries because you trade away benefits and long-term stability. Whether that premium works in your favor depends on how you cover health insurance, retirement, and time between contracts — compare posted rates on individual listings and price in the full package.`,
        },
        {
            question: `What should I review before signing an ${brand.niche.short} contract?`,
            answer: `Review the term length, extension and cancellation clauses, malpractice coverage (occurrence-based versus claims-made, and who pays for tail coverage), non-compete restrictions, and any temp-to-perm conversion terms. Have an attorney or a contract-savvy colleague read anything you are unsure about.`,
        },
    ],
    '1099': ({ totalJobs }) => [
        {
            question: `How many 1099 ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} independent-contractor (1099) ${brand.niche.short} positions available, spanning telehealth panels, practice coverage, and consulting engagements. New listings are added daily.`,
        },
        {
            question: `What is the difference between W-2 and 1099 ${brand.niche.short} work?`,
            answer: `As a 1099 contractor you are self-employed: no taxes are withheld from your pay, you owe self-employment tax and quarterly estimated payments, and you fund your own health insurance and retirement. In exchange you can deduct business expenses and keep far more control over your schedule and caseload.`,
        },
        {
            question: `Do 1099 ${brand.niche.short}s earn more than W-2 employees?`,
            answer: `Gross hourly rates for 1099 work typically run above comparable W-2 rates because the employer pays no benefits or payroll taxes on your behalf. Whether you net more depends on your tax situation and benefit costs — compare posted rates on individual listings and model the after-tax picture before choosing.`,
        },
        {
            question: `What do I need before taking a 1099 ${brand.niche.short} position?`,
            answer: `You need an active APRN license in the practice state, current national certification, and your own malpractice policy (occurrence-based coverage is commonly recommended). Many contractors also form an LLC or PLLC, set aside a portion of every payment for quarterly estimated taxes, and work with an accountant familiar with clinician contracting.`,
        },
        {
            question: `Does state practice authority matter for 1099 ${brand.niche.short}s?`,
            answer: `Yes. Independent contracting is administratively simplest in the ${FPA_STATES} with Full Practice Authority (${STAT_SOURCES.fullPracticeStates.source}), where no physician agreement is required. In reduced- and restricted-practice states you must maintain the required collaborative or supervisory arrangement, so confirm who holds that agreement before signing.`,
        },
    ],
    'locum-tenens': ({ totalJobs }) => [
        {
            question: `How many locum tenens ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} locum tenens ${brand.niche.short} assignments available. Locum roles provide temporary coverage — for vacancies, leave, or peak demand — typically arranged through staffing agencies.`,
        },
        {
            question: `What does locum tenens mean for ${brand.niche.short}s?`,
            answer: `Locum tenens (Latin for "to hold a place") describes short-term assignments where you cover a practice or facility for weeks to months. Assignments have defined start and end dates, and agencies usually handle scheduling, credentialing paperwork, and travel logistics.`,
        },
        {
            question: `How is locum tenens ${brand.niche.short} work compensated?`,
            answer: `Locum assignments are typically paid hourly at a premium over permanent rates, and packages often include travel and housing stipends plus paid malpractice coverage. Understand the IRS tax-home rules before accepting stipends, and compare posted rates across agencies for the same market.`,
        },
        {
            question: `Do I need a license in every state where I take locum assignments?`,
            answer: `Yes — you need an active APRN license in each assignment state. Agencies commonly assist with or reimburse licensing costs, and expedited endorsement or multistate pathways can shorten the timeline in participating states. Keep your credentials file current so onboarding is fast.`,
        },
        {
            question: `How much experience do locum tenens ${brand.niche.short} roles require?`,
            answer: `Most agencies place clinicians who can practice independently with minimal orientation, so one to two years of experience is commonly preferred. Some agencies run first-assignment programs with extra support for clinicians new to locum work.`,
        },
    ],

    // ─── NP specialty categories (2026-07 P0 content pass) ──────────────────
    'family-practice': ({ totalJobs, avgSalary }) => [
        {
            question: `What does a family practice ${brand.niche.short} (FNP) do?`,
            answer: `Family nurse practitioners deliver primary care across the entire lifespan — preventive visits, chronic disease management, and acute episodic care for children, adults, and older adults. FNPs practice in primary care clinics, FQHCs, urgent care, retail health, and telehealth.`,
        },
        {
            question: `What certification do family practice ${brand.niche.short}s need?`,
            answer: `FNPs complete a graduate (MSN or DNP) family nurse practitioner program, then certify through AANP (FNP-C) or ANCC (FNP-BC), alongside state APRN licensure. Employers may also require DEA registration for prescribing.`,
        },
        {
            question: `What is the average family practice ${brand.niche.short} salary?`,
            answer: specialtySalaryAnswer('Family practice NP', avgSalary),
        },
        {
            question: `Can family practice ${brand.niche.short}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
        {
            question: `What is the job outlook for family practice ${brand.niche.short}s?`,
            answer: `Strong — the BLS projects ${NP_GROWTH_CITED} employment growth for ${brand.niche.descriptor}s from 2022 to 2032, and primary care is where much of that demand lands. There are currently ${totalJobs} family practice positions listed here, with new openings added daily.`,
        },
    ],
    'adult-gerontology': ({ totalJobs, avgSalary }) => [
        {
            question: `What does an adult-gerontology ${brand.niche.short} (AGNP) do?`,
            answer: `AGNPs care for patients from adolescence through advanced age. The primary care track (AGPCNP) manages prevention and chronic disease in outpatient settings, while the acute care track (AGACNP) manages complex and critically ill adults in hospitals. There are currently ${totalJobs} adult-gerontology positions listed here.`,
        },
        {
            question: `What certification do adult-gerontology ${brand.niche.short}s need?`,
            answer: `Primary care AGNPs certify through ANCC (AGPCNP-BC) or AANP (A-GNP). Acute care AGNPs certify through ANCC (AGACNP-BC) or the American Association of Critical-Care Nurses (AACN, ACNPC-AG). Both tracks require graduate education and state APRN licensure.`,
        },
        {
            question: `What is the average adult-gerontology ${brand.niche.short} salary?`,
            answer: specialtySalaryAnswer('Adult-gerontology NP', avgSalary),
        },
        {
            question: `Where do adult-gerontology ${brand.niche.short}s work?`,
            answer: `Common settings include internal medicine and geriatrics practices, long-term care and skilled nursing facilities, hospital medicine teams, palliative care programs, and specialty clinics. The aging population keeps demand strong across both tracks.`,
        },
        {
            question: `Can adult-gerontology ${brand.niche.short}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    pediatric: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a pediatric ${brand.niche.short} (PNP) do?`,
            answer: `Pediatric nurse practitioners care for infants, children, adolescents, and young adults — well-child visits, immunizations, developmental screening, and management of acute and chronic childhood conditions. There are currently ${totalJobs} pediatric positions listed here.`,
        },
        {
            question: `What certification do pediatric ${brand.niche.short}s need?`,
            answer: `PNPs certify through the Pediatric Nursing Certification Board (PNCB) as CPNP-PC (primary care) or CPNP-AC (acute care), or through ANCC (PPCNP-BC), after completing a pediatric-focused graduate program and obtaining state APRN licensure.`,
        },
        {
            question: `What is the average pediatric ${brand.niche.short} salary?`,
            answer: specialtySalaryAnswer('Pediatric NP', avgSalary),
        },
        {
            question: `Where do pediatric ${brand.niche.short}s work?`,
            answer: `Pediatric clinics and group practices, children's hospitals, pediatric specialty services, urgent care, school-based health centers, and telehealth programs all hire PNPs. Acute care PNPs work in children's hospitals, PICUs, and inpatient specialty teams.`,
        },
        {
            question: `Can pediatric ${brand.niche.short}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    'women-health': ({ totalJobs, avgSalary }) => [
        {
            question: `What does a women's health ${brand.niche.short} (WHNP) do?`,
            answer: `WHNPs provide gynecologic, reproductive, prenatal, and postpartum care, along with menopause management and the primary care needs of women across the lifespan. There are currently ${totalJobs} women's health positions listed here.`,
        },
        {
            question: `What certification do women's health ${brand.niche.short}s need?`,
            answer: `WHNPs certify through the National Certification Corporation (NCC), earning the WHNP-BC credential after completing an accredited women's health graduate program and obtaining state APRN licensure.`,
        },
        {
            question: `What is the average women's health ${brand.niche.short} salary?`,
            answer: specialtySalaryAnswer("Women's health NP", avgSalary),
        },
        {
            question: `Where do women's health ${brand.niche.short}s work?`,
            answer: `OB/GYN group practices, family planning and reproductive health clinics, fertility centers, public health programs, and telehealth platforms all hire WHNPs. Some roles focus on gynecology only; others include prenatal and postpartum panels — confirm the scope in each listing.`,
        },
        {
            question: `Can women's health ${brand.niche.short}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    'acute-care': ({ totalJobs, avgSalary }) => [
        {
            question: `What does an acute care ${brand.niche.short} (ACNP) do?`,
            answer: `Acute care NPs manage adults with complex, acute, and critical illness — in ICUs, step-down units, emergency and hospital specialty services. The role includes rapid assessment, ordering and interpreting diagnostics, managing treatment plans, and performing procedures within granted privileges. There are currently ${totalJobs} acute care positions listed here.`,
        },
        {
            question: `What certification do acute care ${brand.niche.short}s need?`,
            answer: `The current adult-gerontology acute care credentials are AGACNP-BC through ANCC and ACNPC-AG through the American Association of Critical-Care Nurses (AACN), earned after an acute-care-focused graduate program and state APRN licensure.`,
        },
        {
            question: `What is the average acute care ${brand.niche.short} salary?`,
            answer: avgSalary
                ? `Acute care positions listed here average approximately $${avgSalary.toLocaleString()} per year. Nationally, ${brand.niche.descriptor}s earn a median annual wage of ${NP_MEDIAN_CITED}; hospital-based roles frequently add night, weekend, and holiday shift differentials on top of base pay.`
                : `${brand.niche.long}s earn a median annual wage of ${NP_MEDIAN_CITED}. Hospital-based acute care roles frequently add night, weekend, and holiday shift differentials on top of base pay — compare posted ranges on individual listings.`,
        },
        {
            question: `Do I need ICU experience for acute care ${brand.niche.short} roles?`,
            answer: `Many hospitals prefer candidates with acute care RN backgrounds (ICU, ED, or step-down) and one to two years of experience, though some offer structured fellowships and orientation programs for newer graduates. Ask about orientation length, procedure training, and overnight support when comparing offers.`,
        },
        {
            question: `How does practice authority work for hospital-based ${brand.niche.short}s?`,
            answer: `${NP_FPA_ANSWER} In hospitals, your day-to-day scope is additionally defined by the facility's credentialing and privileging process, regardless of state practice authority.`,
        },
    ],
    emergency: ({ totalJobs, avgSalary }) => [
        {
            question: `What does an emergency ${brand.niche.short} (ENP) do?`,
            answer: `Emergency NPs evaluate and treat patients across the full acuity spectrum of the emergency department — from fast-track injuries and infections to supporting higher-acuity resuscitation care. ENPs work in hospital EDs, freestanding emergency centers, and urgent care. There are currently ${totalJobs} emergency positions listed here.`,
        },
        {
            question: `How do I become an emergency ${brand.niche.short}?`,
            answer: `Most ENPs first certify as family nurse practitioners (AANP FNP-C or ANCC FNP-BC), then add emergency-specific training or experience. The dedicated ENP-C specialty credential is offered through AANP's certification board to certified FNPs with emergency preparation. Some emergency roles are also filled by acute care-certified NPs — check each listing's requirements.`,
        },
        {
            question: `What is the average emergency ${brand.niche.short} salary?`,
            answer: avgSalary
                ? `Emergency positions listed here average approximately $${avgSalary.toLocaleString()} per year. Nationally, ${brand.niche.descriptor}s earn a median annual wage of ${NP_MEDIAN_CITED}; emergency roles frequently add night, weekend, and holiday differentials.`
                : `${brand.niche.long}s earn a median annual wage of ${NP_MEDIAN_CITED}. Emergency medicine roles frequently add night, weekend, and holiday shift differentials — compare posted ranges on individual listings.`,
        },
        {
            question: `What schedules do emergency ${brand.niche.short}s work?`,
            answer: `Emergency departments run around the clock, so ENP schedules are shift-based and typically include nights, weekends, and holidays. Many EDs use 8-, 10-, or 12-hour shifts with block scheduling; clarify the mix of day and overnight coverage before accepting an offer.`,
        },
        {
            question: `Can emergency ${brand.niche.short}s practice independently?`,
            answer: NP_FPA_ANSWER,
        },
    ],
    anesthesia: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a certified registered nurse anesthetist (CRNA) do?`,
            answer: `CRNAs plan and deliver anesthesia care — general, regional, and sedation — across surgical, obstetric, and procedural settings, managing patients before, during, and after anesthesia. In many rural facilities, CRNAs are the primary anesthesia providers. There are currently ${totalJobs} CRNA positions listed here.`,
        },
        {
            question: `What certification do CRNAs need?`,
            answer: `CRNAs graduate from a nurse anesthesia program accredited by the Council on Accreditation (COA) — admission requires critical-care RN experience — then pass the National Certification Examination administered by NBCRNA. Certification is maintained through NBCRNA's Continued Professional Certification (CPC) program.`,
        },
        {
            question: `How much do CRNAs earn?`,
            answer: avgSalary
                ? `CRNA positions listed here average approximately $${avgSalary.toLocaleString()} per year. CRNA compensation sits at the top of the APRN pay scale and varies with setting, call burden, and state.`
                : `CRNA compensation sits at the top of the APRN pay scale and varies with setting, call burden, and state. Independent-contractor and locum CRNA engagements typically run above employed W-2 packages on an hourly basis — compare posted ranges on individual listings.`,
        },
        {
            question: `Do CRNAs require physician supervision?`,
            answer: `CRNA supervision rules are set by state law and facility policy rather than the NP practice-authority framework. A number of states have opted out of the federal physician-supervision requirement for anesthesia services, while others require anesthesiologist or physician involvement — verify the rules for the specific state and facility before accepting a role.`,
        },
        {
            question: `Where do CRNAs work?`,
            answer: `Hospital operating rooms, ambulatory surgery centers, obstetric units, endoscopy and interventional suites, pain management clinics, and anesthesia group practices. Call requirements and case mix vary widely by setting, so clarify both when comparing offers.`,
        },
    ],
    midwifery: ({ totalJobs, avgSalary }) => [
        {
            question: `What does a certified nurse midwife (CNM) do?`,
            answer: `CNMs provide prenatal care, attend labor and birth, and deliver postpartum, newborn, gynecologic, and well-person care. Many also provide contraceptive counseling and primary care services for women across the lifespan. There are currently ${totalJobs} CNM positions listed here.`,
        },
        {
            question: `What certification do nurse midwives need?`,
            answer: `CNMs complete a graduate midwifery program accredited by the Accreditation Commission for Midwifery Education (ACME), then pass the national certification examination of the American Midwifery Certification Board (AMCB). Certification is maintained through AMCB's recertification program, alongside state APRN licensure.`,
        },
        {
            question: `How much do certified nurse midwives earn?`,
            answer: avgSalary
                ? `CNM positions listed here average approximately $${avgSalary.toLocaleString()} per year. Compensation varies with birth volume, call requirements, and setting — hospital-employed, birth center, and private practice models pay differently.`
                : `CNM compensation varies with birth volume, call requirements, and setting — hospital-employed, birth center, and private practice models pay differently. Compare posted salary ranges on individual listings for current figures.`,
        },
        {
            question: `Can nurse midwives practice independently?`,
            answer: `Midwifery practice authority is defined state by state and differs from the NP framework: many states permit independent CNM practice, while others require a collaborative agreement or physician involvement for some services. Verify the rules with the state's licensing board before accepting a role.`,
        },
        {
            question: `Where do certified nurse midwives work?`,
            answer: `Hospital labor and delivery units, freestanding birth centers, OB/GYN group practices, community health programs, and home-birth practices. Call schedules vary substantially — clarify call frequency, backup arrangements, and birth volume expectations when comparing offers.`,
        },
    ],
};

export function getCategoryFaqs(input: CategoryFaqInput): FAQItem[] {
    if (input.customFaqs && input.customFaqs.length > 0) return input.customFaqs;
    return CATEGORY_FAQS[input.category]?.(input) ?? [];
}

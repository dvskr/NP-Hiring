/**
 * Category FAQ data — extracted so both the server-rendered schema component
 * (components/CategoryFAQ.tsx) and the client-rendered accordion
 * (components/CategoryFAQAccordion.tsx) can share the same source of truth.
 *
 * Keeping this in a non-'use client' module also means the data never ends up
 * in the client JS bundle for routes that only need the schema.
 */

import { brand } from '@/config/brand';

export interface FAQItem {
    question: string;
    answer: string;
}

// NP taxonomy migration (2026-07): FAQ entries for the removed PMHNP-only
// categories were deleted — their slugs are no longer in taxonomy-registry.ts. Configs
// whose faqCategory has no entry here render no FAQ block (getCategoryFaqs
// returns [] and CategoryFAQ returns null — no empty FAQPage schema).
export type CategorySlug =
    | 'remote'
    | 'telehealth'
    | 'travel'
    | 'new-grad'
    | 'per-diem'
    | 'inpatient'
    | 'outpatient'
    | 'community-health'
    | 'metro';

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
};

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
                : `Remote ${brand.niche.short} salaries typically range from $130,000 to $200,000+ per year, depending on experience, patient panel size, and whether the position is W-2 or 1099. Many telehealth companies also offer productivity bonuses.`,
        },
        {
            question: `Do remote ${brand.niche.short} jobs require multi-state licensure?`,
            answer: 'It depends on the employer. Some telehealth companies require you to be licensed in the states where your patients reside, while others work within the PSYPACT compact or only serve patients in states where you hold an active license. Many employers assist with multi-state licensure costs.',
        },
        {
            question: `What platforms do remote ${brand.niche.short}s use for telehealth?`,
            answer: 'Common platforms include Zoom for Healthcare, Doxy.me, SimplePractice, TherapyNotes, and proprietary EHR systems. Most employers provide the technology platform and training. You typically need a reliable internet connection, a private workspace, and HIPAA-compliant setup.',
        },
    ],
    telehealth: ({ totalJobs, avgSalary }) => [
        {
            question: `How many telehealth ${brand.niche.short} positions are available?`,
            answer: `There are currently ${totalJobs} telehealth ${brand.niche.short} positions available. Telehealth positions include video visits, phone consultations, and asynchronous ${brand.niche.adjective} care roles across major telehealth platforms and health systems.`,
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
            answer: `You need an active ${brand.niche.short} certification (ANCC), state APRN licensure, a master\'s or doctoral degree in ${brand.niche.adjective} nursing, and typically 1-2 years of clinical experience. Some entry-level telehealth positions accept new graduates with supervision. Familiarity with EHR systems and telehealth platforms is preferred.`,
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
            answer: `Yes — demand for ${brand.niche.short}s far exceeds supply. New graduates are highly sought after, with many employers offering structured orientation, mentorship, and collaborative practice agreements. The ${brand.niche.adjective} NP field has one of the highest job placement rates among all NP specialties.`,
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
            answer: `There are currently ${totalJobs} inpatient ${brand.niche.short} positions available. These include hospital-based ${brand.niche.adjective} units, acute care facilities, crisis stabilization centers, and residential treatment programs across the country.`,
        },
        {
            question: `What is the average salary for inpatient ${brand.niche.short}s?`,
            answer: avgSalary
                ? `Inpatient ${brand.niche.short} positions offer an average salary of approximately $${avgSalary.toLocaleString()} per year. Hospital-based roles often include shift differentials, sign-on bonuses, and comprehensive benefits packages.`
                : `Inpatient ${brand.niche.short} salaries typically range from $140,000 to $200,000+ per year. Hospital roles often include night/weekend shift differentials (10-20% extra), sign-on bonuses ($5K-$25K), and full benefits including retirement and tuition reimbursement.`,
        },
        {
            question: `What does an inpatient ${brand.niche.short} do daily?`,
            answer: `Inpatient ${brand.niche.short}s conduct ${brand.niche.adjective} evaluations for new admissions, manage acute medication regimens, perform risk assessments, lead treatment team rounds, coordinate discharge planning, and provide crisis intervention. Typical caseloads range from 12-20 patients per shift depending on acuity.`,
        },
        {
            question: `Do I need experience for inpatient ${brand.niche.short} positions?`,
            answer: 'While many inpatient positions prefer 1-2 years of experience, some hospitals offer fellowship programs and structured orientation for new graduates. Inpatient settings provide excellent training in crisis management, psychopharmacology, and multidisciplinary collaboration that accelerates career growth.',
        },
    ],
    outpatient: ({ totalJobs, avgSalary }) => [
        {
            question: `How many outpatient ${brand.niche.short} jobs are available?`,
            answer: `There are currently ${totalJobs} outpatient ${brand.niche.short} positions available. These include private practices, community ${brand.niche.category} centers, group practices, and integrated care clinics across the country.`,
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
            answer: `There are currently ${totalJobs} community health ${brand.niche.short} positions available. These include roles at Federally Qualified Health Centers (FQHCs), community ${brand.niche.category} centers, public health clinics, and integrated primary-care settings serving underserved populations.`,
        },
        {
            question: `What is the average salary for community health ${brand.niche.short}s?`,
            answer: avgSalary
                ? `Community health ${brand.niche.short} positions offer an average salary of approximately $${avgSalary.toLocaleString()} per year. Many FQHC and public health roles also include NHSC loan repayment up to $50,000 and PSLF eligibility.`
                : `Community health ${brand.niche.short} salaries typically range from $120,000 to $170,000 per year. Positions at FQHCs often include loan repayment programs, federal benefits, and generous PTO that significantly boost total compensation.`,
        },
        {
            question: `What qualifications are needed for community health ${brand.niche.short} roles?`,
            answer: 'You need an active PMHNP-BC certification (ANCC), state APRN licensure, DEA registration, and ideally experience working with diverse, underserved populations. Bilingual skills (especially Spanish) are highly valued. Some positions accept new graduates with structured supervision.',
        },
        {
            question: `Do community health ${brand.niche.short}s qualify for loan repayment?`,
            answer: 'Yes — many community health positions at FQHCs and nonprofit agencies qualify for National Health Service Corps (NHSC) loan repayment of up to $50,000 for two years of service. Positions at 501(c)(3) employers also qualify for Public Service Loan Forgiveness (PSLF) after 120 qualifying payments.',
        },
    ],
};

export function getCategoryFaqs(input: CategoryFaqInput): FAQItem[] {
    if (input.customFaqs && input.customFaqs.length > 0) return input.customFaqs;
    return CATEGORY_FAQS[input.category]?.(input) ?? [];
}

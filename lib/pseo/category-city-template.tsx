/**
 * Category × City pSEO Template Factory
 * 
 * THE 50K MULTIPLIER: A single shared component that renders pages for
 * any category (setting or specialty) × any city combination.
 * 
 * Each page includes genuine, unique content:
 * - Local market demand score
 * - Cost-of-living adjusted salary
 * - Healthcare landscape for the area
 * - Provider shortage indicators
 * - Community profile
 * - Nearby city cross-links
 * - State licensure quick reference
 */
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import {
  TrendingUp, Building2, Bell, MapPin, Lightbulb,
  DollarSign, Users, AlertTriangle, Activity, Heart, Shield, ArrowRight,
} from 'lucide-react';
import { cache } from 'react';
import { withTagFallback, type CategoryTag } from './category-tagger';
import { shouldRenderCategoryCity, MIN_JOBS_FOR_CATEGORY_CITY } from './render-gate';
import { JOB_LISTING_OMIT } from './job-listing-omit';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { brand } from '@/config/brand';
import { licenseGuideSlug, LICENSE_GUIDE_SERIES_PUBLISHED } from '@/config/niche/content-map';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { prisma } from '@/lib/prisma';
import JobCard from '@/components/JobCard';
// P2 #19: Breadcrumbs renders the VISIBLE trail *and* the BreadcrumbList
// JSON-LD from one items array, so schema can never drift from what users
// see. It replaces the schema-only BreadcrumbSchema that used to sit here —
// do not add both, or the page emits two BreadcrumbList graphs.
import Breadcrumbs from '@/components/Breadcrumbs';
import CategoryHero from '@/components/CategoryHero';
import { Job } from '@/lib/types';
import { CityData } from './city-data/types';
import { getCityBySlug } from './city-data/cities';
import { SETTING_CONFIGS, SettingConfig, stateToSlug } from './setting-state-config';
import { CATEGORY_ASSET_REGISTRY } from './category-asset-registry';
import {
  getStatePracticeAuthority,
  getAuthorityLabel,
  StatePracticeInfo,
} from '@/lib/state-practice-authority';
import { PseoPageViewTracker } from '@/components/analytics/ViewTrackers';
import { buildCityFacts, buildTaxonomyCityNarrative } from './city-narrative';
import { getTopCityEmployers } from './city-employers';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from './taxonomy-registry';
// Kept as its own statement: tests/regressions/pseo-consistency-integrity.test.ts
// (B36) pins the exact single-specifier import line above.
import { PSYCH_SPECIALTY_SLUG } from './taxonomy-registry';

// Categories with a real /jobs/<category>/[state] route. City-only categories
// (the other 21) 410 at the middleware for state-shaped URLs, so every
// state-level link/breadcrumb below must fall back to the /jobs/state/{slug}
// hub for them instead of emitting a guaranteed-410 URL.
const STATE_ELIGIBLE_SET = new Set<string>(STATE_ELIGIBLE_CATEGORY_SLUGS);

const STORAGE_BASE = brand.assets.storageBase;

// ─── Category Configuration (extends SettingConfig for specialties) ────────────

export interface CategoryConfig {
  slug: string;
  label: string;
  fullLabel: string;
  heroSubtitle: string;
  salaryRange: string;
  keywords: string[];
  faqCategory: string;
  buildWhere: (stateName: string, cityName?: string) => Record<string, unknown>;
  benefits: Array<{
    title: string;
    description: string;
    iconName: string;
  }>;
  tips: string[];
}

// Specialty configs (supplement the setting configs from setting-state-config.ts)
// NP taxonomy migration (2026-07): the five donor-niche-only specialty configs
// were removed — their slugs are no longer in taxonomy-registry.ts.
// Narrative fields in the kept configs below were rewritten for the all-NP
// board (2026-07); salary bands align to the config/niche/salary.ts anchors.
export const SPECIALTY_CONFIGS: Record<string, CategoryConfig> = {
  'new-grad': {
    slug: 'new-grad',
    label: 'New Grad',
    fullLabel: `New Graduate ${brand.niche.short}`,
    heroSubtitle: 'Entry-level & new graduate positions',
    salaryRange: '$95K-140K',
    keywords: ['new grad np', 'entry level np', 'new graduate np', 'np fellowship'],
    faqCategory: 'new-grad',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('new-grad'),
    }),
    benefits: [
      { title: 'Mentorship', description: `Many new grad positions include structured mentorship and supervision from experienced physicians and senior ${brand.niche.short}s.`, iconName: 'Users' },
      { title: 'High Demand', description: `${brand.niche.short} shortage means even new graduates are highly sought after with strong starting salaries.`, iconName: 'TrendingUp' },
      { title: 'Career Foundation', description: 'Build clinical confidence and skills that set you up for advanced roles or private practice later.', iconName: 'Shield' },
    ],
    tips: [
      'Prioritize positions with structured supervision',
      'Start with manageable caseloads (8-12 patients/day)',
      'Seek collaborative practice opportunities',
      `Join AANP and your state ${brand.niche.short} association for networking and CE`,
      'Negotiate sign-on bonuses and student loan assistance',
    ],
  },
  'per-diem': {
    slug: 'per-diem',
    label: 'Per Diem',
    fullLabel: `Per Diem ${brand.niche.short}`,
    heroSubtitle: 'PRN & flexible schedule positions',
    salaryRange: '$60-110/hr',
    keywords: ['per diem np', 'PRN np', 'part time np', 'flexible np'],
    faqCategory: 'per-diem',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('per-diem'),
    }),
    benefits: [
      { title: 'Maximum Flexibility', description: 'Set your own schedule — work as many or as few shifts as you want, when you want.', iconName: 'Activity' },
      { title: 'Higher Hourly Rate', description: 'Per diem roles pay $60-$110+/hr — a premium over the hourly equivalent of salaried full-time work.', iconName: 'DollarSign' },
      { title: 'Income Supplement', description: 'Perfect for supplementing a full-time position or private practice while maintaining clinical variety.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Maintain your own malpractice insurance',
      'Track hours carefully for tax purposes',
      'Build relationships at multiple facilities',
      'Negotiate competitive hourly rates',
      'Consider 1099 vs W-2 per diem arrangements',
    ],
  },
};

// Job Type configs
// Narrative copy below was rewritten for the all-NP board (2026-07); salary
// bands align to the config/niche/salary.ts anchors.
export const JOB_TYPE_CONFIGS: Record<string, CategoryConfig> = {
  'full-time': {
    slug: 'full-time',
    label: 'Full-Time',
    fullLabel: `Full-Time ${brand.niche.short}`,
    heroSubtitle: `Permanent full-time ${brand.niche.short} positions with benefits`,
    salaryRange: '$110K-170K',
    keywords: ['full time np', 'permanent np', 'salaried np'],
    faqCategory: 'remote', // Use remote FAQ as closest match
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('full-time'),
    }),
    benefits: [
      { title: 'Comprehensive Benefits', description: 'Full health insurance, dental, vision, retirement plans, and PTO — typically 20-30 days off.', iconName: 'Heart' },
      { title: 'Job Security', description: 'Stable employment with consistent income, malpractice coverage, and professional development support.', iconName: 'Shield' },
      { title: 'Career Growth', description: 'Access to leadership tracks, CME funding ($2,000-$5,000/year), and promotion opportunities.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Negotiate sign-on bonuses (often $10K-$25K)',
      'Ask about panel size — aim for 14-18 patients/day',
      'Clarify on-call requirements before accepting',
      'Review non-compete clauses carefully',
      'Confirm CME budget and time-off allowance',
    ],
  },
  'part-time': {
    slug: 'part-time',
    label: 'Part-Time',
    fullLabel: `Part-Time ${brand.niche.short}`,
    heroSubtitle: `Flexible part-time ${brand.niche.short} positions`,
    salaryRange: '$60-100/hr',
    keywords: ['part time np', 'half time np', 'flexible np'],
    faqCategory: 'per-diem',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('part-time'),
    }),
    benefits: [
      { title: 'Work-Life Balance', description: 'Set your own schedule — work 2-3 days per week while maintaining clinical skills and income.', iconName: 'Activity' },
      { title: 'Multiple Income Streams', description: 'Combine part-time with private practice, telehealth, or consulting for maximum earning.', iconName: 'DollarSign' },
      { title: 'Reduced Burnout', description: `Lower caseloads and schedule flexibility help prevent the burnout epidemic in ${brand.niche.category}.`, iconName: 'Heart' },
    ],
    tips: [
      'Clarify whether benefits (health, dental) are included',
      'Negotiate pro-rated PTO and CME days',
      'Check if you can set your preferred schedule',
      'Ask about potential to convert to full-time later',
      'Maintain your own malpractice tail coverage',
    ],
  },
  contract: {
    slug: 'contract',
    label: 'Contract',
    fullLabel: `Contract ${brand.niche.short}`,
    heroSubtitle: `Contract & locum tenens ${brand.niche.short} assignments`,
    salaryRange: '$70-150/hr',
    keywords: ['contract np', 'locum tenens np', '1099 np', 'temp np'],
    faqCategory: 'travel',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('contract'),
    }),
    benefits: [
      { title: 'Premium Pay', description: 'Contract rates are typically 20-50% higher than permanent positions — $70-$150+/hour.', iconName: 'DollarSign' },
      { title: 'Tax Advantages', description: '1099 contractors can deduct travel, housing, CME, malpractice insurance, and home office expenses.', iconName: 'TrendingUp' },
      { title: 'Geographic Freedom', description: 'Try different cities, practice settings, and patient populations before committing long-term.', iconName: 'MapPin' },
    ],
    tips: [
      'Work with reputable staffing agencies (AMN, CompHealth)',
      'Negotiate housing/travel stipends in your contract',
      'Get your own occurrence-based malpractice policy',
      'Set aside 25-30% for self-employment taxes',
      'Ensure contract specifies patient volume expectations',
    ],
  },
};

// Experience Level configs
// Narrative copy below was rewritten for the all-NP board (2026-07); salary
// bands align to the config/niche/salary.ts anchors.
export const EXPERIENCE_LEVEL_CONFIGS: Record<string, CategoryConfig> = {
  'entry-level': {
    slug: 'entry-level',
    label: 'Entry-Level',
    fullLabel: `Entry-Level ${brand.niche.short}`,
    heroSubtitle: `New graduate & early-career ${brand.niche.short} positions with mentorship`,
    salaryRange: '$95K-140K',
    keywords: ['entry level np', 'new grad np', 'junior np', '0-2 years np'],
    faqCategory: 'new-grad',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('entry-level'),
    }),
    benefits: [
      { title: 'Structured Mentorship', description: `Most entry-level positions include 6-12 months of supervised practice with experienced physicians or senior ${brand.niche.short}s.`, iconName: 'Users' },
      { title: 'Competitive Starting Pay', description: `${brand.niche.short} shortage means entry-level pay starts at $95K-$140K — strong compensation right out of school.`, iconName: 'DollarSign' },
      { title: 'Career Launchpad', description: 'Build your clinical foundation with manageable caseloads (8-12 patients/day) before scaling up.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Prioritize positions offering structured supervision',
      'Start with collaborative practice models when possible',
      'Negotiate sign-on bonuses ($5K-$15K common for new grads)',
      'Ask about ramp-up period and initial caseload expectations',
      `Join AANP or your state ${brand.niche.short} association for networking and CE opportunities`,
    ],
  },
  'mid-career': {
    slug: 'mid-career',
    label: 'Mid-Career',
    fullLabel: `Mid-Career ${brand.niche.short}`,
    heroSubtitle: `Experienced ${brand.niche.short} positions for 3-7 years of practice`,
    salaryRange: '$120K-160K',
    keywords: ['experienced np', 'mid career np', '3-5 years np', 'senior np positions'],
    faqCategory: 'remote',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('mid-career'),
    }),
    benefits: [
      { title: 'Higher Compensation', description: `Mid-career ${brand.niche.short}s earn $120K-$160K with premium benefits, CME budgets, and leadership bonuses.`, iconName: 'DollarSign' },
      { title: 'Autonomy & Flexibility', description: 'With proven experience, choose between independent practice, hybrid schedules, or specialized roles.', iconName: 'Activity' },
      { title: 'Specialization Options', description: 'Pivot into urgent care, dermatology, cardiology, palliative care, or private practice consulting.', iconName: 'Shield' },
    ],
    tips: [
      'Leverage experience for higher base salary (benchmark $140K+)',
      'Negotiate productivity bonuses or profit-sharing',
      'Consider adding niche certifications (ENP, GS-C, wound care)',
      'Explore leadership tracks (clinical director, program manager)',
      'Build your referral network for future private practice',
    ],
  },
  senior: {
    slug: 'senior',
    label: 'Senior',
    fullLabel: `Senior ${brand.niche.short}`,
    heroSubtitle: 'Leadership & advanced practice positions for 7+ years experience',
    salaryRange: '$150K-200K+',
    keywords: ['senior np', 'lead np', 'director np', 'advanced practice nurse practitioner'],
    faqCategory: 'remote',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('senior'),
    }),
    benefits: [
      { title: 'Top-Tier Compensation', description: `Senior ${brand.niche.short}s earn $150K-$200K+ with equity, executive benefits, and performance bonuses.`, iconName: 'DollarSign' },
      { title: 'Leadership Impact', description: `Shape clinical programs, mentor junior providers, and influence organizational clinical strategy.`, iconName: 'Users' },
      { title: 'Private Practice Ready', description: 'Your reputation and network support a thriving independent or group practice transition.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Target clinical director or VP-level roles ($170K-$200K+)',
      'Negotiate equity or partnership opportunities',
      'Consider building your own private practice or telehealth group',
      'Pursue board certification in subspecialties for premium positioning',
      'Mentor the next generation — it builds your network and reputation',
    ],
  },
};

// Employer Type configs
// Narrative copy below was rewritten for the all-NP board (2026-07); salary
// bands align to the config/niche/salary.ts anchors.
export const EMPLOYER_TYPE_CONFIGS: Record<string, CategoryConfig> = {
  hospital: {
    slug: 'hospital',
    label: 'Hospital',
    fullLabel: `Hospital ${brand.niche.short}`,
    heroSubtitle: `Hospital-based ${brand.niche.short} positions with full benefits`,
    salaryRange: '$115K-180K',
    keywords: ['hospital np', 'inpatient hospital np', 'academic medical center np'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('hospital'),
    }),
    benefits: [
      { title: 'Full Benefits Package', description: 'Health/dental/vision, pension or 403(b) match, malpractice coverage, CME funding, and tuition reimbursement.', iconName: 'Heart' },
      { title: 'Multidisciplinary Teams', description: 'Collaborate with physicians, pharmacists, social workers, and residents in a structured care environment.', iconName: 'Users' },
      { title: 'Career Advancement', description: `Clear promotion tracks from staff ${brand.niche.short} to clinical lead, program director, or department head.`, iconName: 'TrendingUp' },
    ],
    tips: [
      'Large systems (HCA, Kaiser, Ascension) offer the best benefits',
      'Academic medical centers often include teaching opportunities',
      'Ask about call schedules — hospital roles may require weekend coverage',
      'Negotiate CME days (5-10 per year is standard for hospital systems)',
      'Union hospitals may offer higher base pay and better protections',
    ],
  },
  'private-practice': {
    slug: 'private-practice',
    label: 'Private Practice',
    fullLabel: `Private Practice ${brand.niche.short}`,
    heroSubtitle: `Independent & group practice ${brand.niche.short} opportunities`,
    salaryRange: '$130K-200K+',
    keywords: ['private practice np', 'independent np', 'group practice np', 'own practice np'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('private-practice'),
    }),
    benefits: [
      { title: 'Highest Earning Potential', description: `Practice owners and partners can earn $180K+ with autonomy over fee schedules, payer mix, and patient volume.`, iconName: 'DollarSign' },
      { title: 'Schedule Control', description: 'Set your own hours, choose your patient mix, and build a practice that fits your lifestyle.', iconName: 'Activity' },
      { title: 'Clinical Autonomy', description: 'Full control over treatment plans, visit cadence, and care model without corporate protocols.', iconName: 'Shield' },
    ],
    tips: [
      'Full practice authority states are ideal for independent practice',
      'Start by joining an established group before going solo',
      'Build a sustainable patient panel sized to your specialty and visit model',
      'Invest in an EHR and billing platform suited to your specialty',
      'Get credentialed with major insurers before launching',
    ],
  },
  'community-health': {
    slug: 'community-health',
    label: 'Community Health',
    fullLabel: `Community Health ${brand.niche.short}`,
    heroSubtitle: `FQHC, community health & public health positions`,
    salaryRange: '$110K-160K',
    keywords: ['community health np', 'FQHC np', 'community health center np', 'public health np'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('community-health'),
    }),
    benefits: [
      { title: 'Loan Repayment', description: 'NHSC loan repayment up to $50K for 2 years of service at qualifying FQHCs and underserved sites.', iconName: 'DollarSign' },
      { title: 'Mission-Driven Work', description: `Serve underserved populations and make a direct impact on community health outcomes.`, iconName: 'Heart' },
      { title: 'Diverse Experience', description: 'Treat a wide range of conditions across all ages, building broad clinical expertise quickly.', iconName: 'Activity' },
    ],
    tips: [
      'Check NHSC loan repayment eligibility for your site (hpsa.hrsa.gov)',
      'FQHCs provide malpractice coverage under FTCA — a major benefit',
      'Expect higher patient volumes (16-22/day) but broader scope',
      'Bilingual skills are highly valued and may qualify for pay differentials',
      'Community health experience is excellent for future leadership roles',
    ],
  },
  va: {
    slug: 'va',
    label: 'VA',
    fullLabel: `VA ${brand.niche.short}`,
    heroSubtitle: `Veterans Affairs ${brand.niche.short} positions with federal benefits`,
    salaryRange: '$120K-170K',
    keywords: ['VA np', 'veterans affairs np', 'military np', 'federal np'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('va'),
    }),
    benefits: [
      { title: 'Federal Benefits', description: 'Federal pension (FERS), TSP retirement matching, FEHB health insurance, and 26 days PTO starting.', iconName: 'Shield' },
      { title: 'Full Practice Authority', description: `VA grants ${brand.niche.short}s full practice authority nationwide regardless of state laws — prescribe independently.`, iconName: 'Heart' },
      { title: 'Student Loan Repayment', description: 'EDRP offers up to $200K in student loan repayment for qualifying VA positions.', iconName: 'DollarSign' },
    ],
    tips: [
      'VA applications go through USAJobs.gov — create your profile early',
      'Apply under Direct Hire Authority for faster processing',
      'PTSD and TBI experience is highly valued at VA facilities',
      'Federal pay is based on GS/GP scales — negotiate within the grade',
      'VA offers some of the best work-life balance in healthcare',
    ],
  },
};

// Population Specialty configs
// Narrative copy below was rewritten for the all-NP board (2026-07); salary
// bands align to the config/niche/salary.ts anchors.
export const POPULATION_SPECIALTY_CONFIGS: Record<string, CategoryConfig> = {
  geriatric: {
    slug: 'geriatric',
    label: 'Geriatric',
    fullLabel: `Geriatric ${brand.niche.short}`,
    heroSubtitle: `Older adult & geriatric ${brand.niche.short} positions`,
    salaryRange: '$110K-160K',
    keywords: ['geriatric np', 'gerontology np', 'elderly care NP', 'older adult health'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('geriatric'),
    }),
    benefits: [
      { title: 'Growing Demand', description: `10,000 baby boomers turn 65 daily — geriatric care is one of the fastest-growing ${brand.niche.short} niches.`, iconName: 'TrendingUp' },
      { title: 'Meaningful Care', description: `Help older adults maintain independence and quality of life through expert medication management.`, iconName: 'Heart' },
      { title: 'Diverse Settings', description: 'Work in SNFs, memory care units, home health, outpatient clinics, or palliative care programs.', iconName: 'Building2' },
    ],
    tips: [
      'Pursue gerontological specialty certification (GS-C) for premium positioning',
      'Understand polypharmacy risks and Beers Criteria medications',
      'Learn dementia assessment tools (MoCA, MMSE, GDS)',
      'Build relationships with geriatricians for collaborative care',
      'SNF and consulting roles often command premium hourly rates',
    ],
  },
  veterans: {
    slug: 'veterans',
    label: 'Veterans',
    fullLabel: `Veterans ${brand.niche.short}`,
    heroSubtitle: `Military & veteran-focused ${brand.niche.short} positions`,
    salaryRange: '$110K-170K',
    keywords: ['veterans np', 'military health np', 'VA community care np', 'veteran care NP'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('veterans'),
    }),
    benefits: [
      { title: 'Critical Mission', description: `Veterans carry distinct health burdens — polytrauma, TBI, toxic exposures, chronic pain — and veteran-focused ${brand.niche.short}s close real care gaps.`, iconName: 'Heart' },
      { title: 'Specialized Training', description: 'VA-funded continuing education and fellowship pathways span primary care, rehabilitation, and specialty medicine.', iconName: 'Shield' },
      { title: 'Federal Benefits', description: 'VA positions include federal pension, TSP matching, 26+ days PTO, and up to $200K loan repayment.', iconName: 'DollarSign' },
    ],
    tips: [
      'TBI, polytrauma, and toxic-exposure (PACT Act) expertise is in high demand',
      'Learn VA disability and service-connected documentation requirements',
      'Military-connected clinicians are especially valued',
      `Community-based veteran organizations also hire ${brand.niche.short}s`,
      'Tri-care network providers serve military families outside VA system',
    ],
  },
  lgbtq: {
    slug: 'lgbtq',
    label: 'LGBTQ+',
    fullLabel: `LGBTQ+ Affirming ${brand.niche.short}`,
    heroSubtitle: `LGBTQ+ affirming ${brand.niche.short} positions`,
    salaryRange: '$110K-170K',
    keywords: ['lgbtq np', 'gender affirming np', 'transgender health', 'lgbtq affirming NP'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('lgbtq'),
    }),
    benefits: [
      { title: 'Underserved Niche', description: `LGBTQ+ individuals face well-documented health disparities — affirming, trained providers are critically needed.`, iconName: 'Heart' },
      { title: 'Growing Demand', description: 'Gender-affirming care is expanding rapidly with new clinics and telehealth platforms specifically serving the community.', iconName: 'TrendingUp' },
      { title: 'Meaningful Impact', description: `Help reduce health disparities by providing culturally competent care to marginalized populations.`, iconName: 'Users' },
    ],
    tips: [
      'Complete WPATH SOC training for gender-affirming care fundamentals',
      `Understand hormone therapy interactions with commonly prescribed medications`,
      'Build cultural competency through LGBTQ+ affirming practice workshops',
      'Fenway Health and Callen-Lorde are model programs to study',
      'Telehealth expands reach to LGBTQ+ patients in underserved areas',
    ],
  },
  // NP taxonomy migration (2026-07): 'crisis' config removed — slug no
  // longer in taxonomy-registry.ts.
};

// Merge setting configs with city-aware buildWhere
function settingToCategory(config: SettingConfig): CategoryConfig {
  return {
    ...config,
    buildWhere: (stateName: string, cityName?: string) => {
      const base = config.buildWhere(stateName);
      if (cityName) {
        return { ...base, city: { equals: cityName, mode: 'insensitive' } };
      }
      return base;
    },
  };
}

// ─── NP taxonomy category configs (2026-07 migration) ─────────────────────────
//
// Minimal, honest configs for the 19 NP slugs added by the taxonomy
// migration (lib/pseo/taxonomy-registry.ts) so every CITY-eligible category
// has a working /jobs/<slug>/city/[slug] route. Mirrors the
// buildNpSpecialtyConfig pattern in setting-state-config.ts.
//
// TODO(content): per-board editorial copy + researched salary bands — see
// docs/pilot-fork-runbook.md §3. salaryRange values are broad national
// estimates consistent with config/niche/salary.ts (staff NP ~$95-140K
// bands; CRNA drives the $180K-250K high end).
//
// QUERY NOTE: the ingest classifier (lib/pseo/category-tagger.ts) now emits
// the 42-slug NP taxonomy (2026-07 classifier migration), so these buildWhere
// clauses go through the normal withTagFallback() path like the legacy
// configs: precomputed `categoryTags` containment first, legacy keyword
// fallback only for rows whose tags haven't been backfilled yet.
//
// faqCategory is the slug itself: getCategoryFaqs() returns [] for unmapped
// keys and CategoryFAQ renders nothing (no empty/mismatched FAQPage schema);
// the city template builds its FAQ block inline from label/salaryRange.

interface NpCategoryConfigInput {
  slug: CategoryTag;
  label: string;
  fullLabel: string;
  heroSubtitle: string;
  salaryRange: string;
  keywords: string[];
}

function buildNpCategoryConfig(input: NpCategoryConfigInput): CategoryConfig {
  return {
    ...input,
    faqCategory: input.slug, // CategoryFAQ renders nothing for unmapped keys
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback(input.slug),
    }),
    benefits: [
      { title: 'Growing Demand', description: `${input.fullLabel} roles are among the fastest-growing advanced practice positions nationwide.`, iconName: 'TrendingUp' },
      { title: 'Practice Variety', description: 'Openings span health systems, private groups, and community settings.', iconName: 'Building2' },
      { title: 'Career Mobility', description: 'State licensure plus national certification keeps your options open across employers and settings.', iconName: 'Users' },
    ],
    tips: [
      'Verify state APRN licensure and prescriptive authority requirements',
      'Keep national certification and CE credits current',
      'Compare total compensation — base, incentives, CME, and benefits',
      'Ask about caseload, support staffing, and documentation time',
      'Confirm collaborative or supervisory agreement requirements in this state',
    ],
  };
}

// TODO(content): all salaryRange values below are estimates — see block comment above.
export const NP_CATEGORY_CONFIGS: Record<string, CategoryConfig> = {
  'urgent-care': buildNpCategoryConfig({
    slug: 'urgent-care',
    label: 'Urgent Care',
    fullLabel: 'Urgent Care NP',
    heroSubtitle: 'Walk-in clinic & urgent care nurse practitioner positions',
    salaryRange: '$105K-140K',
    keywords: ['urgent care nurse practitioner', 'urgent care NP jobs', 'walk-in clinic NP'],
  }),
  'home-health': buildNpCategoryConfig({
    slug: 'home-health',
    label: 'Home Health',
    fullLabel: 'Home Health NP',
    heroSubtitle: 'In-home visit & house-call nurse practitioner positions',
    salaryRange: '$100K-135K',
    keywords: ['home health nurse practitioner', 'home health NP jobs', 'house call NP'],
  }),
  'family-practice': buildNpCategoryConfig({
    slug: 'family-practice',
    label: 'Family Practice',
    fullLabel: 'Family Practice NP (FNP)',
    heroSubtitle: 'Family practice nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['family practice nurse practitioner', 'FNP jobs', 'family nurse practitioner'],
  }),
  'adult-gerontology': buildNpCategoryConfig({
    slug: 'adult-gerontology',
    label: 'Adult-Gerontology',
    fullLabel: 'Adult-Gerontology NP (AGNP)',
    heroSubtitle: 'Adult-gerontology nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['adult gerontology nurse practitioner', 'AGNP jobs', 'AGACNP', 'AGPCNP'],
  }),
  pediatric: buildNpCategoryConfig({
    slug: 'pediatric',
    label: 'Pediatric',
    fullLabel: 'Pediatric NP (PNP)',
    heroSubtitle: 'Pediatric nurse practitioner positions',
    salaryRange: '$105K-145K',
    keywords: ['pediatric nurse practitioner', 'PNP jobs', 'peds NP'],
  }),
  neonatal: buildNpCategoryConfig({
    slug: 'neonatal',
    label: 'Neonatal',
    fullLabel: 'Neonatal NP (NNP)',
    heroSubtitle: 'NICU & newborn care nurse practitioner positions',
    salaryRange: '$115K-155K',
    keywords: ['neonatal nurse practitioner', 'NNP jobs', 'NICU nurse practitioner'],
  }),
  'women-health': buildNpCategoryConfig({
    slug: 'women-health',
    label: "Women's Health",
    fullLabel: "Women's Health NP (WHNP)",
    heroSubtitle: "Women's health nurse practitioner positions",
    salaryRange: '$105K-145K',
    keywords: ["women's health nurse practitioner", 'WHNP jobs', 'OB/GYN nurse practitioner'],
  }),
  'acute-care': buildNpCategoryConfig({
    slug: 'acute-care',
    label: 'Acute Care',
    fullLabel: 'Acute Care NP (ACNP)',
    heroSubtitle: 'Acute care nurse practitioner positions',
    salaryRange: '$115K-160K',
    keywords: ['acute care nurse practitioner', 'ACNP jobs', 'ICU nurse practitioner'],
  }),
  emergency: buildNpCategoryConfig({
    slug: 'emergency',
    label: 'Emergency',
    fullLabel: 'Emergency NP (ENP)',
    heroSubtitle: 'Emergency nurse practitioner positions',
    salaryRange: '$115K-160K',
    keywords: ['emergency nurse practitioner', 'ENP jobs', 'ER nurse practitioner'],
  }),
  'psychiatric-mental-health': buildNpCategoryConfig({
    slug: 'psychiatric-mental-health',
    label: 'Psychiatric Mental Health',
    fullLabel: 'Psychiatric Mental Health NP (PMHNP)',
    heroSubtitle: 'Psychiatric mental health nurse practitioner positions',
    salaryRange: '$120K-170K',
    keywords: ['psychiatric nurse practitioner', 'PMHNP jobs', 'psych NP'],
  }),
  oncology: buildNpCategoryConfig({
    slug: 'oncology',
    label: 'Oncology',
    fullLabel: 'Oncology NP',
    heroSubtitle: 'Oncology nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['oncology nurse practitioner', 'oncology NP jobs', 'hematology oncology NP'],
  }),
  cardiology: buildNpCategoryConfig({
    slug: 'cardiology',
    label: 'Cardiology',
    fullLabel: 'Cardiology NP',
    heroSubtitle: 'Cardiology nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['cardiology nurse practitioner', 'cardiology NP jobs', 'cardiovascular NP'],
  }),
  'primary-care': buildNpCategoryConfig({
    slug: 'primary-care',
    label: 'Primary Care',
    fullLabel: 'Primary Care NP',
    heroSubtitle: 'Primary care nurse practitioner positions',
    salaryRange: '$100K-140K',
    keywords: ['primary care nurse practitioner', 'primary care NP jobs', 'internal medicine NP'],
  }),
  hospitalist: buildNpCategoryConfig({
    slug: 'hospitalist',
    label: 'Hospitalist',
    fullLabel: 'Hospitalist NP',
    heroSubtitle: 'Inpatient medicine nurse practitioner positions',
    salaryRange: '$110K-150K',
    keywords: ['hospitalist nurse practitioner', 'hospitalist NP jobs', 'inpatient medicine NP'],
  }),
  dermatology: buildNpCategoryConfig({
    slug: 'dermatology',
    label: 'Dermatology',
    fullLabel: 'Dermatology NP',
    heroSubtitle: 'Dermatology nurse practitioner positions',
    salaryRange: '$110K-155K',
    keywords: ['dermatology nurse practitioner', 'dermatology NP jobs', 'derm NP'],
  }),
  orthopedic: buildNpCategoryConfig({
    slug: 'orthopedic',
    label: 'Orthopedic',
    fullLabel: 'Orthopedic NP',
    heroSubtitle: 'Orthopedic nurse practitioner positions',
    salaryRange: '$105K-145K',
    keywords: ['orthopedic nurse practitioner', 'orthopedic NP jobs', 'ortho NP'],
  }),
  anesthesia: buildNpCategoryConfig({
    slug: 'anesthesia',
    label: 'Nurse Anesthetist',
    fullLabel: 'Nurse Anesthetist (CRNA)',
    heroSubtitle: 'Certified registered nurse anesthetist positions',
    salaryRange: '$180K-250K',
    keywords: ['CRNA jobs', 'nurse anesthetist', 'certified registered nurse anesthetist'],
  }),
  midwifery: buildNpCategoryConfig({
    slug: 'midwifery',
    label: 'Nurse Midwife',
    fullLabel: 'Nurse Midwife (CNM)',
    heroSubtitle: 'Certified nurse midwife positions',
    salaryRange: '$105K-140K',
    keywords: ['CNM jobs', 'certified nurse midwife', 'nurse midwifery'],
  }),
  'clinical-nurse-specialist': buildNpCategoryConfig({
    slug: 'clinical-nurse-specialist',
    label: 'Clinical Nurse Specialist',
    fullLabel: 'Clinical Nurse Specialist (CNS)',
    heroSubtitle: 'Clinical nurse specialist positions',
    salaryRange: '$95K-130K',
    keywords: ['clinical nurse specialist', 'CNS jobs', 'CNS nurse jobs'],
  }),
  // ── 2026-07 P1 #15 verticals. salaryRange uses the board-wide typical
  // NP comparison band (config/niche/salary.ts normalizer.typical) until
  // per-specialty market data lands — never an invented per-slug figure.
  aesthetics: buildNpCategoryConfig({
    slug: 'aesthetics',
    label: 'Aesthetics',
    fullLabel: 'Aesthetic NP',
    heroSubtitle: 'Med spa & aesthetic medicine nurse practitioner positions',
    salaryRange: '$110K-170K',
    keywords: ['aesthetic nurse practitioner', 'aesthetics NP jobs', 'med spa NP', 'nurse injector'],
  }),
  'pain-management': buildNpCategoryConfig({
    slug: 'pain-management',
    label: 'Pain Management',
    fullLabel: 'Pain Management NP',
    heroSubtitle: 'Interventional pain & pain medicine nurse practitioner positions',
    salaryRange: '$110K-170K',
    keywords: ['pain management nurse practitioner', 'pain management NP jobs', 'interventional pain NP'],
  }),
  'palliative-hospice': buildNpCategoryConfig({
    slug: 'palliative-hospice',
    label: 'Palliative & Hospice',
    fullLabel: 'Palliative Care & Hospice NP',
    heroSubtitle: 'Palliative care & hospice nurse practitioner positions',
    salaryRange: '$110K-170K',
    keywords: ['palliative care nurse practitioner', 'hospice nurse practitioner', 'palliative NP jobs'],
  }),
};

export const ALL_CATEGORY_CONFIGS: Record<string, CategoryConfig> = {
  // Settings (5)
  remote: settingToCategory(SETTING_CONFIGS.remote),
  telehealth: settingToCategory(SETTING_CONFIGS.telehealth),
  inpatient: settingToCategory(SETTING_CONFIGS.inpatient),
  outpatient: settingToCategory(SETTING_CONFIGS.outpatient),
  travel: settingToCategory(SETTING_CONFIGS.travel),
  // Specialties (2: new-grad, per-diem)
  ...SPECIALTY_CONFIGS,
  // Job Types (3)
  ...JOB_TYPE_CONFIGS,
  // Experience Levels (3)
  ...EXPERIENCE_LEVEL_CONFIGS,
  // Employer Types (4)
  ...EMPLOYER_TYPE_CONFIGS,
  // Population Specialties (3: geriatric, veterans, lgbtq)
  ...POPULATION_SPECIALTY_CONFIGS,
  // NP taxonomy categories (19 — 2026-07 migration)
  ...NP_CATEGORY_CONFIGS,
  // ─── Additional Categories (3) ─────────────────────────────────────────────
  '1099': {
    slug: '1099',
    label: '1099',
    fullLabel: `1099 / Independent Contractor ${brand.niche.short}`,
    heroSubtitle: `Independent contractor & 1099 ${brand.niche.short} positions`,
    salaryRange: '$75-150/hr',
    keywords: ['1099 np', 'independent contractor np', '1099 nurse practitioner', 'contract NP'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('1099'),
    }),
    benefits: [
      { title: 'Higher Gross Pay', description: `1099 ${brand.niche.short}s earn $75-$150+/hr — 20-40% higher than W2 rates with significant tax deduction opportunities.`, iconName: 'DollarSign' },
      { title: 'Schedule Control', description: 'Set your own hours, work with multiple clients, and control your patient volume and caseload.', iconName: 'Clock' },
      { title: 'Tax Advantages', description: 'Deduct business expenses, contribute $66K/year to SEP-IRA, and write off home office and mileage.', iconName: 'DollarSign' },
    ],
    tips: [
      'Form an LLC or PLLC before signing your first contract',
      'Get individual malpractice insurance ($1.5-3K/year)',
      'Set up quarterly estimated tax payments with the IRS',
      'Open a SEP-IRA or Solo 401k for retirement savings',
      'Keep detailed records of all business expenses for deductions',
    ],
  },
  // NP taxonomy migration (2026-07): 'behavioral-health' config removed —
  // slug no longer in taxonomy-registry.ts.
  correctional: {
    slug: 'correctional',
    label: 'Correctional',
    fullLabel: `Correctional ${brand.niche.short}`,
    heroSubtitle: `Prison, jail & correctional facility ${brand.niche.short} positions`,
    salaryRange: '$130K-190K',
    keywords: ['correctional np', 'prison np', 'correctional health NP', 'jail nurse practitioner'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('correctional'),
    }),
    benefits: [
      { title: 'Premium Pay', description: `Correctional ${brand.niche.short}s earn $130K-$190K+ due to the challenging environment and high demand for correctional healthcare providers.`, iconName: 'DollarSign' },
      { title: 'Loan Repayment', description: 'Many correctional facilities qualify for NHSC and state loan repayment programs — up to $50K for 2 years of service.', iconName: 'DollarSign' },
      { title: 'Unique Clinical Skills', description: 'Develop expertise in correctional medicine, emergency response, and managing complex comorbidities in underserved populations.', iconName: 'Shield' },
    ],
    tips: [
      'CPI (Crisis Prevention Institute) certification is usually required',
      'Expect a structured environment with security protocols',
      'Correctional experience is highly valued for forensic and public-sector healthcare careers',
      'Many positions are with staffing companies (Centurion, Wellpath, NaphCare)',
      'Federal BOP (Bureau of Prisons) positions include federal benefits',
    ],
  },
  'locum-tenens': {
    slug: 'locum-tenens',
    label: 'Locum Tenens',
    fullLabel: `Locum Tenens ${brand.niche.short}`,
    heroSubtitle: `Temporary assignment & locum tenens ${brand.niche.short} positions`,
    salaryRange: '$80-160/hr',
    keywords: ['locum tenens np', 'locum NP', 'temporary assignment np', 'locum nurse practitioner'],
    faqCategory: 'travel',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('locum-tenens'),
    }),
    benefits: [
      { title: 'Highest Hourly Rates', description: `Locum tenens ${brand.niche.short}s earn $80-$160/hr — the highest hourly rates in ${brand.niche.adjective} nursing with full travel expenses covered.`, iconName: 'DollarSign' },
      { title: 'No Long-Term Commitment', description: 'Assignments from 2 weeks to 6+ months. Take breaks between assignments and maintain complete career flexibility.', iconName: 'Calendar' },
      { title: 'Nationwide Opportunities', description: 'Work across multiple states, experience different healthcare systems, and build a diverse clinical portfolio.', iconName: 'MapPin' },
    ],
    tips: [
      'Maintain active licenses in multiple states via compact agreements',
      'Work with 2-3 locum agencies for the best selection of assignments',
      'Negotiate per diem rates, housing, and travel expenses separately',
      'Keep credentialing documents updated and organized digitally',
      'Build relationships for repeat assignments at preferred facilities',
    ],
  },
};

/** All valid category slugs for routing */
export function getAllCategorySlugs(): string[] {
  return Object.keys(ALL_CATEGORY_CONFIGS);
}

// ─── Data Fetching ─────────────────────────────────────────────────────────────

async function getCityJobs(config: CategoryConfig, city: CityData, skip = 0, take = 10) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where = config.buildWhere(city.state, city.name) as any;
    return await prisma.job.findMany({
      where,
      omit: JOB_LISTING_OMIT, // Perf1: don't pull the multi-KB description for cards
      orderBy: BEST_SORT_ORDER_BY,
      skip,
      take,
    });
  } catch (error) {
    console.error(`[category-city] Failed to fetch jobs for ${config.slug}/${city.slug}:`, error);
    return [];
  }
}

interface CityStats {
  totalJobs: number;
  rawAvgSalary: number;
  colAdjustedSalary: number;
  /**
   * When the counts were actually computed: pseoStats.updatedAt for fresh
   * cached rows, "now" for live-count fallbacks, null when no data exists
   * (the page redirects/404s before rendering in that case).
   */
  statsAsOf: Date | null;
}

const EMPTY_STATS: CityStats = { totalJobs: 0, rawAvgSalary: 0, colAdjustedSalary: 0, statsAsOf: null };

// Staleness window for cached pseoStats rows. Matches PSEO_STALENESS_HOURS in
// app/api/sitemaps/cities/[batch]/route.ts and the aggregate-pseo staleness
// probe (app/api/cron/aggregate-pseo/staleness.ts) — 3x the 6h cron cadence.
// Rows older than this are treated as unreliable: a stale positive count would
// otherwise render frozen job counts (soft-404 pattern on never-refreshed
// cities), so we recount live instead.
const STATS_STALENESS_HOURS = 36;
const STATS_STALENESS_MS = STATS_STALENESS_HOURS * 60 * 60 * 1000;

// Perf2: cache() dedupes the duplicate call within a render (metadata + page
// component both call getCityStats with the same module-level config/city refs).
const getCityStats = cache(async function getCityStats(config: CategoryConfig, city: CityData): Promise<CityStats> {
  let cachedRow: { totalJobs: number; rawAvgSalary: number; colAdjustedSalary: number; updatedAt: Date } | null = null;
  try {
    const stats = await prisma.pseoStats.findUnique({
      where: {
        type_categorySlug_locationSlug: {
          type: 'category-city',
          categorySlug: config.slug,
          locationSlug: city.slug,
        }
      }
    });

    if (stats && stats.totalJobs > 0) {
      cachedRow = stats;
      const isFresh = Date.now() - stats.updatedAt.getTime() <= STATS_STALENESS_MS;
      if (isFresh) {
        return {
          totalJobs: stats.totalJobs,
          rawAvgSalary: stats.rawAvgSalary,
          colAdjustedSalary: stats.colAdjustedSalary,
          statsAsOf: stats.updatedAt,
        };
      }
    }

    // Fallback: live count when the pseoStats cache is empty, zero, or stale.
    // A stale positive row is NOT trusted — if the live count is 0 the page
    // correctly redirects instead of rendering frozen counts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where = config.buildWhere(city.state, city.name) as any;
    const liveCount = await prisma.job.count({ where });
    if (liveCount > 0) {
      // Compute rough avg salary from live data
      const salaryAgg = await prisma.job.aggregate({
        where,
        _avg: { normalizedMaxSalary: true, normalizedMinSalary: true },
      });
      const rawAvg = Math.round(((salaryAgg._avg.normalizedMinSalary ?? 0) + (salaryAgg._avg.normalizedMaxSalary ?? 0)) / 2 / 1000);
      const colAdj = Math.round(rawAvg * (100 / (city.costOfLivingIndex || 100)));
      return { totalJobs: liveCount, rawAvgSalary: rawAvg, colAdjustedSalary: colAdj, statsAsOf: new Date() };
    }

    return EMPTY_STATS;
  } catch (error) {
    console.error(`[category-city] Failed to fetch stats for ${config.slug}/${city.slug}:`, error);
    // If the live recount failed but we hold a (possibly stale) positive row,
    // prefer it — with its REAL date — over redirecting a page that likely
    // still has jobs. Transient DB errors must not 308 live pages away.
    if (cachedRow) {
      return {
        totalJobs: cachedRow.totalJobs,
        rawAvgSalary: cachedRow.rawAvgSalary,
        colAdjustedSalary: cachedRow.colAdjustedSalary,
        statsAsOf: cachedRow.updatedAt,
      };
    }
    // No trusted row to fall back on. `cachedRow` is only ever assigned INSIDE
    // the try after a successful findUnique returning a positive row, so
    // reaching here means the FIRST query failed and we hold zero evidence
    // that this combo is empty. Returning EMPTY_STATS would make the caller
    // permanentRedirect() (line ~1319) — a 308 is a PERMANENT signal, cached
    // by the route's `revalidate = 3600` and consolidated by Google — so a DB
    // blip would fold the whole category×city surface into its parents.
    // Rethrow: a 5xx is retried and never moves a URL. Absence of data is not
    // evidence of an empty page.
    throw error;
  }
});

/**
 * Hero badge copy that only claims "updated today" when the underlying data
 * was actually computed today (UTC). Fresh-cache rows carry pseoStats
 * .updatedAt; live fallback counts are "now". Anything older shows the real
 * date so stale-positive rows can't render a false freshness claim.
 *
 * Exported (P2 #15) so lib/pseo/setting-state-template.tsx renders the same
 * freshness contract on the ~663 state pages instead of hardcoding "updated
 * today". ONE implementation — a copy is how the two surfaces drift.
 */
export function formatStatsBadge(totalJobs: number, statsAsOf: Date | null): string {
  const asOf = statsAsOf ?? new Date();
  const isToday = asOf.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  const freshness = isToday
    ? 'updated today'
    : `updated ${asOf.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return `${totalJobs} live roles · ${freshness}`;
}

// ─── Qualification facts per category (P2 #8) ─────────────────────────────────

/**
 * Certification/licensure facts for the "what qualifications do I need" FAQ.
 * ONE builder feeds both the visible accordion answer and the FAQPage
 * JSON-LD (B52 rule), so a wrong body here is wrong in both places.
 *
 * WHY THIS EXISTS: the template asserted "National board certification (ANCC
 * or AANP)" for EVERY one of the 42 categories. That is factually wrong for
 * the APRN cohort this board carries — CRNAs certify through the NBCRNA and
 * CNMs through the AMCB, neither of which administers an AANP/ANCC exam —
 * and wrong for the population-specific NP tracks (PNCB for pediatrics, NCC
 * for neonatal and women's health, ANCC/AACN for acute care and CNS).
 *
 * TRUTH RULE: every entry below must agree with the per-specialty
 * certification answers in lib/pseo/category-faq-data.ts. Change both or
 * neither.
 */
interface CategoryCredentialFacts {
  /** Role noun used in the answer body, e.g. 'CRNA'. */
  role: string;
  /** Indefinite article for `role` as SPOKEN ("an NP", "a CRNA"). */
  article: 'a' | 'an';
  /** True when config.label alone already reads as the full role noun. */
  standaloneLabel: boolean;
  /** Degree / programme clause. */
  degree: string;
  /** Certification clause naming the correct certifying body. */
  certification: string;
  /** Controlled-substance clause. */
  dea: string;
}

const DEFAULT_CREDENTIALS: CategoryCredentialFacts = {
  role: brand.niche.short,
  article: 'an',
  standaloneLabel: false,
  degree: `a master's or doctoral degree from an accredited ${brand.niche.descriptor} program`,
  certification: 'national board certification through AANP or ANCC on the population track that matches the role',
  dea: 'DEA registration for prescribing controlled substances',
};

/** Categories whose certifying body is NOT AANP/ANCC (or is track-specific). */
const CATEGORY_CREDENTIALS: Record<string, CategoryCredentialFacts> = {
  anesthesia: {
    role: 'CRNA',
    article: 'a',
    standaloneLabel: true,
    degree: 'a graduate degree from a nurse anesthesia program accredited by the Council on Accreditation (COA) — admission requires critical-care RN experience, and entry-level programs now award a doctorate',
    certification: 'national certification through the NBCRNA (National Board of Certification and Recertification of Nurse Anesthetists), maintained through its Continued Professional Certification program',
    dea: 'DEA registration where the role includes ordering or prescribing controlled substances',
  },
  midwifery: {
    role: 'CNM',
    article: 'a',
    standaloneLabel: true,
    degree: 'a graduate degree from a midwifery program accredited by the Accreditation Commission for Midwifery Education (ACME)',
    certification: 'national certification through the American Midwifery Certification Board (AMCB)',
    dea: 'DEA registration for prescribing controlled substances',
  },
  'clinical-nurse-specialist': {
    role: 'CNS',
    article: 'a',
    standaloneLabel: true,
    degree: 'a graduate CNS program in a defined specialty population',
    certification: 'national certification for that population — for example AGCNS-BC through ANCC, or an ACCNS credential through the American Association of Critical-Care Nurses (AACN)',
    dea: 'DEA registration where the state grants CNS prescriptive authority',
  },
  pediatric: {
    role: 'PNP',
    article: 'a',
    standaloneLabel: false,
    degree: `a master's or doctoral degree from a pediatric ${brand.niche.descriptor} program`,
    certification: 'national certification through the Pediatric Nursing Certification Board (PNCB) — CPNP-PC for primary care or CPNP-AC for acute care',
    dea: 'DEA registration for prescribing controlled substances',
  },
  neonatal: {
    role: 'NNP',
    article: 'an',
    standaloneLabel: false,
    degree: `a master's or doctoral degree from a neonatal ${brand.niche.descriptor} program`,
    certification: 'NNP-BC certification through the National Certification Corporation (NCC)',
    dea: 'DEA registration for prescribing controlled substances',
  },
  'women-health': {
    role: 'WHNP',
    article: 'a',
    standaloneLabel: false,
    degree: `a master's or doctoral degree from a women's health ${brand.niche.descriptor} program`,
    certification: 'WHNP-BC certification through the National Certification Corporation (NCC)',
    dea: 'DEA registration for prescribing controlled substances',
  },
  'acute-care': {
    role: `acute care ${brand.niche.short}`,
    article: 'an',
    standaloneLabel: false,
    degree: `a master's or doctoral degree from an acute-care-focused ${brand.niche.descriptor} program`,
    certification: 'national certification on the acute care track — AGACNP-BC through ANCC or ACNPC-AG through the American Association of Critical-Care Nurses (AACN)',
    dea: 'DEA registration for prescribing controlled substances',
  },
};

export function getCategoryCredentials(categorySlug: string): CategoryCredentialFacts {
  return CATEGORY_CREDENTIALS[categorySlug] ?? DEFAULT_CREDENTIALS;
}

// ─── Shortage-claim gate (P2 #7) ───────────────────────────────────────────────

/**
 * Does the donor shortage column describe THIS category's specialty at all?
 *
 * `CityData.mentalHealthShortage` is the donor board's BEHAVIORAL-HEALTH
 * -discipline HRSA HPSA column (see ./city-data/types.ts). Naming the
 * discipline in the copy is necessary but NOT sufficient: a behavioral-health
 * designation is still the donor niche when it is published on
 * /jobs/dermatology/city/houston-tx, and 2,650 of the 4,135 cities carry the
 * flag — so an ungated surface reaches most of a 42-category × 4.1K-city
 * corpus, which is exactly what the niche-copy ratchets exist to prevent.
 *
 * Use this for surfaces that report BOTH polarities (the Community Profile
 * tile renders "Not designated" too, which is a real and useful fact for a
 * behavioral-health job seeker weighing NHSC eligibility). Use
 * `shortageIsOnTopic` for surfaces that only ever make the AFFIRMATIVE claim.
 */
export function categoryOwnsShortageData(categorySlug: string): boolean {
  return PSYCH_SPECIALTY_SLUG !== undefined && categorySlug === PSYCH_SPECIALTY_SLUG;
}

/**
 * Is this city's designation an on-topic AFFIRMATIVE claim for this category?
 *
 * Every surface that STATES the designation routes through this one predicate
 * — OG param, meta description, careers FAQ answer — so they cannot drift
 * apart again. The scoring functions below deliberately do NOT use it: they
 * consume the flag as an internal demand signal and publish nothing.
 */
export function shortageIsOnTopic(city: CityData, categorySlug: string): boolean {
  return city.mentalHealthShortage && categoryOwnsShortageData(categorySlug);
}

// ─── Market Demand Score ───────────────────────────────────────────────────────

function getMarketDemandScore(city: CityData, totalJobs: number): { score: number; label: string; color: string } {
  let score = 0;

  // Job availability (0-40 points)
  if (totalJobs >= 20) score += 40;
  else if (totalJobs >= 10) score += 30;
  else if (totalJobs >= 5) score += 20;
  else if (totalJobs >= 1) score += 10;

  // Shortage designation (0-25 points).
  // CAVEAT (P2 #7): `mentalHealthShortage` is the donor board's
  // behavioral-health-discipline HPSA flag — the dataset carries no
  // primary-care HPSA column, so this is a proxy, not an all-NP shortage
  // measure. It stays in the composite because the visible "Demand" readout
  // is an explicitly-labelled index, not a cited statistic; the score is NOT
  // re-weighted here because that would shift the label on ~100K indexed
  // pages. Replace the input, not the weight, once primary-care HPSA data
  // lands in city-data/types.ts.
  if (city.mentalHealthShortage) score += 25;
  else if (city.providerRatio === 'low') score += 20;
  else if (city.providerRatio === 'moderate') score += 10;

  // Population (0-20 points)
  if (city.population >= 500000) score += 20;
  else if (city.population >= 100000) score += 15;
  else if (city.population >= 50000) score += 10;
  else score += 5;

  // Healthcare infrastructure (0-15 points)
  if (city.healthcareSystems.length >= 4) score += 15;
  else if (city.healthcareSystems.length >= 2) score += 10;
  else if (city.healthcareSystems.length >= 1) score += 5;

  if (score >= 75) return { score, label: 'Very High', color: '#10b981' };
  if (score >= 55) return { score, label: 'High', color: '#22c55e' };
  if (score >= 35) return { score, label: 'Moderate', color: '#f59e0b' };
  return { score, label: 'Growing', color: '#6b7280' };
}

// ─── Quality Score (for rendering gate) ─────────────────────────────────────
// GSC Fix: Pages with 0 matching jobs ALWAYS return 404.
// Previously, big cities (Tampa, NYC) could pass the ≥25 threshold with 0 jobs
// and render an empty shell → Google flagged as soft 404, wasting crawl budget.
// Now: totalJobs === 0 → hard 404. No exceptions.
// The quality score is still used for noindex gating on pages WITH jobs
// (e.g., a small city with 1 job but no healthcare systems → noindex).

// Minimum jobs threshold for indexing — pages below this are noindex, follow.
// Enterprise standard: thin doorway pages (1-2 jobs) hurt domain quality signals.
const MIN_JOBS_FOR_INDEX = 3;

function getPageQualityScore(city: CityData, totalJobs: number): number {
  if (totalJobs === 0) return 0; // Redirected before reaching here, but belt-and-suspenders

  // Pages with fewer than MIN_JOBS are thin content → noindex but still render
  if (totalJobs < MIN_JOBS_FOR_INDEX) return 10; // Below the 25-point index threshold

  // Tiered scoring based on content density
  let score = 0;

  // Job count tiers
  if (totalJobs >= 10) score += 60;       // Strong content page
  else if (totalJobs >= 5) score += 50;   // Good content page
  else score += 30;                        // Meets minimum (3-4 jobs)

  // City quality signals
  if (city.healthcareSystems.length > 0) score += 15;  // Has named employers
  if (city.metroArea) score += 10;                       // Metro area = higher demand
  if (city.population >= 25000) score += 15;             // Major city
  else if (city.population >= 10000) score += 5;         // Mid-size city
  if (city.mentalHealthShortage) score += 10;            // behavioral-health HPSA designation

  return score; // Pages with score >= 25 get indexed
}

// ─── Metadata Generator ────────────────────────────────────────────────────────

export async function buildCategoryCityMetadata(
  categoryKey: string,
  citySlug: string,
  page: number,
): Promise<Metadata> {
  const config = ALL_CATEGORY_CONFIGS[categoryKey];
  const city = getCityBySlug(citySlug);
  if (!config || !city) return { title: 'Not Found' };

  // getCityStats falls back to a stale-but-positive cached row on failure, and
  // rethrows when it has none — a DB outage must surface as 5xx, never as a
  // cacheable 308 to the parent category.
  const stats = await getCityStats(config, city);

  // SEO: 308 permanent redirect for 0-job pages (metadata phase)
  // The page component also redirects, but this catches the metadata call first
  if (stats.totalJobs === 0) {
    const { permanentRedirect } = await import('next/navigation');
    permanentRedirect(`/jobs/${config.slug}`);
  }

  const basePath = `/jobs/${config.slug}/city/${citySlug}`;

  const qualityScore = getPageQualityScore(city, stats.totalJobs);
  const isHighQuality = qualityScore >= 25;
  const shouldIndex = isHighQuality && page === 1;

  // Canonical consolidation:
  //   • Thin pages (1-2 jobs, score < 25)         → canonical to parent category
  //     so Google consolidates ranking signals upward.
  //   • High-quality page 1                        → self canonical.
  //   • High-quality page N>1 (paginated view)     → canonical to page 1 of the
  //     SAME city (basePath), NOT the parent. Pointing page-2 to the parent
  //     (the prior bug) caused "Duplicate without canonical" in GSC because
  //     Google expects pagination to canonical to the first page of the same
  //     listing, not jump up two levels.
  const canonicalUrl = isHighQuality
    ? `${brand.baseUrl}${basePath}`
    : `${brand.baseUrl}/jobs/${config.slug}`;

  // Build salary display for OG image (rawAvgSalary is already in thousands, e.g. 130 = $130K)
  const salaryDisplay = stats.rawAvgSalary && stats.rawAvgSalary > 0
    ? `$${stats.rawAvgSalary}K`
    : '';

  // P2 #7: /api/og/city renders this flag as a bare "⚕ Shortage Area" badge,
  // and the description below states the designation in the SERP snippet.
  // Both are gated on shortageIsOnTopic — the OG badge cannot be labelled from
  // here at all, and a labelled snippet is still the donor niche on a
  // dermatology URL.
  const shortageMatchesCategory = shortageIsOnTopic(city, config.slug);

  const ogParams = new URLSearchParams({
    category: config.label,
    city: `${city.name}, ${city.stateCode}`,
    jobs: String(stats.totalJobs),
    ...(salaryDisplay && { salary: salaryDisplay }),
    ...(shortageMatchesCategory && { shortage: 'true' }),
  });

  return {
    title: `${config.label} ${brand.niche.short} Jobs in ${city.name}, ${city.stateCode} (${stats.totalJobs} Open)`,
    // P2 #7: the shortage sentence names the designation's DISCIPLINE *and*
    // only ships on the category that discipline describes. The dataset holds
    // only the behavioral-health HPSA flag, so an unqualified "health
    // professional shortage area" reads as an all-NP shortage claim this board
    // cannot source — and a correctly-labelled one still puts a
    // behavioral-health designation in the SERP snippet of every dermatology,
    // cardiology and aesthetics city page. Gated, not just labelled.
    // The leading space lives INSIDE the conditional so a withheld claim
    // leaves no trailing whitespace on the ~1,485 unflagged cities either.
    description: `Find ${stats.totalJobs} ${config.label.toLowerCase()} ${brand.niche.short} jobs in ${city.name}, ${city.stateCode}. ${config.heroSubtitle}. Population: ${city.population.toLocaleString()}. COL index: ${city.costOfLivingIndex}.${shortageMatchesCategory ? ' Federally designated behavioral-health HPSA.' : ''}`,
    keywords: [
      `${config.label.toLowerCase()} ${brand.niche.short.toLowerCase()} jobs ${city.name}`,
      `${city.name} ${config.label.toLowerCase()} ${brand.niche.descriptor}`,
      `${brand.niche.short.toLowerCase()} jobs ${city.name} ${city.stateCode}`,
    ],
    openGraph: {
      title: `${config.label} ${brand.niche.short} Jobs in ${city.name}, ${city.stateCode}`,
      description: `Browse ${config.label.toLowerCase()} ${brand.niche.short} positions in ${city.name}. ${config.heroSubtitle}.`,
      type: 'website',
      images: [{
        url: `/api/og/city?${ogParams.toString()}`,
        width: 1200,
        height: 630,
        alt: `${config.label} ${brand.niche.short} Jobs in ${city.name}, ${city.stateCode}`,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${config.label} ${brand.niche.short} Jobs in ${city.name}, ${city.stateCode}`,
      images: [`/api/og/city?${ogParams.toString()}`],
    },
    alternates: {
      canonical: canonicalUrl,
    },
    ...(!shouldIndex && {
      robots: { index: false, follow: true },
    }),
  };
}

// ─── Page Component ────────────────────────────────────────────────────────────

interface CategoryCityPageProps {
  categoryKey: string;
  citySlug: string;
  page: number;
}

export default async function CategoryCityPage({ categoryKey, citySlug, page }: CategoryCityPageProps) {
  const config = ALL_CATEGORY_CONFIGS[categoryKey];
  const city = getCityBySlug(citySlug);

  if (!config || !city) {
    const { notFound } = await import('next/navigation');
    notFound();
  }

  const limit = 10;
  const skip = (page - 1) * limit;

  // 1. Instantly fetch pre-calculated stats (single indexed row lookup ~2ms)
  const stats = await getCityStats(config, city!);

  // ═══ SEO GUARD: 308 permanent redirect for 0-job pages ═══
  // Instead of a hard 404 (which wastes crawl budget and loses link equity),
  // 308 redirect to the parent category page so Google consolidates the signal.
  // 308 is the modern equivalent of 301 — tells search engines the move is permanent.
  if (stats.totalJobs === 0) {
    const { permanentRedirect } = await import('next/navigation');
    // Redirect to: /jobs/{category} — the parent enterprise category page
    permanentRedirect(`/jobs/${config.slug}`);
  }

  // ═══ SEO GUARD (S4): hard 404 for thin doorway pages (1-2 jobs) ═══
  // 0 jobs already redirected above. 1-2 jobs render near-identical content
  // across thousands of URLs; meta-robots noindex alone is insufficient because
  // Google still crawls and processes the 200. notFound() removes them from the
  // crawl entirely. Threshold = 3 (shared with the city page, sitemap gate, and
  // seo_threshold_decision.md).
  if (!shouldRenderCategoryCity(stats.totalJobs)) {
    const { notFound: notFoundFn } = await import('next/navigation');
    notFoundFn();
  }

  // 2. Only fetch actual job rows if we know jobs exist
  const jobs = await getCityJobs(config, city!, skip, limit);

  // 404 for paginated pages beyond available results.
  if (page > 1 && jobs.length === 0) {
    const { notFound: notFoundFn } = await import('next/navigation');
    notFoundFn();
  }


  const totalPages = Math.ceil(stats.totalJobs / limit);
  const demand = getMarketDemandScore(city!, stats.totalJobs);
  const basePath = `/jobs/${config.slug}/city/${citySlug}`;

  // #13: employers actually hiring in this city, grouped from live postings.
  // 87.6% of cities carry an empty static `healthcareSystems` list (and the
  // cross-state repair emptied more), so the "Healthcare" block was mostly a
  // bare negative. Returns [] below MIN_CITY_EMPLOYERS so the block is omitted
  // rather than padded — see lib/pseo/city-employers.ts.
  const topEmployers = await getTopCityEmployers(city!.name, city!.state);

  // Practice authority for this state
  let practiceAuthority: StatePracticeInfo | null = null;
  try {
    practiceAuthority = getStatePracticeAuthority(city!.state);
  } catch {
    // State not found, skip
  }

  // GSC Fix (P1.5): gate cross-links by the same threshold the target page
  // renders at. Category×city pages notFound() below MIN_JOBS_FOR_CATEGORY_CITY,
  // so linking combos sitting at 1-2 jobs produces systematic internal links to
  // 404s. Pseo stats are pre-aggregated, so these queries are fast.
  const allOtherCategoryConfigs = Object.values(ALL_CATEGORY_CONFIGS).filter((c) => c.slug !== config.slug);
  const otherCategoryRows = await prisma.pseoStats.findMany({
    where: {
      type: 'category-city',
      locationSlug: citySlug,
      totalJobs: { gte: MIN_JOBS_FOR_CATEGORY_CITY },
      categorySlug: { in: allOtherCategoryConfigs.map(c => c.slug) },
    },
    select: { categorySlug: true },
  });
  const validOtherCategorySlugs = new Set(otherCategoryRows.map(r => r.categorySlug));
  const otherCategories = allOtherCategoryConfigs.filter(c => validOtherCategorySlugs.has(c.slug));

  // Get visual assets from the registry for this category
  const assets = CATEGORY_ASSET_REGISTRY[config.slug];

  // Explore-card hrefs: only append /city/{slug} to hrefs that are real
  // category pages AND clear the ≥3 render gate for this city. Non-category
  // destinations (/salary-guide, /jobs/locations) have no per-city route —
  // blindly appending produced /salary-guide/city/* 404s and middleware 410s
  // on every asset-bearing page. Thin category combos fall back to the
  // category landing page instead of a guaranteed 404.
  const categorySlugSet = new Set(Object.values(ALL_CATEGORY_CONFIGS).map(c => c.slug));
  const exploreCardLinks = (assets?.exploreCards ?? []).map(card => {
    if (card.href.includes('/city/')) return { ...card, resolvedHref: card.href };
    const cardSlug = card.href.startsWith('/jobs/') ? card.href.slice('/jobs/'.length) : null;
    if (cardSlug === null || !categorySlugSet.has(cardSlug)) {
      return { ...card, resolvedHref: card.href };
    }
    return {
      ...card,
      resolvedHref: validOtherCategorySlugs.has(cardSlug)
        ? `${card.href}/city/${citySlug}`
        : card.href,
    };
  });

  // Nearby cities — gate by THIS category clearing the render threshold in each
  // candidate city (the target pages 404 below MIN_JOBS_FOR_CATEGORY_CITY).
  const candidateNearby = city!.nearbyCities
    .map((slug) => getCityBySlug(slug))
    .filter((c): c is CityData => c !== undefined)
    .slice(0, 12); // overshoot, then filter to 6
  const nearbyRows = candidateNearby.length > 0
    ? await prisma.pseoStats.findMany({
        where: {
          type: 'category-city',
          categorySlug: config.slug,
          locationSlug: { in: candidateNearby.map(c => c.slug) },
          totalJobs: { gte: MIN_JOBS_FOR_CATEGORY_CITY },
        },
        select: { locationSlug: true },
      })
    : [];
  const validNearbySlugs = new Set(nearbyRows.map(r => r.locationSlug));
  const nearbyCities = candidateNearby.filter(c => validNearbySlugs.has(c.slug)).slice(0, 6);

  // P1.5: only render the "{config.label} Jobs in {state}" resource link if a
  // setting-state page actually exists for this taxonomy + state (some
  // taxonomies are city-only and never have a state page; others may have a
  // state page but with 0 jobs right now).
  const cityStateSlug = stateToSlug(city!.state);
  const stateLinkRow = await prisma.pseoStats.findUnique({
    where: {
      type_categorySlug_locationSlug: {
        type: 'setting-state',
        categorySlug: config.slug,
        locationSlug: cityStateSlug,
      },
    },
    select: { totalJobs: true },
  });
  const showStateLink = (stateLinkRow?.totalJobs ?? 0) >= 1;

  // P3.4: per-(taxonomy, city) narrative. DB override wins; otherwise the
  // deterministic builder produces unique-per-(city,taxonomy,jobcount) text.
  // This is the primary defense against GSC "Crawled — currently not indexed"
  // because every cell now has substantively different copy from its peers.
  const dbCatCityOverride = await prisma.categoryCitySnippet.findUnique({
    where: {
      categorySlug_citySlug: {
        categorySlug: config.slug,
        citySlug,
      },
    },
    select: { body: true, approvedAt: true },
  });
  const taxonomyCityNarrative = dbCatCityOverride && dbCatCityOverride.approvedAt
    ? dbCatCityOverride.body
    : buildTaxonomyCityNarrative(buildCityFacts(city!), config.slug, stats.totalJobs);

  // P2 #8: correct certifying body for THIS category (CRNA → NBCRNA, CNM →
  // AMCB, …) — feeds the qualification FAQ answer and its FAQPage schema.
  const credentials = getCategoryCredentials(config.slug);

  // P2 #7 — two gates, one rule: the donor board's behavioral-health HPSA
  // column may only surface on the category whose specialty it describes.
  //   • shortageMatchesCategory gates the AFFIRMATIVE claim in the careers FAQ
  //     answer (which also feeds the FAQPage schema). Same predicate the
  //     metadata builder uses, so the page and its SERP snippet can never
  //     disagree about whether the designation is on topic.
  //   • categoryOwnsShortage gates the Community Profile tile, which reports
  //     both polarities and so is category-scoped rather than flag-scoped.
  const shortageMatchesCategory = shortageIsOnTopic(city!, config.slug);
  const categoryOwnsShortage = categoryOwnsShortageData(config.slug);

  /* ═══ Design Tokens — matched to category pages ═══ */
  const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
  };

  // ═══ FAQ — SINGLE source array (audit B52) ═══
  // This ONE array feeds BOTH the FAQPage JSON-LD and the visible
  // accordion below. The template previously maintained two hand-copied
  // versions that had drifted apart (different practice-authority
  // wording, truncated health-system lists, a missing salary-range
  // sentence) — Google treats schema answers that don't match visible
  // content as spammy structured data. Never fork this array again.
  const categoryCityFaqs = [
    {
      q: `How many ${config.label.toLowerCase()} ${brand.niche.short} jobs are available in ${city!.name}, ${city!.stateCode}?`,
      a: `There ${stats.totalJobs === 1 ? 'is' : 'are'} currently ${stats.totalJobs} ${config.label.toLowerCase()} ${brand.niche.short} ${stats.totalJobs === 1 ? 'position' : 'positions'} available in ${city!.name}, ${city!.stateCode}. New positions are posted regularly as demand for ${brand.niche.descriptor}s continues to grow.`,
    },
    {
      q: `What is the average ${brand.niche.short} salary in ${city!.name}?`,
      a: stats.rawAvgSalary > 0
        ? `The average ${config.label.toLowerCase()} ${brand.niche.short} salary in ${city!.name} is approximately $${stats.rawAvgSalary}K per year. Adjusted for the local cost of living (index: ${city!.costOfLivingIndex}), this equates to about $${stats.colAdjustedSalary}K in purchasing power. The typical range for ${config.label.toLowerCase()} positions is ${config.salaryRange}.`
        : `${config.label} ${brand.niche.short} positions in ${city!.name} typically pay ${config.salaryRange}. Actual compensation depends on experience, employer type, and whether the role includes benefits. ${city!.name}'s cost of living index is ${city!.costOfLivingIndex} (national average = 100).`,
    },
    {
      q: `Does ${city!.state} allow ${brand.niche.short}s full practice authority?`,
      // FIX: this branched on `String(authority).includes('Full')`, but
      // StatePracticeInfo.authority is the lowercase union 'full' | 'reduced'
      // | 'restricted' — so BOTH tests were permanently false and every
      // full-practice state was told its NPs "must practice under physician
      // supervision", in the visible answer AND the FAQPage schema. Switch on
      // the union so the compiler catches a new member.
      a: practiceAuthority
        ? `${city!.state} has ${getAuthorityLabel(practiceAuthority.authority).toLowerCase()} for ${brand.niche.descriptor}s. ${
            practiceAuthority.authority === 'full'
              ? `${brand.niche.short}s can evaluate, diagnose, and prescribe without physician oversight.`
              : practiceAuthority.authority === 'reduced'
                ? `${brand.niche.short}s require a collaborative agreement with a physician, but can diagnose and prescribe under that arrangement.`
                : `${brand.niche.short}s practice under physician supervision for prescribing and some clinical decisions.`
          } Source: ${STAT_SOURCES.fullPracticeStates.source}. Verify current rules with the ${city!.state} Board of Nursing before accepting a role.`
        : `Contact the ${city!.state} Board of Nursing for current practice authority information.`,
    },
    {
      q: `Is ${city!.name} a good place for ${brand.niche.short} careers?`,
      // P2 #7: the dataset's only shortage column is the donor board's
      // BEHAVIORAL-HEALTH HPSA flag — there is no primary-care HPSA field —
      // so an unqualified "designated Health Professional Shortage Area,
      // meaning high demand … for NPs" was an all-NP shortage claim this
      // board cannot source. The designation is now named with its discipline
      // and only carried on the page whose specialty it actually describes;
      // every other category gets the market facts without it.
      a: `${city!.name} ${
        shortageMatchesCategory
          ? 'carries a federal HRSA behavioral-health Health Professional Shortage Area (HPSA) designation, which is what makes NHSC Loan Repayment available to behavioral-health clinicians at approved sites in the area.'
          : `has growing demand for ${brand.niche.descriptor}s.`
      } With a population of ${city!.population.toLocaleString('en-US')}${city!.metroArea ? ` and part of the ${city!.metroArea} metro area` : ''}, ${city!.name} offers ${city!.healthcareSystems.length > 0 ? `access to major health systems including ${city!.healthcareSystems.slice(0, 3).join(', ')}` : 'a variety of practice settings'}.`,
    },
    {
      // P2 #8: certifying body comes from the per-category credential facts —
      // "ANCC or AANP" was wrong for CRNA (NBCRNA), CNM (AMCB), CNS
      // (ANCC/AACN), PNP (PNCB), NNP/WHNP (NCC) and acute care (ANCC/AACN).
      q: `What qualifications do I need for ${credentials.standaloneLabel ? config.label.toLowerCase() : `${config.label.toLowerCase()} ${brand.niche.short}`} jobs in ${city!.name}?`,
      a: `To work as ${credentials.article} ${credentials.role} in ${city!.name}, ${city!.stateCode}, you need: (1) ${credentials.degree}, (2) ${credentials.certification}, (3) an active RN and APRN license in ${city!.state}, and (4) ${credentials.dea}. ${config.label === 'Entry-Level' ? 'Many entry-level positions accept new graduates and provide structured mentorship.' : config.label === 'Senior' ? 'Senior positions typically require 7+ years of experience and may require subspecialty certifications.' : `${config.label} positions may have additional requirements specific to the employer and setting.`}`,
    },
  ];

  // P2 #19: ONE breadcrumb array drives the visible <nav> and the
  // BreadcrumbList JSON-LD (Breadcrumbs renders both) — hrefs are relative
  // because the component prefixes the canonical origin itself.
  // State crumb: city-only categories have no /jobs/{cat}/{state} route
  // (middleware 410s that shape), so their state crumb points at the
  // /jobs/state/{slug} hub instead — never a 410 URL in schema or in the DOM.
  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Jobs', href: '/jobs' },
    { label: config.label, href: `/jobs/${config.slug}` },
    {
      label: city!.state,
      href: STATE_ELIGIBLE_SET.has(config.slug)
        ? `/jobs/${config.slug}/${stateToSlug(city!.state)}`
        : `/jobs/state/${stateToSlug(city!.state)}`,
    },
    { label: `${city!.name}, ${city!.stateCode}` },
  ];

  return (
    <div style={{ backgroundColor: '#FDFBF7' }}>
      {/* ═══ SCHEMAS ═══ */}
      {/* D9: ItemList schema.
          B29: job titles are aggregator-sourced — escape < and > so a literal
          "</script>" in a title can never terminate this element early. */}
      {jobs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: `${config.label} ${brand.niche.short} Jobs in ${city!.name}, ${city!.stateCode}`,
              numberOfItems: stats.totalJobs,
              itemListElement: jobs.slice(0, 10).map((job: Job, idx: number) => ({
                '@type': 'ListItem',
                position: idx + 1,
                name: job.title,
                url: `${brand.baseUrl}/jobs/${job.slug || job.id}`,
              })),
            })
              .replace(/</g, '\\u003c')
              .replace(/>/g, '\\u003e'),
          }}
        />
      )}
      {/* D10: Place schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Place',
            name: `${city!.name}, ${city!.stateCode}`,
            address: {
              '@type': 'PostalAddress',
              addressLocality: city!.name,
              addressRegion: city!.stateCode,
              addressCountry: 'US',
            },
          }),
        }}
      />

      {/* ═══ Analytics: pSEO page view tracking ═══ */}
      <PseoPageViewTracker
        pageType="category_city"
        category={config.slug}
        city={city!.name}
        state={city!.stateCode}
        jobCount={stats.totalJobs}
      />

      {/* ═══ P2 #19: visible, linked breadcrumb trail ═══
          Sits in the hero's cream band so it reads as part of the header.
          CategoryHero's own `breadcrumbs` prop is deliberately empty: it
          renders unlinked <span>s whose labels ('Careers …') did not match
          the BreadcrumbList schema, and two Breadcrumb navs on one page is
          both a duplicate landmark and a duplicate-schema signal. */}
      <div className="pseo-crumb-band">
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      {/* ═══ D2: HERO — CategoryHero with category's watercolor ═══ */}
      <CategoryHero
        bgColor={assets?.bgColor || '#BE185D'}
        heroImage={assets?.heroImage || `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/categories/hero_wc_remote.webp`}
        heroAlt={`${config.label} ${brand.niche.short} working in ${city!.name}, ${city!.stateCode}`}
        badgeText={formatStatsBadge(stats.totalJobs, stats.statsAsOf)}
        breadcrumbs={[]}
        headlineLine1={config.label}
        headlineLine2={brand.niche.short}
        headlineSub={`jobs in ${city!.name}, ${city!.stateCode}.`}
        stats={[
          { value: `${stats.totalJobs}`, label: 'positions' },
          // P3 #13: this used to be `salaryRange.split('–')[0]` — an EN DASH,
          // while every salaryRange literal is written with an ASCII hyphen.
          // The split never matched, so the fallback rendered the whole range
          // ("$110K-150K") under an "avg salary" label. Splitting correctly
          // would be worse: the low end of an estimated band is not an
          // average. Show the band, and label it as a band.
          stats.rawAvgSalary > 0
            ? { value: `$${stats.rawAvgSalary}k`, label: 'avg salary' }
            : { value: config.salaryRange, label: 'typical range' },
          { value: demand.label, label: 'demand' },
        ]}
        description={`${config.label} ${brand.niche.short} positions in ${city!.name}. ${config.heroSubtitle}.`}
        ctaLabel={`Browse ${config.label} Jobs`}
        ctaHref={`/jobs/${config.slug}`}
        secondaryCtaLabel="Set Alert"
        secondaryCtaHref="/job-alerts"
      />

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-7xl mx-auto">

          {/* Job Listings */}
          <div className="grid lg:grid-cols-4 gap-8">
            <div className="lg:col-span-3">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>
                  {config.label} Positions in {city!.name} ({stats.totalJobs})
                </h2>
                <Link
                  href={`/jobs/${config.slug}`}
                  style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textDecoration: 'none' }}
                >
                  View All Jobs →
                </Link>
              </div>

              {jobs.length === 0 ? (
                <div className="text-center py-12 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                  <MapPin className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
                  <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                    No {config.label.toLowerCase()} positions in {city!.name} right now
                  </h3>
                  <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
                    Try browsing nearby cities or statewide listings:
                  </p>
                  {nearbyCities.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 mb-6">
                      {nearbyCities.slice(0, 4).map((nc) => (
                        <Link key={nc.slug} href={`/jobs/${config.slug}/city/${nc.slug}`}
                          className="px-3 py-1.5 text-sm rounded-lg transition-colors hover:opacity-90"
                          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--color-primary)' }}>
                          {nc.name}, {nc.stateCode}
                        </Link>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap justify-center gap-3">
                    {/* City-only categories have no /jobs/{cat}/{state} route
                        (middleware 410) — send those to the state hub. */}
                    {STATE_ELIGIBLE_SET.has(config.slug) ? (
                      <Link href={`/jobs/${config.slug}/${stateToSlug(city!.state)}`} className="inline-block px-6 py-3 text-white rounded-lg font-medium hover:opacity-90" style={{ backgroundColor: 'var(--color-primary)' }}>
                        {config.label} Jobs in {city!.state}
                      </Link>
                    ) : (
                      <Link href={`/jobs/state/${stateToSlug(city!.state)}`} className="inline-block px-6 py-3 text-white rounded-lg font-medium hover:opacity-90" style={{ backgroundColor: 'var(--color-primary)' }}>
                        All {city!.state} Jobs
                      </Link>
                    )}
                    <Link href={`/jobs/city/${citySlug}`} className="inline-block px-6 py-3 rounded-lg font-medium" style={{ color: 'var(--color-primary)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                      All {city!.name} Jobs
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                    {jobs.map((job: Job) => (
                      <JobCard key={job.id} job={job} />
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-8 flex items-center justify-center gap-4">
                      {page > 1 ? (
                        <Link href={`${basePath}?page=${page - 1}`} className="px-4 py-2 text-sm font-medium rounded-lg" style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                          ← Previous
                        </Link>
                      ) : (
                        <span className="px-4 py-2 text-sm rounded-lg cursor-not-allowed" style={{ color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-tertiary)' }}>← Previous</span>
                      )}
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Page {page} of {totalPages}</span>
                      {page < totalPages ? (
                        <Link href={`${basePath}?page=${page + 1}`} className="px-4 py-2 text-sm font-medium rounded-lg" style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                          Next →
                        </Link>
                      ) : (
                        <span className="px-4 py-2 text-sm rounded-lg cursor-not-allowed" style={{ color: 'var(--text-tertiary)', backgroundColor: 'var(--bg-tertiary)' }}>Next →</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-1">
              {/* Job Alert CTA */}
              <div className="pseo-bento-card" style={{ ...clayCard, padding: '0', overflow: 'hidden', marginBottom: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
                <div style={{ padding: '24px' }}>
                  <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                  <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>
                    {config.label} Alerts
                  </h3>
                  <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>
                    New {config.label.toLowerCase()} {brand.niche.short} positions in {city!.name} — delivered daily.
                  </p>
                  <Link href="/job-alerts" className="pseo-cta-primary" style={{
                    display: 'block', width: '100%', textAlign: 'center',
                    padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                    background: '#BE185D', color: '#fff', textDecoration: 'none',
                    boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
                  }}>
                    Create Alert
                  </Link>
                </div>
              </div>

              {/* Tips */}
              <div className="pseo-bento-card" style={{ ...clayCard, padding: '24px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Lightbulb size={20} style={{ color: '#BE185D' }} />
                  <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>{config.label} Tips</h3>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {config.tips.map((tip, i) => (
                    <li key={i} style={{ display: 'flex', gap: '8px', padding: '6px 0', borderBottom: i < config.tips.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none', fontSize: '13px', color: '#5A4A42', lineHeight: 1.5 }}>
                      <span style={{ color: '#BE185D', fontWeight: 700 }}>•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Benefits */}
              <div className="pseo-bento-card" style={{ ...clayCard, padding: '24px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#1A2E35', marginBottom: '16px' }}>Why {config.label}?</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {config.benefits.map((b, i) => (
                    <div key={i}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: '#1A2E35' }}>{b.title}</div>
                      <p style={{ fontSize: '12px', marginTop: '4px', color: '#5A4A42', lineHeight: 1.5 }}>{b.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ═══ BENTO GRID — "Why Choose [Category]" ═══ */}
          {assets && (
            <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '48px 20px 40px' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                {assets.bentoSectionLabel}
              </p>
              <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>
                {config.label} Careers in {city!.name}
              </h2>
              <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '480px', margin: '0 auto 48px', lineHeight: 1.6 }}>
                {config.heroSubtitle}
              </p>

              <div className="pseo-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px' }}>
                {/* ROW 1: Hero card (8col) + Side card (4col) */}
                <div className="pseo-bento-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center' }}>
                  <div style={{ padding: '32px 28px' }}>
                    <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>
                      {`${config.label} in ${city!.name}`}
                    </h3>
                    <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                      {config.heroSubtitle}. {config.tips[0] || ''}
                    </p>
                  </div>
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', padding: '16px' }}>
                    <Image src={assets.bentoImages[0]} alt={`${config.label} ${brand.niche.short}`} width={280} height={200} sizes="(max-width: 768px) 90vw, 280px" style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
                  </div>
                </div>

                <div className="pseo-bento-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ flex: '0 0 auto', background: 'linear-gradient(145deg, #FFFBEB, #FEF3C7)', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Image src={assets.bentoImages[1]} alt={`${config.label} growth`} width={200} height={140} sizes="(max-width: 768px) 90vw, 200px" style={{ width: '100%', maxWidth: '200px', height: 'auto', borderRadius: '10px' }} />
                  </div>
                  <div style={{ padding: '24px 22px', flex: 1 }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>
                      Practice Authority
                    </h3>
                    <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                      {practiceAuthority ? `${city!.state} has ${practiceAuthority.authority} practice authority for ${brand.niche.short}s.` : config.tips[1] || `Advance your ${config.label.toLowerCase()} career in ${city!.name}.`}
                    </p>
                  </div>
                </div>

                {/* ROW 2: Icon cards — dynamic count based on benefits */}
                {config.benefits.map((benefit, i) => (
                  <div key={`icon-${i}`} className="pseo-bento-card" style={{ ...clayCard, gridColumn: `span ${Math.floor(12 / config.benefits.length)}`, padding: '24px 18px', textAlign: 'center' }}>
                    {assets.bentoIcons[i] && <Image src={assets.bentoIcons[i]} alt="" width={48} height={48} sizes="48px" style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />}
                    <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>
                      {benefit.title}
                    </h3>
                    <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>
                      {benefit.description}
                    </p>
                  </div>
                ))}

                {/* ROW 3: Salary card (8col) + Alert CTA (4col) */}
                {assets.bentoImages[2] && (
                  <div className="pseo-bento-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center' }}>
                    <div style={{ padding: '32px 28px' }}>
                      <TrendingUp size={28} style={{ color: '#BE185D', marginBottom: '16px' }} />
                      <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>Salary & Compensation</h3>
                      <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                        {config.label} {brand.niche.short}s in {city!.name} earn {stats.rawAvgSalary > 0 ? `$${stats.rawAvgSalary}k` : config.salaryRange} annually.
                      </p>
                    </div>
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FFF7ED, #FFEDD5)', padding: '16px' }}>
                      <Image src={assets.bentoImages[2]} alt="Salary growth" width={280} height={200} sizes="(max-width: 768px) 90vw, 280px" style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
                    </div>
                  </div>
                )}

                <div className="pseo-bento-card" style={{ ...clayCard, gridColumn: 'span 4', padding: '28px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
                  <Bell size={32} style={{ color: '#BE185D', marginBottom: '14px' }} />
                  <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#831843', margin: '0 0 6px' }}>{config.label} Alerts</h3>
                  <p style={{ fontSize: '13px', color: '#BE185D', margin: '0 0 16px', lineHeight: 1.6, fontWeight: 500 }}>
                    New {config.label.toLowerCase()} listings in {city!.name} — delivered daily.
                  </p>
                  <Link href="/job-alerts" className="pseo-cta-primary" style={{
                    padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                    background: '#BE185D', color: '#fff', textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'fit-content',
                    boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
                  }}>
                    Create Alert <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ COMMUNITY · MARKET · HEALTHCARE — Full-width warm section ═══ */}
      <section style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FDFBF7 100%)', padding: '40px 0', marginTop: '8px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 20px' }}>
          <p className="font-lora" style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '6px' }}>Local Insights</p>
          <h2 className="font-lora" style={{ fontSize: '22px', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '24px' }}>{city!.name} at a Glance</h2>
          {/* `auto-fit, minmax(260px, 1fr)` collapses to a single column on
              375px viewports while preserving the 3-up bento on desktop. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
            {/* Community Profile */}
            <div className="pseo-bento-card" style={{ ...clayCard, padding: '24px' }}>
              <h2 className="font-lora" style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <MapPin size={18} style={{ color: '#BE185D' }} /> {city!.name}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#7A6A62' }}>Population</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35' }}>{city!.population.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#7A6A62' }}>Cost of Living</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: city!.costOfLivingIndex > 110 ? '#ef4444' : city!.costOfLivingIndex > 100 ? '#f59e0b' : '#34D399' }}>
                    {city!.costOfLivingIndex}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#7A6A62' }}>Median Income</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35' }}>${(city!.medianIncome / 1000).toFixed(0)}k</div>
                </div>
                {/* P2 #7: labelled with the designation's DISCIPLINE *and*
                    gated to the category that discipline describes. The
                    dataset carries only the donor board's behavioral-health
                    HPSA column, so a bare "Shortage: Yes" read as an all-NP
                    shortage claim — but the label alone still puts a
                    behavioral-health stat in the "… at a Glance" card of every
                    dermatology, cardiology and aesthetics city page. Gated on
                    the CATEGORY rather than on the flag, because "Not
                    designated" is genuinely useful to a behavioral-health
                    seeker weighing NHSC eligibility; it is only the 41 other
                    categories that have no business reading either polarity.
                    Neutral colouring — a designation is context for
                    loan-repayment eligibility, not a verdict. */}
                {categoryOwnsShortage && (
                  <div>
                    <div style={{ fontSize: '11px', color: '#7A6A62' }}>Behavioral-Health HPSA</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35' }}>
                      {city!.mentalHealthShortage ? 'Designated' : 'Not designated'}
                    </div>
                  </div>
                )}
              </div>
              {city!.metroArea && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.05)', fontSize: '12px', color: '#7A6A62' }}>
                  Metro: <strong style={{ color: '#1A2E35' }}>{city!.metroArea}</strong>
                </div>
              )}
            </div>

            {/* Market Insights */}
            <div className="pseo-bento-card" style={{ ...clayCard, padding: '24px' }}>
              <h2 className="font-lora" style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <TrendingUp size={18} style={{ color: '#BE185D' }} /> Market
              </h2>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                  <span style={{ color: '#5A4A42' }}>Demand</span>
                  <span style={{ fontWeight: 700, color: demand.color }}>{demand.label} ({demand.score}/100)</span>
                </div>
                <div style={{ height: '8px', borderRadius: '8px', background: 'rgba(0,0,0,0.05)' }}>
                  <div style={{ height: '8px', borderRadius: '8px', width: `${demand.score}%`, backgroundColor: demand.color, transition: 'width 0.6s ease' }} />
                </div>
              </div>
              {stats.rawAvgSalary > 0 && (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', color: '#7A6A62' }}>COL-Adjusted Salary</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#1A2E35' }}>
                    ${stats.colAdjustedSalary}k
                    <span style={{ fontSize: '11px', fontWeight: 400, marginLeft: '6px', color: '#7A6A62' }}>(${stats.rawAvgSalary}k nom.)</span>
                  </div>
                </div>
              )}
              {practiceAuthority && (
                <div style={{ paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                    <Shield size={14} style={{ color: '#BE185D' }} />
                    {/* getAuthorityLabel, not the raw union member — this
                        rendered the bare string "full" / "restricted". */}
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#1A2E35' }}>{getAuthorityLabel(practiceAuthority.authority)}</span>
                  </div>
                  {/* Rendered only once the license-guide blog series is
                      published — this template links from ~100K+ pages, so
                      an unpublished series would be internal 404s at scale.
                      Flip LICENSE_GUIDE_SERIES_PUBLISHED in
                      config/niche/content-map.ts when all 51 posts ship. */}
                  {LICENSE_GUIDE_SERIES_PUBLISHED && (
                    <Link href={`/blog/${licenseGuideSlug(stateToSlug(city!.state))}`} style={{ fontSize: '11px', color: '#BE185D', textDecoration: 'none' }}>
                      {city!.state} Licensure Guide →
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Top employers hiring now (#13).
                Live employer names + open-role counts from the job table when
                the city clears the 2-employer floor; the static healthcare
                system list only as a fallback; and the whole card omitted when
                we have neither. Nothing here is ever padded to fill space. */}
            {(topEmployers.length > 0 || city!.healthcareSystems.length > 0) && (
              <div className="pseo-bento-card" style={{ ...clayCard, padding: '24px' }}>
                <h2 className="font-lora" style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <Building2 size={18} style={{ color: '#BE185D' }} />
                  {topEmployers.length > 0 ? 'Top Employers Hiring Now' : 'Healthcare'}
                </h2>
                {topEmployers.length > 0 ? (
                  <>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {topEmployers.map((emp, i) => (
                        <li key={emp.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '6px 0', borderBottom: i < topEmployers.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                          <span style={{ fontSize: '13px', color: '#5A4A42' }}>{emp.name}</span>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', whiteSpace: 'nowrap' }}>
                            {emp.openRoles} {emp.openRoles === 1 ? 'role' : 'roles'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p style={{ fontSize: '11px', color: '#7A6A62', margin: '10px 0 0', lineHeight: 1.5 }}>
                      Employers with open {brand.niche.short} roles in {city!.name}, {city!.stateCode} right now — counted across every specialty on this board.
                    </p>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {city!.healthcareSystems.map((system, i) => (
                      <span key={i} style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '8px', background: 'rgba(190,24,93,0.08)', color: '#1A2E35', fontWeight: 500 }}>
                        {system}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* D6: Nearby Cities */}
      {nearbyCities.length > 0 && (
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 20px' }}>
          <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', marginBottom: '16px', textAlign: 'center' }}>
            {config.label} {brand.niche.short} Jobs in Nearby Cities
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
            {nearbyCities.map((nc) => (
              <Link key={nc.slug} href={`/jobs/${config.slug}/city/${nc.slug}`}
                className="pseo-bento-card" style={{ ...clayCard, display: 'block', padding: '14px', textAlign: 'center', textDecoration: 'none' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A2E35' }}>{nc.name}</div>
                <div style={{ fontSize: '11px', marginTop: '4px', color: '#7A6A62' }}>{nc.stateCode} · Pop {Math.round(nc.population / 1000)}K</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* D6 + D8: Explore More — Warm bg with clay icon cards */}
      <div style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFF3E8 50%, #FFF8F0 100%)' }}>
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Keep Exploring
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>
            Other {brand.niche.short} Job Types in {city!.name}
          </h2>
          <div className="pseo-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            {exploreCardLinks.length > 0 ? (
              exploreCardLinks.map(c => (
                <Link key={c.href} href={c.resolvedHref} className="pseo-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                  <Image src={c.icon} alt="" width={48} height={48} sizes="48px" style={{ width: '48px', height: '48px', objectFit: 'contain', margin: '0 auto 12px', display: 'block' }} />
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{c.label}</span>
                  <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{c.sub}</span>
                </Link>
              ))
            ) : (
              otherCategories.slice(0, 6).map((cat) => (
                <Link key={cat.slug} href={`/jobs/${cat.slug}/city/${citySlug}`}
                  className="pseo-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{cat.label}</span>
                  <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>in {city!.name}</span>
                </Link>
              ))
            )}
          </div>

          {/* Resource Links */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginTop: '32px' }}>
            <Link href={`/salary-guide/${stateToSlug(city!.state)}`} className="pseo-bento-card" style={{ ...clayCard, padding: '20px', textDecoration: 'none' }}>
              <h3 className="font-lora" style={{ fontSize: '15px', fontWeight: 700, color: '#BE185D', marginBottom: '4px' }}>
                <DollarSign size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> {city!.state} Salary Guide
              </h3>
              <p style={{ fontSize: '12px', color: '#5A4A42', margin: 0 }}>Salary data by setting and experience.</p>
            </Link>
            {showStateLink && (
              <Link href={`/jobs/${config.slug}/${stateToSlug(city!.state)}`} className="pseo-bento-card" style={{ ...clayCard, padding: '20px', textDecoration: 'none' }}>
                <h3 className="font-lora" style={{ fontSize: '15px', fontWeight: 700, color: '#BE185D', marginBottom: '4px' }}>
                  <MapPin size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> {config.label} Jobs in {city!.state}
                </h3>
                <p style={{ fontSize: '12px', color: '#5A4A42', margin: 0 }}>Browse all {config.label.toLowerCase()} positions statewide.</p>
              </Link>
            )}
            <Link href={`/jobs/${config.slug}`} className="pseo-bento-card" style={{ ...clayCard, padding: '20px', textDecoration: 'none' }}>
              <h3 className="font-lora" style={{ fontSize: '15px', fontWeight: 700, color: '#BE185D', marginBottom: '4px' }}>
                <Building2 size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> All {config.label} Jobs
              </h3>
              <p style={{ fontSize: '12px', color: '#5A4A42', margin: 0 }}>Nationwide {config.label.toLowerCase()} positions.</p>
            </Link>
          </div>
        </section>
      </div>

      {/* GEO + FAQ — in its own container wrapper */}
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          {/* ── P3.4: per-(taxonomy, city) market context ─────────────────────── */}
          {/* Replaces the prior templated "Quick Facts" block. The narrative is
              substantively unique per (city, taxonomy, totalJobs) tuple — the
              fix Google's quality model actually rewards (E-E-A-T-like depth,
              not template substitution). data-speakable preserved for AEO. */}
          <section
            className="pseo-bento-card"
            style={{ ...clayCard, padding: '24px', marginTop: '0' }}
            id="answer-summary"
            data-speakable="true"
          >
            <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', marginBottom: '12px' }}>
              {config.label} {brand.niche.short} Market in {city!.name}, {city!.stateCode}
            </h2>
            <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#5A4A42', margin: 0 }}>
              {taxonomyCityNarrative}
            </p>
            {/* P2 #7: the HPSA line names the designation's discipline — this
                board holds no primary-care HPSA data (see city-data/types.ts). */}
            <p style={{ fontSize: '11px', marginTop: '8px', color: '#A09080' }}>
              Sources: U.S. Census Bureau, Bureau of Labor Statistics, HRSA behavioral-health HPSA designations, {STAT_SOURCES.fullPracticeStates.source}. Job counts and salary averages are computed from live listings on this board.
            </p>
          </section>

          {/* ── AEO: Frequently Asked Questions with Schema ───────────────────
              Fed by categoryCityFaqs (hoisted above `return`) — the SAME
              array renders the visible accordion section below (B52). */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: categoryCityFaqs.map(faq => ({
                  '@type': 'Question',
                  name: faq.q,
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: faq.a,
                  },
                })),
              }),
            }}
          />
          {/* Speakable Schema — marks content sections for voice/AI consumption */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'WebPage',
                name: `${config.label} ${brand.niche.short} Jobs in ${city!.name}, ${city!.stateCode}`,
                speakable: {
                  '@type': 'SpeakableSpecification',
                  cssSelector: ['#answer-summary', '.faq-answer'],
                },
                url: `${brand.baseUrl}${basePath}`,
              }),
            }}
          />
        </div>
      </div>

      {/* FAQ Accordion — Warm bg section matching CategoryFAQ */}
      <div style={{ background: '#FDFBF7' }}>
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '56px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
            Common Questions
          </p>
          <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>
            {config.label} {brand.niche.short} Jobs in {city!.name} — FAQ
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Same categoryCityFaqs array as the FAQPage JSON-LD above —
                do NOT fork a second copy here (B52). */}
            {categoryCityFaqs.map((faq, i) => (
                <details key={i} className="pseo-faq-item" style={{
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  border: '1px solid rgba(255,255,255,0.5)',
                  boxShadow: '4px 4px 12px rgba(0,0,0,0.04), -2px -2px 8px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
                  overflow: 'hidden',
                }} {...(i === 0 ? { open: true } : {})}>
                  <summary style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '20px 24px', cursor: 'pointer', listStyle: 'none',
                    fontSize: '15px', fontWeight: 600, color: '#1A2E35', lineHeight: 1.4,
                  }}>
                    {faq.q}
                  </summary>
                  <div style={{ padding: '0 24px 20px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                    <p className="faq-answer" style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: '16px 0 0' }}>{faq.a}</p>
                  </div>
                </details>
            ))}
          </div>
        </section>
      </div>

      {/* D11: Responsive + Hover CSS */}
      <style>{`
        /* Breadcrumb band — horizontal padding tracks CategoryHero's own
           (48px 56px 0, dropping to 32px 24px 0 under 900px) so the trail
           lines up with the H1 below it. */
        .pseo-crumb-band { background: #faf6ef; padding: 24px 56px 0; }
        .pseo-crumb-band nav { margin-bottom: 0; }
        @media (max-width: 900px) {
          .pseo-crumb-band { padding: 16px 24px 0; }
        }
        .pseo-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
        .pseo-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
        .pseo-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .pseo-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        .pseo-faq-item summary { list-style: none; }
        .pseo-faq-item summary::-webkit-details-marker { display: none; }
        .pseo-faq-item summary::after {
          content: '';
          width: 28px; height: 28px; border-radius: 8px;
          background: #FDF2F8;
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230D9488' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: center;
          transition: background 0.2s ease, transform 0.2s ease;
        }
        .pseo-faq-item[open] summary::after {
          background-color: #BE185D;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='18 15 12 9 6 15'%3E%3C/polyline%3E%3C/svg%3E");
          transform: none;
        }
        .pseo-faq-item { transition: box-shadow 0.3s ease; }
        .pseo-faq-item[open] { box-shadow: 6px 6px 20px rgba(0,0,0,0.08), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
        /* .pseo-explore-grid uses auto-fit minmax(220px, 1fr) inline so it
           collapses on its own at narrow widths -- no media override needed. */
        .pseo-bento-grid > div { min-width: 0; }
        @media (max-width: 768px) {
          .pseo-bento-grid { grid-template-columns: 1fr !important; }
          .pseo-bento-grid > div { grid-column: span 1 !important; grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

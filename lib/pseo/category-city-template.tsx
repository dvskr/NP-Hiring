/**
 * Category x City pSEO template factory
 *
 * One shared server component renders /jobs/{category}/city/{slug} for every
 * category (setting, job type, specialty, APRN role, experience level,
 * employer type, population) in every dataset city.
 *
 * Thin-content program (PLAN C.4 item 6, thin-spec 2 section 4): every
 * data-backed section reads lib/pseo/listing-facts.ts through the shared
 * clay sections in components/seo/pseo/* and the sentence builders in
 * lib/pseo/listing-narrative.ts, and renders only when its facts pass the
 * builder's own floor:
 *   CC-K1 employers for this category (EmployerRoster), the all-specialty
 *         city pool as the fallback with its disclaimer, else nothing;
 *   CC-K2 listing snapshot (RoleSetup skips the page's own axis; the
 *         freshness sentence leads the bento);
 *   CC-K3 posted pay through PostedPay only (gated median or the cited BLS
 *         sentence; never a mean, never a hand-typed band);
 *   CC-K4 roles across the state from fresh PseoStats rows at 3 or more;
 *   CC-K5 other categories in this city as a live list with counts;
 *   CC-K6 practicing as a {role} in {State} (PracticeCard) with the
 *         certification clause;
 *   CC-K7 per-axis editorial (lib/pseo/category-axis-guide.ts);
 *   CC-K8 one FAQ array feeds the accordion and the FAQPage JSON-LD;
 *   CC-K9 labelNoun and labelSentence titles, H1 and hero stats.
 * Robots read shouldIndexLocalListingPage over the page count and the
 * cron's stored distinctEmployers (a facts fallback when no fresh row
 * exists), the same predicate the sitemaps use.
 */
import Link from 'next/link';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import ImmersiveImage from '@/components/ImmersiveImage';
import type { Metadata } from 'next';
import type { Prisma } from '@prisma/client';
import {
  ArrowLeft, ArrowRight, Bell, Building2, DollarSign, Info, Lightbulb, MapPin,
} from 'lucide-react';
import { cache } from 'react';
import { withTagFallback, type CategoryTag } from './category-tagger';
import {
  shouldRenderCategoryCity,
  shouldIndexLocalListingPage,
  isPseoStatsFresh,
  pseoStatsFreshnessThreshold,
  PSEO_STATS_MAX_AGE_HOURS,
  MIN_JOBS_FOR_CATEGORY_CITY } from './render-gate';
import { JOB_LISTING_OMIT } from './job-listing-omit';
import { BEST_SORT_ORDER_BY } from '@/lib/utils/job-sort';
import { brand } from '@/config/brand';
import { LICENSE_GUIDE_SERIES_PUBLISHED } from '@/config/niche/content-map';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { NLC_SOURCE_LINE, SOP_SOURCE_LINE } from '@/components/ScopeOfPracticeData';
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import JobCard from '@/components/JobCard';
// P2 #19: Breadcrumbs renders the VISIBLE trail and the BreadcrumbList
// JSON-LD from one items array, so schema can never drift from what users
// see. It replaces the schema-only BreadcrumbSchema that used to sit here:
// do not add both, or the page emits two BreadcrumbList graphs.
import Breadcrumbs from '@/components/Breadcrumbs';
import { formatCount, pluralize } from '@/lib/display-text';
import { withListingQuarantine } from '@/lib/pseo/listing-where';
import CategoryHero from '@/components/CategoryHero';
import {
  ClayCard,
  EmployerRoster,
  employerSentence,
  IconWell,
  LocationSpread,
  locationSentences,
  PostedPay,
  PracticeCard,
  RoleSetup,
  FAQ_SCHEMA_MIN_ENTRIES,
  resolveSectionIcon,
  clayLink,
  clayList,
  clayMeta,
  clayMuted,
  clayRow,
  clayTile,
  type LocationSpreadPlace,
  type SectionGlyph,
} from '@/components/seo/pseo';
import { Job } from '@/lib/types';
import { CityData } from './city-data/types';
import { getCityBySlug } from './city-data/cities';
import { SETTING_CONFIGS, SettingConfig, stateToSlug } from './setting-state-config';
import { categoryNavArt, getCategoryAssets, NAV_ICONS } from './category-asset-registry';
import { emptyListingFacts, getListingFacts, type ListingFacts } from './listing-facts';
import {
  buildCategoryCityDescription,
  buildCategoryCityFaqs,
  buildCategoryCityTitle,
  buildFreshnessSentence,
  buildRoleSetup,
  formatK,
  receivesNpMedian,
} from './listing-narrative';
import { labelNoun, labelSentence } from './category-metadata';
import { buildCategoryCityAxisGuide } from './category-axis-guide';
import { getPracticeEnvironment, isLicenseGuideLive } from './practice-environment';
// P3 #9: the /jobs/city/[slug] route does NOT read the city dataset: it rebuilds
// a city NAME out of the slug and matches that against the DB `city` column. These
// two are P2's builder/guard pair for that round-trip, and importing them here is
// the same cross-import components/tools/city-picker-data.ts already makes.
import { buildCitySlug, cityLinkResolves } from '@/app/jobs/locations/[state]/directory';
import { JobListViewTracker, PseoPageViewTracker } from '@/components/analytics/ViewTrackers';
import { buildCityFacts, buildTaxonomyCityNarrative } from './city-narrative';
import { CITY_EMPLOYER_LIMIT } from './city-employers';
import { STATE_ELIGIBLE_CATEGORY_SLUGS } from './taxonomy-registry';
// Kept as its own statement: tests/regressions/pseo-consistency-integrity.test.ts
// (B36) pins the exact single-specifier import line above.
import { PSYCH_SPECIALTY_SLUG } from './taxonomy-registry';

// Categories with a real /jobs/<category>/[state] route. City-only categories
// (the other 21) 410 at the middleware for state-shaped URLs, so every
// state-level link/breadcrumb below must fall back to the /jobs/state/{slug}
// hub for them instead of emitting a guaranteed-410 URL.
const STATE_ELIGIBLE_SET = new Set<string>(STATE_ELIGIBLE_CATEGORY_SLUGS);

const NP = brand.niche.short;

// ─── Category Configuration (extends SettingConfig for specialties) ────────────

export interface CategoryConfig {
  slug: string;
  label: string;
  fullLabel: string;
  heroSubtitle: string;
  /**
   * Optional because nothing reads it: keywords metadata was removed from the
   * page (thin-spec section 6), and the setting configs that settingToCategory
   * spreads in no longer carry the field. Delete it with the entries below
   * rather than making it required again.
   */
  keywords?: string[];
  faqCategory: string;
  buildWhere: (stateName: string, cityName?: string) => Record<string, unknown>;
  benefits: Array<{
    title: string;
    description: string;
    iconName: string;
  }>;
  tips: string[];
}

// Copy rule for every benefit and tip below (thin-spec 2 P4, PLAN C.5): no
// figure, no pay band, no trend word. Each entry says what the category means
// on this board and what to confirm in a listing. Pay renders only through the
// gated helpers (CC-K3).

// Specialty configs (supplement the setting configs from setting-state-config.ts)
export const SPECIALTY_CONFIGS: Record<string, CategoryConfig> = {
  'new-grad': {
    slug: 'new-grad',
    label: 'New Grad',
    fullLabel: `New Graduate ${brand.niche.short}`,
    heroSubtitle: 'Entry-level & new graduate positions',
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
      { title: 'Onboarding Terms', description: 'The better listings spell out onboarding, preceptorship and supervision, so read those sections before comparing offers.', iconName: 'TrendingUp' },
      { title: 'Career Foundation', description: 'Build clinical confidence and skills that set you up for advanced roles or private practice later.', iconName: 'Shield' },
    ],
    tips: [
      'Prioritize positions with structured supervision',
      'Ask how the caseload ramps in the first months',
      'Seek collaborative practice opportunities',
      `Join AANP and your state ${brand.niche.short} association for networking and CE`,
      'Ask whether sign-on bonuses or student loan assistance are offered',
    ],
  },
  'per-diem': {
    slug: 'per-diem',
    label: 'Per Diem',
    fullLabel: `Per Diem ${brand.niche.short}`,
    heroSubtitle: 'PRN & flexible schedule positions',
    keywords: ['per diem np', 'PRN np', 'part time np', 'flexible np'],
    faqCategory: 'per-diem',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('per-diem'),
    }),
    benefits: [
      { title: 'Maximum Flexibility', description: 'Set your own schedule and work as many or as few shifts as you want, when you want.', iconName: 'Activity' },
      { title: 'Hourly Pay', description: 'Per diem roles are paid by the shift or hour; compare the rate against the hourly value of a salaried offer with benefits.', iconName: 'DollarSign' },
      { title: 'Income Supplement', description: 'Per diem work can supplement a full-time position or private practice while maintaining clinical variety.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Maintain your own malpractice insurance',
      'Track hours carefully for tax purposes',
      'Build relationships at multiple facilities',
      'Negotiate the hourly rate before the first shift',
      'Consider 1099 versus W-2 per diem arrangements',
    ],
  },
};

// Job Type configs
export const JOB_TYPE_CONFIGS: Record<string, CategoryConfig> = {
  'full-time': {
    slug: 'full-time',
    label: 'Full-Time',
    fullLabel: `Full-Time ${brand.niche.short}`,
    heroSubtitle: `Permanent full-time ${brand.niche.short} positions with benefits`,
    keywords: ['full time np', 'permanent np', 'salaried np'],
    faqCategory: 'remote', // Use remote FAQ as closest match
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('full-time'),
    }),
    benefits: [
      { title: 'Comprehensive Benefits', description: 'Health, dental and vision coverage, retirement plans and paid time off are usually part of the offer; confirm each in the listing.', iconName: 'Heart' },
      { title: 'Job Security', description: 'Stable employment with consistent income, malpractice coverage, and professional development support.', iconName: 'Shield' },
      { title: 'Career Growth', description: 'Access to leadership tracks, CME funding and promotion paths; ask how each is structured.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Ask whether a sign-on bonus is offered and how it vests',
      'Ask about panel size and daily visit expectations',
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
    keywords: ['part time np', 'half time np', 'flexible np'],
    faqCategory: 'per-diem',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('part-time'),
    }),
    benefits: [
      { title: 'Work-Life Balance', description: 'Set a reduced weekly schedule while maintaining clinical skills and income.', iconName: 'Activity' },
      { title: 'Multiple Income Streams', description: 'Combine part-time with private practice, telehealth, or consulting.', iconName: 'DollarSign' },
      { title: 'Sustainable Pace', description: 'Lower caseloads and schedule flexibility can make the work more sustainable.', iconName: 'Heart' },
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
    keywords: ['contract np', 'locum tenens np', '1099 np', 'temp np'],
    faqCategory: 'travel',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('contract'),
    }),
    benefits: [
      { title: 'Rate-Based Pay', description: 'Contract rates are quoted per hour or per shift without the benefits of a permanent role, so compare the whole package.', iconName: 'DollarSign' },
      { title: 'Tax Considerations', description: '1099 contractors can deduct travel, housing, CME, malpractice insurance, and home office expenses where the rules allow.', iconName: 'TrendingUp' },
      { title: 'Geographic Freedom', description: 'Try different cities, practice settings, and patient populations before committing long-term.', iconName: 'MapPin' },
    ],
    tips: [
      'Work with established staffing agencies',
      'Negotiate housing/travel stipends in your contract',
      'Get your own occurrence-based malpractice policy',
      'Set aside a share of each payment for self-employment taxes',
      'Ensure contract specifies patient volume expectations',
    ],
  },
};

// Experience Level configs
export const EXPERIENCE_LEVEL_CONFIGS: Record<string, CategoryConfig> = {
  'entry-level': {
    slug: 'entry-level',
    label: 'Entry-Level',
    fullLabel: `Entry-Level ${brand.niche.short}`,
    heroSubtitle: `New graduate & early-career ${brand.niche.short} positions with mentorship`,
    keywords: ['entry level np', 'new grad np', 'junior np', '0-2 years np'],
    faqCategory: 'new-grad',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('entry-level'),
    }),
    benefits: [
      { title: 'Structured Mentorship', description: `Many entry-level positions include a period of supervised practice with experienced physicians or senior ${brand.niche.short}s.`, iconName: 'Users' },
      { title: 'Room to Grow', description: 'Entry-level roles establish the clinical base that later specialty and leadership roles build on.', iconName: 'DollarSign' },
      { title: 'Career Launchpad', description: 'Build your clinical foundation with a manageable caseload before scaling up.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Prioritize positions offering structured supervision',
      'Start with collaborative practice models when possible',
      'Ask whether sign-on bonuses are offered to new graduates',
      'Ask about the ramp-up period and initial caseload expectations',
      `Join AANP or your state ${brand.niche.short} association for networking and CE opportunities`,
    ],
  },
  'mid-career': {
    slug: 'mid-career',
    label: 'Mid-Career',
    fullLabel: `Mid-Career ${brand.niche.short}`,
    heroSubtitle: `Experienced ${brand.niche.short} positions for clinicians with several years of practice`,
    keywords: ['experienced np', 'mid career np', '3-5 years np', 'senior np positions'],
    faqCategory: 'remote',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('mid-career'),
    }),
    benefits: [
      { title: 'Compensation Leverage', description: 'Proven experience supports negotiation on base pay, CME budgets and leadership bonuses.', iconName: 'DollarSign' },
      { title: 'Autonomy & Flexibility', description: 'With proven experience, choose between independent practice, hybrid schedules, or specialized roles.', iconName: 'Activity' },
      { title: 'Specialization Options', description: 'Pivot into urgent care, dermatology, cardiology, palliative care, or private practice consulting.', iconName: 'Shield' },
    ],
    tips: [
      'Use your experience to negotiate base pay and productivity terms',
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
    heroSubtitle: 'Leadership & advanced practice positions for experienced clinicians',
    keywords: ['senior np', 'lead np', 'director np', 'advanced practice nurse practitioner'],
    faqCategory: 'remote',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('senior'),
    }),
    benefits: [
      { title: 'Senior Compensation', description: 'Senior roles often pair base pay with performance bonuses, and some add equity or partnership terms.', iconName: 'DollarSign' },
      { title: 'Leadership Impact', description: `Shape clinical programs, mentor junior providers, and influence organizational clinical strategy.`, iconName: 'Users' },
      { title: 'Private Practice Ready', description: 'Your reputation and network support a thriving independent or group practice transition.', iconName: 'TrendingUp' },
    ],
    tips: [
      'Target clinical director or VP-level roles',
      'Negotiate equity or partnership opportunities',
      'Consider building your own private practice or telehealth group',
      'Pursue board certification in subspecialties for premium positioning',
      'Mentor the next generation; it builds your network and reputation',
    ],
  },
};

// Employer Type configs
export const EMPLOYER_TYPE_CONFIGS: Record<string, CategoryConfig> = {
  hospital: {
    slug: 'hospital',
    label: 'Hospital',
    fullLabel: `Hospital ${brand.niche.short}`,
    heroSubtitle: `Hospital-based ${brand.niche.short} positions with full benefits`,
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
      'Large health systems often carry the broadest benefits; compare the details',
      'Academic medical centers often include teaching opportunities',
      'Ask about call schedules, since hospital roles may require weekend coverage',
      'Negotiate CME days and funding',
      'Union hospitals may offer higher base pay and better protections',
    ],
  },
  'private-practice': {
    slug: 'private-practice',
    label: 'Private Practice',
    fullLabel: `Private Practice ${brand.niche.short}`,
    heroSubtitle: `Independent & group practice ${brand.niche.short} opportunities`,
    keywords: ['private practice np', 'independent np', 'group practice np', 'own practice np'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('private-practice'),
    }),
    benefits: [
      { title: 'Earning Upside', description: 'Practice owners and partners set fee schedules, payer mix and patient volume, which shapes what the role can earn.', iconName: 'DollarSign' },
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
    keywords: ['community health np', 'FQHC np', 'community health center np', 'public health np'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('community-health'),
    }),
    benefits: [
      { title: 'Loan Repayment', description: "NHSC loan repayment may be available at approved sites; eligibility depends on the site's current NHSC status and your discipline.", iconName: 'DollarSign' },
      { title: 'Mission-Driven Work', description: `Serve underserved populations and make a direct impact on community health outcomes.`, iconName: 'Heart' },
      { title: 'Diverse Experience', description: 'Treat a wide range of conditions across all ages, building broad clinical expertise quickly.', iconName: 'Activity' },
    ],
    tips: [
      'Check NHSC loan repayment eligibility for your site (hpsa.hrsa.gov)',
      'FQHCs provide malpractice coverage under the FTCA, a major benefit',
      'Ask about daily visit volumes and support staffing',
      'Bilingual skills are highly valued and may qualify for pay differentials',
      'Community health experience is excellent for future leadership roles',
    ],
  },
  va: {
    slug: 'va',
    label: 'VA',
    fullLabel: `VA ${brand.niche.short}`,
    heroSubtitle: `Veterans Affairs ${brand.niche.short} positions with federal benefits`,
    keywords: ['VA np', 'veterans affairs np', 'military np', 'federal np'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('va'),
    }),
    benefits: [
      { title: 'Federal Benefits', description: 'Federal pension (FERS), TSP retirement matching and FEHB health insurance, with leave set by federal rules.', iconName: 'Shield' },
      { title: 'Defined Scope', description: "The VA sets its own practice standards for its clinicians; ask how the role's scope is defined.", iconName: 'Heart' },
      { title: 'Student Loan Repayment', description: "The VA's Education Debt Reduction Program may apply to qualifying positions; confirm eligibility with the hiring facility.", iconName: 'DollarSign' },
    ],
    tips: [
      'VA applications go through USAJobs.gov, so create your profile early',
      'Apply under Direct Hire Authority for faster processing',
      'PTSD and TBI experience is valued at VA facilities',
      'Federal pay is based on GS/GP scales; negotiate within the grade',
      'Ask how the schedule and leave structure compare with private employers',
    ],
  },
};

// Population Specialty configs
export const POPULATION_SPECIALTY_CONFIGS: Record<string, CategoryConfig> = {
  geriatric: {
    slug: 'geriatric',
    label: 'Geriatric',
    fullLabel: `Geriatric ${brand.niche.short}`,
    heroSubtitle: `Older adult & geriatric ${brand.niche.short} positions`,
    keywords: ['geriatric np', 'gerontology np', 'elderly care NP', 'older adult health'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('geriatric'),
    }),
    benefits: [
      { title: 'Older Adult Care', description: 'Geriatric roles center on medication management, chronic conditions and care coordination for older adults.', iconName: 'TrendingUp' },
      { title: 'Meaningful Care', description: `Help older adults maintain independence and quality of life through expert medication management.`, iconName: 'Heart' },
      { title: 'Diverse Settings', description: 'Work in SNFs, memory care units, home health, outpatient clinics, or palliative care programs.', iconName: 'Building2' },
    ],
    tips: [
      'Pursue gerontological specialty certification (GS-C) for premium positioning',
      'Understand polypharmacy risks and Beers Criteria medications',
      'Learn dementia assessment tools (MoCA, MMSE, GDS)',
      'Build relationships with geriatricians for collaborative care',
      'Ask how SNF and consulting roles structure pay',
    ],
  },
  veterans: {
    slug: 'veterans',
    label: 'Veterans',
    fullLabel: `Veterans ${brand.niche.short}`,
    heroSubtitle: `Military & veteran-focused ${brand.niche.short} positions`,
    keywords: ['veterans np', 'military health np', 'VA community care np', 'veteran care NP'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('veterans'),
    }),
    benefits: [
      { title: 'Critical Mission', description: `Veterans carry distinct health burdens, including polytrauma, TBI, toxic exposures, and chronic pain, and veteran-focused ${brand.niche.short}s close real care gaps.`, iconName: 'Heart' },
      { title: 'Specialized Training', description: 'VA-funded continuing education and fellowship pathways span primary care, rehabilitation, and specialty medicine.', iconName: 'Shield' },
      { title: 'Federal Benefits', description: 'VA positions include the federal pension, TSP matching and federal leave; loan repayment programs depend on the position.', iconName: 'DollarSign' },
    ],
    tips: [
      'TBI, polytrauma, and toxic-exposure (PACT Act) expertise is valued',
      'Learn VA disability and service-connected documentation requirements',
      'Military-connected clinicians are especially valued',
      `Community-based veteran organizations also hire ${brand.niche.short}s`,
      'TRICARE network providers serve military families outside the VA system',
    ],
  },
  lgbtq: {
    slug: 'lgbtq',
    label: 'LGBTQ+',
    fullLabel: `LGBTQ+ Affirming ${brand.niche.short}`,
    heroSubtitle: `LGBTQ+ affirming ${brand.niche.short} positions`,
    keywords: ['lgbtq np', 'gender affirming np', 'transgender health', 'lgbtq affirming NP'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('lgbtq'),
    }),
    benefits: [
      { title: 'Affirming Care', description: `LGBTQ+ patients benefit from affirming, trained providers who understand their care needs.`, iconName: 'Heart' },
      { title: 'Affirming Practice', description: 'Gender-affirming and preventive care are delivered in clinics and on telehealth platforms that serve the community.', iconName: 'TrendingUp' },
      { title: 'Meaningful Impact', description: `Provide culturally competent care to patients who are often underserved.`, iconName: 'Users' },
    ],
    tips: [
      'Complete WPATH SOC training for gender-affirming care fundamentals',
      `Understand hormone therapy interactions with commonly prescribed medications`,
      'Build cultural competency through LGBTQ+ affirming practice workshops',
      'Fenway Health and Callen-Lorde are model programs to study',
      'Telehealth expands reach to LGBTQ+ patients in underserved areas',
    ],
  },
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
// Minimal configs for the NP slugs added by the taxonomy migration
// (lib/pseo/taxonomy-registry.ts) so every CITY-eligible category has a
// working /jobs/<slug>/city/[slug] route. Mirrors the buildNpSpecialtyConfig
// pattern in setting-state-config.ts.
//
// QUERY NOTE: the ingest classifier (lib/pseo/category-tagger.ts) emits the
// NP taxonomy, so these buildWhere clauses go through the normal
// withTagFallback() path like the legacy configs: precomputed `categoryTags`
// containment first, legacy keyword fallback only for rows whose tags have
// not been backfilled yet.
//
// faqCategory is the slug itself; the city template builds its FAQ block
// from lib/pseo/listing-narrative.ts (CC-K8), never from CategoryFAQ.

interface NpCategoryConfigInput {
  slug: CategoryTag;
  label: string;
  fullLabel: string;
  heroSubtitle: string;
  keywords: string[];
}

function buildNpCategoryConfig(input: NpCategoryConfigInput): CategoryConfig {
  return {
    ...input,
    faqCategory: input.slug,
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback(input.slug),
    }),
    benefits: [
      { title: 'Role Focus', description: `${input.fullLabel} roles center on a defined patient population or setting; each listing states the certification it expects.`, iconName: 'TrendingUp' },
      { title: 'Practice Variety', description: 'Openings span health systems, private groups, and community settings.', iconName: 'Building2' },
      { title: 'Career Mobility', description: 'State licensure plus national certification keeps your options open across employers and settings.', iconName: 'Users' },
    ],
    tips: [
      'Verify state APRN licensure and prescriptive authority requirements',
      'Keep national certification and CE credits current',
      'Compare total compensation: base, incentives, CME, and benefits',
      'Ask about caseload, support staffing, and documentation time',
      'Confirm collaborative or supervisory agreement requirements in this state',
    ],
  };
}

export const NP_CATEGORY_CONFIGS: Record<string, CategoryConfig> = {
  'urgent-care': buildNpCategoryConfig({
    slug: 'urgent-care',
    label: 'Urgent Care',
    fullLabel: 'Urgent Care NP',
    heroSubtitle: 'Walk-in clinic & urgent care nurse practitioner positions',
    keywords: ['urgent care nurse practitioner', 'urgent care NP jobs', 'walk-in clinic NP'],
  }),
  'home-health': buildNpCategoryConfig({
    slug: 'home-health',
    label: 'Home Health',
    fullLabel: 'Home Health NP',
    heroSubtitle: 'In-home visit & house-call nurse practitioner positions',
    keywords: ['home health nurse practitioner', 'home health NP jobs', 'house call NP'],
  }),
  'family-practice': buildNpCategoryConfig({
    slug: 'family-practice',
    label: 'Family Practice',
    fullLabel: 'Family Practice NP (FNP)',
    heroSubtitle: 'Family practice nurse practitioner positions',
    keywords: ['family practice nurse practitioner', 'FNP jobs', 'family nurse practitioner'],
  }),
  'adult-gerontology': buildNpCategoryConfig({
    slug: 'adult-gerontology',
    label: 'Adult-Gerontology',
    fullLabel: 'Adult-Gerontology NP (AGNP)',
    heroSubtitle: 'Adult-gerontology nurse practitioner positions',
    keywords: ['adult gerontology nurse practitioner', 'AGNP jobs', 'AGACNP', 'AGPCNP'],
  }),
  pediatric: buildNpCategoryConfig({
    slug: 'pediatric',
    label: 'Pediatric',
    fullLabel: 'Pediatric NP (PNP)',
    heroSubtitle: 'Pediatric nurse practitioner positions',
    keywords: ['pediatric nurse practitioner', 'PNP jobs', 'peds NP'],
  }),
  neonatal: buildNpCategoryConfig({
    slug: 'neonatal',
    label: 'Neonatal',
    fullLabel: 'Neonatal NP (NNP)',
    heroSubtitle: 'NICU & newborn care nurse practitioner positions',
    keywords: ['neonatal nurse practitioner', 'NNP jobs', 'NICU nurse practitioner'],
  }),
  'women-health': buildNpCategoryConfig({
    slug: 'women-health',
    label: "Women's Health",
    fullLabel: "Women's Health NP (WHNP)",
    heroSubtitle: "Women's health nurse practitioner positions",
    keywords: ["women's health nurse practitioner", 'WHNP jobs', 'OB/GYN nurse practitioner'],
  }),
  'acute-care': buildNpCategoryConfig({
    slug: 'acute-care',
    label: 'Acute Care',
    fullLabel: 'Acute Care NP (ACNP)',
    heroSubtitle: 'Acute care nurse practitioner positions',
    keywords: ['acute care nurse practitioner', 'ACNP jobs', 'ICU nurse practitioner'],
  }),
  emergency: buildNpCategoryConfig({
    slug: 'emergency',
    label: 'Emergency',
    fullLabel: 'Emergency NP (ENP)',
    heroSubtitle: 'Emergency nurse practitioner positions',
    keywords: ['emergency nurse practitioner', 'ENP jobs', 'ER nurse practitioner'],
  }),
  'psychiatric-mental-health': buildNpCategoryConfig({
    slug: 'psychiatric-mental-health',
    label: 'Psychiatric Mental Health',
    fullLabel: 'Psychiatric Mental Health NP (PMHNP)',
    heroSubtitle: 'Psychiatric mental health nurse practitioner positions',
    keywords: ['psychiatric nurse practitioner', 'PMHNP jobs', 'psych NP'],
  }),
  oncology: buildNpCategoryConfig({
    slug: 'oncology',
    label: 'Oncology',
    fullLabel: 'Oncology NP',
    heroSubtitle: 'Oncology nurse practitioner positions',
    keywords: ['oncology nurse practitioner', 'oncology NP jobs', 'hematology oncology NP'],
  }),
  cardiology: buildNpCategoryConfig({
    slug: 'cardiology',
    label: 'Cardiology',
    fullLabel: 'Cardiology NP',
    heroSubtitle: 'Cardiology nurse practitioner positions',
    keywords: ['cardiology nurse practitioner', 'cardiology NP jobs', 'cardiovascular NP'],
  }),
  'primary-care': buildNpCategoryConfig({
    slug: 'primary-care',
    label: 'Primary Care',
    fullLabel: 'Primary Care NP',
    heroSubtitle: 'Primary care nurse practitioner positions',
    keywords: ['primary care nurse practitioner', 'primary care NP jobs', 'internal medicine NP'],
  }),
  hospitalist: buildNpCategoryConfig({
    slug: 'hospitalist',
    label: 'Hospitalist',
    fullLabel: 'Hospitalist NP',
    heroSubtitle: 'Inpatient medicine nurse practitioner positions',
    keywords: ['hospitalist nurse practitioner', 'hospitalist NP jobs', 'inpatient medicine NP'],
  }),
  dermatology: buildNpCategoryConfig({
    slug: 'dermatology',
    label: 'Dermatology',
    fullLabel: 'Dermatology NP',
    heroSubtitle: 'Dermatology nurse practitioner positions',
    keywords: ['dermatology nurse practitioner', 'dermatology NP jobs', 'derm NP'],
  }),
  orthopedic: buildNpCategoryConfig({
    slug: 'orthopedic',
    label: 'Orthopedic',
    fullLabel: 'Orthopedic NP',
    heroSubtitle: 'Orthopedic nurse practitioner positions',
    keywords: ['orthopedic nurse practitioner', 'orthopedic NP jobs', 'ortho NP'],
  }),
  anesthesia: buildNpCategoryConfig({
    slug: 'anesthesia',
    label: 'Nurse Anesthetist',
    fullLabel: 'Nurse Anesthetist (CRNA)',
    heroSubtitle: 'Certified registered nurse anesthetist positions',
    keywords: ['CRNA jobs', 'nurse anesthetist', 'certified registered nurse anesthetist'],
  }),
  midwifery: buildNpCategoryConfig({
    slug: 'midwifery',
    label: 'Nurse Midwife',
    fullLabel: 'Nurse Midwife (CNM)',
    heroSubtitle: 'Certified nurse midwife positions',
    keywords: ['CNM jobs', 'certified nurse midwife', 'nurse midwifery'],
  }),
  'clinical-nurse-specialist': buildNpCategoryConfig({
    slug: 'clinical-nurse-specialist',
    label: 'Clinical Nurse Specialist',
    fullLabel: 'Clinical Nurse Specialist (CNS)',
    heroSubtitle: 'Clinical nurse specialist positions',
    keywords: ['clinical nurse specialist', 'CNS jobs', 'CNS nurse jobs'],
  }),
  aesthetics: buildNpCategoryConfig({
    slug: 'aesthetics',
    label: 'Aesthetics',
    fullLabel: 'Aesthetic NP',
    heroSubtitle: 'Med spa & aesthetic medicine nurse practitioner positions',
    keywords: ['aesthetic nurse practitioner', 'aesthetics NP jobs', 'med spa NP', 'nurse injector'],
  }),
  'pain-management': buildNpCategoryConfig({
    slug: 'pain-management',
    label: 'Pain Management',
    fullLabel: 'Pain Management NP',
    heroSubtitle: 'Interventional pain & pain medicine nurse practitioner positions',
    keywords: ['pain management nurse practitioner', 'pain management NP jobs', 'interventional pain NP'],
  }),
  'palliative-hospice': buildNpCategoryConfig({
    slug: 'palliative-hospice',
    label: 'Palliative & Hospice',
    fullLabel: 'Palliative Care & Hospice NP',
    heroSubtitle: 'Palliative care & hospice nurse practitioner positions',
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
  // NP taxonomy categories (2026-07 migration)
  ...NP_CATEGORY_CONFIGS,
  // ─── Additional Categories (3) ─────────────────────────────────────────────
  '1099': {
    slug: '1099',
    label: '1099',
    fullLabel: `1099 / Independent Contractor ${brand.niche.short}`,
    heroSubtitle: `Independent contractor & 1099 ${brand.niche.short} positions`,
    keywords: ['1099 np', 'independent contractor np', '1099 nurse practitioner', 'contract NP'],
    faqCategory: 'outpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('1099'),
    }),
    benefits: [
      { title: 'Gross Rate', description: '1099 rates are quoted before self-employment tax, malpractice and the benefits you fund yourself, so model the after-tax figure.', iconName: 'DollarSign' },
      { title: 'Schedule Control', description: 'Set your own hours, work with multiple clients, and control your patient volume and caseload.', iconName: 'Clock' },
      { title: 'Tax Considerations', description: 'Deduct business expenses, contribute to a SEP-IRA or Solo 401(k), and write off home office and mileage where the rules allow.', iconName: 'DollarSign' },
    ],
    tips: [
      'Form an LLC or PLLC before signing your first contract',
      'Get individual malpractice insurance',
      'Set up quarterly estimated tax payments with the IRS',
      'Open a SEP-IRA or Solo 401k for retirement savings',
      'Keep detailed records of all business expenses for deductions',
    ],
  },
  correctional: {
    slug: 'correctional',
    label: 'Correctional',
    fullLabel: `Correctional ${brand.niche.short}`,
    heroSubtitle: `Prison, jail & correctional facility ${brand.niche.short} positions`,
    keywords: ['correctional np', 'prison np', 'correctional health NP', 'jail nurse practitioner'],
    faqCategory: 'inpatient',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('correctional'),
    }),
    benefits: [
      { title: 'Public-Sector Terms', description: 'Many correctional roles come from state, county or contracted health services and describe public-employee benefits.', iconName: 'DollarSign' },
      { title: 'Loan Repayment', description: "Correctional facilities are among HRSA's eligible NHSC site types; repayment depends on the specific facility holding an active NHSC approval.", iconName: 'DollarSign' },
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
    keywords: ['locum tenens np', 'locum NP', 'temporary assignment np', 'locum nurse practitioner'],
    faqCategory: 'travel',
    buildWhere: (stateName: string, cityName?: string) => ({
      isPublished: true,
      state: { equals: stateName, mode: 'insensitive' },
      ...(cityName && { city: { equals: cityName, mode: 'insensitive' } }),
      ...withTagFallback('locum-tenens'),
    }),
    benefits: [
      { title: 'Agency-Handled Logistics', description: 'Assignments are usually arranged through an agency that covers malpractice and handles credentialing paperwork.', iconName: 'DollarSign' },
      { title: 'Defined Assignments', description: 'Assignments run for a stated period; take breaks between them and keep your options open.', iconName: 'Calendar' },
      { title: 'Nationwide Opportunities', description: 'Work across multiple states, experience different healthcare systems, and build a diverse clinical portfolio.', iconName: 'MapPin' },
    ],
    tips: [
      'Maintain active licenses in multiple states via compact agreements',
      'Work with more than one locum agency for the best selection of assignments',
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

/** The category x city bucket clause (published rows of this category in this city). */
function categoryCityBucket(config: CategoryConfig, city: CityData): Prisma.JobWhereInput {
  return config.buildWhere(city.state, city.name) as Prisma.JobWhereInput;
}

async function getCityJobs(config: CategoryConfig, city: CityData, skip = 0, take = 10) {
  try {
    // T0-1: the canonical predicate (published, unexpired, dead-link and
    // profession gates) composed through AND; the quarantine wrapper keeps
    // the listing query on the same veto every /jobs browse query applies.
    const where = withListingQuarantine(canonicalBucketWhere(config.buildWhere(city.state, city.name) as Prisma.JobWhereInput));
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
  /**
   * When the count was actually computed: pseoStats.updatedAt for fresh
   * cached rows, "now" for live-count fallbacks, null when no data exists
   * (the page redirects/404s before rendering in that case).
   */
  statsAsOf: Date | null;
}

const EMPTY_STATS: CityStats = { totalJobs: 0, statsAsOf: null };

// Staleness window for cached pseoStats rows: the one value in
// lib/pseo/render-gate.ts (PSEO_STATS_MAX_AGE_HOURS) that the sitemaps and the
// aggregate-pseo staleness probe also read. Rows older than this are treated
// as unreliable: a stale positive count would otherwise render frozen job
// counts (soft-404 pattern on never-refreshed cities), so we recount live.
const STATS_STALENESS_HOURS = PSEO_STATS_MAX_AGE_HOURS;
const STATS_STALENESS_MS = STATS_STALENESS_HOURS * 60 * 60 * 1000;

// Perf2: cache() dedupes the duplicate call within a render (metadata + page
// component both call getCityStats with the same module-level config/city refs).
const getCityStats = cache(async function getCityStats(config: CategoryConfig, city: CityData): Promise<CityStats> {
  let cachedRow: { totalJobs: number; updatedAt: Date } | null = null;
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
        return { totalJobs: stats.totalJobs, statsAsOf: stats.updatedAt };
      }
    }

    // Fallback: live count when the pseoStats cache is empty, zero, or stale.
    // A stale positive row is NOT trusted: if the live count is 0 the page
    // correctly redirects instead of rendering frozen counts. The count reads
    // the canonical predicate (T0-1), the same one the cron wrote the row with.
    const where = withListingQuarantine(canonicalBucketWhere(config.buildWhere(city.state, city.name) as Prisma.JobWhereInput));
    const liveCount = await prisma.job.count({ where });
    if (liveCount > 0) {
      return { totalJobs: liveCount, statsAsOf: new Date() };
    }

    return EMPTY_STATS;
  } catch (error) {
    console.error(`[category-city] Failed to fetch stats for ${config.slug}/${city.slug}:`, error);
    // If the live recount failed but we hold a (possibly stale) positive row,
    // prefer it, with its REAL date, over redirecting a page that likely
    // still has jobs. Transient DB errors must not 308 live pages away.
    if (cachedRow) {
      return { totalJobs: cachedRow.totalJobs, statsAsOf: cachedRow.updatedAt };
    }
    // No trusted row to fall back on. `cachedRow` is only ever assigned INSIDE
    // the try after a successful findUnique returning a positive row, so
    // reaching here means the FIRST query failed and we hold zero evidence
    // that this combo is empty. Returning EMPTY_STATS would make the caller
    // permanentRedirect(): a 308 is a PERMANENT signal, cached by the route's
    // `revalidate = 3600` and consolidated by Google, so a DB blip would fold
    // the whole category x city surface into its parents. Rethrow: a 5xx is
    // retried and never moves a URL. Absence of data is not evidence of an
    // empty page.
    throw error;
  }
});

/**
 * The facts reads are DECORATIVE, and the count is not.
 *
 * getCityStats owns the only fatal read on this route: it rescues the count
 * from a stale-but-positive PseoStats row when the live recount fails, and
 * rethrows when it holds no row at all, so a DB outage surfaces as a 5xx
 * that crawlers retry instead of a cacheable 308 to the parent category.
 *
 * computeListingFacts deliberately lets its own count throw
 * (lib/pseo/listing-facts.ts: "The count is the only query allowed to
 * throw"). During the very outage getCityStats just rescued, that second
 * count fails too, so an uncaught facts read would reject the metadata
 * builder and the page component and turn the rescue back into a 5xx,
 * leaving the rescue machinery and its comments as dead code. Swallowing
 * the failure keeps the rescued count on the page. The cost is bounded and
 * far softer than a moved URL: with no fresh stored row distinctEmployers
 * falls back to 0, so the page noindexes (index false, follow true) for one
 * revalidate window and every optional section omits itself.
 */
function factsOrEmpty(scope: string, load: () => Promise<ListingFacts>): Promise<ListingFacts> {
  return load().catch((error) => {
    console.error(`[category-city] facts read failed for ${scope}; rendering without the optional sections:`, error);
    return emptyListingFacts(new Date());
  });
}

/** Facts for the category pool in this city (one cache()d loader per scope key). */
function getCategoryCityFacts(config: CategoryConfig, city: CityData): Promise<ListingFacts> {
  return factsOrEmpty(`${config.slug}/${city.slug}`, () =>
    getListingFacts(`category-city:${config.slug}:${city.slug}`, categoryCityBucket(config, city)));
}

/** Facts for every listing in the city, the fallback pool for CC-K1 and CC-K3. */
function getCityPoolFacts(city: CityData): Promise<ListingFacts> {
  return factsOrEmpty(`pool/${city.slug}`, () =>
    getListingFacts(`category-city:pool:${city.slug}`, {
      state: { equals: city.state, mode: 'insensitive' },
      city: { equals: city.name, mode: 'insensitive' },
    }));
}

/** The PseoStats gate columns, typed locally (see readStoredCategoryCityRow). */
interface StoredCategoryCityRow {
  totalJobs: number;
  distinctEmployers: number;
  updatedAt: Date;
}

/**
 * The cron's fresh row for this combo, or null.
 *
 * WHY RAW: the generated Prisma client predates the `distinctEmployers` and
 * `indexable` columns (prisma/migrations/20260916120000_pseo_stats_index_gate)
 * and must not be regenerated on this branch, so the employer count the
 * sitemap gates on is only reachable through a $queryRaw tagged template
 * (parameterized; the column names are literals). A failed or non-array
 * result reads as "no row", and the caller falls back to the live facts.
 */
const readStoredCategoryCityRow = cache(async function readStoredCategoryCityRow(
  categorySlug: string,
  locationSlug: string,
): Promise<StoredCategoryCityRow | null> {
  try {
    const rows = await prisma.$queryRaw<StoredCategoryCityRow[]>`
      SELECT "totalJobs", "distinctEmployers", "updatedAt"
      FROM "PseoStats"
      WHERE "type" = 'category-city'
        AND "categorySlug" = ${categorySlug}
        AND "locationSlug" = ${locationSlug}
        AND "updatedAt" >= ${pseoStatsFreshnessThreshold()}
      LIMIT 1`;
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (error) {
    console.error(`[category-city] PseoStats gate read failed for ${categorySlug}/${locationSlug}:`, error);
    return null;
  }
});

/**
 * Hero badge copy that only claims "updated today" when the underlying data
 * was actually computed today (UTC). Fresh-cache rows carry pseoStats
 * .updatedAt; live fallback counts are "now". Anything older shows the real
 * date so stale-positive rows can't render a false freshness claim.
 *
 * Exported (P2 #15) so lib/pseo/setting-state-template.tsx renders the same
 * freshness contract on the state pages instead of hardcoding "updated
 * today". ONE implementation: a copy is how the two surfaces drift.
 */
export function formatStatsBadge(totalJobs: number, statsAsOf: Date | null): string {
  const asOf = statsAsOf ?? new Date();
  const isToday = asOf.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  const freshness = isToday
    ? 'updated today'
    : `updated ${asOf.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return `${totalJobs} live ${pluralize(totalJobs, 'role')} · ${freshness}`;
}

// ─── Qualification facts per category (P2 #8) ─────────────────────────────────

/**
 * Certification/licensure facts for the "what qualifications do I need" FAQ.
 * ONE builder feeds both the visible accordion answer and the FAQPage
 * JSON-LD (B52 rule), so a wrong body here is wrong in both places.
 *
 * WHY THIS EXISTS: the template asserted "National board certification (ANCC
 * or AANP)" for EVERY category. That is factually wrong for the APRN cohort
 * this board carries (CRNAs certify through the NBCRNA and CNMs through the
 * AMCB, neither of which administers an AANP/ANCC exam) and wrong for the
 * population-specific NP tracks (PNCB for pediatrics, NCC for neonatal and
 * women's health, ANCC/AACN for acute care and CNS).
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
    degree: 'a graduate degree from a nurse anesthesia program accredited by the Council on Accreditation (COA); admission requires critical-care RN experience, and entry-level programs now award a doctorate',
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
    certification: 'national certification for that population, for example AGCNS-BC through ANCC or an ACCNS credential through the American Association of Critical-Care Nurses (AACN)',
    dea: 'DEA registration where the state grants CNS prescriptive authority',
  },
  pediatric: {
    role: 'PNP',
    article: 'a',
    standaloneLabel: false,
    degree: `a master's or doctoral degree from a pediatric ${brand.niche.descriptor} program`,
    certification: 'national certification through the Pediatric Nursing Certification Board (PNCB): CPNP-PC for primary care or CPNP-AC for acute care',
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
    certification: 'national certification on the acute care track: AGACNP-BC through ANCC or ACNPC-AG through the American Association of Critical-Care Nurses (AACN)',
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
 * -discipline HRSA column (see ./city-data/types.ts). Naming the discipline
 * in the copy is necessary but NOT sufficient: a behavioral-health
 * designation is still the donor niche when it is published on an unrelated
 * category, and most dataset cities carry the flag.
 *
 * The thin-content program (PLAN T0-4) removed every rendered shortage
 * surface from this template because the column has no citable source. The
 * two predicates stay exported because the regression suites pin them
 * (tests/regressions/p2-pseo-parity-donor-niche-gate.test.ts and
 * p3-donor-followups-narrative-truth.test.ts), so a later surface that wants
 * the column has one gate to reuse instead of re-deriving it.
 */
export function categoryOwnsShortageData(categorySlug: string): boolean {
  return PSYCH_SPECIALTY_SLUG !== undefined && categorySlug === PSYCH_SPECIALTY_SLUG;
}

/** Is this city's designation an on-topic AFFIRMATIVE claim for this category? */
export function shortageIsOnTopic(city: CityData, categorySlug: string): boolean {
  return city.mentalHealthShortage && categoryOwnsShortageData(categorySlug);
}

// ─── Metadata Generator (CC-K9) ────────────────────────────────────────────────

export async function buildCategoryCityMetadata(
  categoryKey: string,
  citySlug: string,
  page: number,
): Promise<Metadata> {
  const config = ALL_CATEGORY_CONFIGS[categoryKey];
  const city = getCityBySlug(citySlug);
  if (!config || !city) return { title: 'Not Found' };

  // getCityStats falls back to a stale-but-positive cached row on failure, and
  // rethrows when it has none: a DB outage must surface as 5xx, never as a
  // cacheable 308 to the parent category.
  const stats = await getCityStats(config, city);

  // SEO: 308 permanent redirect for 0-job pages (metadata phase)
  // The page component also redirects, but this catches the metadata call first
  if (stats.totalJobs === 0) {
    const { permanentRedirect } = await import('next/navigation');
    permanentRedirect(`/jobs/${config.slug}`);
  }

  const basePath = `/jobs/${config.slug}/city/${citySlug}`;

  // PLAN C.2: robots read the one predicate the sitemaps use. The employer
  // count comes from the cron's fresh row (what the cities sitemap gates on)
  // and falls back to the live facts when no fresh row exists.
  const [facts, storedRow] = await Promise.all([
    getCategoryCityFacts(config, city),
    readStoredCategoryCityRow(config.slug, city.slug),
  ]);
  const distinctEmployers = storedRow?.distinctEmployers ?? facts.distinctEmployers;
  const shouldIndex = shouldIndexLocalListingPage({ activeJobs: stats.totalJobs, distinctEmployers, page });

  const noun = labelNoun(config.slug, config.label);
  const sentenceLabel = labelSentence(config.label);
  const env = getPracticeEnvironment(city.state);
  const title = buildCategoryCityTitle({ labelNoun: noun, city: city.name, stateCode: city.stateCode, total: stats.totalJobs });
  const description = buildCategoryCityDescription({
    labelSentence: sentenceLabel,
    city: city.name,
    stateCode: city.stateCode,
    facts: { ...facts, total: stats.totalJobs },
    authorityDescription: env?.authorityDescription ?? null,
  });

  // OG: the count and, only when the category pool clears the publishing
  // gate, the gated middle half of posted pay. Never a mean.
  const ogParams = new URLSearchParams({
    category: config.label,
    city: `${city.name}, ${city.stateCode}`,
    jobs: String(stats.totalJobs),
    ...(facts.benchmark && { salary: `${formatK(facts.benchmark.p25)} to ${formatK(facts.benchmark.p75)}` }),
  });
  const ogImage = `/api/og/city?${ogParams.toString()}`;

  // Canonical: self on every rendered page 1 (noindex pages keep it, with
  // follow); page N canonicals to page 1 of the same listing, never the
  // parent category (that caused "Duplicate without canonical" in GSC).
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      images: [ogImage],
    },
    alternates: {
      canonical: `${brand.baseUrl}${basePath}`,
    },
    robots: { index: shouldIndex, follow: true },
  };
}

// ─── Page chrome ───────────────────────────────────────────────────────────────

/* Design tokens, matched to the category pages (clay). */
const clayCard: CSSProperties = {
  background: '#FFFFFF', borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/** Primary berry pebble button (the alert CTA and the empty state). */
const clayCtaPrimary: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
  padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
  background: '#BE185D', color: '#fff', textDecoration: 'none',
  boxShadow: '3px 3px 8px rgba(190,24,93,0.15)',
};

/** White clay pebble button (pagination and the secondary empty-state action). */
const clayPebble: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
  padding: '10px 18px', borderRadius: '12px', fontWeight: 700, fontSize: '13px',
  background: '#FFFFFF', color: '#BE185D', textDecoration: 'none',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow: '3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6)',
};

/** Disabled pebble: flat, recessed ground, no shadow. */
const clayPebbleDisabled: CSSProperties = {
  ...clayPebble,
  background: '#F9F7F1', color: '#A09080', border: '1px solid #EAE6DF', boxShadow: 'none', cursor: 'default',
};

/** Card title inside a bespoke bento cell. */
const cellTitle: CSSProperties = { fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' };
const cellBody: CSSProperties = { fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 };

const NEARBY_CITY_LIMIT = 6;
const ACROSS_STATE_LIMIT = 7;
const EXPLORE_CARD_LIMIT = 12;
const PAGE_SIZE = 10;

/**
 * GA4 item_list_name for the listings on every category x city page. The
 * view_item_list impression and each card's select_item read this one
 * constant, because GA4 joins a click to its impression on the name alone.
 * One name for the whole template rather than one per page: thousands of
 * category x city combinations would each become their own list row and
 * push GA4's item-list reports into "(other)". The category and city are
 * already on the pseo_page_view event this page sends.
 */
const CATEGORY_CITY_LIST_NAME = 'Category City Jobs';

/** A picture in its own clay frame: padding 0, the art edge to edge inside the card. */
function PictureFrame({ src, alt, minHeight }: { src: string; alt: string; minHeight: number }) {
  return (
    <div className="pseo-bento-card" style={{ ...clayCard, padding: 0, overflow: 'hidden', display: 'grid' }}>
      <ImmersiveImage src={src} alt={alt} minHeight={minHeight} />
    </div>
  );
}

/** Static stylesheet: responsive collapse, hover lifts (reduced motion gated) and the accordion marker. */
const CATEGORY_CITY_CSS = `
  .pseo-crumb-band { background: #faf6ef; padding: 24px 56px 0; }
  .pseo-crumb-band nav { margin-bottom: 0; }
  .pseo-crumb-band nav ol li:last-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 900px) {
    .pseo-crumb-band { padding: 16px 24px 0; }
  }
  .pseo-cta-primary { transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease; }
  .pseo-cta-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 32px rgba(190,24,93,0.35) !important; filter: brightness(1.05); }
  .pseo-pebble { transition: transform 0.25s ease, box-shadow 0.25s ease; }
  .pseo-pebble:hover { transform: translateY(-2px); box-shadow: 5px 5px 14px rgba(0,0,0,0.08), -2px -2px 6px rgba(255,255,255,0.8) !important; }
  .pseo-bento-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
  .pseo-bento-card:hover { transform: translateY(-4px); box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important; }
  .pseo-bento-span-4 { grid-column: span 4; }
  .pseo-bento-span-8 { grid-column: span 8; }
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
  .pseo-bento-grid > div { min-width: 0; }
  @media (max-width: 768px) {
    .pseo-bento-grid { grid-template-columns: 1fr !important; }
    .pseo-bento-grid > div { grid-column: span 1 !important; grid-template-columns: 1fr !important; }
  }
  @media (prefers-reduced-motion: reduce) {
    .pseo-cta-primary, .pseo-pebble, .pseo-bento-card, .pseo-faq-item { transition: none; }
    .pseo-cta-primary:hover, .pseo-pebble:hover, .pseo-bento-card:hover { transform: none; }
  }
`;

// ─── Page Component ────────────────────────────────────────────────────────────

interface CategoryCityPageProps {
  categoryKey: string;
  citySlug: string;
  page: number;
}

/** An explore card for CC-K5: a sibling category in this city, or the city hub. */
interface ExploreCardLink {
  href: string;
  label: string;
  sub: string;
  icon: SectionGlyph;
}

export default async function CategoryCityPage({ categoryKey, citySlug, page }: CategoryCityPageProps) {
  const config = ALL_CATEGORY_CONFIGS[categoryKey];
  const city = getCityBySlug(citySlug);

  if (!config || !city) {
    const { notFound } = await import('next/navigation');
    notFound();
  }

  const skip = (page - 1) * PAGE_SIZE;

  // 1. Instantly fetch pre-calculated stats (single indexed row lookup ~2ms)
  const stats = await getCityStats(config, city!);

  // ═══ SEO GUARD: 308 permanent redirect for 0-job pages ═══
  // Instead of a hard 404 (which wastes crawl budget and loses link equity),
  // 308 redirect to the parent category page so Google consolidates the signal.
  if (stats.totalJobs === 0) {
    const { permanentRedirect } = await import('next/navigation');
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

  // 2. Job rows plus the two fact pools (category in this city, every
  // listing in this city) that the thin-content sections read.
  const [jobs, facts, cityFacts] = await Promise.all([
    getCityJobs(config, city!, skip, PAGE_SIZE),
    getCategoryCityFacts(config, city!),
    getCityPoolFacts(city!),
  ]);

  // 404 for paginated pages beyond available results.
  if (page > 1 && jobs.length === 0) {
    const { notFound: notFoundFn } = await import('next/navigation');
    notFoundFn();
  }

  const totalPages = Math.ceil(stats.totalJobs / PAGE_SIZE);
  const basePath = `/jobs/${config.slug}/city/${citySlug}`;
  const noun = labelNoun(config.slug, config.label);
  const sentenceLabel = labelSentence(config.label);
  // One count on the page: the copy builders read the same total the hero,
  // the listings heading and the ItemList print (the stats row when fresh,
  // else the live count), so no sentence can disagree with the badge.
  const copyFacts: ListingFacts = { ...facts, total: stats.totalJobs };
  const stateSlug = stateToSlug(city!.state);

  // P3 #9: the "All {city} Jobs" CTA below used to link `/jobs/city/${citySlug}`
  // with the DATASET slug. That route never looks the slug up; it splits it,
  // title-cases the segments and matches the result against the DB `city` column,
  // so for the dataset slugs that do not round-trip (dropped trailing
  // "City"/"Village"/"Town", collapsed punctuation, folded diacritics) every
  // rendered category x city page carried an outbound link to a hard 404.
  // Build the ROUTE-shaped slug and emit the link only when the round-trip
  // actually resolves; otherwise omit it. Never link a known 404.
  const allCityJobsHref = cityLinkResolves(city!.name, city!.stateCode)
    ? `/jobs/city/${buildCitySlug(city!.name, city!.stateCode)}`
    : null;

  // CC-K6: practice environment for this state (AANP tier, compact status,
  // board) and whether the license guide is live enough to link.
  const env = getPracticeEnvironment(city!.state);
  const licenseGuideLive = env ? LICENSE_GUIDE_SERIES_PUBLISHED && await isLicenseGuideLive(env.stateSlug) : false;

  // P2 #8: correct certifying body for THIS category (CRNA through NBCRNA,
  // CNM through AMCB, ...) feeds the practice card and the qualification FAQ.
  const credentials = getCategoryCredentials(config.slug);

  // CC-K1: employers for this category in this city (2 or more), else the
  // all-specialty city pool with its disclaimer (2 or more), else nothing.
  const categoryEmployersRender = employerSentence({ kind: 'category-city', labelSentence: sentenceLabel, city: city!.name }, copyFacts) !== null;
  const cityEmployersSentence = categoryEmployersRender ? null : employerSentence({ kind: 'city', city: city!.name }, cityFacts);
  const topEmployers = cityEmployersSentence ? cityFacts.topEmployers.slice(0, CITY_EMPLOYER_LIMIT) : [];

  // GSC Fix (P1.5): gate cross-links by the same threshold the target page
  // renders at. Category x city pages notFound() below MIN_JOBS_FOR_CATEGORY_CITY,
  // so linking combos sitting at 1-2 jobs produces systematic internal links to
  // 404s. Pseo stats are pre-aggregated, so these queries are fast; rows older
  // than the freshness window are ignored (the sitemaps ignore them too).
  const freshRowsSince = pseoStatsFreshnessThreshold();
  const allOtherCategoryConfigs = Object.values(ALL_CATEGORY_CONFIGS).filter((c) => c.slug !== config.slug);

  // Nearby cities: gate by THIS category clearing the render threshold in each
  // candidate city (the target pages 404 below MIN_JOBS_FOR_CATEGORY_CITY).
  const candidateNearby = city!.nearbyCities
    .map((slug) => getCityBySlug(slug))
    .filter((c): c is CityData => c !== undefined)
    .slice(0, 12); // overshoot, then filter to NEARBY_CITY_LIMIT

  const [otherCategoryRows, nearbyRows, acrossStateRows, stateLinkRow, dbCatCityOverride] = await Promise.all([
    // CC-K5: sibling categories in this city, with live counts.
    prisma.pseoStats.findMany({
      where: {
        type: 'category-city',
        locationSlug: citySlug,
        totalJobs: { gte: MIN_JOBS_FOR_CATEGORY_CITY },
        categorySlug: { in: allOtherCategoryConfigs.map(c => c.slug) },
        updatedAt: { gte: freshRowsSince },
      },
      select: { categorySlug: true, totalJobs: true },
      orderBy: { totalJobs: 'desc' },
    }),
    candidateNearby.length > 0
      ? prisma.pseoStats.findMany({
          where: {
            type: 'category-city',
            categorySlug: config.slug,
            locationSlug: { in: candidateNearby.map(c => c.slug) },
            totalJobs: { gte: MIN_JOBS_FOR_CATEGORY_CITY },
          },
          select: { locationSlug: true },
        })
      : Promise.resolve([]),
    // CC-K4: other cities in this state with this category at the render floor.
    prisma.pseoStats.findMany({
      where: {
        type: 'category-city',
        categorySlug: config.slug,
        locationSlug: { endsWith: `-${city!.stateCode.toLowerCase()}`, not: citySlug },
        totalJobs: { gte: MIN_JOBS_FOR_CATEGORY_CITY },
        updatedAt: { gte: freshRowsSince },
      },
      select: { locationSlug: true, totalJobs: true },
      orderBy: { totalJobs: 'desc' },
      take: ACROSS_STATE_LIMIT + NEARBY_CITY_LIMIT,
    }),
    // P1.5: the "{label} Jobs in {state}" link only renders when a
    // setting-state page exists for this taxonomy + state (some taxonomies
    // are city-only and never have a state page; others may have a state
    // page with 0 jobs right now). CC-K4 also reads its count.
    prisma.pseoStats.findUnique({
      where: {
        type_categorySlug_locationSlug: {
          type: 'setting-state',
          categorySlug: config.slug,
          locationSlug: stateSlug,
        },
      },
      select: { totalJobs: true, updatedAt: true },
    }),
    // P3.4: per-(taxonomy, city) narrative. DB override wins; otherwise the
    // deterministic builder produces the market-context paragraph.
    prisma.categoryCitySnippet.findUnique({
      where: {
        categorySlug_citySlug: {
          categorySlug: config.slug,
          citySlug,
        },
      },
      select: { body: true, approvedAt: true },
    }),
  ]);

  const validNearbySlugs = new Set(nearbyRows.map(r => r.locationSlug));
  const nearbyCities = candidateNearby.filter(c => validNearbySlugs.has(c.slug)).slice(0, NEARBY_CITY_LIMIT);
  const nearbySlugSet = new Set(nearbyCities.map((c) => c.slug));

  const showStateLink = (stateLinkRow?.totalJobs ?? 0) >= 1;
  // CC-K4 state share: only for categories with a state page, from a fresh row.
  const stateCount = STATE_ELIGIBLE_SET.has(config.slug) && stateLinkRow && isPseoStatsFresh(stateLinkRow.updatedAt)
    ? stateLinkRow.totalJobs
    : null;
  const acrossStateVariant = {
    kind: 'category-city' as const,
    city: city!.name,
    stateName: city!.state,
    labelSentence: sentenceLabel,
    cityCount: stats.totalJobs,
    stateCount,
  };
  // Deduped against the nearby band, which links the same pages.
  const acrossStatePlaces: LocationSpreadPlace[] = acrossStateRows
    .flatMap((row) => {
      const other = getCityBySlug(row.locationSlug);
      if (!other || nearbySlugSet.has(other.slug)) return [];
      return [{ name: other.name, count: row.totalJobs, link: { href: `/jobs/${config.slug}/city/${other.slug}`, renders: true } }];
    })
    .slice(0, ACROSS_STATE_LIMIT);
  const acrossStateRenders = locationSentences(acrossStateVariant, acrossStatePlaces).length > 0;

  // CC-K5: explore cards from the live rows (labels and counts differ per
  // city), each with the registry's nav tile or glyph. Every href here
  // cleared the render gate in the query above; the city hub card carries
  // the all-specialty count.
  const exploreCardLinks: ExploreCardLink[] = otherCategoryRows
    .flatMap((row) => {
      const other = ALL_CATEGORY_CONFIGS[row.categorySlug];
      if (!other) return [];
      return [{
        href: `/jobs/${other.slug}/city/${citySlug}`,
        label: other.label,
        sub: formatCount(row.totalJobs, 'open role'),
        icon: resolveSectionIcon(categoryNavArt(other.slug)),
      }];
    })
    .slice(0, EXPLORE_CARD_LIMIT);
  const cityHubCard: ExploreCardLink | null = allCityJobsHref
    ? {
        href: allCityJobsHref,
        label: `All ${NP} jobs in ${city!.name}`,
        sub: cityFacts.total >= 1 ? formatCount(cityFacts.total, 'open role') : 'Every specialty on this board',
        icon: NAV_ICONS.location,
      }
    : null;

  const taxonomyCityNarrative = dbCatCityOverride && dbCatCityOverride.approvedAt
    ? dbCatCityOverride.body
    : buildTaxonomyCityNarrative(buildCityFacts(city!), config.slug, stats.totalJobs);

  // T0-7: the sources line names only what this page renders.
  const sourceLines = [
    'U.S. Census Bureau (2020 population)',
    env ? SOP_SOURCE_LINE : null,
    env ? NLC_SOURCE_LINE : null,
    receivesNpMedian(config.slug) ? STAT_SOURCES.averageSalary.source : null,
  ].filter((line): line is string => line !== null);

  // CC-K2, K3, K7: the bento cells.
  const freshness = buildFreshnessSentence(facts.recency);
  const roleSetupRenders = buildRoleSetup({ slug: config.slug, facts }).rendered;
  const axisGuide = buildCategoryCityAxisGuide(config.slug, { city: city!.name, label: config.label, labelSentence: sentenceLabel });
  const assets = getCategoryAssets(config.slug);
  const salaryGuide = { href: `/salary-guide/${stateSlug}`, renders: true, label: `${city!.state} salary guide` };
  // CC-K3 three branches: the category pool's gated median; else the
  // all-specialty city pool's gated median under a title that names the
  // scope; else the category's disclosed-count sentence with the BLS cite
  // (PostedPay prints nothing when no listing states a salary, and never the
  // NP median on the APRN roles).
  const payFacts = facts.benchmark
    ? copyFacts
    : cityFacts.benchmark
      ? { total: cityFacts.total, salaryDisclosedCount: cityFacts.salaryDisclosedCount, benchmark: cityFacts.benchmark }
      : copyFacts;
  const payBenchmark = payFacts.benchmark;
  const payTitle = facts.benchmark
    ? `Posted pay for ${sentenceLabel} roles`
    : cityFacts.benchmark
      ? `Posted pay across all ${NP} listings in ${city!.name}`
      : `Posted pay for ${sentenceLabel} roles`;
  const payChip = !facts.benchmark && cityFacts.benchmark ? 'City pay' : 'Pay';

  // CC-K9 hero stats: positions; the gated median or the employer count
  // (2 or more); listings first posted in the last 30 days. Never a mean.
  const heroStats = [
    { value: `${stats.totalJobs}`, label: pluralize(stats.totalJobs, 'position') },
    ...(facts.benchmark
      ? [{ value: formatK(facts.benchmark.median), label: 'median pay' }]
      : facts.distinctEmployers >= 2
        ? [{ value: `${facts.distinctEmployers}`, label: pluralize(facts.distinctEmployers, 'employer') }]
        : []),
    ...(facts.recency.last30 > 0 ? [{ value: `${facts.recency.last30}`, label: 'new in 30 days' }] : []),
  ];

  // ═══ FAQ (CC-K8): SINGLE source array (audit B52) ═══
  // This ONE array feeds BOTH the FAQPage JSON-LD and the visible accordion
  // below. An entry whose answer would need a fallback figure is absent from
  // both at once. Never fork this array again.
  const categoryCityFaqs = buildCategoryCityFaqs({
    slug: config.slug,
    label: config.label,
    labelSentence: sentenceLabel,
    city: city!.name,
    stateName: city!.state,
    facts: copyFacts,
    cityBenchmark: cityFacts.benchmark,
    env,
    qualifications: `To work as ${credentials.article} ${credentials.role} in ${city!.name}, ${city!.stateCode}, you need: (1) ${credentials.degree}, (2) ${credentials.certification}, (3) an active RN and APRN license in ${city!.state}, and (4) ${credentials.dea}.`,
  });

  // P2 #19: ONE breadcrumb array drives the visible <nav> and the
  // BreadcrumbList JSON-LD (Breadcrumbs renders both); hrefs are relative
  // because the component prefixes the canonical origin itself.
  // State crumb: city-only categories have no /jobs/{cat}/{state} route
  // (middleware 410s that shape), so their state crumb points at the
  // /jobs/state/{slug} hub instead; never a 410 URL in schema or in the DOM.
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

  const pageName = `${noun} Jobs in ${city!.name}, ${city!.stateCode}`;
  const showInsights = categoryEmployersRender || topEmployers.length > 0 || acrossStateRenders;

  return (
    <div style={{ backgroundColor: '#FDFBF7' }}>
      {/* ═══ SCHEMAS ═══ */}
      {/* D9: ItemList schema.
          B29: job titles are aggregator-sourced: escape < and > so a literal
          "</script>" in a title can never terminate this element early. */}
      {jobs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: pageName,
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
      {/* indexOffset={skip} matches the cards' listIndex={skip + i}, so a
          card's impression and click report the same position. */}
      <JobListViewTracker
        jobs={jobs.map((j: Job) => ({ id: j.id, title: j.title, employer: j.employer }))}
        listName={CATEGORY_CITY_LIST_NAME}
        indexOffset={skip}
      />

      {/* ═══ P2 #19: visible, linked breadcrumb trail ═══
          Sits in the hero's cream band so it reads as part of the header.
          CategoryHero's own `breadcrumbs` prop is deliberately empty: it
          renders unlinked <span>s whose labels did not match the
          BreadcrumbList schema, and two Breadcrumb navs on one page is
          both a duplicate landmark and a duplicate-schema signal. */}
      <div className="pseo-crumb-band">
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      {/* ═══ D2: HERO (CC-K9) ═══
          The secondary CTA points at the broadest listing the reader can
          reach (the city hub when its slug round-trips, else the state hub),
          never at /job-alerts: PLAN C.4 allows exactly ONE alert CTA per
          page and that one is the sidebar card below. */}
      <CategoryHero
        bgColor={assets.bgColor}
        heroImage={assets.heroImage}
        heroAlt={`${noun} working in ${city!.name}, ${city!.stateCode}`}
        badgeText={formatStatsBadge(stats.totalJobs, stats.statsAsOf)}
        breadcrumbs={[]}
        headlineLine1={noun}
        headlineLine2="Jobs"
        headlineSub={`in ${city!.name}, ${city!.stateCode}.`}
        stats={heroStats}
        description={`${config.heroSubtitle}.`}
        ctaLabel={`Browse ${config.label} Jobs`}
        ctaHref={`/jobs/${config.slug}`}
        secondaryCtaLabel={allCityJobsHref ? `All ${city!.name} Jobs` : `All ${city!.state} Jobs`}
        secondaryCtaHref={allCityJobsHref ?? `/jobs/state/${stateSlug}`}
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
                  style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  View All Jobs <ArrowRight size={14} />
                </Link>
              </div>

              {jobs.length === 0 ? (
                <div className="pseo-bento-card" style={{ ...clayCard, padding: '40px 24px', textAlign: 'center' }}>
                  <IconWell icon={MapPin} size="lg" style={{ margin: '0 auto 16px' }} />
                  <h3 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>
                    No {sentenceLabel} positions in {city!.name} right now
                  </h3>
                  <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.6, margin: '0 0 20px' }}>
                    Try a nearby city or the statewide listings.
                  </p>
                  {nearbyCities.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', marginBottom: '24px' }}>
                      {nearbyCities.slice(0, 4).map((nc) => (
                        <Link key={nc.slug} href={`/jobs/${config.slug}/city/${nc.slug}`} className="pseo-pebble" style={clayTile}>
                          {nc.name}, {nc.stateCode}
                        </Link>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px' }}>
                    {/* City-only categories have no /jobs/{cat}/{state} route
                        (middleware 410): send those to the state hub. */}
                    {STATE_ELIGIBLE_SET.has(config.slug) ? (
                      <Link href={`/jobs/${config.slug}/${stateToSlug(city!.state)}`} className="pseo-cta-primary" style={clayCtaPrimary}>
                        {config.label} Jobs in {city!.state}
                      </Link>
                    ) : (
                      <Link href={`/jobs/state/${stateToSlug(city!.state)}`} className="pseo-cta-primary" style={clayCtaPrimary}>
                        All {city!.state} Jobs
                      </Link>
                    )}
                    {allCityJobsHref && (
                      <Link href={allCityJobsHref} className="pseo-pebble" style={clayPebble}>
                        All {city!.name} Jobs
                      </Link>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                    {/* Absolute position (skip + i): page 2 continues the
                        count from page 1 rather than restarting it. */}
                    {jobs.map((job: Job, i: number) => (
                      <JobCard key={job.id} job={job} listName={CATEGORY_CITY_LIST_NAME} listIndex={skip + i} />
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <nav aria-label="Pagination" style={{ marginTop: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                      {page > 1 ? (
                        <Link href={`${basePath}?page=${page - 1}`} className="pseo-pebble" style={clayPebble}>
                          <ArrowLeft size={14} /> Previous
                        </Link>
                      ) : (
                        <span aria-disabled="true" style={clayPebbleDisabled}><ArrowLeft size={14} /> Previous</span>
                      )}
                      <span style={{ fontSize: '13px', color: '#7A6A62' }}>Page {page} of {totalPages}</span>
                      {page < totalPages ? (
                        <Link href={`${basePath}?page=${page + 1}`} className="pseo-pebble" style={clayPebble}>
                          Next <ArrowRight size={14} />
                        </Link>
                      ) : (
                        <span aria-disabled="true" style={clayPebbleDisabled}>Next <ArrowRight size={14} /></span>
                      )}
                    </nav>
                  )}
                </>
              )}
            </div>

            {/* Sidebar: the page's one alert CTA, then the tips (rendered once). */}
            <div className="lg:col-span-1">
              <div className="pseo-bento-card" style={{ ...clayCard, padding: '0', overflow: 'hidden', marginBottom: '20px', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.15)' }}>
                <div style={{ padding: '24px' }}>
                  <Bell size={28} style={{ color: '#BE185D', marginBottom: '12px' }} />
                  <h3 className="font-lora" style={{ fontSize: '18px', fontWeight: 700, color: '#831843', margin: '0 0 8px' }}>
                    {config.label} Alerts
                  </h3>
                  <p style={{ fontSize: '13px', color: '#BE185D', marginBottom: '16px', lineHeight: 1.6, fontWeight: 500 }}>
                    New {sentenceLabel} {NP} positions in {city!.name}, sent to your inbox.
                  </p>
                  <Link href="/job-alerts" className="pseo-cta-primary" style={{ ...clayCtaPrimary, display: 'flex', width: '100%' }}>
                    Create Alert
                  </Link>
                </div>
              </div>

              <div className="pseo-bento-card" style={{ ...clayCard, padding: '24px' }}>
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
            </div>
          </div>

          {/* ═══ BENTO GRID: "Why Choose [Category]" (CC-K2, K3, K6, K7) ═══ */}
          <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '48px 20px 40px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
              {assets.bentoSectionLabel}
            </p>
            <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>
              {config.label} Careers in {city!.name}
            </h2>
            {freshness && (
              <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '560px', margin: '0 auto 48px', lineHeight: 1.6 }}>
                {freshness}
              </p>
            )}

            <div className="pseo-bento-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '14px', marginTop: freshness ? 0 : '40px' }}>
              {/* ROW 1: how this page is built (8col, CC-K7) + practice slot (4col, CC-K6) */}
              {axisGuide && (
                <div className="pseo-bento-card" style={{ ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                  <div style={{ padding: '32px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                      <IconWell icon={Info} size="sm" />
                      <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A6A62' }}>About this page</span>
                    </div>
                    <h3 style={cellTitle}>How this page is built</h3>
                    <p style={cellBody}>{axisGuide}</p>
                  </div>
                  <ImmersiveImage src={assets.bentoImages[0]} alt={`${noun} at work`} minHeight={240} />
                </div>
              )}

              <div style={{ gridColumn: 'span 4', display: 'grid', gap: '14px', alignContent: 'start' }}>
                <PictureFrame src={assets.bentoImages[1]} alt={`Practice rules for ${NP}s in ${city!.state}`} minHeight={200} />
                <PracticeCard
                  env={env}
                  variant={{ kind: 'practicing', certification: credentials.certification }}
                  licenseGuideLive={licenseGuideLive}
                  title={`Practicing as ${credentials.article} ${credentials.role} in ${city!.state}`}
                />
              </div>

              {/* ROW 2: benefit cards, rendered once (CC P4) */}
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

              {/* ROW 3: posted pay (8col, CC-K3; the picture only beside a gated median) + role setup (4col, CC-K2) */}
              {payBenchmark ? (
                <div style={{ gridColumn: 'span 8', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', alignItems: 'stretch' }}>
                  <PostedPay variant={{ kind: 'category', slug: config.slug }} facts={payFacts} salaryGuide={salaryGuide} title={payTitle} chip={payChip} />
                  <PictureFrame src={assets.bentoImages[2] ?? assets.bentoImages[0]} alt={`Posted pay for ${noun} roles`} minHeight={240} />
                </div>
              ) : (
                <PostedPay variant={{ kind: 'category', slug: config.slug }} facts={payFacts} salaryGuide={salaryGuide} title={payTitle} chip={payChip} className="pseo-bento-span-8" />
              )}
              {roleSetupRenders && <RoleSetup slug={config.slug} facts={facts} className="pseo-bento-span-4" />}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ LOCAL INSIGHTS (CC-K1, CC-K4): full-width warm section ═══ */}
      {showInsights && (
        <section style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FDFBF7 100%)', padding: '40px 0', marginTop: '8px' }}>
          <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 20px' }}>
            <p className="font-lora" style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '6px' }}>Local Insights</p>
            <h2 className="font-lora" style={{ fontSize: '22px', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '24px' }}>{city!.name} at a Glance</h2>
            {/* `auto-fit, minmax(260px, 1fr)` collapses to a single column on
                375px viewports while preserving the 2-up grid on desktop. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', alignItems: 'start' }}>
              {/* CC-K1: employers hiring for this category; the all-specialty
                  city pool as the fallback (with its disclaimer); nothing
                  below two employers in either pool. Never padded. */}
              {categoryEmployersRender ? (
                <EmployerRoster variant={{ kind: 'category-city', labelSentence: sentenceLabel, city: city!.name }} facts={copyFacts} limit={CITY_EMPLOYER_LIMIT} />
              ) : topEmployers.length > 0 ? (
                <ClayCard chip="Employers" title="Top Employers Hiring Now" desc={cityEmployersSentence} icon={Building2}>
                  <ul className="pseo-clay-list" style={clayList}>
                    {topEmployers.map((emp, i) => (
                      <li key={emp.name} style={clayRow(i === topEmployers.length - 1)}>
                        {emp.companyPath ? (
                          <Link href={emp.companyPath} style={clayLink}>{emp.name}</Link>
                        ) : (
                          <span>{emp.name}</span>
                        )}
                        <span style={clayMeta}>{formatCount(emp.count, 'listing')}</span>
                      </li>
                    ))}
                  </ul>
                  <p style={{ ...clayMuted, marginTop: '12px' }}>
                    Employers with open {brand.niche.short} roles in {city!.name}, {city!.stateCode} right now, counted across every specialty on this board.
                  </p>
                </ClayCard>
              ) : null}

              {/* CC-K4: the city's share of the state pool and the other
                  cities with this category at the render floor. */}
              {acrossStateRenders && (
                <LocationSpread
                  variant={acrossStateVariant}
                  places={acrossStatePlaces}
                  title={`${config.label} roles across ${city!.state}`}
                  tileIcon={NAV_ICONS.location}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* D6: Nearby Cities */}
      {nearbyCities.length > 0 && (
        <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 20px' }}>
          <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', marginBottom: '16px', textAlign: 'center' }}>
            {noun} Jobs in Nearby Cities
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
            {nearbyCities.map((nc) => (
              <Link key={nc.slug} href={`/jobs/${config.slug}/city/${nc.slug}`}
                className="pseo-bento-card" style={{ ...clayCard, display: 'block', padding: '14px', textAlign: 'center', textDecoration: 'none' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A2E35' }}>{nc.name}</div>
                <div style={{ fontSize: '11px', marginTop: '4px', color: '#7A6A62' }}>{nc.stateCode} · Pop. {Math.round(nc.population / 1000)}K</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* D6 + D8: Explore More (CC-K5): warm bg with clay icon cards */}
      {(exploreCardLinks.length > 0 || cityHubCard || showStateLink) && (
        <div style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFF3E8 50%, #FFF8F0 100%)' }}>
          <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '56px 20px' }}>
            {(exploreCardLinks.length > 0 || cityHubCard) && (
              <>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                  Keep Exploring
                </p>
                <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>
                  Other {NP} Job Types in {city!.name}
                </h2>
                <div className="pseo-explore-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                  {[...exploreCardLinks, ...(cityHubCard ? [cityHubCard] : [])].map((c) => (
                    <Link key={c.href} href={c.href} className="pseo-bento-card" style={{ ...clayCard, padding: '24px 20px', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                      <IconWell icon={c.icon} size="lg" style={{ margin: '0 auto 12px' }} />
                      <span style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', display: 'block', marginBottom: '4px' }}>{c.label}</span>
                      <span style={{ fontSize: '12px', color: '#7A6A62', display: 'block' }}>{c.sub}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {/* Resource Links */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginTop: exploreCardLinks.length > 0 || cityHubCard ? '32px' : 0 }}>
              <Link href={`/salary-guide/${stateSlug}`} className="pseo-bento-card" style={{ ...clayCard, padding: '20px', textDecoration: 'none' }}>
                <h3 className="font-lora" style={{ fontSize: '15px', fontWeight: 700, color: '#BE185D', marginBottom: '4px' }}>
                  <DollarSign size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> {city!.state} Salary Guide
                </h3>
                <p style={{ fontSize: '12px', color: '#5A4A42', margin: 0 }}>Posted pay and practice rules for {NP}s in {city!.state}.</p>
              </Link>
              {showStateLink && (
                <Link href={`/jobs/${config.slug}/${stateToSlug(city!.state)}`} className="pseo-bento-card" style={{ ...clayCard, padding: '20px', textDecoration: 'none' }}>
                  <h3 className="font-lora" style={{ fontSize: '15px', fontWeight: 700, color: '#BE185D', marginBottom: '4px' }}>
                    <MapPin size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> {config.label} Jobs in {city!.state}
                  </h3>
                  <p style={{ fontSize: '12px', color: '#5A4A42', margin: 0 }}>Browse all {sentenceLabel} positions statewide.</p>
                </Link>
              )}
              <Link href={`/jobs/${config.slug}`} className="pseo-bento-card" style={{ ...clayCard, padding: '20px', textDecoration: 'none' }}>
                <h3 className="font-lora" style={{ fontSize: '15px', fontWeight: 700, color: '#BE185D', marginBottom: '4px' }}>
                  <Building2 size={16} style={{ display: 'inline', verticalAlign: 'text-bottom' }} /> All {config.label} Jobs
                </h3>
                <p style={{ fontSize: '12px', color: '#5A4A42', margin: 0 }}>Nationwide {sentenceLabel} positions.</p>
              </Link>
            </div>
          </section>
        </div>
      )}

      {/* GEO + FAQ schema, in its own container wrapper */}
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          {/* ── P3.4: per-(taxonomy, city) market context ─────────────────────── */}
          {/* The narrative is unique per (city, taxonomy, totalJobs) tuple.
              data-speakable preserved for AEO. */}
          <section
            className="pseo-bento-card"
            style={{ ...clayCard, padding: '24px', marginTop: '0' }}
            id="answer-summary"
            data-speakable="true"
          >
            <h2 className="font-lora" style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', marginBottom: '12px' }}>
              {noun} Market in {city!.name}, {city!.stateCode}
            </h2>
            <p style={{ fontSize: '14px', lineHeight: 1.7, color: '#5A4A42', margin: 0 }}>
              {taxonomyCityNarrative}
            </p>
            {/* T0-7: only the sources this page actually renders. */}
            <p style={{ fontSize: '11px', marginTop: '8px', color: '#A09080' }}>
              Sources: {sourceLines.join('; ')}. Listing counts, employers and pay figures come from active listings on this board.
            </p>
          </section>

          {/* ── AEO: FAQPage schema ──────────────────────────────────────────
              Fed by categoryCityFaqs (hoisted above `return`): the SAME
              array renders the visible accordion section below (B52). The
              schema is emitted only at 2 or more entries. */}
          {categoryCityFaqs.length >= FAQ_SCHEMA_MIN_ENTRIES && (
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: JSON.stringify({
                  '@context': 'https://schema.org',
                  '@type': 'FAQPage',
                  mainEntity: categoryCityFaqs.map(faq => ({
                    '@type': 'Question',
                    name: faq.question,
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: faq.answer,
                    },
                  })),
                })
                  .replace(/</g, '\\u003c')
                  .replace(/>/g, '\\u003e'),
              }}
            />
          )}
          {/* Speakable Schema: marks content sections for voice/AI consumption.
              The FAQ array always carries the count, pay and qualification
              entries, so '.faq-answer' is always rendered on this page. */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'WebPage',
                name: pageName,
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

      {/* FAQ Accordion (CC-K8): warm bg section matching CategoryFAQ */}
      {categoryCityFaqs.length > 0 && (
        <div style={{ background: '#FDFBF7' }}>
          <section style={{ maxWidth: '1000px', margin: '0 auto', padding: '56px 20px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
              Common Questions
            </p>
            <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '40px' }}>
              {noun} Jobs in {city!.name}: FAQ
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Same categoryCityFaqs array as the FAQPage JSON-LD above:
                  do NOT fork a second copy here (B52). */}
              {categoryCityFaqs.map((faq, i) => (
                <details key={faq.question} className="pseo-faq-item" style={{
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
                    {faq.question}
                  </summary>
                  <div style={{ padding: '0 24px 20px', borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                    <p className="faq-answer" style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: '16px 0 0' }}>{faq.answer}</p>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* D11: Responsive + Hover CSS (static string, no interpolation) */}
      <style>{CATEGORY_CITY_CSS}</style>
    </div>
  );
}

/**
 * Registry of the free tools shipped under /tools (P2 #4, #5, #6, #17;
 * P3 #2, #6a, #6b; Tools Suite 2026-11-26).
 *
 * PLAIN DATA MODULE — its only import is config/brand. Keep it that way: the
 * sitemap, the /tools hub, and the /resources tools band all read from here,
 * and the same drift-proofing that governs SALARY_SPECIALTY_SLUGS and
 * JD_TEMPLATES applies — a surface must never be able to advertise a tool path
 * the app would 404 on.
 *
 * Adding a tool: add its entry here, create app/tools/<path>/page.tsx, and add
 * the path to PAGE_CONTENT_DATES in app/api/sitemaps/lastmod.ts.
 */
import { brand } from '@/config/brand';

export type ToolAudience = 'seeker' | 'employer';

/**
 * Icon is resolved to a lucide component by the rendering surface.
 *
 * Adding a key requires a matching entry in the ICONS record in
 * app/tools/page.tsx and TOOL_ICONS in app/resources/page.tsx — those Records
 * are keyed by this type, so TypeScript fails the build until added.
 */
export type ToolIconKey =
  | 'calculator'
  | 'scale'
  | 'clipboard'
  | 'chart'
  | 'compass'
  | 'building'
  | 'briefcase'
  | 'shield'
  | 'clock'
  | 'sparkles'
  | 'layers'
  | 'check'
  | 'graduation'
  | 'activity'
  | 'fileText'
  | 'arrows'
  | 'dollar';

/**
 * schema.org applicationCategory for the tool's WebApplication markup. Held
 * here so the hub's `hasPart` and the tool's own page declare the same value.
 */
export type ToolApplicationCategory = 'FinanceApplication' | 'BusinessApplication' | 'EducationalApplication';

export type ToolCategory =
  | 'Compensation & Offers'
  | 'Coding & Productivity'
  | 'Licensure & Practice'
  | 'Education & Loans'
  | 'Hiring & Compliance'
  | 'Clinic Economics';

export interface ToolEntry {
  /** Route path, always rooted at /tools. */
  path: string;
  /** Card/nav title. */
  title: string;
  /** One-line description used on hub cards and link bands. */
  blurb: string;
  /** Short badge label. */
  badge: string;
  audience: ToolAudience;
  icon: ToolIconKey;
  applicationCategory: ToolApplicationCategory;
  /** Topic grouping for the /tools hub filter chips. */
  category?: ToolCategory;
}

export const TOOLS: readonly ToolEntry[] = [
  // ─── Existing Clinician & Employer Tools (7) ────────────────────────
  {
    path: '/tools/1099-vs-w2-calculator',
    title: '1099 vs W-2 take-home calculator',
    blurb:
      'Price a contract rate against a salaried offer with self-employment tax, your federal bracket, business expenses, and the benefits a contractor self-funds.',
    badge: 'Calculator',
    audience: 'seeker',
    icon: 'calculator',
    applicationCategory: 'FinanceApplication',
    category: 'Compensation & Offers',
  },
  {
    path: '/tools/cost-of-living-comparison',
    title: 'Cost-of-living salary comparison',
    blurb:
      'Put two cities side by side: posted pay, the cost-of-living gap, and what each salary is actually worth in national-average dollars.',
    badge: 'Comparison',
    audience: 'seeker',
    icon: 'scale',
    applicationCategory: 'FinanceApplication',
    category: 'Compensation & Offers',
  },
  {
    path: '/tools/licensure-checker',
    title: `${brand.niche.short} licensure checker & multi-state planner`,
    blurb:
      'See practice authority, licensure steps, and live pay for any state, then line up every state you are considering side by side.',
    badge: '51 jurisdictions',
    audience: 'seeker',
    icon: 'clipboard',
    applicationCategory: 'BusinessApplication',
    category: 'Licensure & Practice',
  },
  {
    path: '/tools/salary-benchmark',
    title: `What should I pay a ${brand.niche.descriptor}?`,
    blurb:
      'Median and 25th to 75th percentile posted pay by state, from live listings. Check a planned offer against the market before you post it.',
    badge: 'For employers',
    audience: 'employer',
    icon: 'chart',
    applicationCategory: 'BusinessApplication',
    category: 'Hiring & Compliance',
  },
  {
    path: '/tools/specialty-finder',
    title: `${brand.niche.short} specialty quiz`,
    blurb:
      'Eight questions on population, acuity, setting, autonomy, procedures, and schedule, followed by the specialties that match what you said you want, with live roles and pay for each.',
    badge: 'Preference sort',
    audience: 'seeker',
    icon: 'compass',
    applicationCategory: 'EducationalApplication',
    category: 'Education & Loans',
  },
  {
    path: '/tools/private-practice-revenue-calculator',
    title: `${brand.niche.short} private practice income calculator`,
    blurb:
      'Visits, collections per visit, and overhead worked through to net before tax, plus a sensitivity table showing what a wrong assumption costs you.',
    badge: 'Illustration',
    audience: 'seeker',
    icon: 'building',
    applicationCategory: 'FinanceApplication',
    category: 'Clinic Economics',
  },
  {
    path: '/tools/cost-per-hire-calculator',
    title: 'Cost-per-hire calculator',
    blurb:
      'A flat-fee posting against sponsored ads and an agency fee, on your own applicant volume and time-to-fill. Our prices are built in. Every other figure is yours.',
    badge: 'For employers',
    audience: 'employer',
    icon: 'briefcase',
    applicationCategory: 'BusinessApplication',
    category: 'Hiring & Compliance',
  },

  // ─── New Clinician & Student Tools (10) ─────────────────────────────
  {
    path: '/tools/offer-analyzer',
    title: `${brand.niche.short} job offer competitiveness analyzer`,
    blurb:
      'Benchmark a written salary offer against live state postings and federal wage percentiles, with experience, call, and PTO adjustments.',
    badge: 'Offer grader',
    audience: 'seeker',
    icon: 'chart',
    applicationCategory: 'FinanceApplication',
    category: 'Compensation & Offers',
  },
  {
    path: '/tools/salary-converter',
    title: `${brand.niche.short} hourly, shift & annual pay converter`,
    blurb:
      'Convert hourly rates, 3x12 or 4x10 shifts, 7-on/7-off schedules, and annual salaries while factoring PTO weeks and unpaid charting hours.',
    badge: 'Shift math',
    audience: 'seeker',
    icon: 'arrows',
    applicationCategory: 'FinanceApplication',
    category: 'Compensation & Offers',
  },
  {
    path: '/tools/total-comp-comparator',
    title: 'Side-by-side total compensation comparator',
    blurb:
      'Compare Offer A and Offer B across base pay, productivity bonus, sign-on clawback, PTO, CME, retirement match, and true hourly rate.',
    badge: 'Offer A vs B',
    audience: 'seeker',
    icon: 'calculator',
    applicationCategory: 'FinanceApplication',
    category: 'Compensation & Offers',
  },
  {
    path: '/tools/wrvu-calculator',
    title: `${brand.niche.short} wRVU & productivity bonus calculator`,
    blurb:
      'Model CMS CY2026 work RVUs by outpatient, hospitalist, and procedural CPT mix, conversion factor, bonus threshold, and daily break-even volume.',
    badge: 'CMS CY2026',
    audience: 'seeker',
    icon: 'activity',
    applicationCategory: 'FinanceApplication',
    category: 'Coding & Productivity',
  },
  {
    path: '/tools/em-coding-calculator',
    title: 'Outpatient E/M coding & MDM level calculator',
    blurb:
      'Side-by-side 2023+ AMA 2-of-3 Medical Decision Making matrix and Total Time encounter calculator for 99202 to 99215 with wRVU lookup.',
    badge: 'Zero PHI',
    audience: 'seeker',
    icon: 'clipboard',
    applicationCategory: 'EducationalApplication',
    category: 'Coding & Productivity',
  },
  {
    path: '/tools/prescriptive-authority-checker',
    title: `${brand.niche.short} prescriptive authority & Schedule II to V lookup`,
    blurb:
      'Check state controlled-substance rules, separate state CSR/CDS registration requirements, transition hours, and DEA telehealth rules across 51 jurisdictions.',
    badge: '51 jurisdictions',
    audience: 'seeker',
    icon: 'shield',
    applicationCategory: 'BusinessApplication',
    category: 'Licensure & Practice',
  },
  {
    path: '/tools/clinical-hours-tracker',
    title: `${brand.niche.short} student clinical hours & certification planner`,
    blurb:
      'Track MSN and DNP direct patient-care rotation hours in your browser, export CSV logs, and compare ANCC vs AANPCB certification and 5-year renewal rules.',
    badge: 'Students & CE',
    audience: 'seeker',
    icon: 'graduation',
    applicationCategory: 'EducationalApplication',
    category: 'Education & Loans',
  },
  {
    path: '/tools/travel-stipend-calculator',
    title: `Locum & travel ${brand.niche.short} GSA stipend calculator`,
    blurb:
      'Price taxed hourly base plus tax-free FY2026 GSA lodging and M&IE stipends against duplicated housing costs and a permanent W-2 salary.',
    badge: 'FY2026 GSA',
    audience: 'seeker',
    icon: 'compass',
    applicationCategory: 'FinanceApplication',
    category: 'Compensation & Offers',
  },
  {
    path: '/tools/loan-repayment-calculator',
    title: `${brand.niche.short} loan repayment & PSLF vs NHSC calculator`,
    blurb:
      'Compare 10-year net wealth across PSLF forgiveness, HRSA NHSC HPSA awards, NURSE Corps awards, and higher-paying private practice payoff.',
    badge: '10-year model',
    audience: 'seeker',
    icon: 'dollar',
    applicationCategory: 'FinanceApplication',
    category: 'Education & Loans',
  },
  {
    path: '/tools/tail-coverage-calculator',
    title: 'Malpractice tail coverage & non-compete calculator',
    blurb:
      'Estimate claims-made malpractice tail cost by policy year, review state healthcare non-compete statutes, and calculate a signing-bonus counter-ask.',
    badge: 'Contract exit',
    audience: 'seeker',
    icon: 'scale',
    applicationCategory: 'FinanceApplication',
    category: 'Licensure & Practice',
  },

  // ─── New Employer & Clinic-Owner Tools (7) ──────────────────────────
  {
    path: '/tools/job-description-generator',
    title: `${brand.niche.short} job description generator`,
    blurb:
      'Build a setting-specific job description with state pay-transparency checks, clean HTML or Markdown copy, and one-click handoff to Post a Job.',
    badge: 'For employers',
    audience: 'employer',
    icon: 'fileText',
    applicationCategory: 'BusinessApplication',
    category: 'Hiring & Compliance',
  },
  {
    path: '/tools/pay-transparency-checker',
    title: 'Job-posting pay transparency & salary-history checker',
    blurb:
      'Check 2026 to 2027 state salary-range disclosure mandates, employee headcount thresholds, remote strictest-state rules, and live state pay bands.',
    badge: '51 jurisdictions',
    audience: 'employer',
    icon: 'shield',
    applicationCategory: 'BusinessApplication',
    category: 'Hiring & Compliance',
  },
  {
    path: '/tools/cost-of-vacancy-calculator',
    title: `Unfilled ${brand.niche.short} cost-of-vacancy calculator`,
    blurb:
      'Quantify lost patient visits, foregone net collections, saved salary, and locum bridge economics across 30, 60, 90, and 120 vacancy days.',
    badge: 'CFO summary',
    audience: 'employer',
    icon: 'clock',
    applicationCategory: 'FinanceApplication',
    category: 'Clinic Economics',
  },
  {
    path: '/tools/clinic-profitability-calculator',
    title: `${brand.niche.short} hire break-even & clinic profitability modeler`,
    blurb:
      'Model completed patient visits, collections, no-show rate, collaborating physician retainer, overhead, and W-2 salary vs 1099 split margins.',
    badge: 'Clinic ROI',
    audience: 'employer',
    icon: 'dollar',
    applicationCategory: 'FinanceApplication',
    category: 'Clinic Economics',
  },
  {
    path: '/tools/incident-to-roi-calculator',
    title: 'Medicare 85% direct vs 100% incident-to billing modeler',
    blurb:
      'Compare direct NPI billing at 85% of the Medicare fee schedule against compliant 100% incident-to billing, net of physician supervision time.',
    badge: 'CMS rules',
    audience: 'employer',
    icon: 'layers',
    applicationCategory: 'FinanceApplication',
    category: 'Clinic Economics',
  },
  {
    path: '/tools/credentialing-timeline-planner',
    title: `${brand.niche.short} credentialing & payer paneling timeline planner`,
    blurb:
      'Plan backwards from your target first billable patient day across state licensure, DEA/CSR, CAQH, PECOS, commercial payers, and .ics calendar export.',
    badge: 'Go-live Gantt',
    audience: 'employer',
    icon: 'check',
    applicationCategory: 'BusinessApplication',
    category: 'Hiring & Compliance',
  },
  {
    path: '/tools/interview-scorecard-builder',
    title: `${brand.niche.short} clinical interview scorecard builder`,
    blurb:
      'Generate structured clinical interview questions and a weighted 1 to 5 candidate evaluation rubric for outpatient, urgent care, inpatient, or telehealth.',
    badge: 'Printable PDF',
    audience: 'employer',
    icon: 'sparkles',
    applicationCategory: 'BusinessApplication',
    category: 'Hiring & Compliance',
  },
];

/**
 * The registry's applicationCategory for a tool path, so a tool page's own
 * WebApplication markup and the hub's `hasPart` cannot disagree. Throws on an
 * unregistered path: a page calling it with a typo should fail its build, not
 * ship markup with no category.
 */
export function toolApplicationCategory(toolPath: string): ToolApplicationCategory {
  const tool = TOOLS.find((entry) => entry.path === toolPath);
  if (!tool) throw new Error(`No registered tool at ${toolPath}`);
  return tool.applicationCategory;
}

/** Every tool path, for sitemap and link-integrity checks. */
export const TOOL_PATHS: readonly string[] = TOOLS.map((tool) => tool.path);

/** The /tools hub itself. */
export const TOOLS_HUB_PATH = '/tools';

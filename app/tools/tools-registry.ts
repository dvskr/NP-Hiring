/**
 * Registry of the free tools shipped under /tools (P2 #4, #5, #6, #17;
 * P3 #2, #6a, #6b).
 *
 * PLAIN DATA MODULE — its only import is config/brand. Keep it that way: the
 * sitemap, the /tools hub, and the /resources tools band all read from here,
 * and the same drift-proofing that governs SALARY_SPECIALTY_SLUGS and
 * JD_TEMPLATES applies — a surface must never be able to advertise a tool path
 * the app would 404 on.
 *
 * Adding a tool: add its entry here, create app/tools/<path>/page.tsx, and add
 * the path to the sitemap's static-route list.
 */
import { brand } from '@/config/brand';

export type ToolAudience = 'seeker' | 'employer';

/**
 * Icon is resolved to a lucide component by the rendering surface.
 *
 * Adding a key requires a matching entry in the ICONS record in
 * app/tools/page.tsx — that Record is keyed by this type, so TypeScript fails
 * the build until it is added. (The /resources tools band renders one shared
 * icon for every tool and does not read this field.)
 */
export type ToolIconKey =
  | 'calculator'
  | 'scale'
  | 'clipboard'
  | 'chart'
  | 'compass'
  | 'building'
  | 'briefcase';

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
}

export const TOOLS: readonly ToolEntry[] = [
  {
    path: '/tools/1099-vs-w2-calculator',
    title: '1099 vs W-2 take-home calculator',
    blurb:
      'Price a contract rate against a salaried offer with self-employment tax, your federal bracket, business expenses, and the benefits a contractor self-funds.',
    badge: 'Calculator',
    audience: 'seeker',
    icon: 'calculator',
  },
  {
    path: '/tools/cost-of-living-comparison',
    title: 'Cost-of-living salary comparison',
    blurb:
      'Put two cities side by side: posted pay, the cost-of-living gap, and what each salary is actually worth in national-average dollars.',
    badge: 'Comparison',
    audience: 'seeker',
    icon: 'scale',
  },
  {
    path: '/tools/licensure-checker',
    title: `${brand.niche.short} licensure checker & multi-state planner`,
    blurb:
      'Practice authority, licensure steps, and live pay for any state — then line up every state you are considering side by side.',
    badge: '51 jurisdictions',
    audience: 'seeker',
    icon: 'clipboard',
  },
  {
    path: '/tools/salary-benchmark',
    title: `What should I pay a ${brand.niche.long}?`,
    blurb:
      'Median and 25th–75th percentile posted pay by state, from live listings — check a planned offer against the market before you post it.',
    badge: 'For employers',
    audience: 'employer',
    icon: 'chart',
  },
  {
    path: '/tools/specialty-finder',
    title: `${brand.niche.short} specialty finder`,
    blurb:
      'Eight questions on population, acuity, setting, autonomy, procedures, and schedule — then the specialties that match what you said you want, with live roles and pay for each.',
    badge: 'Preference sort',
    audience: 'seeker',
    icon: 'compass',
  },
  {
    path: '/tools/private-practice-revenue-calculator',
    title: 'Private practice revenue projector',
    blurb:
      'Visits, collections per visit, and overhead worked through to net before tax — plus a sensitivity table showing what a wrong assumption costs you.',
    badge: 'Illustration',
    audience: 'seeker',
    icon: 'building',
  },
  {
    path: '/tools/cost-per-hire-calculator',
    title: 'Cost-per-hire calculator',
    blurb:
      'A flat-fee posting against sponsored ads and an agency fee, on your own applicant volume and time-to-fill. Our prices are real; every other figure is yours.',
    badge: 'For employers',
    audience: 'employer',
    icon: 'briefcase',
  },
];

/** Every tool path, for sitemap and link-integrity checks. */
export const TOOL_PATHS: readonly string[] = TOOLS.map((tool) => tool.path);

/** The /tools hub itself. */
export const TOOLS_HUB_PATH = '/tools';

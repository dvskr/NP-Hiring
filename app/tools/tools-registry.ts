/**
 * Registry of the free tools shipped under /tools (P2 #4, #5, #6, #17).
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

/** Icon is resolved to a lucide component by the rendering surface. */
export type ToolIconKey = 'calculator' | 'scale' | 'clipboard' | 'chart';

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
];

/** Every tool path, for sitemap and link-integrity checks. */
export const TOOL_PATHS: readonly string[] = TOOLS.map((tool) => tool.path);

/** The /tools hub itself. */
export const TOOLS_HUB_PATH = '/tools';

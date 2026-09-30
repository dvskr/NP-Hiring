/**
 * lib/pseo/footer-category-links.ts
 *
 * The site footer's two category columns (indexing audit TECH-06, M-02,
 * fixSoon 10). The footer is on every page, so every link it carries is a
 * sitewide link: it must point at a category landing Google is allowed to
 * index, never an empty `noindex` page. The audit found three of its
 * thirteen category links (/jobs/va with "0 positions", /jobs/veterans and
 * /jobs/locum-tenens) pointing at empty noindexed landings while indexable
 * landings (the board's largest specialty, /jobs/urgent-care,
 * /jobs/part-time) had no footer link.
 *
 * The columns are chosen from ordered candidate lists by the SAME verdict
 * the primary sitemap submits a landing on: the fresh 'category-landing'
 * PseoStats row the aggregate-pseo cron writes (its stored `indexable`,
 * shouldIndexCategoryLanding over distinct postings), inside the
 * PSEO_STATS_MAX_AGE_HOURS window. A landing drops out while it has no
 * inventory and comes back on its own when it passes the gate again.
 *
 * When the verdicts cannot be read (the loader returns null), the footer
 * falls back to FOOTER_FALLBACK_SLUGS: landings with standing inventory,
 * never VA, Veterans or Locum Tenens.
 */
import { brand } from '@/config/brand';
import { PSYCH_SPECIALTY_SLUG } from './taxonomy-registry';

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

interface Candidate {
  slug: string;
  label: string;
}

const NP = brand.niche.short;

/** "urgent-care" to "Urgent Care": a label for a slug the registry names. */
function slugLabel(slug: string): string {
  return slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * The board's largest specialty, named through the registry constant so
 * the reference-niche term stays in lib/pseo/taxonomy-registry.ts.
 */
const LEAD_SPECIALTY: readonly Candidate[] = PSYCH_SPECIALTY_SLUG
  ? [{ slug: PSYCH_SPECIALTY_SLUG, label: `${slugLabel(PSYCH_SPECIALTY_SLUG)} ${NP} Jobs` }]
  : [];

/** "Browse by Setting": work settings and job types, in footer order. */
const SETTING_CANDIDATES: readonly Candidate[] = [
  { slug: 'remote', label: `Remote ${NP} Jobs` },
  { slug: 'telehealth', label: `Telehealth ${NP} Jobs` },
  { slug: 'inpatient', label: `Inpatient ${NP} Jobs` },
  { slug: 'outpatient', label: `Outpatient ${NP} Jobs` },
  { slug: 'hospital', label: `Hospital ${NP} Jobs` },
  { slug: 'urgent-care', label: `Urgent Care ${NP} Jobs` },
  { slug: 'part-time', label: `Part-Time ${NP} Jobs` },
  { slug: 'full-time', label: `Full-Time ${NP} Jobs` },
  { slug: 'travel', label: `Travel ${NP} Jobs` },
  { slug: 'home-health', label: `Home Health ${NP} Jobs` },
  { slug: 'per-diem', label: `Per Diem ${NP} Jobs` },
  { slug: 'contract', label: `Contract ${NP} Jobs` },
  { slug: 'locum-tenens', label: `Locum Tenens ${NP} Jobs` },
];

/** "Browse by Specialty": specialties, career stage and employer types, in footer order. */
const SPECIALTY_CANDIDATES: readonly Candidate[] = [
  ...LEAD_SPECIALTY,
  { slug: 'family-practice', label: `Family Practice ${NP} Jobs` },
  { slug: 'primary-care', label: `Primary Care ${NP} Jobs` },
  { slug: 'acute-care', label: `Acute Care ${NP} Jobs` },
  { slug: 'pediatric', label: `Pediatric ${NP} Jobs` },
  { slug: 'new-grad', label: `New Grad ${NP} Jobs` },
  { slug: 'emergency', label: `Emergency ${NP} Jobs` },
  { slug: 'women-health', label: `Women's Health ${NP} Jobs` },
  { slug: 'adult-gerontology', label: `Adult-Gerontology ${NP} Jobs` },
  { slug: 'community-health', label: `Community Health ${NP} Jobs` },
  { slug: 'va', label: `VA ${NP} Jobs` },
  { slug: 'veterans', label: `Veterans ${NP} Jobs` },
];

/** Links per column (the footer grid's rhythm). */
export const FOOTER_SETTING_LINKS = 7;
export const FOOTER_SPECIALTY_LINKS = 6;

/**
 * Landings the footer links when the verdicts cannot be read: the settings
 * and specialties with standing inventory that the audit found indexable
 * (M-02 swapped VA, Veterans and Locum Tenens for the lead specialty,
 * Pediatric, Urgent Care and Part-Time).
 */
export const FOOTER_FALLBACK_SLUGS: ReadonlySet<string> = new Set([
  'remote', 'telehealth', 'inpatient', 'outpatient', 'hospital', 'urgent-care', 'part-time',
  ...LEAD_SPECIALTY.map((candidate) => candidate.slug),
  'family-practice', 'primary-care', 'acute-care', 'pediatric',
]);

function pick(candidates: readonly Candidate[], allowed: ReadonlySet<string>, limit: number): FooterLink[] {
  return candidates
    .filter((candidate) => allowed.has(candidate.slug))
    .slice(0, limit)
    .map((candidate) => ({ label: candidate.label, href: `/jobs/${candidate.slug}` }));
}

/**
 * The two category columns for a set of indexable landing slugs, or for the
 * fallback set when `indexable` is null (verdicts unreadable). An empty set
 * is a real answer: no landing is indexable, so no category link is spent.
 */
export function selectFooterCategoryColumns(indexable: ReadonlySet<string> | null): FooterColumn[] {
  const allowed = indexable ?? FOOTER_FALLBACK_SLUGS;
  return [
    { title: 'Browse by Setting', links: pick(SETTING_CANDIDATES, allowed, FOOTER_SETTING_LINKS) },
    { title: 'Browse by Specialty', links: pick(SPECIALTY_CANDIDATES, allowed, FOOTER_SPECIALTY_LINKS) },
  ];
}

/** Every slug a footer category column can ever link (for the tests). */
export const FOOTER_CANDIDATE_SLUGS: readonly string[] = [
  ...SETTING_CANDIDATES.map((candidate) => candidate.slug),
  ...SPECIALTY_CANDIDATES.map((candidate) => candidate.slug),
];

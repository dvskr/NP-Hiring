/**
 * app/jobs/[slug]/job-breadcrumbs.ts
 *
 * The job page's one breadcrumb trail (indexing audit 2026-09, H-02, L-04,
 * GFJ-14). components/Breadcrumbs renders it visibly AND emits the page's
 * only BreadcrumbList, so every linked crumb must be a page that exists and
 * is indexable. Each crumb calls the target page's own index gate
 * (lib/pseo/render-gate.ts) with the same inputs, from the same facts
 * loader and scope, that the target page passes to it; no threshold is
 * copied here.
 *
 *   Home › Jobs › {State hub, if it indexes} › {City page or metro guide, if
 *   it indexes} › {this job}
 *
 * Before: the city crumb passed whenever the name round-tripped, so 25 of 31
 * sampled job pages linked (and handed Google, inside BreadcrumbList) a city
 * URL that 404s below 3 jobs, or one that 308s to its metro twin; a second
 * BreadcrumbList without the city disagreed with it on every page.
 */
import { getMetroCity } from '@/lib/metro-data';
import { getListingFacts, metroScopeWhere } from '@/lib/pseo/listing-facts';
import { shouldIndexLocalListingPage, shouldIndexMetro, shouldIndexStateHub } from '@/lib/pseo/render-gate';
import { stateHubIndexInput } from '@/lib/pseo/state-hub-index';
import { stateToSlug } from '@/lib/pseo/setting-state-config';
import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics';
import { displayText } from '@/lib/display-text';
import {
  MIN_CITY_JOBS_FOR_LINK,
  buildCitySlug,
  cityLinkResolves,
  stateBucketWhere,
} from '@/app/jobs/locations/[state]/directory';
import { stateNameForCode, toStateCode } from '@/app/jobs/[slug]/job-posting-facts';

export interface JobCrumb {
  label: string;
  /** Site-relative link; '' marks the current page (rendered unlinked). */
  href: string;
}

/**
 * The state hub crumb when /jobs/state/{slug} renders `index`, else null.
 * Same scope key, bucket and gate input the hub page builds for its robots
 * (app/jobs/state/[state]/page.tsx loadHubData and generateMetadata).
 */
export async function resolveStateCrumb(stateCode: string): Promise<JobCrumb | null> {
  const stateName = stateNameForCode(stateCode);
  if (!stateName) return null;
  const slug = stateToSlug(stateName);
  const [facts, publishable] = await Promise.all([
    getListingFacts(`state:${slug}`, stateBucketWhere(stateName, stateCode)),
    getPublishableSalaryGuideStates(),
  ]);
  if (!shouldIndexStateHub(stateHubIndexInput(stateName, facts, publishable.has(stateName)))) return null;
  return { label: displayText(stateName), href: `/jobs/state/${slug}` };
}

/**
 * The local crumb: the curated metro guide when the city is a metro slug
 * (the /jobs/city URL would 308 there), else the city page. Either only when
 * that page indexes. The city page must also clear its render floor
 * (MIN_CITY_JOBS_FOR_LINK, drift-guarded against the page's MIN_JOBS) and
 * resolve the slug back to this city's name (cityLinkResolves).
 */
export async function resolveLocalCrumb(city: string, stateCode: string): Promise<JobCrumb | null> {
  const cityName = city.trim();
  const slug = buildCitySlug(cityName, stateCode);
  if (!slug) return null;

  const metro = getMetroCity(slug);
  if (metro) {
    // app/jobs/metro/[slug]/page.tsx getMetroFacts and its robots call.
    const facts = await getListingFacts(`metro:${metro.slug}`, metroScopeWhere(metro));
    if (!shouldIndexMetro({ activeJobs: facts.distinctPostings, postedLast30Days: facts.recency.last30 })) return null;
    return { label: displayText(metro.city), href: `/jobs/metro/${metro.slug}` };
  }

  if (!cityLinkResolves(cityName, stateCode)) return null;
  const stateName = stateNameForCode(stateCode);
  if (!stateName) return null;
  // The bucket and scope key app/jobs/city/[slug]/page.tsx builds for the
  // same slug (getCityFacts), so the verdict is that page's own.
  const facts = await getListingFacts(`city:${stateCode}:${cityName}`.toLowerCase(), {
    city: { equals: cityName, mode: 'insensitive' },
    OR: [{ state: stateName }, { stateCode }],
  });
  if (facts.total < MIN_CITY_JOBS_FOR_LINK) return null;
  if (!shouldIndexLocalListingPage({ activeJobs: facts.distinctPostings, distinctEmployers: facts.distinctEmployers })) {
    return null;
  }
  return { label: displayText(cityName), href: `/jobs/city/${slug}` };
}

/**
 * Verdicts are memoised per target page for a few minutes inside a warm
 * server instance. A first crawl renders hundreds of job pages at once, and
 * they share about 50 state hubs and a few hundred cities; without the memo
 * each render would re-read the state's listing facts and the salary pool.
 * The pending promise is stored, so concurrent renders share one lookup. A
 * failed lookup is evicted at once so the next render retries.
 */
const CRUMB_MEMO_TTL_MS = 10 * 60 * 1000;
const CRUMB_MEMO_MAX_ENTRIES = 2000;
const crumbMemo = new Map<string, { at: number; value: Promise<JobCrumb | null> }>();

function memoCrumb(key: string, lookup: () => Promise<JobCrumb | null>): Promise<JobCrumb | null> {
  const now = Date.now();
  const hit = crumbMemo.get(key);
  if (hit && now - hit.at < CRUMB_MEMO_TTL_MS) return hit.value;
  if (crumbMemo.size >= CRUMB_MEMO_MAX_ENTRIES) crumbMemo.clear();
  const value = lookup();
  crumbMemo.set(key, { at: now, value });
  value.catch(() => crumbMemo.delete(key));
  return value;
}

/** Test hook: forget every memoised verdict. */
export function clearJobCrumbMemo(): void {
  crumbMemo.clear();
}

/** A crumb lookup that fails closed: a database error drops the crumb, never the page. */
async function settle(label: string, lookup: () => Promise<JobCrumb | null>): Promise<JobCrumb | null> {
  try {
    return await lookup();
  } catch (error) {
    console.error(`[job-breadcrumbs] ${label} gate failed; the crumb is omitted`, error);
    return null;
  }
}

/**
 * The trail for one job. A job without a state code gets no local crumb:
 * the old no-state fallback built city-only slugs (/jobs/city/newport-hospital)
 * that 404.
 */
export async function buildJobBreadcrumbs(
  job: { city: string | null; state: string | null; stateCode: string | null },
  currentLabel: string,
): Promise<JobCrumb[]> {
  const stateCode = toStateCode(job.stateCode) ?? toStateCode(job.state);
  const city = job.city?.trim() ?? '';
  const [stateCrumb, localCrumb] = await Promise.all([
    stateCode
      ? settle('state hub', () => memoCrumb(`state:${stateCode}`, () => resolveStateCrumb(stateCode)))
      : Promise.resolve(null),
    stateCode && city
      ? settle('city', () => memoCrumb(`city:${stateCode}:${city}`, () => resolveLocalCrumb(city, stateCode)))
      : Promise.resolve(null),
  ]);
  return [
    { label: 'Home', href: '/' },
    { label: 'Jobs', href: '/jobs' },
    ...(stateCrumb ? [stateCrumb] : []),
    ...(localCrumb ? [localCrumb] : []),
    { label: currentLabel, href: '' },
  ];
}

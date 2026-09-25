import { cache } from 'react';
import type { Prisma } from '@prisma/client';
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowRight, Bell, BookOpen, Building2, Compass, DollarSign, MapPin, MapPinned } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import Breadcrumbs from '@/components/Breadcrumbs';
import StateImage from '@/components/StateImage';
import CategoryFAQAccordion from '@/components/CategoryFAQAccordion';
import {
  ClayCard,
  ClayStyles,
  EmployerRoster,
  PostedPay,
  clayDesc,
  clayLink,
  clayList,
  clayRow,
  clayTile,
  employerSentence,
  faqPageJsonLd,
  postedPaySentence,
} from '@/components/seo/pseo';
import type { BenchmarkRow } from '@/components/tools/benchmark-model';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { formatCount } from '@/lib/display-text';
import { getMetroCity, getMetrosInState, type MetroCity } from '@/lib/metro-data';
import { getCityByNameState } from '@/lib/pseo/city-data/cities';
import { getListingFacts, LISTING_FACTS_ROW_CAP, metroScopeWhere, type ListingFacts } from '@/lib/pseo/listing-facts';
import {
  buildCityCardHiringLine,
  buildCityCardPayLine,
  buildDirectoryDescription,
  buildDirectoryFaqs,
  buildDirectoryHowToUse,
  buildDirectoryTitle,
  buildMetroAreaSentence,
  buildMetroGuideLine,
  buildNearbyDirectoriesSentence,
  buildTerseWorkModeLine,
  type NamedCount,
} from '@/lib/pseo/listing-narrative';
import { getNeighboringStates } from '@/lib/pseo/neighboring-states';
import { shouldIndexStateCityDirectory } from '@/lib/pseo/render-gate';
import { resolveStateSlug, stateToSlug, STATE_CODES } from '@/lib/pseo/setting-state-config';
import { getGatedCitySalaries, type GatedSalary } from '@/lib/salary-analytics';
import { getStatePracticeAuthority } from '@/lib/state-practice-authority';
import {
  activeJobsInStateWhere,
  buildCitySlug,
  buildStateCityDirectory,
  cityLinkResolves,
  getStatesWithCityDirectory,
  isDistrictOfColumbia,
  selectCityDetails,
  shouldRenderStateCityDirectory,
  stateBucketWhere,
  MIN_CITY_JOBS_FOR_LINK,
  type CityDetail,
  type CityDetailRow,
  type CityJobRow,
  type StateCityDirectory,
  type StateCityDirectorySummary,
} from './directory';

export const revalidate = 3600; // ISR: revalidate every hour

/**
 * P2 #12 and thin-content DIR-L1 to L8: the per-state city directory.
 *
 * 4,135 city records ship in lib/pseo/city-data/cities.ts and app/sitemap.ts
 * submits every city page with 3 or more active jobs, but the only city
 * links on the whole site were the top 12 tiles on /jobs/locations. These
 * pages are the missing tier between the locations hub and the individual
 * city pages.
 *
 * Every city listed here is gated on LIVE canonical inventory:
 *   MIN_CITY_JOBS_FOR_LINK or more active jobs: linked
 *   1 to 2 active jobs: named with its real count, NOT linked (its city page
 *   404s by design)
 *   0 active jobs: omitted entirely
 *
 * Robots: shouldIndexStateCityDirectory (3 or more linkable cities), the same
 * function app/sitemap.ts reads, so a sitemap URL is never a noindex page.
 * A directory that renders but does not index keeps its self canonical and
 * `follow`.
 */

interface StateDirectoryPageProps {
  params: Promise<{ state: string }>;
}

interface CityAggregate {
  city: string;
  count: number;
}

interface StateDirectoryData {
  stateName: string;
  stateCode: string;
  directory: StateCityDirectory;
  /** DIR-L2 and DIR-L4 lines per city, keyed by the trimmed city spelling. */
  cityDetails: Map<string, CityDetail>;
}

/** DIR-L1: at most this many metro-area sentences. */
const MAX_METRO_AREA_GROUPS = 4;
/** DIR-L6: at most this many nearby directory links. */
const MAX_NEARBY_DIRECTORIES = 4;

/** Escaped with the repo's \u003c chain (pattern: app/companies/[slug]/page.tsx). */
const jsonLd = (obj: unknown): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

// P7 runtime fix D3: an empty generateStaticParams, NOT its absence, is
// what makes this route on-demand ISR. The previous "No generateStaticParams"
// comment assumed `revalidate` alone was enough; in reality a dynamic segment
// without the export renders fully dynamically on every request. Returning []
// keeps the original goal intact: nothing prerenders at build (the directory
// aggregate never runs 51 times for the surviving pages), while the first hit
// per state renders and caches until `revalidate` expires. Full rationale in
// app/jobs/[slug]/page.tsx; guarded by
// tests/regressions/p7-runtime-isr-static-params.test.ts.
export function generateStaticParams(): Array<{ state: string }> {
  return [];
}

/**
 * The minimal per-row select behind the city cards (DIR-L2 employers,
 * DIR-L4 work mode). Decorative context: a failure logs and comes back
 * empty so the cards simply omit their lines.
 */
async function fetchCityDetailRows(inState: Prisma.JobWhereInput): Promise<CityDetailRow[]> {
  try {
    return await prisma.job.findMany({
      where: { ...inState, city: { not: null } },
      select: { city: true, employer: true, isRemote: true, isHybrid: true },
      orderBy: { createdAt: 'desc' },
      take: LISTING_FACTS_ROW_CAP,
    });
  } catch (error) {
    console.error('[state-city-directory] city detail rows failed:', error);
    return [];
  }
}

/**
 * `cache` dedupes the aggregates between generateMetadata and the render:
 * Next.js calls both per request, so without it every one of these pages
 * ran its queries twice (pattern: app/companies/page.tsx).
 */
const getStateDirectory = cache(async (stateName: string, stateCode: string): Promise<StateDirectoryData> => {
  // The canonical predicate (PLAN T0-1): published, unexpired, not a dead
  // apply link, and past the profession quarantine. Same predicate as
  // app/sitemap.ts and the locations hub, so a linked city clears the city
  // page's own gate and a listed directory never 404s.
  //
  // Built by activeJobsInStateWhere, which nests the state match under `AND`.
  // The obvious `{ ...activeIndexableJobWhere(), OR: [...] }` is a trap: the
  // helper's own top-level `OR` IS the expiry pair, so a sibling `OR` key
  // overwrites it and every "live" number on this page counts expired rows.
  const inState = activeJobsInStateWhere(stateName, stateCode);

  // The city count is the only query allowed to throw: a database error
  // surfaces as a 5xx instead of a page that claims zero inventory.
  const [cityRows, detailRows] = await Promise.all([
    prisma.job.groupBy({
      by: ['city'],
      where: { ...inState, city: { not: null } },
      _count: { city: true },
    }),
    fetchCityDetailRows(inState),
  ]);

  const aggregates: CityAggregate[] = cityRows
    .filter((row) => row.city !== null && row.city.trim().length > 0)
    .map((row) => ({
      city: row.city as string,
      count: row._count.city,
    }));

  return {
    stateName,
    stateCode,
    directory: buildStateCityDirectory(aggregates, {
      // A city whose stored name does not survive the city route's slug parser
      // is named but never linked: the link would resolve to zero jobs and
      // 404. See cityLinkResolves.
      canLink: (row) => cityLinkResolves(row.city, stateCode),
    }),
    cityDetails: selectCityDetails(detailRows),
  };
});

/**
 * Statewide facts (total, distinct employers, top employers, the gated
 * benchmark) over the same state bucket; getListingFacts composes the
 * canonical predicate and caches on the scope key.
 */
function getDirectoryFacts(stateName: string, stateCode: string): Promise<ListingFacts> {
  return getListingFacts(`directory:${stateToSlug(stateName)}`, stateBucketWhere(stateName, stateCode));
}

/** DIR-L3: per-city gated medians; a failure yields no figure, never a mean. */
const getCitySalaries = cache(async (stateName: string): Promise<Map<string, GatedSalary>> => {
  try {
    return await getGatedCitySalaries(stateName);
  } catch (error) {
    console.error('[state-city-directory] city salaries failed:', error);
    return new Map();
  }
});

interface MetroGuideRow {
  metro: MetroCity;
  /** Canonical jobs inside metroScopeWhere, or null when the count failed. */
  count: number | null;
}

/** DIR-L7: the curated metro guides in the state with their live metro counts. */
const getMetroGuides = cache(async (stateName: string): Promise<MetroGuideRow[]> => {
  return Promise.all(
    getMetrosInState(stateName).map(async (metro): Promise<MetroGuideRow> => {
      try {
        const count = await prisma.job.count({ where: canonicalBucketWhere(metroScopeWhere(metro)) });
        return { metro, count };
      } catch (error) {
        console.error(`[state-city-directory] metro count failed for ${metro.slug}:`, error);
        return { metro, count: null };
      }
    }),
  );
});

export async function generateMetadata({ params }: StateDirectoryPageProps): Promise<Metadata> {
  const { state } = await params;
  const stateName = resolveStateSlug(state);
  if (!stateName) {
    return { title: `${brand.niche.short} Jobs by City`, robots: { index: false, follow: true } };
  }

  const stateCode = STATE_CODES[stateName];
  const data = await getStateDirectory(stateName, stateCode);
  const canonical = `${brand.baseUrl}/jobs/locations/${stateToSlug(stateName)}`;

  if (!shouldRenderStateCityDirectory(data.directory)) {
    // The page 404s; keep the metadata honest in case anything reads it first.
    return {
      title: `${brand.niche.short} Jobs by City in ${stateName}`,
      robots: { index: false, follow: true },
      alternates: { canonical },
    };
  }

  const facts = await getDirectoryFacts(stateName, stateCode);
  const { trackedCities } = data.directory;
  // DIR-defect3: the title, the description and the stat tile all count the
  // same thing (tracked cities), never the linkable subset.
  const title = buildDirectoryTitle({ stateName, trackedCities });
  const description = buildDirectoryDescription({
    stateName,
    totalStateJobs: facts.total,
    trackedCities,
    leadCities: data.directory.linkable.slice(0, 2).map((c) => c.city),
  });
  const ogTitle = `${brand.niche.short} Jobs by City in ${stateName}`;
  const indexable = shouldIndexStateCityDirectory({ linkableCities: data.directory.linkable.length });

  return {
    title,
    description,
    robots: { index: indexable, follow: true },
    openGraph: {
      title: ogTitle,
      description: `Browse ${brand.niche.descriptor} openings in ${formatCount(trackedCities, `${stateName} city`, `${stateName} cities`)}.`,
      url: canonical,
      type: 'website',
      siteName: brand.name,
      images: [{
        url: `${brand.baseUrl}/api/og?type=page&title=${encodeURIComponent(ogTitle)}&subtitle=${encodeURIComponent(`${formatCount(trackedCities, 'city', 'cities')} hiring now`)}`,
        width: 1200,
        height: 630,
        alt: `${brand.niche.short} jobs by city in ${stateName}`,
      }],
    },
    twitter: { card: 'summary_large_image' },
    alternates: { canonical },
  };
}

/* ─── Clay tokens (match app/jobs/locations/page.tsx) ─── */
const clayCard: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '20px',
  border: '1px solid rgba(255,255,255,0.5)',
  boxShadow:
    '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

const statTile: React.CSSProperties = {
  padding: '14px 18px',
  borderRadius: '16px',
  background: '#F9F7F1',
  border: '1px solid #EAE6DF',
  boxShadow: 'inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5)',
  minWidth: '120px',
};

const statValue: React.CSSProperties = { fontSize: '24px', fontWeight: 800, color: '#BE185D', lineHeight: 1.1 };
const statLabel: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#7A6A62',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const sectionEyebrow: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#BE185D',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  margin: '0 0 6px',
};
const sectionHeading: React.CSSProperties = {
  fontSize: 'clamp(19px, 3vw, 24px)',
  fontWeight: 800,
  fontFamily: 'var(--font-lora, Georgia, serif)',
  color: '#1A2E35',
  margin: 0,
};
const cardLine: React.CSSProperties = { fontSize: '12px', color: '#5A4A42', margin: '0 0 8px', lineHeight: 1.5 };

/** The gated per-city figure as the narrative's BenchmarkRow, or null below the gate. */
function gatedCityBenchmark(city: string, salary: GatedSalary | undefined): BenchmarkRow | null {
  if (!salary || !salary.gatePassed || salary.median === null || salary.p25 === null || salary.p75 === null) return null;
  return {
    scope: city,
    median: salary.median,
    p25: salary.p25,
    p75: salary.p75,
    postings: salary.postings,
    employers: salary.employers,
  };
}

interface MetroAreaGroup {
  metroArea: string;
  cities: NamedCount[];
  total: number;
  /** The curated metro guide of the group's principal city, when one exists. */
  guide: { href: string; city: string } | null;
}

function byCountThenName(a: NamedCount, b: NamedCount): number {
  return b.count - a.count || a.name.localeCompare(b.name);
}

/**
 * DIR-L1: tracked cities grouped by the dataset's metroArea (the one repaired,
 * safe-to-print field of lib/pseo/city-data), keeping areas that two or more
 * tracked cities share, ordered by combined count.
 */
function groupCitiesByMetroArea(rows: readonly CityJobRow[], stateCode: string): MetroAreaGroup[] {
  const groups = new Map<string, NamedCount[]>();
  for (const row of rows) {
    const metroArea = getCityByNameState(row.city, stateCode)?.metroArea;
    if (!metroArea) continue;
    groups.set(metroArea, [...(groups.get(metroArea) ?? []), { name: row.city, count: row.count }]);
  }
  return [...groups.entries()]
    .filter(([, cities]) => cities.length >= 2)
    .map(([metroArea, cities]): MetroAreaGroup => {
      const sorted = [...cities].sort(byCountThenName);
      const metro = getMetroCity(buildCitySlug(sorted[0].name, stateCode));
      return {
        metroArea,
        cities: sorted,
        total: sorted.reduce((sum, c) => sum + c.count, 0),
        guide: metro ? { href: `/jobs/metro/${metro.slug}`, city: metro.city } : null,
      };
    })
    .sort((a, b) => b.total - a.total || a.metroArea.localeCompare(b.metroArea))
    .slice(0, MAX_METRO_AREA_GROUPS);
}

/** DIR-L6: neighbors (nearby, never "bordering") whose own directory renders. */
function selectNearbyDirectories(
  stateName: string,
  directories: ReadonlyMap<string, StateCityDirectorySummary>,
): StateCityDirectorySummary[] {
  return getNeighboringStates(stateName)
    .flatMap((name) => {
      const summary = directories.get(name);
      return summary ? [summary] : [];
    })
    .sort((a, b) => b.trackedCities - a.trackedCities || a.name.localeCompare(b.name))
    .slice(0, MAX_NEARBY_DIRECTORIES);
}

/** DIR-L7 link text: the count only above zero, never a padded "0 open roles". */
function metroGuideLabel(row: MetroGuideRow): string {
  return row.count !== null && row.count >= 1
    ? buildMetroGuideLine({ city: row.metro.city, count: row.count })
    : `${row.metro.city} metro guide`;
}

export default async function StateCityDirectoryPage({ params }: StateDirectoryPageProps) {
  const { state } = await params;
  const stateName = resolveStateSlug(state);
  if (!stateName) notFound();

  // `resolveStateSlug` also accepts the two-letter code ("/jobs/locations/il"),
  // so consolidate those onto the canonical name slug with a 308 rather than
  // serving the same directory on two URLs.
  const canonicalSlug = stateToSlug(stateName);
  if (state !== canonicalSlug) permanentRedirect(`/jobs/locations/${canonicalSlug}`);

  const stateCode = STATE_CODES[stateName];
  const data = await getStateDirectory(stateName, stateCode);
  const { directory } = data;

  // Thin-directory gate: same predicate the hub uses to decide whether to
  // link here, so the hub can never point at a 404.
  if (!shouldRenderStateCityDirectory(directory)) notFound();

  const [facts, citySalaries, directories, metroGuides] = await Promise.all([
    getDirectoryFacts(stateName, stateCode),
    getCitySalaries(stateName),
    getStatesWithCityDirectory(),
    getMetroGuides(stateName),
  ]);

  const authority = getStatePracticeAuthority(stateName);
  // The District of Columbia has a directory like any state but is not one:
  // every word below that names the jurisdiction's kind says so.
  const isDistrict = isDistrictOfColumbia(stateName);
  const canonicalPath = `/jobs/locations/${canonicalSlug}`;
  const howToUse = buildDirectoryHowToUse(MIN_CITY_JOBS_FOR_LINK);

  const linkedCities = directory.linkable.map((row) => {
    const slug = buildCitySlug(row.city, stateCode);
    const metro = getMetroCity(slug);
    const record = getCityByNameState(row.city, stateCode);
    const detail = data.cityDetails.get(row.city.trim());
    return {
      name: row.city,
      count: row.count,
      // Curated metro pages take priority over the generic city page: the
      // city route 308s to them anyway (app/jobs/city/[slug]/page.tsx), so
      // link the destination directly instead of burning a redirect hop.
      href: metro ? `/jobs/metro/${slug}` : `/jobs/city/${slug}`,
      isMetroGuide: Boolean(metro),
      // Only the repaired, provably-correct field from the city dataset. The
      // rest of that record was keyed by city name alone across states and is
      // not safe to print (lib/pseo/city-data/types.ts).
      metroArea: record?.metroArea ?? null,
      // DIR-L2: named employers at 2 or more, else nothing.
      hiringLine: buildCityCardHiringLine(detail?.employers ?? []),
      // DIR-L4: the split only when two modes are present; zero parts omitted.
      workModeLine: detail?.workMode ? buildTerseWorkModeLine(detail.workMode, MIN_CITY_JOBS_FOR_LINK) : null,
      // DIR-L3: the gated median only; below the gate the card says nothing about pay.
      payLine: buildCityCardPayLine(gatedCityBenchmark(row.city, citySalaries.get(row.city.trim()))),
    };
  });

  const metroAreaGroups = groupCitiesByMetroArea([...directory.linkable, ...directory.emerging], stateCode);
  const nearbyDirectories = selectNearbyDirectories(stateName, directories);
  const nearbySentence = buildNearbyDirectoriesSentence(
    nearbyDirectories.map((d) => ({ name: d.name, cities: d.trackedCities })),
  );
  const statewideRosterRenders = employerSentence({ kind: 'statewide', stateName }, facts) !== null;
  const statewidePayRenders = postedPaySentence({ kind: 'location', scopeName: stateName, scopeNoun: 'state' }, facts) !== null;
  const acrossStateRenders =
    metroAreaGroups.length > 0 || statewideRosterRenders || statewidePayRenders || nearbySentence !== null || metroGuides.length > 0;

  // DIR-L8: one array feeds the visible accordion and the FAQPage node.
  const rankedCities: NamedCount[] = [...directory.linkable, ...directory.emerging]
    .map((row) => ({ name: row.city, count: row.count }))
    .sort(byCountThenName);
  const faqs = buildDirectoryFaqs({ stateName, cities: rankedCities, facts, minCityJobs: MIN_CITY_JOBS_FOR_LINK });
  const faqSchema = faqPageJsonLd(faqs);

  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${brand.niche.short} Jobs by City in ${stateName}`,
    description: `Cities in ${stateName} with active ${brand.niche.descriptor} openings on ${brand.name}.`,
    url: `${brand.baseUrl}${canonicalPath}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: linkedCities.length,
      // Derived from the SAME array the cards render.
      itemListElement: linkedCities.map((city, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: `${brand.niche.short} Jobs in ${city.name}, ${stateCode}`,
        url: `${brand.baseUrl}${city.href}`,
      })),
    },
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDFBF7' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionSchema) }} />
      {faqSchema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqSchema }} />}

      <div className="container mx-auto px-4 py-6 md:py-10">
        <div className="max-w-5xl mx-auto">
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'Jobs', href: '/jobs' },
              { label: 'Locations', href: '/jobs/locations' },
              { label: stateName },
            ]}
          />

          {/* ═══ Header ═══ */}
          <header style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap', margin: '20px 0 28px' }}>
            <div
              style={{
                width: '96px',
                height: '96px',
                borderRadius: '22px',
                overflow: 'hidden',
                flexShrink: 0,
                boxShadow: 'inset 3px 3px 8px rgba(255,255,255,0.25), 0 6px 18px rgba(0,0,0,0.10)',
              }}
            >
              <StateImage
                slug={canonicalSlug}
                alt={`${stateName} ${brand.niche.short} jobs`}
                width={96}
                height={96}
                sizes="96px"
                priority
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: '260px' }}>
              <p style={sectionEyebrow}>
                City directory
              </p>
              <h1
                className="font-lora"
                style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px', lineHeight: 1.15 }}
              >
                {brand.niche.short} Jobs by City in {stateName}
              </h1>
              <p style={{ fontSize: '15px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                Every {stateName} city currently carrying {brand.niche.descriptor} openings, ranked by how many
                roles are live right now.
              </p>
            </div>
          </header>

          {/* ═══ Live stat row: all four numbers are live canonical aggregates ═══ */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '32px' }}>
            <div style={statTile}>
              <div style={statValue}>{facts.total}</div>
              <div style={statLabel}>Open roles</div>
            </div>
            <div style={statTile}>
              <div style={statValue}>{directory.trackedCities}</div>
              <div style={statLabel}>Cities hiring</div>
            </div>
            <div style={statTile}>
              <div style={statValue}>{linkedCities.length}</div>
              <div style={statLabel}>
                {/* Cities that clear the threshold AND resolve to a real city
                    page; not every city at the floor has a linkable slug. */}
                City pages linked
              </div>
            </div>
            <div style={statTile}>
              <div style={statValue}>{facts.distinctEmployers}</div>
              <div style={statLabel}>Employers</div>
            </div>
          </div>

          {/* ═══ Orientation prose: live aggregates, the authority label and the DIR-L5 how-to ═══ */}
          <div style={{ ...clayCard, padding: '24px', marginBottom: '32px' }}>
            <p style={{ fontSize: '15px', color: '#3D3530', lineHeight: 1.75, margin: 0 }}>
              {stateName} currently has <strong>{formatCount(facts.total, `active ${brand.niche.short} posting`)}</strong>{' '}
              from {formatCount(facts.distinctEmployers, 'employer')}, spread across{' '}
              {formatCount(directory.trackedCities, 'city', 'cities')}.{' '}
              {/* Ranked over linkable AND emerging, the same combined order the
                  DIR-L8 FAQ answers from, so the two can never name different
                  leaders. A city can clear the count floor yet fail
                  cityLinkResolves and land in emerging with its real count. */}
              {rankedCities.length > 0 && (
                <>
                  {rankedCities[0].name} leads with {formatCount(rankedCities[0].count, 'opening')}.{' '}
                </>
              )}
              {/* Only the authority LABEL is reused here. The long `details`
                  prose already renders verbatim on /jobs/state/<state>, so
                  repeating it would make these two URLs near-duplicates. */}
              {authority && (
                <>
                  {stateName} is a <strong>{authority.description}</strong> {isDistrict ? 'jurisdiction' : 'state'}, which shapes how much
                  supervision a role in any of these cities carries.{' '}
                </>
              )}
              {howToUse}
            </p>
          </div>

          {/* ═══ Linked cities ═══ */}
          <section style={{ marginBottom: '40px' }} aria-labelledby="linked-cities-heading">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <MapPin className="h-5 w-5" style={{ color: '#BE185D' }} aria-hidden="true" />
              <h2 id="linked-cities-heading" style={sectionHeading}>
                Cities with {MIN_CITY_JOBS_FOR_LINK} or more open roles
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {linkedCities.map((city) => (
                <Link key={city.href} href={city.href} className="group" style={{ textDecoration: 'none' }}>
                  <div className="h-full transition-all duration-200 group-hover:-translate-y-1" style={{ ...clayCard, padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0, lineHeight: 1.25 }}>
                        {city.name}
                      </h3>
                      <span style={{ fontSize: '20px', fontWeight: 800, color: '#BE185D', lineHeight: 1 }}>
                        {city.count}
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#7A6A62', margin: '0 0 10px' }}>
                      {city.count === 1 ? 'open role' : 'open roles'}
                      {city.metroArea ? `, ${city.metroArea} metro area` : ''}
                    </p>
                    {city.hiringLine && <p style={cardLine}>{city.hiringLine}</p>}
                    {city.workModeLine && <p style={cardLine}>{city.workModeLine}</p>}
                    {city.payLine && (
                      <p style={{ ...cardLine, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
                        {city.payLine}
                      </p>
                    )}
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#BE185D', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      {city.isMetroGuide ? 'Read metro guide' : 'View jobs'}
                      <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {/* ═══ Sub-threshold cities: named, never linked ═══ */}
          {directory.emerging.length > 0 && (
            <section style={{ marginBottom: '40px' }} aria-labelledby="also-hiring-heading">
              <h2 id="also-hiring-heading" style={{ ...sectionHeading, fontSize: 'clamp(17px, 2.6vw, 20px)', margin: '0 0 12px' }}>
                Also hiring in {stateName}
              </h2>
              <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', listStyle: 'none', padding: 0, margin: 0 }}>
                {directory.emerging.map((row) => (
                  <li
                    key={row.city}
                    style={{
                      padding: '7px 13px',
                      borderRadius: '12px',
                      background: '#F5F0EB',
                      border: '1px solid rgba(90,74,66,0.08)',
                      fontSize: '13px',
                      color: '#5A4A42',
                    }}
                  >
                    {row.city}{' '}
                    <span style={{ fontWeight: 700, color: '#7A6A62' }}>
                      {row.count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ═══ Across the state (DIR-L1, L2, L3, L6, L7) ═══ */}
          {acrossStateRenders && (
            <section style={{ marginBottom: '40px' }} aria-labelledby="across-state-heading">
              <ClayStyles />
              <div style={{ marginBottom: '20px' }}>
                <p style={sectionEyebrow}>{isDistrict ? 'Districtwide' : 'Statewide'}</p>
                <h2 id="across-state-heading" style={sectionHeading}>
                  Across {stateName}
                </h2>
              </div>
              <div className="pseo-clay-grid pseo-clay-cols-2">
                {metroAreaGroups.length > 0 && (
                  <ClayCard chip="Metro areas" title={`Metro areas in ${stateName}`} icon={MapPinned} index={0}>
                    <ul style={clayList}>
                      {metroAreaGroups.map((group, i) => (
                        <li key={group.metroArea} style={{ ...clayRow(i === metroAreaGroups.length - 1), display: 'block' }}>
                          <p style={clayDesc}>{buildMetroAreaSentence({ metroArea: group.metroArea, cities: group.cities })}</p>
                          {group.guide && (
                            <Link href={group.guide.href} style={{ ...clayLink, fontSize: '13px' }}>
                              Read the {group.guide.city} metro guide
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </ClayCard>
                )}
                <EmployerRoster
                  variant={{ kind: 'statewide', stateName }}
                  facts={facts}
                  title={`Who is hiring across ${stateName}`}
                  index={1}
                />
                <PostedPay
                  variant={{ kind: 'location', scopeName: stateName, scopeNoun: 'state' }}
                  facts={facts}
                  title={`Posted pay in ${stateName}`}
                  // The salary guide renders at 1 or more active jobs; a
                  // directory only renders at 3 or more tracked cities.
                  salaryGuide={{ href: `/salary-guide/${canonicalSlug}`, label: `${stateName} salary guide`, renders: true }}
                  index={2}
                />
                {/* "Nearby directories", not "state directories": Maryland
                    and Virginia list the District of Columbia among theirs. */}
                {nearbySentence && (
                  <ClayCard chip="Nearby" title="Nearby directories" icon={Compass} index={3} desc={nearbySentence}>
                    {/* The sentence above already carries each neighbour's city
                        count, so the tiles are navigation only: printing the
                        same figure twice on one card is boilerplate. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '16px' }}>
                      {nearbyDirectories.map((entry) => (
                        <Link key={entry.slug} href={`/jobs/locations/${entry.slug}`} className="pseo-clay-tile pseo-clay-lift" style={clayTile}>
                          <span>{entry.name}</span>
                        </Link>
                      ))}
                    </div>
                  </ClayCard>
                )}
                {metroGuides.length > 0 && (
                  <ClayCard chip="Metro guides" title={`Metro guides in ${stateName}`} icon={BookOpen} index={0}>
                    <ul style={clayList}>
                      {metroGuides.map((row, i) => (
                        <li key={row.metro.slug} style={clayRow(i === metroGuides.length - 1)}>
                          <Link href={`/jobs/metro/${row.metro.slug}`} style={clayLink}>
                            {metroGuideLabel(row)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </ClayCard>
                )}
              </div>
            </section>
          )}

          {/* ═══ FAQ (DIR-L8): answers in the server HTML, schema from the same array ═══ */}
          {faqs.length > 0 && (
            <section style={{ marginBottom: '40px' }} aria-labelledby="directory-faq-heading">
              <div style={{ marginBottom: '20px' }}>
                <p style={sectionEyebrow}>FAQ</p>
                <h2 id="directory-faq-heading" style={sectionHeading}>
                  Questions about {stateName} cities
                </h2>
              </div>
              <CategoryFAQAccordion faqs={faqs} />
            </section>
          )}

          {/* ═══ Continue ═══ */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ marginBottom: '16px' }}>
            <Link href={`/jobs/state/${canonicalSlug}`} className="group" style={{ textDecoration: 'none' }}>
              <div className="h-full transition-all duration-200 group-hover:-translate-y-1" style={{ ...clayCard, padding: '20px' }}>
                <Building2 className="h-5 w-5 mb-2" style={{ color: '#BE185D' }} aria-hidden="true" />
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 4px' }}>
                  All {stateName} {brand.niche.short} jobs
                </h3>
                <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  The {isDistrict ? 'districtwide' : 'statewide'} feed, including remote roles open to {stateName} licensees.
                </p>
              </div>
            </Link>
            <Link href={`/salary-guide/${canonicalSlug}`} className="group" style={{ textDecoration: 'none' }}>
              <div className="h-full transition-all duration-200 group-hover:-translate-y-1" style={{ ...clayCard, padding: '20px' }}>
                <DollarSign className="h-5 w-5 mb-2" style={{ color: '#BE185D' }} aria-hidden="true" />
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 4px' }}>
                  {stateName} salary guide
                </h3>
                <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  What {stateName} employers are posting, by experience and setting.
                </p>
              </div>
            </Link>
            <Link href="/job-alerts" className="group" style={{ textDecoration: 'none' }}>
              <div className="h-full transition-all duration-200 group-hover:-translate-y-1" style={{ ...clayCard, padding: '20px' }}>
                <Bell className="h-5 w-5 mb-2" style={{ color: '#BE185D' }} aria-hidden="true" />
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 4px' }}>
                  Alert me for {stateName}
                </h3>
                <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  Get new {stateName} postings by email as they are indexed.
                </p>
              </div>
            </Link>
          </section>

          <p style={{ fontSize: '13px', color: '#7A6A62', lineHeight: 1.6 }}>
            Looking somewhere else?{' '}
            {/* The destination lists the states and cities that currently carry
                inventory, so the label names it without claiming its size. */}
            <Link href="/jobs/locations" style={{ color: '#BE185D', fontWeight: 700 }}>
              Browse states and cities
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

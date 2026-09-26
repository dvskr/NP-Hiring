import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { MapPin, MapPinned } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { METRO_CITIES } from '@/lib/metro-data';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import CategoryHero, { crumbsFromSchema } from '@/components/CategoryHero';
import StateImage from '@/components/StateImage';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { formatCount, joinWithAnd, pluralize } from '@/lib/display-text';
import { NAV_ICONS, SHARED_ART, type Art } from '@/lib/pseo/category-asset-registry';
import { HUB_REMOTE_LICENSURE_NOTE } from '@/lib/pseo/listing-narrative';
import { STATE_CODES, stateToSlug } from '@/lib/pseo/setting-state-config';
import {
  buildCitySlug,
  buildStateCityDirectory,
  cityLinkResolves,
  countJobsByJurisdiction,
  shouldRenderStateCityDirectory,
  MIN_CITY_JOBS_FOR_LINK,
} from './[state]/directory';


// force-dynamic removed: it overrides revalidate and defeats ISR caching
export const revalidate = 3600; // Revalidate every hour

/**
 * The 50 states and the District of Columbia, from the one STATE_CODES
 * table the state hubs and directories resolve against. DC used to be
 * missing from a hand-typed list here, so its tile and its city directory
 * never appeared although both pages render (lib/state-practice-authority.ts
 * carries it as its own jurisdiction). Also keeps non-US groupings such as
 * "British Columbia" out of the cities-hiring stat.
 */
const US_STATES: ReadonlySet<string> = new Set(Object.keys(STATE_CODES));

/**
 * The one jurisdiction in US_STATES that is not a state. The grid gives it a
 * tile (it has its own NP licensure and its own hub), but every figure this
 * page labels "state" leaves it out and names it separately, the convention
 * app/press/page.tsx ("50 states and DC") and app/tools/tools-registry.ts
 * ("51 jurisdictions") already follow. Counting it as a state would print
 * "51 US states" once every jurisdiction is hiring.
 */
const DISTRICT_OF_COLUMBIA = 'District of Columbia';

// Type definitions for Prisma groupBy results
interface CityGroupResult {
  city: string | null;
  state: string | null;
  stateCode: string | null;
  _count: { city: number };
}

// Type definitions for processed/rendered data
interface ProcessedState {
  name: string;
  code: string;
  count: number;
  slug: string;
}

interface ProcessedCity {
  name: string;
  state: string;
  stateCode: string;
  count: number;
  slug: string;
}

/** A state that earns its own /jobs/locations/<state> city directory. */
interface StateCityDirectoryLink {
  name: string;
  slug: string;
  /** Cities in that state with ≥ MIN_CITY_JOBS_FOR_LINK active roles. */
  linkableCities: number;
  /** Distinct cities in that state carrying at least one active role. */
  trackedCities: number;
}

/**
 * Every count on this page, on the canonical predicate (PLAN T0-1).
 *
 * The state grid, the remote banner and the hero total used to count every
 * published row, expired and dead-link rows included, while the state hubs
 * and /jobs/remote count with canonicalBucketWhere. A tile could then
 * promise more jobs than the page it links to lists. Each query below now
 * composes the same predicate as its destination, which also carries the
 * profession quarantine (GLOBAL_EXCLUSIONS).
 */
async function getLocationStats() {
  const [stateGroups, remoteCount, topCities, totalJobs, directoryCityRows] = await Promise.all([
    // State tiles, grouped by (state, stateCode) so each jurisdiction can be
    // counted with the hub's own `state = name OR stateCode = code` bucket.
    prisma.job.groupBy({
      by: ['state', 'stateCode'],
      where: canonicalBucketWhere({ OR: [{ state: { not: null } }, { stateCode: { not: null } }] }),
      _count: { _all: true },
    }),
    // The remote banner: the same { isRemote: true } bucket /jobs/remote counts.
    prisma.job.count({ where: canonicalBucketWhere({ isRemote: true }) }),
    // Top cities. Every tile links a /jobs/city page whose own gate counts
    // canonical inventory, so a city that clears MIN_CITY_JOBS_FOR_LINK here
    // clears it there too.
    prisma.job.groupBy({
      by: ['city', 'state', 'stateCode'],
      where: canonicalBucketWhere({ city: { not: null }, state: { not: null } }),
      _count: {
        city: true,
      },
      orderBy: {
        _count: {
          city: 'desc',
        },
      },
      take: 12,
    }),
    // The hero total: the whole canonical pool, the site-wide count
    // lib/canonical-counts.ts defines (never more than /jobs lists).
    prisma.job.count({ where: canonicalBucketWhere({}) }),
    // P2 #12: which states earn a /jobs/locations/<state> city directory.
    // Grouped by (city, state) with the SAME canonical predicate the
    // directory page and app/sitemap.ts use. The page matches `state = name
    // OR stateCode = code`, a superset of this grouping, so a state that
    // qualifies here always qualifies there: the hub can never link a
    // directory that 404s.
    prisma.job.groupBy({
      by: ['city', 'state'],
      where: canonicalBucketWhere({ city: { not: null }, state: { not: null } }),
      _count: { city: true },
    }),
  ]);

  const cityRowsByState = new Map<string, { city: string; count: number }[]>();
  for (const row of directoryCityRows) {
    if (!row.city || !row.state) continue;
    const bucket = cityRowsByState.get(row.state);
    const entry = { city: row.city, count: row._count.city };
    if (bucket) bucket.push(entry);
    else cityRowsByState.set(row.state, [entry]);
  }

  // One tile per jurisdiction, most jobs first. countJobsByJurisdiction
  // applies the hub's bucket, so a jurisdiction whose rows split across two
  // spellings gets one tile carrying the hub's own total instead of two.
  const processedStates: ProcessedState[] = [
    ...countJobsByJurisdiction(
      stateGroups.map((group) => ({ state: group.state, stateCode: group.stateCode, count: group._count._all })),
    ),
  ]
    .map(([name, count]) => ({ name, code: STATE_CODES[name], count, slug: stateToSlug(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Process cities with explicit typing; include the state code in the slug for proper routing.
  //
  // P3 #9: every row here becomes a /jobs/city/<slug> tile, and that route does not
  // look the slug up; it rebuilds a city NAME from it and matches the DB `city`
  // column, so a name carrying a period, apostrophe or hyphen ("St. Louis" to
  // st-louis-mo to "St Louis") matches zero rows and hard-404s. Reject those with
  // the same guard the city directories below already use, and build the surviving
  // slugs with the shared builder instead of a fourth inline copy of it. Filtered
  // here rather than at the render site so the CollectionPage description's city
  // count describes what the page actually links. The count gate is the same
  // MIN_CITY_JOBS_FOR_LINK the directories use: a city page 404s below it.
  const processedCities = topCities
    .filter((c: CityGroupResult) => c.city !== null && c.state !== null && c.stateCode !== null)
    .filter((c: CityGroupResult) => c._count.city >= MIN_CITY_JOBS_FOR_LINK)
    .filter((c: CityGroupResult) => cityLinkResolves(c.city!, c.stateCode || ''))
    .map((c: CityGroupResult) => ({
      name: c.city!,
      state: c.state!,
      stateCode: c.stateCode || '',
      count: c._count.city,
      slug: buildCitySlug(c.city!, c.stateCode || ''),
    }));

  const cityDirectories: StateCityDirectoryLink[] = processedStates
    .map((s) => {
      // s.code is the STATE_CODES code, the one the directory page resolves
      // for itself, never the DB `stateCode` column (null or blank on rows
      // that predate the normalizer). Same input, same verdict on both sides.
      const stateCode = s.code;
      const directory = buildStateCityDirectory(cityRowsByState.get(s.name) ?? [], {
        // Identical veto to the directory page's own build. Without it a state
        // whose only ≥3 city is something like "St. Louis" would pass here and
        // 404 there: the hub would link its own dead end.
        canLink: (row) => cityLinkResolves(row.city, stateCode),
      });
      if (!shouldRenderStateCityDirectory(directory)) return null;
      return {
        name: s.name,
        slug: s.slug,
        linkableCities: directory.linkable.length,
        trackedCities: directory.trackedCities,
      };
    })
    .filter((s): s is StateCityDirectoryLink => s !== null)
    .sort((a, b) => b.linkableCities - a.linkableCities || a.name.localeCompare(b.name));

  return {
    states: processedStates,
    remoteCount,
    topCities: processedCities,
    totalJobs,
    cityDirectories,
    /**
     * Distinct US cities carrying at least one active, indexable role. Counted
     * off the same US_STATES whitelist the state grid uses: the raw groupBy
     * also carries non-US locations ("British Columbia"), which this hero stat
     * previously folded into a headline "Cities Hiring" number.
     */
    citiesHiring: directoryCityRows.filter((r) => r.city && r.state && US_STATES.has(r.state)).length,
  };
}

/** Browse-by-job-type tiles; icons read from the one navigation registry (A.4.4). */
const JOB_TYPE_TILES: ReadonlyArray<{ href: string; icon: Art; label: string; sub: string }> = [
  { href: '/jobs/remote', icon: NAV_ICONS.remote, label: 'Remote', sub: 'Work from anywhere' },
  { href: '/jobs/telehealth', icon: NAV_ICONS.telehealth, label: 'Telehealth', sub: 'Virtual patient care' },
  { href: '/jobs/travel', icon: NAV_ICONS.travel, label: 'Travel', sub: 'Locum tenens' },
  { href: '/jobs/new-grad', icon: NAV_ICONS['new-grad'], label: 'New Grad', sub: 'Entry-level friendly' },
  { href: '/jobs/per-diem', icon: NAV_ICONS['per-diem'], label: 'Per Diem', sub: 'Flexible scheduling' },
];

/**
 * The "About" card (editorial, no figures): what each tier of the location
 * mesh is for. Copy that claims nothing the pages cannot show.
 */
const ABOUT_BLOCKS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'State by state',
    body: `Each state page lists the live ${brand.niche.short} openings in that state, names the employers and cities behind them, and links the state's practice authority summary and salary guide.`,
  },
  {
    title: 'City directories',
    body: `A state's city directory shows every city carrying open roles and links the cities with ${MIN_CITY_JOBS_FOR_LINK} or more that have their own page, so you can compare local markets before opening a listing.`,
  },
  {
    title: 'Metro guides',
    body: 'Metro guides cover the largest markets in more depth: the practice environment, the employers posting there, and the nearby cities that share the same pool of roles.',
  },
  {
    title: 'Remote roles',
    body: `${HUB_REMOTE_LICENSURE_NOTE} The remote listing collects the roles that are not tied to one city.`,
  },
];

/**
 * Generate metadata for SEO
 */
export const metadata: Metadata = {
  title: `${brand.niche.short} Jobs by Location | States and Cities`,
  description: `Find ${brand.niche.descriptor} jobs by state and city across the United States. Browse ${brand.niche.short} positions by location, including remote opportunities.`,
  openGraph: {
    title: `${brand.niche.short} Jobs by Location`,
    description: `Browse ${brand.niche.descriptor} jobs by state, city and metro, plus remote positions.`,
    type: 'website',
    images: [{
      url: `/api/og?type=page&title=${encodeURIComponent(`${brand.niche.short} Jobs by Location`)}&subtitle=${encodeURIComponent('Browse positions by state and city')}`,
      width: 1200,
      height: 630,
      alt: `${brand.niche.short} Jobs by Location`,
    }],
  },
  alternates: {
    canonical: `${brand.baseUrl}/jobs/locations`,
  },
};

/**
 * Locations directory page
 */
export default async function LocationsPage() {
  const stats = await getLocationStats();

  /* Design Tokens */
  const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
  };

  // stats.states holds one entry per jurisdiction with canonical listings,
  // the District of Columbia included. Anything worded "state" counts the
  // states alone and names DC on its own (see DISTRICT_OF_COLUMBIA).
  const statesHiring = stats.states.filter((s) => s.name !== DISTRICT_OF_COLUMBIA).length;
  const districtHiring = statesHiring < stats.states.length;

  // Omit rather than pad: a part with nothing behind it drops out of the
  // sentence instead of reading "0 cities".
  const coverage = joinWithAnd([
    ...(statesHiring > 0 ? [formatCount(statesHiring, 'US state')] : []),
    ...(districtHiring ? ['the District of Columbia'] : []),
    ...(stats.topCities.length > 0 ? [formatCount(stats.topCities.length, 'city', 'cities')] : []),
  ]);

  // Hero tiles, same rule: a bucket with no jobs drops its tile rather than
  // printing a zero.
  const heroStats = [
    { count: stats.totalJobs, label: 'Jobs' },
    { count: statesHiring, label: 'States Hiring' },
    { count: stats.citiesHiring, label: 'Cities Hiring' },
    { count: stats.remoteCount, label: 'Remote' },
  ]
    .filter((s) => s.count > 0)
    .map((s) => ({ value: s.count.toLocaleString(), label: s.label }));

  // SEO Fix #15: emit CollectionPage + ItemList schema for the state directory.
  // Previously only BreadcrumbList was rendered, so Google had no signal that
  // this page is a curated directory of the state hubs, losing eligibility for
  // sitelinks-search-style rich treatment. The list carries every hub the
  // grid links, so numberOfItems and itemListElement always agree; STATE_CODES
  // bounds it at 51 entries.
  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${brand.niche.short} Jobs by Location`,
    description: coverage
      ? `Directory of ${brand.niche.descriptor} jobs across ${coverage}.`
      : `Directory of ${brand.niche.descriptor} jobs by state and city.`,
    url: `${brand.baseUrl}/jobs/locations`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: stats.states.length,
      itemListElement: stats.states.map((s: ProcessedState, idx: number) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: `${brand.niche.short} Jobs in ${s.name}`,
        url: `${brand.baseUrl}/jobs/state/${s.slug}`,
      })),
    },
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FDFBF7' }}>
      {/* Breadcrumb Schema */}
      <BreadcrumbSchema items={[
        { name: "Home", url: brand.baseUrl },
        { name: "Jobs", url: `${brand.baseUrl}/jobs` },
        { name: "Locations", url: `${brand.baseUrl}/jobs/locations` }
      ]} />
      {/* SEO Fix #15: CollectionPage + ItemList for the state directory */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      {/* ═══ HERO ═══
          Hero art and its ground come from the one asset registry (A.4.4),
          the same pair DEFAULT_CATEGORY_ASSETS hands every category hero, so
          the band cannot drift from the sampled corner of the image. */}
      <CategoryHero
        bgColor={SHARED_ART.usMapHero.bg}
        heroImage={SHARED_ART.usMapHero.src}
        heroAlt={`${brand.niche.short} Jobs by Location`}
        badgeText="Nationwide"
        breadcrumbs={crumbsFromSchema([{ name: "Home", url: brand.baseUrl }, { name: "Jobs", url: `${brand.baseUrl}/jobs` }, { name: "Locations", url: `${brand.baseUrl}/jobs/locations` }])}
        indexLabel="№ 02"
        headlineLine1={brand.niche.short}
        headlineLine2="Locations"
        headlineSub="Search by State & City"
        stats={heroStats}
        description={`Explore ${stats.totalJobs > 0 ? `${stats.totalJobs.toLocaleString()} ` : ''}${brand.niche.adjective} ${brand.niche.descriptor} positions across the United States. Find opportunities by state, in the largest metro areas and in remote positions.`}
        ctaLabel="Browse All Jobs"
        ctaHref="/jobs"
      />

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-7xl mx-auto">
          {/* ═══ Remote Jobs: Premium Clay Banner ═══ */}
          {stats.remoteCount > 0 && (
            <div className="mb-12">
              <Link href="/jobs/remote" className="block group">
                <div
                  className="rounded-2xl overflow-hidden transition-all duration-300 group-hover:-translate-y-1"
                  style={{
                    ...clayCard,
                    padding: 0,
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: '0' }}>
                    {/* Left: Icon + Copy */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '28px 32px' }}>
                      {/* Large Clay Icon */}
                      <div style={{
                        width: '80px', height: '80px', borderRadius: '20px', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: '#F9F7F1',
                        border: '1px solid rgba(255,255,255,0.6)',
                        boxShadow: '4px 4px 10px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 3px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.02)',
                      }}>
                        <Image src={NAV_ICONS.remote.src} alt="" width={52} height={52} sizes="52px" style={{ objectFit: 'contain' }} />
                      </div>

                      <div>
                        <h2 style={{
                          fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800,
                          fontFamily: 'var(--font-lora, Georgia, serif)',
                          color: '#1A2E35', margin: '0 0 6px', lineHeight: 1.2,
                        }}>Remote {brand.niche.short} Jobs</h2>
                        <p style={{ fontSize: '14px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                          {/* No coverage figure: this banner counts one live
                              aggregate (the stat beside it) and claims nothing
                              about how many states are represented. */}
                          Telehealth and fully remote roles, gathered in one feed.
                        </p>
                      </div>
                    </div>

                    {/* Right: Stat + CTA */}
                    <div style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      padding: '28px 36px', gap: '14px',
                      borderLeft: '1px solid rgba(0,0,0,0.04)',
                      background: 'linear-gradient(180deg, rgba(249,247,241,0.4) 0%, rgba(255,255,255,0) 100%)',
                    }}>
                      {/* Stat Pill */}
                      <div style={{
                        padding: '8px 20px', borderRadius: '14px',
                        background: '#F9F7F1',
                        border: '1px solid #EAE6DF',
                        boxShadow: 'inset 2px 2px 6px rgba(0,0,0,0.03), inset -1px -1px 3px rgba(255,255,255,0.5)',
                        textAlign: 'center',
                      }}>
                        <div style={{ fontSize: '28px', fontWeight: 800, color: '#BE185D', lineHeight: 1.1 }}>
                          {stats.remoteCount}
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#7A6A62', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          Open Positions
                        </div>
                      </div>

                      {/* CTA Button */}
                      <div
                        className="group-hover:-translate-y-0.5 transition-all"
                        style={{
                          padding: '10px 24px', borderRadius: '14px',
                          fontSize: '14px', fontWeight: 700, color: '#fff',
                          background: 'linear-gradient(135deg, #BE185D, #9D174D)',
                          boxShadow: '4px 4px 12px rgba(190,24,93,0.2), -2px -2px 6px rgba(255,255,255,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        View Remote Jobs
                        <span style={{ transition: 'transform 0.2s' }} className="group-hover:translate-x-1">→</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          )}

          {/* ═══ Browse by Job Type: Clay Icon Grid ═══ */}
          <div className="mb-12">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <Image src={NAV_ICONS.location.src} alt="" width={28} height={28} sizes="28px" style={{ objectFit: 'contain' }} />
              <h2 style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, fontFamily: 'var(--font-lora, Georgia, serif)', color: '#1A2E35', margin: 0 }}>
                Browse by Job Type
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {JOB_TYPE_TILES.map((cat) => (
                <Link key={cat.href} href={cat.href} className="group">
                  <div
                    className="h-full flex flex-col items-center text-center transition-all duration-200 group-hover:-translate-y-1"
                    style={{ ...clayCard, padding: '24px 16px' }}
                  >
                    {/* Clay Icon Well */}
                    <div style={{
                      width: '56px', height: '56px', borderRadius: '16px', marginBottom: '14px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#F9F7F1',
                      border: '1px solid rgba(255,255,255,0.6)',
                      boxShadow: '3px 3px 8px rgba(0,0,0,0.04), -2px -2px 5px rgba(255,255,255,0.8), inset 1px 1px 3px rgba(255,255,255,0.6)',
                    }}>
                      <Image src={cat.icon.src} alt="" width={34} height={34} sizes="34px" style={{ objectFit: 'contain' }} />
                    </div>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 4px' }}>{cat.label}</h3>
                    <p style={{ fontSize: '12px', color: '#7A6A62', margin: '0 0 12px', lineHeight: 1.4 }}>{cat.sub}</p>
                    <div style={{
                      marginTop: 'auto', fontSize: '12px', fontWeight: 700, color: '#BE185D',
                      display: 'flex', alignItems: 'center', gap: '4px',
                    }}>
                      View Jobs <span className="group-hover:translate-x-1 transition-transform">→</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* ═══ Browse by State: Diorama Cards ═══ */}
          <div className="mb-12">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <Image src={NAV_ICONS.location.src} alt="" width={28} height={28} sizes="28px" style={{ objectFit: 'contain' }} />
              <h2 style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, fontFamily: 'var(--font-lora, Georgia, serif)', color: '#1A2E35', margin: 0 }}>
                Browse by State
              </h2>
            </div>

            {stats.states.length === 0 ? (
              <div className="text-center py-12" style={clayCard}>
                <MapPin className="h-12 w-12 mx-auto mb-4" style={{ color: '#7A6A62' }} aria-hidden="true" />
                <p style={{ color: '#5A4A42', margin: 0 }}>No state data is available.</p>
              </div>
            ) : (
              <>
              <style dangerouslySetInnerHTML={{ __html: `
                .state-card {
                  transition: transform 0.3s ease, box-shadow 0.3s ease;
                }
                .state-card:hover {
                  transform: translateY(-6px) scale(1.03);
                  box-shadow: inset 4px 4px 10px rgba(255,255,255,0.3), inset -3px -3px 8px rgba(0,0,0,0.08), 0 14px 32px rgba(0,0,0,0.16) !important;
                }
                .state-card:hover .state-footer {
                  background: #F9F7F1;
                }
                .state-card:hover .state-name {
                  color: #BE185D !important;
                }
              `}} />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                {stats.states.map((state: ProcessedState) => (
                  <Link
                    key={state.code}
                    href={`/jobs/state/${state.slug}`}
                    className="group block"
                    style={{ textDecoration: 'none' }}
                  >
                    {/* Diorama: aspect-square, matching home page */}
                    <div
                      className="state-card relative overflow-hidden aspect-square"
                      style={{
                        borderRadius: '24px',
                        boxShadow: 'inset 4px 4px 10px rgba(255,255,255,0.3), inset -3px -3px 8px rgba(0,0,0,0.08), 0 6px 20px rgba(0,0,0,0.1)',
                      }}
                    >
                      {/* SEO Fix H15: StateImage falls back if per-state webp is missing. */}
                      <StateImage
                        slug={state.slug}
                        alt={`${state.name} ${brand.niche.short} Jobs`}
                        width={300}
                        height={300}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      {/* Job count badge */}
                      <div style={{
                        position: 'absolute', bottom: '10px', right: '10px',
                        padding: '5px 12px', borderRadius: '12px',
                        background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
                        fontSize: '13px', fontWeight: 800, color: '#BE185D', lineHeight: 1,
                        display: 'flex', alignItems: 'baseline', gap: '3px',
                      }}>
                        {state.count} <span style={{ fontSize: '10px', fontWeight: 600, color: '#7A6A62' }}>jobs</span>
                      </div>
                    </div>
                    {/* Footer: Name + CTA */}
                    <div className="state-footer" style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 6px 4px',
                    }}>
                      <span className="state-name" style={{ fontSize: '13px', fontWeight: 700, color: '#1A2E35', transition: 'color 0.2s' }}>
                        {state.name}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#BE185D', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        View →
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              </>
            )}
          </div>

          {/* ═══ City directories by state (P2 #12) ═══
              The hub used to link exactly 12 city pages sitewide while the
              sitemap submitted every city page with ≥3 active roles. These
              per-state directories are the missing tier: each one lists that
              state's cities with live counts, so the long tail is reachable by
              a crawler and by a human. Only states that pass the same gate the
              directory page enforces are listed: no links to 404s. */}
          {stats.cityDirectories.length > 0 && (
            <div className="mb-12">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <MapPinned className="h-6 w-6" style={{ color: '#BE185D' }} aria-hidden="true" />
                <h2 style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, fontFamily: 'var(--font-lora, Georgia, serif)', color: '#1A2E35', margin: 0 }}>
                  Browse Cities State by State
                </h2>
              </div>
              <p style={{ fontSize: '14px', color: '#7A6A62', marginBottom: '20px', lineHeight: 1.5 }}>
                {/* "Each directory", not "these states": the District of
                    Columbia earns a directory here on the same gate. */}
                Each directory lists every city with live {brand.niche.short} openings, with the count shown next to
                each one. Cities with {MIN_CITY_JOBS_FOR_LINK} or more roles are linked when a page for them exists.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {stats.cityDirectories.map((entry: StateCityDirectoryLink) => (
                  <Link key={entry.slug} href={`/jobs/locations/${entry.slug}`} className="group" style={{ textDecoration: 'none' }}>
                    <div className="h-full rounded-xl p-4 transition-all duration-200 group-hover:-translate-y-1" style={clayCard}>
                      <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 4px', lineHeight: 1.3 }}>
                        {entry.name}
                      </h3>
                      <p style={{ fontSize: '12px', color: '#7A6A62', margin: '0 0 10px' }}>
                        {formatCount(entry.trackedCities, 'city', 'cities')} hiring
                      </p>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#BE185D', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        City directory
                        <span className="group-hover:translate-x-1 transition-transform">→</span>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ═══ Metro Guides: editorial metro landing pages ═══ */}
          {METRO_CITIES.length > 0 && (
            <div className="mb-12">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                <MapPin className="h-6 w-6" style={{ color: '#BE185D' }} aria-hidden="true" />
                <h2 style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, fontFamily: 'var(--font-lora, Georgia, serif)', color: '#1A2E35', margin: 0 }}>
                  Metro Area Guides
                </h2>
              </div>
              <p style={{ fontSize: '14px', color: '#7A6A62', marginTop: '-12px', marginBottom: '20px', lineHeight: 1.5 }}>
                In-depth {brand.niche.short} job guides for major metros, covering practice authority, the employers posting there, and local licensure notes.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {METRO_CITIES.map((metro) => (
                  <Link key={metro.slug} href={`/jobs/metro/${metro.slug}`} className="group">
                    <div className="h-full rounded-xl p-5 hover:shadow-md transition-all duration-200 group-hover:-translate-y-1" style={clayCard}>
                      <h3 className="font-bold mb-1 transition-colors" style={{ color: '#1A2E35' }}>
                        {metro.city}
                      </h3>
                      <p className="text-xs font-medium mb-3" style={{ color: '#7A6A62' }}>
                        {metro.state} ({metro.stateCode})
                      </p>
                      <span style={{
                        display: 'inline-block', padding: '3px 10px', borderRadius: '10px',
                        fontSize: '11px', fontWeight: 700, marginBottom: '12px',
                        background: metro.practiceAuthority === 'Full' ? '#D1FAE5' : metro.practiceAuthority === 'Reduced' ? '#FEF3C7' : '#FEE2E2',
                        color: metro.practiceAuthority === 'Full' ? '#065F46' : metro.practiceAuthority === 'Reduced' ? '#92400E' : '#991B1B',
                      }}>
                        {metro.practiceAuthority} Practice
                      </span>
                      <div className="text-sm font-medium flex items-center gap-1" style={{ color: '#BE185D' }}>
                        Read Guide
                        <span className="group-hover:translate-x-1 transition-transform">→</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ═══ Top Cities: clay tiles, counts in the accent ═══ */}
          {stats.topCities.length > 0 && (
            <div className="mb-12">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                <Image src={NAV_ICONS.location.src} alt="" width={28} height={28} sizes="28px" style={{ objectFit: 'contain' }} />
                <h2 style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, fontFamily: 'var(--font-lora, Georgia, serif)', color: '#1A2E35', margin: 0 }}>
                  Top Cities with {brand.niche.short} Jobs
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {stats.topCities.map((city: ProcessedCity) => (
                  <Link
                    key={`${city.slug}-${city.state}`}
                    href={`/jobs/city/${city.slug}`}
                    className="group"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="h-full transition-all duration-200 group-hover:-translate-y-1" style={{ ...clayCard, padding: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                        <div>
                          <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0, lineHeight: 1.25 }}>
                            {city.name}
                          </h3>
                          <p style={{ fontSize: '12px', color: '#7A6A62', margin: '4px 0 0' }}>
                            {city.state}{city.stateCode ? ` (${city.stateCode})` : ''}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '22px', fontWeight: 800, color: '#BE185D', lineHeight: 1 }}>
                            {city.count}
                          </div>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '4px' }}>
                            {pluralize(city.count, 'job')}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#BE185D', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        View jobs
                        <span className="group-hover:translate-x-1 transition-transform">→</span>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>

              <div style={{ marginTop: '32px', textAlign: 'center' }}>
                <p style={{ fontSize: '14px', color: '#7A6A62', margin: '0 0 14px' }}>
                  Looking for jobs in a specific city?
                </p>
                <Link
                  href="/jobs"
                  className="group-hover:-translate-y-0.5 transition-all"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '12px 28px', borderRadius: '14px',
                    fontSize: '14px', fontWeight: 700, color: '#fff', textDecoration: 'none',
                    background: 'linear-gradient(135deg, #BE185D, #9D174D)',
                    boxShadow: '4px 4px 12px rgba(190,24,93,0.2), -2px -2px 6px rgba(255,255,255,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
                  }}
                >
                  Search all jobs
                </Link>
              </div>
            </div>
          )}

          {/* ═══ About: what each tier of the location mesh is for ═══ */}
          <div style={{ ...clayCard, padding: '28px' }}>
            <h2 style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800, fontFamily: 'var(--font-lora, Georgia, serif)', color: '#1A2E35', margin: '0 0 20px' }}>
              About {brand.niche.short} Job Locations
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {ABOUT_BLOCKS.map((block) => (
                <div key={block.title}>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>{block.title}</h3>
                  <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.65, margin: 0 }}>{block.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

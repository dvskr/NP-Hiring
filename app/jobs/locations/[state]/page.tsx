import { cache } from 'react';
import { brand } from '@/config/brand';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Building2, DollarSign, MapPin, Bell, ArrowRight } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import Breadcrumbs from '@/components/Breadcrumbs';
import StateImage from '@/components/StateImage';
import { resolveStateSlug, stateToSlug, STATE_CODES } from '@/lib/pseo/setting-state-config';
import { getStatePracticeAuthority } from '@/lib/state-practice-authority';
import { getCityByNameState } from '@/lib/pseo/city-data/cities';
import { getMetroCity } from '@/lib/metro-data';
import {
  activeJobsInStateWhere,
  buildCitySlug,
  buildStateCityDirectory,
  cityLinkResolves,
  shouldRenderStateCityDirectory,
  MIN_CITY_JOBS_FOR_LINK,
  type StateCityDirectory,
} from './directory';

export const revalidate = 3600; // ISR: revalidate every hour

/**
 * P2 #12 — per-state city directory.
 *
 * 4,135 city records ship in lib/pseo/city-data/cities.ts and app/sitemap.ts
 * submits every city page with ≥3 active jobs, but the only city links on the
 * whole site were the top 12 tiles on /jobs/locations. Everything else was
 * submitted-and-orphaned. These pages are the missing tier between the
 * locations hub and the individual city pages.
 *
 * Every city listed here is gated on LIVE inventory:
 *   ≥ MIN_CITY_JOBS_FOR_LINK active jobs → linked
 *   1–2 active jobs                      → named with its real count, NOT linked
 *                                          (its city page 404s by design)
 *   0 active jobs                        → omitted entirely
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
  salaryByCity: Map<string, { avgMin: number; avgMax: number }>;
  totalStateJobs: number;
  employerCount: number;
}

/** Escaped with the repo's \u003c chain (pattern: app/companies/[slug]/page.tsx). */
const jsonLd = (obj: unknown): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

// No generateStaticParams: the sibling geo routes (/jobs/state/[state],
// /jobs/city/[slug]) are all on-demand ISR, and pre-rendering 51 states would
// run the directory aggregate 51× at build time for ~25 pages that survive the
// gate.

/**
 * `cache` dedupes the three aggregates between generateMetadata and the render
 * — Next.js calls both per request, so without it every one of these pages ran
 * six queries instead of three (pattern: app/companies/page.tsx).
 */
const getStateDirectory = cache(async (stateName: string, stateCode: string): Promise<StateDirectoryData> => {
  // Deliberately the STRICTER predicate: the city page's own render gate counts
  // every published row (including expired), so anything that clears ≥3 here is
  // guaranteed to clear the city page's gate too. Under-linking is safe;
  // over-linking would manufacture soft 404s.
  //
  // Built by activeJobsInStateWhere, which nests the state match under `AND`.
  // The obvious `{ ...activeIndexableJobWhere(), OR: [...] }` is a trap: the
  // helper's own top-level `OR` IS the expiry pair, so a sibling `OR` key
  // overwrites it and every "live" number on this page counts expired rows.
  const inState = activeJobsInStateWhere(stateName, stateCode);

  const [cityRows, salaryRows, totalStateJobs, employerRows] = await Promise.all([
    prisma.job.groupBy({
      by: ['city'],
      where: { ...inState, city: { not: null } },
      _count: { city: true },
    }),
    // Salary is a SEPARATE aggregate over only the rows that disclose BOTH
    // bounds. Prisma/Postgres AVG skips NULLs per column independently, and
    // lib/salary-normalizer.ts sets normalizedMinSalary and normalizedMaxSalary
    // independently (a min-only or max-only row is a real DB state) — so
    // averaging both columns over the unfiltered set draws the two ends of the
    // "range" from two different job populations and can invert it.
    // Same shape as getCityStats in app/jobs/city/[slug]/page.tsx.
    prisma.job.groupBy({
      by: ['city'],
      where: {
        ...inState,
        city: { not: null },
        normalizedMinSalary: { not: null },
        normalizedMaxSalary: { not: null },
      },
      _avg: { normalizedMinSalary: true, normalizedMaxSalary: true },
    }),
    prisma.job.count({ where: inState }),
    prisma.job.groupBy({
      by: ['employer'],
      where: { ...inState, employer: { not: '' } },
      _count: { employer: true },
    }),
  ]);

  const aggregates: CityAggregate[] = cityRows
    .filter((row) => row.city !== null && row.city.trim().length > 0)
    .map((row) => ({
      city: row.city as string,
      count: row._count.city,
    }));

  const salaryByCity = new Map<string, { avgMin: number; avgMax: number }>();
  for (const row of salaryRows) {
    const avgMin = row._avg.normalizedMinSalary;
    const avgMax = row._avg.normalizedMaxSalary;
    if (!row.city || !avgMin || !avgMax) continue;
    // Both averages now come from the same rows, and the normalizer swaps
    // reversed bounds per row, so avg(min) ≤ avg(max) always holds. Keep the
    // check anyway: printing "$185K–$120K" is worse than printing nothing.
    if (avgMin > avgMax) continue;
    salaryByCity.set(row.city, { avgMin, avgMax });
  }

  return {
    stateName,
    stateCode,
    directory: buildStateCityDirectory(aggregates, {
      // A city whose stored name does not survive the city route's slug parser
      // is named but never linked — the link would resolve to zero jobs and
      // 404. See cityLinkResolves.
      canLink: (row) => cityLinkResolves(row.city, stateCode),
    }),
    salaryByCity,
    totalStateJobs,
    employerCount: employerRows.length,
  };
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

  const cityCount = data.directory.linkable.length;

  return {
    title: `${brand.niche.short} Jobs by City in ${stateName} — ${cityCount} Cities Hiring`,
    description:
      `${data.totalStateJobs} active ${brand.niche.descriptor} openings across ${data.directory.trackedCities} ${stateName} cities. ` +
      `Compare open roles and posted pay city by city, then open the local job page.`,
    openGraph: {
      title: `${brand.niche.short} Jobs by City in ${stateName}`,
      description: `Browse ${brand.niche.descriptor} openings in ${cityCount} ${stateName} cities.`,
      url: canonical,
      type: 'website',
      siteName: brand.name,
      images: [{
        url: `${brand.baseUrl}/api/og?type=page&title=${encodeURIComponent(`${brand.niche.short} Jobs by City in ${stateName}`)}&subtitle=${encodeURIComponent(`${cityCount} cities hiring now`)}`,
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

/** $128K style, from a live average only — never a rounded-up guess. */
function formatK(value: number): string {
  return `$${Math.round(value / 1000)}K`;
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

  // Thin-directory gate — same predicate the hub uses to decide whether to
  // link here, so the hub can never point at a 404.
  if (!shouldRenderStateCityDirectory(directory)) notFound();

  const authority = getStatePracticeAuthority(stateName);
  const canonicalPath = `/jobs/locations/${canonicalSlug}`;

  const linkedCities = directory.linkable.map((row) => {
    const slug = buildCitySlug(row.city, stateCode);
    const metro = getMetroCity(slug);
    const record = getCityByNameState(row.city, stateCode);
    const salary = data.salaryByCity.get(row.city);
    return {
      name: row.city,
      count: row.count,
      // Curated metro pages take priority over the generic city page — the
      // city route 308s to them anyway (app/jobs/city/[slug]/page.tsx), so
      // link the destination directly instead of burning a redirect hop.
      href: metro ? `/jobs/metro/${slug}` : `/jobs/city/${slug}`,
      isMetroGuide: Boolean(metro),
      // Only the repaired, provably-correct field from the city dataset. The
      // rest of that record was keyed by city name alone across states and is
      // not safe to print (lib/pseo/city-data/types.ts).
      metroArea: record?.metroArea ?? null,
      salary: salary ?? null,
    };
  });

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
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.14em', margin: '0 0 6px' }}>
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

          {/* ═══ Live stat row — all four numbers are live aggregates ═══ */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '32px' }}>
            <div style={statTile}>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#BE185D', lineHeight: 1.1 }}>{data.totalStateJobs}</div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Open roles
              </div>
            </div>
            <div style={statTile}>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#BE185D', lineHeight: 1.1 }}>{directory.trackedCities}</div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Cities hiring
              </div>
            </div>
            <div style={statTile}>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#BE185D', lineHeight: 1.1 }}>{linkedCities.length}</div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {/* Cities that clear the threshold AND resolve to a real city
                    page — not every ≥N city has a linkable slug. */}
                City pages linked
              </div>
            </div>
            <div style={statTile}>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#BE185D', lineHeight: 1.1 }}>{data.employerCount}</div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Employers
              </div>
            </div>
          </div>

          {/* ═══ Orientation prose — live aggregates + repo regulatory data only ═══ */}
          <div style={{ ...clayCard, padding: '24px', marginBottom: '32px' }}>
            <p style={{ fontSize: '15px', color: '#3D3530', lineHeight: 1.75, margin: 0 }}>
              {stateName} currently has <strong>{data.totalStateJobs} active {brand.niche.short} {data.totalStateJobs === 1 ? 'posting' : 'postings'}</strong>{' '}
              from {data.employerCount} {data.employerCount === 1 ? 'employer' : 'employers'}, spread across{' '}
              {directory.trackedCities} {directory.trackedCities === 1 ? 'city' : 'cities'}.{' '}
              {linkedCities.length > 0 && (
                <>
                  {linkedCities[0].name} leads with {linkedCities[0].count}{' '}
                  {linkedCities[0].count === 1 ? 'opening' : 'openings'}.{' '}
                </>
              )}
              {/* Only the authority LABEL is reused here. The long `details`
                  prose already renders verbatim on /jobs/state/<state>, so
                  repeating it would make these two URLs near-duplicates. */}
              {authority && (
                <>
                  {stateName} is a <strong>{authority.description}</strong> state, which shapes how much
                  supervision a role in any of these cities carries.{' '}
                </>
              )}
              City pages open with the live listings for that market; the statewide feed is linked at the
              bottom if you are flexible on location.
            </p>
          </div>

          {/* ═══ Linked cities ═══ */}
          <section style={{ marginBottom: '40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <MapPin className="h-5 w-5" style={{ color: '#BE185D' }} aria-hidden="true" />
              <h2 style={{ fontSize: 'clamp(19px, 3vw, 24px)', fontWeight: 800, fontFamily: 'var(--font-lora, Georgia, serif)', color: '#1A2E35', margin: 0 }}>
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
                      {city.metroArea ? ` · ${city.metroArea} metro` : ''}
                    </p>
                    {city.salary && (
                      <p style={{ fontSize: '12px', color: '#5A4A42', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
                        Avg posted range {formatK(city.salary.avgMin)}–{formatK(city.salary.avgMax)}
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

            {data.salaryByCity.size > 0 && (
              <p style={{ fontSize: '12px', color: '#7A6A62', marginTop: '14px', lineHeight: 1.6 }}>
                Posted ranges average only the roles in that city that disclose <em>both</em> ends of the
                pay range — one-sided and undisclosed postings are excluded rather than estimated, so both
                numbers describe the same set of jobs.
              </p>
            )}
          </section>

          {/* ═══ Sub-threshold cities — named, never linked ═══ */}
          {directory.emerging.length > 0 && (
            <section style={{ marginBottom: '40px' }}>
              <h2 style={{ fontSize: 'clamp(17px, 2.6vw, 20px)', fontWeight: 800, fontFamily: 'var(--font-lora, Georgia, serif)', color: '#1A2E35', margin: '0 0 8px' }}>
                Also hiring in {stateName}
              </h2>
              <p style={{ fontSize: '13px', color: '#7A6A62', margin: '0 0 16px', lineHeight: 1.6 }}>
                These cities do not have their own page yet — either they carry fewer than{' '}
                {MIN_CITY_JOBS_FOR_LINK} open roles, or their name has no stable city URL. Every listing
                below is still in the statewide feed.
              </p>
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

          {/* ═══ Continue ═══ */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4" style={{ marginBottom: '16px' }}>
            <Link href={`/jobs/state/${canonicalSlug}`} className="group" style={{ textDecoration: 'none' }}>
              <div className="h-full transition-all duration-200 group-hover:-translate-y-1" style={{ ...clayCard, padding: '20px' }}>
                <Building2 className="h-5 w-5 mb-2" style={{ color: '#BE185D' }} aria-hidden="true" />
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 4px' }}>
                  All {stateName} {brand.niche.short} jobs
                </h3>
                <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                  The statewide feed, including remote roles open to {stateName} licensees.
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
            <Link href="/jobs/locations" style={{ color: '#BE185D', fontWeight: 700 }}>
              Browse every state
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

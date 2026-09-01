import { cache } from 'react';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { getSiteStats } from '@/lib/site-stats';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import { canonicalActiveJobWhere, canonicalEmployerWhere } from '@/lib/canonical-counts';
import {
  COMPANIES_PER_PAGE,
  buildCompaniesPath,
  groupByLetter,
  letterAnchorId,
  pageRangeLabel,
  parsePageParam,
  topByActiveJobs,
  totalPageCount,
  DIRECTORY_LETTERS,
} from './directory';

/**
 * ISR: revalidate every hour.
 *
 * Reading `searchParams` (the `?page=N` cursor) opts this route out of the full
 * route cache, so `revalidate` governs the data cache rather than a prerendered
 * shell — the page is rendered per request. That is the accepted cost of
 * query-string pagination; making page 1 prerenderable again means moving the
 * cursor into the path (/companies/page/2), which changes the canonical URLs
 * the sitemap already submits. The `cache()` wrapper below removes the
 * duplicate count between generateMetadata and the render so a request costs
 * the same two queries either way.
 */
export const revalidate = 3600;

/** Employers featured in the page-1 "most open roles" strip. */
const SPOTLIGHT_COUNT = 12;

/**
 * Candidate pool for the spotlight strip. Shortlisted by the denormalized
 * Company.jobCount column (the only count Postgres can ORDER BY here), then
 * re-ranked on the live active count — the wider pool absorbs rows whose
 * denormalized column has drifted since the last refresh.
 */
const SPOTLIGHT_CANDIDATES = 40;

interface CompaniesPageProps {
  searchParams: Promise<{ page?: string | string[] }>;
}

/**
 * Employers with at least one canonical active job — the exact population the
 * directory renders, and therefore the only honest source for the visible count
 * and the pagination arithmetic. `cache` dedupes the query between
 * generateMetadata (which needs the page count) and the render.
 *
 * Live review 2026-08-17 item #4c: this is now the ONE employer definition
 * (lib/canonical-counts.ts canonicalEmployerWhere) — the same predicate
 * SiteStat.totalCompanies snapshots — so this hero, the /about stat, and the
 * cached metadata count can no longer put three different employer totals in
 * front of readers.
 */
const getDirectoryCount = cache(async (): Promise<number> =>
  prisma.company.count({ where: canonicalEmployerWhere() }),
);

/** Escaped exactly like the Organization schema in app/companies/[slug]/page.tsx. */
const jsonLd = (obj: unknown): string =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot 400'd on every share (pattern: app/for-employers/page.tsx).
const COMPANIES_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Companies Hiring ${brand.niche.short}s`)}&type=page`;

/**
 * P0 #5: employer counts derive from the cached SiteStat snapshot
 * (lib/site-stats.ts) instead of the hardcoded four-digit employer count
 * that drifted from real inventory (config/niche/copy.ts RULE: no
 * hardcoded counts in evergreen surfaces). Mirrors the homepage
 * generateMetadata pattern, and is pinned by
 * tests/regressions/p0-hubs-truth-inventory-claims.test.ts.
 *
 * SiteStat.totalCompanies and this page's directory count now share ONE
 * definition — canonicalEmployerWhere() (Company rows with ≥1 canonical
 * active job). The distinct-employer-string counter that made the snapshot a
 * larger population than the rows this page can link was retired in the
 * live-review count unification (2026-08-17 item #4c); the only remaining
 * difference is the snapshot's hourly cache lag.
 *
 * P2 #11: paged views self-canonicalize (`?page=N`) and stay indexable; page 1
 * always canonicalizes to the bare path so `?page=1` can't fork the hub.
 */
export async function generateMetadata({ searchParams }: CompaniesPageProps): Promise<Metadata> {
  const [{ totalCompanies }, directoryCount] = await Promise.all([
    getSiteStats(),
    getDirectoryCount(),
  ]);
  const page = parsePageParam((await searchParams).page);
  const totalPages = totalPageCount(directoryCount);
  const currentPage = Math.min(page, totalPages);
  const pageSuffix = currentPage > 1 ? ` — Page ${currentPage} of ${totalPages}` : '';
  const companyCountDisplay = totalCompanies > 1000
    ? `${(Math.floor(totalCompanies / 100) * 100).toLocaleString()}+`
    : totalCompanies.toLocaleString();

  return {
    title: `${brand.niche.short} Employers — Companies Hiring ${brand.niche.long}s${pageSuffix}`,
    description:
      `Browse companies actively hiring ${brand.niche.short}s. See open positions, salary data, and apply directly. Updated daily with ${companyCountDisplay} employers nationwide.`,
    openGraph: {
      title: `Companies Hiring ${brand.niche.short}s — ${brand.name}`,
      description: `Explore employers with open ${brand.niche.descriptor} positions.`,
      url: `${brand.baseUrl}${buildCompaniesPath(currentPage)}`,
      type: 'website',
      siteName: brand.name,
      images: [{
        url: COMPANIES_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: `Companies hiring ${brand.niche.short}s`,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `Companies Hiring ${brand.niche.short}s`,
      description: `Browse ${companyCountDisplay} employers actively hiring ${brand.niche.descriptor}s.`,
      images: [COMPANIES_OG_IMAGE],
    },
    alternates: {
      canonical: `${brand.baseUrl}${buildCompaniesPath(currentPage)}`,
    },
  };
}

/* ─── Claymorphism tokens ─── */
const clayCard: React.CSSProperties = {
  backgroundColor: '#FAFBF9',
  border: '1px solid rgba(255,255,255,0.7)',
  borderRadius: '22px',
  padding: '24px',
  boxShadow:
    '8px 8px 20px rgba(0,0,0,0.06), ' +
    '-6px -6px 16px rgba(255,255,255,0.9), ' +
    'inset 3px 3px 6px rgba(255,255,255,0.7), ' +
    'inset -2px -2px 4px rgba(0,0,0,0.03)',
  transition: 'transform 0.2s, box-shadow 0.2s',
};

export default async function CompaniesIndexPage({ searchParams }: CompaniesPageProps) {
  const now = new Date();
  const requestedPage = parsePageParam((await searchParams).page);

  // P1 #12 (hub links): the card set and its "N open positions" label must
  // use the SAME predicate the profile page uses to decide whether it 404s.
  // The hub previously counted every published row including expired ones, so
  // it linked to — and advertised job counts for — profiles that render a 404.
  //
  // That fix first used a hand-rolled `expiresAt: { gt: now }`, which matched
  // the profile page but made BOTH of them wrong in the other direction:
  // expiresAt=NULL counts as ACTIVE everywhere else in the repo
  // (lib/active-job-filter.ts, and the sitemap + middleware gates built on
  // it), so null-expiry employers were dropped from this directory entirely
  // while sitemap.xml still submitted their profile URLs. Both files now use
  // the shared helper — one predicate, no drift.
  // Canonical predicate (activeIndexableJobWhere + GLOBAL_EXCLUSIONS): the
  // listing, the per-company job badges, and the visible/pagination count all
  // derive from the same clause, so none can drift from the others — and none
  // can exceed what /jobs itself browses.
  const activeJobWhere = canonicalActiveJobWhere(now);
  const directoryWhere = { jobs: { some: activeJobWhere } };
  const directorySelect = {
    id: true,
    name: true,
    normalizedName: true,
    logoUrl: true,
    isVerified: true,
    _count: { select: { jobs: { where: activeJobWhere } } },
  } as const;

  // P2 #11: the hub took a hardcoded 200-row slice with no pagination and no
  // index — see the git history for the original clause. Beyond 200
  // employers the tail became unreachable from any internal link while
  // app/sitemap.ts kept submitting the profile URLs. Now the page size is a
  // deliberate constant, the total is counted, and out-of-range pages 404
  // instead of rendering an empty grid (soft-404).
  const totalCompanies = await getDirectoryCount();
  const totalPages = totalPageCount(totalCompanies);
  if (requestedPage > totalPages) notFound();
  const currentPage = requestedPage;

  const companies = await prisma.company.findMany({
    where: directoryWhere,
    select: directorySelect,
    // Alphabetical, because the page is an A–Z index: page boundaries have to
    // be stable and predictable. The old `jobCount desc` ordering survives as
    // the page-1 spotlight strip below.
    orderBy: { name: 'asc' },
    skip: (currentPage - 1) * COMPANIES_PER_PAGE,
    take: COMPANIES_PER_PAGE,
  });

  const entries = companies.map((company) => ({
    id: company.id,
    name: company.name,
    // B30 inverse (app/sitemap.ts): rows inserted before the normalizer
    // changed still store the space form ("life stance"), which interpolates
    // to a %20 URL that mismatches the canonical kebab URL the sitemap emits.
    // Single-space→hyphen is the exact inverse of the profile resolver's
    // legacy fallback, so the link round-trips.
    href: `/companies/${company.normalizedName.replace(/ /g, '-')}`,
    logoUrl: company.logoUrl,
    isVerified: company.isVerified,
    activeJobs: company._count.jobs,
  }));

  // The `some: activeJobWhere` filter guarantees ≥1, but keep the guard so a
  // future relaxation of the where clause can't advertise "0 open positions".
  const listed = entries.filter((entry) => entry.activeJobs > 0);
  const letterGroups = groupByLetter(listed);
  const populatedLetters = new Set(letterGroups.map((group) => group.letter));

  // Spotlight strip — page 1 only. Single page means the full set is already in
  // memory and can be ranked exactly; paginated means the alphabetical slice
  // can't contain the leaders, so shortlist by the denormalized column and
  // re-rank on the live count the cards display.
  const spotlightSource = totalPages === 1
    ? listed
    : (await prisma.company.findMany({
        where: directoryWhere,
        select: directorySelect,
        orderBy: { jobCount: 'desc' },
        take: SPOTLIGHT_CANDIDATES,
      })).map((company) => ({
        id: company.id,
        name: company.name,
        href: `/companies/${company.normalizedName.replace(/ /g, '-')}`,
        logoUrl: company.logoUrl,
        isVerified: company.isVerified,
        activeJobs: company._count.jobs,
      }));
  const spotlight = currentPage === 1 ? topByActiveJobs(spotlightSource, SPOTLIGHT_COUNT) : [];

  const canonicalPath = buildCompaniesPath(currentPage);
  const prevPath = currentPage > 1 ? buildCompaniesPath(currentPage - 1) : null;
  const nextPath = currentPage < totalPages ? buildCompaniesPath(currentPage + 1) : null;

  // CollectionPage + ItemList derived from the SAME `listed` array the cards
  // render, so the structured data can never describe employers the page does
  // not link (pattern: app/jobs/locations/page.tsx).
  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Companies Hiring ${brand.niche.short}s`,
    description: `Directory of ${totalCompanies.toLocaleString()} employers with active ${brand.niche.descriptor} openings on ${brand.name}.`,
    url: `${brand.baseUrl}${canonicalPath}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: listed.length,
      itemListElement: listed.map((entry, idx) => ({
        '@type': 'ListItem',
        position: (currentPage - 1) * COMPANIES_PER_PAGE + idx + 1,
        name: entry.name,
        url: `${brand.baseUrl}${entry.href}`,
      })),
    },
  };

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: 'Home', url: brand.baseUrl },
          { name: 'Companies', url: `${brand.baseUrl}/companies` },
        ]}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(collectionSchema) }} />
      {/* rel=prev/next: Google retired it as an indexing signal but Bing and
          several answer engines still read it, and it costs nothing. React
          hoists these into <head>. */}
      {prevPath && <link rel="prev" href={`${brand.baseUrl}${prevPath}`} />}
      {nextPath && <link rel="next" href={`${brand.baseUrl}${nextPath}`} />}

      <div className="min-h-screen" style={{ background: '#FDFBF7' }}>
        {/* Hero */}
        <section
          style={{
            background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
            padding: '64px 24px 48px',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#BE185D',
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              marginBottom: '8px',
            }}
          >
            Employers
          </p>
          <h1
            className="font-lora"
            style={{
              fontSize: 'clamp(28px, 4vw, 42px)',
              fontWeight: 700,
              color: '#1A2E35',
              marginBottom: '12px',
            }}
          >
            Companies Hiring {brand.niche.short}s
          </h1>
          <p style={{ fontSize: '16px', color: '#5A4A42', maxWidth: '560px', margin: '0 auto', lineHeight: 1.6 }}>
            {/* Honest range label — never claims to show more than it renders. */}
            Showing {pageRangeLabel(currentPage, listed.length, totalCompanies)} employers with active{' '}
            {brand.niche.descriptor} positions. Jump to a letter, or browse the full A–Z list below.
          </p>
        </section>

        {/* Editorial intro — adds substantive prose so the page isn't just
            a card grid (audit 15 thin-pages CRITICAL). Explains who shows
            up here, why they made the list, and what a candidate should
            consider when evaluating an employer.
            Page 1 only: repeating it verbatim on every paged view is
            boilerplate that dilutes the paged URLs. */}
        {currentPage === 1 && (
        <section style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 24px 0' }}>
          <div style={{ fontSize: '15px', color: '#3D3530', lineHeight: 1.75 }}>
            <p style={{ marginBottom: '16px' }}>
              Every employer below has at least one currently published {brand.niche.short} role on
              {' '}{brand.name}. The list is a mix of <strong>direct employers</strong> —
              health systems, community health centers, Federally
              Qualified Health Centers (FQHCs), VA medical centers, telehealth
              platforms, and private practices — alongside <strong>staffing agencies</strong>{' '}
              that place {brand.niche.short}s into locum and travel assignments. We pull active
              postings from each employer&apos;s career pages and ATS feeds twice
              daily, so the company list reflects who is genuinely hiring now, not
              a static directory.
            </p>
            <p style={{ marginBottom: '16px' }}>
              When evaluating an {brand.niche.short} employer, the questions that matter most are
              practical: <strong>practice authority</strong> in the states they hire
              for (full vs. reduced vs. restricted, plus Nurse Licensure Compact
              membership), <strong>caseload structure</strong> (15-minute follow-ups
              vs. 30-60 minute comprehensive visits), <strong>productivity expectations</strong>{' '}
              (RVU targets, pace), <strong>collaborative-physician requirements</strong>{' '}
              if your state needs them, and what they cover on{' '}
              <strong>malpractice, CME, and EMR/billing infrastructure</strong>.
              Larger health systems and federal employers (VA, IHS) tend to
              standardize these; private practices and telehealth startups vary
              widely.
            </p>
            <p style={{ marginBottom: 0 }}>
              Compensation patterns differ by employer type too. VA roles bundle
              federal pension + EDRP loan repayment up to $200K; FQHCs and CMHCs
              qualify for NHSC repayment; telehealth platforms typically offer the
              highest hourly rates but no benefits; hospital systems offer signing
              bonuses + relocation. Open one of the listings below to see specific
              roles, compensation ranges, and apply paths for that employer.
            </p>
          </div>
        </section>
        )}

        {/* Spotlight — preserves the old `jobCount desc` reading order that the
            A–Z index replaced, so the employers with the most open roles are
            still the first thing a visitor sees. Page 1 only. */}
        {spotlight.length > 0 && (
          <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px 0' }}>
            <h2
              className="font-lora"
              style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}
            >
              Employers with the most open roles
            </h2>
            <p style={{ fontSize: '14px', color: '#7A6A62', margin: '0 0 20px', lineHeight: 1.6 }}>
              Ranked by live active postings, refreshed hourly.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {spotlight.map((entry) => (
                <CompanyCard key={`spotlight-${entry.id}`} entry={entry} />
              ))}
            </div>
          </section>
        )}

        {/* A–Z directory */}
        <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px 64px' }}>
          <h2
            className="font-lora"
            id="a-z"
            style={{ fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 700, color: '#1A2E35', margin: '0 0 16px' }}
          >
            All employers A–Z
          </h2>

          {/* Jump nav. Letters with no employers on this page render as plain
              text rather than links to empty anchors. */}
          <nav
            aria-label="Jump to employers by first letter"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '28px' }}
          >
            {DIRECTORY_LETTERS.map((letter) => {
              const populated = populatedLetters.has(letter);
              const label = letter === '#' ? 'Other' : letter;
              const shared: React.CSSProperties = {
                minWidth: '38px',
                padding: '8px 10px',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 700,
                textAlign: 'center',
                lineHeight: 1.1,
              };
              return populated ? (
                <Link
                  key={letter}
                  href={`#${letterAnchorId(letter)}`}
                  className="letter-jump"
                  style={{
                    ...shared,
                    color: '#BE185D',
                    background: '#FDF2F8',
                    border: '1px solid rgba(190,24,93,0.18)',
                    textDecoration: 'none',
                  }}
                >
                  {label}
                </Link>
              ) : (
                <span
                  key={letter}
                  aria-disabled="true"
                  style={{
                    ...shared,
                    color: '#B9AEA8',
                    background: '#F5F0EB',
                    border: '1px solid rgba(0,0,0,0.03)',
                  }}
                >
                  {label}
                </span>
              );
            })}
          </nav>

          {letterGroups.map((group) => (
            <div key={group.letter} style={{ marginBottom: '36px' }}>
              <h3
                id={letterAnchorId(group.letter)}
                style={{
                  fontSize: '18px',
                  fontWeight: 800,
                  color: '#1A2E35',
                  margin: '0 0 14px',
                  paddingBottom: '8px',
                  borderBottom: '1px solid rgba(90,74,66,0.12)',
                  scrollMarginTop: '120px',
                }}
              >
                {group.letter === '#' ? 'Other' : group.letter}
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#7A6A62', marginLeft: '10px' }}>
                  {group.items.length} {group.items.length === 1 ? 'employer' : 'employers'}
                </span>
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {group.items.map((entry) => (
                  <CompanyCard key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          ))}

          {/* Pagination — only rendered once inventory outgrows one page. */}
          {totalPages > 1 && (
            <nav
              aria-label="Employer directory pagination"
              style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginTop: '8px' }}
            >
              {prevPath ? (
                <Link href={prevPath} rel="prev" className="pager-link" style={pagerButton}>
                  ← Previous
                </Link>
              ) : (
                <span style={{ ...pagerButton, color: '#B9AEA8', background: '#F5F0EB' }}>← Previous</span>
              )}
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#5A4A42' }}>
                Page {currentPage} of {totalPages}
              </span>
              {nextPath ? (
                <Link href={nextPath} rel="next" className="pager-link" style={pagerButton}>
                  Next →
                </Link>
              ) : (
                <span style={{ ...pagerButton, color: '#B9AEA8', background: '#F5F0EB' }}>Next →</span>
              )}
            </nav>
          )}

          {/* Browse all jobs CTA */}
          <div style={{ textAlign: 'center', marginTop: '48px' }}>
            <Link
              href="/jobs"
              style={{
                padding: '14px 32px',
                borderRadius: '16px',
                fontWeight: 700,
                fontSize: '15px',
                background: 'linear-gradient(145deg, #BE185D, #9D174D)',
                color: '#fff',
                textDecoration: 'none',
                display: 'inline-block',
                boxShadow:
                  '4px 4px 12px rgba(190,24,93,0.25), -2px -2px 6px rgba(255,255,255,0.3)',
              }}
            >
              Browse All {brand.niche.short} Jobs
            </Link>
          </div>
        </section>
      </div>

      {/* Hover styles */}
      <style>{`
        .company-card:hover {
          transform: translateY(-4px) !important;
          box-shadow: 12px 12px 28px rgba(0,0,0,0.1), -8px -8px 20px rgba(255,255,255,0.95), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.03) !important;
        }
        .letter-jump:hover,
        .letter-jump:focus-visible {
          background: #BE185D !important;
          color: #fff !important;
          border-color: #BE185D !important;
        }
        .pager-link:hover,
        .pager-link:focus-visible {
          background: #FDF2F8 !important;
          border-color: rgba(190,24,93,0.35) !important;
        }
      `}</style>
    </>
  );
}

/** Pager button token — shared by the enabled links and the disabled ends. */
const pagerButton: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: '12px',
  fontSize: '14px',
  fontWeight: 700,
  color: '#BE185D',
  background: '#FFFFFF',
  border: '1px solid rgba(190,24,93,0.18)',
  textDecoration: 'none',
};

interface DirectoryEntry {
  id: string;
  name: string;
  href: string;
  logoUrl: string | null;
  isVerified: boolean;
  activeJobs: number;
}

/**
 * Directory card. Extracted so the spotlight strip and the A–Z sections render
 * identical markup — the two lists previously would have drifted.
 */
function CompanyCard({ entry }: { entry: DirectoryEntry }) {
  return (
    <Link href={entry.href} style={{ textDecoration: 'none' }}>
      <div
        style={{ ...clayCard, display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer' }}
        className="company-card"
      >
        {/* Logo */}
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '14px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
            fontWeight: 800,
            color: '#fff',
            background: entry.logoUrl
              ? `url(${entry.logoUrl}) center/cover no-repeat`
              : 'linear-gradient(135deg, #F472B6, #BE185D)',
            boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.3), inset -1px -1px 3px rgba(0,0,0,0.08)',
          }}
        >
          {!entry.logoUrl && entry.name.charAt(0).toUpperCase()}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: '#1A2E35',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.name}
            </span>
            {entry.isVerified && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="#3B82F6"
                style={{ flexShrink: 0 }}
                role="img"
                aria-label="Verified employer"
              >
                <path
                  fillRule="evenodd"
                  d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D' }}>
            {entry.activeJobs} open {entry.activeJobs === 1 ? 'position' : 'positions'}
          </span>
        </div>
      </div>
    </Link>
  );
}

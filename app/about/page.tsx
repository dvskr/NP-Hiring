import { brand } from '@/config/brand';
import { Metadata } from 'next';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import VideoJsonLd from '@/components/VideoJsonLd';
import { prisma } from '@/lib/prisma';
import { getSiteStats } from '@/lib/site-stats';
import { canonicalBucketWhere, COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { buildCategoryWhereClause, newGradWhereClause } from '@/lib/filters';
import AboutClient from './AboutClient';

export const revalidate = 3600;

// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot lived in an unpopulated bucket and 400'd on every share
// (pattern: app/for-employers/page.tsx).
const ABOUT_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`About ${brand.name}`)}&type=page`;

// Live review 2026-08-17 item #4c: the previous description claimed "thousands
// of companies" against a directory of ~100 — metadata is a count surface too,
// so it stays count-free rather than quoting a number that drifts.
export const metadata: Metadata = {
  title: `About Us - The #1 Job Board for ${brand.niche.medium}s`,
  description: `Learn about ${brand.name} - the #1 dedicated job board for ${brand.niche.long}s. Active ${brand.niche.short} listings from employers across all 50 states.`,
  openGraph: {
    // OG block was previously images-only — when a non-overriding child page
    // inherits this layout's defaults the social card pulled the wrong title
    // and description (audit 09 M-22). Spelled-out fields ensure the share
    // card matches the page identity.
    title: `About ${brand.name} — The #1 ${brand.niche.medium} Job Board`,
    description: `Built for the ${brand.niche.short} community — ${brand.niche.descriptor} jobs across all 50 states, free for job seekers, transparent for employers.`,
    type: 'website',
    url: `${brand.baseUrl}/about`,
    siteName: brand.name,
    images: [{ url: ABOUT_OG_IMAGE, width: 1200, height: 630, alt: `About ${brand.name}` }],
  },
  twitter: { card: 'summary_large_image', title: `About ${brand.name}`, images: [ABOUT_OG_IMAGE] },
  alternates: { canonical: `${brand.baseUrl}/about` },
};

export default async function AboutPage() {
  // Live review 2026-08-17 items #4a/#4b/#4c: this page previously ran FIVE
  // private count heuristics — a bare `isPublished` total that exceeded what
  // /jobs actually browses, a distinct-companyId "employer" count that
  // disagreed with /companies, an inflated new-grad description-substring
  // heuristic (~50 vs the filter page's honest 3), and a spread-then-OR
  // pattern that silently clobbered the expiry gate (spreading a base where
  // and adding a sibling OR key replaces the base's expiry OR entirely).
  //
  // Now: headline totals come from the cached canonical SiteStat snapshot
  // (lib/site-stats.ts → lib/canonical-counts.ts), and each diorama bucket is
  // the SAME clause its own filter surface uses (/jobs/new-grad,
  // /jobs/inpatient, the Work Mode facet, /jobs/outpatient) composed with the
  // canonical predicate via `canonicalBucketWhere` — nested AND, so no OR can
  // be lost. This page can never again advertise a bucket count its own
  // filter page contradicts.
  //
  // Floor rule: a bucket below COUNT_DISPLAY_FLOOR renders WITHOUT a number
  // (null → the diorama keeps its label, omits the count line). Honest-but-
  // thin beats fabricated; a fabricated 50 is what this replaced.
  const gateCount = (n: number): number | null => (n >= COUNT_DISPLAY_FLOOR ? n : null);

  const [
    { totalJobs, totalCompanies },
    newGradCount,
    inpatientCount,
    remoteCount,
    outpatientCount,
  ] = await Promise.all([
    getSiteStats(),
    prisma.job.count({ where: canonicalBucketWhere(newGradWhereClause()) }),
    prisma.job.count({ where: canonicalBucketWhere(buildCategoryWhereClause('inpatient', { isRemote: { not: true } })) }),
    // "Remote practice" bucket = the same structured signal the Work Mode
    // facet filters on — not a telehealth text-substring heuristic.
    prisma.job.count({ where: canonicalBucketWhere({ isRemote: true }) }),
    prisma.job.count({ where: canonicalBucketWhere(buildCategoryWhereClause('outpatient')) }),
  ]);

  return (
    <>
      <VideoJsonLd pathname="/about" />
      <BreadcrumbSchema items={[
        { name: 'Home', url: brand.baseUrl },
        { name: 'About', url: `${brand.baseUrl}/about` },
      ]} />
      <AboutClient
        totalJobs={totalJobs}
        totalEmployers={totalCompanies}
        dioramaCounts={{
          newGrad: gateCount(newGradCount),
          inpatient: gateCount(inpatientCount),
          telehealth: gateCount(remoteCount),
          outpatient: gateCount(outpatientCount),
        }}
      />
    </>
  );
}

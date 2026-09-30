import { brand } from '@/config/brand';
import { BOARD_DESCRIPTION } from '@/config/niche/copy';
import { Metadata } from 'next';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import VideoJsonLd from '@/components/VideoJsonLd';
import { prisma } from '@/lib/prisma';
import { getSiteStats } from '@/lib/site-stats';
import { canonicalBucketWhere, COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { landingBucketWhere } from '@/lib/pseo/landing-where';
import { getStatesCovered } from '@/lib/states-covered';
import AboutClient from './AboutClient';

export const revalidate = 3600;

// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot lived in an unpopulated bucket and 400'd on every share
// (pattern: app/for-employers/page.tsx).
const ABOUT_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`About ${brand.name}`)}&type=page`;

// Live review 2026-08-17 item #4c: the previous description claimed "thousands
// of companies" against a directory of ~100 — metadata is a count surface too,
// so it stays count-free rather than quoting a number that drifts.
//
// Indexing audit M-08: the title, description and share card no longer claim
// first place among job boards, or "all 50 states" coverage. Nothing measures
// either. They carry the one factual board description instead
// (config/niche/copy.ts BOARD_DESCRIPTION). The title leaves the brand to the
// root layout template, which appends it once.
export const metadata: Metadata = {
  title: `About Us: A Job Board for ${brand.niche.long}s`,
  description: `About ${brand.name}: ${BOARD_DESCRIPTION} Free for job seekers.`,
  openGraph: {
    // OG block was previously images-only — when a non-overriding child page
    // inherits this layout's defaults the social card pulled the wrong title
    // and description (audit 09 M-22). Spelled-out fields ensure the share
    // card matches the page identity.
    title: `About ${brand.name}: A ${brand.niche.long} Job Board`,
    description: `Built for the ${brand.niche.short} community: ${brand.niche.descriptor} jobs from employers' own career sites, free for job seekers and transparent for employers.`,
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

  //
  // Indexing audit M-08: the "States Covered" tile was a hardcoded 50 while
  // the board listed jobs in 44 states. It is measured now, with the helper
  // /for-programs uses, and the tile is omitted when the count is unavailable.
  const [
    { totalJobs, totalCompanies },
    newGradCount,
    inpatientCount,
    remoteCount,
    outpatientCount,
    statesCovered,
  ] = await Promise.all([
    getSiteStats(),
    // CQ-14: the new grad, inpatient and outpatient buckets are the one
    // landing bucket each /jobs/{category} landing, its state pages and its
    // index verdict count with (lib/pseo/landing-where.ts).
    prisma.job.count({ where: canonicalBucketWhere(landingBucketWhere('new-grad')) }),
    prisma.job.count({ where: canonicalBucketWhere(landingBucketWhere('inpatient')) }),
    // "Remote practice" bucket = the same structured signal the Work Mode
    // facet filters on — not a telehealth text-substring heuristic.
    prisma.job.count({ where: canonicalBucketWhere({ isRemote: true }) }),
    prisma.job.count({ where: canonicalBucketWhere(landingBucketWhere('outpatient')) }),
    getStatesCovered(),
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
        statesCovered={statesCovered}
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

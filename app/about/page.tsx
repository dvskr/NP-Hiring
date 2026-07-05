import { brand } from '@/config/brand';
import { Metadata } from 'next';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import VideoJsonLd from '@/components/VideoJsonLd';
import { prisma } from '@/lib/prisma';
import AboutClient from './AboutClient';

const STORAGE_BASE = brand.assets.storageBase;

export const revalidate = 3600;

const ABOUT_OG_IMAGE = `${STORAGE_BASE}/storage/v1/object/public/site-assets/images/pages/about-pmhnp-hiring-platform.webp`;

export const metadata: Metadata = {
  title: `About Us - The #1 Job Board for ${brand.niche.medium}s`,
  description: `Learn about ${brand.name} - the #1 dedicated job board for ${brand.niche.long}s. Thousands of jobs from thousands of companies across all 50 states.`,
  openGraph: {
    // OG block was previously images-only — when a non-overriding child page
    // inherits this layout's defaults the social card pulled the wrong title
    // and description (audit 09 M-22). Spelled-out fields ensure the share
    // card matches the page identity.
    title: `About ${brand.name} — The #1 ${brand.niche.medium} Job Board`,
    description: `Built for the ${brand.niche.short} community — thousands of ${brand.niche.descriptor} jobs across all 50 states, free for job seekers, transparent for employers.`,
    type: 'website',
    url: `${brand.baseUrl}/about`,
    siteName: brand.name,
    images: [{ url: ABOUT_OG_IMAGE, width: 1280, height: 900, alt: `About ${brand.name}` }],
  },
  twitter: { card: 'summary_large_image', title: `About ${brand.name}`, images: [ABOUT_OG_IMAGE] },
  alternates: { canonical: `${brand.baseUrl}/about` },
};

export default async function AboutPage() {
  // SEO Fix M16: stop hardcoding About-page diorama numbers ("320 cohorts /
  // 1,240 roles / 2,105 listings / 885 openings"). Pull live counts from
  // Prisma so the page never lies when the catalog shifts. Buckets are
  // approximate text-search heuristics, sufficient for editorial labeling
  // and consistent with how other pSEO surfaces classify roles.
  const baseWhere = {
    isPublished: true,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  } as const;

  const [
    totalJobs,
    totalEmployers,
    newGradCount,
    inpatientCount,
    remoteOrTelehealthCount,
    outpatientCount,
  ] = await Promise.all([
    prisma.job.count({ where: { isPublished: true } }),
    prisma.job.findMany({ where: { isPublished: true }, select: { companyId: true }, distinct: ['companyId'] }).then(r => r.length),
    prisma.job.count({ where: { ...baseWhere, OR: [{ title: { contains: 'new grad', mode: 'insensitive' } }, { description: { contains: 'new graduate', mode: 'insensitive' } }, { experienceLevel: 'Entry-Level' }] } }),
    prisma.job.count({ where: { ...baseWhere, OR: [{ title: { contains: 'inpatient', mode: 'insensitive' } }, { setting: { contains: 'inpatient', mode: 'insensitive' } }] } }),
    prisma.job.count({ where: { ...baseWhere, OR: [{ isRemote: true }, { title: { contains: 'telehealth', mode: 'insensitive' } }, { setting: { contains: 'telehealth', mode: 'insensitive' } }] } }),
    prisma.job.count({ where: { ...baseWhere, OR: [{ title: { contains: 'outpatient', mode: 'insensitive' } }, { setting: { contains: 'outpatient', mode: 'insensitive' } }] } }),
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
        totalEmployers={totalEmployers}
        dioramaCounts={{
          newGrad: newGradCount,
          inpatient: inpatientCount,
          telehealth: remoteOrTelehealthCount,
          outpatient: outpatientCount,
        }}
      />
    </>
  );
}

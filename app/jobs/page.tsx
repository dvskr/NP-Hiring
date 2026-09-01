import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { buildWhereClause, parseFiltersFromParams } from '@/lib/filters';
import { buildJobsOrderBy, type JobSort } from '@/lib/utils/job-sort';
import { slugify } from '@/lib/utils';
import { STAT_SOURCES } from '@/lib/stats-sources';
import JobsPageClient from './JobsPageClient';
import { Job } from '@/lib/types';


// Nav-only params do not constitute a user filter — paginated and sorted
// views of the unfiltered list should still be crawled (page>=2 is noindexed
// separately to avoid duplicate-content; sort variants canonical to /jobs).
const NAV_ONLY_PARAMS = new Set(['page', 'sort']);

// ISR: Revalidate every 60 seconds
export const revalidate = 60;

// ─── /jobs hub editorial + citable FAQ (P1 #17) ─────────────────────────────
// TRUTH RULE: every figure below derives from lib/stats-sources.ts or the
// live DB count passed in — never an invented statistic. The FAQPage schema
// serializes the SAME array the visible accordion renders.

interface HubFaq { question: string; answer: string; }

function buildJobsHubFaqs(totalJobs: number): HubFaq[] {
  const median = `${STAT_SOURCES.averageSalary.formatted} (${STAT_SOURCES.averageSalary.source})`;
  return [
    {
      question: `How many ${brand.niche.descriptor} jobs are listed right now?`,
      answer: `There are currently ${totalJobs.toLocaleString()} ${brand.niche.descriptor} and APRN jobs listed, spanning states, specialties, and work settings. Listings are refreshed daily as new roles are ingested and stale postings are retired.`,
    },
    {
      question: `What is the average ${brand.niche.descriptor} salary?`,
      answer: `${brand.niche.long}s earn a median annual wage of ${median}. Actual pay varies with specialty, practice setting, experience, and state — many listings include posted salary ranges, and the salary guide breaks pay down state by state.`,
    },
    {
      question: `How fast is demand for ${brand.niche.descriptor}s growing?`,
      answer: `The BLS projects ${STAT_SOURCES.blsGrowth2034.formatted} employment growth for ${brand.niche.descriptor}s from 2024 to 2034 (${STAT_SOURCES.blsGrowth2034.source}) — among the fastest-growing occupations in the United States.`,
    },
    {
      question: `Where can ${brand.niche.descriptor}s practice independently?`,
      answer: `${STAT_SOURCES.fullPracticeStates.formatted} grant ${brand.niche.descriptor}s Full Practice Authority (${STAT_SOURCES.fullPracticeStates.source}), meaning they can evaluate, diagnose, and prescribe without physician oversight. The remaining states require a collaborative or supervisory agreement — browse jobs by state to see local practice environments.`,
    },
    {
      question: `Which specialties and job types can I browse?`,
      answer: `Dedicated hubs cover the major NP specialties — family practice, adult-gerontology, pediatric, acute care, emergency, and more — plus APRN roles (CRNA, CNM, CNS), work settings such as remote, telehealth, and travel, and job types from full-time to per-diem, contract, and 1099.`,
    },
    {
      question: `Can I get new ${brand.niche.descriptor} jobs by email?`,
      answer: `Yes — free job alerts deliver new ${brand.niche.descriptor} roles matching your preferences to your inbox. Alerts can be changed or unsubscribed at any time.`,
    },
  ];
}

interface JobsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Generate dynamic metadata based on active filters
 */
export async function generateMetadata({ searchParams }: JobsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const urlParams = new URLSearchParams();

  // Convert searchParams to URLSearchParams
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => urlParams.append(key, v));
    } else if (value) {
      urlParams.set(key, value);
    }
  });

  const filters = parseFiltersFromParams(urlParams);

  // Get total job count
  const whereClause = buildWhereClause(filters);
  const totalJobs = await prisma.job.count({ where: whereClause });
  const jobCountDisplay = totalJobs > 1000
    ? `${(Math.floor(totalJobs / 100) * 100).toLocaleString()}+`
    : totalJobs.toLocaleString();

  // Build dynamic title and description based on filters.
  //
  // P7 runtime fix D6: dedupe the niche pair. The brand data is correct for
  // this niche (short === medium === 'NP' is a legitimate state — the NP
  // board has no narrower credential label), so the TEMPLATE must collapse
  // "X & X" to "X" instead of rendering "Browse 851 NP & NP Jobs Near Me".
  const nicheTitlePair = brand.niche.short === brand.niche.medium
    ? brand.niche.short
    : `${brand.niche.short} & ${brand.niche.medium}`;
  let title = `Browse ${jobCountDisplay} ${nicheTitlePair} Jobs Near Me`;
  // SEO Fix #7: trim default desc to ≤160 chars (Google SERP cap). Previous
  // 280-char default got truncated and lost the value-prop tail.
  let description = `Search ${jobCountDisplay} ${brand.niche.short} & ${brand.niche.adjective} NP jobs by state, salary, and type — remote, telehealth, in-person, travel, locum & per diem. Updated daily.`;

  // Customize based on active filters
  const titleParts: string[] = [];

  if (filters.workMode.includes('remote')) {
    titleParts.push('Remote');
  }
  if (filters.location) {
    titleParts.push(`in ${filters.location}`);
  }
  if (filters.jobType.length > 0) {
    titleParts.push(filters.jobType[0]);
  }

  if (titleParts.length > 0) {
    title = `${jobCountDisplay} ${titleParts.join(' ')} ${brand.niche.short} Jobs`;
    description = `Find ${jobCountDisplay} ${titleParts.join(' ').toLowerCase()} ${brand.niche.adjective} nurse practitioner positions. ${description}`;
  }

  // Distinguish user filters from nav params (?page, ?sort).
  //  - User filters → noindex,follow + canonical to /jobs (rolls signal into root)
  //  - page>=2     → noindex,follow + self-canonical (lets Googlebot crawl deep
  //                  pages to discover job-detail URLs without competing with /jobs)
  //  - sort variant → canonical to /jobs (sort is a UI affordance, not a new page)
  //  - totalJobs===0 → noindex,follow regardless of filters; an empty body at
  //                  HTTP 200 is a soft 404 in Google's classifier.
  //  - Page 1, no filters, totalJobs > 0 → index normally with canonical to /jobs
  const userFilterKeys = Object.keys(params).filter((k) => !NAV_ONLY_PARAMS.has(k));
  const hasUserFilters = userFilterKeys.length > 0;
  const pageNum = Math.max(1, parseInt((params.page as string) || '1'));
  const isPaginated = pageNum > 1;
  const isEmpty = totalJobs === 0;
  const shouldNoindex = hasUserFilters || isPaginated || isEmpty;

  if (isPaginated && !hasUserFilters) {
    title = `${title} — Page ${pageNum}`;
  }

  // Self-canonical for paginated views; otherwise root /jobs.
  const canonical = isPaginated && !hasUserFilters
    ? `${brand.baseUrl}/jobs?page=${pageNum}`
    : `${brand.baseUrl}/jobs`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} - Find Your Next Position`,
      description,
      type: 'website',
      // P0 OG sweep: the previous Supabase page-screenshot 400'd on every
      // social share of /jobs and every filtered jobs URL. The board's own
      // /api/og edge renderer carries the live filter-aware title instead
      // (same pattern as app/for-employers/page.tsx).
      images: [{ url: `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${jobCountDisplay} ${brand.niche.short} Jobs`)}&type=page`, width: 1200, height: 630, alt: `${brand.niche.short} Job Board — Browse ${brand.niche.adjective} nurse practitioner jobs` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${brand.baseUrl}/api/og?title=${encodeURIComponent(`${jobCountDisplay} ${brand.niche.short} Jobs`)}&type=page`],
    },
    alternates: {
      canonical,
    },
    ...(shouldNoindex && {
      robots: {
        index: false,
        follow: true,
      },
    }),
  };
}

/**
 * Server Component: Fetches filtered jobs based on URL params
 */
export default async function JobsPage({ searchParams }: JobsPageProps) {
  const params = await searchParams;

  // Convert to URLSearchParams for filter parsing
  const urlParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(v => urlParams.append(key, v));
    } else if (value) {
      urlParams.set(key, value);
    }
  });

  // Parse filters from URL (same logic as API)
  const filters = parseFiltersFromParams(urlParams);
  const where = buildWhereClause(filters);

  // Get page and sort from params
  const page = parseInt((params.page as string) || '1');
  const sort = (params.sort as string) || 'best';
  const limit = 50;
  const skip = (page - 1) * limit;

  // Build orderBy via the single source of truth (lib/utils/job-sort). This is
  // the bug fix: the SSR render previously inlined a 'best' order WITHOUT the
  // employer-first lead, so employer jobs appeared mid-list until the client
  // re-fetched /api/jobs. Now SSR and CSR build the identical order per sort.
  const orderBy = buildJobsOrderBy(sort as JobSort);

  // Fetch inside try/catch, but construct JSX AFTER it — React renders JSX
  // lazily, so component errors would never be caught here anyway
  // (react-hooks/error-boundaries).
  let jobs: Job[] = [];
  let total = 0;
  try {
    // Fetch jobs with same logic as API route
    const [rawJobs, jobCount] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          slug: true,
          title: true,
          employer: true,
          location: true,
          city: true,
          state: true,
          jobType: true,
          isRemote: true,
          isHybrid: true,
          displaySalary: true,
          normalizedMinSalary: true,
          normalizedMaxSalary: true,
          salaryPeriod: true,
          description: true,
          descriptionSummary: true,
          createdAt: true,
          isFeatured: true,
          isVerifiedEmployer: true,
          originalPostedAt: true,
          mode: true,
          applyLink: true,
          applyOnPlatform: true,
          sourceType: true,
          // Phase 1 experience chip — JobCard renders the pill from these.
          experienceLabel: true,
          newGradFriendly: true,
          employerJobs: { select: { companyLogoUrl: true } },
        },
      }),
      prisma.job.count({ where }),
    ]);

    // Map employer logo onto job objects
    jobs = rawJobs.map(j => ({ ...j, companyLogoUrl: j.employerJobs?.companyLogoUrl || null, employerJobs: undefined })) as unknown as Job[];
    total = jobCount;
  } catch (error) {
    console.error('Error fetching jobs on server:', error);

    // Fallback: render client with empty data
    return (
      <>
        <JobsPageClient
          initialJobs={[]}
          initialTotal={0}
          initialPage={1}
          initialTotalPages={0}
        />
      </>
    );
  }

  // Hub editorial + FAQ render only on the canonical unfiltered first page —
  // filtered and paginated views are noindexed and stay listing-only.
  const userFilterKeys = Object.keys(params).filter((k) => !NAV_ONLY_PARAMS.has(k));
  const showHubEditorial = userFilterKeys.length === 0 && page === 1 && total > 0;
  const hubFaqs = showHubEditorial ? buildJobsHubFaqs(total) : [];
  const hubFaqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: hubFaqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };

  // Build ItemList schema for job carousel rich results
  const jobListSchema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${brand.niche.long} & APRN Jobs`,
    numberOfItems: total,
    itemListElement: jobs.slice(0, 10).map((job, i) => {
      const j = job as { id: string; slug?: string | null; title: string };
      const slug = j.slug || slugify(j.title, j.id);
      return {
        '@type': 'ListItem',
        position: i + 1,
        name: job.title,
        url: `${brand.baseUrl}/jobs/${slug}`,
      };
    }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobListSchema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }}
      />
      {/* Breadcrumb renders INSIDE JobsPageClient, in the right-hand main
          column above the H1 — that puts it at the top-right corner of
          the FILTERS panel (not above it, where the fixed sidebar would
          paint over it). Same JSON-LD BreadcrumbList serializes inline
          regardless of where the component lives, so SEO is unchanged. */}
      <JobsPageClient
        initialJobs={jobs}
        initialTotal={total}
        initialPage={page}
        initialTotalPages={Math.ceil(total / limit)}
      />
      {showHubEditorial && (
        <div style={{ backgroundColor: '#FDFBF7' }}>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(hubFaqSchema).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }}
          />

          {/* Editorial block — internal-linking mesh into the category hubs */}
          <section aria-labelledby="jobs-hub-editorial" style={{ maxWidth: '1000px', margin: '0 auto', padding: '56px 20px 8px' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>
              About This Board
            </p>
            <h2 id="jobs-hub-editorial" className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 32px)', fontWeight: 700, color: '#1A2E35', marginBottom: '18px' }}>
              Explore {brand.niche.descriptor} jobs by specialty, setting, and state
            </h2>
            <p style={{ fontSize: '15px', color: '#5A4A42', lineHeight: 1.75, margin: '0 0 14px' }}>
              {brand.legal.brandDisplayName} lists {brand.niche.descriptor} and APRN roles across every major
              specialty — from <Link href="/jobs/family-practice" style={{ color: '#BE185D', fontWeight: 600 }}>family practice</Link> and{' '}
              <Link href="/jobs/acute-care" style={{ color: '#BE185D', fontWeight: 600 }}>acute care</Link> to{' '}
              <Link href="/jobs/anesthesia" style={{ color: '#BE185D', fontWeight: 600 }}>nurse anesthesia (CRNA)</Link> and{' '}
              <Link href="/jobs/midwifery" style={{ color: '#BE185D', fontWeight: 600 }}>nurse midwifery (CNM)</Link> — plus dedicated
              hubs for <Link href="/jobs/remote" style={{ color: '#BE185D', fontWeight: 600 }}>remote</Link>,{' '}
              <Link href="/jobs/telehealth" style={{ color: '#BE185D', fontWeight: 600 }}>telehealth</Link>, and{' '}
              <Link href="/jobs/travel" style={{ color: '#BE185D', fontWeight: 600 }}>travel</Link> work.
            </p>
            <p style={{ fontSize: '15px', color: '#5A4A42', lineHeight: 1.75, margin: '0 0 14px' }}>
              Salary transparency matters here: listings surface posted pay ranges wherever the employer provides
              them, and the <Link href="/salary-guide" style={{ color: '#BE185D', fontWeight: 600 }}>salary guide</Link> tracks
              state-by-state figures. Nationally, {brand.niche.descriptor}s earn a median annual wage of{' '}
              {STAT_SOURCES.averageSalary.formatted} ({STAT_SOURCES.averageSalary.source}).
            </p>
            <p style={{ fontSize: '15px', color: '#5A4A42', lineHeight: 1.75, margin: 0 }}>
              Where you practice shapes how you practice — {STAT_SOURCES.fullPracticeStates.formatted} grant Full
              Practice Authority ({STAT_SOURCES.fullPracticeStates.source}). Browse{' '}
              <Link href="/jobs/locations" style={{ color: '#BE185D', fontWeight: 600 }}>jobs by location</Link> to see
              local inventory, or set a free <Link href="/job-alerts" style={{ color: '#BE185D', fontWeight: 600 }}>job alert</Link>{' '}
              to get new roles by email.
            </p>
          </section>

          {/* Citable FAQ — same array feeds the FAQPage schema above */}
          <section aria-labelledby="jobs-hub-faq" style={{ maxWidth: '1000px', margin: '0 auto', padding: '40px 20px 64px' }}>
            <h2 id="jobs-hub-faq" className="font-lora" style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 700, color: '#1A2E35', marginBottom: '20px' }}>
              {brand.niche.long} jobs — frequently asked questions
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {hubFaqs.map((faq, index) => (
                <details
                  key={index}
                  style={{
                    background: '#FFFFFF',
                    borderRadius: '16px',
                    border: '1px solid rgba(0,0,0,0.05)',
                    boxShadow: '4px 4px 12px rgba(0,0,0,0.04), -2px -2px 8px rgba(255,255,255,0.8)',
                    padding: '18px 22px',
                  }}
                >
                  <summary style={{ fontSize: '15px', fontWeight: 600, color: '#1A2E35', cursor: 'pointer', lineHeight: 1.4 }}>
                    {faq.question}
                  </summary>
                  <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.7, margin: '12px 0 0' }}>
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

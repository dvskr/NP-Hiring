/**
 * app/jobs/[slug]/employer-cache.ts
 *
 * Employer-scoped reads the job page makes, through a daily cache shared by
 * every job from the same employer (2026-11-23).
 *
 * After the first round (./place-cache.ts, 2026-11-21) an uncached job render
 * still read the employer's Company row twice (by id and by name), counted
 * and listed the employer's live jobs for the About card, and sometimes
 * counted them again for a profile check. Crawlers walk one employer's jobs
 * together, so those reads repeated across dozens of renders at once on a
 * 2-to-3-connection pool, and Sentry kept reporting pool connect timeouts on
 * GET /jobs/[slug]. Each employer now pays for them once a day.
 *
 * The window is JOB_PAGE_PLACE_CACHE_SECONDS, the job page's own: a shorter
 * one would shorten the page's ISR window (the footer bug of 2026-11-18,
 * guarded by tests/regressions/job-page-isr-window.test.ts).
 *
 * unstable_cache stores JSON, so a cached Company row's dates come back as
 * strings. The job page only tests `claimVerifiedAt` for truthiness, which
 * AboutEmployer already types as `Date | string | null`.
 */
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { PUBLISHED_LISTING_WHERE } from '@/lib/pseo/listing-where';
import type { Company } from '@/lib/types';
import { getEmployerFacts, type EmployerFacts } from './employer-facts';
import { JOB_PAGE_PLACE_CACHE_SECONDS } from './place-cache';

async function readCompanyMatch(companyId: string | null, employerName: string): Promise<Company | null> {
  const normalizedName = employerName.toLowerCase().trim();
  const [companyById, companyByName] = await Promise.all([
    companyId ? prisma.company.findUnique({ where: { id: companyId } }) : Promise.resolve(null),
    prisma.company.findFirst({
      where: {
        OR: [
          { normalizedName },
          { name: { equals: employerName, mode: 'insensitive' } },
        ],
      },
    }),
  ]);
  return (companyById ?? companyByName ?? null) as Company | null;
}

async function readEmployerJobCount(employerName: string): Promise<number> {
  return prisma.job.count({ where: { employer: employerName, ...PUBLISHED_LISTING_WHERE } });
}

interface CompanyKey {
  id: string;
  name: string;
  normalizedName: string;
}

async function readEmployerFacts(
  employer: string,
  companyId: string | null,
  company: CompanyKey | null,
): Promise<EmployerFacts> {
  return getEmployerFacts({ employer, companyId }, company);
}

const cachedCompanyMatch = unstable_cache(readCompanyMatch, ['job-page-company-match'], {
  revalidate: JOB_PAGE_PLACE_CACHE_SECONDS,
});

const cachedEmployerJobCount = unstable_cache(readEmployerJobCount, ['job-page-employer-job-count'], {
  revalidate: JOB_PAGE_PLACE_CACHE_SECONDS,
});

const cachedEmployerFacts = unstable_cache(readEmployerFacts, ['job-page-employer-facts'], {
  revalidate: JOB_PAGE_PLACE_CACHE_SECONDS,
});

/** The employer's Company row, by the job's companyId first, else by name. */
export function getCachedCompanyMatch(companyId: string | null, employerName: string): Promise<Company | null> {
  return cachedCompanyMatch(companyId, employerName);
}

/** Live listings for an employer string, for the synthesized company card. */
export function getCachedEmployerJobCount(employerName: string): Promise<number> {
  return cachedEmployerJobCount(employerName);
}

/** Prefix of the stand-in company the job page builds from EmployerJob (see employer-facts.ts). */
const SYNTHESIZED_COMPANY_PREFIX = 'employer-';

/**
 * The About card's employer facts. Only the company's id and names go into
 * the key, so jobs that share an employer share one entry.
 *
 * A synthesized stand-in carries a per-job id ('employer-' + job id), which
 * would give every job its own entry. getEmployerFacts reads only that
 * prefix from it (a stand-in has no profile page), so it is keyed as one
 * employer-scoped stand-in instead.
 */
export function getCachedEmployerFacts(
  job: { employer: string; companyId: string | null },
  company: CompanyKey | null,
): Promise<EmployerFacts> {
  let key: CompanyKey | null = null;
  if (company) {
    key = company.id.startsWith(SYNTHESIZED_COMPANY_PREFIX)
      ? { id: SYNTHESIZED_COMPANY_PREFIX, name: job.employer, normalizedName: job.employer.toLowerCase().trim() }
      : { id: company.id, name: company.name, normalizedName: company.normalizedName };
  }
  return cachedEmployerFacts(job.employer, job.companyId, key);
}

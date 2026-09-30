/**
 * app/jobs/[slug]/employer-facts.ts
 *
 * Real facts about the job's employer for the "About {employer}" card
 * (indexing audit 2026-09, CQ-11 and plan fixSoon 14). The card used to
 * print the same sentence on every page ("{Employer} is hiring for this NP
 * position. Nurse Practitioners play a critical role ..."), which is
 * boilerplate, not value an aggregator adds. It now shows what this board
 * actually holds for the employer, counted on the canonical predicate:
 * open roles, the states they are in, the posted pay range, and a link to
 * the company profile when that page exists. With none of those, the card
 * is omitted.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { canonicalBucketWhere } from '@/lib/canonical-counts';
import { selectStates } from '@/lib/pseo/listing-facts';
import { companyProfilePath } from '@/lib/company-slug';
import { resolveRowStateName } from '@/lib/company-profile-facts';

/** A pay range needs at least this many listings with employer-stated pay. */
export const EMPLOYER_PAY_MIN_LISTINGS = 2;
/** States named in the card. */
export const EMPLOYER_TOP_STATES = 3;
/** Rows pulled for the in-memory tally; the count is a separate query. */
const EMPLOYER_ROW_CAP = 1000;

export interface EmployerStateFact {
  name: string;
  count: number;
}

export interface EmployerPayFact {
  /** Annualized, employer-stated pay (normalized columns). */
  min: number;
  max: number;
  /** Listings the range is drawn from. */
  listings: number;
}

export interface EmployerFacts {
  /** Canonical active roles for this employer, this job included. */
  openRoles: number;
  /** Distinct states across those roles. */
  stateCount: number;
  topStates: EmployerStateFact[];
  postedPay: EmployerPayFact | null;
  /** The canonical `/companies/{display-name slug}` when the company page exists, else null. */
  companyPath: string | null;
}

export interface EmployerFactRow {
  state: string | null;
  stateCode: string | null;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
  salaryIsEstimated: boolean;
}

/** States and posted pay from the employer's rows. Pure. */
export function summarizeEmployerRows(
  rows: readonly EmployerFactRow[],
): Pick<EmployerFacts, 'stateCount' | 'topStates' | 'postedPay'> {
  const states = selectStates(rows.map((row) => ({ state: resolveRowStateName(row) })));

  const paid = rows.filter(
    (row) => !row.salaryIsEstimated && typeof row.normalizedMinSalary === 'number' && row.normalizedMinSalary > 0,
  );
  const postedPay: EmployerPayFact | null = paid.length >= EMPLOYER_PAY_MIN_LISTINGS
    ? {
        min: Math.min(...paid.map((row) => row.normalizedMinSalary as number)),
        max: Math.max(...paid.map((row) => row.normalizedMaxSalary ?? (row.normalizedMinSalary as number))),
        listings: paid.length,
      }
    : null;

  return {
    stateCount: states.length,
    topStates: states.slice(0, EMPLOYER_TOP_STATES).map(({ name, count }) => ({ name, count })),
    postedPay,
  };
}

/** A matched Company row, or the synthesized stand-in the page builds from EmployerJob. */
interface CompanyRef {
  id: string;
  /** Display name: the canonical profile slug derives from it. */
  name: string;
  normalizedName: string;
}

/** Synthesized stand-ins carry this id prefix and have no profile page. */
const SYNTHESIZED_COMPANY_PREFIX = 'employer-';

/**
 * The employer's facts. Rows are matched by companyId when the job carries
 * one (the company page's own scope), else by the employer string. The
 * company path is set only for a real Company row with at least one
 * canonical active job, because the profile answers 410 at zero.
 */
export async function getEmployerFacts(
  job: { employer: string; companyId: string | null },
  company: CompanyRef | null,
): Promise<EmployerFacts> {
  const bucket: Prisma.JobWhereInput = job.companyId
    ? { companyId: job.companyId }
    : { employer: { equals: job.employer, mode: 'insensitive' } };
  const where = canonicalBucketWhere(bucket);

  const isRealCompany = !!company && !company.id.startsWith(SYNTHESIZED_COMPANY_PREFIX);
  const companyHasActiveJobs = async (): Promise<boolean> => {
    if (!company || !isRealCompany) return false;
    if (job.companyId === company.id) return true; // this live job counts
    const count = await prisma.job.count({ where: canonicalBucketWhere({ companyId: company.id }) });
    return count > 0;
  };

  const [openRoles, rows, hasProfile] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      select: {
        state: true,
        stateCode: true,
        normalizedMinSalary: true,
        normalizedMaxSalary: true,
        salaryIsEstimated: true,
      },
      take: EMPLOYER_ROW_CAP,
    }),
    companyHasActiveJobs(),
  ]);

  return {
    openRoles,
    ...summarizeEmployerRows(Array.isArray(rows) ? rows : []),
    // The canonical display-name slug (lib/company-slug.ts). The old
    // normalizedName form answers a 308, so linking it would point every
    // employer link at a redirecting twin.
    companyPath: hasProfile && company
      ? companyProfilePath({ name: company.name, normalizedName: company.normalizedName })
      : null,
  };
}

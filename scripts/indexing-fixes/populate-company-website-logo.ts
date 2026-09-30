/**
 * scripts/indexing-fixes/populate-company-website-logo.ts: indexing audit
 * GFJ-08. Fills Company.website and Company.logoUrl for the employers behind
 * live jobs, so the JobPosting hiringOrganization carries sameAs and logo.
 *
 * WHY
 *   The job page passes the matched Company row's website and logo into the
 *   JobPosting markup, but the Company rows behind the live jobs had neither,
 *   so every aggregated listing emitted hiringOrganization with a name only.
 *   Google uses sameAs to match the employer entity and shows the logo beside
 *   the listing.
 *
 * WHAT IT DOES (rules in lib/company-web-identity.ts; the per-company
 * decision is the pure planCompanyWebIdentity in ./lib/company-web-plan.ts,
 * tested in tests/scripts/company-web-plan.test.ts)
 *   For every company with at least one live job (the job sitemap's
 *   predicate) and no website or no logo:
 *     website  from an apply link on the employer's own domain, else a link
 *              or e-mail domain in its own job descriptions, and only when the
 *              domain names the employer (ATS and job-board hosts never
 *              count). With --fetch the homepage is requested and must name
 *              the employer too, or the website is not used.
 *     logo     only with --fetch: the homepage's JSON-LD Organization logo,
 *              else its apple-touch-icon, else a declared icon of 112 pixels
 *              or more.
 *   A stored website or logo is never replaced; only empty fields are
 *   filled. Companies no rule resolves are listed as UNRESOLVED: fill those
 *   by hand on /admin/companies (Website and logo), which writes through
 *   PATCH /api/admin/companies/:id/profile with an audit row.
 *   Each write is guarded by the empty value it was planned from and leaves
 *   an audit_logs row (action 'indexing_fix.company_web_identity').
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database)
 *   1. Dry run from stored data only (reads the database, no network):
 *        node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *          --project scripts/tsconfig.json scripts/indexing-fixes/populate-company-website-logo.ts
 *   2. Dry run with --fetch to verify each homepage and find logos (one
 *      polite request per company to the employer's own site, 400 ms apart;
 *      nothing is written). Filters: --employer="LifeStance", --ids=a,b
 *      (company ids), --limit=N.
 *   3. Review, then repeat the SAME command with --apply (one transaction;
 *      a company whose field was filled since the dry run aborts the run).
 *   Job and company pages pick the values up on their next ISR refresh (an
 *   hour at most).
 */
import { ENV_FILE } from './lib/load-env';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { parseHomepageFacts } from '@/lib/company-web-identity';
import {
  planCompanyWebIdentity,
  siteToRead,
  type CompanyWebRow,
  type FetchedHomepage,
} from './lib/company-web-plan';
import { parseCli, printHeader, printFooter } from './lib/runtime';

const SCRIPT = 'scripts/indexing-fixes/populate-company-website-logo.ts';
const FETCH_GAP_MS = 400;
const FETCH_TIMEOUT_MS = 8_000;
const JOBS_READ_PER_COMPANY = 40;
const USER_AGENT = 'NPHiringBot/1.0 (+https://nphiring.com; employer profile check)';

interface CompanyPlan {
  company: CompanyWebRow;
  website: string | null;
  logoUrl: string | null;
  notes: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET a homepage and read its name and logo; null on any failure. */
async function fetchHomepage(url: string): Promise<FetchedHomepage | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, redirect: 'follow', signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    const html = (await res.text()).slice(0, 500_000);
    const finalUrl = res.url || url;
    return { finalUrl, facts: parseHomepageFacts(html, finalUrl) };
  } catch {
    return null;
  }
}

/**
 * The fill for one company (rules in ./lib/company-web-plan.ts). With
 * --fetch the employer's homepage is read first, one polite request.
 */
async function planCompany(company: CompanyWebRow, fetchPages: boolean): Promise<CompanyPlan> {
  const site = siteToRead(company);
  let page: FetchedHomepage | null | undefined;
  if (fetchPages && site) {
    page = await fetchHomepage(site);
    await sleep(FETCH_GAP_MS);
  }
  return { company, ...planCompanyWebIdentity(company, page) };
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  const fetchPages = process.argv.includes('--fetch');
  printHeader(
    'Populate employer website and logo for JobPosting hiringOrganization (GFJ-08)',
    `Writes Company.website and Company.logoUrl where empty.${fetchPages ? ' Reads each employer homepage (--fetch).' : ' No network reads (add --fetch for homepages and logos).'}`,
    opts,
    ENV_FILE,
  );

  const now = new Date();
  const where: Prisma.CompanyWhereInput = {
    AND: [
      { OR: [{ website: null }, { logoUrl: null }] },
      { jobs: { some: activeIndexableJobWhere(now) } },
      ...(opts.employer ? [{ name: { contains: opts.employer, mode: 'insensitive' as const } }] : []),
      ...(opts.ids ? [{ id: { in: opts.ids } }] : []),
    ],
  };
  const companies: CompanyWebRow[] = await prisma.company.findMany({
    where,
    select: {
      id: true,
      name: true,
      website: true,
      logoUrl: true,
      jobs: {
        where: activeIndexableJobWhere(now),
        select: { applyLink: true, description: true },
        orderBy: { createdAt: 'desc' },
        take: JOBS_READ_PER_COMPANY,
      },
    },
    orderBy: { name: 'asc' },
  });
  console.log(`Read ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} with live jobs and an empty website or logo.`);

  const plans: CompanyPlan[] = [];
  const unresolved: CompanyPlan[] = [];
  for (const company of companies) {
    if (opts.limit !== null && plans.length >= opts.limit) break;
    const plan = await planCompany(company, fetchPages);
    if (plan.website || plan.logoUrl) plans.push(plan);
    else unresolved.push(plan);
  }

  for (const plan of plans) {
    console.log('');
    console.log(`- UPDATE company ${plan.company.id} | ${plan.company.name} | ${plan.company.jobs.length} live job(s) read`);
    if (plan.website) console.log(`  website: null -> ${JSON.stringify(plan.website)}`);
    if (plan.logoUrl) console.log(`  logoUrl: null -> ${JSON.stringify(plan.logoUrl)}`);
    for (const note of plan.notes) console.log(`  note: ${note}`);
  }
  if (unresolved.length > 0) {
    console.log('');
    console.log(`UNRESOLVED (no rule found an employer website or logo; fill by hand on /admin/companies): ${unresolved.length}`);
    for (const plan of unresolved) {
      console.log(`  ${plan.company.id} | ${plan.company.name}${plan.notes.length ? ` | ${plan.notes.join('; ')}` : ''}`);
    }
  }

  if (opts.apply && plans.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        for (const plan of plans) {
          const data: Prisma.CompanyUpdateManyMutationInput = {
            ...(plan.website ? { website: plan.website } : {}),
            ...(plan.logoUrl ? { logoUrl: plan.logoUrl } : {}),
          };
          const guard: Prisma.CompanyWhereInput = {
            id: plan.company.id,
            ...(plan.website ? { website: null } : {}),
            ...(plan.logoUrl ? { logoUrl: null } : {}),
          };
          const res = await tx.company.updateMany({ where: guard, data });
          if (res.count !== 1) {
            throw new Error(`Company ${plan.company.id} changed after the plan was made. Nothing was written; run the dry run again.`);
          }
          await tx.auditLog.create({
            data: {
              action: 'indexing_fix.company_web_identity',
              actorType: 'system',
              actorId: null,
              targetType: 'company',
              targetId: plan.company.id,
              metadata: { website: plan.website, logoUrl: plan.logoUrl, notes: plan.notes, script: SCRIPT },
            },
          });
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }
  printFooter(opts, plans.length, SCRIPT);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

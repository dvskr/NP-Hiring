/**
 * Indexing audit L-01: preview of the company profile URL change. READ ONLY.
 *
 * Profile URLs move from the ingest dedup key (/companies/one) to the
 * display-name slug (/companies/one-medical); see lib/company-slug.ts. The
 * profile route answers every old slug with a 308 to the new one, and no row
 * in the database changes: the slug is computed from Company.name at request
 * time. This script only lists what the deploy changes, so the owner can
 * review it before submitting sitemaps:
 *
 *   1. every company with at least one live job: old URL, new URL, live job
 *      count, and whether the profile passes its index gate (sitemap listed);
 *   2. collisions: two live companies whose names produce the same slug (the
 *      same employer spelled two ways). The route serves the one with more
 *      live jobs; merge the pair from the admin companies screen if it is
 *      one employer;
 *   3. shadowing: a new slug that equals another live company's old slug, so
 *      that old URL now shows the new owner instead of redirecting;
 *   4. dormant shadows: a row with NO live jobs whose old slug equals a live
 *      company's new slug ("Davita", normalizedName "davita", against live
 *      "DaVita" at /companies/davita). Until the middleware stopped ruling on
 *      shape-valid slugs, the company gate found that row, counted no jobs
 *      and answered 410 on the live profile. They are duplicate spellings of
 *      a live employer: merge or delete them from the admin companies screen.
 *
 * There is no --apply: nothing here writes, and there is nothing to write.
 *
 * HOW TO RUN (a person runs this; the repo .env is the PRODUCTION database,
 * and this script only reads it)
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/indexing-fixes/report-company-slug-changes.ts
 *   Add --csv for the URL table (item 1 only) as CSV. Add --env-file=<path>
 *   to read another environment file.
 */
import { ENV_FILE } from './lib/load-env';
import { prisma } from '@/lib/prisma';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { companySlugFor, legacyCompanySlug } from '@/lib/company-slug';
import { shouldIndexCompanyProfile } from '@/lib/pseo/render-gate';
import {
    findDormantShadows,
    findLiveShadows,
    shadowLookupKeys,
    type LiveSlugCompany,
} from './lib/company-slug-shadows';

const AS_CSV = process.argv.includes('--csv');

interface UrlChangeRow {
    name: string;
    oldUrl: string;
    newUrl: string;
    changed: boolean;
    activeJobs: number;
    inSitemap: boolean;
}

function csvCell(value: string | number | boolean): string {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function loadLiveCompanies(now: Date): Promise<LiveSlugCompany[]> {
    const liveWhere = activeIndexableJobWhere(now);
    const rows = await prisma.company.findMany({
        where: { jobs: { some: liveWhere } },
        select: {
            name: true,
            normalizedName: true,
            _count: { select: { jobs: { where: liveWhere } } },
        },
        orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({ name: row.name, normalizedName: row.normalizedName, activeJobs: row._count.jobs }));
}

/**
 * Rows with no live jobs that could shadow a live display-name slug. Only the
 * candidate normalizedName values are read, never the whole table.
 */
async function loadDormantCandidates(live: readonly LiveSlugCompany[], now: Date) {
    const lookupKeys = shadowLookupKeys(live);
    if (lookupKeys.length === 0) return [];
    return prisma.company.findMany({
        where: { normalizedName: { in: lookupKeys }, NOT: { jobs: { some: activeIndexableJobWhere(now) } } },
        select: { name: true, normalizedName: true, _count: { select: { jobs: true } } },
        orderBy: { name: 'asc' },
    });
}

function buildUrlTable(live: readonly LiveSlugCompany[]): UrlChangeRow[] {
    return live.map((company) => {
        const oldSlug = legacyCompanySlug(company.normalizedName);
        const newSlug = companySlugFor(company);
        return {
            name: company.name,
            oldUrl: `/companies/${oldSlug}`,
            newUrl: `/companies/${newSlug}`,
            changed: oldSlug !== newSlug,
            activeJobs: company.activeJobs,
            inSitemap: shouldIndexCompanyProfile(company.activeJobs),
        };
    });
}

function printCsv(table: readonly UrlChangeRow[]): void {
    console.log(['name', 'old_url', 'new_url', 'changed', 'active_jobs', 'in_sitemap'].join(','));
    for (const row of table) {
        console.log([row.name, row.oldUrl, row.newUrl, row.changed, row.activeJobs, row.inSitemap].map(csvCell).join(','));
    }
}

function printUrlChanges(table: readonly UrlChangeRow[]): void {
    const changed = table.filter((row) => row.changed);
    console.log(`Live companies: ${table.length}. URL changes: ${changed.length} (each old URL answers 308 to the new one).`);
    console.log(`Profiles in the sitemap (index gate): ${table.filter((row) => row.inSitemap).length}.`);
    console.log('');
    for (const row of changed) {
        console.log(`  ${row.oldUrl}  ->  ${row.newUrl}   (${row.activeJobs} live jobs${row.inSitemap ? ', in sitemap' : ''})`);
    }
}

function printCollisions(live: readonly LiveSlugCompany[]): void {
    const bySlug = new Map<string, LiveSlugCompany[]>();
    for (const company of live) {
        const slug = companySlugFor(company);
        bySlug.set(slug, [...(bySlug.get(slug) ?? []), company]);
    }
    const collisions = [...bySlug.entries()].filter(([, group]) => group.length > 1);
    console.log('');
    console.log(`Collisions (one slug, several live companies): ${collisions.length}`);
    for (const [slug, group] of collisions) {
        const names = group.map((company) => `${company.name} [${company.normalizedName}] ${company.activeJobs} jobs`).join('; ');
        console.log(`  /companies/${slug}: ${names}`);
    }
}

async function main(): Promise<void> {
    // stderr, so the --csv output on stdout stays a clean CSV.
    console.error(`Company profile URL report (read only). Environment file: ${ENV_FILE}`);
    const now = new Date();
    try {
        const live = await loadLiveCompanies(now);
        const table = buildUrlTable(live);
        if (AS_CSV) {
            printCsv(table);
            return;
        }
        printUrlChanges(table);
        printCollisions(live);

        const shadowed = findLiveShadows(live);
        console.log('');
        console.log(`Shadowed old URLs (now served to a different company): ${shadowed.length}`);
        for (const { company, other, slug } of shadowed) {
            console.log(`  /companies/${slug} was ${other.name}, now ${company.name}`);
        }

        const dormantShadows = findDormantShadows(live, await loadDormantCandidates(live, now));
        console.log('');
        console.log(`Dormant rows holding a live profile URL (no live jobs; merge or delete): ${dormantShadows.length}`);
        for (const { company, other, slug } of dormantShadows) {
            console.log(
                `  /companies/${slug}: live ${company.name} [${company.normalizedName}] ${company.activeJobs} live jobs; ` +
                    `dormant ${other.name} [${other.normalizedName}] ${other._count.jobs} job rows in total`,
            );
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    console.error('[report-company-slug-changes] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});

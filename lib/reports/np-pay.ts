/**
 * lib/reports/np-pay.ts: the NP Pay Report's live snapshot (/reports/np-pay
 * and its CSV). Server-only.
 *
 * One pool and one engine, the ones every salary surface reads:
 *   - national and state figures from ONE fetch of fetchNpAnalyticsRows
 *     (live NP postings with a non-estimated annual pay range; no CRNA, CNM
 *     or CNS postings), grouped by state in memory;
 *   - the breakdowns (specialty, work mode, employment type, experience)
 *     through the same fetcher with the same predicates the specialty and
 *     state pages use (categoryPredicateWhere for tags, the stored columns
 *     for work mode and experience), so a figure here matches the page it
 *     links to;
 *   - every scope through summarizeScope (each employer once, tiered);
 *   - the disclosure share on /reports/pay-transparency's definition (a
 *     non-estimated normalized range on a live posting, over live postings).
 *
 * Wrapped in loadLiveReportData: a failed aggregation retries, then throws at
 * request time so ISR keeps the last good render; during `next build` it
 * resolves to null and the page omits the live blocks.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { fetchNpAnalyticsRows } from '@/lib/salary-analytics';
import { summarizeScope, type ScopeSummary } from '@/components/tools/benchmark-model';
import { cleanSalaryRows } from '@/lib/salary-report/stats';
import { categoryPredicateWhere, type CategoryTag } from '@/lib/pseo/category-tagger';
import { SALARY_SPECIALTY_PAGES } from '@/app/salary-guide/specialty/specialty-config';
import { loadLiveReportData } from './live-load';
import {
    NATIONAL_BLS,
    scopeRow,
    stateRows,
    thresholdShare,
    type NpPayScopeRow,
    type NpPayScopeType,
    type NpPaySnapshot,
} from './np-pay-model';

interface GroupSpec {
    label: string;
    href?: string;
    where: Prisma.JobWhereInput;
}

/** The NP specialties with a salary page of their own (CRNA and CNM are not NP figures). */
const SPECIALTY_GROUPS: readonly GroupSpec[] = SALARY_SPECIALTY_PAGES
    .filter((page) => page.isNicheRole)
    .map((page) => ({ label: page.label, href: `/salary-guide/specialty/${page.slug}`, where: categoryPredicateWhere(page.slug) }));

const WORK_MODE_GROUPS: readonly GroupSpec[] = [
    { label: 'Remote', where: { isRemote: true } },
    { label: 'Hybrid', where: { isHybrid: true, isRemote: false } },
    { label: 'On site', where: { isRemote: false, isHybrid: false } },
];

const EMPLOYMENT_TAGS: ReadonlyArray<{ label: string; tag: CategoryTag }> = [
    { label: 'Full time', tag: 'full-time' },
    { label: 'Part time', tag: 'part-time' },
    { label: 'Per diem', tag: 'per-diem' },
];
const EMPLOYMENT_GROUPS: readonly GroupSpec[] = EMPLOYMENT_TAGS.map(({ label, tag }) => ({ label, where: categoryPredicateWhere(tag) }));

/** The same experience buckets the specialty pages use. */
const EXPERIENCE_GROUPS: readonly GroupSpec[] = [
    { label: 'New-grad friendly roles', where: { newGradFriendly: true } },
    { label: 'Roles requiring 3 or more years', where: { minYearsExperience: { gte: 3 } } },
    { label: 'Roles requiring 5 or more years', where: { minYearsExperience: { gte: 5 } } },
];

/**
 * The snapshot runs about two dozen queries. The serverless pool holds three
 * connections and fails a query that waits 10 s for one
 * (lib/prisma-pool-config.ts), so they go out at most three at a time
 * rather than all at once.
 */
const SNAPSHOT_QUERY_CONCURRENCY = 3;

/** Runs the tasks in order, at most `limit` in flight; results keep task order. */
export async function runBounded<T>(tasks: ReadonlyArray<() => Promise<T>>, limit = SNAPSHOT_QUERY_CONCURRENCY): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let next = 0;
    const worker = async () => {
        while (next < tasks.length) {
            const index = next++;
            results[index] = await tasks[index]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}

function groupRows(scopeType: NpPayScopeType, groups: readonly GroupSpec[]): Promise<NpPayScopeRow[]> {
    return runBounded(groups.map((group) => async () => scopeRow({
        scopeType,
        scope: group.label,
        href: group.href ?? null,
        summary: summarizeScope(group.label, await fetchNpAnalyticsRows(group.where)),
    })));
}

/** Pure: per-state summaries from one fetch of the pool. Exported for the tests. */
export function summarizeByState(rows: Awaited<ReturnType<typeof fetchNpAnalyticsRows>>): Map<string, ScopeSummary> {
    const byState = new Map<string, typeof rows>();
    for (const row of rows) {
        if (!row.state) continue;
        const bucket = byState.get(row.state);
        if (bucket) bucket.push(row);
        else byState.set(row.state, [row]);
    }
    return new Map([...byState.entries()].map(([state, bucket]) => [state, summarizeScope(state, bucket)]));
}

async function aggregateNpPaySnapshot(): Promise<NpPaySnapshot> {
    const now = new Date();
    const live = activeIndexableJobWhere(now);
    // Three base queries (the pool size), then each breakdown family in turn.
    const [rows, total, disclosed] = await Promise.all([
        fetchNpAnalyticsRows(),
        prisma.job.count({ where: live }),
        prisma.job.count({ where: { AND: [live, { salaryIsEstimated: false, normalizedMinSalary: { not: null } }] } }),
    ]);
    const specialties = await groupRows('specialty', SPECIALTY_GROUPS);
    const workModes = await groupRows('work_mode', WORK_MODE_GROUPS);
    const employmentTypes = await groupRows('employment_type', EMPLOYMENT_GROUPS);
    const experience = await groupRows('experience', EXPERIENCE_GROUPS);
    return {
        asOf: now.toISOString(),
        disclosure: { disclosed, total },
        atOrAbove200k: thresholdShare(cleanSalaryRows(rows).midpoints, 200_000),
        national: scopeRow({ scopeType: 'national', scope: 'United States', summary: summarizeScope('National', rows), bls: NATIONAL_BLS }),
        states: stateRows(summarizeByState(rows), summarizeScope('none', [])),
        specialties,
        workModes,
        employmentTypes,
        experience,
    };
}

/** The live snapshot, or null during `next build` when the database is unreachable. */
export async function loadNpPaySnapshot(): Promise<NpPaySnapshot | null> {
    return loadLiveReportData(aggregateNpPaySnapshot, {
        onFailure: (attempt, error) => logger.error(`[reports] np pay snapshot aggregation failed (attempt ${attempt})`, error),
    });
}

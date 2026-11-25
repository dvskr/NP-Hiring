import type { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { getGatedLocationSalary, getGatedStateBenchmarks, type GatedSalary } from '@/lib/salary-analytics';
import {
  BENCHMARK_FULL_MIN_EMPLOYERS,
  BENCHMARK_MIN_EMPLOYERS,
  type BenchmarkRow,
} from '@/components/tools/benchmark-model';
import { ONE_EMPLOYER_NOTE } from '@/lib/salary-report/stats';
import { BOARD_MEDIAN_LABEL } from '@/lib/pseo/listing-narrative';
import { stateToSlug } from '@/lib/pseo/setting-state-config';

/**
 * NP Hiring's advertised pay figures for the assistant tools: the same gated
 * figures the salary guide prints (lib/salary-analytics.ts, on the salary
 * engine in lib/salary-report/stats.ts).
 *
 * How they are made, which the tools say when they quote one: each employer
 * counts once, at the middle of the pay ranges it advertises, however many
 * postings it has. A median is published once at least 5 employers disclose
 * pay, and the 25th to 75th percentile range once at least 10 do; below 5
 * the figure carries no dollars and nothing is quoted. Every figure travels
 * with its n, the number of employers behind it, never a posting count. The
 * site-wide figure is "Median across all NP Hiring postings"
 * (BOARD_MEDIAN_LABEL), never a national figure: "national" is reserved for
 * the cited BLS statistics.
 *
 * getGatedLocationSalary reads every salaried posting in scope and has no
 * cache of its own outside a page render, so the figures are kept here for
 * an hour. A failed read is not cached.
 */

export { BOARD_MEDIAN_LABEL };

export type PayScope = { kind: 'state'; stateName: string } | { kind: 'remote' } | { kind: 'board' };

/** A published figure: the median tier or above, so the median is a number. */
export type PublishedPay = GatedSalary & { median: number; medianK: number };

/** A figure at the full tier: the 25th and 75th percentiles are numbers too. */
export type PublishedPayWithRange = PublishedPay & { p25: number; p75: number; p25K: number; p75K: number };

const PAY_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { figure: GatedSalary; at: number }>();

function scopeKey(scope: PayScope): string {
  return scope.kind === 'state' ? `state:${scope.stateName}` : scope.kind;
}

function scopeWhere(scope: PayScope): Prisma.JobWhereInput {
  if (scope.kind === 'state') return { state: scope.stateName };
  if (scope.kind === 'remote') return { isRemote: true };
  return {};
}

/** The gated figure for a scope, or null when it could not be read. */
export async function payFigure(scope: PayScope): Promise<GatedSalary | null> {
  const key = scopeKey(scope);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PAY_TTL_MS) return hit.figure;
  try {
    const figure = await getGatedLocationSalary(scopeWhere(scope));
    cache.set(key, { figure, at: Date.now() });
    return figure;
  } catch (error) {
    logger.error('MCP pay data: gated salary read failed', error, { scope: key });
    return null;
  }
}

let statesCache: { rows: BenchmarkRow[]; at: number } | null = null;

/** Every state whose figure is published, as the salary guide's state table has them, or null when unreadable. */
export async function stateBenchmarks(): Promise<BenchmarkRow[] | null> {
  if (statesCache && Date.now() - statesCache.at < PAY_TTL_MS) return statesCache.rows;
  try {
    const rows = await getGatedStateBenchmarks();
    statesCache = { rows, at: Date.now() };
    return rows;
  } catch (error) {
    logger.error('MCP pay data: state benchmarks read failed', error);
    return null;
  }
}

/** For tests: forget every cached figure. */
export function resetPayCacheForTests(): void {
  cache.clear();
  statesCache = null;
}

/** True when the figure is published: at least BENCHMARK_MIN_EMPLOYERS employers disclose pay. */
export function isPublished(figure: GatedSalary | null): figure is PublishedPay {
  return !!figure && figure.gatePassed && typeof figure.median === 'number' && typeof figure.medianK === 'number';
}

/** True when the figure also publishes its 25th to 75th percentile range (BENCHMARK_FULL_MIN_EMPLOYERS employers). */
export function hasPayRange(figure: GatedSalary | null): figure is PublishedPayWithRange {
  return (
    isPublished(figure) &&
    typeof figure.p25 === 'number' &&
    typeof figure.p75 === 'number' &&
    typeof figure.p25K === 'number' &&
    typeof figure.p75K === 'number'
  );
}

/** "7 employers": a figure's n, the employers behind it, each counted once. */
export function employersCount(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'employer' : 'employers'}`;
}

/** "$128k" from whole thousands, as the salary guide prints a median. */
export function thousands(k: number): string {
  return `$${k}k`;
}

/** The salary guide page for a state. */
export function stateGuideUrl(baseUrl: string, stateName: string): string {
  return `${baseUrl}/salary-guide/${stateToSlug(stateName)}`;
}

/** The salary guide's front page. */
export function guideUrl(baseUrl: string): string {
  return `${baseUrl}/salary-guide`;
}

/** What a published figure is, in one line the tools add after quoting it. */
export const PAY_METHOD_LINE =
  `Figures are medians of advertised pay on live postings. ${ONE_EMPLOYER_NOTE} ` +
  `A median is published once at least ${BENCHMARK_MIN_EMPLOYERS} employers disclose pay, and the 25th to 75th percentile range once at least ${BENCHMARK_FULL_MIN_EMPLOYERS} do. ` +
  'They are advertised pay, not reported earnings.';

/** "no employer discloses", "1 employer discloses", "3 employers disclose". */
function disclosingEmployers(n: number): string {
  if (n === 0) return 'no employer discloses';
  return n === 1 ? '1 employer discloses' : `${employersCount(n)} disclose`;
}

/** Why no figure is quoted for a scope, in one line. */
export function withheldLine(figure: GatedSalary | null, where: string): string {
  if (!figure) return `Pay data for ${where} could not be read just now.`;
  return `No median is published for ${where}: ${disclosingEmployers(figure.employers)} pay, and a median needs at least ${BENCHMARK_MIN_EMPLOYERS}.`;
}

/** A published median without its 25th to 75th percentile range, and why, in one line. */
export function noRangeLine(figure: PublishedPay, where: string): string {
  return `For ${where}, the median is ${thousands(figure.medianK)} across ${employersCount(figure.employers)} that disclose pay, with no 25th to 75th percentile range yet: that appears once at least ${BENCHMARK_FULL_MIN_EMPLOYERS} employers disclose pay.`;
}

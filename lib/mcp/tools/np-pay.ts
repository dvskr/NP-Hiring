import type { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { getGatedLocationSalary, getGatedStateBenchmarks, type GatedSalaryDetail } from '@/lib/salary-analytics';
import type { BenchmarkRow } from '@/components/tools/benchmark-model';
import { BOARD_MEDIAN_LABEL } from '@/lib/pseo/listing-narrative';
import { stateToSlug } from '@/lib/pseo/setting-state-config';

/**
 * NP Hiring's advertised pay figures for the assistant tools: the same gated
 * figures the salary guide prints (lib/salary-analytics.ts).
 *
 * How they are made, which the tools say when they quote one: the midpoint
 * of each posting's advertised range, counted per posting, published only
 * when at least 5 postings from at least 3 employers are in the sample and
 * no single employer holds more than 40% of it. Below that the figure is
 * null and nothing is quoted. The site-wide figure is "Median across all NP
 * Hiring postings" (BOARD_MEDIAN_LABEL), never a national figure: "national"
 * is reserved for the cited BLS statistics.
 *
 * getGatedLocationSalary reads every salaried posting in scope and has no
 * cache of its own outside a page render, so the figures are kept here for
 * an hour. A failed read is not cached.
 */

export { BOARD_MEDIAN_LABEL };

export type PayScope = { kind: 'state'; stateName: string } | { kind: 'remote' } | { kind: 'board' };

const PAY_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { figure: GatedSalaryDetail; at: number }>();

function scopeKey(scope: PayScope): string {
  return scope.kind === 'state' ? `state:${scope.stateName}` : scope.kind;
}

function scopeWhere(scope: PayScope): Prisma.JobWhereInput {
  if (scope.kind === 'state') return { state: scope.stateName };
  if (scope.kind === 'remote') return { isRemote: true };
  return {};
}

/** The gated figure for a scope, or null when it could not be read. */
export async function payFigure(scope: PayScope): Promise<GatedSalaryDetail | null> {
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

/** True when the figure is published: the sample cleared the gate. */
export function isPublished(figure: GatedSalaryDetail | null): figure is GatedSalaryDetail & { median: number; medianK: number } {
  return !!figure && figure.gatePassed && typeof figure.median === 'number' && typeof figure.medianK === 'number';
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
  'Figures are the midpoints of advertised pay on live postings, counted per posting, published only from at least 5 postings by at least 3 employers with no employer above 40% of them. They are advertised pay, not reported earnings.';

/** Why no figure is quoted for a scope, in one line. */
export function withheldLine(figure: GatedSalaryDetail | null, where: string): string {
  if (!figure) return `Pay data for ${where} could not be read just now.`;
  if (figure.heldByEmployerShare) {
    return `No median is published for ${where}: one employer holds too large a share of its ${figure.postings} postings with pay.`;
  }
  return `No median is published for ${where}: ${figure.postings} posting${figure.postings === 1 ? '' : 's'} with pay from ${figure.employers} employer${figure.employers === 1 ? '' : 's'} is below the 5 postings from 3 employers the figure needs.`;
}

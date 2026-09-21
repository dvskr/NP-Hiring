import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { FilterCounts, FilterState } from '@/types/filters';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  COUNT_ROW_SELECT,
  computeFilterCounts,
  normalizeFilterCountsBody,
  type FilterCountsDataSource,
} from './compute-counts';
import type { MemoryRow } from './where-evaluator';

/**
 * Short-lived per-instance result cache + in-flight coalescing. The sidebar
 * re-requests identical filter sets constantly (every /jobs visit, back/forward,
 * several tabs), and each computation holds a pooled connection. Counts may
 * lag a fresh ingest by at most CACHE_TTL_MS.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const countsCache = new Map<string, { expiresAt: number; value: Promise<FilterCounts> }>();

const dataSource: FilterCountsDataSource = {
  findRows: async (where) =>
    (await prisma.job.findMany({ where, select: COUNT_ROW_SELECT })) as unknown as MemoryRow[],
  findIds: async (where) =>
    (await prisma.job.findMany({ where, select: { id: true } })).map((row) => row.id),
};

function cachedFilterCounts(filters: FilterState): Promise<FilterCounts> {
  const key = JSON.stringify(filters);
  const now = Date.now();
  const hit = countsCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = computeFilterCounts(filters, dataSource);
  countsCache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  // A failed computation must not be served from cache.
  value.catch(() => {
    if (countsCache.get(key)?.value === value) countsCache.delete(key);
  });
  if (countsCache.size > CACHE_MAX_ENTRIES) {
    for (const [k, entry] of countsCache) {
      if (entry.expiresAt <= now || countsCache.size > CACHE_MAX_ENTRIES) countsCache.delete(k);
      if (countsCache.size <= CACHE_MAX_ENTRIES) break;
    }
  }
  return value;
}

export async function POST(request: NextRequest) {
  const rateLimitResult = await rateLimit(request, 'filter-counts', RATE_LIMITS.general);
  if (rateLimitResult) return rateLimitResult;

  // Client-input errors are 400s, parsed outside the computation's catch-all.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  const filters = normalizeFilterCountsBody(raw);
  if (!filters) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  try {
    const counts = await cachedFilterCounts(filters);
    return NextResponse.json(counts);
  } catch (error) {
    logger.error('Error calculating filter counts:', error);
    return NextResponse.json(
      { error: 'Failed to calculate filter counts' },
      { status: 500 }
    );
  }
}

/**
 * lib/dead-link-threshold.ts: the dead-link gate, as a leaf module.
 *
 * The check-dead-links cron counts consecutive source misses in
 * `healthConsecutiveMissing`. At DEAD_LINK_MISS_THRESHOLD misses the job's
 * detail URL answers 410 (middleware) and its page reads closed
 * (app/jobs/[slug]/page.tsx), so no listing, search or sitemap may still
 * show it (indexing audit, EDGE-CRONS handoff 20).
 *
 * It lives apart from lib/active-job-filter.ts (which re-exports it) because
 * that module imports lib/filters.ts, and lib/filters.ts needs the gate too:
 * a leaf with no imports breaks the cycle and stays safe for the edge gates
 * (lib/pseo/listing-gates-edge.ts). Type-only import, erased at compile time.
 */
import type { Prisma } from '@prisma/client';

/** Consecutive source misses at which a job counts as a dead link. */
export const DEAD_LINK_MISS_THRESHOLD = 5;

/**
 * Prisma clause for a job whose link is not dead. A fresh object on every
 * call, so a caller can never share (or mutate) another query's clause.
 */
export function liveLinkWhere(): Prisma.JobWhereInput {
  return { healthConsecutiveMissing: { lt: DEAD_LINK_MISS_THRESHOLD } };
}

/** The same gate as a PostgREST filter (snake_case column), for the edge gates. */
export const LIVE_LINK_REST_FILTER = `health_consecutive_missing=lt.${DEAD_LINK_MISS_THRESHOLD}`;

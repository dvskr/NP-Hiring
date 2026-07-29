/**
 * Public salary-benchmark aggregation for employers (P2 #17).
 *
 * PUBLIC-SAFETY RULES — this surface is unauthenticated, so it may only ever
 * publish aggregates that cannot be resolved back to one employer's pay:
 *   1. A state appears only with at least BENCHMARK_MIN_POSTINGS salaried
 *      postings AND at least BENCHMARK_MIN_EMPLOYERS distinct employers behind
 *      them. Five postings from one hospital system is that system's pay
 *      scale, not a market benchmark.
 *   2. Nothing employer-identifying leaves this module. Employer names are
 *      used to COUNT distinct employers and are then discarded.
 *   3. `salaryIsEstimated` rows must be filtered out by the caller before they
 *      reach here — see the TRUTH RULE note in app/companies/[slug]/page.tsx.
 *      Those rows carry LLM-inferred or clamped numbers, and publishing them
 *      as "what employers pay" would be a fabricated benchmark.
 *
 * The employer analytics API (app/api/employer/analytics/benchmarks) computes
 * a platform median for signed-in employers over their own + platform data.
 * This module deliberately does NOT call it: that endpoint is auth-gated and
 * returns per-employer rows, neither of which belongs on a public page.
 */

/** Minimum salaried postings before a state is shown. */
export const BENCHMARK_MIN_POSTINGS = 5;

/** Minimum distinct employers behind those postings. */
export const BENCHMARK_MIN_EMPLOYERS = 3;

export interface BenchmarkInputRow {
  state: string | null;
  employer: string | null;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
}

export interface BenchmarkRow {
  /** Full state name, or 'National' for the pooled row. */
  scope: string;
  median: number;
  p25: number;
  p75: number;
  postings: number;
  employers: number;
}

export interface BenchmarkSummary {
  national: BenchmarkRow | null;
  states: BenchmarkRow[];
}

/** Nearest-rank percentile over a pre-sorted ascending array. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

/** True median (mean of the two central values on an even-length sample). */
function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarize(scope: string, midpoints: number[], employers: ReadonlySet<string>): BenchmarkRow {
  const sorted = [...midpoints].sort((a, b) => a - b);
  return {
    scope,
    median: Math.round(median(sorted)),
    p25: Math.round(percentile(sorted, 0.25)),
    p75: Math.round(percentile(sorted, 0.75)),
    postings: sorted.length,
    employers: employers.size,
  };
}

/**
 * Collapse raw posting rows into publishable state and national benchmarks.
 * Rows without a state, an employer, or a usable pay range are dropped.
 */
export function summarizeBenchmarks(rows: readonly BenchmarkInputRow[]): BenchmarkSummary {
  const byState = new Map<string, { midpoints: number[]; employers: Set<string> }>();
  const nationalMidpoints: number[] = [];
  const nationalEmployers = new Set<string>();

  for (const row of rows) {
    const min = row.normalizedMinSalary ?? 0;
    const max = row.normalizedMaxSalary ?? min;
    if (!row.state || !row.employer || min <= 0) continue;

    const midpoint = Math.round((min + max) / 2);
    nationalMidpoints.push(midpoint);
    nationalEmployers.add(row.employer);

    const bucket = byState.get(row.state);
    if (bucket) {
      bucket.midpoints.push(midpoint);
      bucket.employers.add(row.employer);
    } else {
      byState.set(row.state, { midpoints: [midpoint], employers: new Set([row.employer]) });
    }
  }

  const states = [...byState.entries()]
    .filter(
      ([, bucket]) =>
        bucket.midpoints.length >= BENCHMARK_MIN_POSTINGS &&
        bucket.employers.size >= BENCHMARK_MIN_EMPLOYERS,
    )
    .map(([state, bucket]) => summarize(state, bucket.midpoints, bucket.employers))
    .sort((a, b) => a.scope.localeCompare(b.scope));

  const national =
    nationalMidpoints.length >= BENCHMARK_MIN_POSTINGS && nationalEmployers.size >= BENCHMARK_MIN_EMPLOYERS
      ? summarize('National', nationalMidpoints, nationalEmployers)
      : null;

  return { national, states };
}

/** Where a proposed offer sits against a benchmark row. */
export type OfferStanding = 'below' | 'competitive' | 'above';

export function classifyOffer(offer: number, row: BenchmarkRow): OfferStanding {
  if (offer < row.p25) return 'below';
  if (offer > row.p75) return 'above';
  return 'competitive';
}

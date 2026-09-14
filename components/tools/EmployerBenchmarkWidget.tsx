/**
 * Employer salary-benchmark widget (P2 #17) — async server component.
 *
 * Answers "what should I pay in <state>?" from live published postings and
 * hands ONLY aggregates to the client (see ./benchmark-model.ts for the
 * public-safety thresholds). It is mounted both on its own indexable route
 * (/tools/salary-benchmark) and inside /for-employers, so the aggregation
 * lives here rather than in either page.
 *
 * ONE PIPELINE — the rows come from lib/salary-analytics (fetchNpAnalyticsRows),
 * the same pool /salary-guide and /salary-guide/<state> publish from:
 * published, non-expired, `salaryIsEstimated: false`, salary confidence at
 * or above the analytics floor, annual cadence, NP-eligible titles. A
 * private findMany here once published states that /salary-guide gates out
 * as "sample too small", from a national sample that disagreed with the
 * state pages, and let psychiatrist, PA, and expired pay into an NP figure.
 *
 * TRUTH RULE — estimated rows carry LLM-inferred or clamped pay written by
 * the enrichment cron, the inline ingestion rescue path, and the salary
 * normalizer (see the extended note in app/companies/[slug]/page.tsx).
 * Aggregating them and calling the result "what employers post" would
 * publish a fabricated benchmark.
 */
import EmployerBenchmarkPicker from './EmployerBenchmarkPicker';
import { summarizeBenchmarkPool, type BenchmarkSummary } from './benchmark-model';
import { fetchNpAnalyticsRows } from '@/lib/salary-analytics';
import { logger } from '@/lib/logger';

const EMPTY_SUMMARY: BenchmarkSummary = { national: null, states: [] };

export async function loadBenchmarkSummary(): Promise<BenchmarkSummary> {
  try {
    return summarizeBenchmarkPool(await fetchNpAnalyticsRows());
  } catch (error) {
    // A failed aggregation renders the widget's "not enough data" state
    // rather than taking down /for-employers.
    logger.error('[tools/salary-benchmark] benchmark aggregation failed', error);
    return EMPTY_SUMMARY;
  }
}

interface Props {
  /** Tighter padding for the embedded placement on /for-employers. */
  compact?: boolean;
}

export default async function EmployerBenchmarkWidget({ compact = false }: Props) {
  const { national, states } = await loadBenchmarkSummary();
  return <EmployerBenchmarkPicker national={national} states={states} compact={compact} />;
}

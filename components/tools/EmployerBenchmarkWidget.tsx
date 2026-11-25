/**
 * Employer salary-benchmark widget (P2 #17) — async server component.
 *
 * Answers "what should I pay in <state>?" from live published postings and
 * hands ONLY aggregates to the client (see ./benchmark-model.ts for the
 * public-safety rules). It is mounted both on its own indexable route
 * (/tools/salary-benchmark) and inside /for-employers, so the aggregation
 * lives here rather than in either page.
 *
 * ONE PIPELINE — the rows come from lib/salary-analytics (fetchNpAnalyticsRows),
 * the same pool /salary-guide and /salary-guide/<state> publish from:
 * published, non-expired, `salaryIsEstimated: false`, salary confidence at
 * or above the analytics floor, annual cadence, nurse practitioner roles
 * only (CRNA, CNM and CNS postings never enter an NP figure). A private
 * findMany here once published states that /salary-guide gates out as
 * "sample too small", from a national sample that disagreed with the state
 * pages, and let psychiatrist, PA, and expired pay into an NP figure.
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

/**
 * The same publishing rules as /salary-guide: the salary engine's employer
 * tiers over the same pool. Each employer counts once (fetchNpAnalyticsRows
 * hands over the alias-merged employer identity), and a state or the
 * national row publishes a median at BENCHMARK_MIN_EMPLOYERS employers and
 * its 25th to 75th percentile range at BENCHMARK_FULL_MIN_EMPLOYERS. The
 * national row pools every row, stateless ones included, as
 * /salary-guide/<state> computes its national base.
 */
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

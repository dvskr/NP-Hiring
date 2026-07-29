/**
 * Employer salary-benchmark widget (P2 #17) — async server component.
 *
 * Answers "what should I pay in <state>?" from live published postings and
 * hands ONLY aggregates to the client (see ./benchmark-model.ts for the
 * public-safety thresholds). It is mounted both on its own indexable route
 * (/tools/salary-benchmark) and inside /for-employers, so the aggregation
 * lives here rather than in either page.
 *
 * TRUTH RULE — `salaryIsEstimated` rows are excluded. Those rows carry
 * LLM-inferred or clamped pay written by the enrichment cron, the inline
 * ingestion rescue path, and the salary normalizer (see the extended note in
 * app/companies/[slug]/page.tsx). Aggregating them and calling the result
 * "what employers post" would publish a fabricated benchmark.
 */
import EmployerBenchmarkPicker from './EmployerBenchmarkPicker';
import { summarizeBenchmarks, type BenchmarkSummary } from './benchmark-model';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

const EMPTY_SUMMARY: BenchmarkSummary = { national: null, states: [] };

export async function loadBenchmarkSummary(): Promise<BenchmarkSummary> {
  try {
    const rows = await prisma.job.findMany({
      where: {
        isPublished: true,
        salaryIsEstimated: false,
        state: { not: null },
        normalizedMinSalary: { not: null },
        normalizedMaxSalary: { not: null },
      },
      select: {
        state: true,
        employer: true,
        normalizedMinSalary: true,
        normalizedMaxSalary: true,
      },
    });
    return summarizeBenchmarks(rows);
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

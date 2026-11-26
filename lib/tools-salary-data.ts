/**
 * Server-side market salary loader for /tools routes.
 *
 * Combines NP Hiring's gated live posting benchmarks (one employer counted
 * once via fetchNpAnalyticsRows + summarizeBenchmarkPool) with official
 * BLS OEWS May 2025 state and national NP wages (lib/salary-guide-bls-states.ts).
 *
 * Client widgets receive plain serializable numbers — never Prisma rows or
 * employer names.
 */
import { fetchNpAnalyticsRows } from '@/lib/salary-analytics';
import { summarizeBenchmarkPool, type BenchmarkRow } from '@/components/tools/benchmark-model';
import {
  BLS_NATIONAL,
  BLS_STATE_WAGES,
  BLS_OEWS_REFERENCE_PERIOD,
  BLS_STATE_SOURCE_LABEL,
} from '@/lib/salary-guide-bls-states';
import { logger } from '@/lib/logger';

export interface StateSalarySnapshot {
  state: string;
  stateCode: string;
  slug: string;
  /** Gated live posting median (5+ employers), or null below gate. */
  liveMedian: number | null;
  /** Gated live posting quartiles (10+ employers), or null below full tier. */
  liveP25: number | null;
  liveP75: number | null;
  /** Employers behind the live figure, or 0 below gate. */
  liveEmployers: number;
  /** BLS OEWS May 2025 figures (null when footnoted/top-coded by BLS). */
  blsMedian: number | null;
  blsHourlyMedian: number | null;
  blsP10: number | null;
  blsP25: number | null;
  blsP75: number | null;
  blsP90: number | null;
}

export interface MarketSalaryBundle {
  nationalLive: BenchmarkRow | null;
  nationalBls: {
    median: number;
    hourlyMedian: number;
    p10: number;
    p25: number;
    p75: number;
    p90: number;
    referencePeriod: string;
    sourceLabel: string;
  };
  states: StateSalarySnapshot[];
}

export async function loadMarketSalaryBundle(): Promise<MarketSalaryBundle> {
  let nationalLive: BenchmarkRow | null = null;
  const liveByState = new Map<string, BenchmarkRow>();

  try {
    const pool = summarizeBenchmarkPool(await fetchNpAnalyticsRows());
    nationalLive = pool.national;
    for (const row of pool.states) {
      liveByState.set(row.scope, row);
    }
  } catch (error) {
    logger.error('[tools/salary-data] live benchmark load failed; falling back to BLS state wages', error);
  }

  const states: StateSalarySnapshot[] = Object.values(BLS_STATE_WAGES)
    .map((bls) => {
      const live = liveByState.get(bls.state) ?? null;
      return {
        state: bls.state,
        stateCode: bls.stateCode,
        slug: bls.slug,
        liveMedian: live?.median ?? null,
        liveP25: live?.p25 ?? null,
        liveP75: live?.p75 ?? null,
        liveEmployers: live?.employers ?? 0,
        blsMedian: bls.annualMedian.value,
        blsHourlyMedian: bls.hourlyMedian.value,
        blsP10: bls.annualP10.value,
        blsP25: bls.annualP25.value,
        blsP75: bls.annualP75.value,
        blsP90: bls.annualP90.value,
      };
    })
    .sort((a, b) => a.state.localeCompare(b.state));

  return {
    nationalLive,
    nationalBls: {
      median: BLS_NATIONAL.np.annualMedian.value ?? 132_300,
      hourlyMedian: BLS_NATIONAL.np.hourlyMedian.value ?? 63.61,
      p10: BLS_NATIONAL.np.annualP10.value ?? 101_340,
      p25: BLS_NATIONAL.np.annualP25.value ?? 114_570,
      p75: BLS_NATIONAL.np.annualP75.value ?? 153_290,
      p90: BLS_NATIONAL.np.annualP90.value ?? 174_420,
      referencePeriod: BLS_OEWS_REFERENCE_PERIOD,
      sourceLabel: BLS_STATE_SOURCE_LABEL,
    },
    states,
  };
}

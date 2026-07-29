/**
 * Cost-of-living comparison model (P2 #5).
 *
 * The adjustment formula is the SAME one the pSEO aggregation cron already
 * uses to compute `pseoStats.colAdjustedSalary`
 * (app/api/cron/aggregate-pseo/route.ts): nominal x (100 / costOfLivingIndex),
 * where 100 is the national average. Keeping one formula means the comparator
 * and the ~50K category-city pages can never disagree about what a salary is
 * worth in a given city.
 *
 * The cost-of-living index itself comes from this board's city dataset
 * (lib/pseo/city-data/cities.ts, 4,135 cities). The comparator labels it as
 * such rather than attributing it to an external index it cannot verify.
 */

/** National-average cost-of-living index. Cities above 100 are more expensive. */
export const NATIONAL_COL_INDEX = 100;

/** Minimum salaried postings a single city needs before its own average is used. */
export const CITY_SAMPLE_THRESHOLD = 3;

export type NominalBasis = 'city' | 'state';

export interface CitySalaryBasis {
  /** Nominal (unadjusted) annual salary in dollars. */
  nominal: number;
  /** Whether the nominal figure came from city-level or state-level postings. */
  basis: NominalBasis;
  /** Number of salaried postings behind the figure. */
  sample: number;
}

/**
 * Purchasing power of a nominal salary, expressed in national-average dollars.
 * A $130,000 salary in a city indexed at 130 is worth $100,000 in real terms.
 */
export function colAdjusted(nominal: number, colIndex: number): number {
  if (colIndex <= 0) return 0;
  return nominal * (NATIONAL_COL_INDEX / colIndex);
}

/**
 * The nominal salary you would need in the target city to hold the same
 * purchasing power a source salary buys in the source city.
 */
export function equivalentSalary(sourceNominal: number, sourceColIndex: number, targetColIndex: number): number {
  if (sourceColIndex <= 0) return 0;
  return sourceNominal * (targetColIndex / sourceColIndex);
}

export interface ComparisonSide {
  nominal: number;
  colIndex: number;
  adjusted: number;
  basis: NominalBasis;
  sample: number;
}

export interface ComparisonResult {
  a: ComparisonSide;
  b: ComparisonSide;
  /** b.nominal - a.nominal. */
  nominalDelta: number;
  /** b.adjusted - a.adjusted — the figure that actually matters. */
  realDelta: number;
  /** realDelta as a percentage of a.adjusted, or 0 when a has no data. */
  realDeltaPct: number;
  /** What B would have to pay to match A's purchasing power. */
  matchingSalaryInB: number;
  /**
   * True when the nominal comparison and the real comparison disagree in
   * direction — the headline insight of the tool.
   */
  reversesOnAdjustment: boolean;
}

export function compareCities(
  a: { basis: CitySalaryBasis; colIndex: number },
  b: { basis: CitySalaryBasis; colIndex: number },
): ComparisonResult {
  const aSide: ComparisonSide = {
    nominal: a.basis.nominal,
    colIndex: a.colIndex,
    adjusted: colAdjusted(a.basis.nominal, a.colIndex),
    basis: a.basis.basis,
    sample: a.basis.sample,
  };
  const bSide: ComparisonSide = {
    nominal: b.basis.nominal,
    colIndex: b.colIndex,
    adjusted: colAdjusted(b.basis.nominal, b.colIndex),
    basis: b.basis.basis,
    sample: b.basis.sample,
  };
  const nominalDelta = bSide.nominal - aSide.nominal;
  const realDelta = bSide.adjusted - aSide.adjusted;
  return {
    a: aSide,
    b: bSide,
    nominalDelta,
    realDelta,
    realDeltaPct: aSide.adjusted > 0 ? (realDelta / aSide.adjusted) * 100 : 0,
    matchingSalaryInB: equivalentSalary(aSide.nominal, aSide.colIndex, bSide.colIndex),
    reversesOnAdjustment:
      (nominalDelta > 0 && realDelta < 0) || (nominalDelta < 0 && realDelta > 0),
  };
}

/**
 * P2 #4 / #5 / #17 — model-level guards for the /tools calculators.
 *
 * These tools publish dollar figures on a YMYL surface, so the arithmetic is
 * pinned here rather than only eyeballed in the UI:
 *
 *   - federal-tax-model: the literal 2026 dollar figures (every bracket
 *     boundary for both filing statuses, both standard deductions, the SSA
 *     wage base), plus table shape, statutory payroll rates, and the wage-base
 *     cap. The dollar pins are the point: a partial edit — bumping the year
 *     without retyping the tables, or retyping one status and not the other —
 *     fails here with the numbers in the diff, instead of quietly publishing
 *     last year's tax on a YMYL page.
 *   - take-home-model: both columns report cash on ONE basis, a hand-worked
 *     example reproduces the implementation to the dollar, the break-even
 *     solver actually breaks even, and net position rises monotonically with
 *     the contract rate.
 *   - col-model: the adjustment formula stays identical to the one the pSEO
 *     aggregation cron uses for pseoStats.colAdjustedSalary.
 *   - benchmark-model: the public benchmark never publishes a state that can
 *     be resolved back to a single employer.
 */
import { describe, it, expect } from 'vitest';

import {
  FEDERAL_BRACKETS,
  PAYROLL_TAX,
  STANDARD_DEDUCTION,
  TAX_MODEL_EXCLUSIONS,
  TAX_MODEL_SOURCES,
  TAX_MODEL_YEAR,
  employeePayrollTax,
  federalIncomeTax,
  marginalRate,
  selfEmploymentTax,
  type FilingStatus,
} from '@/components/tools/federal-tax-model';
import { billableHours, computeTakeHome, type TakeHomeInputs } from '@/components/tools/take-home-model';
import { colAdjusted, compareCities, equivalentSalary } from '@/components/tools/col-model';
import {
  BENCHMARK_MIN_EMPLOYERS,
  BENCHMARK_MIN_POSTINGS,
  classifyOffer,
  summarizeBenchmarks,
  type BenchmarkInputRow,
} from '@/components/tools/benchmark-model';
import { buildCityOptions, cityJobsHref, type SalaryAggregate } from '@/components/tools/city-picker-data';
import { cityLinkResolves } from '@/app/jobs/locations/[state]/directory';
import { CITIES } from '@/lib/pseo/city-data/cities';

const STATUSES: FilingStatus[] = ['single', 'marriedJoint'];

describe('federal tax model — published figures', () => {
  /**
   * Tax year 2026 inflation-adjusted amounts, IRS Rev. Proc. 2025-32, and the
   * 2026 Social Security taxable maximum from the SSA's October 2025 COLA fact
   * sheet. Verified against those sources on 2026-07-29.
   *
   * These are the numbers the tool publishes as dollars on a YMYL page, so
   * they are pinned literally rather than structurally. If you are changing
   * this block you are changing tax year: retype BOTH tables from the new Rev.
   * Proc. and bump YEAR below with TAX_MODEL_YEAR — do not "fix" the test to
   * match the model.
   */
  const YEAR = 2026;
  const SINGLE_BOUNDARIES = [12_400, 50_400, 105_700, 201_775, 256_225, 640_600];
  const JOINT_BOUNDARIES = [24_800, 100_800, 211_400, 403_550, 512_450, 768_700];
  const STANDARD_DEDUCTION_SINGLE = 16_100;
  const STANDARD_DEDUCTION_JOINT = 32_200;
  const SS_WAGE_BASE = 184_500;

  it('pins the year the tables were typed for', () => {
    expect(TAX_MODEL_YEAR).toBe(YEAR);
  });

  it('pins every single-filer bracket boundary', () => {
    const finite = FEDERAL_BRACKETS.single.map((b) => b.upTo).filter(Number.isFinite);
    expect(finite).toEqual(SINGLE_BOUNDARIES);
  });

  it('pins every married-filing-jointly bracket boundary', () => {
    const finite = FEDERAL_BRACKETS.marriedJoint.map((b) => b.upTo).filter(Number.isFinite);
    expect(finite).toEqual(JOINT_BOUNDARIES);
  });

  it('pins both standard deductions', () => {
    expect(STANDARD_DEDUCTION.single).toBe(STANDARD_DEDUCTION_SINGLE);
    expect(STANDARD_DEDUCTION.marriedJoint).toBe(STANDARD_DEDUCTION_JOINT);
  });

  it('pins the Social Security taxable maximum', () => {
    expect(PAYROLL_TAX.socialSecurityWageBase).toBe(SS_WAGE_BASE);
  });

  it('produces the hand-checked tax on a round taxable income', () => {
    // Single, $100,000 taxable: 12,400 @ 10% + 38,000 @ 12% + 49,600 @ 22%
    //   = 1,240 + 4,560 + 10,912 = 16,712.
    expect(federalIncomeTax(100_000, 'single')).toBeCloseTo(16_712, 6);
    // Joint, $100,000 taxable: 24,800 @ 10% + 75,200 @ 12% = 2,480 + 9,024 = 11,504.
    expect(federalIncomeTax(100_000, 'marriedJoint')).toBeCloseTo(11_504, 6);
  });
});

describe('federal tax model — structure', () => {
  it('models a tax year that is not stale', () => {
    // The model was written for 2026; it may only ever move forward.
    expect(TAX_MODEL_YEAR).toBeGreaterThanOrEqual(2026);
  });

  it.each(STATUSES)('%s brackets ascend in both threshold and rate', (status) => {
    const brackets = FEDERAL_BRACKETS[status];
    expect(brackets.length).toBeGreaterThan(0);
    for (let i = 1; i < brackets.length; i += 1) {
      expect(brackets[i].upTo).toBeGreaterThan(brackets[i - 1].upTo);
      expect(brackets[i].rate).toBeGreaterThan(brackets[i - 1].rate);
    }
    expect(brackets[brackets.length - 1].upTo).toBe(Number.POSITIVE_INFINITY);
  });

  it('uses the statutory ordinary-income rate ladder', () => {
    for (const status of STATUSES) {
      expect(FEDERAL_BRACKETS[status].map((b) => b.rate)).toEqual([
        0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37,
      ]);
    }
  });

  it('gives married-filing-jointly the larger standard deduction', () => {
    expect(STANDARD_DEDUCTION.marriedJoint).toBeGreaterThan(STANDARD_DEDUCTION.single);
    expect(STANDARD_DEDUCTION.single).toBeGreaterThan(0);
  });

  it('keeps the statutory payroll rates and thresholds', () => {
    expect(PAYROLL_TAX.seNetEarningsFactor).toBe(0.9235);
    expect(PAYROLL_TAX.socialSecurityRate).toBe(0.124);
    expect(PAYROLL_TAX.medicareRate).toBe(0.029);
    // Self-employed rate is exactly twice the employee-side withholding.
    expect(PAYROLL_TAX.employeeSocialSecurityRate * 2).toBeCloseTo(PAYROLL_TAX.socialSecurityRate, 10);
    expect(PAYROLL_TAX.employeeMedicareRate * 2).toBeCloseTo(PAYROLL_TAX.medicareRate, 10);
    // Additional Medicare Tax thresholds are statutory, not inflation-indexed.
    expect(PAYROLL_TAX.additionalMedicareThreshold.single).toBe(200_000);
    expect(PAYROLL_TAX.additionalMedicareThreshold.marriedJoint).toBe(250_000);
    expect(PAYROLL_TAX.socialSecurityWageBase).toBeGreaterThan(150_000);
  });

  it('publishes sources and an exclusions list for the visible assumptions panel', () => {
    expect(TAX_MODEL_SOURCES.length).toBeGreaterThanOrEqual(3);
    for (const source of TAX_MODEL_SOURCES) expect(source.url).toMatch(/^https:\/\//);
    // State income tax and the QBI deduction must both be declared exclusions.
    const joined = TAX_MODEL_EXCLUSIONS.join(' ').toLowerCase();
    expect(joined).toContain('state and local income tax');
    expect(joined).toContain('qualified business income');
  });
});

describe('federal tax model — computation', () => {
  it('returns no tax on zero or negative taxable income', () => {
    expect(federalIncomeTax(0, 'single')).toBe(0);
    expect(federalIncomeTax(-5_000, 'single')).toBe(0);
  });

  it('taxes only the amount inside each bracket', () => {
    const first = FEDERAL_BRACKETS.single[0];
    expect(federalIncomeTax(first.upTo, 'single')).toBeCloseTo(first.upTo * first.rate, 6);

    const second = FEDERAL_BRACKETS.single[1];
    const expected = first.upTo * first.rate + (second.upTo - first.upTo) * second.rate;
    expect(federalIncomeTax(second.upTo, 'single')).toBeCloseTo(expected, 6);
  });

  it('is monotonically increasing in taxable income', () => {
    let previous = 0;
    for (const income of [10_000, 60_000, 120_000, 220_000, 400_000, 900_000]) {
      const tax = federalIncomeTax(income, 'single');
      expect(tax).toBeGreaterThan(previous);
      previous = tax;
    }
  });

  it('reports the marginal bracket the income lands in', () => {
    const brackets = FEDERAL_BRACKETS.single;
    expect(marginalRate(0, 'single')).toBe(brackets[0].rate);
    expect(marginalRate(brackets[0].upTo, 'single')).toBe(brackets[0].rate);
    expect(marginalRate(brackets[0].upTo + 1, 'single')).toBe(brackets[1].rate);
    expect(marginalRate(10_000_000, 'single')).toBe(brackets[brackets.length - 1].rate);
  });

  it('caps the Social Security portion of self-employment tax at the wage base', () => {
    const base = PAYROLL_TAX.socialSecurityWageBase;
    // Net profit high enough that 92.35% of it clears the wage base.
    const se = selfEmploymentTax(base * 2, 'single');
    expect(se.socialSecurity).toBeCloseTo(base * PAYROLL_TAX.socialSecurityRate, 4);
    expect(se.medicare).toBeCloseTo(base * 2 * PAYROLL_TAX.seNetEarningsFactor * PAYROLL_TAX.medicareRate, 4);
  });

  it('excludes the Additional Medicare Tax from the deductible half of SE tax', () => {
    const se = selfEmploymentTax(400_000, 'single');
    expect(se.additionalMedicare).toBeGreaterThan(0);
    expect(se.halfDeduction).toBeCloseTo((se.socialSecurity + se.medicare) / 2, 6);
    expect(se.total).toBeCloseTo(se.socialSecurity + se.medicare + se.additionalMedicare, 6);
  });

  it('charges no self-employment tax on a loss', () => {
    expect(selfEmploymentTax(0, 'single').total).toBe(0);
    expect(selfEmploymentTax(-10_000, 'marriedJoint').total).toBe(0);
  });

  it('caps employee-side Social Security withholding at the wage base', () => {
    const base = PAYROLL_TAX.socialSecurityWageBase;
    const fica = employeePayrollTax(base * 3, 'single');
    expect(fica.socialSecurity).toBeCloseTo(base * PAYROLL_TAX.employeeSocialSecurityRate, 4);
    expect(fica.medicare).toBeCloseTo(base * 3 * PAYROLL_TAX.employeeMedicareRate, 4);
    expect(fica.additionalMedicare).toBeGreaterThan(0);
  });
});

describe('take-home model', () => {
  const BASE: TakeHomeInputs = {
    filingStatus: 'single',
    hoursPerWeek: 40,
    paidDaysOff: 25,
    w2Salary: 140_000,
    w2EmployerMatchPct: 3,
    w2EmployeePremium: 2_400,
    contractHourlyRate: 82,
    contractBusinessExpenses: 6_000,
    contractHealthPremium: 9_000,
    contractRetirement: 6_000,
  };

  it('removes unpaid days off from billable hours', () => {
    expect(billableHours(40, 0)).toBe(2_080);
    // 25 days at an 8-hour day = 200 hours.
    expect(billableHours(40, 25)).toBe(1_880);
    expect(billableHours(40, 10_000)).toBe(0);
  });

  it('produces a W-2 net position below gross salary but above zero', () => {
    const { w2 } = computeTakeHome(BASE);
    expect(w2.netPosition).toBeGreaterThan(0);
    expect(w2.netPosition).toBeLessThan(w2.gross);
    expect(w2.employerMatch).toBeCloseTo(BASE.w2Salary * 0.03, 6);
  });

  it('reports cash on the SAME basis in both columns', () => {
    // The defect this pins: the two columns once shared a "Spendable cash"
    // label while computing it differently — the 1099 figure was net of the
    // user's own retirement contribution and the W-2 figure was not, so the
    // two rows sitting side by side were not comparable. Both are now
    // "everything taken out except retirement you set aside yourself".
    const { w2, contract } = computeTakeHome(BASE);
    expect(w2.cashAfterTax).toBeCloseTo(
      w2.gross - w2.employeePremium - w2.payrollTax - w2.federalTax,
      6,
    );
    expect(contract.cashAfterTax).toBeCloseTo(
      contract.gross - contract.businessExpenses - contract.selfEmploymentTax
        - contract.federalTax - contract.healthPremium,
      6,
    );
  });

  it('adds only EMPLOYER retirement dollars on top of that cash', () => {
    const { w2, contract } = computeTakeHome(BASE);
    // A match is money the employer adds, so it lifts the W-2 net position.
    expect(w2.netPosition).toBeCloseTo(w2.cashAfterTax + w2.employerMatch, 6);
    // A contractor's own contribution is cash already counted being moved,
    // not extra money, so it must not lift the 1099 net position.
    expect(contract.netPosition).toBeCloseTo(contract.cashAfterTax, 6);
  });

  it('leaves the comparison unchanged when the contractor saves more', () => {
    // Falls out of the rule above, and is the user-visible reason it matters:
    // deciding to fund a bigger SEP-IRA does not make 1099 look worse.
    const saver = computeTakeHome({ ...BASE, contractRetirement: 25_000 });
    const spender = computeTakeHome({ ...BASE, contractRetirement: 0 });
    expect(saver.netPositionDelta).toBeCloseTo(spender.netPositionDelta, 6);
    expect(saver.breakEvenHourlyRate).toBeCloseTo(spender.breakEvenHourlyRate as number, 6);
  });

  it('reproduces a hand-worked W-2 column to the dollar', () => {
    // $140,000 salary, $2,400 Section 125 premium, single.
    //   FICA wages          140,000 - 2,400            = 137,600
    //   Social Security     137,600 x 6.2%             =   8,531.20
    //   Medicare            137,600 x 1.45%            =   1,995.20
    //   (below the $200,000 Additional Medicare threshold)
    //   Taxable income      137,600 - 16,100           = 121,500
    //   Federal tax    12,400 x 10%                    =   1,240
    //                  38,000 x 12%  (12,400->50,400)  =   4,560
    //                  55,300 x 22%  (50,400->105,700) =  12,166
    //                  15,800 x 24% (105,700->121,500) =   3,792
    //                                                    ---------
    //                                                     21,758
    //   Cash after tax  140,000 - 2,400 - 10,526.40 - 21,758 = 105,315.60
    //   Employer match      140,000 x 3%               =   4,200
    //   Net position    105,315.60 + 4,200             = 109,515.60
    const { w2 } = computeTakeHome(BASE);
    expect(w2.payrollTax).toBeCloseTo(10_526.40, 2);
    expect(w2.taxableIncome).toBeCloseTo(121_500, 6);
    expect(w2.federalTax).toBeCloseTo(21_758, 2);
    expect(w2.marginalRate).toBe(0.24);
    expect(w2.cashAfterTax).toBeCloseTo(105_315.60, 2);
    expect(w2.employerMatch).toBeCloseTo(4_200, 6);
    expect(w2.netPosition).toBeCloseTo(109_515.60, 2);
  });

  it('rises monotonically with the contract hourly rate', () => {
    let previous = -Infinity;
    for (const rate of [40, 60, 80, 100, 150, 250]) {
      const { contract } = computeTakeHome({ ...BASE, contractHourlyRate: rate });
      expect(contract.netPosition).toBeGreaterThan(previous);
      previous = contract.netPosition;
    }
  });

  it('solves a break-even rate that actually breaks even', () => {
    const result = computeTakeHome(BASE);
    expect(result.breakEvenHourlyRate).not.toBeNull();
    const atBreakEven = computeTakeHome({ ...BASE, contractHourlyRate: result.breakEvenHourlyRate as number });
    expect(atBreakEven.netPositionDelta).toBeCloseTo(0, 2);
  });

  it('never divides by zero when every input is empty', () => {
    const empty = computeTakeHome({
      filingStatus: 'single',
      hoursPerWeek: 0,
      paidDaysOff: 0,
      w2Salary: 0,
      w2EmployerMatchPct: 0,
      w2EmployeePremium: 0,
      contractHourlyRate: 0,
      contractBusinessExpenses: 0,
      contractHealthPremium: 0,
      contractRetirement: 0,
    });
    expect(Number.isFinite(empty.w2EffectiveHourly)).toBe(true);
    expect(Number.isFinite(empty.contractEffectiveHourly)).toBe(true);
    expect(empty.netPositionDelta).toBe(0);
  });

  it('caps the self-employed health deduction at earned income from the business', () => {
    const thin = computeTakeHome({
      ...BASE,
      contractHourlyRate: 10,
      contractHealthPremium: 200_000,
    });
    expect(thin.contract.healthPremiumDeduction).toBeLessThanOrEqual(thin.contract.netProfit);
    expect(thin.contract.taxableIncome).toBeGreaterThanOrEqual(0);
  });
});

describe('cost-of-living model', () => {
  it('matches the aggregation cron formula: nominal x (100 / colIndex)', () => {
    // app/api/cron/aggregate-pseo/route.ts computes exactly this.
    const nominal = 140;
    const index = 120;
    expect(colAdjusted(nominal, index)).toBeCloseTo(nominal * (100 / index), 10);
  });

  it('leaves a national-average city unchanged', () => {
    expect(colAdjusted(130_000, 100)).toBe(130_000);
  });

  it('is safe against a zero or negative index', () => {
    expect(colAdjusted(130_000, 0)).toBe(0);
    expect(equivalentSalary(130_000, 0, 120)).toBe(0);
  });

  it('computes the salary needed to hold purchasing power', () => {
    // $100k at index 100 needs $150k at index 150.
    expect(equivalentSalary(100_000, 100, 150)).toBeCloseTo(150_000, 6);
  });

  it('detects when the larger nominal salary is the smaller real one', () => {
    const result = compareCities(
      { basis: { nominal: 120_000, basis: 'city', sample: 12 }, colIndex: 95 },
      { basis: { nominal: 135_000, basis: 'state', sample: 300 }, colIndex: 150 },
    );
    expect(result.nominalDelta).toBeGreaterThan(0);
    expect(result.realDelta).toBeLessThan(0);
    expect(result.reversesOnAdjustment).toBe(true);
    expect(result.matchingSalaryInB).toBeCloseTo(120_000 * (150 / 95), 6);
  });

  it('does not flag a reversal when both measures agree', () => {
    const result = compareCities(
      { basis: { nominal: 120_000, basis: 'city', sample: 12 }, colIndex: 110 },
      { basis: { nominal: 140_000, basis: 'city', sample: 9 }, colIndex: 100 },
    );
    expect(result.reversesOnAdjustment).toBe(false);
    expect(result.realDelta).toBeGreaterThan(0);
  });
});

describe('public salary benchmark', () => {
  const row = (state: string, employer: string, min: number, max: number): BenchmarkInputRow => ({
    state,
    employer,
    normalizedMinSalary: min,
    normalizedMaxSalary: max,
  });

  /** n postings spread across `employers` distinct employers. */
  const rows = (state: string, n: number, employers: number, salary = 130_000): BenchmarkInputRow[] =>
    Array.from({ length: n }, (_, i) => row(state, `Employer ${i % employers}`, salary, salary));

  it('suppresses a state below the posting threshold', () => {
    const { states } = summarizeBenchmarks(rows('Texas', BENCHMARK_MIN_POSTINGS - 1, BENCHMARK_MIN_EMPLOYERS));
    expect(states).toHaveLength(0);
  });

  it('suppresses a state whose postings all come from too few employers', () => {
    // Plenty of postings, but they would expose one organisation's pay scale.
    const { states } = summarizeBenchmarks(rows('Texas', 40, BENCHMARK_MIN_EMPLOYERS - 1));
    expect(states).toHaveLength(0);
  });

  it('publishes a state that clears both thresholds', () => {
    const { states } = summarizeBenchmarks(rows('Texas', BENCHMARK_MIN_POSTINGS, BENCHMARK_MIN_EMPLOYERS));
    expect(states).toHaveLength(1);
    expect(states[0].scope).toBe('Texas');
    expect(states[0].postings).toBe(BENCHMARK_MIN_POSTINGS);
    expect(states[0].employers).toBe(BENCHMARK_MIN_EMPLOYERS);
  });

  it('computes median and quartiles over posting midpoints', () => {
    const input: BenchmarkInputRow[] = [
      row('Ohio', 'A', 100_000, 100_000),
      row('Ohio', 'B', 110_000, 110_000),
      row('Ohio', 'C', 120_000, 120_000),
      row('Ohio', 'A', 130_000, 130_000),
      row('Ohio', 'B', 140_000, 140_000),
    ];
    const { states } = summarizeBenchmarks(input);
    expect(states[0].median).toBe(120_000);
    expect(states[0].p25).toBe(110_000);
    expect(states[0].p75).toBe(130_000);
  });

  it('uses the midpoint of a posted range, not its floor or ceiling', () => {
    const input: BenchmarkInputRow[] = Array.from({ length: 5 }, (_, i) =>
      row('Ohio', `Employer ${i % BENCHMARK_MIN_EMPLOYERS}`, 100_000, 200_000),
    );
    const { states } = summarizeBenchmarks(input);
    expect(states[0].median).toBe(150_000);
    expect(states[0].p25).toBe(150_000);
    expect(states[0].p75).toBe(150_000);
  });

  it('never returns anything employer-identifying', () => {
    const { national, states } = summarizeBenchmarks(rows('Texas', 20, 5));
    const serialized = JSON.stringify({ national, states });
    expect(serialized).not.toContain('Employer 0');
    expect(Object.keys(states[0]).sort()).toEqual(
      ['employers', 'median', 'p25', 'p75', 'postings', 'scope'].sort(),
    );
  });

  it('drops rows with no state, no employer, or no pay', () => {
    const { national } = summarizeBenchmarks([
      ...rows('Texas', BENCHMARK_MIN_POSTINGS, BENCHMARK_MIN_EMPLOYERS),
      { state: null, employer: 'A', normalizedMinSalary: 200_000, normalizedMaxSalary: 200_000 },
      { state: 'Texas', employer: null, normalizedMinSalary: 200_000, normalizedMaxSalary: 200_000 },
      { state: 'Texas', employer: 'A', normalizedMinSalary: null, normalizedMaxSalary: null },
    ]);
    expect(national?.postings).toBe(BENCHMARK_MIN_POSTINGS);
  });

  it('returns no national row when the pool itself is too thin', () => {
    const { national } = summarizeBenchmarks(rows('Texas', 2, 2));
    expect(national).toBeNull();
  });

  it('classifies an offer against the published quartiles', () => {
    const { states } = summarizeBenchmarks([
      row('Ohio', 'A', 100_000, 100_000),
      row('Ohio', 'B', 110_000, 110_000),
      row('Ohio', 'C', 120_000, 120_000),
      row('Ohio', 'A', 130_000, 130_000),
      row('Ohio', 'B', 140_000, 140_000),
    ]);
    expect(classifyOffer(90_000, states[0])).toBe('below');
    expect(classifyOffer(120_000, states[0])).toBe('competitive');
    expect(classifyOffer(200_000, states[0])).toBe('above');
  });
});

/**
 * THE CITY-LINK 404 GATE (P2 #5).
 *
 * Every column in the comparator used to render an ungated
 * `/jobs/city/${option.slug}` link. That route 404s two ways this picker can
 * reach, and the picker admits the 15 largest cities per state on state-average
 * fallback alone, so low-inventory and lossy-slug cities are certainly in the
 * dropdown. "St. Louis, MO" was a guaranteed 404: it is top-15 in Missouri by
 * population, and its slug parses back to "St Louis", which matches zero rows
 * against the stored "St. Louis".
 *
 * These tests pin both failure modes, including the one the round-trip check
 * alone does not catch — 120 dataset `slug` fields disagree with the slug the
 * city route actually parses ("Oklahoma City" is stored as `oklahoma-ok`), so
 * the href must be route-derived, not dataset-derived.
 */
describe('comparator city links never point at a known 404', () => {
  const ALL_CITY_NOMINALS: ReadonlyMap<string, SalaryAggregate> = new Map(
    CITIES.map((c) => [c.slug, { nominal: 130_000, sample: 5 }]),
  );
  const STATE_NOMINALS: ReadonlyMap<string, SalaryAggregate> = new Map(
    [...new Set(CITIES.map((c) => c.state))].map((s) => [s, { nominal: 125_000, sample: 40 }]),
  );

  const findCity = (slug: string) => {
    const city = CITIES.find((c) => c.slug === slug);
    if (!city) throw new Error(`fixture city missing: ${slug}`);
    return city;
  };

  it('drops the jobs link for a state-basis city (no verified inventory of its own)', () => {
    // The exact regression: St. Louis reachable, jobs link withheld.
    const options = buildCityOptions({
      perState: 15,
      cityNominals: new Map(),
      stateNominals: STATE_NOMINALS,
    });
    const stLouis = options.find((o) => o.slug === 'st-louis-mo');
    expect(stLouis).toBeDefined();
    expect(stLouis?.basis).toBe('state');
    expect(stLouis?.jobsHref).toBeNull();
  });

  it('drops the jobs link for a lossy slug even when the city carries its own postings', () => {
    // St. Louis clears the sample threshold here; the slug still does not
    // round-trip, so the city page would match zero rows and 404.
    expect(cityLinkResolves('St. Louis', 'MO')).toBe(false);
    expect(cityJobsHref({ name: 'St. Louis', stateCode: 'MO' }, 'city')).toBeNull();

    for (const name of ['Winston-Salem', "Lee's Summit", 'St. Petersburg', 'Coeur d\u2019Alene']) {
      expect(cityJobsHref({ name, stateCode: 'NC' }, 'city')).toBeNull();
    }
  });

  it('withholds the link on state basis regardless of how clean the name is', () => {
    expect(cityJobsHref({ name: 'Austin', stateCode: 'TX' }, 'state')).toBeNull();
    expect(cityJobsHref({ name: 'Austin', stateCode: 'TX' }, 'city')).toBe('/jobs/city/austin-tx');
  });

  it('builds the href from the route slug, not the dataset slug', () => {
    // 120 dataset slugs disagree with what app/jobs/city/[slug] parses.
    // Linking `oklahoma-ok` sends the reader to a page searching for
    // "Oklahoma" — zero rows, hard 404 — while the city is "Oklahoma City".
    const okc = findCity('oklahoma-ok');
    expect(okc.name).toBe('Oklahoma City');
    expect(cityJobsHref(okc, 'city')).toBe('/jobs/city/oklahoma-city-ok');
    expect(cityJobsHref(okc, 'city')).not.toContain(`/jobs/city/${okc.slug}`);

    const slc = findCity('salt-lake-ut');
    expect(cityJobsHref(slc, 'city')).toBe('/jobs/city/salt-lake-city-ut');
  });

  it('emits no href that fails the repo\u2019s own resolution check, across the whole picker', () => {
    const options = buildCityOptions({
      perState: 15,
      cityNominals: ALL_CITY_NOMINALS,
      stateNominals: STATE_NOMINALS,
    });
    expect(options.length).toBeGreaterThan(500);

    const linked = options.filter((o) => o.jobsHref !== null);
    expect(linked.length).toBeGreaterThan(0);

    for (const option of linked) {
      expect(cityLinkResolves(option.name, option.stateCode)).toBe(true);
      // The linked path is exactly what cityLinkResolves validated.
      const routeSlug = option.jobsHref!.replace('/jobs/city/', '');
      expect(routeSlug).toBe(
        `${option.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${option.stateCode.toLowerCase()}`,
      );
    }
  });

  it('still links the clean, high-inventory cities \u2014 the gate is not a blanket removal', () => {
    const options = buildCityOptions({
      perState: 15,
      cityNominals: ALL_CITY_NOMINALS,
      stateNominals: STATE_NOMINALS,
    });
    const linkedRatio = options.filter((o) => o.jobsHref).length / options.length;
    expect(linkedRatio).toBeGreaterThan(0.9);
  });
});

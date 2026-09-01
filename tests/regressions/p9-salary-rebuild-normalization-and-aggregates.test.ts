/**
 * P9 (live-review item #2) — salary normalization + published-aggregate safety.
 *
 * Pins the salary-rebuild package of the live-review fix program:
 *
 *   2a  Monthly-boundary bug — strict `>` at the $40,000 boundary combined
 *       with an inclusive `<=` monthly branch tagged exactly $40,000 as
 *       monthly → ×12 → a published $480k/yr salary. Magnitude-inferred
 *       "monthly" is now dead entirely: monthly ×12 requires an explicit
 *       token (source period field or "/month" in the posting text).
 *   2b  Hourly annualization bypassed the annual cap — $350/hr × 2080 =
 *       $728k was stored unflagged and fed state "averages". The rate ×2080
 *       is kept for honest hourly display but the row is confidence-flagged
 *       below the analytics threshold; non-hourly conversions pass one
 *       annual choke point that no path can bypass.
 *   2c  Published aggregates ran over EVERY published row — 37.5% of the
 *       salaried pool was psychiatrist/PA/podiatrist/CNM pay. Aggregates
 *       now run over npSalaryAnalyticsWhere + the interim NP-title gate.
 *   2d  No minimum-sample gate — 11 states published an "average" of one
 *       posting with gold ranking badges. The benchmark widget's policy
 *       (median, n ≥ 5 postings, ≥ 3 employers) is now the canonical
 *       published-aggregate gate; below it, surfaces say "sample too
 *       small" and cite BLS — never a posting mean.
 *   2e  Structured-vs-text conflict was detected nowhere (extractSalary
 *       only ran when structured salary was absent). The text now always
 *       runs and a >1.5× annualized disagreement flags the row out of
 *       analytics.
 *   2f  Calculator rendered false precision ($188,221) and credited BLS
 *       while BLS never entered the computation. Figures round to the
 *       nearest $1,000 and the footnote names the actual base.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  extractSalary,
  validateAndNormalizeSalary,
  normalizeJobWithReason,
} from '@/lib/job-normalizer';
import {
  normalizeSalary,
  detectSalaryConflict,
  SALARY_CONFLICT_RATIO,
  SALARY_CONFLICT_CONFIDENCE,
} from '@/lib/salary-normalizer';
import {
  npSalaryAnalyticsWhere,
  isNpEligibleTitle,
  filterNpEligibleRows,
  roundSalaryToNearestThousand,
  SALARY_ANALYTICS_MIN_CONFIDENCE,
  CONTRACT_CADENCE_PERIODS,
} from '@/lib/salary-utils';
import {
  summarizeBenchmarks,
  BENCHMARK_MIN_POSTINGS,
  BENCHMARK_MIN_EMPLOYERS,
} from '@/components/tools/benchmark-model';
import { canonicalSalaryPeriod, formatSalary } from '@/lib/utils';

const read = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/* ─── 2a: monthly boundary + no magnitude-inferred monthly ─────────────── */

describe('P9 #2a — $40,000 boundary and magnitude-inferred monthly', () => {
  it('tags a bare $40,000 structured value as annual, never monthly', () => {
    const validated = validateAndNormalizeSalary(40_000, 40_000, 'desc', 'NP role', null);
    expect(validated.salaryPeriod).toBe('annual');
  });

  it('the review repro can never produce $480k: bare $40,000 normalizes far below it', () => {
    const validated = validateAndNormalizeSalary(40_000, 40_000, 'desc', 'NP role', null);
    const normalized = normalizeSalary({
      minSalary: validated.minSalary,
      maxSalary: validated.maxSalary,
      salaryPeriod: validated.salaryPeriod,
    });
    expect(normalized.normalizedMaxSalary).not.toBe(480_000);
    expect(normalized.normalizedMaxSalary ?? 0).toBeLessThan(100_000);
  });

  it('a bare value in the old monthly band ($6k–$40k) becomes period=unknown with normalized values withheld', () => {
    const validated = validateAndNormalizeSalary(8_000, 8_000, 'desc', 'NP role', null);
    expect(validated.salaryPeriod).toBe('unknown');

    const normalized = normalizeSalary({
      minSalary: 8_000,
      maxSalary: 8_000,
      salaryPeriod: validated.salaryPeriod,
    });
    expect(normalized.normalizedMinSalary).toBeNull();
    expect(normalized.normalizedMaxSalary).toBeNull();
    expect(normalized.salaryConfidence).toBeNull();
  });

  it('an EXPLICIT monthly token still annualizes ×12 (monthly pay stays supported)', () => {
    const validated = validateAndNormalizeSalary(8_000, 8_000, 'desc', 'NP role', 'monthly');
    expect(validated.salaryPeriod).toBe('monthly');

    const normalized = normalizeSalary({
      minSalary: 8_000,
      maxSalary: 8_000,
      salaryPeriod: 'monthly',
    });
    expect(normalized.normalizedMinSalary).toBe(96_000);
  });

  it('normalizeSalary alone also refuses to magnitude-infer monthly', () => {
    // Straight through the normalizer with no period hint at all.
    const normalized = normalizeSalary({ minSalary: 12_000, maxSalary: 15_000 });
    expect(normalized.normalizedMinSalary).toBeNull();
    expect(normalized.normalizedMaxSalary).toBeNull();
  });
});

/* ─── 2b: hourly annualization vs the annual cap ───────────────────────── */

describe('P9 #2b — annual cap applies after every conversion', () => {
  it('$350/hr keeps its honest ×2080 value but is confidence-flagged out of analytics', () => {
    const normalized = normalizeSalary({
      minSalary: 350,
      maxSalary: 350,
      salaryPeriod: 'hourly',
    });
    // Display honesty: the hourly rate is real, so the annual equivalent is kept…
    expect(normalized.normalizedMaxSalary).toBe(728_000);
    // …but the row can never enter a published aggregate.
    expect(normalized.salaryConfidence ?? 1).toBeLessThan(SALARY_ANALYTICS_MIN_CONFIDENCE);
  });

  it('non-hourly conversions can never store an annual above the cap', () => {
    const cases: Array<{ min: number; period: string }> = [
      { min: 12_000, period: 'weekly' },   // ×52 = 624k
      { min: 3_000, period: 'daily' },     // ×260 = 780k
      { min: 24_000, period: 'biweekly' }, // ×26 = 624k
      { min: 700_000, period: 'annual' },
    ];
    for (const { min, period } of cases) {
      const normalized = normalizeSalary({ minSalary: min, maxSalary: min, salaryPeriod: period });
      expect(normalized.normalizedMinSalary ?? 0).toBeLessThanOrEqual(550_000);
      // A clamp is an approximation — it must carry a below-threshold confidence.
      expect(normalized.salaryConfidence ?? 1).toBeLessThan(SALARY_ANALYTICS_MIN_CONFIDENCE);
    }
  });

  it('contract-cadence periods are excluded from the analytics predicate outright', () => {
    expect(CONTRACT_CADENCE_PERIODS).toContain('hourly');
    expect(CONTRACT_CADENCE_PERIODS).toContain('daily');
    const where = npSalaryAnalyticsWhere();
    // Prisma types AND as JobWhereInput | JobWhereInput[] — normalize before .find.
    const andClauses = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    const periodClause = andClauses.find((c: Record<string, unknown>) =>
      JSON.stringify(c).includes('salaryPeriod'),
    );
    expect(JSON.stringify(periodClause)).toContain('hourly');
  });
});

/* ─── 2c: profession + hygiene scoping of the analytics pool ───────────── */

describe('P9 #2c — analytics pool predicate and interim NP gate', () => {
  it('npSalaryAnalyticsWhere enforces published, non-estimated, confident, non-expired, annual-cadence', () => {
    const now = new Date('2026-08-23T00:00:00Z');
    const where = npSalaryAnalyticsWhere(now);
    expect(where.isPublished).toBe(true);
    expect(where.salaryIsEstimated).toBe(false);
    expect(where.salaryConfidence).toEqual({ gte: SALARY_ANALYTICS_MIN_CONFIDENCE });
    expect(where.normalizedMinSalary).toEqual({ not: null });
    const serialized = JSON.stringify(where);
    expect(serialized).toContain('expiresAt');
  });

  it('vetoes non-NP provider titles — including dual-role — and admits NP/APRN titles', () => {
    // The exact contaminants the review reproduced in state averages:
    expect(isNpEligibleTitle('Psychiatrist')).toBe(false);
    expect(isNpEligibleTitle('Psychiatrist/PMHNP')).toBe(false); // veto wins for analytics
    expect(isNpEligibleTitle('Podiatrist')).toBe(false);
    expect(isNpEligibleTitle('Physician Assistant - Psychiatry')).toBe(false);
    expect(isNpEligibleTitle('Advanced Practice Provider (PA), Remote')).toBe(false);
    // In-scope titles:
    expect(isNpEligibleTitle('Psychiatric Nurse Practitioner (PMHNP)')).toBe(true);
    expect(isNpEligibleTitle('Family Nurse Practitioner')).toBe(true);
    expect(isNpEligibleTitle('APRN - Cardiology')).toBe(true);
    expect(isNpEligibleTitle('Certified Nurse Midwife (CNM)')).toBe(true);
    // No credential signal at all → not eligible for the salary pool.
    expect(isNpEligibleTitle('Clinical Educator')).toBe(false);
    expect(isNpEligibleTitle(null)).toBe(false);
  });

  it('MD/DO veto fires only in credential context — never on the ", MD" city-state suffix', () => {
    // The mirror failure of the bare-'pa' case: "<Role> - <City>, <ST>" is
    // the dominant aggregator title format, so a bare \bmd\b veto excluded
    // every Maryland posting from the analytics pool (and \bdo\b vetoed any
    // title containing the word "do") — systematically biasing or emptying
    // that state's published median. Execution-verified review repros:
    expect(isNpEligibleTitle('Family Nurse Practitioner - Baltimore, MD')).toBe(true);
    expect(isNpEligibleTitle('Psychiatric Nurse Practitioner (PMHNP) - Annapolis, MD')).toBe(true);
    // Multi-location and region variants of the same suffix:
    expect(isNpEligibleTitle('Nurse Practitioner - Annapolis, MD or Baltimore, MD')).toBe(true);
    expect(isNpEligibleTitle('PMHNP - Washington DC/MD/VA (DMV)')).toBe(true);
    expect(isNpEligibleTitle('Psychiatric NP - Philadelphia, PA/MD region')).toBe(true);
    // The English word "do" is not a Doctor of Osteopathy:
    expect(isNpEligibleTitle('Nurse Practitioner - Do you love telehealth?')).toBe(true);
    // Genuine credential contexts still veto (dual-role postings stay out
    // of the NP analytics pool — conservative by design):
    expect(isNpEligibleTitle('PMHNP or MD')).toBe(false);
    expect(isNpEligibleTitle('Psychiatric Provider (MD/DO or PMHNP)')).toBe(false);
    expect(isNpEligibleTitle('NP/MD Psychiatric Provider')).toBe(false);
    expect(isNpEligibleTitle('Provider M.D. or PMHNP')).toBe(false);
    expect(isNpEligibleTitle('Psychiatric Provider (MD), PMHNP welcome')).toBe(false);
  });

  it('a psychiatrist outlier can no longer move a state median', () => {
    const npRows = [100_000, 110_000, 120_000, 130_000, 140_000].map((mid, i) => ({
      state: 'Delaware',
      employer: `Employer ${i % 3}`, // 3 distinct employers
      title: 'Psychiatric Nurse Practitioner (PMHNP)',
      normalizedMinSalary: mid,
      normalizedMaxSalary: mid,
    }));
    const contaminated = [
      ...npRows,
      {
        state: 'Delaware',
        employer: 'Locum Shop',
        title: 'Psychiatrist',
        normalizedMinSalary: 728_000,
        normalizedMaxSalary: 728_000,
      },
    ];
    const { states } = summarizeBenchmarks(filterNpEligibleRows(contaminated));
    expect(states).toHaveLength(1);
    expect(states[0].median).toBe(120_000);
    expect(states[0].postings).toBe(5);
  });
});

/* ─── 2d: minimum-sample gate + median (not mean-of-min/max) ───────────── */

describe('P9 #2d — publishing gate and median', () => {
  it('a state below n≥5 / 3-employer never yields a published figure', () => {
    const oneRow = [{
      state: 'New Hampshire',
      employer: 'Solo Clinic',
      title: 'Nurse Practitioner',
      normalizedMinSalary: 326_000,
      normalizedMaxSalary: 326_000,
    }];
    const { states, national } = summarizeBenchmarks(oneRow);
    expect(states).toHaveLength(0); // the n=1 "gold badge" state
    expect(national).toBeNull();

    const fourRows = Array.from({ length: BENCHMARK_MIN_POSTINGS - 1 }, (_, i) => ({
      state: 'Vermont',
      employer: `E${i}`,
      title: 'Nurse Practitioner',
      normalizedMinSalary: 120_000,
      normalizedMaxSalary: 130_000,
    }));
    expect(summarizeBenchmarks(fourRows).states).toHaveLength(0);
  });

  it('enough postings from too few employers still fails the gate', () => {
    const oneEmployer = Array.from({ length: BENCHMARK_MIN_POSTINGS + 2 }, () => ({
      state: 'Oregon',
      employer: 'One Hospital System',
      title: 'Nurse Practitioner',
      normalizedMinSalary: 130_000,
      normalizedMaxSalary: 150_000,
    }));
    expect(BENCHMARK_MIN_EMPLOYERS).toBeGreaterThan(1);
    expect(summarizeBenchmarks(oneEmployer).states).toHaveLength(0);
  });

  it('published figure is a true median, not a mean of min/max', () => {
    const skewed = [100_000, 100_000, 100_000, 100_000, 300_000].map((mid, i) => ({
      state: 'Texas',
      employer: `E${i % 3}`,
      title: 'Nurse Practitioner',
      normalizedMinSalary: mid,
      normalizedMaxSalary: mid,
    }));
    const { states } = summarizeBenchmarks(skewed);
    expect(states[0].median).toBe(100_000); // mean would be 140k
  });

  it('salary-guide surfaces run the gated pipeline and dropped the ranked-badge/mean presentation', () => {
    const hub = read('app/salary-guide/page.tsx');
    expect(hub).toContain('npSalaryAnalyticsWhere');
    expect(hub).toContain('filterNpEligibleRows');
    expect(hub).toContain('summarizeBenchmarks');
    expect(hub).toContain('BENCHMARK_MIN_POSTINGS');
    // Gold top-3 medal treatment is gone…
    expect(hub).not.toContain('rgba(251,191,36');
    // …and no mean-of-min/max aggregate remains on the page.
    expect(hub).not.toContain('_avg');
    // Below-gate states are listed without a figure.
    expect(hub).toContain('too few postings');

    const statePage = read('app/salary-guide/[state]/page.tsx');
    expect(statePage).toContain('npSalaryAnalyticsWhere');
    expect(statePage).toContain('filterNpEligibleRows');
    expect(statePage).toContain('summarizeBenchmarks');
    expect(statePage).not.toContain('_avg');
    // Below the gate: "sample too small" + the cited BLS figure, never a posting mean.
    expect(statePage).toContain('Sample too small');
    expect(statePage).toContain('STAT_SOURCES.averageSalary');

    // The sitemap'd sibling surface runs the SAME pipeline — the specialty
    // pages published mean-of-min/max over every isPublished row (psych-
    // tagged psychiatrist rows fed the PMHNP page directly) with a ranked
    // top-paying-states list.
    const specialtyPage = read('app/salary-guide/specialty/[specialty]/page.tsx');
    expect(specialtyPage).toContain('npSalaryAnalyticsWhere');
    expect(specialtyPage).toContain('filterNpEligibleRows');
    expect(specialtyPage).toContain('summarizeBenchmarks');
    expect(specialtyPage).toContain('BENCHMARK_MIN_POSTINGS');
    expect(specialtyPage).not.toContain('_avg');
  });

  it('sitemap gate and /salary-guide/[state] 404 gate read the same predicate', () => {
    // The sitemap used to advertise salary-guide state URLs on the loose
    // "any disclosed salary" predicate while the page notFound()'d unless
    // the GATED analytics pool was non-empty — a state whose disclosed
    // salaries were all hourly/estimated/non-NP (the review's Delaware) was
    // sitemap'd yet hard-404'd: the exact indexed → 404 bounce the gate
    // exists to prevent. Both sides now gate on ≥ 1 active job
    // (activeIndexableJobWhere): the sitemap advertises from statesWithJobs
    // and the page 404s only when getStateActiveJobCount() === 0, rendering
    // below-gate states with the cited BLS figure per the interim policy.
    const sitemap = read('app/sitemap.ts');
    expect(sitemap).not.toContain('statesWithSalary');
    const salaryGuideBlock = sitemap.slice(sitemap.indexOf('salaryGuideStatePages ='));
    expect(salaryGuideBlock).toContain('statesWithJobs.has(s)');

    const statePage = read('app/salary-guide/[state]/page.tsx');
    expect(statePage).toContain('activeIndexableJobWhere');
    expect(statePage).toContain('getStateActiveJobCount');
    expect(statePage).toContain('if (activeJobs === 0)');
    // The 404 gate must NOT be the analytics pool any more.
    expect(statePage).not.toMatch(/if \(salaryData\.jobCount === 0\)/);
  });
});

/* ─── 2e: structured-vs-text conflict detection ────────────────────────── */

describe('P9 #2e — structured value vs posting text', () => {
  it('flags the review fixture: structured $40k/mo vs "$137,000 - $180,000 per year" text', () => {
    expect(
      detectSalaryConflict(
        { min: 40_000, max: 40_000, period: 'monthly' },
        { min: 137_000, max: 180_000, period: 'year' },
      ),
    ).toBe(true);
  });

  it('agreeing figures and missing sides are not conflicts', () => {
    expect(
      detectSalaryConflict(
        { min: 137_000, max: 180_000, period: 'annual' },
        { min: 137_000, max: 180_000, period: 'year' },
      ),
    ).toBe(false);
    expect(
      detectSalaryConflict(
        { min: 140_000, max: 160_000, period: 'annual' },
        { min: null, max: null, period: null },
      ),
    ).toBe(false);
    // Same pay expressed in a different cadence is compared annualized: $70/hr ≈ $145.6k.
    expect(
      detectSalaryConflict(
        { min: 140_000, max: 150_000, period: 'annual' },
        { min: 70, max: 70, period: 'hour' },
      ),
    ).toBe(false);
    expect(SALARY_CONFLICT_RATIO).toBe(1.5);
  });

  it('end-to-end: the description now challenges a wrong structured value', () => {
    // The review's exact shape: structured 40000 (no period) while the
    // posting text discloses a six-figure annual range.
    const text =
      'We are hiring a psychiatric nurse practitioner for our outpatient clinic. ' +
      'Compensation: $137,000 - $180,000 annually with full benefits and CME allowance.';
    const extracted = extractSalary(text);
    expect(extracted.min).toBe(137_000);
    expect(extracted.max).toBe(180_000);

    const result = normalizeJobWithReason(
      {
        title: 'Psychiatric Nurse Practitioner (PMHNP)',
        company: 'Fixture Health',
        location: 'Austin, TX',
        description: text,
        url: 'https://careers.fixturehealth.example/jobs/123',
        id: 'fixture-conflict-1',
        minSalary: 40_000,
        maxSalary: 40_000,
      },
      'fixture-source',
    );
    expect(result.job).not.toBeNull();
    const job = result.job!;
    // Never the fabricated $480k…
    expect(job.normalizedMaxSalary ?? 0).toBeLessThan(480_000);
    // …and the disagreement flags the row out of every published aggregate.
    expect(job.salaryIsEstimated).toBe(true);
    expect(job.salaryConfidence ?? 1).toBeLessThanOrEqual(SALARY_CONFLICT_CONFIDENCE);
    expect(job.salaryConfidence ?? 1).toBeLessThan(SALARY_ANALYTICS_MIN_CONFIDENCE);
  });

  it('a consistent structured+text pair keeps full analytics confidence', () => {
    const text =
      'Join our primary care team as a family nurse practitioner. ' +
      'Compensation: $137,000 - $180,000 annually with full benefits.';
    const result = normalizeJobWithReason(
      {
        title: 'Family Nurse Practitioner',
        company: 'Fixture Health',
        location: 'Austin, TX',
        description: text,
        url: 'https://careers.fixturehealth.example/jobs/124',
        id: 'fixture-consistent-1',
        minSalary: 137_000,
        maxSalary: 180_000,
      },
      'fixture-source',
    );
    expect(result.job).not.toBeNull();
    expect(result.job!.salaryIsEstimated).toBe(false);
    expect(result.job!.salaryConfidence ?? 0).toBeGreaterThanOrEqual(SALARY_ANALYTICS_MIN_CONFIDENCE);
    expect(result.job!.normalizedMinSalary).toBe(137_000);
    expect(result.job!.normalizedMaxSalary).toBe(180_000);
  });
});

/* ─── 2a/2e: 'unknown' cadence renders NO figure on any surface ────────── */

describe("P9 #2a/#2e — salaryPeriod='unknown' is withheld everywhere, incl. the job-detail header", () => {
  it("canonicalSalaryPeriod keeps 'unknown' as its own key instead of folding it into 'annual'", () => {
    // Folding 'unknown' → 'annual' made the job-detail header render the
    // raw tokenless figure as "$35k/yr" (formatSalary(raw min, raw max,
    // period)) while the card showed "Competitive" and the JobPosting
    // schema suppressed baseSalary — the wrong-unit claim + card/header
    // contradiction (#2e) the withhold decision exists to prevent.
    expect(canonicalSalaryPeriod('unknown')).toBe('unknown');
    // The legitimate folds are untouched.
    expect(canonicalSalaryPeriod('hour')).toBe('hourly');
    expect(canonicalSalaryPeriod('year')).toBe('annual');
    expect(canonicalSalaryPeriod(null)).toBe('annual');
    expect(canonicalSalaryPeriod('')).toBe('annual');
  });

  it("formatSalary renders NOTHING for an 'unknown' period — never '$35k/yr'", () => {
    // The exact header call shape: formatSalary(job.minSalary, job.maxSalary,
    // job.salaryPeriod) with the backfill's raw ambiguous bounds.
    expect(formatSalary(35_000, 45_000, 'unknown')).toBe('');
    expect(formatSalary(35_000, null, 'unknown')).toBe('');
    expect(formatSalary(null, 45_000, 'unknown')).toBe('');
    // Known periods still render.
    expect(formatSalary(35_000, 45_000, 'year')).toBe('$35k-$45k/yr');
    expect(formatSalary(60, 75, 'hourly')).toBe('$60-$75/hr');
  });

  it('the job-detail header badge renders from formatSalary and hides on empty', () => {
    const src = read('app/jobs/[slug]/page.tsx');
    expect(src).toContain('formatSalary(job.minSalary, job.maxSalary, job.salaryPeriod)');
    // The badge is conditional, so the '' returned for unknown-period rows
    // suppresses it — matching the card ("Competitive") and the schema
    // (baseSalary omitted).
    expect(src).toMatch(/\{salary && \(/);
  });
});

/* ─── 2f: calculator honesty ───────────────────────────────────────────── */

describe('P9 #2f — calculator rounding and basis label', () => {
  it('rounds to the nearest $1,000 — no more $188,221', () => {
    expect(roundSalaryToNearestThousand(188_221)).toBe(188_000);
    expect(roundSalaryToNearestThousand(188_500)).toBe(189_000);
    expect(roundSalaryToNearestThousand(120_000)).toBe(120_000);
  });

  it('the calculator uses the shared rounding and names its actual base', () => {
    const src = read('components/SalaryCalculator.tsx');
    expect(src).toContain('roundSalaryToNearestThousand');
    // BLS may only be credited when BLS is actually the base…
    expect(src).not.toContain('Estimates based on BLS wage data');
    expect(src).toContain("basis === 'postings'");
    // …and the multipliers disclose that they are editorial, not survey data.
    expect(src).toContain('editorial estimates');
    expect(src).toContain('nearest $1,000');
    // The base is a gated median, not the old contaminated mean.
    expect(src).toContain('medianSalary');
    expect(src).not.toContain('avgSalary');
  });
});

/* ─── backfill script safety (repair-script conventions) ───────────────── */

describe('P9 #2 backfill — scripts/backfill-salary-renormalize.ts', () => {
  const src = read('scripts/backfill-salary-renormalize.ts');

  it('is dry-run by default with an explicit --apply gate', () => {
    expect(src).toContain("process.argv.includes('--apply')");
    expect(src).toMatch(/if \(APPLY\) \{/);
    expect(src).toContain("--check");
  });

  it('re-derives through the SAME fixed normalizer the ingest path uses', () => {
    expect(src).toContain("from '@/lib/job-normalizer'");
    expect(src).toContain('validateAndNormalizeSalary');
    expect(src).toContain('normalizeSalary');
    expect(src).toContain('detectSalaryConflict');
    // Stored 'monthly' is the magnitude bug's main output — it must be re-derived.
    expect(src).not.toMatch(/TRUSTED_STORED_PERIODS[^\n]*'monthly'/);
    // Delta histogram is the review-required report.
    expect(src).toContain('histogram');
  });

  it('only rewrites DERIVED columns — raw source values are never touched', () => {
    const updateBlock = src.match(/prisma\.job\.update\(\{[\s\S]*?\}\);/)?.[0] ?? '';
    expect(updateBlock).toContain('normalizedMinSalary');
    expect(updateBlock).toContain('salaryConfidence');
    // Raw minSalary/maxSalary/salaryRange must not appear as written fields.
    expect(updateBlock).not.toMatch(/\sminSalary:/);
    expect(updateBlock).not.toMatch(/\smaxSalary:/);
    expect(updateBlock).not.toMatch(/\ssalaryRange:/);
  });
});

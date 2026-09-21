/**
 * Regression guards for the tools-reports-content package (tools-content journey):
 *   D1  report loaders retry, then throw at request time (ISR keeps the last
 *       good render) and only resolve null during `next build`.
 *   D2  the salary benchmark reads the salary guide's analytics pool and
 *       publishes the same state gate and national sample.
 *   D3  FAQ accordion panel ids are namespaced per instance.
 *   D4  /salary-guide/<state> Top Cities links clear the city page's MIN_JOBS gate.
 *   D5  the licensure checker lists the live code-generated license guides.
 *   D6  the blog index and post count include the live license guides.
 *   D7  the cost-per-hire parser rejects negative input.
 *   D8  the benchmark offer parser rejects negative offers.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadLiveReportData } from '@/lib/reports/live-load';
import { parsePlainAmount } from '@/components/tools/parse-amount';
import {
  parseOfferInput,
  summarizeBenchmarkPool,
  summarizeBenchmarks,
  type BenchmarkInputRow,
} from '@/components/tools/benchmark-model';
import { faqAnswerId } from '@/components/FAQAccordion';
import {
  categoryIncludesLicenseGuides,
  licenseGuideFallbackSlugs,
  mergeListingWithLicenseGuides,
  type BlogPost,
} from '@/lib/blog';
import { MIN_CITY_JOBS_FOR_LINK } from '@/app/jobs/locations/[state]/directory';

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const noSleep = () => Promise.resolve();

describe('D1 loadLiveReportData', () => {
  it('returns the data after a transient failure without caching a degraded render', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('connect timeout'))
      .mockResolvedValueOnce('snapshot');
    await expect(loadLiveReportData(load, { sleep: noSleep, isBuildPhase: false })).resolves.toBe('snapshot');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('throws at request time once retries are exhausted, so ISR keeps the previous render', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('connect timeout'));
    const onFailure = vi.fn();
    await expect(
      loadLiveReportData(load, { attempts: 3, sleep: noSleep, isBuildPhase: false, onFailure }),
    ).rejects.toThrow('connect timeout');
    expect(load).toHaveBeenCalledTimes(3);
    expect(onFailure).toHaveBeenCalledTimes(3);
  });

  it('resolves null only during next build so an unreachable build database does not fail the build', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('down'));
    await expect(loadLiveReportData(load, { sleep: noSleep, isBuildPhase: true })).resolves.toBeNull();
  });

  it('the report queries no longer swallow failures into a cached null', () => {
    const src = read('lib/reports/queries.ts');
    expect(src).toContain('loadLiveReportData(aggregateHiringReportSnapshot');
    expect(src).toContain('loadLiveReportData(queryDisclosureCohort');
    expect(src).not.toMatch(/catch \(error\)[\s\S]{0,200}return null;/);
  });
});

describe('D2 salary benchmark shares the salary guide pipeline', () => {
  const row = (state: string | null, employer: string, pay: number): BenchmarkInputRow => ({
    state,
    employer,
    normalizedMinSalary: pay,
    normalizedMaxSalary: pay,
  });

  it('the widget reads fetchNpAnalyticsRows, not a private findMany', () => {
    const widget = read('components/tools/EmployerBenchmarkWidget.tsx');
    expect(widget).toContain("from '@/lib/salary-analytics'");
    expect(widget).toContain('fetchNpAnalyticsRows()');
    expect(widget).not.toContain('prisma.job.findMany');
  });

  it('state rows match summarizeBenchmarks and the national row counts stateless rows, like /salary-guide/<state>', () => {
    const rows = [
      ...['A', 'B', 'C', 'D', 'E'].map((e, i) => row('Texas', e, 120_000 + i * 1000)),
      row('Ohio', 'A', 110_000),
      row('Ohio', 'B', 111_000),
      row(null, 'F', 130_000),
    ];
    const pool = summarizeBenchmarkPool(rows);
    expect(pool.states).toEqual(summarizeBenchmarks(rows).states);
    expect(pool.states.map((s) => s.scope)).toEqual(['Texas']);
    expect(pool.national?.postings).toBe(8);
    expect(pool.states.some((s) => s.scope === 'Unknown')).toBe(false);
  });
});

describe('D3 FAQ accordion ids', () => {
  it('namespaces panel ids per instance and keeps the faq-answer- prefix', () => {
    const a = faqAnswerId(':r1:', 0);
    const b = faqAnswerId(':r2:', 0);
    expect(a).not.toBe(b);
    expect(a.startsWith('faq-answer-')).toBe(true);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('the component derives ids from useId, not the bare index', () => {
    const src = read('components/FAQAccordion.tsx');
    expect(src).toContain('useId()');
    expect(src).not.toContain('`faq-answer-${index}`');
  });
});

describe('D4 salary guide Top Cities gate', () => {
  it('filters sidebar cities on MIN_CITY_JOBS_FOR_LINK as well as the slug round trip', () => {
    const src = read('app/salary-guide/[state]/page.tsx');
    expect(MIN_CITY_JOBS_FOR_LINK).toBe(3);
    // WHY THESE PINS CHANGED (PLAN C.1 truth fixes, thin-spec-4 B3): the old
    // getTopCities groupBy filtered on isPublished alone, so expired and
    // dead-link rows inflated the very counts this gate reads. Cities now come
    // from getListingFacts over the canonical pool as facts.cities, which
    // renamed the variables. Both gates survive verbatim, now ANDed into one
    // `linkable` decision, so a city failing either one is named and not
    // linked. Restoring the old literals would mean restoring the inflated
    // count they were reading.
    expect(src).toContain('const cityRows = facts.cities.slice(');
    expect(src).toContain(
      'const linkable = city.count >= MIN_CITY_JOBS_FOR_LINK && cityLinkResolves(city.name, code);',
    );
    // The gate has to reach the href or it gates nothing: a linked city that
    // does not clear the floor is a link to a noindex page.
    expect(src).toContain('href: linkable ? `/jobs/city/${buildCitySlug(city.name, code)}` : null,');
    // ...and the render has to HONOUR the null, or the gate computes a value
    // nothing reads. The gated city is still NAMED, so failing the floor
    // removes the link, not the row.
    expect(src).toContain('city.href ? <Link href={city.href}');
    expect(src).toContain('</Link> : city.name,');
    // And the de-inflated pool is the other half of the fix.
    expect(src).not.toContain('c._count.id >= MIN_CITY_JOBS_FOR_LINK');
  });
});

describe('D5 and D6 license guide listing', () => {
  it('lists every code guide slug with no DB row, and none when the series is unpublished', () => {
    const all = licenseGuideFallbackSlugs([], true);
    expect(all).toHaveLength(51);
    expect(all).toContain('np-license-texas');
    const withRows = licenseGuideFallbackSlugs(['np-license-texas', 'np-license-ohio'], true);
    expect(withRows).toHaveLength(49);
    expect(withRows).not.toContain('np-license-texas');
    expect(licenseGuideFallbackSlugs([], false)).toEqual([]);
  });

  it('includes guides only for the all and state_spotlight filters', () => {
    expect(categoryIncludesLicenseGuides(undefined)).toBe(true);
    expect(categoryIncludesLicenseGuides('all')).toBe(true);
    expect(categoryIncludesLicenseGuides('state_spotlight')).toBe(true);
    expect(categoryIncludesLicenseGuides('salary_guide')).toBe(false);
  });

  it('merges guides into the listing newest first without duplicates or bodies', () => {
    const dbPost = {
      id: 'x',
      title: 'Newer post',
      slug: 'newer-post',
      publish_date: '2026-09-01T00:00:00.000Z',
      category: 'state_spotlight',
    } as BlogPost;
    const olderPost = { ...dbPost, id: 'y', slug: 'np-license-ohio', publish_date: '2020-01-01T00:00:00.000Z' };
    const merged = mergeListingWithLicenseGuides([dbPost, olderPost], ['np-license-texas', 'np-license-ohio']);
    expect(merged.map((p) => p.slug)).toEqual(['newer-post', 'np-license-texas', 'np-license-ohio']);
    expect(merged[1].content).toBe('');
    expect(merged[1].title).toMatch(/Texas/);
  });

  it('the blog index, the count and the licensure checker all use the fallback rule', () => {
    const blog = read('lib/blog.ts');
    const fns = ['getPublishedPosts', 'getPostCount'];
    for (const fn of fns) {
      const body = blog.slice(blog.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 2000), fn).toContain('licenseGuideFallbackSlugs(');
    }
    const checker = read('app/tools/licensure-checker/page.tsx');
    expect(checker).toContain('licenseGuideFallbackSlugs(');
  });
});

describe('D7 and D8 numeric input parsing', () => {
  it('parsePlainAmount accepts plain amounts and rejects negatives and junk', () => {
    expect(parsePlainAmount('500')).toBe(500);
    expect(parsePlainAmount('$120,000')).toBe(120000);
    expect(parsePlainAmount(' 12.5 ')).toBe(12.5);
    expect(parsePlainAmount('0')).toBe(0);
    expect(parsePlainAmount('-500')).toBeNull();
    expect(parsePlainAmount('')).toBeNull();
    expect(parsePlainAmount('1e5')).toBeNull();
    expect(parsePlainAmount('12-3')).toBeNull();
  });

  it('parseOfferInput rejects a negative planned offer', () => {
    expect(parseOfferInput('-120000')).toBeNull();
    expect(parseOfferInput('0')).toBeNull();
    expect(parseOfferInput('120000')).toBe(120000);
  });

  it('neither tool strips the minus sign any more', () => {
    for (const file of [
      'components/tools/EmployerCostPerHireCalculator.tsx',
      'components/tools/EmployerBenchmarkPicker.tsx',
    ]) {
      const src = read(file);
      expect(src, file).not.toContain('replace(/[^0-9.]/g');
    }
    expect(read('components/tools/EmployerCostPerHireCalculator.tsx')).toContain('parsePlainAmount(raw) ?? 0');
  });
});

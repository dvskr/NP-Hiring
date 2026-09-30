/**
 * Indexing audit 2026-09, H-02 / L-04 / GFJ-14: the job page's one
 * breadcrumb trail links only pages that exist and index, each through the
 * target page's own gate (app/jobs/[slug]/job-breadcrumbs.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const listingFacts = vi.hoisted(() => ({ getListingFacts: vi.fn() }));
const salary = vi.hoisted(() => ({ getPublishableSalaryGuideStates: vi.fn() }));
const narrative = vi.hoisted(() => ({ sections: 0 }));

vi.mock('@/lib/pseo/listing-facts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pseo/listing-facts')>()),
  getListingFacts: listingFacts.getListingFacts,
}));
vi.mock('@/lib/salary-analytics', () => ({
  getPublishableSalaryGuideStates: salary.getPublishableSalaryGuideStates,
}));
// Each hub section builder answers per the test's chosen section count, so
// the state hub verdict runs through the real stateHubIndexInput and
// shouldIndexStateHub.
vi.mock('@/lib/pseo/listing-narrative', async (importOriginal) => {
  const nth = (n: number) => () => (narrative.sections >= n ? 'rendered' : null);
  return {
    ...(await importOriginal<typeof import('@/lib/pseo/listing-narrative')>()),
    buildHubEmployersSentence: nth(1),
    buildHubCitiesSentences: nth(2),
    buildHubCategoriesSentence: nth(3),
    buildHubWorkModeSentence: nth(4),
    buildHubSettingsSentence: nth(5),
    buildHubRecencySentence: nth(6),
  };
});

import {
  buildJobBreadcrumbs,
  clearJobCrumbMemo,
  resolveLocalCrumb,
  resolveStateCrumb,
} from '@/app/jobs/[slug]/job-breadcrumbs';

/** The ListingFacts fields the gates read; the section builders are mocked above. */
function facts(total: number, distinctEmployers: number, last30 = total) {
  return {
    total,
    distinctPostings: total,
    distinctEmployers,
    recency: { total, datedCount: total, last7: 0, last30, newestPostedAt: null },
    cities: [],
    categoryTop: [],
    topEmployers: [],
    workMode: { total, remote: 0, hybrid: 0, onsite: total },
    settings: { total, labeledTotal: 0, top: [] },
  };
}

const PASSING = facts(40, 12);
const THIN = facts(1, 1);

beforeEach(() => {
  vi.clearAllMocks();
  clearJobCrumbMemo();
  narrative.sections = 6;
  salary.getPublishableSalaryGuideStates.mockResolvedValue(new Set(['Ohio']));
  listingFacts.getListingFacts.mockResolvedValue(PASSING);
});

describe('state crumb', () => {
  it('links the state hub when it indexes, from the hub page scope', async () => {
    await expect(resolveStateCrumb('OH')).resolves.toEqual({ label: 'Ohio', href: '/jobs/state/ohio' });
    expect(listingFacts.getListingFacts).toHaveBeenCalledWith('state:ohio', { OR: [{ state: 'Ohio' }, { stateCode: 'OH' }] });
  });

  it('is dropped when the hub renders noindex (too few live sections or postings)', async () => {
    narrative.sections = 0;
    salary.getPublishableSalaryGuideStates.mockResolvedValue(new Set());
    await expect(resolveStateCrumb('OH')).resolves.toBeNull();
    narrative.sections = 6;
    listingFacts.getListingFacts.mockResolvedValue(THIN);
    await expect(resolveStateCrumb('OH')).resolves.toBeNull();
  });
});

describe('local crumb', () => {
  it('links the city page only when it clears its render floor and index gate (the Beachwood case)', async () => {
    listingFacts.getListingFacts.mockResolvedValue(THIN);
    await expect(resolveLocalCrumb('Beachwood', 'OH')).resolves.toBeNull();
    listingFacts.getListingFacts.mockResolvedValue(PASSING);
    await expect(resolveLocalCrumb('Beachwood', 'OH')).resolves.toEqual({ label: 'Beachwood', href: '/jobs/city/beachwood-oh' });
  });

  it('a single-employer city (renders, but noindex) gets no crumb', async () => {
    listingFacts.getListingFacts.mockResolvedValue(facts(40, 1));
    await expect(resolveLocalCrumb('Beachwood', 'OH')).resolves.toBeNull();
  });

  it('a metro twin links the metro guide directly instead of the 308ing city URL', async () => {
    await expect(resolveLocalCrumb('Houston', 'TX')).resolves.toEqual({ label: 'Houston', href: '/jobs/metro/houston-tx' });
    expect(listingFacts.getListingFacts).toHaveBeenCalledWith('metro:houston-tx', expect.any(Object));
    listingFacts.getListingFacts.mockResolvedValue(facts(40, 12, 0));
    await expect(resolveLocalCrumb('Houston', 'TX')).resolves.toBeNull();
  });

  it('a name that does not round-trip through the city slug gets no crumb', async () => {
    await expect(resolveLocalCrumb("Coeur d'Alene", 'ID')).resolves.toBeNull();
  });
});

describe('buildJobBreadcrumbs', () => {
  it('Home, Jobs, gated state, gated city, then the unlinked current page', async () => {
    const crumbs = await buildJobBreadcrumbs({ city: 'Beachwood', state: 'Ohio', stateCode: 'OH' }, 'PMHNP at LifeStance Health');
    expect(crumbs).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Jobs', href: '/jobs' },
      { label: 'Ohio', href: '/jobs/state/ohio' },
      { label: 'Beachwood', href: '/jobs/city/beachwood-oh' },
      { label: 'PMHNP at LifeStance Health', href: '' },
    ]);
  });

  it('a job without a state gets no local crumb (no more /jobs/city/{facility} 404s)', async () => {
    const crumbs = await buildJobBreadcrumbs({ city: 'Newport Hospital', state: null, stateCode: null }, 'NP at Lifespan');
    expect(crumbs.map((c) => c.href)).toEqual(['/', '/jobs', '']);
  });

  it('memoises each target verdict, so a crawl burst reads a state hub once', async () => {
    await buildJobBreadcrumbs({ city: 'Beachwood', state: 'Ohio', stateCode: 'OH' }, 'Job A');
    const callsAfterFirst = listingFacts.getListingFacts.mock.calls.length;
    const crumbs = await buildJobBreadcrumbs({ city: 'Beachwood', state: 'Ohio', stateCode: 'OH' }, 'Job B');
    expect(listingFacts.getListingFacts.mock.calls.length).toBe(callsAfterFirst);
    expect(crumbs[crumbs.length - 1]).toEqual({ label: 'Job B', href: '' });
  });

  it('a gate failure drops the crumb, never the page', async () => {
    listingFacts.getListingFacts.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const crumbs = await buildJobBreadcrumbs({ city: 'Beachwood', state: 'Ohio', stateCode: 'OH' }, 'Job');
    expect(crumbs.map((c) => c.href)).toEqual(['/', '/jobs', '']);
    spy.mockRestore();
  });
});

describe("drift guard: each crumb calls its page's gate with the page's inputs", () => {
  const root = process.cwd();
  const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

  /** The object-literal argument of the first `fn({...})` call, whitespace-normalised. */
  function callArgs(src: string, fn: string): string {
    const start = src.indexOf(`${fn}({`);
    expect(start, `${fn}({ not found`).toBeGreaterThan(-1);
    const open = start + fn.length + 1;
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      if (src[i] === '}') depth -= 1;
      if (depth === 0) {
        return src.slice(open, i + 1).replace(/\s+/g, ' ').replace(/,\s*\}$/, ' }');
      }
    }
    throw new Error(`unbalanced call to ${fn}`);
  }

  const mine = read('app/jobs/[slug]/job-breadcrumbs.ts');

  it('metro: the same shouldIndexMetro input as the metro guide', () => {
    expect(callArgs(mine, 'shouldIndexMetro')).toBe(callArgs(read('app/jobs/metro/[slug]/page.tsx'), 'shouldIndexMetro'));
  });

  it('city: the same shouldIndexLocalListingPage input as the city page', () => {
    expect(callArgs(mine, 'shouldIndexLocalListingPage'))
      .toBe(callArgs(read('app/jobs/city/[slug]/page.tsx'), 'shouldIndexLocalListingPage'));
  });

  it('state: the shared hub input builder, not a copy of the section count', () => {
    expect(mine).toContain("from '@/lib/pseo/state-hub-index'");
    expect(mine).toContain('stateHubIndexInput(stateName, facts, publishable.has(stateName))');
    expect(mine).not.toContain('buildHubEmployersSentence');
  });
});

describe('the job page renders only this trail', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'app/jobs/[slug]/page.tsx'), 'utf8');

  it('builds the trail through buildJobBreadcrumbs and emits no second BreadcrumbList', () => {
    expect(page).toContain('buildJobBreadcrumbs(job, `${displayTitle} at ${displayEmployer}`)');
    expect(page).not.toContain('<BreadcrumbSchema');
    expect(page).not.toMatch(/\/jobs\/city\/\$\{/);
  });
});

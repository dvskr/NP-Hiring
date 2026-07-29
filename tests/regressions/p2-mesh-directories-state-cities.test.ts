/**
 * P2 #12 regression pins — per-state city directories (/jobs/locations/<state>).
 *
 * 4,135 city records ship in lib/pseo/city-data/cities.ts and app/sitemap.ts
 * submits every city page with ≥3 active jobs, but the only city links on the
 * whole site were the top 12 tiles on /jobs/locations. These pins hold the
 * gating rules that make the new tier safe: a linked city must clear the same
 * threshold its city page uses to decide whether to notFound(), and a state
 * with nothing to list must not get a URL.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MIN_CITY_JOBS_FOR_LINK,
  MIN_LINKABLE_CITIES,
  MIN_TRACKED_CITIES,
  activeJobsInStateWhere,
  buildCitySlug,
  buildStateCityDirectory,
  cityLinkResolves,
  parseCitySlugToName,
  shouldRenderStateCityDirectory,
} from '@/app/jobs/locations/[state]/directory';
import { activeIndexableJobWhere } from '@/lib/active-job-filter';
import { MIN_JOBS_FOR_CATEGORY_CITY } from '@/lib/pseo/render-gate';
import { MIN_RELATED_CITY_JOBS } from '@/lib/pseo/related-cities';
import { METRO_CITIES } from '@/lib/metro-data';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const statePageSrc = () => read('app/jobs/locations/[state]/page.tsx');
/**
 * Comment-free view of a source file. The "this shape must never come back"
 * assertions below have to ignore the comments that document the shape being
 * banned, or the documentation trips its own pin.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hubSrc = () => read('app/jobs/locations/page.tsx');
const cityPageSrc = () => read('app/jobs/city/[slug]/page.tsx');

describe('P2 #12: link threshold stays in lockstep with the city page gate', () => {
  it('matches every other pSEO city threshold in the repo', () => {
    expect(MIN_CITY_JOBS_FOR_LINK).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
    expect(MIN_CITY_JOBS_FOR_LINK).toBe(MIN_RELATED_CITY_JOBS);
  });

  it('matches the MIN_JOBS constant the city page 404s below', () => {
    const match = cityPageSrc().match(/const\s+MIN_JOBS\s*=\s*(\d+)/);
    expect(match, 'city page MIN_JOBS constant not found — gate may have moved').toBeTruthy();
    expect(Number(match![1])).toBe(MIN_CITY_JOBS_FOR_LINK);
  });
});

describe('P2 #12: directory bucketing', () => {
  const rows = [
    { city: 'Chicago', count: 23 },
    { city: 'Huntley', count: 5 },
    { city: 'Geneva', count: 4 },
    { city: 'Aurora', count: 2 },
    { city: 'Peoria', count: 1 },
    { city: 'Ghost Town', count: 0 },
    { city: '   ', count: 7 },
  ];

  it('links only cities at or above the threshold', () => {
    const directory = buildStateCityDirectory(rows);
    expect(directory.linkable.map((r) => r.city)).toEqual(['Chicago', 'Huntley', 'Geneva']);
    expect(directory.linkable.every((r) => r.count >= MIN_CITY_JOBS_FOR_LINK)).toBe(true);
  });

  it('keeps sub-threshold cities as mentions rather than dropping or linking them', () => {
    const directory = buildStateCityDirectory(rows);
    expect(directory.emerging.map((r) => r.city)).toEqual(['Aurora', 'Peoria']);
    expect(directory.emerging.every((r) => r.count < MIN_CITY_JOBS_FOR_LINK)).toBe(true);
  });

  it('omits cities with no live inventory and blank city names entirely', () => {
    const directory = buildStateCityDirectory(rows);
    const all = [...directory.linkable, ...directory.emerging].map((r) => r.city);
    expect(all).not.toContain('Ghost Town');
    expect(all.some((c) => c.trim() === '')).toBe(false);
    expect(directory.trackedCities).toBe(5);
    expect(directory.cityJobs).toBe(35);
  });

  it('ranks by volume, then alphabetically for ties', () => {
    const directory = buildStateCityDirectory([
      { city: 'Zion', count: 4 },
      { city: 'Alton', count: 4 },
      { city: 'Moline', count: 9 },
    ]);
    expect(directory.linkable.map((r) => r.city)).toEqual(['Moline', 'Alton', 'Zion']);
  });

  it('does not mutate the caller-supplied rows', () => {
    const input = [{ city: 'B', count: 1 }, { city: 'A', count: 9 }];
    buildStateCityDirectory(input);
    expect(input.map((r) => r.city)).toEqual(['B', 'A']);
  });
});

describe('P2 #12: thin-directory gate', () => {
  it('renders a state with a linkable city and enough tracked cities', () => {
    const directory = buildStateCityDirectory([
      { city: 'Chicago', count: 23 },
      { city: 'Aurora', count: 2 },
      { city: 'Peoria', count: 1 },
    ]);
    expect(shouldRenderStateCityDirectory(directory)).toBe(true);
  });

  it('rejects a state with no linkable city — the page would link nothing', () => {
    const directory = buildStateCityDirectory([
      { city: 'Aurora', count: 2 },
      { city: 'Peoria', count: 1 },
      { city: 'Alton', count: 2 },
    ]);
    expect(directory.linkable.length).toBeLessThan(MIN_LINKABLE_CITIES);
    expect(shouldRenderStateCityDirectory(directory)).toBe(false);
  });

  it('rejects a single-city state — one link is not a directory', () => {
    const directory = buildStateCityDirectory([{ city: 'Washington', count: 4 }]);
    expect(directory.trackedCities).toBeLessThan(MIN_TRACKED_CITIES);
    expect(shouldRenderStateCityDirectory(directory)).toBe(false);
  });

  it('rejects an empty state', () => {
    expect(shouldRenderStateCityDirectory(buildStateCityDirectory([]))).toBe(false);
  });
});

describe('P2 #12: city slugs round-trip through the city route', () => {
  // The city page parses `^(.+)-([a-z]{2})$` and title-cases the hyphen
  // segments to rebuild the name it matches on (case-insensitively). A slug
  // that does not survive that trip resolves to zero jobs → soft 404.
  it.each([
    ['Chicago', 'IL', 'chicago-il'],
    ['New York', 'NY', 'new-york-ny'],
    ['Salt Lake City', 'UT', 'salt-lake-city-ut'],
    ['Fairfield County', 'CT', 'fairfield-county-ct'],
    ['La Jolla', 'CA', 'la-jolla-ca'],
  ])('%s, %s → %s and back', (city, code, expected) => {
    const slug = buildCitySlug(city, code);
    expect(slug).toBe(expected);
    expect(parseCitySlugToName(slug)?.toLowerCase()).toBe(city.toLowerCase());
    expect(cityLinkResolves(city, code)).toBe(true);
  });

  it('returns an empty slug rather than a bare state code for an unusable name', () => {
    expect(buildCitySlug('///', 'IL')).toBe('');
    expect(cityLinkResolves('///', 'IL')).toBe(false);
  });

  it('mirrors the city route parser exactly, including its regex rejection', () => {
    // Same source of truth: the parser in the city route, transcribed.
    const routeParser = (slug: string): string | null => {
      const match = slug.toLowerCase().trim().match(/^(.+)-([a-z]{2})$/);
      if (!match) return null;
      return match[1].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    };
    for (const slug of ['chicago-il', 'st-louis-mo', 'fond-du-lac-wi', 'nostatecode', 'ai-oh']) {
      expect(parseCitySlugToName(slug)).toBe(routeParser(slug));
    }
    expect(parseCitySlugToName('nostatecode')).toBeNull();
  });
});

describe('P2 #12: names the slug builder mangles are never linked', () => {
  // REGRESSION: the original build linked every city clearing the count
  // threshold on the strength of "buildCitySlug is byte-identical to the city
  // route's builder". The builder is not the gate — the PARSER is, and it is
  // lossy: every non-alphanumeric character collapses to a hyphen on the way
  // out and comes back as a space. getCityStats then matches the rebuilt name
  // against the stored `city` column with `equals` (insensitive), finds
  // nothing, and the page 404s on its MIN_JOBS gate.
  it.each([
    ['St. Louis', 'MO'],
    ['St. Paul', 'MN'],
    ['St. Petersburg', 'FL'],
    ['Winston-Salem', 'NC'],
    ['Wilkes-Barre', 'PA'],
    ["Lee's Summit", 'MO'],
    ["O'Fallon", 'MO'],
    ["Coeur d'Alene", 'ID'],
    ['Sault Ste. Marie', 'MI'],
    ['Opa-locka', 'FL'],
    ['La Cañada Flintridge', 'CA'],
    ['Indianapolis city (balance)', 'IN'],
  ])('%s, %s does not survive the parser and is not linkable', (city, code) => {
    expect(parseCitySlugToName(buildCitySlug(city, code))?.toLowerCase()).not.toBe(city.toLowerCase());
    expect(cityLinkResolves(city, code)).toBe(false);
  });

  it('demotes a mangled city to the mention list instead of dropping it', () => {
    const directory = buildStateCityDirectory(
      [
        { city: 'Kansas City', count: 11 },
        { city: 'St. Louis', count: 9 },
        { city: 'Springfield', count: 4 },
        { city: 'Joplin', count: 1 },
      ],
      { canLink: (row) => cityLinkResolves(row.city, 'MO') },
    );
    expect(directory.linkable.map((r) => r.city)).toEqual(['Kansas City', 'Springfield']);
    // Named with its real count — not silently deleted, and not linked.
    expect(directory.emerging.map((r) => r.city)).toEqual(['St. Louis', 'Joplin']);
    expect(directory.emerging.find((r) => r.city === 'St. Louis')?.count).toBe(9);
    // Every usable row still lands in exactly one bucket.
    expect(directory.trackedCities).toBe(4);
    expect(directory.linkable.length + directory.emerging.length).toBe(directory.trackedCities);
  });

  it('404s a state whose only above-threshold city is unlinkable, rather than linking a dead end', () => {
    const directory = buildStateCityDirectory(
      [
        { city: 'St. Louis', count: 9 },
        { city: 'Joplin', count: 2 },
        { city: 'Rolla', count: 1 },
      ],
      { canLink: (row) => cityLinkResolves(row.city, 'MO') },
    );
    expect(directory.linkable).toHaveLength(0);
    expect(shouldRenderStateCityDirectory(directory)).toBe(false);
  });

  it('exempts curated metro slugs — those pages match by slug and never re-parse a name', () => {
    // Guard the exemption is real rather than vacuous.
    expect(METRO_CITIES.length).toBeGreaterThan(0);
    for (const metro of METRO_CITIES) {
      expect(
        cityLinkResolves(metro.city, metro.stateCode),
        `${metro.city}, ${metro.stateCode} is a curated metro and must stay linkable`,
      ).toBe(true);
    }
  });

  it('rejects every punctuated name shipped in the city dataset, not just hand-picked ones', () => {
    // The pre-fix report claimed "verified all 55 eligible city slugs
    // round-trip — zero failures"; it checked the regex SHAPE, not name
    // equality. Drive this off the real dataset so the claim is testable.
    const cityData = read('lib/pseo/city-data/cities.ts');
    const names = [...cityData.matchAll(/^\s*name:\s*"([^"]*)",/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(4000);

    const mangled = names.filter(
      (n) => parseCitySlugToName(buildCitySlug(n, 'XX'))?.toLowerCase() !== n.toLowerCase(),
    );
    expect(mangled.length).toBeGreaterThan(50);
    for (const name of mangled) {
      expect(cityLinkResolves(name, 'XX'), `${name} must not be linkable`).toBe(false);
    }
  });
});

describe('P2 #12: the state filter keeps the expiry gate', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('nests the state match under AND so it cannot clobber the helper OR', () => {
    // REGRESSION: the original was `{ ...activeIndexableJobWhere(), OR: [{state},{stateCode}] }`.
    // The helper's own top-level OR *is* the expiry pair, so the sibling key
    // overwrote it and every "live" figure on the page counted expired rows.
    const where = activeJobsInStateWhere('Illinois', 'IL', now);
    expect(where.OR).toBeUndefined();
    const clauses = where.AND as Record<string, unknown>[];
    expect(Array.isArray(clauses)).toBe(true);
    expect(clauses).toContainEqual(activeIndexableJobWhere(now));
    expect(clauses).toContainEqual({ OR: [{ state: 'Illinois' }, { stateCode: 'IL' }] });
  });

  it('still carries the exact expiry pair pinned by tests/seo/sitemap-active-jobs.test.ts', () => {
    const clauses = activeJobsInStateWhere('Illinois', 'IL', now).AND as Record<string, unknown>[];
    const active = clauses.find((c) => 'isPublished' in c)!;
    expect(active.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: now } }]);
    expect(active.isPublished).toBe(true);
    expect(active.healthConsecutiveMissing).toBeDefined();
  });

  it('survives being spread with extra keys — the shape the page actually uses', () => {
    const where = { ...activeJobsInStateWhere('Illinois', 'IL', now), city: { not: null } };
    const clauses = where.AND as Record<string, unknown>[];
    expect(clauses.find((c) => 'isPublished' in c)!.OR)
      .toEqual([{ expiresAt: null }, { expiresAt: { gt: now } }]);
  });
});

describe('P2 #12: route wiring', () => {
  it('gates the page on the shared predicate and 404s a thin state', () => {
    const src = statePageSrc();
    expect(src).toContain('shouldRenderStateCityDirectory');
    expect(src).toContain('notFound()');
  });

  it('counts with the active-indexable filter, not bare isPublished', () => {
    const src = statePageSrc();
    expect(src).toContain('activeJobsInStateWhere(stateName, stateCode)');
    // The old form spread the helper next to a sibling OR key, which deleted
    // the expiry predicate. Neither the spread nor a hand-rolled state OR may
    // come back into this file.
    const code = stripComments(src);
    expect(code).not.toContain('...activeIndexableJobWhere()');
    expect(code).not.toContain('...activeWhere');
    expect(code).not.toMatch(/OR:\s*\[\{\s*state:/);
  });

  it('averages salary over rows that disclose BOTH bounds', () => {
    const src = statePageSrc();
    // Prisma _avg skips NULLs per column, so an unfiltered two-column average
    // can draw its ends from two different job sets and invert the range.
    expect(src).toContain('normalizedMinSalary: { not: null }');
    expect(src).toContain('normalizedMaxSalary: { not: null }');
    // …and the count aggregate must NOT be the one carrying _avg, or the
    // null filter would silently shrink every per-city job count.
    const countAggregate = src.slice(src.indexOf("by: ['city']"), src.indexOf('_count: { city: true }'));
    expect(countAggregate).not.toContain('_avg');
  });

  it('links only cities whose slug survives the city route parser', () => {
    const src = statePageSrc();
    expect(src).toContain('cityLinkResolves');
    expect(src).toContain('canLink:');
  });

  it('dedupes the aggregates between generateMetadata and the render', () => {
    const src = statePageSrc();
    expect(src).toContain("import { cache } from 'react'");
    expect(src).toMatch(/const\s+getStateDirectory\s*=\s*cache\(/);
  });

  it('consolidates state-code slugs onto the canonical name slug with a 308', () => {
    const src = statePageSrc();
    expect(src).toContain('permanentRedirect(`/jobs/locations/${canonicalSlug}`)');
    expect(src).toContain('alternates: { canonical }');
  });

  it('links curated metros directly instead of bouncing through the city redirect', () => {
    expect(statePageSrc()).toContain('getMetroCity');
  });

  it('never links a sub-threshold city — emerging rows render as list items only', () => {
    const src = statePageSrc();
    // The emerging block must not contain a Link component.
    const emergingBlock = src.slice(src.indexOf('directory.emerging.length > 0'), src.indexOf('═══ Continue ═══'));
    expect(emergingBlock.length).toBeGreaterThan(200);
    expect(emergingBlock).not.toContain('<Link');
  });

  it('derives ItemList from the same array the cards render, escaped with the repo pattern', () => {
    const src = statePageSrc();
    expect(src).toContain('itemListElement: linkedCities.map(');
    expect(src).toContain("replace(/</g, '\\\\u003c')");
  });

  it('prints only the repaired metroArea field from the city dataset', () => {
    const src = statePageSrc();
    expect(src).toContain('getCityByNameState');
    // Population / cost-of-living / income were keyed by city name alone across
    // states and were NOT repaired — they must not be rendered here.
    expect(src).not.toContain('costOfLivingIndex');
    expect(src).not.toContain('medianIncome');
    expect(src).not.toContain('mentalHealthShortage');
  });

  it('reads brand identity from config/brand.ts rather than hardcoding the niche', () => {
    const src = statePageSrc();
    expect(src).toContain("from '@/config/brand'");
    expect(src).not.toMatch(/\bNurse Practitioners?\b/);
  });
});

describe('P2 #12: hub links the directories with the same gate', () => {
  it('imports the shared gate rather than re-deriving eligibility', () => {
    const src = hubSrc();
    expect(src).toContain("from './[state]/directory'");
    expect(src).toContain('shouldRenderStateCityDirectory');
  });

  it('links /jobs/locations/<state> for every state that passes', () => {
    expect(hubSrc()).toContain('href={`/jobs/locations/${entry.slug}`}');
  });

  it('uses the active-indexable filter for the eligibility aggregate', () => {
    expect(hubSrc()).toContain('activeIndexableJobWhere()');
  });

  it('applies the same unlinkable-city veto, so it cannot link a directory that 404s', () => {
    const src = hubSrc();
    expect(src).toContain('cityLinkResolves');
    expect(src).toContain('canLink:');
  });

  it('reports the real number of cities hiring instead of the top-12 slice', () => {
    const src = hubSrc();
    expect(src).toContain("label: 'Cities Hiring'");
    expect(src).not.toContain("`${stats.topCities.length}+`");
  });

  it('counts only US cities in the hero stat, matching the state grid whitelist', () => {
    // The raw groupBy carries non-US rows ("British Columbia") that the state
    // grid filters out; the headline stat must not fold them back in.
    expect(hubSrc()).toContain('US_STATES.has(r.state)');
  });
});

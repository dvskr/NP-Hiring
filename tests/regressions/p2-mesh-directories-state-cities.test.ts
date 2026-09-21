/**
 * P2 #12 regression pins: per-state city directories (/jobs/locations/<state>).
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
  CITY_CARD_EMPLOYER_LIMIT,
  MIN_CITY_JOBS_FOR_LINK,
  MIN_LINKABLE_CITIES,
  MIN_TRACKED_CITIES,
  activeJobsInStateWhere,
  buildCitySlug,
  buildStateCityDirectory,
  cityLinkResolves,
  parseCitySlugToName,
  selectCityDetails,
  shouldRenderStateCityDirectory,
  stateBucketWhere,
  summarizeStateDirectories,
} from '@/app/jobs/locations/[state]/directory';
import { canonicalActiveJobWhere } from '@/lib/canonical-counts';
import { buildDirectoryFaqs } from '@/lib/pseo/listing-narrative';
import { MIN_CITY_EMPLOYERS } from '@/lib/pseo/city-employers';
import { MIN_JOBS_FOR_CATEGORY_CITY, MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX } from '@/lib/pseo/render-gate';
import { MIN_RELATED_CITY_JOBS } from '@/lib/pseo/related-cities';
import { METRO_CITIES } from '@/lib/metro-data';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const statePageSrc = () => read('app/jobs/locations/[state]/page.tsx');
const directorySrc = () => read('app/jobs/locations/[state]/directory.ts');
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
    expect(match, 'city page MIN_JOBS constant not found: gate may have moved').toBeTruthy();
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

  it('rejects a state with no linkable city: the page would link nothing', () => {
    const directory = buildStateCityDirectory([
      { city: 'Aurora', count: 2 },
      { city: 'Peoria', count: 1 },
      { city: 'Alton', count: 2 },
    ]);
    expect(directory.linkable.length).toBeLessThan(MIN_LINKABLE_CITIES);
    expect(shouldRenderStateCityDirectory(directory)).toBe(false);
  });

  it('rejects a single-city state: one link is not a directory', () => {
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
  // route's builder". The builder is not the gate; the PARSER is, and it is
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
    // Named with its real count: not silently deleted, and not linked.
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

  it('exempts curated metro slugs: those pages match by slug and never re-parse a name', () => {
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
    // round-trip, zero failures"; it checked the regex SHAPE, not name
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

describe('P2 #12 / T0-1: the state filter is the canonical predicate and keeps the expiry gate', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const EXPIRY_PAIR = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };

  it('exposes the bare state bucket for getListingFacts, which composes the canonical clause itself', () => {
    expect(stateBucketWhere('Illinois', 'IL')).toEqual({ OR: [{ state: 'Illinois' }, { stateCode: 'IL' }] });
  });

  it('nests the state match under AND beside canonicalActiveJobWhere so nothing clobbers a gate', () => {
    // REGRESSION: the original was `{ ...activeIndexableJobWhere(), OR: [{state},{stateCode}] }`.
    // The helper's own top-level OR *is* the expiry pair, so the sibling key
    // overwrote it and every "live" figure on the page counted expired rows.
    // The thin-content plan (T0-1) then moved every count onto the canonical
    // predicate, which app/sitemap.ts and the locations hub read too.
    const where = activeJobsInStateWhere('Illinois', 'IL', now);
    expect(where.OR).toBeUndefined();
    const clauses = where.AND as Record<string, unknown>[];
    expect(Array.isArray(clauses)).toBe(true);
    expect(clauses).toContainEqual(canonicalActiveJobWhere(now));
    expect(clauses).toContainEqual({ OR: [{ state: 'Illinois' }, { stateCode: 'IL' }] });
  });

  it('still carries the exact expiry pair pinned by tests/seo/sitemap-active-jobs.test.ts', () => {
    const clauses = activeJobsInStateWhere('Illinois', 'IL', now).AND as Record<string, unknown>[];
    const active = clauses.find((c) => 'isPublished' in c)!;
    // canonicalActiveJobWhere moves the pair inside its own AND so a sibling
    // OR can never delete it; the pair itself is unchanged.
    expect(active.AND).toContainEqual(EXPIRY_PAIR);
    expect(active.isPublished).toBe(true);
    expect(active.healthConsecutiveMissing).toBeDefined();
  });

  it('applies the profession quarantine (GLOBAL_EXCLUSIONS), the half activeIndexableJobWhere lacked', () => {
    const clauses = activeJobsInStateWhere('Illinois', 'IL', now).AND as Record<string, unknown>[];
    const active = clauses.find((c) => 'isPublished' in c)!;
    expect(JSON.stringify(active.AND)).toContain('professionClass');
  });

  it('survives being spread with extra keys, the shape the page actually uses', () => {
    const where = { ...activeJobsInStateWhere('Illinois', 'IL', now), city: { not: null } };
    const clauses = where.AND as Record<string, unknown>[];
    expect(clauses.find((c) => 'isPublished' in c)!.AND).toContainEqual(EXPIRY_PAIR);
  });
});

describe('DIR-L2 / DIR-L4: per-city card facts are pure and gated', () => {
  const row = (city: string, employer: string | null, mode: 'remote' | 'hybrid' | 'onsite' = 'onsite') => ({
    city,
    employer,
    isRemote: mode === 'remote',
    isHybrid: mode === 'hybrid',
  });

  it('names employers only at MIN_CITY_EMPLOYERS or more, capped at the card limit', () => {
    const details = selectCityDetails([
      row('Chicago', 'Rush', 'remote'),
      row('Chicago', 'Rush'),
      row('Chicago', 'Advocate'),
      row('Chicago', 'Lurie'),
      row('Chicago', 'Northwestern'),
      row('Peoria', 'OSF'),
      row('Peoria', 'OSF'),
      row('Peoria', 'OSF'),
    ]);
    const chicago = details.get('Chicago')!;
    expect(chicago.employers.map((e) => e.name)).toEqual(['Rush', 'Advocate', 'Lurie']);
    expect(chicago.employers).toHaveLength(CITY_CARD_EMPLOYER_LIMIT);
    expect(chicago.employers[0].count).toBe(2);
    // One employer is a directory entry, not a market: the line is omitted.
    expect(MIN_CITY_EMPLOYERS).toBe(2);
    expect(details.get('Peoria')!.employers).toEqual([]);
  });

  it('splits work mode only at the link floor and never for a blank city', () => {
    const details = selectCityDetails([
      row('Chicago', 'Rush', 'remote'),
      row('Chicago', 'Advocate', 'hybrid'),
      row('Chicago', 'Lurie'),
      row('Aurora', 'A'),
      row('Aurora', 'B'),
      row('  ', 'Ghost'),
      row('Chicago ', 'Trimmed'),
    ]);
    expect(details.get('Chicago')!.workMode).toEqual({ total: 4, remote: 1, hybrid: 1, onsite: 2 });
    expect(details.get('Aurora')!.workMode).toBeNull();
    expect(details.has('')).toBe(false);
    expect(details.has('  ')).toBe(false);
  });

  it('honours a lower floor when asked and drops rows without an employer from the roster only', () => {
    const details = selectCityDetails([row('Waco', null, 'remote'), row('Waco', 'A')], 2);
    expect(details.get('Waco')!.workMode).toEqual({ total: 2, remote: 1, hybrid: 0, onsite: 1 });
    expect(details.get('Waco')!.employers).toEqual([]);
  });
});

describe('DIR-L6: which states have a directory, from one grouped query', () => {
  it('keeps only states that pass the render gate, keyed by stored state name', () => {
    const summaries = summarizeStateDirectories([
      { city: 'Chicago', state: 'Illinois', count: 23 },
      { city: 'Aurora', state: 'Illinois', count: 2 },
      { city: 'Peoria', state: 'Illinois', count: 1 },
      { city: 'Milwaukee', state: 'Wisconsin', count: 4 },
      { city: 'Vancouver', state: 'British Columbia', count: 9 },
      { city: null, state: 'Texas', count: 5 },
      { city: 'Austin', state: null, count: 5 },
    ]);
    expect([...summaries.keys()]).toEqual(['Illinois']);
    expect(summaries.get('Illinois')).toEqual({ name: 'Illinois', slug: 'illinois', linkableCities: 1, trackedCities: 3 });
  });

  it('applies the unlinkable-name veto so a summary never overstates what the page links', () => {
    const summaries = summarizeStateDirectories([
      { city: 'St. Louis', state: 'Missouri', count: 9 },
      { city: 'Kansas City', state: 'Missouri', count: 4 },
      { city: 'Joplin', state: 'Missouri', count: 1 },
    ]);
    expect(summaries.get('Missouri')?.linkableCities).toBe(1);
    expect(summaries.get('Missouri')?.trackedCities).toBe(3);
  });

  it('trims the stored state name before matching STATE_CODES', () => {
    const summaries = summarizeStateDirectories([
      { city: 'Chicago', state: ' Illinois ', count: 23 },
      { city: 'Aurora', state: 'Illinois', count: 2 },
      { city: 'Peoria', state: 'Illinois', count: 1 },
    ]);
    expect(summaries.has('Illinois')).toBe(true);
  });
});

describe('P2 #12: route wiring', () => {
  it('gates the page on the shared predicate and 404s a thin state', () => {
    const src = statePageSrc();
    expect(src).toContain('shouldRenderStateCityDirectory');
    expect(src).toContain('notFound()');
  });

  it('counts with the canonical state predicate, not bare isPublished or the spread helper', () => {
    const src = statePageSrc();
    expect(src).toContain('activeJobsInStateWhere(stateName, stateCode)');
    expect(directorySrc()).toContain('canonicalBucketWhere(stateBucketWhere(stateName, stateCode), now)');
    // The old form spread the helper next to a sibling OR key, which deleted
    // the expiry predicate. Neither the spread nor a hand-rolled state OR may
    // come back into this file.
    const code = stripComments(src);
    expect(code).not.toContain('...activeIndexableJobWhere()');
    expect(code).not.toContain('...activeWhere');
    expect(code).not.toMatch(/OR:\s*\[\{\s*state:/);
    expect(code).not.toMatch(/isPublished/);
    expect(code).not.toContain('PUBLISHED_LISTING_WHERE');
  });

  it('statewide facts come from getListingFacts over the same state bucket', () => {
    const src = statePageSrc();
    expect(src).toContain("getListingFacts(`directory:${stateToSlug(stateName)}`, stateBucketWhere(stateName, stateCode))");
    // The stat row and the orientation sentence read the canonical facts,
    // not a separate raw employer groupBy.
    expect(src).toContain('facts.distinctEmployers');
    expect(stripComments(src)).not.toMatch(/by:\s*\['employer'\]/);
  });

  it('DIR-L3: per-city pay is the gated median or nothing (no _avg, no posted range)', () => {
    const page = statePageSrc();
    const code = stripComments(page);
    // The old `salaryByCity` groupBy averaged both bounds over a 3-posting
    // city and printed "Avg posted range $83K to $83K". Every per-city figure
    // now comes from getGatedCitySalaries (n of 5 from 3 employers) through
    // the shared card line, and the statewide figure through PostedPay.
    expect(page).toContain('getGatedCitySalaries');
    expect(page).toContain('buildCityCardPayLine(');
    expect(page).toContain("variant={{ kind: 'location', scopeName: stateName, scopeNoun: 'state' }}");
    for (const banned of ['_avg', 'salaryByCity', 'Avg posted range', 'normalizedMinSalary', 'formatK(', 'average']) {
      expect(code, `${banned} must not return to the directory page`).not.toContain(banned);
      expect(stripComments(directorySrc()), `${banned} must not appear in directory.ts`).not.toContain(banned);
    }
  });

  it('DIR-defect3: the title counts tracked cities, the same number as the description and the stat tile', () => {
    const src = statePageSrc();
    expect(src).toContain('buildDirectoryTitle({ stateName, trackedCities })');
    expect(src).toContain('buildDirectoryDescription({');
    expect(src).not.toContain('Cities Hiring`');
    expect(stripComments(src)).not.toMatch(/linkable\.length\}\s*Cities/);
  });

  it('robots read shouldIndexStateCityDirectory, the gate app/sitemap.ts reads, with a self canonical', () => {
    const src = statePageSrc();
    expect(src).toContain('shouldIndexStateCityDirectory({ linkableCities: data.directory.linkable.length })');
    expect(src).toContain('robots: { index: indexable, follow: true }');
    expect(read('app/sitemap.ts')).toContain('shouldIndexStateCityDirectory({ linkableCities: directory.linkable.length })');
    expect(MIN_LINKABLE_CITIES_FOR_DIRECTORY_INDEX).toBeGreaterThan(MIN_LINKABLE_CITIES);
  });

  it('DIR-L1, L2, L4, L5, L6, L7 render through the shared builders', () => {
    const src = statePageSrc();
    expect(src).toContain('buildMetroAreaSentence({ metroArea: group.metroArea, cities: group.cities })');
    expect(src).toContain("variant={{ kind: 'statewide', stateName }}");
    expect(src).toContain('buildCityCardHiringLine(detail?.employers ?? [])');
    expect(src).toContain('buildTerseWorkModeLine(detail.workMode, MIN_CITY_JOBS_FOR_LINK)');
    expect(src).toContain('buildDirectoryHowToUse(MIN_CITY_JOBS_FOR_LINK)');
    expect(src).toContain('getNeighboringStates(stateName)');
    expect(src).toContain('getStatesWithCityDirectory()');
    expect(src).toContain('buildNearbyDirectoriesSentence(');
    expect(src).toContain('getMetrosInState(stateName)');
    expect(src).toContain('buildMetroGuideLine({ city: row.metro.city, count: row.count })');
    // L5 replaced the two explanatory sentences; they must not come back.
    expect(src).not.toContain('City pages open with the live listings');
    expect(src).not.toContain('do not have their own page yet');
  });

  it('DIR-defect4: the "leads with" claim ranks over linkable AND emerging, like the FAQ does', () => {
    // The sentence scopes itself to every TRACKED city ("spread across N
    // cities"), so its superlative may not read the linkable slice alone: a
    // city that clears MIN_CITY_JOBS_FOR_LINK but fails cityLinkResolves is
    // demoted to `emerging` carrying its real count. Reading linkable[0] there
    // prints a false leader AND contradicts the DIR-L8 FAQ on the same screen.
    const src = stripComments(statePageSrc());
    expect(src).toContain("{rankedCities[0].name} leads with {formatCount(rankedCities[0].count, 'opening')}");
    expect(src).not.toContain('linkedCities[0]');
    // rankedCities is the exact array the FAQ builder is handed, so the two
    // claims cannot drift apart again.
    expect(src).toContain('const rankedCities: NamedCount[] = [...directory.linkable, ...directory.emerging]');
    expect(src).toContain('buildDirectoryFaqs({ stateName, cities: rankedCities');
  });

  it('DIR-defect4: when the true leader is unlinkable, prose and FAQ still name the same city', () => {
    // St. Louis outranks every linkable city but cannot be linked, so the two
    // claims diverge under the old reading.
    const directory = buildStateCityDirectory(
      [
        { city: 'St. Louis', count: 20 },
        { city: 'Kansas City', count: 11 },
        { city: 'Springfield', count: 4 },
      ],
      { canLink: (row) => cityLinkResolves(row.city, 'MO') },
    );
    expect(directory.linkable[0].city).toBe('Kansas City');
    expect(directory.emerging[0].city).toBe('St. Louis');

    // The page's own expression, reproduced.
    const rankedCities = [...directory.linkable, ...directory.emerging]
      .map((row) => ({ name: row.city, count: row.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    expect(rankedCities[0]).toEqual({ name: 'St. Louis', count: 20 });

    const faqs = buildDirectoryFaqs({
      stateName: 'Missouri',
      cities: rankedCities,
      facts: { total: 35, distinctEmployers: 6, topEmployers: [], recency: null } as never,
      minCityJobs: MIN_CITY_JOBS_FOR_LINK,
    });
    const leaders = faqs.find((f) => /cities have the most/.test(f.question));
    expect(leaders, 'the DIR-L8 leaders FAQ did not render').toBeTruthy();
    expect(leaders!.answer).toContain(rankedCities[0].name);
    expect(leaders!.answer.indexOf('St. Louis')).toBeLessThan(leaders!.answer.indexOf('Kansas City'));
  });

  it('DIR-L6: the nearby tiles link, they do not reprint the count the sentence already gives', () => {
    // buildNearbyDirectoriesSentence already names each neighbour with its
    // city count; a tile repeating the same figure is boilerplate on a page
    // whose whole problem is boilerplate.
    const src = statePageSrc();
    // Anchored on the JSX map, not the earlier one that feeds the sentence.
    const start = src.indexOf('nearbyDirectories.map((entry)');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('</ClayCard>', start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).toContain('{entry.name}');
    expect(block).not.toContain('entry.trackedCities');
  });

  it('DIR-L8: one FAQ array feeds the visible accordion and the FAQPage node, emitted only when it renders', () => {
    const src = statePageSrc();
    expect(src).toContain('const faqs = buildDirectoryFaqs({ stateName, cities: rankedCities, facts, minCityJobs: MIN_CITY_JOBS_FOR_LINK })');
    expect(src).toContain('const faqSchema = faqPageJsonLd(faqs)');
    expect(src).toContain('<CategoryFAQAccordion faqs={faqs} />');
    expect(src).toMatch(/\{faqSchema && <script type="application\/ld\+json" dangerouslySetInnerHTML=\{\{ __html: faqSchema \}\} \/>\}/);
    // Answers are server HTML: the accordion is the shared server component.
    expect(read('components/CategoryFAQAccordion.tsx')).toContain('<p className="faq-answer">{faq.answer}</p>');
  });

  it('carries no unsourced or trend copy and no dashes in its strings', () => {
    // String and template literals plus JSX text: the copy a reader can see.
    // Arithmetic (`b.count - a.count`) is code, not a spaced hyphen in copy.
    const copyOf = (src: string): string[] => [
      ...[...src.matchAll(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g)].map((m) => m[0]),
      ...[...src.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]),
    ];
    for (const rel of ['app/jobs/locations/[state]/page.tsx', 'app/jobs/locations/[state]/directory.ts', 'app/jobs/locations/page.tsx']) {
      const src = read(rel);
      const EN_DASH = String.fromCharCode(0x2013);
      const EM_DASH = String.fromCharCode(0x2014);
      for (const banned of [EN_DASH, EM_DASH, 'added daily', 'updated daily', 'cost of living', 'HPSA', 'console.log', '<style jsx', 'stk-', '@/components/sticker']) {
        expect(src, `${rel} contains "${banned}"`).not.toContain(banned);
      }
      // Comments first: an apostrophe in prose ("the dataset's field") is not a
      // string delimiter.
      for (const text of copyOf(stripComments(src))) {
        expect(text, `${rel} has a spaced hyphen in copy: ${text}`).not.toContain(' - ');
      }
    }
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

  it('never links a sub-threshold city: emerging rows render as list items only', () => {
    const src = statePageSrc();
    // The emerging block must not contain a Link component. It ends where the
    // statewide band (DIR-L1 to L7, which does link) begins.
    const start = src.indexOf('directory.emerging.length > 0');
    const end = src.indexOf('═══ Across the state');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const emergingBlock = src.slice(start, end);
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
    // states and were NOT repaired; they must not be rendered here.
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

  it('uses the canonical predicate for the eligibility aggregate, as the directory page and sitemap do', () => {
    const src = hubSrc();
    expect(src).toContain("import { canonicalBucketWhere } from '@/lib/canonical-counts'");
    expect(src).toContain("where: canonicalBucketWhere({ city: { not: null }, state: { not: null } }),");
    expect(stripComments(src)).not.toContain('activeIndexableJobWhere');
  });

  it('gates the top-city tiles on the same link floor the directories use', () => {
    // A tile links /jobs/city/<slug>, which 404s below MIN_CITY_JOBS_FOR_LINK.
    expect(hubSrc()).toContain('c._count.city >= MIN_CITY_JOBS_FOR_LINK');
  });

  it('renders the top-city tiles and the about card in the clay vocabulary, not off-palette utilities', () => {
    const src = hubSrc();
    expect(src).not.toContain('text-green-500');
    expect(src).not.toContain('bg-pink-700');
    expect(src).not.toContain("var(--text-primary)");
    expect(src).not.toContain("var(--text-secondary)");
    expect(src).toContain('ABOUT_BLOCKS.map(');
    expect(src).toContain('About {brand.niche.short} Job Locations');
  });

  it('reads navigation icons from the one registry (A.4.4)', () => {
    const src = hubSrc();
    expect(src).toContain("from '@/lib/pseo/category-asset-registry'");
    expect(src).not.toContain("'/images/categories/nav/");
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

  it('reads the hero art and its ground from the asset registry, not a path literal', () => {
    // A.4.4: one registry owns every asset path and its sampled ground, so the
    // hero band cannot drift from the corner of the image it sits under.
    const src = hubSrc();
    expect(src).toContain('SHARED_ART.usMapHero.src');
    expect(src).toContain('SHARED_ART.usMapHero.bg');
    expect(src).not.toContain("'/images/categories/heroes/");
  });

  it('claims no coverage figure for the destinations it links', () => {
    // Every other number on this page is a live aggregate. The remote banner
    // used to promise "positions across all 50 states", an inventory claim
    // about /jobs/remote that this page cannot see and no function supplies.
    // Same rule app/not-found.tsx follows for this very destination.
    for (const rel of ['app/jobs/locations/page.tsx', 'app/jobs/locations/[state]/page.tsx']) {
      const src = read(rel);
      expect(src, `${rel} quotes a state-coverage figure`).not.toMatch(/\ball\s+\d+\s+states?\b/i);
      expect(src, `${rel} claims blanket state coverage`).not.toMatch(/\b(every|all)\s+(US\s+)?states?\b/i);
    }
  });

  it('counts only US cities in the hero stat, matching the state grid whitelist', () => {
    // The raw groupBy carries non-US rows ("British Columbia") that the state
    // grid filters out; the headline stat must not fold them back in.
    expect(hubSrc()).toContain('US_STATES.has(r.state)');
  });
});

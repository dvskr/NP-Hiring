/**
 * P1 #13: "Top employers hiring now" on city and category x city pages.
 *
 * Most records in lib/pseo/city-data/cities.ts carry an empty
 * `healthcareSystems` list (and the #9 repair emptied more of them, because
 * they held another state's hospitals), so the city page's Healthcare block was
 * a bare negative on most pages. lib/pseo/city-employers.ts answers it from the
 * job table instead.
 *
 * Thin-content program (package W2-CITYTPL): the standalone groupBy loader
 * `getTopCityEmployers` is retired. Its one consumer, the category x city
 * template, now reads employers from lib/pseo/listing-facts.ts, which wraps
 * the SAME pure selector through `selectEmployers` and reads the canonical
 * predicate, so the page, the city hub and the aggregate-pseo cron count one
 * way. What this file defends is unchanged:
 *   - The list only ever contains employers that appear on live postings.
 *   - Below two distinct employers the selector returns nothing so the
 *     surface omits the block; it is never padded up to look fuller.
 *   - "Hiring now" counts ACTIVE postings only (published, unexpired, apply
 *     link not repeatedly dead), so the claim on the page is true.
 *   - The template renders the block only from what the data returned.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CITY_EMPLOYER_LIMIT,
  MIN_CITY_EMPLOYERS,
  selectCityEmployers,
  type EmployerGroupRow,
} from '@/lib/pseo/city-employers';
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/active-job-filter';
import { canonicalActiveJobWhere } from '@/lib/canonical-counts';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const row = (employer: string | null, employerCount: number): EmployerGroupRow => ({
  employer,
  _count: { employer: employerCount },
});

describe('#13: selectCityEmployers omits rather than pads', () => {
  it('returns nothing when no employer is hiring', () => {
    expect(selectCityEmployers([])).toEqual([]);
  });

  it('returns nothing for a single employer: one name is a directory entry, not a market', () => {
    expect(selectCityEmployers([row('Talkiatry', 9)])).toEqual([]);
    expect(MIN_CITY_EMPLOYERS).toBe(2);
  });

  it('renders as soon as the floor is met', () => {
    const employers = selectCityEmployers([row('Talkiatry', 4), row('Headway', 2)]);
    expect(employers).toEqual([
      { name: 'Talkiatry', openRoles: 4 },
      { name: 'Headway', openRoles: 2 },
    ]);
  });

  it('never invents a count: every entry traces to a groupBy row', () => {
    const employers = selectCityEmployers([row('Alpha Clinic', 3), row('Beta Health System', 1)]);
    expect(employers.map((e) => e.openRoles)).toEqual([3, 1]);
  });

  it('honours an explicit floor of 0 so the facts loader can rank a single employer', () => {
    // lib/pseo/listing-facts.ts calls the selector with min 0 and leaves the
    // "is one employer worth a sentence" decision to the narrative builders.
    expect(selectCityEmployers([row('Only Clinic', 12)], CITY_EMPLOYER_LIMIT, 0)).toEqual([
      { name: 'Only Clinic', openRoles: 12 },
    ]);
  });
});

describe('#13: selectCityEmployers reports real, de-duplicated employers', () => {
  it('merges alias spellings of one employer and sums their postings', () => {
    // "LifeStance" / "LifeStance Health" / "Life Stance" are one company;
    // listing them separately would triple-count a single employer.
    const employers = selectCityEmployers([
      row('LifeStance', 3),
      row('LifeStance Health', 2),
      row('Talkiatry', 4),
    ]);
    expect(employers).toEqual([
      { name: 'LifeStance Health', openRoles: 5 },
      { name: 'Talkiatry', openRoles: 4 },
    ]);
  });

  it('merges alias spellings that normalize DIFFERENTLY but are one known company', () => {
    // The LifeStance case above passes even under a normalize-only merge key,
    // because both spellings happen to normalize to "life-stance". These do
    // not, and KNOWN_COMPANIES lists them as aliases of one company anyway:
    //   "Talkspace"            to "talkspace"
    //   "Talkspace Psychiatry" to "talkspace-psychiatry"
    // Keyed on the normalized form, they render as two rows both labelled
    // "Talkspace", each with a slice of the postings and the same React key.
    expect(selectCityEmployers([row('Talkspace', 3), row('Talkspace Psychiatry', 2), row('Headway', 1)])).toEqual([
      { name: 'Talkspace', openRoles: 5 },
      { name: 'Headway', openRoles: 1 },
    ]);

    //   "VA Health" / "VA Medical" to "va"        "VA Hospital" to "va-hospital"
    expect(selectCityEmployers([row('VA Health', 4), row('VA Hospital', 3), row('Cerebral', 2)])).toEqual([
      { name: 'Department of Veterans Affairs', openRoles: 7 },
      { name: 'Cerebral', openRoles: 2 },
    ]);

    //   "BlueSky Telepsych" to "blue-sky-telepsych"   "blueskytelepsych" to itself
    expect(selectCityEmployers([row('BlueSky Telepsych', 2), row('blueskytelepsych', 5), row('Cerebral', 1)])).toEqual([
      { name: 'BlueSky Telepsych', openRoles: 7 },
      { name: 'Cerebral', openRoles: 1 },
    ]);

    //   "Lyra Health" / "Lyra" to "lyra"          "lyrahealth" to itself
    expect(selectCityEmployers([row('Lyra Health', 3), row('lyrahealth', 1), row('Lyra', 2), row('Cerebral', 1)])).toEqual([
      { name: 'Lyra Health', openRoles: 6 },
      { name: 'Cerebral', openRoles: 1 },
    ]);
  });

  it('never returns the same display name twice: the template keys its <li> on it', () => {
    const employers = selectCityEmployers([
      row('Talkspace', 3),
      row('Talkspace Psychiatry', 2),
      row('Talkspace LLC', 1),
      row('VA Health', 4),
      row('VA Hospital', 3),
      row('LifeStance', 2),
      row('LifeStance Health', 1),
      row('Independent Clinic', 5),
    ]);
    expect(new Set(employers.map((e) => e.name)).size).toBe(employers.length);
  });

  it('keeps genuinely different employers apart even when both are known companies', () => {
    const employers = selectCityEmployers([row('Talkspace', 3), row('Talkiatry', 3)]);
    expect(employers.map((e) => e.name).sort()).toEqual(['Talkiatry', 'Talkspace']);
  });

  it('sorts by open roles, then name, so equal counts render deterministically', () => {
    const employers = selectCityEmployers([row('Zeta Clinic', 2), row('Alpha Clinic', 2), row('Mega Health System', 7)]);
    expect(employers.map((e) => e.name)).toEqual(['Mega Health System', 'Alpha Clinic', 'Zeta Clinic']);
  });

  it('drops blank employers and non-positive counts instead of rendering them', () => {
    const employers = selectCityEmployers([
      row('   ', 5),
      row(null, 5),
      row('Ghost Clinic', 0),
      row('Alpha Clinic', 2),
      row('Beta Clinic', 1),
    ]);
    expect(employers.map((e) => e.name)).toEqual(['Alpha Clinic', 'Beta Clinic']);
  });

  it('caps the list at the display limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => row(`Clinic ${String(i).padStart(2, '0')}`, 20 - i));
    expect(selectCityEmployers(many)).toHaveLength(CITY_EMPLOYER_LIMIT);
  });
});

describe('#13: the employer query only counts jobs a candidate can still apply to', () => {
  it('the module ships the selector alone: no second groupBy loader to drift', () => {
    // Comments stripped: the doc block still describes the groupBy row SHAPE
    // the selector consumes, which is not a second query path.
    const src = stripComments(read('lib/pseo/city-employers.ts'));
    // The standalone loader is retired; one query path, in listing-facts.ts.
    expect(src).not.toContain('getTopCityEmployers');
    expect(src).not.toContain('prisma.job');
    expect(src).not.toContain("from '@/lib/prisma'");
    expect(src).toContain('export function selectCityEmployers');
  });

  it('lib/pseo/listing-facts.ts fetches its rows through the canonical predicate', () => {
    const src = read('lib/pseo/listing-facts.ts');
    expect(src).toContain('selectCityEmployers');
    expect(src).toContain('canonicalBucketWhere(bucket, now)');
    // The rows the employer tally is built from are the rows the count counts.
    expect(src).toMatch(/fetchRows\(scopeKey, where\)/);
  });

  it('the canonical predicate excludes unpublished, expired and dead-link rows', () => {
    // "Hiring now" must not be counting postings nobody can apply to. This is
    // the behaviour the retired loader's own where-clause test defended.
    const where = canonicalActiveJobWhere(new Date('2026-09-21T00:00:00Z')) as {
      isPublished?: boolean;
      healthConsecutiveMissing?: unknown;
      AND?: Array<{ OR?: unknown }>;
    };
    expect(where.isPublished).toBe(true);
    expect(where.healthConsecutiveMissing).toEqual({ lt: DEAD_LINK_MISS_THRESHOLD });
    expect(where.AND?.[0]?.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: new Date('2026-09-21T00:00:00Z') } },
    ]);
  });
});

describe('#13: the city template renders the module honestly', () => {
  const src = () => read('lib/pseo/category-city-template.tsx');

  it('takes its employer limit from the module and its employers from the live facts', () => {
    expect(src()).toContain("from './city-employers'");
    // No second query: the fallback roster is a slice of the city pool facts.
    expect(src()).toContain('cityFacts.topEmployers.slice(0, CITY_EMPLOYER_LIMIT)');
    expect(src()).not.toContain('getTopCityEmployers');
  });

  it('renders the employer list only when the data returned entries', () => {
    expect(src()).toContain('Top Employers Hiring Now');
    expect(src()).toMatch(/topEmployers\.length > 0 \? \(/);
  });

  it('omits the whole card when no pool has two employers hiring', () => {
    // The category roster first, the all-specialty city pool as the fallback,
    // then nothing. No stored healthcare-system chips stand in for live data
    // any more, and the old bare negative is gone: an empty block is better
    // than a sentence telling the reader the page has nothing.
    expect(src()).toMatch(/topEmployers\.length > 0 \? \([\s\S]{0,2400}?\) : null/);
    expect(src()).not.toContain('city!.healthcareSystems');
    expect(src()).not.toContain('No major healthcare systems listed for this area.');
    // The whole Local Insights band goes with it when nothing inside renders.
    expect(src()).toContain('const showInsights = categoryEmployersRender || topEmployers.length > 0 || acrossStateRenders;');
    expect(src()).toContain('{showInsights && (');
  });

  it('labels the counts with the brand niche token rather than a hardcoded role name', () => {
    expect(src()).toContain('open {brand.niche.short} roles in {city!.name}, {city!.stateCode}');
  });
});

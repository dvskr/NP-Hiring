/**
 * P1 #13 — "Top employers hiring now" on city pages.
 *
 * 87.6% of records in lib/pseo/city-data/cities.ts carry an empty
 * `healthcareSystems` list (and the #9 repair emptied more of them, because
 * they held another state's hospitals), so the city page's Healthcare block was
 * a bare negative on most pages. lib/pseo/city-employers.ts answers it from the
 * job table instead.
 *
 * What these tests defend:
 *   • The list only ever contains employers that appear on live postings.
 *   • Below two distinct employers the module returns nothing so the surface
 *     omits the block — it is never padded up to look fuller.
 *   • "Hiring now" counts ACTIVE postings only (published, unexpired, apply
 *     link not repeatedly dead), so the claim on the page is true.
 *   • A database failure degrades to an omitted block, never a broken page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CITY_EMPLOYER_LIMIT,
  MIN_CITY_EMPLOYERS,
  getTopCityEmployers,
  selectCityEmployers,
  type EmployerGroupRow,
} from '@/lib/pseo/city-employers';
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/active-job-filter';
import { prisma } from '@/lib/prisma';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const row = (employer: string | null, employerCount: number): EmployerGroupRow => ({
  employer,
  _count: { employer: employerCount },
});

const groupBy = () => vi.mocked(prisma.job.groupBy);

/** First call's argument object, narrowed to the fields under test. */
const firstGroupByArgs = () =>
  groupBy().mock.calls[0][0] as unknown as {
    by: string[];
    take: number;
    where: Record<string, unknown>;
  };

describe('#13: selectCityEmployers omits rather than pads', () => {
  it('returns nothing when no employer is hiring', () => {
    expect(selectCityEmployers([])).toEqual([]);
  });

  it('returns nothing for a single employer — one name is a directory entry, not a market', () => {
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

  it('never invents a count — every entry traces to a groupBy row', () => {
    const employers = selectCityEmployers([row('Alpha Clinic', 3), row('Beta Health System', 1)]);
    expect(employers.map((e) => e.openRoles)).toEqual([3, 1]);
  });
});

describe('#13: selectCityEmployers reports real, de-duplicated employers', () => {
  it('merges alias spellings of one employer and sums their postings', () => {
    // "LifeStance" / "LifeStance Health" / "Life Stance" are one company —
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
    // not — and KNOWN_COMPANIES lists them as aliases of one company anyway:
    //   "Talkspace"            → "talkspace"
    //   "Talkspace Psychiatry" → "talkspace-psychiatry"
    // Keyed on the normalized form, they render as two rows both labelled
    // "Talkspace", each with a slice of the postings and the same React key.
    expect(selectCityEmployers([row('Talkspace', 3), row('Talkspace Psychiatry', 2), row('Headway', 1)])).toEqual([
      { name: 'Talkspace', openRoles: 5 },
      { name: 'Headway', openRoles: 1 },
    ]);

    //   "VA Health" / "VA Medical" → "va"        "VA Hospital" → "va-hospital"
    expect(selectCityEmployers([row('VA Health', 4), row('VA Hospital', 3), row('Cerebral', 2)])).toEqual([
      { name: 'Department of Veterans Affairs', openRoles: 7 },
      { name: 'Cerebral', openRoles: 2 },
    ]);

    //   "BlueSky Telepsych" → "blue-sky-telepsych"   "blueskytelepsych" → itself
    expect(selectCityEmployers([row('BlueSky Telepsych', 2), row('blueskytelepsych', 5), row('Cerebral', 1)])).toEqual([
      { name: 'BlueSky Telepsych', openRoles: 7 },
      { name: 'Cerebral', openRoles: 1 },
    ]);

    //   "Lyra Health" / "Lyra" → "lyra"          "lyrahealth" → itself
    expect(selectCityEmployers([row('Lyra Health', 3), row('lyrahealth', 1), row('Lyra', 2), row('Cerebral', 1)])).toEqual([
      { name: 'Lyra Health', openRoles: 6 },
      { name: 'Cerebral', openRoles: 1 },
    ]);
  });

  it('never returns the same display name twice — the template keys its <li> on it', () => {
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

describe('#13: getTopCityEmployers only counts jobs a candidate can still apply to', () => {
  beforeEach(() => {
    groupBy().mockReset();
  });

  it('scopes the groupBy to the city, the state, and active postings', async () => {
    groupBy().mockResolvedValue([row('Alpha Clinic', 3), row('Beta Clinic', 2)] as never);
    await getTopCityEmployers('Bangor', 'Maine');

    expect(groupBy()).toHaveBeenCalledTimes(1);
    const args = firstGroupByArgs();
    expect(args.by).toEqual(['employer']);
    expect(args.where.city).toEqual({ equals: 'Bangor', mode: 'insensitive' });
    expect(args.where.state).toEqual({ equals: 'Maine', mode: 'insensitive' });
    // "Hiring now" must not be counting unpublished, expired, or dead-link rows.
    expect(args.where.isPublished).toBe(true);
    expect(args.where.healthConsecutiveMissing).toEqual({ lt: DEAD_LINK_MISS_THRESHOLD });
    expect(args.where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ]);
  });

  it('over-fetches so alias merging cannot silently shorten the list', async () => {
    groupBy().mockResolvedValue([] as never);
    await getTopCityEmployers('Brunswick', 'Maine');
    expect(firstGroupByArgs().take).toBeGreaterThan(CITY_EMPLOYER_LIMIT);
  });

  it('omits the block when the city has a single employer hiring', async () => {
    groupBy().mockResolvedValue([row('Only Clinic', 12)] as never);
    await expect(getTopCityEmployers('Solo City', 'Iowa')).resolves.toEqual([]);
  });

  it('degrades to an omitted block when the query fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    groupBy().mockRejectedValue(new Error('connection reset'));
    await expect(getTopCityEmployers('Broken City', 'Ohio')).resolves.toEqual([]);
    spy.mockRestore();
  });

  it('never queries on an empty city or state', async () => {
    groupBy().mockResolvedValue([] as never);
    await expect(getTopCityEmployers('', 'Ohio')).resolves.toEqual([]);
    await expect(getTopCityEmployers('Columbus', '  ')).resolves.toEqual([]);
    expect(groupBy()).not.toHaveBeenCalled();
  });
});

describe('#13: the city template renders the module honestly', () => {
  const src = () => read('lib/pseo/category-city-template.tsx');

  it('fetches live employers for the city', () => {
    expect(src()).toContain("from './city-employers'");
    expect(src()).toContain('await getTopCityEmployers(city!.name, city!.state)');
  });

  it('renders the employer list only when the module returned entries', () => {
    expect(src()).toContain('Top Employers Hiring Now');
    expect(src()).toMatch(/topEmployers\.length > 0 \? \(/);
  });

  it('omits the whole card when there is neither a live employer nor a stored system', () => {
    expect(src()).toContain('{(topEmployers.length > 0 || city!.healthcareSystems.length > 0) && (');
    // The old bare negative is gone — an empty block is better than a
    // sentence telling the reader the page has nothing.
    expect(src()).not.toContain('No major healthcare systems listed for this area.');
  });

  it('labels the counts with the brand niche token rather than a hardcoded role name', () => {
    expect(src()).toContain('open {brand.niche.short} roles in {city!.name}, {city!.stateCode}');
  });
});

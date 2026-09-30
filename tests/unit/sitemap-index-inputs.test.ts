/**
 * lib/pseo/sitemap-index-inputs.ts: the city page and metro guide gate
 * inputs the primary sitemap reads, counted the way the pages count them
 * (distinct postings, employers, and metro recency).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { shouldIndexLocalListingPage, shouldIndexMetro } from '@/lib/pseo/render-gate';
import { getMetroCity } from '@/lib/metro-data';
import {
  cityIndexKey,
  computeCityIndexInputs,
  loadCityIndexInputs,
  loadMetroIndexInput,
} from '@/lib/pseo/sitemap-index-inputs';

const NOW = new Date('2026-09-28T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const row = (over: Record<string, unknown> = {}) => ({
  employer: 'Alpha Health',
  title: 'Nurse Practitioner',
  city: 'Waco',
  state: 'Texas',
  stateCode: 'TX',
  ...over,
});

describe('computeCityIndexInputs', () => {
  it('keys by state code and lowercase city, counting distinct postings and employers', () => {
    const inputs = computeCityIndexInputs([
      row(),
      row(),
      row({ title: 'Family Nurse Practitioner' }),
      row({ employer: 'Beta Clinic', city: 'WACO' }),
      row({ employer: 'Gamma Care', state: 'TX' }),
      row({ city: 'Austin' }),
    ]);
    expect(inputs.get(cityIndexKey('Waco', 'TX'))).toEqual({ activeJobs: 4, distinctEmployers: 3 });
    expect(inputs.get(cityIndexKey('austin', 'tx'))).toEqual({ activeJobs: 1, distinctEmployers: 1 });
  });

  it('duplicate rows cannot lift a city over the listing floor', () => {
    const inputs = computeCityIndexInputs([row(), row(), row(), row({ employer: 'Beta Clinic' }), row({ employer: 'Gamma Care' })]);
    const waco = inputs.get(cityIndexKey('Waco', 'TX'));
    expect(waco).toEqual({ activeJobs: 3, distinctEmployers: 3 });
    expect(shouldIndexLocalListingPage(waco!)).toBe(false);
  });

  it('skips rows with no city or no known jurisdiction', () => {
    const inputs = computeCityIndexInputs([row({ city: null }), row({ city: '  ' }), row({ state: 'Ontario', stateCode: 'ON' })]);
    expect(inputs.size).toBe(0);
  });

  it('matches the city page bucket exactly: an untrimmed city or state never counts toward the clean page', () => {
    // The Waco page queries city equals "Waco" (case-insensitive, untrimmed)
    // AND state = "Texas" OR stateCode = "TX" (exact). Rows it never lists
    // must not lift its gate: a sitemap that counted them could list a page
    // whose own robots answer noindex.
    const clean = [
      row(),
      row({ employer: 'Beta Clinic' }),
      row({ employer: 'Gamma Care' }),
      row({ employer: 'Delta Medical' }),
    ];
    const invisibleToPage = [
      row({ employer: 'Epsilon Health', city: 'Waco ' }),
      row({ employer: 'Zeta Clinics', state: 'Texas ', stateCode: null }),
      row({ employer: 'Eta Care', state: null, stateCode: 'tx' }),
    ];
    const inputs = computeCityIndexInputs([...clean, ...invisibleToPage]);
    const waco = inputs.get(cityIndexKey('Waco', 'TX'));
    expect(waco).toEqual({ activeJobs: 4, distinctEmployers: 4 });
    expect(shouldIndexLocalListingPage(waco!)).toBe(false);
    // The sitemap looks a dirty twin ("Waco ") up under the clean key, the
    // page its slug resolves to.
    expect(inputs.get(cityIndexKey('Waco ', 'TX'))).toBe(waco);
  });

  it('a stored state code in the state column still reaches its jurisdiction through stateCode', () => {
    const inputs = computeCityIndexInputs([row({ state: 'TX', stateCode: 'TX' }), row({ state: 'Tex.', stateCode: 'TX', employer: 'Beta Clinic' })]);
    expect(inputs.get(cityIndexKey('Waco', 'TX'))).toEqual({ activeJobs: 2, distinctEmployers: 2 });
  });
});

describe('loaders', () => {
  const findMany = prisma.job.findMany as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loadCityIndexInputs reads one canonical pool with the title selected', async () => {
    findMany.mockResolvedValue([row(), row({ employer: 'Beta Clinic' })]);
    const inputs = await loadCityIndexInputs(NOW);
    expect(inputs.get(cityIndexKey('Waco', 'TX'))).toEqual({ activeJobs: 2, distinctEmployers: 2 });
    const args = findMany.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(args.select.title).toBe(true);
  });

  it('loadMetroIndexInput counts distinct postings and the rows posted in the last 30 days', async () => {
    const metro = getMetroCity('dallas-tx');
    expect(metro).toBeTruthy();
    findMany.mockResolvedValue([
      { ...row({ city: 'Dallas' }), originalPostedAt: new Date(NOW.getTime() - 5 * DAY_MS), createdAt: NOW },
      { ...row({ city: 'Dallas', employer: 'Beta Clinic' }), originalPostedAt: new Date(NOW.getTime() - 60 * DAY_MS), createdAt: NOW },
      { ...row({ city: 'Plano' }), originalPostedAt: null, createdAt: new Date(NOW.getTime() - 90 * DAY_MS) },
    ]);
    const input = await loadMetroIndexInput(metro!, NOW);
    expect(input).toEqual({ activeJobs: 3, postedLast30Days: 1 });
    expect(shouldIndexMetro(input)).toBe(true);
  });

  it('a metro whose every role is older than 30 days does not index (CQ-08: Nashville)', async () => {
    const metro = getMetroCity('dallas-tx');
    findMany.mockResolvedValue([0, 1, 2].map((i) => ({
      ...row({ city: 'Dallas', employer: `Employer ${i}` }),
      originalPostedAt: new Date(NOW.getTime() - 45 * DAY_MS),
      createdAt: NOW,
    })));
    const input = await loadMetroIndexInput(metro!, NOW);
    expect(input.postedLast30Days).toBe(0);
    expect(shouldIndexMetro(input)).toBe(false);
  });
});

/**
 * lib/pseo/practice-environment.ts and lib/pseo/neighboring-states.ts
 * (PLAN C.3): the practice read model is dataset-backed, the compact
 * sentence has exactly three branches and always describes the RN license
 * (never the APRN license) as the thing the compact covers, the nearby
 * table is the single copy the two legacy tables already agree with, and
 * a license guide is "live" only when the blog layer publishes its slug.
 */
import { describe, it, expect, vi, type Mock } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { brand } from '@/config/brand';
import { licenseGuideSlug } from '@/config/niche/content-map';
import { getAllPublishedSlugs } from '@/lib/blog';
import { LICENSE_GUIDE_STATES, NLC_ROSTER_VERIFIED_AT } from '@/lib/blog-license-guides';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import * as settingStateConfig from '@/lib/pseo/setting-state-config';
import { NEIGHBORING_STATES, getNeighboringStates } from '@/lib/pseo/neighboring-states';
import {
  AUTHORITY_SHORT,
  AUTHORITY_TITLE,
  NLC_VERIFIED_LABEL,
  buildLicenseGuideDescription,
  buildLicenseGuideTitle,
  getNearbyStates,
  getPracticeEnvironment,
  isLicenseGuideLive,
  nlcMembershipPhrase,
  nlcSentence,
  nlcShort,
  nlcTitleShort,
} from '@/lib/pseo/practice-environment';

vi.mock('@/lib/blog', () => ({ getAllPublishedSlugs: vi.fn() }));

const NP = brand.niche.short;
// Built from code points so this file itself carries neither a dash character nor a spaced hyphen.
const NO_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]| ${String.fromCharCode(0x2d)} `);
const ROOT = process.cwd();

describe('getPracticeEnvironment', () => {
  it('assembles the AANP row, the compact status and the board for a state', () => {
    const env = getPracticeEnvironment('Texas');
    expect(env).toMatchObject({
      stateName: 'Texas',
      stateCode: 'TX',
      stateSlug: 'texas',
      authority: 'restricted',
      authorityLabel: 'Restricted Practice (Physician Supervision Required)',
      authorityDescription: 'Restricted Practice',
      authorityShort: 'restricted practice',
      details: STATE_PRACTICE_AUTHORITY.Texas.details,
      nlcStatus: 'member',
      boardName: 'Texas Board of Nursing',
      nlcVerifiedAt: NLC_ROSTER_VERIFIED_AT,
      licenseGuideSlug: licenseGuideSlug('texas'),
    });
    expect(env?.boardUrl).toMatch(/^https:\/\//);
  });

  it('returns null off the dataset and resolves every one of the 51 jurisdictions', () => {
    expect(getPracticeEnvironment('Atlantis')).toBeNull();
    expect(getPracticeEnvironment('')).toBeNull();
    for (const state of LICENSE_GUIDE_STATES) {
      expect(getPracticeEnvironment(state.name), state.name).not.toBeNull();
    }
  });

  it('authority phrase tables cover the three AANP tiers', () => {
    expect(AUTHORITY_SHORT).toEqual({ full: 'full practice', reduced: 'reduced practice', restricted: 'restricted practice' });
    expect(AUTHORITY_TITLE).toEqual({ full: 'Full Practice', reduced: 'Reduced Practice', restricted: 'Restricted Practice' });
  });
});

describe('nlcSentence has three branches and always talks about the RN license', () => {
  it('member branch', () => {
    expect(nlcSentence('Texas')).toBe(
      'Texas is a Nurse Licensure Compact member. The compact covers the RN license beneath your APRN credential; the APRN license itself is still issued by Texas.',
    );
  });

  it('enacted but not implemented branch', () => {
    expect(nlcSentence('Massachusetts')).toBe(
      'Massachusetts has enacted the Nurse Licensure Compact but has not implemented it, so plan on a Massachusetts RN license by endorsement.',
    );
  });

  it('non-member branch', () => {
    expect(nlcSentence('California')).toBe(
      'California is not a Nurse Licensure Compact member, so out-of-state RNs apply for a California RN license by endorsement.',
    );
  });

  it('is null off the dataset and never says the compact covers the APRN license', () => {
    expect(nlcSentence('Atlantis')).toBeNull();
    for (const state of LICENSE_GUIDE_STATES) {
      const sentence = nlcSentence(state.name);
      expect(sentence, state.name).toMatch(/RN license/);
      expect(sentence, state.name).not.toMatch(/compact covers the APRN/i);
      expect(sentence, state.name).not.toMatch(NO_DASHES);
    }
  });

  it('short forms cover the same three statuses', () => {
    expect(nlcShort('member')).toBe('a Nurse Licensure Compact member');
    expect(nlcShort('pending')).toBe('has enacted but not implemented the Nurse Licensure Compact');
    expect(nlcShort('non-member')).toBe('outside the Nurse Licensure Compact');
    expect(nlcMembershipPhrase('member')).toBe('is a member of');
    expect(nlcMembershipPhrase('pending')).toBe('has enacted but not yet implemented');
    expect(nlcMembershipPhrase('non-member')).toBe('is not a member of');
    expect(nlcTitleShort('member')).toBe('Compact State');
    expect(nlcTitleShort('pending')).toBe('Compact Pending');
    expect(nlcTitleShort('non-member')).toBe('Non-Compact State');
  });

  it('the verified label is an absolute date derived from the roster constant', () => {
    expect(NLC_VERIFIED_LABEL).toBe('August 11, 2026');
    expect(NLC_ROSTER_VERIFIED_AT).toBe('2026-08-11');
  });
});

describe('neighboring states is the single adjacency table', () => {
  it('covers 51 jurisdictions with a closed, non-reflexive graph', () => {
    const names = Object.keys(NEIGHBORING_STATES);
    expect(names).toHaveLength(51);
    for (const name of names) {
      const nearby = NEIGHBORING_STATES[name];
      expect(nearby.length, name).toBeGreaterThan(0);
      expect(nearby, name).not.toContain(name);
      for (const other of nearby) expect(names, `${name} lists ${other}`).toContain(other);
    }
  });

  // The two parity tests below prove equality while the legacy copies still
  // exist and pass silently once W0-COPY and W2-HUB delete them (PLAN C.0:
  // neighboring-states.ts is the single copy; every consumer imports it).
  it('matches the legacy copy in setting-state-config.ts entry for entry, while that copy exists', () => {
    const legacy = (settingStateConfig as unknown as { NEIGHBORING_STATES?: Record<string, readonly string[]> }).NEIGHBORING_STATES;
    if (!legacy) return;
    expect({ ...NEIGHBORING_STATES }).toEqual({ ...legacy });
  });

  it('matches the legacy copy inside the state hub page set for set, while that copy exists (it orders Virginia differently)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'app/jobs/state/[state]/page.tsx'), 'utf8');
    const start = source.indexOf('const NEIGHBORING_STATES');
    if (start === -1) return;
    const block = source.slice(start, source.indexOf('};', start));
    const legacy = new Map<string, string[]>();
    for (const entry of block.matchAll(/'([^']+)':\s*\[([^\]]*)\]/g)) {
      legacy.set(entry[1], [...entry[2].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort());
    }
    expect([...legacy.keys()].sort()).toEqual(Object.keys(NEIGHBORING_STATES).sort());
    for (const [name, nearby] of Object.entries(NEIGHBORING_STATES)) {
      expect([...nearby].sort(), name).toEqual(legacy.get(name));
    }
  });

  it('getNeighboringStates returns table order and [] for unknown names', () => {
    expect(getNeighboringStates('Alaska')).toEqual(['Washington', 'California', 'Oregon']);
    expect(getNeighboringStates('Atlantis')).toEqual([]);
  });

  it('getNearbyStates hydrates each nearby state to its practice environment', () => {
    const nearby = getNearbyStates('Alaska');
    expect(nearby.map((env) => env.stateName)).toEqual(['Washington', 'California', 'Oregon']);
    expect(nearby.every((env) => env.boardName.length > 0)).toBe(true);
    expect(getNearbyStates('Atlantis')).toEqual([]);
  });
});

describe('license guide title and description', () => {
  it('title reads "{State} NP License Guide: {Authority}, {Compact status}"', () => {
    const env = getPracticeEnvironment('Texas')!;
    expect(buildLicenseGuideTitle(env)).toBe(`Texas ${NP} License Guide: Restricted Practice, Compact State`);
  });

  it('description keeps the board clause when it fits and drops it past 160 characters', () => {
    const texas = buildLicenseGuideDescription(getPracticeEnvironment('Texas')!);
    expect(texas).toContain('Texas Board of Nursing');
    expect(texas.length).toBeLessThanOrEqual(160);

    const rhodeIsland = buildLicenseGuideDescription(getPracticeEnvironment('Rhode Island')!);
    expect(rhodeIsland.length).toBeLessThanOrEqual(160);
    expect(rhodeIsland).not.toContain('Nurse Registration');
    expect(rhodeIsland.endsWith('.')).toBe(true);
  });

  it('never emits a dash in either string for any jurisdiction', () => {
    for (const state of LICENSE_GUIDE_STATES) {
      const env = getPracticeEnvironment(state.name)!;
      expect(buildLicenseGuideTitle(env), state.name).not.toMatch(NO_DASHES);
      expect(buildLicenseGuideDescription(env), state.name).not.toMatch(NO_DASHES);
    }
  });
});

describe('isLicenseGuideLive', () => {
  const published = getAllPublishedSlugs as unknown as Mock;

  it('is true only when the blog layer publishes the state slug', async () => {
    published.mockResolvedValue([{ slug: licenseGuideSlug('texas'), updated_at: '2026-09-01T00:00:00.000Z' }]);
    expect(await isLicenseGuideLive('texas')).toBe(true);
    expect(await isLicenseGuideLive('ohio')).toBe(false);
  });

  it('links nothing when the slug lookup fails, and logs with console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    published.mockRejectedValue(new Error('supabase down'));
    expect(await isLicenseGuideLive('texas')).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('published slug lookup failed'), expect.any(Error));
    errorSpy.mockRestore();
  });
});

/**
 * lib/pseo/setting-state-index.ts: the facts the strict category x state
 * gate reads (CQ-01, fixSoon 16), and the gate's verdict over them.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_SIBLING_OVERLAP_FOR_SETTING_STATE_INDEX,
  SETTING_STATE_INDEXING_ENABLED,
  shouldIndexSettingState,
} from '@/lib/pseo/render-gate';
import {
  buildSettingStateIndexFacts,
  countRecentPostings,
  dedupeSiblingSettingStates,
  isFullyRemote,
  settingStateGateJobIds,
  settingStateGateRows,
  siblingOverlap,
  type SettingStateGateRow,
} from '@/lib/pseo/setting-state-index';
import { settingStateSiblingVerdicts, settingStateKey } from '@/app/api/cron/aggregate-pseo/setting-state-siblings';

/** The run's clock: every fixture row is a week old unless it says otherwise. */
const NOW = new Date('2026-09-29T12:00:00Z');
const WEEK_AGO = new Date('2026-09-22T12:00:00Z');
const FORTY_DAYS_AGO = new Date('2026-08-20T12:00:00Z');

const row = (over: Partial<SettingStateGateRow> = {}): SettingStateGateRow => ({
  employer: 'Alpha Health',
  title: 'Nurse Practitioner',
  city: 'Austin',
  state: 'Texas',
  stateCode: 'TX',
  isRemote: false,
  isHybrid: false,
  originalPostedAt: WEEK_AGO,
  createdAt: WEEK_AGO,
  ...over,
});

/** Eight postings from four employers across five role clusters. */
const DIVERSE: SettingStateGateRow[] = [
  row(),
  row({ city: 'Dallas' }),
  row({ title: 'Family Nurse Practitioner' }),
  row({ employer: 'Beta Clinic' }),
  row({ employer: 'Beta Clinic', city: 'Houston' }),
  row({ employer: 'Gamma Care', title: 'Psychiatric Nurse Practitioner' }),
  row({ employer: 'Gamma Care', title: 'Psychiatric Nurse Practitioner', city: 'Waco' }),
  row({ employer: 'Delta Medical', title: 'Urgent Care Nurse Practitioner' }),
];

describe('isFullyRemote and settingStateGateRows', () => {
  it('fully remote means remote and not hybrid', () => {
    expect(isFullyRemote({ isRemote: true, isHybrid: false })).toBe(true);
    expect(isFullyRemote({ isRemote: true, isHybrid: true })).toBe(false);
    expect(isFullyRemote({ isRemote: false, isHybrid: true })).toBe(false);
    expect(isFullyRemote({ isRemote: false, isHybrid: false })).toBe(false);
  });

  it('remote and telehealth count only fully remote rows; every other setting counts every row', () => {
    const rows = [row({ isRemote: true }), row({ isHybrid: true, city: 'Dallas' }), row({ city: 'Waco' })];
    expect(settingStateGateRows('remote', rows)).toHaveLength(1);
    expect(settingStateGateRows('telehealth', rows)).toHaveLength(1);
    expect(settingStateGateRows('outpatient', rows)).toHaveLength(3);
  });
});

describe('buildSettingStateIndexFacts', () => {
  it('counts distinct postings, employers and role clusters, and carries the hub verdict', () => {
    const facts = buildSettingStateIndexFacts({ slug: 'outpatient', rows: DIVERSE, hub: { indexable: true, postings: 30 }, now: NOW });
    expect(facts).toEqual({
      postings: 8,
      employers: 4,
      roleClusters: 5,
      topEmployerPostings: 3,
      hubIndexable: true,
      hubPostings: 30,
      postedLast30Days: 8,
    });
    expect(shouldIndexSettingState(facts)).toBe(true);
  });

  it('exact duplicate rows do not lift a page over the floor', () => {
    const inflated = [row(), row(), row(), row({ employer: 'Beta Clinic' }), row({ employer: 'Beta Clinic' }), row({ employer: 'Gamma Care' })];
    const facts = buildSettingStateIndexFacts({ slug: 'outpatient', rows: inflated, hub: { indexable: true, postings: 40 } });
    expect(facts.postings).toBe(3);
    expect(shouldIndexSettingState(facts)).toBe(false);
  });

  it('Utah: the same three hybrid LifeStance jobs never index as remote, outpatient or anything else', () => {
    const utah = ['Salt Lake City', 'Riverton', 'Pleasant Grove'].map((city) =>
      row({ employer: 'LifeStance Health', title: 'Psychiatric Nurse Practitioner', city, state: 'Utah', stateCode: 'UT', isHybrid: true }));
    const hub = { indexable: false, postings: 3 };
    for (const slug of ['remote', 'outpatient', 'psychiatric-mental-health', 'full-time']) {
      const facts = buildSettingStateIndexFacts({ slug, rows: utah, hub });
      expect(shouldIndexSettingState(facts), slug).toBe(false);
    }
    // Remote counts none of them: all three are hybrid.
    expect(buildSettingStateIndexFacts({ slug: 'remote', rows: utah, hub }).postings).toBe(0);
  });

  it('a remote page is judged on its fully remote rows only', () => {
    const mixed = DIVERSE.map((r, i) => ({ ...r, isRemote: i < 4, isHybrid: i >= 4 }));
    const facts = buildSettingStateIndexFacts({ slug: 'remote', rows: mixed, hub: { indexable: true, postings: 30 } });
    expect(facts.postings).toBe(4);
    expect(facts.employers).toBe(2);
    expect(shouldIndexSettingState(facts)).toBe(false);
  });

  it('a missing parent hub verdict closes the gate', () => {
    const facts = buildSettingStateIndexFacts({ slug: 'outpatient', rows: DIVERSE, hub: undefined });
    expect(facts.hubIndexable).toBe(false);
    expect(facts.hubPostings).toBe(0);
    expect(shouldIndexSettingState(facts)).toBe(false);
  });

  it('a setting holding more than 70 percent of its hub does not index', () => {
    const facts = buildSettingStateIndexFacts({ slug: 'outpatient', rows: DIVERSE, hub: { indexable: true, postings: 10 } });
    expect(shouldIndexSettingState(facts)).toBe(false);
  });
});

describe('the 30 day recency requirement (CQ-01, skeptic 2)', () => {
  it('counts rows first posted in the last 30 days, originalPostedAt first', () => {
    expect(countRecentPostings([
      row(),
      row({ originalPostedAt: FORTY_DAYS_AGO, createdAt: WEEK_AGO }),
      row({ originalPostedAt: null, createdAt: WEEK_AGO }),
      row({ originalPostedAt: null, createdAt: null }),
    ], NOW)).toBe(2);
  });

  it('a diverse page whose every posting is older than 30 days does not index (/jobs/1099/massachusetts)', () => {
    const stale = DIVERSE.map((r) => ({ ...r, originalPostedAt: FORTY_DAYS_AGO, createdAt: FORTY_DAYS_AGO }));
    const facts = buildSettingStateIndexFacts({ slug: 'outpatient', rows: stale, hub: { indexable: true, postings: 30 }, now: NOW });
    expect(facts.postedLast30Days).toBe(0);
    expect(shouldIndexSettingState(facts)).toBe(false);
  });

  it('one recent posting is enough', () => {
    const oneRecent = DIVERSE.map((r, i) => (i === 0 ? r : { ...r, originalPostedAt: FORTY_DAYS_AGO }));
    const facts = buildSettingStateIndexFacts({ slug: 'outpatient', rows: oneRecent, hub: { indexable: true, postings: 30 }, now: NOW });
    expect(facts.postedLast30Days).toBe(1);
    expect(shouldIndexSettingState(facts)).toBe(true);
  });
});

describe('sibling de-duplication (CQ-01)', () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it('siblingOverlap is shared jobs over the smaller set', () => {
    expect(siblingOverlap(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
    expect(siblingOverlap(['a', 'b'], ['a', 'b', 'c', 'd'])).toBe(1);
    expect(siblingOverlap(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'z'])).toBe(0.25);
    expect(siblingOverlap([], ['a'])).toBe(0);
  });

  it('identical sets index once, as the larger page (outpatient/ohio and psychiatric-mental-health/ohio)', () => {
    const same = ids('lifestance-', 10);
    const kept = dedupeSiblingSettingStates([
      { slug: 'outpatient', jobIds: same, postings: 10, passes: true },
      { slug: 'psychiatric-mental-health', jobIds: same, postings: 10, passes: true },
    ]);
    expect([...kept]).toEqual(['outpatient']);
  });

  it('a sibling sharing 70 percent or more of its jobs with a larger one does not index', () => {
    const big = ids('j', 20);
    const kept = dedupeSiblingSettingStates([
      { slug: 'full-time', jobIds: big, postings: 20, passes: true },
      { slug: 'remote', jobIds: [...big.slice(0, 7), ...ids('r', 3)], postings: 10, passes: true },
      { slug: 'inpatient', jobIds: [...big.slice(0, 6), ...ids('i', 4)], postings: 10, passes: true },
    ]);
    expect(kept).toEqual(new Set(['full-time', 'inpatient']));
  });

  it('a sibling that failed the strict gate never shadows a passing one', () => {
    const shared = ids('j', 8);
    const kept = dedupeSiblingSettingStates([
      { slug: 'full-time', jobIds: [...shared, ...ids('x', 10)], postings: 18, passes: false },
      { slug: 'remote', jobIds: shared, postings: 8, passes: true },
    ]);
    expect(kept).toEqual(new Set(['remote']));
  });

  it('settingStateGateJobIds follows the gate rows (fully remote only for remote)', () => {
    const rows = [row({ id: 'a', isRemote: true }), row({ id: 'b', isHybrid: true }), row({ id: 'c' })];
    expect(settingStateGateJobIds('remote', rows)).toEqual(['a']);
    expect(settingStateGateJobIds('outpatient', rows)).toEqual(['a', 'b', 'c']);
  });

  it('the cron verdicts: per state, and every verdict closed when the comparison was incomplete', () => {
    const same = ids('j', 6);
    const drafts = [
      { categorySlug: 'outpatient', locationSlug: 'ohio', indexable: true, gateJobIds: same, gatePostings: 6 },
      { categorySlug: 'psychiatric-mental-health', locationSlug: 'ohio', indexable: true, gateJobIds: same, gatePostings: 6 },
      { categorySlug: 'psychiatric-mental-health', locationSlug: 'texas', indexable: true, gateJobIds: ids('t', 9), gatePostings: 9 },
    ];
    const complete = settingStateSiblingVerdicts(drafts, true);
    expect(complete.get(settingStateKey('outpatient', 'ohio'))).toBe(true);
    expect(complete.get(settingStateKey('psychiatric-mental-health', 'ohio'))).toBe(false);
    expect(complete.get(settingStateKey('psychiatric-mental-health', 'texas'))).toBe(true);
    const partial = settingStateSiblingVerdicts(drafts, false);
    expect([...partial.values()].every((v) => v === false)).toBe(true);
  });
});

describe('CQ-01 wiring: the cron stores sibling-deduplicated verdicts, dormant behind the switch', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'app/api/cron/aggregate-pseo/route.ts'), 'utf8');

  it('the switch stays off, so no stored verdict indexes yet', () => {
    expect(SETTING_STATE_INDEXING_ENABLED).toBe(false);
  });

  it('two siblings sharing 70 percent of their postings are one page; below that both keep their verdict', () => {
    expect(MAX_SIBLING_OVERLAP_FOR_SETTING_STATE_INDEX).toBe(0.7);
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const kept = dedupeSiblingSettingStates([
      { slug: 'outpatient', jobIds: [...seven, 'h', 'i', 'j'], postings: 10, passes: true },
      { slug: 'primary-care', jobIds: [...seven, 'x', 'y', 'z'], postings: 10, passes: true },
    ]);
    // 7 of 10 shared: exactly 70 percent, so only one of the two indexes.
    expect(kept.size).toBe(1);
    const apart = dedupeSiblingSettingStates([
      { slug: 'outpatient', jobIds: [...seven.slice(0, 6), 'h', 'i', 'j', 'k'], postings: 10, passes: true },
      { slug: 'primary-care', jobIds: [...seven.slice(0, 6), 'w', 'x', 'y', 'z'], postings: 10, passes: true },
    ]);
    expect(apart).toEqual(new Set(['outpatient', 'primary-care']));
  });

  it('every setting is computed before any setting x state row is written, with the sibling verdicts applied', () => {
    const finalize = route.indexOf('finalizeSettingStateRows(drafts, settingVerdictsComplete)');
    const write = route.indexOf('await writeStatsRows(settingRows, now)');
    expect(finalize).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(finalize);
    expect(route).toContain('indexable: verdicts.get(settingStateKey(d.categorySlug, d.locationSlug)) ?? false');
  });
});

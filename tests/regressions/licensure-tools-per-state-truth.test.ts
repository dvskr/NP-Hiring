/**
 * Licensure checker and multi-state planner: every per-state answer is built
 * from the state's verified `details` in lib/state-practice-authority.ts,
 * never from its AANP tier.
 *
 * The tier is too coarse to answer "does this state require a physician" or
 * "what must I do before practicing independently here". Both tools used to
 * answer it from the tier, and the answers contradicted the verified details
 * printed beside them:
 *   - components/LicensureChecker.tsx gave a full practice state no agreement
 *     step, although several require collaboration, supervision or a
 *     prescribing protocol during a transition period, and gave every
 *     restricted state "Secure supervising physician agreement", which is wrong
 *     where the state uses a practice agreement or lets a clinician prescribe
 *     some drugs on their own authority.
 *   - components/tools/MultiStatePlanner.tsx printed "no collaborative
 *     agreement or physician supervision required" for full, "a collaborative
 *     agreement with a physician is required" for reduced, and "career-long
 *     physician supervision" for restricted, on every row of that tier.
 * A wrong answer here can push a clinician into an unlawful practice
 * arrangement, so these tests hold the tools to the dataset.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
import {
  STATE_PRACTICE_AUTHORITY,
  getAanpTierDefinition,
  type PracticeAuthority,
  type StatePracticeInfo,
} from '@/lib/state-practice-authority';
import { buildLicensureSteps, tierAttributionNote, type LicensureStep } from '@/components/LicensureChecker';
import MultiStatePlanner, {
  AANP_TIER_LEGEND,
  TIER_VARIATION_NOTE,
  plannerPracticeRequirement,
  type PlannerState,
} from '@/components/tools/MultiStatePlanner';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Source with block and line comments removed: the comments quote the retired copy on purpose. */
const readCode = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const CHECKER = 'components/LicensureChecker.tsx';
const PLANNER = 'components/tools/MultiStatePlanner.tsx';

const ENTRIES: [string, StatePracticeInfo][] = Object.entries(STATE_PRACTICE_AUTHORITY);

const stepsFor = (name: string): LicensureStep[] => buildLicensureSteps(name, STATE_PRACTICE_AUTHORITY[name]);
const allText = (steps: readonly LicensureStep[]): string =>
  steps.map((s) => `${s.text} ${s.detail ?? ''}`).join(' ');

/** Arrangement vocabulary the tools may repeat from a state's details but never add. */
const ARRANGEMENT_TERMS: readonly RegExp[] = [
  /supervis/i, /collaborat/i, /agreement/i, /physician/i, /protocol/i,
  /mentor/i, /transition/i, /delegat/i, /independen/i, /autonomous/i, /oversight/i,
];

/** House style: no em dash, en dash or spaced hyphen. */
const DASH = /[—–]|\s-\s/;

/** The tier-derived strings both tools used to print. */
const RETIRED_TIER_COPY: readonly string[] = [
  'Secure supervising physician agreement',
  'Secure collaborative physician agreement',
  'no collaborative agreement or physician supervision required',
  'a collaborative agreement with a physician is required',
  'career-long physician supervision',
];

describe('licensure checker: the practice step is the state\'s verified details', () => {
  it('covers all 51 jurisdictions', () => {
    expect(ENTRIES).toHaveLength(51);
  });

  it.each(ENTRIES)('%s: the last step quotes its details verbatim', (name, info) => {
    const steps = buildLicensureSteps(name, info);
    const last = steps[steps.length - 1];
    expect(last.text).toBe(`Practice requirements in ${name}`);
    expect(last.detail?.startsWith(info.details)).toBe(true);
  });

  it.each(ENTRIES)('%s: every arrangement term in the steps also appears in its details', (name, info) => {
    const text = allText(buildLicensureSteps(name, info));
    for (const term of ARRANGEMENT_TERMS) {
      if (term.test(text)) expect(info.details, `${name} steps say ${term} but its details do not`).toMatch(term);
    }
  });

  it('does not vary the steps by tier: every state gets the same numbered list shape', () => {
    const shapes = new Set(ENTRIES.map(([name]) => stepsFor(name).map((s) => s.step).join(',')));
    expect([...shapes]).toEqual(['1,2,3,4,5,6,7']);
  });

  it('says so in the step list when a full practice state has a transition requirement', () => {
    // Full practice states whose verified details carry an agreement,
    // supervision, protocol or mentorship requirement before independence.
    for (const name of [
      'Colorado', 'Connecticut', 'Maine', 'Maryland', 'Massachusetts',
      'Minnesota', 'Nevada', 'New York', 'South Dakota', 'Vermont',
    ]) {
      expect(STATE_PRACTICE_AUTHORITY[name].authority).toBe('full');
      expect(allText(stepsFor(name)), name).toMatch(/collaborat|supervis|protocol|mentor/i);
    }
    expect(allText(stepsFor('Connecticut'))).toContain('2,000 hours');
    expect(allText(stepsFor('Nevada'))).toContain('Schedule II');
  });

  it('never puts supervision in front of a restricted state whose details do not require it', () => {
    for (const name of ['Virginia', 'South Carolina', 'Michigan']) {
      expect(STATE_PRACTICE_AUTHORITY[name].authority).toBe('restricted');
      expect(allText(stepsFor(name)), name).not.toMatch(/supervis/i);
    }
    expect(allText(stepsFor('Virginia'))).toContain('practice agreement');
    expect(allText(stepsFor('South Carolina'))).toContain('practice agreement');
    expect(allText(stepsFor('Michigan'))).toContain('on their own authority');
  });

  it('keeps the reduced tier exceptions the old step erased', () => {
    expect(allText(stepsFor('Wisconsin'))).toContain('physician or dentist');
    expect(allText(stepsFor('Alabama'))).toContain('10 percent of scheduled hours');
    expect(allText(stepsFor('Alabama'))).not.toMatch(/not on.?site/i);
  });

  it('adds a board-confirmation sentence without repeating one the details already give', () => {
    expect(stepsFor('Idaho').at(-1)?.detail).toContain('Confirm the current rules with the Idaho board of nursing');
    const maine = stepsFor('Maine').at(-1)?.detail ?? '';
    expect(maine.match(/\bconfirm\b/gi)).toHaveLength(1);
  });

  it('prints a tier note that attributes the tier and asserts no requirement', () => {
    const note = tierAttributionNote(7);
    expect(note).toContain("AANP's state practice environment classification");
    expect(note).toContain('States in the same tier set different rules');
    expect(note).toContain('step 7');
    for (const term of ARRANGEMENT_TERMS) expect(note).not.toMatch(term);
  });

  it.each(ENTRIES)('%s: step and note copy carries no dashes', (name) => {
    expect(allText(stepsFor(name))).not.toMatch(DASH);
    expect(tierAttributionNote(7)).not.toMatch(DASH);
  });
});

describe('multi-state planner: each row prints the state\'s verified details', () => {
  it.each(ENTRIES)('%s: the row line is its details verbatim', (name, info) => {
    expect(plannerPracticeRequirement(name)).toBe(info.details);
  });

  it('omits the line for a name the dataset does not carry instead of guessing', () => {
    expect(plannerPracticeRequirement('Not A State')).toBeNull();
  });

  it('explains the tiers with the shared AANP definition, not a local quote', () => {
    const tiers: PracticeAuthority[] = ['full', 'reduced', 'restricted'];
    expect(AANP_TIER_LEGEND).toEqual(tiers.map((authority) => ({ authority, definition: getAanpTierDefinition(authority) })));
    expect(readCode(PLANNER)).toContain('getAanpTierDefinition(authority)');
    expect(read(PLANNER)).toContain("AANP&apos;s state practice environment tiers");
  });

  it('states that tiers differ, and each half of that note holds in the dataset', () => {
    expect(TIER_VARIATION_NOTE).toContain('States in the same tier still set different rules');
    expect(TIER_VARIATION_NOTE).toContain(`experienced ${brand.niche.short}s`);
    expect(TIER_VARIATION_NOTE).toContain("Each row gives that state's own requirements");
    // Full practice states differ on a transition: some carry one, some do not.
    const fullWithTransition = ENTRIES.filter(
      ([, info]) => info.authority === 'full' && /collaborat|supervis|mentor|transition/i.test(info.details),
    );
    const fullWithoutAnyArrangement = ENTRIES.filter(
      ([, info]) => info.authority === 'full' && !ARRANGEMENT_TERMS.some((term) => term.test(info.details)),
    );
    // Some reduced and restricted states have a route out of the arrangement.
    const nonFullWithRouteOut = ENTRIES.filter(
      ([, info]) => info.authority !== 'full' && /without|independent|autonomous/i.test(info.details),
    );
    expect(fullWithTransition.length).toBeGreaterThan(0);
    expect(fullWithoutAnyArrangement.length).toBeGreaterThan(0);
    expect(nonFullWithRouteOut.length).toBeGreaterThan(0);
  });

  it('keeps the legend copy free of dashes', () => {
    for (const { definition } of AANP_TIER_LEGEND) expect(definition).not.toMatch(DASH);
    expect(TIER_VARIATION_NOTE).not.toMatch(DASH);
  });

  it('renders on the server with every jurisdiction offered', () => {
    const states: PlannerState[] = ENTRIES.map(([name, info]) => ({ name, authority: info.authority, guideSlug: null }));
    const html = renderToStaticMarkup(React.createElement(MultiStatePlanner, { states }));
    expect(html.match(/id="planner-target-/g)).toHaveLength(51);
    expect(html).toContain('Pick the states you are considering');
  });
});

describe('neither tool source carries the retired tier-derived copy', () => {
  it.each(RETIRED_TIER_COPY)('"%s" is gone from both tools', (phrase) => {
    expect(readCode(CHECKER)).not.toContain(phrase);
    expect(readCode(PLANNER)).not.toContain(phrase);
  });

  it('the checker no longer branches its steps on the tier', () => {
    expect(readCode(CHECKER)).not.toMatch(/extraReqs/);
    expect(readCode(CHECKER)).not.toMatch(/authority === '(full|reduced|restricted)'/);
  });

  it('the planner rows no longer carry a per-tier consequence sentence', () => {
    expect(readCode(PLANNER)).not.toMatch(/consequence/);
    expect(readCode(PLANNER)).toContain('plannerPracticeRequirement(s.name)');
  });
});

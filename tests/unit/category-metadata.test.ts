/**
 * lib/pseo/category-metadata.ts (thin-spec 1, section 6.2; thin-spec 2,
 * K9): label grammar, the SERP title budget, count-in-title only at the
 * display floor, clause-by-clause description assembly that never ends
 * mid-word, and the landing robots helper.
 */
import { describe, it, expect } from 'vitest';
import { brand } from '@/config/brand';
import { COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { MIN_JOBS_FOR_INDEX } from '@/lib/pseo/render-gate';
import {
  DESCRIPTION_MAX,
  SERP_TITLE_MAX,
  TITLE_PAGE_PART_MAX,
  TITLE_SUFFIX_LENGTH,
  assembleDescription,
  buildCategoryLandingDescription,
  buildCategoryLandingTitle,
  categoryLandingRobots,
  labelNoun,
  labelSentence,
  shouldIndexCategoryLanding,
} from '@/lib/pseo/category-metadata';

const NP = brand.niche.short;
// Built from code points so this file itself carries neither a dash character nor a spaced hyphen.
const NO_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]| ${String.fromCharCode(0x2d)} `);

describe('budgets', () => {
  it('the page part of a title leaves room for the layout brand suffix', () => {
    expect(TITLE_SUFFIX_LENGTH).toBe(` | ${brand.name}`.length);
    expect(TITLE_PAGE_PART_MAX).toBe(SERP_TITLE_MAX - TITLE_SUFFIX_LENGTH);
    expect(DESCRIPTION_MAX).toBe(155);
  });
});

describe('labelNoun and labelSentence', () => {
  it('APRN labels already name the role and never gain the credential suffix', () => {
    expect(labelNoun('anesthesia', 'Nurse Anesthetist')).toBe('Nurse Anesthetist');
    expect(labelNoun('midwifery', 'Nurse Midwife')).toBe('Nurse Midwife');
    expect(labelNoun('clinical-nurse-specialist', 'Clinical Nurse Specialist')).toBe('Clinical Nurse Specialist');
  });

  it('every other label gains the credential', () => {
    expect(labelNoun('remote', 'Remote')).toBe(`Remote ${NP}`);
    expect(labelNoun('family-practice', 'Family Practice')).toBe(`Family Practice ${NP}`);
  });

  it('lowercases mid-sentence unless the label carries an acronym, digit or plus', () => {
    expect(labelSentence('Full-Time')).toBe('full-time');
    expect(labelSentence('Family Practice')).toBe('family practice');
    expect(labelSentence('LGBTQ+')).toBe('LGBTQ+');
    expect(labelSentence('VA')).toBe('VA');
    expect(labelSentence('1099')).toBe('1099');
  });
});

describe('assembleDescription', () => {
  it('adds clauses in order while the total stays within the budget', () => {
    const out = assembleDescription(['One two.', 'Three four.', 'Five six.'], 22);
    expect(out).toBe('One two. Three four.');
  });

  it('skips falsy clauses so callers can pass conditionals inline', () => {
    expect(assembleDescription(['A.', null, undefined, false, 'B.'])).toBe('A. B.');
  });

  it('cuts a first clause that alone overflows on a word boundary', () => {
    const out = assembleDescription(['alpha beta gamma delta epsilon'], 12);
    expect(out).toBe('alpha beta');
    expect(out.length).toBeLessThanOrEqual(12);
  });

  it('returns an empty string when nothing is given', () => {
    expect(assembleDescription([])).toBe('');
  });
});

describe('buildCategoryLandingTitle', () => {
  it('prints the count only at the display floor', () => {
    expect(buildCategoryLandingTitle({ role: `Remote ${NP}`, totalJobs: COUNT_DISPLAY_FLOOR - 1 })).toBe(`Remote ${NP} Jobs`);
    expect(buildCategoryLandingTitle({ role: `Remote ${NP}`, totalJobs: COUNT_DISPLAY_FLOOR })).toBe(`Remote ${NP} Jobs: ${COUNT_DISPLAY_FLOOR} Openings`);
    expect(buildCategoryLandingTitle({ role: `Remote ${NP}`, totalJobs: 1 })).not.toMatch(/\b1\b/);
    expect(buildCategoryLandingTitle({ role: `Remote ${NP}`, totalJobs: 0 })).not.toMatch(/\b0\b/);
  });

  it('drops the count rather than overflow the SERP budget', () => {
    const role = 'Adult-Gerontology Primary Care Nurse Practitioner (AGPCNP)';
    const title = buildCategoryLandingTitle({ role, totalJobs: 40 });
    expect(title).toBe(`${role} Jobs`);
  });

  it('keeps a claim-free tagline when it fits and drops it when it does not', () => {
    expect(buildCategoryLandingTitle({ role: `VA ${NP}`, totalJobs: 40, tagline: 'Serve Those Who Served' }))
      .toBe(`VA ${NP} Jobs: Serve Those Who Served`);
    const long = 'A tagline far too long to fit inside the page part of any title';
    expect(buildCategoryLandingTitle({ role: `VA ${NP}`, totalJobs: 40, tagline: long })).toBe(`VA ${NP} Jobs`);
  });
});

describe('buildCategoryLandingDescription', () => {
  const role = `Remote ${NP}`;

  it('uses the overview form at zero inventory', () => {
    const out = buildCategoryLandingDescription({ role, totalJobs: 0, employerCount: 0, stateCount: 0, medianK: null });
    expect(out).toBe(`${role} jobs: role overview, certification requirements and job alerts for new openings.`);
  });

  it('pluralizes correctly at one', () => {
    const out = buildCategoryLandingDescription({ role, totalJobs: 1, employerCount: 1, stateCount: 1, medianK: null });
    expect(out.startsWith(`1 ${role} opening from 1 employer across 1 state.`)).toBe(true);
  });

  it('adds the gated median only when present and never prints a zero figure', () => {
    const gated = buildCategoryLandingDescription({ role, totalJobs: 12, employerCount: 4, stateCount: 6, medianK: 130 });
    expect(gated).toContain('Median posted pay $130K.');
    const below = buildCategoryLandingDescription({ role, totalJobs: 12, employerCount: 4, stateCount: 6, medianK: null });
    expect(below).not.toMatch(/Median/);
    const zero = buildCategoryLandingDescription({ role, totalJobs: 12, employerCount: 4, stateCount: 6, medianK: 0 });
    expect(zero).not.toMatch(/\$0/);
  });

  it('stays within the budget and ends on a whole clause', () => {
    const longRole = 'Adult-Gerontology Primary Care Nurse Practitioner (AGPCNP)';
    const out = buildCategoryLandingDescription({ role: longRole, totalJobs: 12, employerCount: 4, stateCount: 6, medianK: 130 });
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(out.endsWith('.')).toBe(true);
    expect(out).not.toMatch(NO_DASHES);
  });
});

describe('landing index rule and robots', () => {
  it('indexes page 1 at the listing floor and nothing below or beyond', () => {
    expect(shouldIndexCategoryLanding(MIN_JOBS_FOR_INDEX - 1)).toBe(false);
    expect(shouldIndexCategoryLanding(MIN_JOBS_FOR_INDEX)).toBe(true);
    expect(shouldIndexCategoryLanding(MIN_JOBS_FOR_INDEX, 2)).toBe(false);
  });

  it('noindex pages stay follow', () => {
    expect(categoryLandingRobots(0)).toEqual({ index: false, follow: true });
    expect(categoryLandingRobots(MIN_JOBS_FOR_INDEX)).toEqual({ index: true, follow: true });
    expect(categoryLandingRobots(MIN_JOBS_FOR_INDEX, 3)).toEqual({ index: false, follow: true });
  });
});

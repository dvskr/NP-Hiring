/**
 * P0 #11 + #12 — /jobs Specialty filter taxonomy wiring + donor-niche
 * matcher purge (content-gap synthesis 2026-07-28, filters-taxonomy pkg).
 *
 *   #11 The /jobs Specialty filter offered only the two legacy work-type
 *       checkboxes (Telehealth, Travel/Locum). It must expose all 14
 *       clinical specialties from the taxonomy registry
 *       (lib/pseo/taxonomy-registry.ts CATEGORY_AXES.specialty), and the
 *       category pill labels must be registry-derived so removed donor
 *       slugs can't linger in components/jobs/LinkedInFilters.tsx.
 *
 *   #12 lib/filters.ts still carried donor-board category keys
 *       (behavioral-health, substance-abuse, child-adolescent, crisis,
 *       addiction) and senior/lead matchers hardcoded to a single
 *       credential abbreviation. Matchers must derive from the niche
 *       vocabulary so every NP/APRN credential matches (FNP, AGACNP,
 *       CRNA, …), keeping the same matcher shape.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildWhereClause,
  categoryFilterLabel,
  CATEGORY_FILTERS,
  SPECIALTY_FILTER_OPTIONS,
} from '@/lib/filters';
import { DEFAULT_FILTERS } from '@/types/filters';
import { ALL_CATEGORY_SLUGS, CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';

const ROOT = path.resolve(__dirname, '../..');
const SPECIALTY_SLUGS: readonly string[] = CATEGORY_AXES.specialty;

const REMOVED_DONOR_KEYS = [
  'behavioral-health',
  'substance-abuse',
  'child-adolescent',
  'crisis',
  'addiction',
] as const;

function whereJson(overrides: Partial<typeof DEFAULT_FILTERS>): string {
  return JSON.stringify(buildWhereClause({ ...DEFAULT_FILTERS, ...overrides }));
}

/** Extract every `title.contains` needle from a CATEGORY_FILTERS entry. */
function titleNeedles(slug: string): string[] {
  return (CATEGORY_FILTERS[slug] ?? [])
    .map((clause) => (clause as { title?: { contains?: unknown } }).title?.contains)
    .filter((needle): needle is string => typeof needle === 'string');
}

function slugMatchesTitle(slug: string, jobTitle: string): boolean {
  const haystack = jobTitle.toLowerCase();
  return titleNeedles(slug).some((needle) => haystack.includes(needle.toLowerCase()));
}

describe('P0 #11 — specialty filter options derive from the taxonomy registry', () => {
  it('exposes every clinical specialty slug, in axis order', () => {
    expect(SPECIALTY_FILTER_OPTIONS.map((opt) => opt.value)).toEqual([...SPECIALTY_SLUGS]);
  });

  it('is the full 14-specialty axis (not the old 2-checkbox set)', () => {
    expect(SPECIALTY_FILTER_OPTIONS.length).toBe(SPECIALTY_SLUGS.length);
    expect(SPECIALTY_FILTER_OPTIONS.length).toBeGreaterThanOrEqual(14);
  });

  it('labels every option in display form (never the raw slug)', () => {
    for (const opt of SPECIALTY_FILTER_OPTIONS) {
      expect(opt.label.trim().length).toBeGreaterThan(0);
      expect(opt.label).not.toBe(opt.value);
    }
  });

  it('applies display-form overrides where title case is wrong', () => {
    expect(categoryFilterLabel('women-health')).toBe("Women's Health");
    expect(categoryFilterLabel('lgbtq')).toBe('LGBTQ+');
    expect(categoryFilterLabel('family-practice')).toBe('Family Practice');
    expect(categoryFilterLabel('1099')).toBe('1099');
  });
});

describe('P0 #11 — buildWhereClause wires specialty slugs through categoryTags', () => {
  it('every specialty option value produces a real, slug-specific condition', () => {
    const base = whereJson({});
    for (const slug of SPECIALTY_SLUGS) {
      const json = whereJson({ specialty: [slug] });
      expect(json).not.toBe(base);
      expect(json).toContain(`"categoryTags":{"has":"${slug}"}`);
    }
  });

  it('keeps the legacy Telehealth / Travel URL contract (keyword matchers)', () => {
    const telehealth = whereJson({ specialty: ['Telehealth'] });
    expect(telehealth).toContain('telehealth');
    expect(telehealth).toContain('telemedicine');

    const travel = whereJson({ specialty: ['Travel'] });
    expect(travel).toContain('travel');
    expect(travel).toContain('locum');
  });

  it('ORs work-type and clinical-specialty selections inside one section', () => {
    const json = whereJson({ specialty: ['Telehealth', SPECIALTY_SLUGS[0]] });
    expect(json).toContain('telemedicine');
    expect(json).toContain(`"categoryTags":{"has":"${SPECIALTY_SLUGS[0]}"}`);
  });

  it('?category= falls back to categoryTags for registry slugs without keyword entries', () => {
    expect(whereJson({ category: 'dermatology' })).toContain(
      '"categoryTags":{"has":"dermatology"}',
    );
    expect(whereJson({ category: 'anesthesia' })).toContain(
      '"categoryTags":{"has":"anesthesia"}',
    );
    // 'remote' has a deliberately empty keyword entry — it must use the tag
    // fallback rather than a match-nothing `OR: []`.
    const remote = whereJson({ category: 'remote' });
    expect(remote).toContain('"categoryTags":{"has":"remote"}');
    expect(remote).not.toContain('"OR":[]');
  });

  it('ignores unknown / retired category slugs instead of matching everything oddly', () => {
    expect(whereJson({ category: 'behavioral-health' })).toBe(whereJson({}));
  });
});

describe('P0 #12 — donor-niche matcher purge in lib/filters.ts', () => {
  it('CATEGORY_FILTERS carries none of the removed donor category keys', () => {
    for (const donorKey of REMOVED_DONOR_KEYS) {
      expect(CATEGORY_FILTERS[donorKey], donorKey).toBeUndefined();
    }
  });

  it('every remaining CATEGORY_FILTERS key is a taxonomy-registry slug', () => {
    for (const key of Object.keys(CATEGORY_FILTERS)) {
      expect(ALL_CATEGORY_SLUGS, `unexpected non-registry key '${key}'`).toContain(key);
    }
  });

  it('senior matcher covers seniority titles across NP/APRN credentials', () => {
    const seniorTitles = [
      'Senior Nurse Practitioner - Oncology',
      'Senior FNP',
      'Senior AGACNP - Hospitalist Team',
      'Senior WHNP',
      'Lead CRNA',
      'Lead PMHNP - Outpatient', // psych stays in scope as one specialty of many
      'Senior APRN, Cardiology',
    ];
    for (const title of seniorTitles) {
      expect(slugMatchesTitle('senior', title), title).toBe(true);
    }
  });

  it('mid-career matcher covers senior/lead titles across credentials', () => {
    const midCareerTitles = [
      'Experienced Nurse Practitioner',
      'Lead CNM - Birth Center',
      'Senior NP - Dermatology Clinic',
    ];
    for (const title of midCareerTitles) {
      expect(slugMatchesTitle('mid-career', title), title).toBe(true);
    }
  });

  it('senior matcher is not seniority-blind (plain staff titles do not match)', () => {
    const staffTitles = [
      'Nurse Practitioner - Dermatology',
      'Family Nurse Practitioner (FNP) - Primary Care',
      'CRNA - Ambulatory Surgery Center',
    ];
    for (const title of staffTitles) {
      expect(slugMatchesTitle('senior', title), title).toBe(false);
    }
  });

  it('senior matcher keeps its structured 5+ years clause (matcher shape preserved)', () => {
    const structured = (CATEGORY_FILTERS['senior'] ?? []).find(
      (clause) =>
        JSON.stringify(clause) === JSON.stringify({ minYearsExperience: { gte: 5 } }),
    );
    expect(structured).toBeDefined();
  });
});

describe('P0 #11 — LinkedInFilters wiring (static source checks)', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'components/jobs/LinkedInFilters.tsx'),
    'utf-8',
  );

  it('renders the registry-driven specialty options', () => {
    expect(src).toContain('SPECIALTY_FILTER_OPTIONS');
    expect(src).toContain("toggleArrayFilter('specialty', option.value)");
  });

  it('derives category pill labels from the registry (donor slugs purged)', () => {
    expect(src).toContain('ALL_CATEGORY_SLUGS');
    expect(src).toContain('categoryFilterLabel');
    for (const donorKey of REMOVED_DONOR_KEYS) {
      expect(src, `donor slug '${donorKey}' still referenced`).not.toContain(donorKey);
    }
  });

  it('keeps the legacy work-type checkboxes on the same specialty URL param', () => {
    expect(src).toContain("toggleArrayFilter('specialty', 'Telehealth')");
    expect(src).toContain("toggleArrayFilter('specialty', 'Travel')");
  });
});

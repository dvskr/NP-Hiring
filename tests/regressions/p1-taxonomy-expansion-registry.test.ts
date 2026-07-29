/**
 * P1 #14 + #15 — taxonomy expansion (content-gap synthesis 2026-07-28,
 * taxonomy-expansion pkg).
 *
 *   #15 Three new high-volume NP verticals: aesthetics, pain-management,
 *       palliative-hospice. Each needs a registry entry, a physical
 *       app/jobs/<slug>/ landing + city route (sibling pattern), a
 *       classifier rule set, and a distinct city-narrative lead (B39).
 *
 *   #14 Seven high-demand categories promoted to the [state] tier:
 *       primary-care, urgent-care, oncology, cardiology, hospitalist,
 *       dermatology, home-health. Each needs the registry eligibility
 *       entry, a physical [state] folder, AND a SETTING_CONFIGS entry —
 *       the setting-state template notFound()s for keys without a config,
 *       which would silently 404 all 51 state pages of a category.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CATEGORY_AXES,
  ALL_CATEGORY_SLUGS,
  STATE_ELIGIBLE_CATEGORY_SLUGS,
  CITY_ELIGIBLE_CATEGORY_SLUGS,
} from '@/lib/pseo/taxonomy-registry';
import { JOBS_TOP_SEGMENTS } from '@/lib/pseo/jobs-segments-edge';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { ALL_CATEGORY_CONFIGS } from '@/lib/pseo/category-city-template';
import { buildCityFacts, getTaxonomyLead } from '@/lib/pseo/city-narrative';
import { CITIES } from '@/lib/pseo/city-data/cities';
import {
  shouldRenderCategoryCity,
  MIN_JOBS_FOR_CATEGORY_CITY,
} from '@/lib/pseo/render-gate';

const ROOT = path.resolve(__dirname, '../..');
const JOBS_DIR = path.join(ROOT, 'app', 'jobs');

const NEW_VERTICALS = ['aesthetics', 'pain-management', 'palliative-hospice'] as const;
const NEW_STATE_TIER = [
  'primary-care', 'urgent-care', 'oncology', 'cardiology',
  'hospitalist', 'dermatology', 'home-health',
] as const;

describe('P1 #15 — new vertical slugs are first-class registry citizens', () => {
  it('lives on the specialty axis and in every derived set', () => {
    for (const slug of NEW_VERTICALS) {
      expect(CATEGORY_AXES.specialty, slug).toContain(slug);
      expect(ALL_CATEGORY_SLUGS, slug).toContain(slug);
      expect(CITY_ELIGIBLE_CATEGORY_SLUGS, slug).toContain(slug);
      expect(JOBS_TOP_SEGMENTS.has(slug), `${slug} missing from JOBS_TOP_SEGMENTS`).toBe(true);
    }
  });

  it('has the sibling folder pattern: landing page + city/[slug] route', () => {
    for (const slug of NEW_VERTICALS) {
      expect(
        fs.existsSync(path.join(JOBS_DIR, slug, 'page.tsx')),
        `${slug} landing page missing`,
      ).toBe(true);
      expect(
        fs.existsSync(path.join(JOBS_DIR, slug, 'city', '[slug]', 'page.tsx')),
        `${slug} city route missing`,
      ).toBe(true);
    }
  });

  it('is NOT state-eligible (no [state] folder, no eligibility entry)', () => {
    for (const slug of NEW_VERTICALS) {
      expect(STATE_ELIGIBLE_CATEGORY_SLUGS, slug).not.toContain(slug);
      expect(
        fs.existsSync(path.join(JOBS_DIR, slug, '[state]')),
        `${slug} unexpectedly has an [state] folder`,
      ).toBe(false);
    }
  });

  it('has a city-template config so /jobs/<slug>/city/* renders instead of 404ing everywhere', () => {
    for (const slug of NEW_VERTICALS) {
      expect(ALL_CATEGORY_CONFIGS[slug], `${slug} missing from ALL_CATEGORY_CONFIGS`).toBeDefined();
      expect(ALL_CATEGORY_CONFIGS[slug].slug).toBe(slug);
    }
  });

  it('has a distinct city-narrative taxonomy lead (B39 thin-content guard)', () => {
    const facts = buildCityFacts(CITIES[0]);
    const leads = NEW_VERTICALS.map((slug) => getTaxonomyLead(slug, facts));
    for (const [i, lead] of leads.entries()) {
      expect(lead, `${NEW_VERTICALS[i]} lead missing`).toBeTruthy();
    }
    expect(new Set(leads).size).toBe(NEW_VERTICALS.length);
  });

  it('landing metadata noindexes zero-inventory categories (thin-shell gate, static check)', () => {
    // The shared landing template gates empty categories with
    // robots.index=false — new slugs ride the same template, so a
    // zero-inventory vertical never ships as an indexable thin shell.
    const src = fs.readFileSync(
      path.join(ROOT, 'lib', 'pseo', 'category-landing-template.tsx'),
      'utf-8',
    );
    expect(src).toContain('page > 1 || totalJobs === 0');
    expect(src).toContain('robots: { index: false, follow: true }');
  });

  it('the category×city surface hard-404s below the thin-content floor', () => {
    // Each new vertical multiplies out to ~4,135 city URLs — by far its
    // largest surface, and the one that would ship as doorway content if
    // the gate were bypassed. noindex is not enough there (see
    // render-gate.ts), so the template must notFound(). Behavioral check
    // on the pure gate + a wiring check on the template that consumes it.
    expect(shouldRenderCategoryCity(0)).toBe(false);
    expect(shouldRenderCategoryCity(MIN_JOBS_FOR_CATEGORY_CITY - 1)).toBe(false);
    expect(shouldRenderCategoryCity(MIN_JOBS_FOR_CATEGORY_CITY)).toBe(true);

    const src = fs.readFileSync(
      path.join(ROOT, 'lib', 'pseo', 'category-city-template.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/if \(!shouldRenderCategoryCity\([^)]*\)\) \{/);
  });
});

describe('P1 #14 — [state] tier extension', () => {
  it('the seven promoted categories are state-eligible', () => {
    for (const slug of NEW_STATE_TIER) {
      expect(STATE_ELIGIBLE_CATEGORY_SLUGS, slug).toContain(slug);
    }
  });

  it('each state-eligible category has a physical [state]/page.tsx', () => {
    for (const slug of STATE_ELIGIBLE_CATEGORY_SLUGS) {
      expect(
        fs.existsSync(path.join(JOBS_DIR, slug, '[state]', 'page.tsx')),
        `${slug} missing app/jobs/${slug}/[state]/page.tsx`,
      ).toBe(true);
    }
  });

  it('each state-eligible category has a SETTING_CONFIGS entry (404-everywhere guard)', () => {
    // SettingStatePage notFound()s when SETTING_CONFIGS[key] is missing —
    // a registry/folder pair without a config silently 404s all 51 state
    // pages of that category. This is the invariant that makes the drift
    // test's folder parity meaningful.
    for (const slug of STATE_ELIGIBLE_CATEGORY_SLUGS) {
      expect(SETTING_CONFIGS[slug], `${slug} missing from SETTING_CONFIGS`).toBeDefined();
      expect(SETTING_CONFIGS[slug].slug).toBe(slug);
    }
  });

  it('state/city salary bands agree between the two template config maps', () => {
    // The [state] template (SETTING_CONFIGS) and the city template
    // (ALL_CATEGORY_CONFIGS) both surface salaryRange in metadata titles —
    // the same slug must never advertise two different bands.
    for (const slug of NEW_STATE_TIER) {
      expect(ALL_CATEGORY_CONFIGS[slug], `${slug} missing city config`).toBeDefined();
      expect(SETTING_CONFIGS[slug].salaryRange).toBe(ALL_CATEGORY_CONFIGS[slug].salaryRange);
    }
  });

  it('eligibility sets still nest: state-eligible ⊂ city-eligible = all', () => {
    const all = new Set(ALL_CATEGORY_SLUGS);
    for (const slug of STATE_ELIGIBLE_CATEGORY_SLUGS) {
      expect(all.has(slug), `state-eligible slug ${slug} must be a category`).toBe(true);
    }
    expect(STATE_ELIGIBLE_CATEGORY_SLUGS.length).toBeLessThan(ALL_CATEGORY_SLUGS.length);
    expect([...CITY_ELIGIBLE_CATEGORY_SLUGS].sort()).toEqual([...ALL_CATEGORY_SLUGS].sort());
  });

  it('every city-eligible slug has a city-template config', () => {
    for (const slug of CITY_ELIGIBLE_CATEGORY_SLUGS) {
      expect(ALL_CATEGORY_CONFIGS[slug], `${slug} missing from ALL_CATEGORY_CONFIGS`).toBeDefined();
    }
  });
});

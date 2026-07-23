/**
 * pSEO integrity sweep regression pins (backlog B36-B43, 2026-07 medium/low
 * wave). Mix of behavioral checks and static source reads — each asserts a
 * shipped fix is still present so a future edit can't silently undo it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_CATEGORY_SLUGS,
  STATE_ELIGIBLE_CATEGORY_SLUGS,
} from '@/lib/pseo/taxonomy-registry';
import { buildCityFacts, getTaxonomyLead } from '@/lib/pseo/city-narrative';
import { buildSettingStateNarrative } from '@/lib/pseo/state-narrative';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { CITIES } from '@/lib/pseo/city-data/cities';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B39: narrative uniqueness covers the full taxonomy surface', () => {
  it('every city-eligible category slug has a taxonomy-specific lead', () => {
    const facts = buildCityFacts(CITIES[0]);
    const missing = ALL_CATEGORY_SLUGS.filter((slug) => getTaxonomyLead(slug, facts) === null);
    // If this fails: a slug was added to taxonomy-registry.ts without a
    // matching TAXONOMY_LEADS entry in lib/pseo/city-narrative.ts — its
    // category×city pages fall back to the bare city narrative and read
    // near-identical to /jobs/city/{slug} (thin-content risk).
    expect(missing).toEqual([]);
  });

  it('taxonomy leads are pairwise distinct for a fixed city', () => {
    const facts = buildCityFacts(CITIES[0]);
    const leads = ALL_CATEGORY_SLUGS.map((slug) => getTaxonomyLead(slug, facts));
    expect(new Set(leads).size).toBe(ALL_CATEGORY_SLUGS.length);
  });

  it('every setting-state page type has a setting-specific lead', () => {
    // buildSettingStateNarrative degrades to the shared authority/COL + demand
    // sentences when a key has no lead — compare against that no-lead baseline.
    const args = ['California', 'CA', 140, 3, 25] as const;
    const baseline = buildSettingStateNarrative('__no_such_setting__', ...args);
    const missing = Object.keys(SETTING_CONFIGS).filter(
      (key) => buildSettingStateNarrative(key, ...args) === baseline,
    );
    expect(missing).toEqual([]);
  });
});

describe('B36: category×city pages never emit 410 state URLs', () => {
  const src = () => read('lib/pseo/category-city-template.tsx');
  it('breadcrumb + empty-state links branch on state eligibility', () => {
    expect(src()).toContain("import { STATE_ELIGIBLE_CATEGORY_SLUGS } from './taxonomy-registry'");
    // Two call sites: BreadcrumbSchema state crumb and the 0-jobs CTA link.
    const uses = src().match(/STATE_ELIGIBLE_SET\.has\(config\.slug\)/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    // The fallback targets the real state hub.
    expect(src()).toContain('/jobs/state/${stateToSlug(city!.state)}');
  });
  it('state hub route exists for the fallback URLs', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/jobs/state/[state]/page.tsx'))).toBe(true);
  });
});

describe('B37: cities sitemap advertises the CITY-eligible category set', () => {
  const src = () => read('app/api/sitemaps/cities/[batch]/route.ts');
  it('uses CITY_ELIGIBLE_CATEGORY_SLUGS (42), not the 21-slug state-eligible subset', () => {
    expect(src()).toContain('CITY_ELIGIBLE_CATEGORY_SLUGS');
    expect(src()).not.toContain('STATE_ELIGIBLE_CATEGORY_SLUGS');
  });
});

describe('B38: stale pseoStats cannot render frozen counts or false freshness', () => {
  const src = () => read('lib/pseo/category-city-template.tsx');
  it('cached rows are staleness-gated before use', () => {
    expect(src()).toContain('STATS_STALENESS_HOURS');
    expect(src()).toMatch(/updatedAt\.getTime\(\) <= STATS_STALENESS_MS/);
  });
  it('hero badge derives freshness from statsAsOf instead of hardcoding "updated today"', () => {
    expect(src()).toMatch(/badgeText=\{formatStatsBadge\(/);
    expect(src()).not.toMatch(/badgeText=\{`\$\{stats\.totalJobs\} live roles/);
  });
});

describe('B41: dead lib/pseo/aggregator.ts stays deleted', () => {
  it('file is absent (the aggregate-pseo cron owns aggregation)', () => {
    expect(fs.existsSync(path.join(ROOT, 'lib/pseo/aggregator.ts'))).toBe(false);
  });
  it('no production import references it', () => {
    for (const rel of ['app/api/cron/aggregate-pseo/route.ts']) {
      expect(read(rel)).not.toContain("pseo/aggregator");
    }
  });
});

describe('B42: P9 runbook matches the real cron contract', () => {
  const src = () => read('docs/runbooks/p9-category-tags-rollout.md');
  it('does not POST to the GET-only aggregate-pseo route', () => {
    expect(src()).not.toContain('curl -X POST');
  });
  it('documents the real 6h cadence, not 12h', () => {
    expect(src()).toContain('6h cadence');
    expect(src()).not.toMatch(/12h \(the normal cron cadence\)/);
  });
});

describe('B43: taxonomy-registry header reflects the completed migration', () => {
  const src = () => read('lib/pseo/taxonomy-registry.ts');
  it('no longer claims the folder migration is pending or that the drift test fails by design', () => {
    expect(src()).not.toContain('PENDING');
    expect(src()).not.toContain('FAILS by design');
  });
  it('state-eligible remains a strict subset of the full slug set', () => {
    const all = new Set(ALL_CATEGORY_SLUGS);
    for (const slug of STATE_ELIGIBLE_CATEGORY_SLUGS) {
      expect(all.has(slug), `state-eligible slug ${slug} must be a category`).toBe(true);
    }
    expect(STATE_ELIGIBLE_CATEGORY_SLUGS.length).toBeLessThan(ALL_CATEGORY_SLUGS.length);
  });
});

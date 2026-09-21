/**
 * pSEO integrity sweep regression pins (backlog B36-B43, 2026-07 medium/low
 * wave), plus the state hub parity pins of the thin-content program. Mix of
 * behavioral checks and static source reads: each asserts a shipped fix is
 * still present so a future edit cannot silently undo it.
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
import { MIN_CITY_JOBS_FOR_LINK } from '@/app/jobs/locations/[state]/directory';
import {
  MIN_JOBS_FOR_CATEGORY_CITY,
  MIN_JOBS_FOR_LINK_LIST_ROW,
  MIN_JOBS_FOR_STATE_HUB_INDEX,
} from '@/lib/pseo/render-gate';

const ROOT = process.cwd();
// Normalized to LF because several assertions below pin MULTI-LINE literals
// (an import tail, a guard body). A Windows checkout stores these sources with
// CRLF, so without this the result depended on the reader's git autocrlf
// setting rather than on the code: green in one worktree and red in a fresh
// clone of the same commit.
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

describe('B39: narrative uniqueness covers the full taxonomy surface', () => {
  it('every city-eligible category slug has a taxonomy-specific lead', () => {
    const facts = buildCityFacts(CITIES[0]);
    const missing = ALL_CATEGORY_SLUGS.filter((slug) => getTaxonomyLead(slug, facts) === null);
    // If this fails: a slug was added to taxonomy-registry.ts without a
    // matching TAXONOMY_LEADS entry in lib/pseo/city-narrative.ts, so its
    // category x city pages fall back to the bare city narrative and read
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
    // sentences when a key has no lead; compare against that no-lead baseline.
    const args = ['California', 'CA', 140, 3, 25] as const;
    const baseline = buildSettingStateNarrative('__no_such_setting__', ...args);
    const missing = Object.keys(SETTING_CONFIGS).filter(
      (key) => buildSettingStateNarrative(key, ...args) === baseline,
    );
    expect(missing).toEqual([]);
  });
});

describe('B36: category x city pages never emit 410 state URLs', () => {
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
    // \bPENDING\b: forbid the standalone status word (the old "PENDING:"
    // header claim) while allowing citations of docs/PENDING_WORK.md; the
    // underscore is a word character, so the boundary never matches there
    // (P6 docs-deferral requires that citation; see
    // tests/regressions/p6-docs-deferral-verticals-record.test.ts).
    expect(src()).not.toMatch(/\bPENDING\b/);
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

/**
 * HUB (thin-content program, PLAN C.2 and C.4): the state hub, the sitemap
 * and the render gates agree. Robots and the sitemap must read one
 * predicate, and every link the hub emits must target a page whose own
 * render gate passes, so the floors are pinned equal here rather than
 * re-typed on the page.
 */
describe('HUB: the state hub, the sitemap and the render gates agree', () => {
  const PAGE = 'app/jobs/state/[state]/page.tsx';
  const SITEMAP = 'app/sitemap.ts';

  it('robots and the sitemap call shouldIndexStateHub over the canonical count', () => {
    const page = read(PAGE);
    const sitemap = read(SITEMAP);
    expect(page).toContain("shouldIndexStateHub,\n} from '@/lib/pseo/render-gate'");
    expect(page).toContain('shouldIndexStateHub({ activeJobs: facts.total, liveDataSections, page })');
    expect(sitemap).toContain('shouldIndexStateHub({ activeJobs, liveDataSections })');
    // The page keeps rendering below the gate; only the index flag changes.
    expect(page).toContain('if (facts.total === 0) {\n    notFound();');
    expect(page).not.toMatch(/totalJobs\s*<\s*\d/);
  });

  it('the live-section recipe is the same seven-line list in both files, S7 from the publishable set', () => {
    const recipe = (source: string): string[] => {
      const start = source.indexOf('buildHubEmployersSentence({ stateName, facts');
      const end = source.indexOf('// S7', start);
      expect(start, 'S1 line missing').toBeGreaterThan(-1);
      expect(end, 'S7 line missing').toBeGreaterThan(start);
      return source.slice(start, end).split('\n').map((line) => line.trim().replace(/\s+/g, ' ')).filter(Boolean);
    };
    const page = recipe(read(PAGE));
    const sitemap = recipe(read(SITEMAP));
    // Same builders, same facts fields, same order: only the facts variable
    // differs (the page holds ListingFacts, the sitemap a tally).
    const normalize = (lines: string[]) => lines.map((line) => line.replace(/\b(tally|facts)\./g, 'F.').replace(/facts: employerFacts/, 'facts'));
    expect(normalize(page)).toEqual(normalize(sitemap));
    expect(page.some((line) => line.includes('S6'))).toBe(true);
    for (const rel of [PAGE, SITEMAP]) {
      expect(read(rel)).toContain("import { getPublishableSalaryGuideStates } from '@/lib/salary-analytics'");
    }
  });

  it('every hub link floor equals the target page render gate', () => {
    // City tiles (HUB-S2) link the city page, which 404s below MIN_JOBS_FOR_CATEGORY_CITY.
    expect(MIN_CITY_JOBS_FOR_LINK).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
    // Category pills (HUB-S3) link a category x state page only where it is not noindex for count.
    expect(MIN_JOBS_FOR_LINK_LIST_ROW).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
    // The hub index floor is the same inventory floor.
    expect(MIN_JOBS_FOR_STATE_HUB_INDEX).toBe(MIN_JOBS_FOR_CATEGORY_CITY);
    const page = read(PAGE);
    expect(page).toContain('linkable: count >= MIN_JOBS_FOR_LINK_LIST_ROW');
    expect(page).toContain('city.count >= MIN_CITY_JOBS_FOR_LINK && cityLinkResolves(name, stateCode)');
    // Nearby hubs (HUB-S9) link only at 1 or more jobs, the hub's own render gate.
    expect(page).toContain('link: { href: `/jobs/state/${env.stateSlug}`, renders: count >= 1 }');
  });

  it('the hub links its city directory only through the directory page own render decision', () => {
    const page = read(PAGE);
    // HUB-S2 and the HUB-S9 nearby directories read the shared eligibility
    // map (W2-LOCATIONS), which IS the directory page's own gate, instead of
    // rebuilding the rule from facts.cities. A local rebuild would drift the
    // moment the directory page changed its floors.
    expect(page).toMatch(
      /import\s*\{[^}]*\bgetStatesWithCityDirectory\b[^}]*\}\s*from\s*'@\/app\/jobs\/locations\/\[state\]\/directory'/,
    );
    expect(page).toContain('renders: cityDirectories.has(stateName)');
    expect(page).toContain('href: `/jobs/locations/${stateSlug}`');
    expect(page).toContain('cityDirectories.get(row.env.stateName)');
    expect(page).toContain('href={`/jobs/locations/${summary.slug}`}');
    expect(page).not.toContain('shouldRenderStateCityDirectory');
    expect(page).not.toContain('buildStateCityDirectory');
  });
});

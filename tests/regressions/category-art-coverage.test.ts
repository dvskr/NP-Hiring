/**
 * Pins the category art port (2026-09) and its navigation layer.
 *
 * The bespoke category landings, every /jobs/city page and /jobs/locations
 * built image URLs from brand.assets.storageBase, a retired bucket that
 * answers 400, so 46 production pages rendered empty image panels. The art
 * now ships from public/images/categories/** (scripts/port-category-art.mjs).
 *
 * Pins:
 *  1. No page or pSEO module builds a remote storage-bucket image URL again.
 *  2. Every local category image a source file or the registry names exists,
 *     including every NAV_ICONS tile and every SHARED_ART file.
 *  3. Every ported file is used (no unreferenced bytes), has a neutral
 *     kebab-case name, and stays within its size cap.
 *  4. Psych-only art stays on the psychiatric-mental-health category.
 *  5. The port script never lists a denied source (PMHNP text, psych-only
 *     scenes, unsourced figures, stale dates, stated credentials, baked
 *     sign or banner text).
 *  6. One destination, one navigation icon across the landings.
 *  7. Every taxonomy slug resolves through categoryNavArt to a clay tile or
 *     a lucide glyph, never a blank tile; tiles and glyphs partition the
 *     taxonomy.
 *  8. Every Art.bg is a 6-digit hex taken from the sampled ground table,
 *     which covers heroes, bento, icons and nav.
 *  9. getCategoryAssets falls back to DEFAULT_CATEGORY_ASSETS, whose files
 *     exist and whose hero is DEFAULT_HERO_IMAGE.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { icons as lucideIcons } from 'lucide-react';
import {
  CATEGORY_ASSET_REGISTRY,
  CATEGORY_GLYPHS,
  DEFAULT_CATEGORY_ASSETS,
  DEFAULT_HERO_IMAGE,
  NAV_ICONS,
  PSYCH_ONLY_ART,
  SHARED_ART,
  categoryNavArt,
  getCategoryAssets,
  type Art,
} from '../../lib/pseo/category-asset-registry';
import { ALL_CATEGORY_SLUGS } from '../../lib/pseo/taxonomy-registry';
import { ART_GROUND } from '../../lib/pseo/category-art-ground';

const ROOT = path.resolve(__dirname, '../..');
const ART_DIR = path.join(ROOT, 'public/images/categories');
const HEX6 = /^#[0-9a-f]{6}$/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const existsInPublic = (p: string) => fs.existsSync(path.join(ROOT, 'public', p));
const SOURCE_FILES = ['app', 'lib', 'components']
  .flatMap((d) => walk(path.join(ROOT, d)))
  .filter((f) => /\.(ts|tsx)$/.test(f))
  // The generated ground-color table names every file; it is data, not a usage.
  .filter((f) => !rel(f).endsWith('lib/pseo/category-art-ground.ts'));
const PSEO_SURFACES = SOURCE_FILES.filter((f) => /^(app\/jobs\/|lib\/pseo\/|app\/job-alerts\/|app\/privacy\/)/.test(rel(f)));
const LOCAL_ART_RE = /\/images\/(?:categories|pages)\/[a-z0-9/-]+\.webp/g;

const isArt = (v: Art | string): v is Art => typeof v !== 'string';
const artSrc = (v: Art | string): string => (isArt(v) ? v.src : v);
/** Every Art the navigation layer exports, keyed for error messages. */
const NAV_LAYER_ART: Array<[string, Art]> = [
  ...Object.entries(NAV_ICONS).map(([k, a]): [string, Art] => [`NAV_ICONS.${k}`, a]),
  ...Object.entries(SHARED_ART).flatMap(([k, v]): Array<[string, Art]> => (isArt(v) ? [[`SHARED_ART.${k}`, v]] : [])),
];
const NAV_LAYER_PATHS = [...Object.values(NAV_ICONS).map((a) => a.src), ...Object.values(SHARED_ART).map(artSrc)];
const ALL_ASSET_ROWS = { 'DEFAULT_CATEGORY_ASSETS': DEFAULT_CATEGORY_ASSETS, ...CATEGORY_ASSET_REGISTRY };

function registryPaths(): string[] {
  return [
    DEFAULT_HERO_IMAGE,
    ...PSYCH_ONLY_ART,
    ...NAV_LAYER_PATHS,
    ...Object.values(ALL_ASSET_ROWS).flatMap((a) => [a.heroImage, ...a.bentoImages, ...a.bentoIcons]),
  ];
}

function sourcePaths(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of SOURCE_FILES) {
    for (const m of fs.readFileSync(file, 'utf8').match(LOCAL_ART_RE) ?? []) {
      found.set(m, [...(found.get(m) ?? []), rel(file)]);
    }
  }
  return found;
}

describe('category art port', () => {
  it('pSEO pages and modules build no remote storage-bucket image URL', () => {
    const offenders = PSEO_SURFACES.filter((f) => /storage\/v1\/object|STORAGE_BASE/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('every local category or page image named in source or the registry exists', () => {
    const named = [...sourcePaths().keys(), ...registryPaths().filter((p) => p.startsWith('/images/categories/'))];
    const missing = named.filter((p) => !existsInPublic(p));
    expect(missing).toEqual([]);
  });

  it('every ported file is referenced, neutrally named and within its size cap', async () => {
    const referenced = new Set([...sourcePaths().keys(), ...registryPaths()]);
    const caps: Record<string, number> = { heroes: 1024, bento: 768, icons: 256, nav: 256 };
    const problems: string[] = [];
    for (const file of walk(ART_DIR)) {
      const publicPath = '/' + path.relative(path.join(ROOT, 'public'), file).split(path.sep).join('/');
      const [, , , group, name] = publicPath.split('/');
      if (!/^[a-z0-9-]+\.webp$/.test(name ?? '')) problems.push(`${publicPath}: name is not kebab-case webp`);
      if (/pmhnp|psychiatr|psych|mental|behavioral|addiction|substance|crisis/i.test(publicPath)) {
        problems.push(`${publicPath}: niche word in file name`);
      }
      if (!(group in caps)) problems.push(`${publicPath}: unknown art group`);
      if (!referenced.has(publicPath)) problems.push(`${publicPath}: not referenced by any page or the registry`);
      const { width = 0, height = 0 } = await sharp(file).metadata();
      if (Math.max(width, height) > (caps[group] ?? 0)) problems.push(`${publicPath}: ${width}x${height} exceeds ${caps[group]}`);
    }
    expect(problems).toEqual([]);
  });

  it('psych-only art appears only on the psychiatric-mental-health category', () => {
    const leaks: string[] = [];
    for (const [slug, assets] of Object.entries(ALL_ASSET_ROWS)) {
      if (slug === 'psychiatric-mental-health') continue;
      for (const p of [assets.heroImage, ...assets.bentoImages]) {
        if (PSYCH_ONLY_ART.has(p)) leaks.push(`${slug}: ${p}`);
      }
    }
    for (const p of NAV_LAYER_PATHS) {
      if (PSYCH_ONLY_ART.has(p)) leaks.push(`navigation layer: ${p}`);
    }
    for (const [p, files] of sourcePaths()) {
      if (PSYCH_ONLY_ART.has(p)) leaks.push(`${p} in ${files.join(', ')}`);
    }
    expect(leaks).toEqual([]);
  });

  it('the port script lists no denied source and writes unique outputs', async () => {
    const script = await import('../../scripts/port-category-art.mjs');
    const manifest = [...script.MANIFEST, ...script.PAGE_MANIFEST] as Array<{ from: string; to: string }>;
    expect(manifest.filter((e) => e.from in script.DENIED).map((e) => e.from)).toEqual([]);
    const outputs = script.MANIFEST.map((e: { to: string }) => e.to);
    expect(new Set(outputs).size).toBe(outputs.length);
    for (const denied of [
      'categories/hero_v2_1099.webp',
      'categories/hero_wc_senior.webp',
      'categories/bento_newgrad_mentorship.webp',
      'categories/bento_ct_salary.webp',
      // Found by the 2026-09-23 full-size review for the twelve sage-hero slugs:
      // a stated credential ladder, a printed paycheck figure, a banner.
      'categories/bento_bh_growth.webp',
      'categories/bento_sa_salary.webp',
      'about/diorama_new_grad.webp',
    ]) {
      expect(script.DENIED).toHaveProperty([denied]);
    }
  });

  it('every picture that can be letterboxed or used as a tile face has a sampled ground color', () => {
    const missing: string[] = [];
    for (const group of ['heroes', 'bento', 'icons', 'nav']) {
      for (const file of walk(path.join(ART_DIR, group))) {
        const publicPath = '/' + path.relative(path.join(ROOT, 'public'), file).split(path.sep).join('/');
        if (!HEX6.test(ART_GROUND[publicPath] ?? '')) missing.push(publicPath);
      }
    }
    // The state hub and metro cards letterbox the sage bento set.
    for (const p of ['/images/job-seekers/bento-guides.webp', '/images/job-seekers/bento-salary.webp', '/images/employers/bento-analytics.webp']) {
      if (!ART_GROUND[p]) missing.push(p);
    }
    expect(missing, 'run node scripts/sample-art-ground.mjs').toEqual([]);
    const stale = Object.keys(ART_GROUND).filter((p) => !existsInPublic(p));
    expect(stale).toEqual([]);
  });

  it('niche text in ported heroes is retouched', async () => {
    const script = await import('../../scripts/port-category-art.mjs');
    expect(Object.keys(script.RETOUCH).sort()).toEqual(['heroes/full-time.webp', 'heroes/new-grad.webp', 'heroes/per-diem.webp']);
  });

  it('each link destination uses one navigation icon everywhere', () => {
    const iconsByHref = new Map<string, Set<string>>();
    const cardRe = /href: '(\/jobs\/[a-z0-9-]+)'[^}]*?icon: '(\/images\/categories\/[a-z0-9/-]+\.webp)'/g;
    for (const file of PSEO_SURFACES) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(cardRe)) {
        iconsByHref.set(m[1], new Set([...(iconsByHref.get(m[1]) ?? []), m[2]]));
      }
    }
    expect(iconsByHref.size).toBeGreaterThan(5);
    const conflicts = [...iconsByHref].filter(([, icons]) => icons.size > 1).map(([href, icons]) => `${href}: ${[...icons].join(', ')}`);
    expect(conflicts).toEqual([]);
    // A.4.4: the icon a page shows for a destination is that destination's NAV_ICONS tile.
    const navKey = (href: string) => (href === '/jobs/locations' ? 'location' : href.slice('/jobs/'.length));
    const offTile = [...iconsByHref].flatMap(([href, icons]) => {
      const tile = NAV_ICONS[navKey(href)];
      return tile && !icons.has(tile.src) ? [`${href}: ${[...icons].join(', ')} is not ${tile.src}`] : [];
    });
    expect(offTile).toEqual([]);
  });
});

describe('category navigation layer', () => {
  it('every NAV_ICONS tile and SHARED_ART file exists on disk', () => {
    const missing = NAV_LAYER_PATHS.filter((p) => !existsInPublic(p));
    expect(missing).toEqual([]);
    // Every tile shipped under nav/ is a destination in NAV_ICONS (no orphan tiles).
    const tiles = new Set(Object.values(NAV_ICONS).map((a) => a.src));
    const orphans = walk(path.join(ART_DIR, 'nav'))
      .map((f) => '/' + path.relative(path.join(ROOT, 'public'), f).split(path.sep).join('/'))
      .filter((p) => !tiles.has(p));
    expect(orphans).toEqual([]);
  });

  it('every taxonomy slug resolves to a clay tile or a lucide glyph, never blank', () => {
    const problems: string[] = [];
    for (const slug of ALL_CATEGORY_SLUGS) {
      const art = categoryNavArt(slug);
      if ('icon' in art) {
        if (!existsInPublic(art.icon.src)) problems.push(`${slug}: tile ${art.icon.src} is missing`);
      } else if (!(art.glyph in lucideIcons)) {
        problems.push(`${slug}: ${art.glyph} is not a lucide-react icon`);
      }
    }
    expect(problems).toEqual([]);
    // Tiles and glyphs partition the taxonomy: no slug has both, none has neither.
    const glyphOnlySlugs = ALL_CATEGORY_SLUGS.filter((slug) => !NAV_ICONS[slug]).sort();
    expect(Object.keys(CATEGORY_GLYPHS).sort()).toEqual(glyphOnlySlugs);
    // The only non-taxonomy destinations are the salary guides and the location hubs.
    const extraKeys = Object.keys(NAV_ICONS).filter((k) => !ALL_CATEGORY_SLUGS.includes(k)).sort();
    expect(extraKeys).toEqual(['location', 'salary']);
    // A slug outside the taxonomy still gets a real glyph.
    const unknown = categoryNavArt('not-a-category');
    expect('glyph' in unknown && unknown.glyph in lucideIcons).toBe(true);
  });

  it('aliased destinations share one tile', () => {
    expect(NAV_ICONS['entry-level']).toBe(NAV_ICONS['new-grad']);
    expect(NAV_ICONS['emergency']).toBe(NAV_ICONS['urgent-care']);
    expect(NAV_ICONS['urgent-care'].src).toBe('/images/categories/nav/urgent-call.webp');
    expect(NAV_ICONS['psychiatric-mental-health'].src).toBe('/images/categories/nav/care-hands.webp');
  });

  it('every Art.bg is a 6-digit hex taken from the sampled ground table', () => {
    const problems = NAV_LAYER_ART.flatMap(([key, { src, bg }]) => {
      if (!HEX6.test(bg)) return [`${key}: bg ${bg} is not a 6-digit hex`];
      if (ART_GROUND[src] !== bg) return [`${key}: bg ${bg} is not the sampled ground ${ART_GROUND[src] ?? '(unsampled)'}`];
      return [];
    });
    expect(problems).toEqual([]);
    const badRows = Object.entries(ALL_ASSET_ROWS).filter(([, a]) => !HEX6.test(a.bgColor)).map(([slug, a]) => `${slug}: ${a.bgColor}`);
    expect(badRows).toEqual([]);
  });

  it('getCategoryAssets returns the registry row or the shared default', () => {
    expect(getCategoryAssets('remote')).toBe(CATEGORY_ASSET_REGISTRY['remote']);
    expect(getCategoryAssets('not-a-category')).toBe(DEFAULT_CATEGORY_ASSETS);
    expect(DEFAULT_CATEGORY_ASSETS.heroImage).toBe(DEFAULT_HERO_IMAGE);
    expect(DEFAULT_CATEGORY_ASSETS.heroImage).toBe(SHARED_ART.usMapHero.src);
    expect(DEFAULT_CATEGORY_ASSETS.bgColor).toBe(SHARED_ART.usMapHero.bg);
    // The templates render bentoImages[0] and [1] unconditionally.
    expect(DEFAULT_CATEGORY_ASSETS.bentoImages[0]).toBeTruthy();
    expect(DEFAULT_CATEGORY_ASSETS.bentoImages[1]).toBeTruthy();
    const missing = [DEFAULT_CATEGORY_ASSETS.heroImage, ...DEFAULT_CATEGORY_ASSETS.bentoImages].filter((p) => !existsInPublic(p));
    expect(missing).toEqual([]);
  });
});

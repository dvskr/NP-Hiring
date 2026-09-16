/**
 * Pins the category art port (2026-09).
 *
 * The bespoke category landings, every /jobs/city page and /jobs/locations
 * built image URLs from brand.assets.storageBase, a retired bucket that
 * answers 400, so 46 production pages rendered empty image panels. The art
 * now ships from public/images/categories/** (scripts/port-category-art.mjs).
 *
 * Pins:
 *  1. No page or pSEO module builds a remote storage-bucket image URL again.
 *  2. Every local category image a source file or the registry names exists.
 *  3. Every ported file is used (no unreferenced bytes), has a neutral
 *     kebab-case name, and stays within its size cap.
 *  4. Psych-only art stays on the psychiatric-mental-health category.
 *  5. The port script never lists a denied source (PMHNP text, psych-only
 *     scenes, unsourced figures, stale dates).
 *  6. One destination, one navigation icon across the landings.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import {
  CATEGORY_ASSET_REGISTRY,
  DEFAULT_HERO_IMAGE,
  PSYCH_ONLY_ART,
} from '../../lib/pseo/category-asset-registry';

const ROOT = path.resolve(__dirname, '../..');
const ART_DIR = path.join(ROOT, 'public/images/categories');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const SOURCE_FILES = ['app', 'lib', 'components']
  .flatMap((d) => walk(path.join(ROOT, d)))
  .filter((f) => /\.(ts|tsx)$/.test(f))
  // The generated ground-color table names every file; it is data, not a usage.
  .filter((f) => !rel(f).endsWith('lib/pseo/category-art-ground.ts'));
const PSEO_SURFACES = SOURCE_FILES.filter((f) => /^(app\/jobs\/|lib\/pseo\/|app\/job-alerts\/|app\/privacy\/)/.test(rel(f)));
const LOCAL_ART_RE = /\/images\/(?:categories|pages)\/[a-z0-9/-]+\.webp/g;

function registryPaths(): string[] {
  return [
    DEFAULT_HERO_IMAGE,
    ...PSYCH_ONLY_ART,
    ...Object.values(CATEGORY_ASSET_REGISTRY).flatMap((a) => [a.heroImage, ...a.bentoImages, ...a.bentoIcons]),
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
    const missing = named.filter((p) => !fs.existsSync(path.join(ROOT, 'public', p)));
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
    for (const [slug, assets] of Object.entries(CATEGORY_ASSET_REGISTRY)) {
      if (slug === 'psychiatric-mental-health') continue;
      for (const p of [assets.heroImage, ...assets.bentoImages]) {
        if (PSYCH_ONLY_ART.has(p)) leaks.push(`${slug}: ${p}`);
      }
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
    ]) {
      expect(script.DENIED).toHaveProperty([denied]);
    }
  });

  it('every picture ImmersiveImage or CategoryHero can letterbox has a sampled ground color', async () => {
    const { ART_GROUND } = await import('../../lib/pseo/category-art-ground');
    const missing: string[] = [];
    for (const group of ['heroes', 'bento']) {
      for (const file of walk(path.join(ART_DIR, group))) {
        const publicPath = '/' + path.relative(path.join(ROOT, 'public'), file).split(path.sep).join('/');
        if (!/^#[0-9a-f]{6}$/.test(ART_GROUND[publicPath] ?? '')) missing.push(publicPath);
      }
    }
    // The state hub and metro cards letterbox the sage bento set.
    for (const p of ['/images/job-seekers/bento-guides.webp', '/images/job-seekers/bento-salary.webp', '/images/employers/bento-analytics.webp']) {
      if (!ART_GROUND[p]) missing.push(p);
    }
    expect(missing, 'run node scripts/sample-art-ground.mjs').toEqual([]);
    const stale = Object.keys(ART_GROUND).filter((p) => !fs.existsSync(path.join(ROOT, 'public', p)));
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
  });
});

/**
 * Regression pin for P1 #1 (dead-asset purge, assets-dead-refs package).
 *
 * The retired Supabase site-assets bucket 404'd on every page that
 * referenced it: the category asset registry (305 dead refs incl. the
 * fallback hero), /about's six dioramas, /resources' icon tiles, the
 * job-detail explore cards, and LicensureChecker. These surfaces now use
 * LOCAL public/images/** art and lucide icons exclusively.
 *
 * Pins:
 *  1. No remote-storage URL patterns creep back into the fixed surfaces.
 *  2. Every registry asset path points at a file that EXISTS on disk.
 *  3. Every taxonomy slug has a registry entry — the pSEO templates'
 *     `assets?.heroImage || <dead remote fallback>` expression must never
 *     reach its dead fallback branch.
 *  4. Registry entries honor the consumer contract: bentoImages[0] and
 *     [1] render UNCONDITIONALLY in both templates, so they must exist.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CATEGORY_ASSET_REGISTRY } from '../../lib/pseo/category-asset-registry';
import { ALL_CATEGORY_SLUGS } from '../../lib/pseo/taxonomy-registry';

const ROOT = path.resolve(__dirname, '../..');

/** Surfaces owned by the P1 #1 fix — dead remote refs must not return. */
const FIXED_SURFACES = [
  'lib/pseo/category-asset-registry.ts',
  'app/about/AboutClient.tsx',
  'app/resources/page.tsx',
  'components/LicensureChecker.tsx',
  'app/jobs/[slug]/page.tsx',
];

const REMOTE_STORAGE_PATTERNS = [/storage\/v1\/object/i, /site-assets/i, /storageBase/];

describe('P1 #1: dead Supabase asset refs stay purged', () => {
  it('fixed surfaces contain no remote storage-bucket references', () => {
    const offenders: string[] = [];
    for (const rel of FIXED_SURFACES) {
      const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const re of REMOTE_STORAGE_PATTERNS) {
        if (re.test(content)) offenders.push(`${rel} matches ${re}`);
      }
    }
    expect(offenders, 'Remote storage refs crept back into purged surfaces').toEqual([]);
  });

  it('every registry image path is local and exists in public/', () => {
    const missing: string[] = [];
    for (const [slug, assets] of Object.entries(CATEGORY_ASSET_REGISTRY)) {
      const paths = [assets.heroImage, ...assets.bentoImages, ...assets.bentoIcons, ...assets.exploreCards.map(c => c.icon)];
      for (const p of paths) {
        if (!p.startsWith('/images/')) {
          missing.push(`${slug}: non-local path ${p}`);
          continue;
        }
        if (!fs.existsSync(path.join(ROOT, 'public', p))) {
          missing.push(`${slug}: file not found for ${p}`);
        }
      }
    }
    expect(missing, 'Registry references assets that do not exist locally').toEqual([]);
  });

  it('every taxonomy slug has a registry entry (dead fallback hero can never fire)', () => {
    const uncovered = ALL_CATEGORY_SLUGS.filter(slug => !CATEGORY_ASSET_REGISTRY[slug]);
    expect(
      uncovered,
      'Slugs without a registry entry fall back to the dead remote hero URL ' +
      'hardcoded in category-city-template.tsx / setting-state-template.tsx',
    ).toEqual([]);
  });

  it('entries satisfy the consumer contract (hero + first two bento images)', () => {
    const broken: string[] = [];
    for (const [slug, assets] of Object.entries(CATEGORY_ASSET_REGISTRY)) {
      if (!assets.heroImage) broken.push(`${slug}: empty heroImage`);
      if (!/^#[0-9a-f]{6}$/i.test(assets.bgColor)) broken.push(`${slug}: bgColor not a hex color`);
      if (!assets.bentoImages[0] || !assets.bentoImages[1]) {
        broken.push(`${slug}: bentoImages[0]/[1] render unconditionally in both pSEO templates and must be set`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('/about renders only local illustration files that exist', () => {
    const content = fs.readFileSync(path.join(ROOT, 'app/about/AboutClient.tsx'), 'utf8');
    const srcs = [...content.matchAll(/src="(\/images\/[^"]+)"/g)].map(m => m[1]);
    expect(srcs.length, 'expected the six diorama slots to use local images').toBeGreaterThanOrEqual(6);
    const missing = srcs.filter(src => !fs.existsSync(path.join(ROOT, 'public', src)));
    expect(missing, '/about references local images that do not exist').toEqual([]);
  });
});

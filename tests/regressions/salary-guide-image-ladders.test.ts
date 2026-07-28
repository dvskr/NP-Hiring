/**
 * Regression: /salary-guide served blurry art through next/image.
 *
 * The factor-icon tiles (48px CSS) and the "Find Your Next High-Paying"
 * CTA (260px CSS) were rendered via next/image, whose resample blurs flat
 * line art — the exact problem scripts/regen-image-ladders.mjs exists to
 * solve. Both now serve plain <img> with an exact-DPR srcSet ladder,
 * mirroring the /for-employers CTA pattern.
 *
 * Pins:
 *  1. every ladder file the page references exists on disk;
 *  2. the page wires srcSet ladders (not bare next/image) for both surfaces;
 *  3. the factor sources stay registered in the ladder script so artwork
 *     swaps regenerate them.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const PAGE = fs.readFileSync(path.join(ROOT, 'app/salary-guide/page.tsx'), 'utf8');
const LADDER_SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts/regen-image-ladders.mjs'), 'utf8');

const FACTOR_NAMES = [
  'factor-location',
  'factor-experience',
  'factor-setting',
  'factor-employment',
  'factor-specialty',
  'factor-negotiate',
];
const FACTOR_WIDTHS = [48, 60, 72, 84, 96];
const CTA_WIDTHS = [260, 325, 390, 455, 520, 585, 650, 780];

describe('salary-guide image ladders', () => {
  it('factor-icon ladder files exist for every DPR step up to the 96px source cap', () => {
    for (const name of FACTOR_NAMES) {
      for (const w of FACTOR_WIDTHS) {
        const file = path.join(ROOT, 'public/images/salary-guide', `${name}-${w}.webp`);
        expect(fs.existsSync(file), `${name}-${w}.webp missing — run scripts/regen-image-ladders.mjs`).toBe(true);
      }
    }
  });

  it('CTA ladder files exist for every DPR step', () => {
    for (const w of CTA_WIDTHS) {
      const file = path.join(ROOT, 'public/images/employers', `cta-illustration-v2-${w}.webp`);
      expect(fs.existsSync(file), `cta-illustration-v2-${w}.webp missing — run scripts/regen-image-ladders.mjs`).toBe(true);
    }
  });

  it('the page serves both surfaces via srcSet ladders, not next/image', () => {
    expect(PAGE).not.toContain("from 'next/image'");
    // Factor tiles: ladder helper wired with the capped width set.
    expect(PAGE).toContain('ladderSrcSet(card.img, FACTOR_LADDER)');
    expect(PAGE).toContain('const FACTOR_LADDER = [48, 60, 72, 84, 96]');
    // CTA: full ladder, 2x default src, fixed 260px slot.
    expect(PAGE).toContain('cta-illustration-v2-520.webp');
    expect(PAGE).toContain("ladderSrcSet('/images/employers/cta-illustration-v2.webp', [260, 325, 390, 455, 520, 585, 650, 780])");
    expect(PAGE).toContain('sizes="260px"');
  });

  it('factor sources are registered in the ladder script for regeneration', () => {
    for (const name of FACTOR_NAMES) {
      expect(LADDER_SCRIPT).toContain(`public/images/salary-guide/${name}.webp`);
    }
  });
});

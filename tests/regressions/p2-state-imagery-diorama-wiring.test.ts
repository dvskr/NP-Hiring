/**
 * P2 #1 (state-imagery) regression pins.
 *
 * 52 state dioramas shipped in public/images/states/ but the two pages most
 * about a state never rendered them: /jobs/state/<state> led with one generic
 * map illustration shared by all 51 hubs — pulled from the retired remote
 * asset bucket, so it returned HTTP 400 along with the page's other seven
 * remote images — and /salary-guide/<state> had no artwork at all.
 *
 * Pins:
 *  1. components/StateImage.tsx's slug→backdrop map matches the directory
 *     listing exactly, and each colour still matches the artwork it claims to
 *     sample (an artwork swap that shifts the backdrop must fail here, not
 *     ship as coloured bars behind the contain-fitted hero).
 *  2. Every jurisdiction either page can route to has a diorama, so the
 *     no-artwork fallback is unreachable on a live URL.
 *  3. StateImage stays importable from server components — the helpers the
 *     two pages call are resolved on the server, which a `'use client'`
 *     directive would turn into opaque client references.
 *  4. Neither page reintroduces a remote-bucket image URL, and every local
 *     image path they reference exists on disk.
 *  5. Both heroes stay wired: correct intrinsic size, reserved space (no
 *     layout shift), explicit sizes, priority on the above-fold art.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import StateImage, {
  STATE_DIORAMA_SLUGS,
  STATE_DIORAMA_INTRINSIC,
  hasStateDiorama,
  stateDioramaSrc,
  stateDioramaBg,
} from '@/components/StateImage';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import { stateToSlug } from '@/lib/pseo/setting-state-config';

const ROOT = path.resolve(__dirname, '../..');
const DIORAMA_DIR = path.join(ROOT, 'public/images/states');

const STATE_PAGE = fs.readFileSync(path.join(ROOT, 'app/jobs/state/[state]/page.tsx'), 'utf8');
const SALARY_PAGE = fs.readFileSync(path.join(ROOT, 'app/salary-guide/[state]/page.tsx'), 'utf8');
const STATE_IMAGE_SRC = fs.readFileSync(path.join(ROOT, 'components/StateImage.tsx'), 'utf8');

const onDiskSlugs = (): string[] =>
  fs
    .readdirSync(DIORAMA_DIR)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''))
    .sort();

/**
 * Mean of the four 48px corner patches — the artwork's baked backdrop.
 *
 * The extract MUST be materialised with `.toBuffer()` before `.stats()`.
 * `sharp(file).extract(...).stats()` silently ignores the queued extract and
 * reports the WHOLE image's mean: sharp's stats() re-reads the input rather
 * than running the pipeline, so all four "corners" come back identical and
 * equal to `sharp(file).stats()`. That bug generated the first version of
 * STATE_DIORAMA_BG (every value ~29 RGB units too dark, worst 60) and this
 * assertion could never catch it, because it re-derived the map with the same
 * broken call and compared each value against itself.
 */
async function sampleBackdrop(slug: string): Promise<[number, number, number]> {
  const file = path.join(DIORAMA_DIR, `${slug}.png`);
  const { width = 0, height = 0 } = await sharp(file).metadata();
  const patch = 48;
  const corners: [number, number][] = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];
  const sums = [0, 0, 0];
  for (const [left, top] of corners) {
    const buf = await sharp(file).extract({ left, top, width: patch, height: patch }).toBuffer();
    const stats = await sharp(buf).stats();
    for (let c = 0; c < 3; c += 1) sums[c] += stats.channels[c].mean;
  }
  return [sums[0] / 4, sums[1] / 4, sums[2] / 4];
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

describe('P2 #1: the diorama set and its colour map stay in lockstep', () => {
  it('maps exactly the slugs that ship on disk', () => {
    expect([...STATE_DIORAMA_SLUGS].sort()).toEqual(onDiskSlugs());
  });

  it('covers the 50 states plus DC and Puerto Rico', () => {
    expect(STATE_DIORAMA_SLUGS.length).toBe(52);
    for (const slug of ['district-of-columbia', 'puerto-rico']) {
      expect(hasStateDiorama(slug), `${slug} lost its diorama`).toBe(true);
    }
  });

  it('every asset is square at the declared intrinsic size', async () => {
    const wrong: string[] = [];
    for (const slug of STATE_DIORAMA_SLUGS) {
      const meta = await sharp(path.join(DIORAMA_DIR, `${slug}.png`)).metadata();
      if (meta.width !== STATE_DIORAMA_INTRINSIC || meta.height !== STATE_DIORAMA_INTRINSIC) {
        wrong.push(`${slug}: ${meta.width}x${meta.height}`);
      }
    }
    expect(wrong, `assets off the declared ${STATE_DIORAMA_INTRINSIC}px square`).toEqual([]);
  }, 60_000);

  it('samples the corners, not the whole image (guards the assertion below)', async () => {
    // Without this, the drift check is a tautology: the map was generated with
    // `sharp(file).extract(...).stats()`, whose stats() ignores the queued
    // extract and returns the whole-image mean, and the check re-derived the
    // value the same broken way — comparing each colour against itself. It
    // passed on all 52 while the real deltas ran 7.9-60.1.
    const file = path.join(DIORAMA_DIR, 'hawaii.png');
    const patch = 48;
    const corner = async (left: number, top: number) => {
      const buf = await sharp(file).extract({ left, top, width: patch, height: patch }).toBuffer();
      const { channels } = await sharp(buf).stats();
      return channels.slice(0, 3).map((c) => c.mean);
    };
    const topLeft = await corner(0, 0);
    const bottomRight = await corner(1024 - patch, 1024 - patch);
    // Distinct corners must read differently — identical values are the
    // signature of stats() having ignored the extract.
    expect(Math.max(...topLeft.map((v, i) => Math.abs(v - bottomRight[i])))).toBeGreaterThan(1);

    // And the corner mean must not collapse onto the whole-image mean, which
    // includes the dark subject matter and is far darker than the backdrop.
    const whole = (await sharp(file).stats()).channels.slice(0, 3).map((c) => c.mean);
    const backdrop = await sampleBackdrop('hawaii');
    expect(Math.max(...backdrop.map((v, i) => Math.abs(v - whole[i])))).toBeGreaterThan(10);
  }, 30_000);

  it('each mapped colour still matches the artwork it samples', async () => {
    // The /jobs/state hero paints its panel this colour and fits the square
    // art `contain` over it. Drift shows up as visible bars beside the art.
    const drifted: string[] = [];
    for (const slug of STATE_DIORAMA_SLUGS) {
      const actual = await sampleBackdrop(slug);
      const declared = hexToRgb(stateDioramaBg(slug));
      const delta = Math.max(...actual.map((v, i) => Math.abs(v - declared[i])));
      if (delta > 3) drifted.push(`${slug}: declared ${stateDioramaBg(slug)}, sampled ${actual.map(Math.round).join(',')}`);
    }
    expect(drifted, 'artwork changed without regenerating the backdrop map in components/StateImage.tsx').toEqual([]);
  }, 120_000);

  it('degrades cleanly for a slug with no artwork', () => {
    expect(hasStateDiorama('atlantis')).toBe(false);
    expect(stateDioramaSrc('atlantis')).toBeNull();
    // Callers painting a panel never have to branch on a missing slug.
    expect(stateDioramaBg('atlantis')).toMatch(/^#[0-9A-F]{6}$/i);
    expect(stateDioramaSrc('texas')).toBe('/images/states/texas.png');
  });
});

describe('P2 #1: every routable jurisdiction has artwork', () => {
  it('covers all 51 jurisdictions /jobs/state and /salary-guide can render', () => {
    const jurisdictions = Object.keys(STATE_PRACTICE_AUTHORITY);
    expect(jurisdictions.length).toBe(51);
    const missing = jurisdictions.filter((name) => !hasStateDiorama(stateToSlug(name)));
    expect(missing, 'jurisdictions routing to a hero with no diorama').toEqual([]);
  });
});

describe('P2 #1: StateImage stays server-importable', () => {
  it('is not a client component', () => {
    // Both pages call stateDioramaSrc/hasStateDiorama during a server render.
    // A `'use client'` directive replaces every export with an opaque client
    // reference, so those calls would break rather than fail a type check.
    expect(STATE_IMAGE_SRC).not.toMatch(/^\s*['"]use client['"]/m);
    expect(STATE_IMAGE_SRC).not.toContain('useState');
    // The missing-asset fallback is resolved at render time, not via a failed
    // request — no broken-image flash and nothing to hydrate.
    expect(STATE_IMAGE_SRC).not.toMatch(/onError\s*=/);
    expect(typeof StateImage).toBe('function');
  });
});

describe('P2 #1: neither state page serves a dead remote image', () => {
  const REMOTE_PATTERNS = [/storage\/v1\/object/i, /site-assets/i, /storageBase/, /https?:\/\/[^'"`\s]+\.webp/i];

  it('has no remote asset-bucket references', () => {
    const offenders: string[] = [];
    for (const [name, src] of [['jobs/state', STATE_PAGE], ['salary-guide/[state]', SALARY_PAGE]] as const) {
      for (const re of REMOTE_PATTERNS) {
        if (re.test(src)) offenders.push(`${name} matches ${re}`);
      }
    }
    expect(offenders, 'remote image URLs are dead (HTTP 400) — use public/images/** or lucide').toEqual([]);
  });

  it('references only local image files that exist', () => {
    const missing: string[] = [];
    for (const [name, src] of [['jobs/state', STATE_PAGE], ['salary-guide/[state]', SALARY_PAGE]] as const) {
      const refs = [...src.matchAll(/['"](\/images\/[^'"]+)['"]/g)].map((m) => m[1]);
      for (const ref of refs) {
        if (!fs.existsSync(path.join(ROOT, 'public', ref))) missing.push(`${name}: ${ref}`);
      }
    }
    expect(missing, 'page references a local image that does not exist').toEqual([]);
  });
});

describe('P2 #1: /jobs/state/<state> hero renders the state diorama', () => {
  it('derives the hero image and panel colour from the diorama helpers', () => {
    expect(STATE_IMAGE_SRC).toContain('export function stateDioramaSrc');
    expect(STATE_PAGE).toContain("from '@/components/StateImage'");
    expect(STATE_PAGE).toMatch(/const dioramaSrc = stateDioramaSrc\(stateSlug\)/);
    expect(STATE_PAGE).toMatch(/heroImage=\{heroImage\}/);
    expect(STATE_PAGE).toMatch(/bgColor=\{heroBgColor\}/);
    // The panel behind the contain-fitted art takes the artwork's own colour.
    expect(STATE_PAGE).toMatch(/stateDioramaBg\(stateSlug\)/);
  });

  it('keeps a real local fallback rather than a placeholder or dead URL', () => {
    expect(STATE_PAGE).toMatch(/heroImage = dioramaSrc \?\? STATE_HERO_FALLBACK\.src/);
    expect(STATE_PAGE).toMatch(/STATE_HERO_FALLBACK = \{ src: '\/images\/[^']+'/);
  });

  it('gives the diorama a state-specific alt instead of the generic one', () => {
    expect(STATE_PAGE).toContain('Illustrated diorama representing ${stateName}');
  });

  it('replaced the four dead icon tiles with lucide glyphs', () => {
    for (const icon of ['Video', 'Stethoscope', 'Hospital', 'Briefcase']) {
      expect(STATE_PAGE, `${icon} tile missing`).toContain(`{ Icon: ${icon},`);
    }
    // Decorative — the tile heading carries the meaning.
    expect(STATE_PAGE).toMatch(/<span aria-hidden="true"[^>]*>\s*<Icon/);
  });
});

describe('P2 #1: /salary-guide/<state> hero renders the state diorama', () => {
  it('renders StateImage with reserved space, explicit sizes and priority', () => {
    expect(SALARY_PAGE).toContain("import StateImage, { hasStateDiorama } from '@/components/StateImage'");
    const hero = SALARY_PAGE.slice(SALARY_PAGE.indexOf('<StateImage'), SALARY_PAGE.indexOf('</section>', SALARY_PAGE.indexOf('<StateImage')));
    expect(hero, '<StateImage> missing from the salary-guide hero').toBeTruthy();
    expect(hero).toContain('slug={stateSlug}');
    expect(hero).toContain('fill');
    expect(hero).toMatch(/sizes="[^"]+"/);
    // Above-fold hero art — preloaded, never lazy.
    expect(hero).toContain('priority');
    expect(hero).not.toContain("loading='lazy'");
  });

  it('reserves the art box so the image cannot shift layout', () => {
    expect(SALARY_PAGE).toMatch(/\.sg-hero-art\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
    expect(SALARY_PAGE).toMatch(/\.sg-hero-art\s*\{[^}]*position:\s*relative/);
  });

  it('guards on hasStateDiorama so a slug without art keeps the text hero', () => {
    expect(SALARY_PAGE).toMatch(/const showHeroDiorama = hasStateDiorama\(stateSlug\)/);
    expect(SALARY_PAGE).toMatch(/\{showHeroDiorama && \(/);
  });

  it('keeps the speakable summary id the WebPage schema points at', () => {
    // The two-column hero rewrite must not drop the selector.
    expect(SALARY_PAGE).toContain('id="state-salary-summary"');
    expect(SALARY_PAGE).toContain("'#state-salary-summary'");
  });

  it('uses a static style block (interpolation deadlocks the route compile)', () => {
    const block = SALARY_PAGE.slice(SALARY_PAGE.indexOf('<style>{`'), SALARY_PAGE.indexOf('`}</style>'));
    expect(block).toBeTruthy();
    expect(block).not.toContain('${');
  });
});

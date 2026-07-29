/**
 * P3 #10 (image-optimization) regression pins.
 *
 * TWO ASSET DEBTS, both of them real bytes in the repo and the deploy artifact:
 *
 *  1. public/images/states/*.png — 52 jurisdiction dioramas wired into
 *     /jobs/state, /jobs/metro, /salary-guide, /jobs/locations(/state),
 *     /resources, TopStatesList and LicensureChecker by P2 #1. They shipped as
 *     1024x1024 baseline JPEGs at roughly q95: 500-860 KB each, 32.03 MB for
 *     the set, and 102 of those URLs are advertised raw to Google Images from
 *     app/image-sitemap.xml, so the raw file really is fetched. Re-encoded in
 *     place at q88/mozjpeg by scripts/optimize-state-images.mjs --apply:
 *     32.03 MB -> 6.05 MB (-81.1%), same 1024 square, backdrops held to within
 *     1.0 RGB unit of STATE_DIORAMA_BG.
 *
 *  2. public/images/how-it-works/ — 100 files where only 73 were reachable.
 *     27 leftovers (rejected .svg recreations, superseded -v3/-v4/-v5 artwork,
 *     -512/-1120 widths from an earlier CSS size, and 4 byte-identical
 *     duplicates of the -v2 seeker steps) were pruned: 1,133,958 bytes.
 *
 * Pins:
 *  1. Every slug the site can render still resolves to a file on disk at
 *     exactly the path stateDioramaSrc() returns — DC and Puerto Rico named
 *     explicitly, since they were the two added last and are the two a
 *     directory-listing test would silently lose.
 *  2. No unoptimised master can come back: every diorama is a PROGRESSIVE
 *     JPEG (the optimiser's own output marker; the 630 KB sources were
 *     baseline) at 1024 square, under a per-file and set-wide byte budget.
 *  3. The optimiser cannot silently degrade the artwork: it never resizes, it
 *     only touches baseline JPEGs, and its WebP projection writes nothing.
 *  4. how-it-works: every width every consumer's srcSet can request exists,
 *     and NOTHING in that directory is unreachable — the invariant, not a
 *     list, so the next orphan fails here instead of shipping.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import {
  STATE_DIORAMA_SLUGS,
  STATE_DIORAMA_INTRINSIC,
  stateDioramaSrc,
  stateDioramaBg,
} from '@/components/StateImage';

const ROOT = path.resolve(__dirname, '../..');
const DIORAMA_DIR = path.join(ROOT, 'public/images/states');
const HIW_DIR = path.join(ROOT, 'public/images/how-it-works');
const OPTIMIZER = path.join(ROOT, 'scripts/optimize-state-images.mjs');

/**
 * Per-file ceiling. The set's largest after the pass is district-of-columbia
 * at 196 KB (200,719 B); 260 KB leaves room for an artwork swap while still
 * failing hard on a re-added ~630 KB q95 master.
 */
const MAX_DIORAMA_BYTES = 260 * 1024;

/** Set-wide ceiling: 6.05 MB after the pass, was 32.03 MB. */
const MAX_DIORAMA_SET_BYTES = 8 * 1024 * 1024;

const bytes = (file: string): number => fs.statSync(file).size;
const dioramaFile = (slug: string): string => path.join(ROOT, 'public', stateDioramaSrc(slug)!);

/**
 * Mean of the four 48px corner patches. The extract MUST be materialised with
 * `.toBuffer()` before `.stats()` — sharp's stats() re-reads the input and
 * ignores the queued pipeline, which is how the first STATE_DIORAMA_BG came
 * out up to 60 RGB units too dark. Same two-step form as P2 #1's suite and
 * scripts/optimize-state-images.mjs.
 */
async function sampleBackdrop(file: string): Promise<[number, number, number]> {
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
    const { channels } = await sharp(buf).stats();
    for (let c = 0; c < 3; c += 1) sums[c] += channels[c].mean;
  }
  return [sums[0] / 4, sums[1] / 4, sums[2] / 4];
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

describe('P3 #10: every state diorama resolves at the path the component serves', () => {
  it('resolves all 52 slugs, DC and Puerto Rico included', () => {
    expect(STATE_DIORAMA_SLUGS.length).toBe(52);
    const missing = STATE_DIORAMA_SLUGS.filter((slug) => !fs.existsSync(dioramaFile(slug)));
    expect(missing, 'slug renders a src that 404s').toEqual([]);

    // Named rather than left to the count: these two were added after the
    // original 50 and are exactly what a listing-derived test cannot notice.
    for (const slug of ['district-of-columbia', 'puerto-rico']) {
      expect(stateDioramaSrc(slug), `${slug} has no src`).toBe(`/images/states/${slug}.png`);
      expect(fs.existsSync(dioramaFile(slug)), `${slug} src does not exist on disk`).toBe(true);
    }
  });

  it('ships no stray files beside the 52 the component maps', () => {
    const onDisk = fs
      .readdirSync(DIORAMA_DIR)
      .filter((f) => /\.(png|jpe?g|webp|avif)$/i.test(f))
      .map((f) => f.replace(/\.[^.]+$/, ''))
      .sort();
    // A leftover duplicate here is pure deploy weight: nothing can request a
    // slug the component does not map.
    expect(onDisk).toEqual([...STATE_DIORAMA_SLUGS].sort());
  });
});

describe('P3 #10: the diorama set stays optimised', () => {
  it('is progressive JPEG at the declared intrinsic size, within budget', async () => {
    const offenders: string[] = [];
    let total = 0;

    for (const slug of STATE_DIORAMA_SLUGS) {
      const file = dioramaFile(slug);
      const size = bytes(file);
      total += size;
      const meta = await sharp(file).metadata();

      if (meta.width !== STATE_DIORAMA_INTRINSIC || meta.height !== STATE_DIORAMA_INTRINSIC) {
        offenders.push(`${slug}: ${meta.width}x${meta.height}, expected ${STATE_DIORAMA_INTRINSIC} square`);
      }
      // Progressive is scripts/optimize-state-images.mjs's output marker and
      // the un-fakeable difference from the 630 KB baseline masters. It also
      // makes `--apply` idempotent, so this pin and that guard are the same
      // fact stated twice.
      if (meta.format !== 'jpeg' || meta.isProgressive !== true) {
        offenders.push(
          `${slug}: ${meta.format}${meta.isProgressive ? ' progressive' : ' baseline'} — ` +
            'run `node scripts/optimize-state-images.mjs --apply`',
        );
      }
      if (size > MAX_DIORAMA_BYTES) {
        offenders.push(`${slug}: ${(size / 1024).toFixed(0)} KB > ${MAX_DIORAMA_BYTES / 1024} KB budget`);
      }
    }

    expect(offenders, 'unoptimised diorama sources are repo + deploy weight').toEqual([]);
    expect(total, `set is ${(total / 1024 / 1024).toFixed(2)} MB`).toBeLessThan(MAX_DIORAMA_SET_BYTES);
  }, 120_000);

  it('kept every backdrop inside the colour every hero panel paints', async () => {
    // Surfaces that letterbox the square art (CategoryHero on /jobs/state and
    // /jobs/metro) paint their panel stateDioramaBg(slug), so a re-encode that
    // shifted the backdrop shows as coloured bars beside the artwork. Spot
    // check the extremes of the sampled range plus the widest drift the pass
    // recorded (wyoming, 1.0); P2 #1's suite sweeps all 52.
    const drifted: string[] = [];
    for (const slug of ['georgia', 'virginia', 'wyoming', 'district-of-columbia', 'puerto-rico', 'texas']) {
      const sampled = await sampleBackdrop(dioramaFile(slug));
      const declared = hexToRgb(stateDioramaBg(slug));
      const delta = Math.max(...sampled.map((v, i) => Math.abs(v - declared[i])));
      if (delta > 3) drifted.push(`${slug}: declared ${stateDioramaBg(slug)}, sampled Δ${delta.toFixed(1)}`);
    }
    expect(drifted, 'the re-encode moved a backdrop away from STATE_DIORAMA_BG').toEqual([]);
  }, 60_000);
});

describe('P3 #10: the optimiser cannot degrade the artwork', () => {
  const SRC = fs.readFileSync(OPTIMIZER, 'utf8');

  it('never resizes — 1024 is the declared intrinsic size', () => {
    // The widest physical need is CategoryHero's panel at 380 CSS px x DPR 3,
    // so 1024 is already the right master size. A resize here would silently
    // break STATE_DIORAMA_INTRINSIC and P2 #1's square assertion.
    expect(SRC).not.toMatch(/\.resize\(/);
  });

  it('only re-encodes baseline JPEGs, so --apply is idempotent', () => {
    // Its own output is progressive. Without this guard a second run would
    // stack a third generation of loss onto all 52 dioramas.
    expect(SRC).toMatch(/isUnoptimised\s*=\s*\(meta\)\s*=>\s*meta\.format === 'jpeg' && meta\.isProgressive === false/);
  });

  it('refuses to write a re-encode that drifts the declared backdrop', () => {
    expect(SRC).toContain('backdrop would drift');
    expect(SRC).toMatch(/BG_TOLERANCE\s*=\s*3/);
  });

  it('writes nothing in the WebP projection', () => {
    // Emitting .webp siblings before stateDioramaSrc() points at them would
    // ship 52 files no request can reach — the PENDING_WIRING anti-pattern in
    // scripts/regen-image-ladders.mjs.
    const measure = SRC.slice(SRC.indexOf('async function measureWebp'), SRC.indexOf('/** Emits the STATE_DIORAMA_BG'));
    expect(measure).toBeTruthy();
    expect(measure).not.toMatch(/toFile\(|writeFileSync\(/);
  });
});

describe('P3 #10: public/images/how-it-works carries no unreachable file', () => {
  /** Every filename a consumer or the ladder generator can actually request. */
  function requestableNames(): Set<string> {
    const names = new Set<string>();

    // components/EmployerHowItWorks.tsx + app/faq/page.tsx serve the employer
    // steps from an exact-DPR ladder; the widths come from the component's own
    // STEP_SIZES so this cannot drift from what the browser asks for.
    const ehw = fs.readFileSync(path.join(ROOT, 'components/EmployerHowItWorks.tsx'), 'utf8');
    const stepSizes = JSON.parse(/const STEP_SIZES = (\[[^\]]+\])/.exec(ehw)![1]) as number[];
    const bases = [...ehw.matchAll(/base: '(step-employer-[a-z]+)'/g)].map((m) => m[1]);
    expect(stepSizes.length).toBe(8);
    expect(bases.length).toBe(4);
    for (const base of bases) {
      names.add(`${base}.webp`); // ladder source (regen-image-ladders REGISTRY)
      for (const w of stepSizes) names.add(`${base}-${w}.webp`);
    }

    // components/FeaturedJobs.tsx serves the four seeker steps at 80 CSS px.
    const fj = fs.readFileSync(path.join(ROOT, 'components/FeaturedJobs.tsx'), 'utf8');
    const seekerWidths = JSON.parse(
      /srcSet=\{(\[[^\]]+\])\s*\n?\s*\.map\(\(w\) => `\/images\/how-it-works\/seeker-step/.exec(fj)![1],
    ) as number[];
    expect(seekerWidths.length).toBe(8);
    for (let i = 1; i <= 4; i += 1) {
      names.add(`seeker-step${i}-v2.webp`);
      for (const w of seekerWidths) names.add(`seeker-step${i}-v2-${w}.webp`);
    }
    return names;
  }

  /** Text files that could name an asset — public/ and build output excluded. */
  function sourceCorpus(): string[] {
    const skip = new Set(['node_modules', '.next', '.git', 'public', '.vercel', 'dist', 'coverage', '.turbo']);
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) walk(full);
        } else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html)$/i.test(entry.name)) {
          out.push(fs.readFileSync(full, 'utf8'));
        }
      }
    };
    walk(ROOT);
    return out;
  }

  it('has every width its consumers can request', () => {
    const missing = [...requestableNames()].filter((n) => !fs.existsSync(path.join(HIW_DIR, n)));
    expect(missing, 'a srcSet entry 404s — the browser picks it at that DPR').toEqual([]);
  });

  it('has no file that nothing references', () => {
    const requestable = requestableNames();
    const corpus = sourceCorpus();
    const orphans = fs
      .readdirSync(HIW_DIR)
      .filter((f) => !requestable.has(f) && !corpus.some((text) => text.includes(f)));
    // 27 such files shipped before this pass (1,133,958 bytes): rejected .svg
    // recreations, superseded -v3/-v4/-v5 artwork, -512/-1120 widths left from
    // an earlier CSS size, and 4 byte-identical copies of the -v2 seeker steps.
    expect(orphans, 'unreferenced image variants are repo + deploy weight').toEqual([]);
  });

  it('kept step-employer-track-v5.webp, which /about still renders', () => {
    // The only -v5 with a consumer — the reason pruning had to be per-file
    // rather than "delete every -vN".
    const about = fs.readFileSync(path.join(ROOT, 'app/about/AboutClient.tsx'), 'utf8');
    expect(about).toContain('/images/how-it-works/step-employer-track-v5.webp');
    expect(fs.existsSync(path.join(HIW_DIR, 'step-employer-track-v5.webp'))).toBe(true);
  });
});

/**
 * The extension on these files lies (JPEG bytes under a PNG name) and the fix
 * is deliberately deferred to a human, because it has to move the component,
 * four test suites and a manifest in one commit. `--measure-webp` prints that
 * to-do list and StateImage.tsx repeats it, which makes the list itself
 * load-bearing: it shipped claiming image-manifest.json needed "1 key" changed
 * when all five of its keys are diorama paths, and omitting THIS suite
 * entirely. Prose that a human executes is code, so it gets pinned like code.
 */
describe('P3 #10: the deferred `.webp` rename handoff stays accurate', () => {
  const SRC = fs.readFileSync(OPTIMIZER, 'utf8');

  /**
   * Assembled instead of written literally on purpose: this suite is one of
   * the rows in the checklist it verifies, so a literal extension here would
   * inflate the very number being checked.
   */
  const EXT = `.${'png'}`;

  /** The checklist block `--measure-webp` prints after its projection. */
  const CHECKLIST = (() => {
    const start = SRC.indexOf('Landing it means renaming the files');
    const end = SRC.indexOf('/** Emits the STATE_DIORAMA_BG');
    return start > -1 && end > start ? SRC.slice(start, end) : '';
  })();

  /**
   * Files that name a diorama path but need no edit for the rename, each for a
   * stated reason. Anything else that pins a path must appear in the checklist.
   */
  const NO_ACTION = new Set([
    'scripts/optimize-state-images.mjs', // the checklist's own source
    'scripts/rewrite-image-paths.mjs', // dead migration tooling, must not run
    'scripts/migrate-images-to-supabase.mjs', // dead migration tooling, comment only
    'app/jobs/state/[state]/page.tsx', // comment only
    'app/salary-guide/[state]/page.tsx', // comment only
  ]);

  const countExt = (text: string): number => text.split(EXT).length - 1;

  /** rel path -> the occurrence count the checklist claims for it. */
  function claimedCounts(): Map<string, number> {
    const out = new Map<string, number>();
    const row = /(\S+\.(?:tsx?|mjs|json))\s{2,}(?:ALL\s+)?(\d+)\s+(?:literal|key)/g;
    for (const m of CHECKLIST.matchAll(row)) out.set(m[1].replace(/\\/g, '/'), Number(m[2]));
    return out;
  }

  it('parses as rows that each name a file that exists', () => {
    expect(CHECKLIST, 'the --measure-webp checklist block moved or vanished').toBeTruthy();
    const claims = claimedCounts();
    expect(claims.size, 'checklist rows no longer parse — the pins below go blind').toBeGreaterThanOrEqual(6);
    const absent = [...claims.keys()].filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
    expect(absent, 'checklist row points at a file that does not exist').toEqual([]);
  });

  it('states the true occurrence count for every file it lists', () => {
    const wrong: string[] = [];
    for (const [rel, claimed] of claimedCounts()) {
      const actual = countExt(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      if (actual !== claimed) wrong.push(`${rel}: checklist claims ${claimed}, file actually has ${actual}`);
    }
    expect(
      wrong,
      'a human follows this checklist by hand for the rename, so an undercount silently ' +
        'leaves stale references behind. Fix the console.log rows in measureWebp() ' +
        '(and the copy of the list in components/StateImage.tsx).',
    ).toEqual([]);
  });

  it('claims every key of image-manifest.json, not just one of them', () => {
    const rel = 'scripts/image-manifest.json';
    const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    // The original defect: the checklist said "1 key" while every key in the
    // file is a diorama path, so following it stranded four.
    const dioramaKeys = keys.filter((k) => k.startsWith('/images/states/') && k.endsWith(EXT));
    expect(dioramaKeys.length, 'a non-diorama key appeared — recheck the claim').toBe(keys.length);
    expect(claimedCounts().get(rel), 'checklist must cover all of the manifest keys').toBe(keys.length);
  });

  it('lists every file that pins a diorama path', () => {
    const skip = new Set(['node_modules', '.next', '.git', 'public', '.vercel', 'dist', 'coverage', '.turbo']);
    const names = new RegExp(`images/states[^\\r\\n]*${EXT.replace('.', '\\.')}`);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) walk(full);
        } else if (/\.(ts|tsx|js|jsx|mjs|cjs|json)$/i.test(entry.name)) {
          if (names.test(fs.readFileSync(full, 'utf8'))) found.push(path.relative(ROOT, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(ROOT);

    const claimed = new Set(claimedCounts().keys());
    const unlisted = found.filter((rel) => !claimed.has(rel) && !NO_ACTION.has(rel));
    expect(
      unlisted,
      'this file pins a diorama path but the --measure-webp checklist never mentions it, ' +
        'so the rename would ship half-done — that is how this suite itself got left off. ' +
        'Add a checklist row, or add it to NO_ACTION with a reason.',
    ).toEqual([]);
  });
});

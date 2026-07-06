/**
 * scripts/retheme.ts — brand palette codemod: inherited teal -> deep berry.
 *
 * Usage (from the repo root):
 *   node scripts/retheme.ts --dry-run   # report per-file replacement counts, write nothing
 *   node scripts/retheme.ts             # apply in place
 *
 * Reusable for the next re-skin: edit the mapping tables below
 * (HEX_MAP / RGBA_MAP / TW_SHADE_MAP / GRADIENT_PARTNER_MAP) and, if the
 * surface area changes, ROOTS / EXTRA_FILES. All hex matching is
 * case-insensitive. Binary files are never touched (extension allowlist).
 *
 * Passes, in order (order matters — gradient pairing must see the teal
 * stops before the plain hex map rewrites them):
 *   1. gradient pass  — inside any *-gradient(...) that pairs a brand-teal
 *                       stop with an emerald partner (#10B981/#059669/#065F46),
 *                       the emerald partner also becomes berry. Emerald used
 *                       ALONE (success badges etc.) is left green.
 *   2. hex pass       — flat #RRGGBB map (also matches #RRGGBBAA; the
 *                       2-digit alpha suffix is preserved verbatim).
 *   3. rgba pass      — rgba(r,g,b,ALPHA) triplet map, alpha preserved.
 *   4. tailwind pass  — teal-<shade> utility classes -> pink-<shade'>.
 *                       CSS custom property NAMES (--pd-teal, --clay-teal),
 *                       class names (.badge-teal) and object keys (V2.teal)
 *                       are intentionally NOT renamed — values only.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes('--dry-run');

const ROOTS = ['app', 'components', 'lib', 'config'];
const EXTRA_FILES = [
  'middleware.ts', // inline-styled maintenance/queue pages
  'tailwind.config.ts', // legacy v3 config (dead under v4, kept in sync anyway)
  'public/site.webmanifest',
  '.agents/category-migration-workflow.md', // template for future category pages
  'scripts/gen-missing-pages.js', // page generator — would re-emit teal pages
  'scripts/render-test-email.js', // mirrors the email V2 palette
];
const EXTS = new Set(['.ts', '.tsx', '.css', '.webmanifest']);

/** Canonical teal -> deep-berry map, plus board-specific teal-family values
 *  found by audit (material-teal `primary` ramp, warm-diorama about-page teal,
 *  email/button teal-400, pale teal tints, job-card aqua accent). */
const HEX_MAP: Record<string, string> = {
  // ── canonical mapping ──
  '0D9488': 'BE185D', // primary
  '0F766E': '9D174D', // primary-dark
  '115E59': '831843', // primary-deep
  '134E4A': '831843',
  '14B8A6': 'DB2777', // primary-light
  '2DD4BF': 'F472B6', // pale accent
  '5EEAD4': 'F9A8D4',
  '99F6E4': 'FBCFE8',
  'B2F5EA': 'FBCFE8', // chip bg
  'CCFBF1': 'FCE7F3',
  'F0FDFA': 'FDF2F8', // tint bg
  // ── extras: material-teal "primary" ramp (globals.css @theme + tailwind.config.ts) ──
  'EEFBF9': 'FDF2F8', // primary-50
  'D5F3ED': 'FCE7F3', // primary-100
  'AEE5DB': 'FBCFE8', // primary-200
  '81D3C5': 'F9A8D4', // primary-300
  '5FBEAF': 'F472B6', // primary-400
  '4DB6AC': 'DB2777', // primary-500 / email tealButton
  '3D9E94': 'BE185D', // primary-600
  '348078': '9D174D', // primary-700
  '2E6761': '831843', // primary-800
  '285550': '500724', // primary-900 -> pink-950
  // ── extras: about-page warm-diorama teal + OG city accent ──
  '5EBCB0': 'F472B6',
  '4AA89C': 'DB2777', // about.css --teal
  '2F7A73': '9D174D', // about.css --teal-deep
  // ── extras: pale teal tints + job-card aqua accent ──
  'E6FAF8': 'FDF2F8',
  'E6FAF5': 'FDF2F8',
  '64FFDA': 'F9A8D4', // job-card mint accent on dark navy
};

/** rgba()/rgb() triplets — alpha (and anything after the blue channel) preserved. */
const RGBA_MAP: Array<[string, string]> = [
  ['13,148,136', '190,24,93'], // #0D9488
  ['15,118,110', '157,23,77'], // #0F766E
  ['20,184,166', '219,39,119'], // #14B8A6
  ['45,212,191', '244,114,182'], // #2DD4BF
  ['94,188,176', '244,114,182'], // #5EBCB0
  ['47,122,115', '157,23,77'], // #2F7A73
  ['20,80,75', '131,24,67'], // about.css dark-teal clay shadows -> #831843
];

/** Tailwind utility shades: teal-N -> pink-N'. Mid shades shift +100 so the
 *  rendered hex matches the canonical map (teal-600 #0D9488 -> pink-700 #BE185D). */
const TW_SHADE_MAP: Record<string, string> = {
  '50': '50',
  '100': '100',
  '200': '200',
  '300': '300',
  '400': '400',
  '500': '600',
  '600': '700',
  '700': '800',
  '800': '900',
  '900': '900',
};

/** A gradient counts as "brand teal" if it contains any of these stops. */
const GRADIENT_TEAL = /#(0D9488|0F766E|14B8A6|2DD4BF|4DB6AC|5EBCB0|4AA89C|2F7A73|64FFDA)/i;
/** Emerald partners inside brand-teal gradients also become berry. */
const GRADIENT_PARTNER_MAP: Record<string, string> = {
  '10B981': '9D174D',
  '059669': '9D174D',
  '065F46': '831843',
};

interface Counts {
  gradient: number;
  hex: number;
  rgba: number;
  tw: number;
}

const HEX_RE = /#([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?\b/g;
const TW_RE = /\bteal-(50|100|200|300|400|500|600|700|800|900)\b/g;
const GRADIENT_START_RE = /(?:linear|radial|conic)-gradient\(/gi;
const GRADIENT_PARTNER_RE = new RegExp(`#(${Object.keys(GRADIENT_PARTNER_MAP).join('|')})\\b`, 'gi');

/** Replace emerald partners inside brand-teal gradients (balanced-paren scan —
 *  gradients contain nested rgba(...) calls, so a naive [^)]* regex is wrong). */
function gradientPass(src: string, counts: Counts): string {
  let out = '';
  let last = 0;
  GRADIENT_START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GRADIENT_START_RE.exec(src)) !== null) {
    const start = m.index;
    let i = GRADIENT_START_RE.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    let grad = src.slice(start, i);
    if (GRADIENT_TEAL.test(grad)) {
      grad = grad.replace(GRADIENT_PARTNER_RE, (_full, hex: string) => {
        counts.gradient++;
        return '#' + GRADIENT_PARTNER_MAP[hex.toUpperCase()];
      });
    }
    out += src.slice(last, start) + grad;
    last = i;
    GRADIENT_START_RE.lastIndex = i;
  }
  return out + src.slice(last);
}

function transform(src: string): { result: string; counts: Counts } {
  const counts: Counts = { gradient: 0, hex: 0, rgba: 0, tw: 0 };

  let result = gradientPass(src, counts);

  result = result.replace(HEX_RE, (full, hex: string, alpha: string | undefined) => {
    const mapped = HEX_MAP[hex.toUpperCase()];
    if (!mapped) return full;
    counts.hex++;
    return '#' + mapped + (alpha ?? '');
  });

  for (const [from, to] of RGBA_MAP) {
    const [r, g, b] = from.split(',');
    const re = new RegExp(String.raw`(rgba?\(\s*)${r}\s*,\s*${g}\s*,\s*${b}(?=\s*[,)])`, 'g');
    result = result.replace(re, (_full, prefix: string) => {
      counts.rgba++;
      return prefix + to;
    });
  }

  result = result.replace(TW_RE, (_full, shade: string) => {
    counts.tw++;
    return 'pink-' + TW_SHADE_MAP[shade];
  });

  return { result, counts };
}

function walk(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, acc);
    } else if (EXTS.has(extname(entry))) {
      acc.push(full);
    }
  }
}

function main(): void {
  const files: string[] = [];
  for (const root of ROOTS) {
    const abs = join(ROOT, root);
    if (existsSync(abs)) walk(abs, files);
  }
  for (const extra of EXTRA_FILES) {
    const abs = join(ROOT, extra);
    if (existsSync(abs)) files.push(abs);
  }

  const totals: Counts = { gradient: 0, hex: 0, rgba: 0, tw: 0 };
  let touched = 0;

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const { result, counts } = transform(src);
    const fileTotal = counts.gradient + counts.hex + counts.rgba + counts.tw;
    if (fileTotal === 0) continue;
    touched++;
    totals.gradient += counts.gradient;
    totals.hex += counts.hex;
    totals.rgba += counts.rgba;
    totals.tw += counts.tw;
    const rel = relative(ROOT, file);
    console.log(
      `${rel}  hex=${counts.hex} rgba=${counts.rgba} gradientPair=${counts.gradient} twClass=${counts.tw} total=${fileTotal}`
    );
    if (!DRY_RUN) writeFileSync(file, result, 'utf8');
  }

  const grand = totals.gradient + totals.hex + totals.rgba + totals.tw;
  console.log('---');
  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}${touched} file(s), ${grand} replacement(s) ` +
      `(hex=${totals.hex}, rgba=${totals.rgba}, gradientPair=${totals.gradient}, twClass=${totals.tw})`
  );
}

main();

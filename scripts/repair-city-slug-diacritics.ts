/**
 * scripts/repair-city-slug-diacritics.ts — P3 #9 (narrow fix)
 *
 * WHY THIS EXISTS
 * ───────────────
 * The dead generator behind lib/pseo/city-data/cities.ts slugified names by
 * DELETING every character outside [a-z0-9] without folding Unicode first, so
 * the three records whose names carry a diacritic shipped garbled slugs:
 *
 *   La Cañada Flintridge, CA → la-caada-flintridge-ca   (should be la-canada-flintridge-ca)
 *   Cañon City, CO           → caon-co                  (should be canon-city-co)
 *   Española, NM             → espaola-nm               (should be espanola-nm)
 *
 * Those are broken strings, not a naming preference — nothing can read them back
 * as a place name. This script rewrites them to the folded form produced by
 * lib/pseo/city-data/slugify.ts, and rewrites every `nearbyCities` reference
 * that pointed at an old slug (those resolve through getCityBySlug, so a stale
 * reference silently drops the nearby-cities module on the referring page).
 *
 * SCOPE — deliberately three records
 * ──────────────────────────────────
 * Only records whose NAME contains a non-ASCII character are considered. The
 * other 117 dataset slugs that differ from the keyword-complete ideal form
 * (trailing "City"/"Village"/"Town" dropped, punctuation collapsed) are NOT
 * touched: renaming those is a ~5,400-URL migration with a 301 map, three DB
 * tables and 735 nearbyCities rewrites, and it was explicitly deferred. This
 * script must stay a no-op on them.
 *
 * The file is machine written with one field per line, so a block scan is exact
 * and only the repaired lines are rewritten — every untouched record stays
 * byte-identical. Same approach as scripts/repair-city-data-collisions.mjs.
 *
 * RUN
 * ───
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/repair-city-slug-diacritics.ts
 *
 * Add --check to assert-only (exit 1 if any record still needs repair) — the
 * shape CI wants. Then ALWAYS regenerate the middleware allowlist:
 *
 *   node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register \
 *     --project scripts/tsconfig.json scripts/generate-city-slugs-edge.ts
 *
 * …or middleware.ts 410s every repaired URL and the drift guard
 * (tests/regressions/pseo-consistency-city-slugs-drift.test.ts) fails.
 *
 * A slug that has already shipped may be indexed, so any repair here needs a
 * matching 301 in next.config.ts. See the redirect block there.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCityDatasetSlug } from '@/lib/pseo/city-data/slugify';

const CITIES_PATH = resolve(process.cwd(), 'lib/pseo/city-data/cities.ts');
const ARRAY_OPEN = 'export const CITIES: CityData[] = [';

interface CityRecord {
  index: number;
  raw: string;
  name: string | null;
  stateCode: string | null;
  slug: string | null;
  nearbyCities: string[];
}

interface ParsedFile {
  header: string;
  tail: string;
  records: CityRecord[];
}

export function parseBlocks(text: string): ParsedFile {
  const start = text.indexOf(ARRAY_OPEN);
  if (start < 0) throw new Error(`Could not find "${ARRAY_OPEN}" in ${CITIES_PATH}`);
  const bodyStart = start + ARRAY_OPEN.length;
  const bodyEnd = text.indexOf('\n];', bodyStart);
  if (bodyEnd < 0) throw new Error('Could not find the end of the CITIES array');

  const blocks = text.slice(bodyStart, bodyEnd).match(/\{\n(?:.*\n)*?\s{2}\},/g) ?? [];
  if (blocks.length === 0) throw new Error('Parsed zero city records — the file format changed');

  const str = (block: string, key: string): string | null => {
    const match = block.match(new RegExp(`\\n\\s*${key}: "((?:[^"\\\\]|\\\\.)*)",`));
    return match ? match[1] : null;
  };
  const list = (block: string, key: string): string[] => {
    const match = block.match(new RegExp(`\\n\\s*${key}: \\[(.*)\\],`));
    if (!match) return [];
    const inner = match[1].trim();
    return inner ? inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '')) : [];
  };

  return {
    header: text.slice(0, bodyStart),
    tail: text.slice(bodyEnd),
    records: blocks.map((raw, index) => ({
      index,
      raw,
      name: str(raw, 'name'),
      stateCode: str(raw, 'stateCode'),
      slug: str(raw, 'slug'),
      nearbyCities: list(raw, 'nearbyCities'),
    })),
  };
}

export interface SlugRepair {
  name: string;
  stateCode: string;
  from: string;
  to: string;
}

/** A name the dead generator could not slugify without deleting a letter. */
function hasNonAscii(value: string): boolean {
  return /[^\u0000-\u007f]/.test(value);
}

/**
 * Records whose slug does not match the folded form of their own name. Restricted
 * to non-ASCII names on purpose — see the SCOPE note in the file header.
 */
export function findSlugRepairs(records: readonly CityRecord[]): SlugRepair[] {
  const taken = new Map<string, string>();
  for (const record of records) {
    if (record.slug) taken.set(record.slug, record.name ?? '(unnamed)');
  }

  const repairs: SlugRepair[] = [];
  for (const record of records) {
    const { name, stateCode, slug } = record;
    if (!name || !stateCode || !slug) continue;
    if (!hasNonAscii(name)) continue;
    const ideal = buildCityDatasetSlug(name, stateCode);
    if (!ideal || ideal === slug) continue;
    const holder = taken.get(ideal);
    if (holder !== undefined && holder !== name) {
      throw new Error(
        `Refusing to repair "${name}, ${stateCode}": target slug "${ideal}" is already held by "${holder}". ` +
          'Two cities cannot share a slug — resolve by hand before rerunning.',
      );
    }
    repairs.push({ name, stateCode, from: slug, to: ideal });
  }
  return repairs;
}

/**
 * Rewrite the `slug:` line of every repaired record, then rewrite every
 * `nearbyCities` entry anywhere in the file that pointed at an old slug.
 */
export function applyRepairs(
  records: readonly CityRecord[],
  repairs: readonly SlugRepair[],
): Map<number, string> {
  const bySlug = new Map(repairs.map((r) => [r.from, r.to]));
  const rewritten = new Map<number, string>();

  for (const record of records) {
    let next = record.raw;

    const own = record.slug ? bySlug.get(record.slug) : undefined;
    if (own !== undefined) {
      next = next.replace(/\n(\s*)slug: "[^"]*",/, `\n$1slug: "${own}",`);
    }

    if (record.nearbyCities.some((s) => bySlug.has(s))) {
      const remapped = record.nearbyCities.map((s) => bySlug.get(s) ?? s);
      next = next.replace(
        /\n(\s*)nearbyCities: \[[^\n]*\],/,
        `\n$1nearbyCities: [${remapped.map((s) => `"${s}"`).join(',')}],`,
      );
    }

    if (next !== record.raw) rewritten.set(record.index, next);
  }

  return rewritten;
}

export function serialize(parsed: ParsedFile, rewritten: Map<number, string>, crlf: boolean): string {
  const body = parsed.records
    .map((record) => rewritten.get(record.index) ?? record.raw)
    .join('\n  ');
  const out = `${parsed.header}\n  ${body}${parsed.tail}`;
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

function main(): void {
  const checkOnly = process.argv.slice(2).includes('--check');
  const original = readFileSync(CITIES_PATH, 'utf8');
  const crlf = original.includes('\r\n');
  const parsed = parseBlocks(original.replace(/\r\n/g, '\n'));

  const repairs = findSlugRepairs(parsed.records);
  if (repairs.length === 0) {
    console.log(`OK — all ${parsed.records.length} records already carry the folded slug.`);
    return;
  }

  for (const repair of repairs) {
    console.log(`${repair.name}, ${repair.stateCode}: ${repair.from} → ${repair.to}`);
  }

  if (checkOnly) {
    console.error(
      `\n${repairs.length} record(s) still carry a diacritic-mangled slug. Rerun without --check.`,
    );
    process.exit(1);
  }

  const rewritten = applyRepairs(parsed.records, repairs);
  const next = serialize(parsed, rewritten, crlf);
  if (next === original) throw new Error('Computed repairs but the serialized file is unchanged');
  writeFileSync(CITIES_PATH, next, 'utf8');

  const referrers = rewritten.size - repairs.length;
  console.log(
    `\nRewrote ${repairs.length} slug(s) and ${referrers} referring record(s) in ${CITIES_PATH}.\n` +
      'NEXT: regenerate the edge allowlist (scripts/generate-city-slugs-edge.ts) and add a 301 ' +
      'for each old slug in next.config.ts.',
  );
}

if (require.main === module) main();

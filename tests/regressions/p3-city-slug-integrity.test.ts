/**
 * P3 #9 regression pins — city-slug integrity (the NARROW fix).
 *
 * Three things shipped broken and are pinned here:
 *
 *  1. THE SLUGIFIER. The dead generator behind lib/pseo/city-data/cities.ts
 *     stripped everything outside [a-z0-9] with no Unicode folding first, so a
 *     diacritic was DELETED rather than transliterated:
 *       La Cañada Flintridge → la-caada-flintridge-ca
 *       Cañon City           → caon-co
 *       Española             → espaola-nm
 *     lib/pseo/city-data/slugify.ts folds FIRST; these tests pin the order,
 *     because folding after the strip is a silent no-op — exactly how the bug
 *     arose — and a unit test that only checks the happy string would pass on a
 *     re-broken implementation.
 *
 *  2. THE 404 LINKS. /jobs/city/[slug] never looks a slug up: it rebuilds a city
 *     NAME out of it and matches that against the DB `city` column. So 210 of the
 *     4,135 dataset slugs, and every DB-derived slug for a punctuated name, point
 *     at a hard 404. P2 built `cityLinkResolves` for exactly this; these pins hold
 *     every remaining city-link site to it.
 *
 *  3. THE NON-MIGRATION. The other 117 dataset slugs that differ from the
 *     keyword-complete ideal (dropped trailing "City"/"Village"/"Town", collapsed
 *     punctuation) are deliberately NOT renamed — that is a ~5,400-URL migration
 *     with a 301 map, three DB tables and 735 nearbyCities rewrites. Nothing here
 *     asserts they stay unrenamed either; the invariants below are written so they
 *     keep holding if that migration is ever run properly.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { CITY_SLUGS, isKnownCitySlug } from '@/lib/pseo/city-data/city-slugs-edge';
import {
  buildCityDatasetSlug,
  foldDiacritics,
  slugifyCityName,
} from '@/lib/pseo/city-data/slugify';
import { buildCitySlug, cityLinkResolves } from '@/app/jobs/locations/[state]/directory';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Source with block and line comments removed — prose about a shape is not the shape. */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The three records the narrow fix repaired: [name, stateCode, oldSlug, newSlug]. */
const REPAIRED = [
  ['La Cañada Flintridge', 'CA', 'la-caada-flintridge-ca', 'la-canada-flintridge-ca'],
  ['Cañon City', 'CO', 'caon-co', 'canon-city-co'],
  ['Española', 'NM', 'espaola-nm', 'espanola-nm'],
] as const;

// ─── 1. the slugifier ───────────────────────────────────────────────────────

describe('P3 #9: the dataset slugifier transliterates diacritics', () => {
  it.each([
    ['ñ', 'Española', 'espanola'],
    ['ñ (mid-word, multi-word name)', 'La Cañada Flintridge', 'la-canada-flintridge'],
    ['ç', 'Curaçao', 'curacao'],
    ['é', 'Beaufré', 'beaufre'],
    ['ü', 'Zürich', 'zurich'],
    ['å', 'Åsnes', 'asnes'],
    ['ø (no combining mark to strip)', 'Nørre', 'norre'],
    ['æ (expands to two letters)', 'Æbeltoft', 'aebeltoft'],
  ])('%s: %s → %s', (_label, name, expected) => {
    expect(slugifyCityName(name)).toBe(expected);
  });

  it('folds BEFORE stripping non-alphanumerics — the actual bug', () => {
    // The broken order deletes the letter ("cañada" → "caada"); a naive
    // "replace non-alphanumerics with a hyphen" mangles it differently
    // ("ca-ada"). Neither is acceptable, so pin against both.
    const slug = slugifyCityName('Cañada');
    expect(slug).toBe('canada');
    expect(slug).not.toBe('caada');
    expect(slug).not.toBe('ca-ada');
    // foldDiacritics on its own must already be lossless, i.e. the fold does not
    // depend on the strip that follows it.
    expect(foldDiacritics('Cañada')).toBe('Canada');
    expect(foldDiacritics('Cañada')).toHaveLength('Cañada'.length);
  });

  it('produces the keyword-complete ideal form for the three repaired cities', () => {
    for (const [name, stateCode, oldSlug, newSlug] of REPAIRED) {
      expect(buildCityDatasetSlug(name, stateCode)).toBe(newSlug);
      expect(buildCityDatasetSlug(name, stateCode)).not.toBe(oldSlug);
    }
  });

  it('keeps the trailing noun that the deferred rename is about', () => {
    // Cañon City's ideal form is canon-city-co, not canon-co: the fix folds the
    // diacritic, it does not adopt the generator's other habit of eating the
    // trailing "City".
    expect(buildCityDatasetSlug('Cañon City', 'CO')).toBe('canon-city-co');
    expect(buildCityDatasetSlug('Oklahoma City', 'OK')).toBe('oklahoma-city-ok');
    expect(buildCityDatasetSlug('Elk Grove Village', 'IL')).toBe('elk-grove-village-il');
    expect(buildCityDatasetSlug('Mililani Town', 'HI')).toBe('mililani-town-hi');
  });

  it('returns empty rather than a half-formed slug', () => {
    expect(buildCityDatasetSlug('', 'CA')).toBe('');
    expect(buildCityDatasetSlug('///', 'CA')).toBe('');
    expect(buildCityDatasetSlug('Chicago', '')).toBe('');
  });
});

// ─── 2. no slug in the dataset carries a deleted-mark artifact ───────────────

/** Alphanumerics only, diacritics folded — the letters a slug is allowed to use. */
const letters = (value: string) => foldDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

const bigrams = (value: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i + 1 < value.length; i += 1) out.push(value.slice(i, i + 2));
  return out;
};

/**
 * Letter pairs a slug asserts that its own name does not contain.
 *
 * Deleting a character welds its neighbours together, creating an adjacency that
 * exists nowhere in the real name: "cañada" → "caada" invents "aa", "cañon" →
 * "caon" invents "ao". Comparing per hyphen-separated segment is what keeps this
 * from firing on the DEFERRED mismatches — dropping a whole word ("Oklahoma City"
 * → oklahoma-ok) removes segments but never welds letters inside one.
 *
 * A blunter "no doubled vowel" regex was rejected: it both misses espaola (no
 * doubled letter at all) and false-positives on real names like Kaanapali.
 */
const weldedBigrams = (name: string, stateCode: string, slug: string): string[] => {
  const nameLetters = letters(name);
  const codeLetters = letters(stateCode);
  const allowed = new Set([
    ...bigrams(nameLetters),
    ...bigrams(codeLetters),
    ...bigrams(nameLetters + codeLetters),
  ]);
  return slug
    .split('-')
    .flatMap((segment) => bigrams(segment))
    .filter((bigram) => !allowed.has(bigram));
};

describe('P3 #9: no CITIES slug carries a deleted-diacritic artifact', () => {
  it('the dataset is the size the audit measured, so the sweeps below are real', () => {
    expect(CITIES.length).toBe(4135);
    expect(new Set(CITIES.map((c) => c.slug)).size).toBe(CITIES.length);
  });

  it('none of the three garbled slugs survives anywhere in the dataset', () => {
    const slugs = new Set(CITIES.map((c) => c.slug));
    const referenced = new Set(CITIES.flatMap((c) => c.nearbyCities));
    for (const [, , oldSlug, newSlug] of REPAIRED) {
      expect(slugs.has(oldSlug), `${oldSlug} must not be a city slug`).toBe(false);
      // A stale nearbyCities reference resolves through getCityBySlug and
      // silently drops the whole nearby-cities module on the referring page.
      expect(referenced.has(oldSlug), `${oldSlug} must not be referenced as a nearby city`).toBe(false);
      expect(slugs.has(newSlug), `${newSlug} must be the repaired slug`).toBe(true);
    }
  });

  it('every record whose NAME carries a diacritic holds the folded slug', () => {
    const nonAscii = CITIES.filter((c) => /[\u0080-\uffff]/.test(c.name));
    // Non-vacuity: the three repaired cities are the only non-ASCII names, and if
    // a future dataset import adds more this assertion must still see them.
    expect(nonAscii.length).toBeGreaterThanOrEqual(3);
    for (const city of nonAscii) {
      expect(city.slug, `${city.name}, ${city.stateCode}`).toBe(
        buildCityDatasetSlug(city.name, city.stateCode),
      );
    }
  });

  it('no slug welds letters together that its own name does not contain', () => {
    const offenders = CITIES.map((c) => ({ city: c, welded: weldedBigrams(c.name, c.stateCode, c.slug) }))
      .filter((row) => row.welded.length > 0)
      .map((row) => `${row.city.name}, ${row.city.stateCode} (${row.city.slug}): ${row.welded.join(',')}`);
    expect(offenders).toEqual([]);
  });

  it('and that sweep is not vacuous — it flags each pre-fix slug', () => {
    expect(weldedBigrams('La Cañada Flintridge', 'CA', 'la-caada-flintridge-ca')).toContain('aa');
    expect(weldedBigrams('Cañon City', 'CO', 'caon-co')).toContain('ao');
    expect(weldedBigrams('Española', 'NM', 'espaola-nm')).toContain('ao');
    // …and does NOT flag the deferred trailing-noun / punctuation mismatches,
    // which this wave deliberately left alone.
    expect(weldedBigrams('Oklahoma City', 'OK', 'oklahoma-ok')).toEqual([]);
    expect(weldedBigrams("O'Fallon", 'MO', 'ofallon-mo')).toEqual([]);
    expect(weldedBigrams("Coeur d'Alene", 'ID', 'coeur-dalene-id')).toEqual([]);
    expect(weldedBigrams('Elk Grove Village', 'IL', 'elk-grove-il')).toEqual([]);
  });

  it('every slug is URL-clean: [a-z0-9-], no doubled or edge hyphens', () => {
    expect(CITIES.filter((c) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.slug)).map((c) => c.slug)).toEqual([]);
  });

  it('the repair is reproducible by script, not by hand', () => {
    // cities.ts forbids hand edits (its own header). The slug repair therefore
    // lives in a script with a --check mode, the same shape as the collision
    // repair next to it.
    const script = read('scripts/repair-city-slug-diacritics.ts');
    expect(script).toContain("from '@/lib/pseo/city-data/slugify'");
    expect(script).toContain('--check');
    // It must rewrite referring nearbyCities arrays too, or the dataset ends up
    // internally inconsistent.
    expect(script).toContain('nearbyCities');
  });
});

// ─── 3. the middleware allowlist agrees with the dataset ────────────────────

describe('P3 #9: CITIES and the edge allowlist stay in lockstep', () => {
  it('the edge set is exactly the dataset slug set', () => {
    // Duplicated from pseo-consistency-city-slugs-drift.test.ts on purpose: a
    // slug repair that skips scripts/generate-city-slugs-edge.ts makes
    // middleware.ts 410 the repaired URL, which is worse than the garbled slug.
    expect([...CITY_SLUGS].sort()).toEqual([...new Set(CITIES.map((c) => c.slug))].sort());
  });

  it('admits the repaired slugs and rejects the garbled ones', () => {
    for (const [, , oldSlug, newSlug] of REPAIRED) {
      expect(isKnownCitySlug(newSlug), `${newSlug} must be routable`).toBe(true);
      expect(isKnownCitySlug(oldSlug), `${oldSlug} must be gone from the allowlist`).toBe(false);
    }
  });

  it('each garbled slug 301s to its repaired form, category × city only', () => {
    const config = readCode('next.config.ts');
    for (const [, , oldSlug, newSlug] of REPAIRED) {
      // The old URL now 410s at the middleware (it left the allowlist above), so
      // without a redirect any indexed copy loses its equity instead of passing
      // it on. We cannot know whether these three have traffic, which is exactly
      // why the redirect is mandatory.
      const redirect = new RegExp(
        `source: '/jobs/:category/city/${oldSlug}',\\s*destination: '/jobs/:category/city/${newSlug}',\\s*permanent: true`,
      );
      expect(config, `missing 301 for ${oldSlug}`).toMatch(redirect);
      // The GENERIC route must NOT be redirected: it resolves by re-parsing the
      // slug into a city name against the DB, so it 404s for the old AND the new
      // spelling — and 301-ing a 404 onto another 404 is the one irreversible
      // version of this mistake.
      expect(config).not.toContain(`source: '/jobs/city/${oldSlug}'`);
    }
  });
});

// ─── 4. every city link goes through the resolution guard ───────────────────

describe('P3 #9: city links are gated on actually resolving', () => {
  it('the category × city template routes its "All {city} Jobs" CTA through the guard', () => {
    const src = readCode('lib/pseo/category-city-template.tsx');
    expect(src).toContain("from '@/app/jobs/locations/[state]/directory'");
    expect(src).toContain('cityLinkResolves(city!.name, city!.stateCode)');
    expect(src).toContain('buildCitySlug(city!.name, city!.stateCode)');
    // REGRESSION: the link used to be `/jobs/city/${citySlug}` — the DATASET
    // slug, which that route never reads. Every category×city page for the 210
    // non-round-tripping cities carried an outbound link to a hard 404.
    expect(src).not.toContain('/jobs/city/${citySlug}');
    // …and it is conditionally rendered, not merely computed.
    expect(src).toMatch(/\{allCityJobsHref && \(/);
  });

  it.each([
    'app/jobs/state/[state]/page.tsx',
    'app/jobs/locations/page.tsx',
    'app/jobs/locations/[state]/page.tsx',
    'app/jobs/city/[slug]/page.tsx',
    'app/jobs/[slug]/page.tsx',
    'app/salary-guide/[state]/page.tsx',
    'app/sitemap.ts',
  ])('%s gates its city URLs on cityLinkResolves', (rel) => {
    expect(readCode(rel)).toContain('cityLinkResolves');
  });

  it('no surface builds a /jobs/city URL without importing the guard', () => {
    // Drift guard for files that do not exist yet. Any module that constructs a
    // /jobs/city/<something> URL from a name or a dataset slug has to reason
    // about the round-trip; the only way to do that is this guard.
    const roots = ['lib/pseo', 'app/jobs', 'components'];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name)) files.push(rel);
      }
    };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(50);

    const unguarded = files.filter((rel) => {
      const code = readCode(rel);
      // Interpolated /jobs/city/<expr> links only — a literal path is a fixed,
      // verifiable URL and needs no round-trip reasoning.
      if (!/\/jobs\/city\/\$\{/.test(code)) return false;
      return !code.includes('cityLinkResolves');
    });
    expect(unguarded).toEqual([]);
  });

  it('repairing the DATASET slug does not make these cities route-linkable', () => {
    // The two slug spaces are different: the repaired dataset slug keys
    // /jobs/<category>/city/<slug> (getCityBySlug), while /jobs/city/<slug>
    // round-trips through the DB name — and "La Cañada Flintridge" still does
    // not survive that round-trip, diacritic folded or not. Anyone tempted to
    // "finish the job" by pointing route links at dataset slugs should fail here.
    for (const [name, stateCode] of REPAIRED) {
      expect(cityLinkResolves(name, stateCode), `${name} must not be route-linkable`).toBe(false);
    }
    expect(buildCitySlug('La Cañada Flintridge', 'CA')).not.toBe('la-canada-flintridge-ca');
  });
});

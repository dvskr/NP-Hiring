/**
 * lib/pseo/city-data/slugify.ts — the canonical slug builder for the CITY
 * DATASET (lib/pseo/city-data/cities.ts).
 *
 * WHY THIS EXISTS
 * ───────────────
 * The generator that produced cities.ts is gone (see the file header there),
 * and it slugified names by deleting every character outside [a-z0-9] — with no
 * Unicode folding first. Diacritics are not ASCII, so they were DELETED rather
 * than transliterated, and three records shipped nonsense slugs:
 *
 *   La Cañada Flintridge, CA → "la-caada-flintridge-ca"   (ñ vanished)
 *   Cañon City, CO           → "caon-co"
 *   Española, NM             → "espaola-nm"
 *
 * Those are broken strings, not a naming preference: nothing on the site or in
 * a search result can read them back as a place name.
 *
 * THE FIX, AND WHY THE ORDER MATTERS
 * ──────────────────────────────────
 * Fold to ASCII FIRST (NFD-decompose, drop the combining marks, then expand the
 * handful of Latin letters that carry no separable mark), and only THEN collapse
 * what is left to [a-z0-9-]. Folding after the strip is a no-op, which is exactly
 * how the original bug arose.
 *
 * WHAT THIS IS NOT
 * ────────────────
 * 1. It is NOT the route-shaped city slug builder. `/jobs/city/[slug]` rebuilds a
 *    city NAME out of its slug and matches that against the DB `city` column, so
 *    its builder must stay byte-identical to its own parser — that pair lives in
 *    `buildCitySlug` / `parseCitySlugToName` (app/jobs/locations/[state]/directory.ts)
 *    and deliberately does NOT fold, because folding would not help a lookup that
 *    compares against the unfolded stored name. Do not swap one for the other.
 * 2. It does not touch the OTHER 117 dataset slugs that differ from the ideal
 *    form (trailing "City"/"Village"/"Town" dropped, punctuation collapsed).
 *    Renaming those is a ~5,400-URL migration that was explicitly deferred; this
 *    module only makes the ideal form computable so that migration is mechanical
 *    when it is actually wanted.
 */

/**
 * Latin letters with no decomposable combining mark — NFD leaves them intact,
 * so they need an explicit expansion or they would be deleted like the ñ was.
 */
const NON_DECOMPOSING_FOLD: Readonly<Record<string, string>> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ı: 'i',
  ŋ: 'n',
  ħ: 'h',
  ŧ: 't',
};

const NON_DECOMPOSING_RE = new RegExp(`[${Object.keys(NON_DECOMPOSING_FOLD).join('')}]`, 'gi');

/**
 * ASCII fold: "Española" → "Espanola", "Cañon" → "Canon", "Ærø" → "Aeroe".
 * Case is preserved so the result is still readable as a name.
 */
export function foldDiacritics(value: string): string {
  return value
    .normalize('NFD')
    // Unicode combining marks — the accents NFD just split off. Written as
    // escapes on purpose: the literal range is invisible in an editor and
    // survives a copy/paste round-trip badly.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(NON_DECOMPOSING_RE, (char) => {
      const folded = NON_DECOMPOSING_FOLD[char.toLowerCase()] ?? char;
      return char === char.toLowerCase() ? folded : folded.toUpperCase();
    });
}

/**
 * The city half of a dataset slug. Folds first, then collapses runs of
 * non-alphanumerics to single hyphens and trims them from both ends.
 *
 * Trailing nouns are PRESERVED ("Cañon City" → "canon-city"): the keyword-complete
 * form is `slugifyCityName(name)-<stateCode>`.
 */
export function slugifyCityName(name: string): string {
  return foldDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The full dataset slug for a (name, stateCode) pair — the form
 * `CityData.slug` is supposed to hold. Returns '' when either half is empty,
 * so callers can reject rather than emit a half-formed slug.
 */
export function buildCityDatasetSlug(name: string, stateCode: string): string {
  const city = slugifyCityName(name);
  const code = slugifyCityName(stateCode);
  if (!city || !code) return '';
  return `${city}-${code}`;
}

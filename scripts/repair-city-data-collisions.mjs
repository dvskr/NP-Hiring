/**
 * scripts/repair-city-data-collisions.mjs — P1 #9
 *
 * WHY THIS EXISTS
 * ───────────────
 * lib/pseo/city-data/cities.ts was produced by a generator (long gone; its
 * source dataset is not in the repo) that looked geography up by CITY NAME
 * ALONE. Every same-named city therefore inherited the geo bundle of whichever
 * city won that key:
 *
 *   portland-me  → lat/lng 45.5152,-122.6784      (Portland, OREGON)
 *                  metroArea "Portland-Vancouver-Hillsboro"
 *                  healthcareSystems ["OHSU", "Legacy Health", …]
 *   auburn-me    → metroArea "Seattle-Tacoma-Bellevue"
 *                  healthcareSystems ["UW Medicine", "MultiCare", …]
 *
 * Those pages state another state's metro and another state's hospital systems
 * as local fact, and — where the coordinates were copied too — cross-link to
 * that other state's suburbs as "nearby cities".
 *
 * The original source data is unavailable, so the true values cannot be
 * restored. This script does the next best thing: it finds the records that are
 * PROVABLY holding another state's data and nulls those fields, so the pages
 * render honestly. The template already omits an empty metro / employer /
 * nearby block, so nothing is padded to fill the hole.
 *
 * DETECTION — two independent proofs, nothing guessed
 * ───────────────────────────────────────────────────
 * A. COPIED COORDINATE BUNDLE
 *    1. Cluster records by their exact (lat, lng) pair.
 *    2. Keep clusters spanning more than one state — two different states
 *       cannot share a coordinate except by copying.
 *    3. The OWNER is the single member whose own state actually contains that
 *       coordinate (STATE_BBOX below). Everyone else holds the owner's bundle:
 *       lat, lng, metroArea → null; healthcareSystems, nearbyCities → []
 *       (the neighbour list was computed FROM the copied position, so all of
 *       it is untrustworthy).
 *    4. Zero or several in-state members ⇒ AMBIGUOUS ⇒ the cluster is left
 *       completely alone. Kansas City MO / Kansas City KS land here: adjacent,
 *       genuinely one metro, both in-bbox. We never delete what we can't
 *       disprove.
 *    5. Every remaining record drops nearbyCities entries pointing AT a record
 *       repaired in step 3 — those links were computed from a false position.
 *
 * B. COPIED METRO / EMPLOYER BUNDLE (coordinates were not copied)
 *    For each distinct metroArea value (and, separately, each distinct
 *    healthcareSystems array):
 *    1. carriers = every record holding that value.
 *    2. core     = the carrier state with the most carriers (deterministic
 *                  tie-break) — the state the metro is anchored in. A record
 *                  in `core` is never touched.
 *    3. TWIN     = a carrier whose NAME is also carried, for the same value, by
 *                  a record in another state. The dead generator keyed on name
 *                  alone, so a name appearing in two states under a
 *                  byte-identical bundle is a name-key copy BY CONSTRUCTION —
 *                  one of the two is the source row and the other inherited it.
 *                  A carrier that is not a twin cannot have arrived by name
 *                  collision, so it is never deleted.
 *    Which twin is the copy is then decided by evidence, strongest first:
 *
 *    TIER 1 — the metro's own title. US metro names are their principal cities
 *      hyphen-joined ("Detroit-Warren-Dearborn", "Baltimore-Columbia-Towson").
 *      Components that resolve to exactly one carrier state fix the metro's
 *      state set; an ambiguous component (two same-named carriers) is then
 *      owned by whichever candidate is already in that set — or, failing that,
 *      the single candidate bordering every state the title named, since a
 *      metro is a contiguous county group. Every other same-named carrier is
 *      the copy. This is what proves warren-oh, columbia-pa, newark-de,
 *      middletown-ny, ontario-or, franklin-ky and wilmington-oh, and what
 *      deliberately refuses to touch "Kansas City" (its only component is
 *      itself, carried by Kansas City MO *and* KS, so nothing is provable).
 *
 *    TIER 2 — an independent foothold. A state PROVES it belongs to the metro
 *      when it carries the value on at least one NON-twin record: that record
 *      cannot have been placed there by a name collision. A twin whose own
 *      state has no such record, while a twin's state does, is the copy
 *      (glendale-ca vs 12 Arizona carriers; shawnee-ok vs Kansas). Kansas City
 *      MO survives here too — independence-mo and lees-summit-mo are non-twin
 *      MO carriers, so Missouri's place in that metro is proven.
 *
 *    TIER 3 — the original far-state test, kept so this phase can only ever
 *      catch more than it used to: a carrier whose state neither is nor borders
 *      `core` (STATE_BBOX proximity, deliberately generous) but which has a
 *      same-named twin inside that set (auburn-me ↔ auburn-wa).
 *
 *    A record proven to be a copy on EITHER grouping loses BOTH fields: the
 *    generator emitted metroArea and healthcareSystems as one bundle, so they
 *    are removed as one bundle (this is what proves wilmington-ohio's Penn
 *    Medicine / Temple Health list, which its own grouping cannot disprove).
 *    Coordinates and nearbyCities are NOT touched in phase B: those records'
 *    coordinates are in their own state, so their neighbour lists stand.
 *
 * Both phases only ever DELETE. No value is invented, inferred, or moved
 * between records, and no city is back-filled to look fuller than it is.
 *
 * KEYED BY (name, stateCode)
 * ──────────────────────────
 * The repair is keyed on (name, stateCode) — never on name alone, which is the
 * bug — and cities.ts exports CITY_BY_NAME_STATE / getCityByNameState() so no
 * future consumer reintroduces a name-only lookup.
 * tests/regressions/p1-city-data-collisions.test.ts pins all of this.
 *
 * USAGE
 *   node scripts/repair-city-data-collisions.mjs            # write repairs
 *   node scripts/repair-city-data-collisions.mjs --check    # exit 1 if dirty
 *   node scripts/repair-city-data-collisions.mjs --dry-run  # report only
 *
 * After writing, regenerate the edge allowlist (this repair never changes the
 * slug set, but the drift guard expects them regenerated in lockstep):
 *   npx tsx scripts/generate-city-slugs-edge.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const CITIES_PATH = path.resolve(process.cwd(), 'lib/pseo/city-data/cities.ts');

/**
 * Approximate bounding boxes [minLat, maxLat, minLng, maxLng] for the 50
 * states + DC. These exist ONLY to answer "can this coordinate possibly be in
 * this state?" and "do these two states border each other?". They are never
 * rendered and never become page content. They deliberately over-cover each
 * state by a fraction of a degree, so a point failing its own box is nowhere
 * near that state rather than a border rounding case.
 */
export const STATE_BBOX = {
  AK: [51.0, 71.6, -179.9, -129.0],
  AL: [30.1, 35.1, -88.6, -84.8],
  AR: [32.9, 36.6, -94.7, -89.6],
  AZ: [31.2, 37.1, -114.9, -108.9],
  CA: [32.4, 42.1, -124.6, -114.0],
  CO: [36.9, 41.1, -109.2, -101.9],
  CT: [40.9, 42.1, -73.8, -71.7],
  DC: [38.7, 39.1, -77.2, -76.8],
  DE: [38.4, 39.9, -75.9, -74.9],
  FL: [24.4, 31.1, -87.7, -79.9],
  GA: [30.2, 35.1, -85.7, -80.7],
  HI: [18.8, 22.4, -160.4, -154.7],
  IA: [40.3, 43.6, -96.8, -90.0],
  ID: [41.9, 49.1, -117.3, -110.9],
  IL: [36.9, 42.6, -91.6, -87.0],
  IN: [37.7, 41.9, -88.2, -84.7],
  KS: [36.9, 40.1, -102.2, -94.5],
  KY: [36.4, 39.2, -89.7, -81.9],
  LA: [28.8, 33.1, -94.1, -88.7],
  MA: [41.1, 43.0, -73.6, -69.8],
  MD: [37.8, 39.8, -79.6, -74.9],
  ME: [42.9, 47.6, -71.2, -66.8],
  MI: [41.6, 48.4, -90.5, -82.0],
  MN: [43.4, 49.5, -97.4, -89.4],
  MO: [35.9, 40.7, -95.9, -89.0],
  MS: [30.1, 35.1, -91.8, -88.0],
  MT: [44.3, 49.1, -116.1, -103.9],
  NC: [33.7, 36.7, -84.4, -75.3],
  ND: [45.8, 49.1, -104.2, -96.4],
  NE: [39.9, 43.1, -104.2, -95.2],
  NH: [42.6, 45.4, -72.7, -70.6],
  NJ: [38.8, 41.4, -75.7, -73.8],
  NM: [31.2, 37.1, -109.2, -102.9],
  NV: [34.9, 42.1, -120.1, -113.9],
  NY: [40.4, 45.1, -79.9, -71.8],
  OH: [38.3, 42.4, -85.0, -80.4],
  OK: [33.5, 37.1, -103.1, -94.3],
  OR: [41.9, 46.4, -124.7, -116.4],
  PA: [39.6, 42.4, -80.6, -74.6],
  RI: [41.1, 42.1, -72.0, -71.0],
  SC: [32.0, 35.3, -83.5, -78.4],
  SD: [42.4, 46.0, -104.2, -96.3],
  TN: [34.9, 36.8, -90.4, -81.6],
  TX: [25.7, 36.6, -106.8, -93.4],
  UT: [36.9, 42.1, -114.2, -108.9],
  VA: [36.4, 39.6, -83.8, -75.1],
  VT: [42.6, 45.1, -73.5, -71.4],
  WA: [45.4, 49.1, -125.0, -116.8],
  WI: [42.4, 47.4, -93.0, -86.7],
  WV: [37.1, 40.7, -82.8, -77.6],
  WY: [40.9, 45.1, -111.2, -103.9],
};

/** true / false, or null when the coordinate or state code is unusable. */
export function isCoordInState(stateCode, lat, lng) {
  const box = STATE_BBOX[stateCode];
  if (!box || lat === null || lng === null) return null;
  return lat >= box[0] && lat <= box[1] && lng >= box[2] && lng <= box[3];
}

/**
 * Do the two states' (generous) boxes touch? Over-reports neighbours — which
 * is the safe direction: a state wrongly called a neighbour keeps its data.
 */
export function areStatesAdjacent(a, b) {
  const A = STATE_BBOX[a];
  const B = STATE_BBOX[b];
  if (!A || !B || a === b) return false;
  const latTouch = A[0] <= B[1] + 0.05 && B[0] <= A[1] + 0.05;
  const lngTouch = A[2] <= B[3] + 0.05 && B[2] <= A[3] + 0.05;
  return latTouch && lngTouch;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
// cities.ts is machine written with a fixed field order and one field per line,
// so a block scan is exact. Each record keeps its original text and only the
// specific repaired lines are rewritten — untouched records stay byte-identical.

const ARRAY_OPEN = 'export const CITIES: CityData[] = [';

export function parseBlocks(text) {
  const start = text.indexOf(ARRAY_OPEN);
  if (start < 0) throw new Error(`Could not find "${ARRAY_OPEN}" in ${CITIES_PATH}`);
  const bodyStart = start + ARRAY_OPEN.length;
  const bodyEnd = text.indexOf('\n];', bodyStart);
  if (bodyEnd < 0) throw new Error('Could not find the end of the CITIES array');

  const blocks = text.slice(bodyStart, bodyEnd).match(/\{\n(?:.*\n)*?\s{2}\},/g) || [];
  if (blocks.length === 0) throw new Error('Parsed zero city records — the file format changed');

  const str = (b, k) => {
    const m = b.match(new RegExp(`\\n\\s*${k}: "((?:[^"\\\\]|\\\\.)*)",`));
    return m ? m[1] : null;
  };
  const num = (b, k) => {
    const m = b.match(new RegExp(`\\n\\s*${k}: (-?[0-9.]+|null),`));
    return m && m[1] !== 'null' ? Number(m[1]) : null;
  };
  const list = (b, k) => {
    const m = b.match(new RegExp(`\\n\\s*${k}: \\[(.*)\\],`));
    if (!m) return [];
    const inner = m[1].trim();
    return inner ? inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '')) : [];
  };

  return {
    header: text.slice(0, bodyStart),
    tail: text.slice(bodyEnd),
    records: blocks.map((raw, index) => ({
      index,
      raw,
      name: str(raw, 'name'),
      state: str(raw, 'state'),
      stateCode: str(raw, 'stateCode'),
      slug: str(raw, 'slug'),
      lat: num(raw, 'lat'),
      lng: num(raw, 'lng'),
      metroArea: /\n\s*metroArea: null,/.test(raw) ? null : str(raw, 'metroArea'),
      healthcareSystems: list(raw, 'healthcareSystems'),
      nearbyCities: list(raw, 'nearbyCities'),
    })),
  };
}

// ─── Phase A: copied coordinate bundles ───────────────────────────────────────

export function findCoordCollisions(records) {
  const byCoord = new Map();
  for (const rec of records) {
    if (rec.lat === null || rec.lng === null) continue;
    const key = `${rec.lat},${rec.lng}`;
    if (!byCoord.has(key)) byCoord.set(key, []);
    byCoord.get(key).push(rec);
  }

  const resolved = [];
  const ambiguous = [];
  for (const [coords, members] of byCoord) {
    if (members.length < 2) continue;
    if (new Set(members.map((m) => m.stateCode)).size < 2) continue; // same state: no cross-state lie
    const owners = members.filter((m) => isCoordInState(m.stateCode, m.lat, m.lng) === true);
    if (owners.length === 1) {
      resolved.push({ coords, owner: owners[0], corrupted: members.filter((m) => m !== owners[0]) });
    } else {
      ambiguous.push({ coords, members });
    }
  }
  return { resolved, ambiguous };
}

// ─── Phase B: copied metro / employer bundles ─────────────────────────────────

/**
 * Which state owns each principal city named in a metro title?
 *
 * "Detroit-Warren-Dearborn" is not prose — it is the metro's principal cities
 * hyphen-joined, so the title itself says which Warren the bundle belongs to.
 * Components that resolve to a single carrier state pin the metro's state set;
 * an ambiguous component is then awarded to the candidate already inside that
 * set, or — since a metro is a contiguous group of counties — to the single
 * candidate bordering every state the title has already named.
 *
 * Returns only what it can settle. "Kansas City" has one component, carried by
 * Kansas City MO and Kansas City KS, so it settles nothing and both survive.
 *
 * `value` is the metroArea string and `carriers` the records holding it.
 * Returns a Map from lowercased city name to the owning state code.
 */
export function resolveTitleOwners(value, carriers) {
  const statesByName = new Map();
  for (const rec of carriers) {
    const key = rec.name.toLowerCase();
    if (!statesByName.has(key)) statesByName.set(key, new Set());
    statesByName.get(key).add(rec.stateCode);
  }

  // The whole title is a candidate too ("Kansas City", "St. Louis", "Richmond").
  const parts = [...new Set([value, ...value.split('-')].map((p) => p.trim().toLowerCase()))];
  const candidates = new Map();
  for (const part of parts) {
    const states = statesByName.get(part);
    if (states?.size) candidates.set(part, states);
  }

  const settled = new Map();
  const named = new Set();
  for (const [part, states] of candidates) {
    if (states.size !== 1) continue;
    const [state] = states;
    settled.set(part, state);
    named.add(state);
  }
  for (const [part, states] of candidates) {
    if (settled.has(part)) continue;
    const inNamed = [...states].filter((s) => named.has(s));
    if (inNamed.length === 1) {
      settled.set(part, inNamed[0]);
      continue;
    }
    // Two candidates both already named by the title, or nothing named at all:
    // unprovable, so the component is left unsettled and nobody is deleted.
    if (inNamed.length > 1 || named.size === 0) continue;
    const contiguous = [...states].filter((s) => [...named].every((n) => s === n || areStatesAdjacent(s, n)));
    if (contiguous.length === 1) settled.set(part, contiguous[0]);
  }
  return settled;
}

/**
 * `records` are the parsed city records; `valueOf` maps a record to its bundle
 * value or null when it carries none; `options.titleEvidence` mines the value
 * as a metro title (tier 1) and is only meaningful for metroArea, since a
 * healthcareSystems array names no cities.
 *
 * Returns `{ hits, skipped }` — `hits` a Map from slug to the copied value,
 * `skipped` human-readable lines for carriers left deliberately alone.
 */
export function findBundleCollisions(records, valueOf, { titleEvidence = false } = {}) {
  const groups = new Map();
  for (const rec of records) {
    const value = valueOf(rec);
    if (value === null) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(rec);
  }

  const hits = new Map();
  const skipped = [];
  for (const [value, carriers] of groups) {
    const counts = new Map();
    for (const rec of carriers) counts.set(rec.stateCode, (counts.get(rec.stateCode) ?? 0) + 1);
    if (counts.size < 2) continue;

    // Core = most carriers; ties broken on state code so the result is stable.
    // Either side of a tie is safe: tied states are both real carriers of the
    // metro and border each other, so they produce the same plausible set.
    const core = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

    // A name carried in more than one state, under a byte-identical bundle,
    // can only have got there through the generator's name key.
    const statesByName = new Map();
    for (const rec of carriers) {
      const key = rec.name.toLowerCase();
      if (!statesByName.has(key)) statesByName.set(key, new Set());
      statesByName.get(key).add(rec.stateCode);
    }
    const isTwin = (rec) => statesByName.get(rec.name.toLowerCase()).size > 1;

    // A state proves it really is part of this metro by carrying the value on a
    // record no name collision can explain.
    const proven = new Set(carriers.filter((rec) => !isTwin(rec)).map((rec) => rec.stateCode));
    proven.add(core);

    const titleOwner = titleEvidence ? resolveTitleOwners(value, carriers) : new Map();

    // Tier 3 (the original test), kept so this phase can only widen.
    const plausible = new Set([core, ...[...counts.keys()].filter((s) => areStatesAdjacent(s, core))]);
    const plausibleNames = new Set(
      carriers.filter((c) => plausible.has(c.stateCode)).map((c) => c.name.toLowerCase()),
    );

    for (const rec of carriers) {
      if (rec.stateCode === core) continue; // the metro's home state owns its own data
      const nameKey = rec.name.toLowerCase();

      if (isTwin(rec)) {
        // Tier 1 — the metro title names this city and says which state's it is.
        const owner = titleOwner.get(nameKey);
        if (owner) {
          if (owner !== rec.stateCode) hits.set(rec.slug, value);
          continue;
        }
        // Tier 2 — no independent foothold here, but a twin's state has one.
        if (!proven.has(rec.stateCode)) {
          const twinProven = [...statesByName.get(nameKey)].some((s) => s !== rec.stateCode && proven.has(s));
          if (twinProven) {
            hits.set(rec.slug, value);
            continue;
          }
        }
      }

      // Tier 3 — far from core, with a same-named twin inside the metro.
      if (plausible.has(rec.stateCode)) continue;
      if (!plausibleNames.has(nameKey)) {
        // Far-away carrier with no same-named twin inside the metro: suspicious
        // but not proven a name-key copy, so it is left alone and reported.
        skipped.push(`${rec.slug} (no twin in ${[...plausible].join('/')}) :: ${value.slice(0, 60)}`);
        continue;
      }
      hits.set(rec.slug, value);
    }
  }
  return { hits, skipped };
}

// ─── Repair ───────────────────────────────────────────────────────────────────

const setNull = (raw, field) => raw.replace(new RegExp(`\\n(\\s*)${field}: [^\\n]*,`), `\n$1${field}: null,`);
const setEmpty = (raw, field) => raw.replace(new RegExp(`\\n(\\s*)${field}: \\[[^\\n]*\\],`), `\n$1${field}: [],`);
const setNearby = (raw, slugs) =>
  raw.replace(/\n(\s*)nearbyCities: \[[^\n]*\],/, `\n$1nearbyCities: [${slugs.map((s) => `"${s}"`).join(',')}],`);

export function buildRepair(parsed) {
  const { records } = parsed;
  const coord = findCoordCollisions(records);
  const metro = findBundleCollisions(records, (r) => r.metroArea, { titleEvidence: true });
  const systems = findBundleCollisions(records, (r) =>
    r.healthcareSystems.length ? JSON.stringify(r.healthcareSystems) : null,
  );
  // The generator emitted metroArea and healthcareSystems as ONE bundle, so a
  // record proven to be a copy on either grouping loses both fields. Without
  // this, wilmington-oh would drop Philadelphia's metro but keep Philadelphia's
  // Penn Medicine / Temple Health chips, which its own grouping cannot
  // disprove (Wilmington DE is that array's only other carrier).
  const copiedBundle = new Set([...metro.hits.keys(), ...systems.hits.keys()]);

  // Keyed by (name, stateCode) — never by name alone, which is the bug.
  const coordCorrupted = new Set();
  const coordCorruptedSlugs = new Set();
  for (const cluster of coord.resolved) {
    for (const rec of cluster.corrupted) {
      coordCorrupted.add(`${rec.name}|${rec.stateCode}`);
      coordCorruptedSlugs.add(rec.slug);
    }
  }

  const stats = { coordNulled: 0, metroNulled: 0, systemsNulled: 0, linksDropped: 0 };
  const rewritten = records.map((rec) => {
    // Phase A — the whole geo bundle came from another state.
    if (coordCorrupted.has(`${rec.name}|${rec.stateCode}`)) {
      stats.coordNulled += 1;
      stats.linksDropped += rec.nearbyCities.length;
      let raw = setNull(rec.raw, 'lat');
      raw = setNull(raw, 'lng');
      raw = setNull(raw, 'metroArea');
      raw = setEmpty(raw, 'healthcareSystems');
      raw = setEmpty(raw, 'nearbyCities');
      return { ...rec, raw };
    }

    let raw = rec.raw;
    // Phase B — the bundle came from a same-named city in another metro.
    if (copiedBundle.has(rec.slug)) {
      if (rec.metroArea !== null) {
        stats.metroNulled += 1;
        raw = setNull(raw, 'metroArea');
      }
      if (rec.healthcareSystems.length > 0) {
        stats.systemsNulled += 1;
        raw = setEmpty(raw, 'healthcareSystems');
      }
    }
    // Phase A fallout — links computed from a position we just deleted.
    const kept = rec.nearbyCities.filter((slug) => !coordCorruptedSlugs.has(slug));
    if (kept.length !== rec.nearbyCities.length) {
      stats.linksDropped += rec.nearbyCities.length - kept.length;
      raw = setNearby(raw, kept);
    }
    return raw === rec.raw ? rec : { ...rec, raw };
  });

  return { rewritten, coord, metro, systems, copiedBundle, stats };
}

export function serialize(parsed, rewritten, crlf) {
  const out = `${parsed.header}${rewritten.map((r) => `\n  ${r.raw}`).join('')}${parsed.tail}`;
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has('--check');
  const dryRun = args.has('--dry-run');

  const raw = fs.readFileSync(CITIES_PATH, 'utf8');
  const crlf = raw.includes('\r\n');
  const parsed = parseBlocks(raw.replace(/\r\n/g, '\n'));
  const repair = buildRepair(parsed);
  const next = serialize(parsed, repair.rewritten, crlf);
  const dirty = next !== raw;

  const log = console.log;
  log(`records:                          ${parsed.records.length}`);
  log(`A. cross-state coord clusters:    ${repair.coord.resolved.length} resolved, ${repair.coord.ambiguous.length} ambiguous (untouched)`);
  log(`A. full geo bundles nulled:       ${repair.stats.coordNulled}`);
  log(`A. nearby links dropped:          ${repair.stats.linksDropped}`);
  log(`B. metroArea nulled:              ${repair.stats.metroNulled}`);
  log(`B. healthcareSystems nulled:      ${repair.stats.systemsNulled}`);
  for (const cluster of repair.coord.resolved) {
    log(`   ${cluster.owner.slug} owns ${cluster.coords} → ${cluster.corrupted.map((c) => c.slug).join(', ')}`);
  }
  for (const cluster of repair.coord.ambiguous) {
    log(`   AMBIGUOUS ${cluster.coords}: ${cluster.members.map((m) => m.slug).join(', ')} — untouched`);
  }
  for (const slug of [...repair.copiedBundle].sort()) {
    log(`   COPY ${slug} :: ${(repair.metro.hits.get(slug) ?? repair.systems.hits.get(slug) ?? '').slice(0, 70)}`);
  }
  for (const line of [...repair.metro.skipped, ...repair.systems.skipped]) log(`   SKIPPED ${line}`);

  if (checkOnly) {
    if (dirty) {
      log('\n--check: cities.ts still holds repairable cross-state data. Run without --check.');
      process.exit(1);
    }
    log('\n--check: clean.');
    return;
  }
  if (dryRun) {
    log(`\n--dry-run: ${dirty ? 'repairs pending' : 'nothing to do'} (no write).`);
    return;
  }
  if (!dirty) {
    log('\nNothing to repair — cities.ts already clean.');
    return;
  }
  fs.writeFileSync(CITIES_PATH, next, 'utf8');
  log(`\nWrote ${CITIES_PATH}`);
  log('Now run: npx tsx scripts/generate-city-slugs-edge.ts');
}

if (process.argv[1]?.endsWith('repair-city-data-collisions.mjs')) main();

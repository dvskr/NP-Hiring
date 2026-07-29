/**
 * P1 #9 — same-named cities must never serve another state's facts.
 *
 * lib/pseo/city-data/cities.ts came from a generator that keyed geography by
 * CITY NAME ALONE, so Portland, Maine shipped Portland, Oregon's coordinates,
 * metro area, hospital systems and "nearby cities", and Auburn, Maine shipped
 * Seattle's. scripts/repair-city-data-collisions.mjs removed every value it
 * could prove was copied. These tests pin the result so a regeneration or a
 * hand edit can't quietly put the cross-state claims back.
 *
 * The rules asserted here are deletion-only: a repaired record has a hole, and
 * a hole is correct. Nothing may be back-filled with an estimate.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CITIES,
  CITY_BY_NAME_STATE,
  getCityBySlug,
  getCityByNameState,
} from '@/lib/pseo/city-data/cities';

const ROOT = process.cwd();

/**
 * Kansas City, MO and Kansas City, KS sit on opposite banks of the same river,
 * share one Census metro, and are both inside their own state — nothing about
 * their shared record can be disproved, so the repair deliberately left them
 * alone. Every other cross-state overlap must be gone.
 */
const ADJACENT_TWIN_PAIR = ['kansas-ks', 'kansas-mo'] as const;
const isAdjacentTwinPair = (slugs: readonly string[]) =>
  [...slugs].sort().join(',') === [...ADJACENT_TWIN_PAIR].sort().join(',');

describe('#9: the audited records no longer carry another state\'s data', () => {
  it('portland-me holds no Oregon coordinates, metro, employers or neighbours', () => {
    const portlandMe = getCityBySlug('portland-me');
    expect(portlandMe).toBeDefined();
    expect(portlandMe!.state).toBe('Maine');
    // Was 45.5152,-122.6784 — downtown Portland, OREGON.
    expect(portlandMe!.lat).toBeNull();
    expect(portlandMe!.lng).toBeNull();
    // Was "Portland-Vancouver-Hillsboro".
    expect(portlandMe!.metroArea).toBeNull();
    // Was ["OHSU", "Providence", "Legacy Health", …] — all Oregon systems.
    expect(portlandMe!.healthcareSystems).toEqual([]);
    // Was ["portland-or","portland-tx","portland-tn","salem-or","ontario-or", …].
    expect(portlandMe!.nearbyCities).toEqual([]);
  });

  it('portland-or keeps its own data and stops linking to its namesakes', () => {
    const portlandOr = getCityBySlug('portland-or');
    expect(portlandOr).toBeDefined();
    expect(portlandOr!.metroArea).toBe('Portland-Vancouver-Hillsboro');
    expect(portlandOr!.healthcareSystems.length).toBeGreaterThan(0);
    expect(portlandOr!.nearbyCities).not.toContain('portland-me');
    expect(portlandOr!.nearbyCities.every((slug) => slug.endsWith('-or'))).toBe(true);
  });

  it('metro/employer bundles copied by name are gone even where coordinates were not copied', () => {
    for (const slug of ['auburn-me', 'evanston-wy', 'lebanon-nh', 'arlington-tx']) {
      const city = getCityBySlug(slug);
      expect(city, `${slug} missing from CITIES`).toBeDefined();
      // e.g. auburn-me held "Seattle-Tacoma-Bellevue" + UW Medicine/MultiCare.
      expect(city!.metroArea, `${slug} still carries a metro area`).toBeNull();
      expect(city!.healthcareSystems, `${slug} still carries employers`).toEqual([]);
    }
  });

  /**
   * The first pass only deleted a twin whose state was far from the metro's
   * core, so every copy sitting in a merely-BORDERING state survived —
   * glendale-ca kept publishing "Phoenix-Mesa-Chandler" and Mayo Clinic
   * Arizona, wilmington-oh kept Penn Medicine and Temple Health. Those values
   * render as the visible "Metro:" line and the healthcare chips AND feed FAQ
   * answer #4, which is the single source array behind the FAQPage JSON-LD, so
   * the false claim shipped as structured data too.
   */
  it('a copy in a bordering state is gone too — the metro named the owner all along', () => {
    const copies: Record<string, string> = {
      'glendale-ca': 'Phoenix-Mesa-Chandler / Mayo Clinic Arizona',
      'redmond-or': 'Seattle-Tacoma-Bellevue / UW Medicine',
      'wilmington-oh': 'Philadelphia-Camden-Wilmington / Penn Medicine',
      'warren-oh': 'Detroit-Warren-Dearborn / Henry Ford Health',
      'troy-oh': 'Detroit-Warren-Dearborn / Henry Ford Health',
      'troy-il': 'Detroit-Warren-Dearborn / Henry Ford Health',
      'pontiac-il': 'Detroit-Warren-Dearborn / Henry Ford Health',
      'chester-pa': 'Richmond / HCA Virginia',
      'columbia-pa': 'Baltimore-Columbia-Towson / University of Maryland Medical System',
      'newark-de': 'New York-Newark-Jersey City / NewYork-Presbyterian',
      'shawnee-ok': 'Kansas City / University of Kansas Health System',
      'brookfield-il': 'Milwaukee-Waukesha / Ascension Wisconsin',
      'holly-springs-ga': 'Raleigh-Cary / Duke Health',
      'hendersonville-nc': 'Nashville / Vanderbilt',
      'lebanon-mo': 'Nashville / Vanderbilt',
      'smyrna-ga': 'Nashville / Vanderbilt',
      'franklin-ky': 'Nashville / Vanderbilt',
      'middletown-ny': 'Hartford-East Hartford-Middletown / UConn Health',
      'ontario-or': 'Riverside-San Bernardino-Ontario',
      'st-charles-il': 'St. Louis / BJC HealthCare',
      'ofallon-il': 'St. Louis / BJC HealthCare',
    };
    for (const [slug, held] of Object.entries(copies)) {
      const city = getCityBySlug(slug);
      expect(city, `${slug} missing from CITIES`).toBeDefined();
      expect(city!.metroArea, `${slug} still publishes ${held}`).toBeNull();
      expect(city!.healthcareSystems, `${slug} still publishes ${held}`).toEqual([]);
    }
  });

  it('the owner named by the metro title keeps its own data', () => {
    const owners: Record<string, string> = {
      'glendale-az': 'Phoenix-Mesa-Chandler',
      'redmond-wa': 'Seattle-Tacoma-Bellevue',
      'wilmington-de': 'Philadelphia-Camden-Wilmington',
      'warren-mi': 'Detroit-Warren-Dearborn',
      'columbia-md': 'Baltimore-Columbia-Towson',
      'newark-nj': 'New York-Newark-Jersey City',
      'middletown-ct': 'Hartford-East Hartford-Middletown',
      'ontario-ca': 'Riverside-San Bernardino-Ontario',
      'franklin-tn': 'Nashville-Davidson-Murfreesboro-Franklin',
      'chester-va': 'Richmond',
    };
    for (const [slug, metro] of Object.entries(owners)) {
      // Deletion-only means the real record must survive untouched: an
      // over-eager repair that nulled both sides would be its own bug.
      expect(getCityBySlug(slug)?.metroArea, `${slug} lost its own metro`).toBe(metro);
    }
  });

  it('leaves Kansas City MO and KS alone — one real bi-state metro, nothing disprovable', () => {
    // "Kansas City" names exactly one city, carried by BOTH Kansas City MO and
    // Kansas City KS, so the title settles nothing; and Missouri's place in the
    // metro is proven independently by independence-mo and lees-summit-mo,
    // which no name collision can explain. Deleting either would delete a fact.
    for (const slug of ADJACENT_TWIN_PAIR) {
      const city = getCityBySlug(slug);
      expect(city?.metroArea, `${slug} lost the Kansas City metro`).toBe('Kansas City');
      expect(city!.healthcareSystems.length).toBeGreaterThan(0);
    }
  });
});

describe('#9: no same-named pair in two states still shares one bundle', () => {
  it('the only surviving cross-state name twin with an identical bundle is Kansas City', () => {
    const byName = new Map<string, typeof CITIES>();
    for (const city of CITIES) {
      const key = city.name.toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), city]);
    }

    const shared: string[] = [];
    for (const [, group] of byName) {
      const buckets = new Map<string, typeof CITIES>();
      for (const city of group) {
        if (!city.metroArea && city.healthcareSystems.length === 0) continue;
        const bundle = `${city.metroArea ?? ''}||${JSON.stringify(city.healthcareSystems)}`;
        buckets.set(bundle, [...(buckets.get(bundle) ?? []), city]);
      }
      for (const [, members] of buckets) {
        if (members.length < 2) continue;
        if (new Set(members.map((m) => m.stateCode)).size < 2) continue;
        const slugs = members.map((m) => m.slug);
        if (isAdjacentTwinPair(slugs)) continue;
        shared.push(slugs.join('+'));
      }
    }
    // A byte-identical metro + hospital bundle on two same-named cities in
    // different states is the dead name-keyed generator's signature: one of
    // them is publishing the other's state as local fact. Re-run
    // `node scripts/repair-city-data-collisions.mjs`.
    expect(shared.sort()).toEqual([]);
  });
});

describe('#9: dataset-wide invariants', () => {
  it('no two cities in different states share a coordinate', () => {
    const byCoord = new Map<string, string[]>();
    for (const city of CITIES) {
      if (city.lat === null || city.lng === null) continue;
      const key = `${city.lat},${city.lng}`;
      byCoord.set(key, [...(byCoord.get(key) ?? []), city.slug]);
    }
    const crossState: string[][] = [];
    for (const [, slugs] of byCoord) {
      if (slugs.length < 2) continue;
      const states = new Set(slugs.map((s) => getCityBySlug(s)!.stateCode));
      if (states.size > 1 && !isAdjacentTwinPair(slugs)) crossState.push(slugs);
    }
    // If this fails: a record was regenerated with a same-named city's
    // coordinates. Re-run `node scripts/repair-city-data-collisions.mjs`.
    expect(crossState).toEqual([]);
  });

  it('a record whose coordinates were removed has no metro, employers or neighbours either', () => {
    // The generator copied the whole geo bundle together, so it is removed
    // together — a record must never keep the metro of a position we deleted.
    const inconsistent = CITIES.filter(
      (c) =>
        c.lat === null &&
        (c.metroArea !== null || c.healthcareSystems.length > 0 || c.nearbyCities.length > 0),
    ).map((c) => c.slug);
    expect(inconsistent).toEqual([]);
  });

  it('lat and lng are removed as a pair, never one without the other', () => {
    const halfRemoved = CITIES.filter((c) => (c.lat === null) !== (c.lng === null)).map((c) => c.slug);
    expect(halfRemoved).toEqual([]);
  });

  it('no city links to a record whose position was removed', () => {
    const removed = new Set(CITIES.filter((c) => c.lat === null).map((c) => c.slug));
    expect(removed.size).toBeGreaterThan(0); // the repair really did run
    const stale = CITIES.flatMap((c) =>
      c.nearbyCities.filter((slug) => removed.has(slug)).map((slug) => `${c.slug}→${slug}`),
    );
    // Those links were computed FROM the false position, so they are not
    // "nearby" in any sense — they must not be re-added.
    expect(stale).toEqual([]);
  });

  it('no city lists a same-named city in another state as a neighbour', () => {
    const bogus = CITIES.flatMap((city) =>
      city.nearbyCities
        .map((slug) => getCityBySlug(slug))
        .filter(
          (target): target is NonNullable<typeof target> =>
            !!target &&
            target.stateCode !== city.stateCode &&
            target.name.toLowerCase() === city.name.toLowerCase() &&
            !isAdjacentTwinPair([city.slug, target.slug]),
        )
        .map((target) => `${city.slug}→${target.slug}`),
    );
    expect(bogus).toEqual([]);
  });

  it('every nearby slug still resolves to a real city', () => {
    const dangling = CITIES.flatMap((c) =>
      c.nearbyCities.filter((slug) => !getCityBySlug(slug)).map((slug) => `${c.slug}→${slug}`),
    );
    expect(dangling).toEqual([]);
  });
});

describe('#9: cities resolve by (name, state), never by name alone', () => {
  it('411 names are shared across states, so a name-only lookup is ambiguous', () => {
    const byName = new Map<string, number>();
    for (const city of CITIES) {
      const key = city.name.toLowerCase();
      byName.set(key, (byName.get(key) ?? 0) + 1);
    }
    const shared = [...byName.values()].filter((n) => n > 1).length;
    expect(shared).toBeGreaterThan(100);
  });

  it('CITY_BY_NAME_STATE indexes every city exactly once', () => {
    expect(Object.keys(CITY_BY_NAME_STATE)).toHaveLength(CITIES.length);
    for (const city of CITIES) {
      expect(CITY_BY_NAME_STATE[`${city.name.toLowerCase()}|${city.stateCode}`]).toBe(city);
    }
  });

  it('getCityByNameState separates same-named cities by state code and by state name', () => {
    expect(getCityByNameState('Portland', 'ME')?.slug).toBe('portland-me');
    expect(getCityByNameState('Portland', 'OR')?.slug).toBe('portland-or');
    expect(getCityByNameState('portland', 'Maine')?.slug).toBe('portland-me');
    expect(getCityByNameState('Portland', 'Oregon')?.slug).toBe('portland-or');
  });

  it('getCityByNameState returns undefined rather than guessing', () => {
    expect(getCityByNameState('Portland', 'ZZ')).toBeUndefined();
    expect(getCityByNameState('Definitely Not A City', 'CA')).toBeUndefined();
  });
});

describe('#9: deleting a copied bundle never de-indexes the page', () => {
  it('the indexing threshold is already met by job count alone', () => {
    // getPageQualityScore() gives metroArea 10 points and healthcareSystems 15,
    // so emptying them costs 25 — exactly the index threshold. That is only
    // survivable because the job-count tier already clears it on its own: a
    // page with fewer than MIN_JOBS_FOR_INDEX jobs is noindex regardless, and
    // one at or above it scores at least 30 before any city signal is added.
    const src = fs.readFileSync(path.join(ROOT, 'lib/pseo/category-city-template.tsx'), 'utf8');
    const threshold = Number(src.match(/const qualityScore = getPageQualityScore[\s\S]{0,200}?>= (\d+)/)?.[1]);
    const floor = Number(src.match(/else score \+= (\d+);\s*\/\/ Meets minimum/)?.[1]);
    expect(threshold).toBe(25);
    expect(floor).toBeGreaterThanOrEqual(threshold);
  });
});

describe('#9: phase B tests the name twin BEFORE it excuses a bordering state', () => {
  const rec = (
    name: string,
    stateCode: string,
    metroArea: string | null,
  ) => ({ name, stateCode, slug: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${stateCode.toLowerCase()}`, metroArea });

  const metroOf = (r: { metroArea: string | null }) => r.metroArea;

  it('deletes a twin in a state that merely BORDERS the metro core', async () => {
    const { findBundleCollisions } = await import('../../scripts/repair-city-data-collisions.mjs');
    // CA borders AZ, so the original `if (plausible.has(rec.stateCode)) continue;`
    // let Glendale, California keep Phoenix's metro. The name twin is decisive:
    // only a name-keyed generator can put one bundle on two states' Glendales.
    const records = [
      rec('Phoenix', 'AZ', 'Phoenix-Mesa-Chandler'),
      rec('Mesa', 'AZ', 'Phoenix-Mesa-Chandler'),
      rec('Chandler', 'AZ', 'Phoenix-Mesa-Chandler'),
      rec('Glendale', 'AZ', 'Phoenix-Mesa-Chandler'),
      rec('Glendale', 'CA', 'Phoenix-Mesa-Chandler'),
    ];
    const { hits } = findBundleCollisions(records, metroOf, { titleEvidence: true });
    expect([...hits.keys()]).toEqual(['glendale-ca']);
  });

  it('reads the metro title to pick the owner even when the owner is not the core state', async () => {
    const { findBundleCollisions } = await import('../../scripts/repair-city-data-collisions.mjs');
    // Core is PA, and both DE and OH border PA, so neither is "far". The title
    // settles it: Philadelphia is PA and Camden is NJ, and of the two
    // Wilmingtons only Delaware's borders both — a metro is contiguous.
    const records = [
      rec('Philadelphia', 'PA', 'Philadelphia-Camden-Wilmington'),
      rec('Chester', 'PA', 'Philadelphia-Camden-Wilmington'),
      rec('Camden', 'NJ', 'Philadelphia-Camden-Wilmington'),
      rec('Wilmington', 'DE', 'Philadelphia-Camden-Wilmington'),
      rec('Wilmington', 'OH', 'Philadelphia-Camden-Wilmington'),
    ];
    const { hits } = findBundleCollisions(records, metroOf, { titleEvidence: true });
    expect([...hits.keys()]).toEqual(['wilmington-oh']);
  });

  it('never touches a carrier that has no same-named twin', async () => {
    const { findBundleCollisions } = await import('../../scripts/repair-city-data-collisions.mjs');
    const records = [
      rec('Portland', 'OR', 'Portland-Vancouver-Hillsboro'),
      rec('Hillsboro', 'OR', 'Portland-Vancouver-Hillsboro'),
      rec('Vancouver', 'WA', 'Portland-Vancouver-Hillsboro'),
    ];
    const { hits } = findBundleCollisions(records, metroOf, { titleEvidence: true });
    expect([...hits.keys()]).toEqual([]);
  });

  it('refuses to choose when the title names one city carried by two states', async () => {
    const { findBundleCollisions, resolveTitleOwners } = await import('../../scripts/repair-city-data-collisions.mjs');
    const records = [
      rec('Kansas City', 'MO', 'Kansas City'),
      rec('Kansas City', 'KS', 'Kansas City'),
      rec('Independence', 'MO', 'Kansas City'),
      rec("Lee's Summit", 'MO', 'Kansas City'),
      rec('Overland Park', 'KS', 'Kansas City'),
      rec('Olathe', 'KS', 'Kansas City'),
      rec('Shawnee', 'KS', 'Kansas City'),
      rec('Shawnee', 'OK', 'Kansas City'),
    ];
    expect([...resolveTitleOwners('Kansas City', records).keys()]).toEqual([]);
    const { hits } = findBundleCollisions(records, metroOf, { titleEvidence: true });
    // Oklahoma has no carrier a name collision cannot explain; Missouri has two.
    expect([...hits.keys()]).toEqual(['shawnee-ok']);
  });

  it('leaves an out-of-core state alone once it has a carrier no collision explains', async () => {
    const { findBundleCollisions } = await import('../../scripts/repair-city-data-collisions.mjs');
    const records = [
      rec('Kansas City', 'KS', 'Kansas City'),
      rec('Overland Park', 'KS', 'Kansas City'),
      rec('Olathe', 'KS', 'Kansas City'),
      rec('Kansas City', 'MO', 'Kansas City'),
      rec('Independence', 'MO', 'Kansas City'),
    ];
    const { hits } = findBundleCollisions(records, metroOf, { titleEvidence: true });
    expect([...hits.keys()]).toEqual([]);
  });
});

describe('#9: the repair stays runnable and documented', () => {
  it('the repair script is still in the repo', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts/repair-city-data-collisions.mjs'))).toBe(true);
  });

  it('cities.ts points maintainers at the repair instead of the deleted generator', () => {
    // Read only the header — the file is ~2MB.
    const fd = fs.openSync(path.join(ROOT, 'lib/pseo/city-data/cities.ts'), 'r');
    const buffer = Buffer.alloc(2048);
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const header = buffer.toString('utf8');
    expect(header).toContain('scripts/repair-city-data-collisions.mjs');
    expect(header).not.toMatch(/^\/\/ AUTO-GENERATED by scripts\/generate-city-data\.js/m);
  });
});

/**
 * lib/pseo/listing-gates-edge.ts
 *
 * Pure decision helpers for the middleware status gates on the job detail
 * route and the city hub. They exist because both routes are on-demand ISR
 * pages (`generateStaticParams() { return [] }` + `revalidate`) whose own
 * notFound() cannot produce an honest response:
 *
 *   - app/jobs/[slug] streams behind loading.tsx, so the 200 status is already
 *     committed when getJob() rules a row quarantined: the visitor got the
 *     "Page Not Found" template with HTTP 200, cached s-maxage=3600 (P10
 *     not-found-status #1).
 *   - app/jobs/city/[slug] answers 404, but with the bare
 *     `<html id="__next_error__">` shell (no H1, no chrome, no recovery
 *     links) instead of app/not-found.tsx (P10 not-found-status #2).
 *
 * Middleware therefore rules on those URLs BEFORE the page renders, reading
 * the same rows over Supabase REST that the page reads through Prisma, and
 * applying the page's own predicates:
 *
 *   - the site-wide profession quarantine is GLOBAL_EXCLUSIONS itself
 *     (lib/filters.ts, the source of PUBLISHED_LISTING_WHERE), evaluated in
 *     memory with SQL three-valued semantics, so it cannot drift from the
 *     Prisma predicate the page runs;
 *   - the city slug parser and the MIN_JOBS render gate mirror
 *     app/jobs/city/[slug]/page.tsx (drift-guarded by
 *     tests/regressions/p10-not-found-status-listing-gates.test.ts).
 *
 * EDGE-SAFE: plain data and pure functions only. lib/filters.ts reaches
 * @prisma/client through type-only imports, which the compiler erases.
 */
import { GLOBAL_EXCLUSIONS } from '@/lib/filters';
import { CODE_TO_STATE } from '@/lib/pseo/setting-state-config';
import { isMemoryEvaluable, matchesWhere } from '@/app/api/jobs/filter-counts/where-evaluator';

/** Row shape the middleware selects from `jobs` over PostgREST (snake_case). */
export interface ListingGateRow {
    title: string | null;
    employer: string | null;
    profession_class: string | null;
}

/** Columns GLOBAL_EXCLUSIONS reads; the REST select must carry all of them. */
export const LISTING_GATE_SELECT = 'title,employer,profession_class';

const QUARANTINE_COLUMNS: ReadonlySet<string> = new Set(['title', 'employer', 'professionClass']);

/** PUBLISHED_LISTING_WHERE minus `isPublished` (the REST query filters that). */
const QUARANTINE_WHERE = {
    AND: GLOBAL_EXCLUSIONS.map((exclusion) => ({ NOT: exclusion })),
};

/**
 * True when every clause of the quarantine can be evaluated from the selected
 * columns. Checked once at module load; when a future exclusion reads another
 * column this turns false and the gates stand down (the page still renders
 * its own not-found) rather than guessing.
 */
export const QUARANTINE_EVALUABLE: boolean = isMemoryEvaluable(QUARANTINE_WHERE, QUARANTINE_COLUMNS);

/**
 * Whether a published row passes the profession quarantine, i.e. whether the
 * page's `{ id, ...PUBLISHED_LISTING_WHERE }` fetch would return it.
 * Returns null when the quarantine cannot be evaluated in memory.
 */
export function passesListingQuarantine(row: ListingGateRow): boolean | null {
    if (!QUARANTINE_EVALUABLE) return null;
    return matchesWhere(QUARANTINE_WHERE, {
        id: '',
        title: row.title,
        employer: row.employer,
        professionClass: row.profession_class,
    });
}

// ── City hub ────────────────────────────────────────────────────────────────

/** Mirrors `const MIN_JOBS = 3` in app/jobs/city/[slug]/page.tsx. */
export const CITY_HUB_MIN_JOBS = 3;

/**
 * Upper bound on rows fetched per city ruling. A fetch that comes back full
 * is not proof of absence, so a ruling only returns not-found when it saw
 * every matching row.
 */
export const CITY_GATE_FETCH_LIMIT = 100;

/** Canonical city slugs are lowercase alphanumeric words joined by hyphens. */
const PLAIN_CITY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ParsedCitySlug {
    cityName: string;
    stateName: string;
    stateCode: string;
}

function cityNameFromSlugPart(part: string): string {
    return part
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/** Same parse as parseCitySlug in app/jobs/city/[slug]/page.tsx. */
export function parseCityHubSlug(slug: string): ParsedCitySlug | null {
    const match = slug.toLowerCase().trim().match(/^(.+)-([a-z]{2})$/);
    if (!match) return null;
    const stateCode = match[2].toUpperCase();
    const stateName = CODE_TO_STATE[stateCode];
    if (!stateName) return null;
    return { cityName: cityNameFromSlugPart(match[1]), stateName, stateCode };
}

/**
 * The REST lookup a city hub ruling needs, or null when middleware must not
 * rule on this slug (metro slugs redirect; slugs with characters outside the
 * canonical alphabet can still resolve through the page's own parse, and
 * would need PostgREST pattern escaping this gate does not attempt).
 *
 *   kind 'hub':       the slug parses; the page 404s below CITY_HUB_MIN_JOBS.
 *   kind 'ambiguous': the slug has no valid state suffix; the page 308s to the
 *                     first quarantine-passing row with a state code, else 404s.
 */
export type CityGateLookup =
    | { kind: 'hub'; query: string }
    | { kind: 'ambiguous'; query: string };

export function cityGateLookup(slug: string, isMetroSlug: (s: string) => boolean): CityGateLookup | null {
    if (!QUARANTINE_EVALUABLE) return null;
    if (isMetroSlug(slug)) return null;
    if (!PLAIN_CITY_SLUG.test(slug)) return null;

    const base = `is_published=eq.true&select=${LISTING_GATE_SELECT}&limit=${CITY_GATE_FETCH_LIMIT}`;
    const parsed = parseCityHubSlug(slug);
    if (parsed) {
        const city = encodeURIComponent(parsed.cityName);
        // or=(state.eq."New York",state_code.eq.NY): quoted so spaces survive.
        const orClause = encodeURIComponent(`(state.eq."${parsed.stateName}",state_code.eq.${parsed.stateCode})`);
        return { kind: 'hub', query: `${base}&city=ilike.${city}&or=${orClause}` };
    }
    const city = encodeURIComponent(cityNameFromSlugPart(slug));
    return { kind: 'ambiguous', query: `${base}&city=ilike.${city}&state_code=not.is.null` };
}

/**
 * Rules on a city hub from the fetched rows. 'not-found' only when the rows
 * are complete (fewer than the fetch limit) and the page would 404 on them;
 * anything else lets the page render.
 */
export function cityGateVerdict(lookup: CityGateLookup, rows: readonly ListingGateRow[]): 'not-found' | 'pass' {
    const passing = rows.filter((row) => passesListingQuarantine(row) === true).length;
    const needed = lookup.kind === 'hub' ? CITY_HUB_MIN_JOBS : 1;
    if (passing >= needed) return 'pass';
    return rows.length < CITY_GATE_FETCH_LIMIT ? 'not-found' : 'pass';
}

/**
 * Internal rewrite target for a known not-found URL. Underscore-prefixed
 * app/ folders are private (never routable), so this path can never match a
 * page: Next renders app/not-found.tsx with a real 404, exactly as it does for
 * any unmatched URL.
 */
export const NOT_FOUND_REWRITE_PATH = '/_not-found-gate';

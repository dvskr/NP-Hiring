/**
 * lib/paid-post-twin-edge.ts
 *
 * The middleware half of the paid-post twin redirect. A free listing that
 * copies a confirmed employer's live paid post (lib/paid-post-twins.ts) is
 * hidden from every listing, and its own URL sends the visitor to that post.
 *
 * Middleware rules on it before the page renders, as it already does for a
 * closed or quarantined job: the job route streams behind loading.tsx, so a
 * redirect from the page itself reaches the browser only after a 200 has been
 * sent. app/jobs/[slug]/page.tsx keeps the same rule as the fallback for when
 * this gate cannot run.
 *
 * The paid post counts as visible by the rule activeIndexableJobWhere applies
 * (lib/active-job-filter.ts): published, not expired, not a dead link, not
 * itself a copy, and passing the profession quarantine.
 *
 * EDGE-SAFE: plain data, pure functions and fetch only.
 */
import { DEAD_LINK_MISS_THRESHOLD } from '@/lib/dead-link-threshold';
import { LISTING_GATE_SELECT, passesListingQuarantine, type ListingGateRow } from '@/lib/pseo/listing-gates-edge';

/** The column the job gate adds to its select to see a copy's mark. */
export const TWIN_MARK_COLUMN = 'shadowed_by_job_id';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** What slugify (lib/utils.ts) produces: lower-case words and the id, joined by hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TWIN_SELECT = `id,slug,is_published,expires_at,health_consecutive_missing,${TWIN_MARK_COLUMN},${LISTING_GATE_SELECT}`;

/** The paid post's row as the REST read returns it (snake_case). */
export interface TwinGateRow extends ListingGateRow {
    id: string;
    slug: string | null;
    is_published: boolean;
    expires_at: string | null;
    health_consecutive_missing: number | null;
    shadowed_by_job_id: string | null;
}

/**
 * Where a copy's URL sends the visitor: the paid post's path while that post
 * is visible and stays live until `validUntil` (ms), else null and the
 * copy's own page renders. A quarantine that cannot be evaluated stands down.
 */
export function twinRedirectPath(row: TwinGateRow | null | undefined, validUntil: number): string | null {
    if (!row || row.is_published !== true || row.shadowed_by_job_id) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() <= validUntil) return null;
    const misses = row.health_consecutive_missing;
    if (typeof misses === 'number' && misses >= DEAD_LINK_MISS_THRESHOLD) return null;
    if (passesListingQuarantine(row) !== true) return null;
    const segment = row.slug && SLUG_PATTERN.test(row.slug) ? row.slug : row.id;
    return `/jobs/${segment}`;
}

/** The copy's request URL moved to the paid post's path, keeping its query (?apply=1, campaign tags). */
export function twinRedirectUrl(path: string, requestUrl: string): URL {
    const current = new URL(requestUrl);
    return new URL(`${path}${current.search}`, current.origin);
}

/**
 * Reads the paid post a copy points at and rules on it. A failed read is
 * logged and answers null: the copy's own page then renders, and its
 * fallback in app/jobs/[slug]/page.tsx makes the same decision.
 */
export async function fetchTwinRedirect(input: {
    supabaseUrl: string;
    supabaseKey: string;
    twinId: unknown;
    validUntil: number;
}): Promise<string | null> {
    if (typeof input.twinId !== 'string' || !UUID_PATTERN.test(input.twinId)) return null;
    try {
        const res = await fetch(`${input.supabaseUrl}/rest/v1/jobs?id=eq.${input.twinId}&select=${TWIN_SELECT}`, {
            headers: { apikey: input.supabaseKey, Authorization: `Bearer ${input.supabaseKey}` },
        });
        if (!res.ok) {
            console.error('[middleware:job-twin] Supabase non-OK response', { status: res.status, twinId: input.twinId });
            return null;
        }
        const rows: unknown = await res.json();
        const row = Array.isArray(rows) ? (rows[0] as TwinGateRow | undefined) : undefined;
        return twinRedirectPath(row, input.validUntil);
    } catch (err) {
        console.error('[middleware:job-twin] paid post lookup failed', {
            twinId: input.twinId,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

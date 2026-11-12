/**
 * Workable adapter — public v2 board API.
 *
 * Endpoint:
 *   POST https://apply.workable.com/api/v2/accounts/{slug}/jobs
 *   body: {"query":"","department":[],"location":[],"remote":[],"token":"<nextPage>"}
 *
 * Response: { total: number, results: WorkableJob[], nextPage?: string }
 *
 * PAGING. The endpoint returns 10 postings a page and ignores `limit` and
 * `offset`; the next page is asked for by sending the previous response's
 * `nextPage` back as `token` in the body. Until 2026-11-12 this adapter
 * paged with limit/offset and stopped when a page came back short of 100,
 * so it read the first 10 postings of every board and nothing else
 * (Greenlife Healthcare Staffing: 958 postings, 56 NP titles, nearly all
 * past page one).
 *
 * A board is read in two steps: the newest WORKABLE_BROWSE_PAGES pages with
 * no query, which is the whole of a small board, and then, only when the
 * board has more than that, one keyword search per WORKABLE_SEARCH_QUERIES
 * entry. Paging a 900-posting board end to end is what got a probe's
 * address blocked for 24 hours (HTTP 429, Retry-After 86400) on
 * 2026-11-12, so every loop here is capped and the first 429 ends the
 * whole run (see rateLimited).
 *
 * Public, unauthenticated. Each `result` has only metadata — full
 * description requires a second call to
 *   https://apply.workable.com/api/v2/accounts/{slug}/jobs/{shortcode}
 * which returns the full job-detail blob. We fetch detail only for
 * postings that pass the title-only relevance pre-filter.
 *
 * Tenants in lib/aggregators/tenants/workable.ts.
 */

import { isRelevantJob } from '@/lib/utils/job-filter';
import { WORKABLE_TENANTS } from './tenants/workable';
import type { Aggregator, RawJobData } from './types';
import { checkJobHealth, type HealthDecision } from '@/lib/health/check-job-health';
import { htmlToReadableText } from '@/lib/sanitize';
import { resolveCountryValue } from '@/lib/location-parser';

interface WorkableLocation {
    country?: string;
    countryCode?: string;
    city?: string;
    region?: string;
}

interface WorkableJob {
    id: number;
    shortcode: string;
    title: string;
    remote?: boolean;
    location?: WorkableLocation;
    locations?: WorkableLocation[];
    state?: string;
    published?: string;
    department?: string[];
    workplace?: string;
    description?: string;
    requirements?: string;
    benefits?: string;
    employmentType?: string;
}

interface WorkableListResponse {
    total?: number;
    results?: WorkableJob[];
    /** Opaque cursor for the next page; absent on the last one. */
    nextPage?: string;
}

const TIME_BUDGET_MS = 180_000; // under orchestrator MAX_INGESTION_MS (240s) so the insert loop has headroom
const TENANT_GAP_MS = 400;
const DETAIL_FETCH_GAP_MS = 300;
const BATCH_SIZE = 3;

/** Pause between list pages of one tenant. */
const PAGE_GAP_MS = 500;
/** Unfiltered pages read first (10 postings each, newest first). */
export const WORKABLE_BROWSE_PAGES = 3;
/** Pages read per keyword search on a board larger than the browse pages. */
export const WORKABLE_MAX_PAGES_PER_QUERY = 8;
/** Ceiling on list requests to one tenant in one run, browse and search together. */
export const WORKABLE_MAX_LIST_REQUESTS_PER_TENANT = 30;
/**
 * Ceiling on detail fetches for one tenant in one run. Postings arrive
 * newest first, so a board with more relevant postings than this lists its
 * newest ones. Kept low on purpose: the request volume Workable tolerates
 * from one address is not known (the 2026-11-12 block came from a probe,
 * not from this adapter), so raise it only after watching real runs.
 */
export const WORKABLE_MAX_DETAILS_PER_TENANT = 60;

/**
 * Keyword searches for boards too large to browse. Workable searches the
 * posting text, so the role terms reach the specialty titles as well.
 */
export const WORKABLE_SEARCH_QUERIES: readonly string[] = [
    'nurse practitioner',
    'APRN',
    'advanced practice',
    'nurse anesthetist',
    'CRNA',
    'midwife',
    'clinical nurse specialist',
];

/**
 * Set by the first HTTP 429 of a run and cleared when the next run starts.
 * Once set, no further request is sent to Workable in this run: its block
 * lasts a day, and pressing on only extends it.
 */
let rateLimited = false;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A place whose country resolves to the United States, or has no country. */
function isUsOrUnknownPlace(loc: WorkableLocation): boolean {
    const country = resolveCountryValue(loc.countryCode ?? loc.country ?? null);
    return country === null || country === 'US';
}

/**
 * Where a Workable posting is. When it lists several places the first US
 * one is used, so a posting open in Canada and the United States is filed
 * under its US place, not the Canadian one.
 */
export function workableLocation(job: Pick<WorkableJob, 'location' | 'locations' | 'remote'>): string {
    const places = [job.location, ...(job.locations ?? [])].filter((l): l is WorkableLocation => !!l);
    const loc = places.find(isUsOrUnknownPlace) ?? places[0];
    if (loc) {
        if (loc.city && loc.region) return `${loc.city}, ${loc.region}`;
        if (loc.region) return loc.region;
        if (loc.country) return loc.country;
    }
    if (job.remote) return 'Remote';
    return 'United States';
}

/**
 * Every country a Workable posting lists (its location plus each entry of
 * its locations list, ISO code preferred over the name), for the
 * normalizer's non-US gate, or undefined when none is given. A posting that
 * lists the United States among other countries is a US job (owner
 * decision), so the whole list is passed, not only the first entry.
 */
export function workableCountries(job: Pick<WorkableJob, 'location' | 'locations'>): string[] | undefined {
    const places = [job.location, ...(job.locations ?? [])].filter((l): l is WorkableLocation => !!l);
    const codes = places
        .map((l) => (l.countryCode ?? l.country ?? '').trim())
        .filter(Boolean);
    const unique = [...new Set(codes)];
    return unique.length > 0 ? unique : undefined;
}

function mapWorkplace(job: WorkableJob): string | null {
    if (job.remote) return 'Remote';
    const w = job.workplace?.toLowerCase();
    if (w === 'remote') return 'Remote';
    if (w === 'hybrid') return 'Hybrid';
    if (w === 'on_site' || w === 'onsite') return 'In-Person';
    return null;
}

async function fetchDetail(slug: string, shortcode: string): Promise<WorkableJob | null> {
    const url = `https://apply.workable.com/api/v2/accounts/${slug}/jobs/${shortcode}`;
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(t);
        if (res.status === 429) rateLimited = true;
        if (!res.ok) {
            // H6 fix: log non-OK detail fetches so a tenant returning 403/429
            // doesn't silently drop every job's description (jobs would still
            // pass the quality gate at title alone and ingest with empty body).
            console.warn(`[Workable] detail HTTP ${res.status} for ${slug}/${shortcode}`);
            return null;
        }
        return (await res.json()) as WorkableJob;
    } catch (err) {
        // H6 fix: surface network / abort failures so a tenant-level outage
        // is distinguishable from a tenant with no PMHNP openings.
        console.warn(`[Workable] detail fetch failed for ${slug}/${shortcode}:`, err instanceof Error ? err.message : err);
        return null;
    }
}

/**
 * Every posting of one board the two-step read reaches, de-duplicated by
 * shortcode (see the PAGING note in the file header). Exported for tests.
 */
export async function collectWorkablePostings(
    tenant: { slug: string; name: string },
    pageGapMs: number = PAGE_GAP_MS,
): Promise<WorkableJob[]> {
    const byCode = new Map<string, WorkableJob>();
    let requests = 0;

    /** Pages one query; true when the board has more pages than were read. */
    const run = async (query: string, maxPages: number): Promise<boolean> => {
        let token: string | undefined;
        for (let page = 0; page < maxPages; page++) {
            if (rateLimited || requests >= WORKABLE_MAX_LIST_REQUESTS_PER_TENANT) return true;
            if (requests > 0) await sleep(pageGapMs);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);
            let res: Response;
            try {
                requests++;
                res = await fetch(`https://apply.workable.com/api/v2/accounts/${tenant.slug}/jobs`, {
                    method: 'POST',
                    signal: controller.signal,
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        query,
                        department: [],
                        location: [],
                        remote: [],
                        ...(token ? { token } : {}),
                    }),
                });
            } finally {
                clearTimeout(timeout);
            }

            if (res.status === 429) {
                rateLimited = true;
                console.warn(`[Workable] ${tenant.name} (${tenant.slug}): HTTP 429, ending this run's Workable requests`);
                return false;
            }
            if (!res.ok) {
                console.warn(`[Workable] ${tenant.name} (${tenant.slug}): HTTP ${res.status}`);
                return false;
            }
            const data = (await res.json()) as WorkableListResponse;
            const results = data.results ?? [];
            for (const posting of results) {
                if (posting.shortcode && !byCode.has(posting.shortcode)) byCode.set(posting.shortcode, posting);
            }
            token = data.nextPage;
            if (!token || results.length === 0) return false;
        }
        return true;
    };

    const boardHasMore = await run('', WORKABLE_BROWSE_PAGES);
    if (boardHasMore) {
        for (const query of WORKABLE_SEARCH_QUERIES) {
            if (rateLimited || requests >= WORKABLE_MAX_LIST_REQUESTS_PER_TENANT) break;
            await run(query, WORKABLE_MAX_PAGES_PER_QUERY);
        }
    }
    return [...byCode.values()];
}

async function fetchTenantJobs(tenant: { slug: string; name: string }): Promise<RawJobData[]> {
    const out: RawJobData[] = [];
    try {
        const postings = await collectWorkablePostings(tenant);
        const relevant = postings.filter((posting) => isRelevantJob(posting.title ?? '', ''));
        if (relevant.length > WORKABLE_MAX_DETAILS_PER_TENANT) {
            console.warn(
                `[Workable] ${tenant.name}: ${relevant.length} relevant postings, ` +
                `reading the first ${WORKABLE_MAX_DETAILS_PER_TENANT}`,
            );
        }
        {
            for (const j of relevant.slice(0, WORKABLE_MAX_DETAILS_PER_TENANT)) {
                if (rateLimited) break;

                const detail = await fetchDetail(tenant.slug, j.shortcode);
                const description = htmlToReadableText(
                    [detail?.description, detail?.requirements, detail?.benefits]
                        .filter(Boolean)
                        .join('\n\n')
                );

                // H6 fix: drop jobs whose description fetch silently failed.
                // Pushing an empty-description job lets a tenant outage poison
                // the ingest with thin records that still pass the title-only
                // quality gate. The next ingest cycle will retry.
                if (!description) {
                    console.warn(`[Workable] empty description for ${tenant.slug}/${j.shortcode} — dropping job`);
                    await sleep(DETAIL_FETCH_GAP_MS);
                    continue;
                }

                const applyLink = `https://apply.workable.com/${tenant.slug}/j/${j.shortcode}/`;

                out.push({
                    externalId: `workable-${tenant.slug}-${j.shortcode}`,
                    title: j.title,
                    company: tenant.name,
                    employer: tenant.name,
                    location: workableLocation(j),
                    description,
                    applyLink,
                    postedDate: j.published,
                    postedAt: j.published,
                    jobType: detail?.employmentType,
                    sourceProvider: 'workable',
                    sourceSite: 'workable',
                    isRemote: mapWorkplace(j) === 'Remote' || undefined,
                    // For the non-US gate (owner decision: US jobs only).
                    country: workableCountries(j),
                } as RawJobData);

                await sleep(DETAIL_FETCH_GAP_MS);
            }
        }
        console.log(`[Workable] ${tenant.name}: ${out.length} relevant of ${postings.length} read`);
    } catch (err) {
        console.warn(`[Workable] ${tenant.name} (${tenant.slug}): error -`, err);
    }
    return out;
}

export async function fetchWorkableJobs(): Promise<RawJobData[]> {
    const startTime = Date.now();
    rateLimited = false;
    console.log(`[Workable] Scanning ${WORKABLE_TENANTS.length} tenant career boards...`);

    const allJobs: RawJobData[] = [];
    for (let i = 0; i < WORKABLE_TENANTS.length; i += BATCH_SIZE) {
        if (rateLimited) {
            console.warn(`[Workable] Rate limited: stopping at tenant ${i}/${WORKABLE_TENANTS.length}`);
            break;
        }
        if (Date.now() - startTime >= TIME_BUDGET_MS) {
            console.warn(`[Workable] Time budget exhausted at tenant ${i}/${WORKABLE_TENANTS.length}`);
            break;
        }
        const batch = WORKABLE_TENANTS.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(batch.map((t) => fetchTenantJobs(t)));
        for (const s of settled) {
            if (s.status === 'fulfilled') allJobs.push(...s.value);
        }
        if (i + BATCH_SIZE < WORKABLE_TENANTS.length) await sleep(TENANT_GAP_MS);
    }

    console.log(`[Workable] Total: ${allJobs.length} relevant jobs`);
    return allJobs;
}

export const workableAggregator: Aggregator = {
    key: 'workable',
    chunkCount: 1,
    async fetch(): Promise<RawJobData[]> {
        return fetchWorkableJobs();
    },
    async probeJob(externalId: string, applyLink: string): Promise<HealthDecision | null> {
        return checkJobHealth(applyLink, 'workable', { externalId });
    },
};

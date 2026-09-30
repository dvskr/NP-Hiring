/**
 * Workday Direct Scraper
 *
 * Scrapes Workday career sites directly via their hidden JSON API.
 * Each employer has a POST endpoint at:
 *   https://{slug}.wd{instance}.myworkdayjobs.com/wday/cxs/{slug}/{site}/jobs
 *
 * No API key required. Free and unlimited.
 *
 * Tenant list lives in tenants/workday.ts and search-term lists live in
 * search-terms/workday.ts so the adapter stays focused on
 * fetch/pagination logic.
 */

import {
    WORKDAY_SEARCH_TERMS as SEARCH_TERMS,
    WORKDAY_TITLE_PREFILTER_TERMS as TITLE_PREFILTER_TERMS,
} from './search-terms/workday';
import { WORKDAY_TENANTS, type WorkdayTenant } from './tenants/workday';
import { parseLocation, resolveCountryValue } from '@/lib/location-parser';
type WorkdayCompany = WorkdayTenant;
const WORKDAY_COMPANIES: readonly WorkdayCompany[] = WORKDAY_TENANTS;

interface WorkdayJobPosting {
    title: string;
    externalPath: string;
    locationsText: string;
    postedOn: string;
    bulletFields: string[];
    subtitles: Array<{ instances: string[] }>;
}

interface WorkdaySearchResponse {
    total: number;
    jobPostings: WorkdayJobPosting[];
}

export interface WorkdayJobRaw {
    externalId: string;
    title: string;
    company: string;
    location: string;
    description: string;
    applyLink: string;
    postedDate?: string;
    /**
     * Further work sites of a multi-location requisition, from the detail
     * endpoint. They are also joined into `location` ("Denver, CO; Aurora,
     * CO"), which is what the job page reads to emit one jobLocation Place
     * per site (CS-03); this field keeps the raw list for logs.
     */
    additionalLocations?: string[];
    /**
     * Countries of the requisition's sites (ISO alpha-2 or descriptor), for
     * the non-US gate; see workdayCountries.
     */
    country?: string[];
    /** jobPostingInfo.timeType ("Full time", "Part time"): the structured employment type (H-03). */
    jobType?: string;
    /** jobPostingInfo.remoteType ("Onsite", "Hybrid", "Remote"): the structured work mode (GFJ-01). */
    workMode?: string;
}

/** What the detail endpoint adds to a search hit. */
export interface WorkdayJobDetails {
    description: string;
    realPostedDate?: string;
    /** jobPostingInfo.location: the primary work site ("Denver, CO"). */
    primaryLocation?: string;
    additionalLocations: string[];
    country?: string;
    /** jobPostingInfo.timeType, when the tenant publishes it. */
    timeType?: string;
    /** jobPostingInfo.remoteType, when the tenant publishes it. */
    remoteType?: string;
}

const EMPTY_DETAILS: WorkdayJobDetails = { description: '', additionalLocations: [] };

/**
 * Search-hit location texts that name no place: "2 Locations", "Multiple
 * Locations", or the bare country. Storing them left 12 DaVita rows and
 * others with no city or state, so no JobPosting jobLocation (indexing
 * audit CS-03 / fixSoon 6).
 */
const VAGUE_WORKDAY_LOCATION_RE =
    /^(?:\d+\s+locations?|multiple\s+locations?|various\s+locations?|united\s+states(?:\s+of\s+america)?|usa|us)$/i;

export function isVagueWorkdayLocation(text: string | null | undefined): boolean {
    const t = (text ?? '').trim();
    return t === '' || VAGUE_WORKDAY_LOCATION_RE.test(t);
}

/** Separator between the sites of a multi-location row (the job page splits on it). */
export const WORKDAY_LOCATION_JOINER = '; ';

/** A site string that parses to a US state, so the job page can emit it as a Place. */
function namesUsPlace(text: string): boolean {
    const parsed = parseLocation(text);
    return !!parsed.stateCode && parsed.country === 'US';
}

/**
 * The location a Workday row is filed under: the search hit's text when it
 * names a place, otherwise the detail endpoint's primary location. Falls
 * back to the vague text only when the detail endpoint had nothing, so the
 * row is at least honest about not knowing.
 *
 * A multi-location requisition ("2 Locations") also lists its further sites
 * (jobPostingInfo.additionalLocations). They were parsed and then dropped,
 * so such a row emitted one Place. Every further site that names a US place
 * is now joined after the primary one ("Denver, CO; Aurora, CO"): the
 * parser files the row under the first, and the job page's
 * resolveJobPlaces emits a jobLocation array from the list (CS-03).
 */
export function resolveWorkdayLocation(
    locationsText: string | null | undefined,
    details: Pick<WorkdayJobDetails, 'primaryLocation'> & Partial<Pick<WorkdayJobDetails, 'additionalLocations'>>,
): string {
    const listText = (locationsText ?? '').trim();
    const primary = details.primaryLocation?.trim();
    let base: string;
    if (!isVagueWorkdayLocation(listText)) base = listText;
    else if (primary && !isVagueWorkdayLocation(primary)) base = primary;
    else return listText || 'United States';

    const seen = new Set([base.toLowerCase()]);
    const extra: string[] = [];
    for (const site of details.additionalLocations ?? []) {
        const s = site.trim();
        if (!s || isVagueWorkdayLocation(s) || seen.has(s.toLowerCase()) || !namesUsPlace(s)) continue;
        seen.add(s.toLowerCase());
        extra.push(s);
    }
    return extra.length > 0 ? [base, ...extra].join(WORKDAY_LOCATION_JOINER) : base;
}

/**
 * The countries a Workday requisition is in, for the normalizer's non-US
 * gate, or undefined when the detail endpoint names none. Its country field
 * describes the primary site only, so a requisition whose further sites
 * include a US place ("Toronto, ON" first, then "Detroit, MI") also carries
 * 'US': a posting that includes the United States among its locations is a
 * US job (owner decision, 2026-09-29).
 */
export function workdayCountries(
    details: Pick<WorkdayJobDetails, 'country'> & Partial<Pick<WorkdayJobDetails, 'additionalLocations'>>,
): string[] | undefined {
    const country = details.country?.trim();
    if (!country) return undefined;
    const hasUsSite = (details.additionalLocations ?? []).some((site) => namesUsPlace(site));
    return hasUsSite && resolveCountryValue(country) !== 'US' ? [country, 'US'] : [country];
}

function readCountry(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const v = value as { alpha2Code?: unknown; descriptor?: unknown };
    if (typeof v.alpha2Code === 'string' && v.alpha2Code.trim()) return v.alpha2Code.trim();
    if (typeof v.descriptor === 'string' && v.descriptor.trim()) return v.descriptor.trim();
    return undefined;
}

/**
 * Pull the fields ingest needs out of a detail response
 * (`{ jobPostingInfo: { jobDescription, startDate, postedOn, location,
 * additionalLocations, country, jobRequisitionLocation } }`). Pure, so it
 * can be tested without the network.
 */
export function parseWorkdayDetail(data: unknown): WorkdayJobDetails {
    const info = (data && typeof data === 'object'
        ? (data as { jobPostingInfo?: Record<string, unknown> }).jobPostingInfo
        : undefined) ?? {};
    const description = typeof info.jobDescription === 'string' ? info.jobDescription : '';

    // Extract the REAL original posting date from the detail endpoint
    // Priority: startDate (exact ISO date "2026-03-05") > postedOn ("Posted 7 Days Ago")
    let realPostedDate: string | undefined;
    if (typeof info.startDate === 'string' && info.startDate) {
        const d = new Date(info.startDate);
        if (!isNaN(d.getTime())) realPostedDate = d.toISOString();
    }
    if (!realPostedDate && typeof info.postedOn === 'string') {
        realPostedDate = parsePostedAgoText(info.postedOn);
    }

    const primaryLocation = typeof info.location === 'string' && info.location.trim()
        ? info.location.trim()
        : undefined;
    const additionalLocations = Array.isArray(info.additionalLocations)
        ? info.additionalLocations
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim())
        : [];
    const requisitionLocation = info.jobRequisitionLocation as { country?: unknown } | undefined;
    const country = readCountry(requisitionLocation?.country) ?? readCountry(info.country);
    const timeType = readText(info.timeType);
    const remoteType = readText(info.remoteType);

    return {
        description,
        realPostedDate,
        primaryLocation,
        additionalLocations,
        country,
        ...(timeType ? { timeType } : {}),
        ...(remoteType ? { remoteType } : {}),
    };
}

/** A trimmed string field, or a `{ descriptor }` object's text, else undefined. */
function readText(value: unknown): string | undefined {
    if (typeof value === 'string') return value.trim() || undefined;
    if (value && typeof value === 'object') {
        const descriptor = (value as { descriptor?: unknown }).descriptor;
        if (typeof descriptor === 'string' && descriptor.trim()) return descriptor.trim();
    }
    return undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse "Posted X Days Ago" text from Workday into a real Date
 */
function parsePostedAgoText(text: string): string | undefined {
    if (!text) return undefined;
    const lower = text.toLowerCase().trim();

    // "posted today" or "posted 0 days ago"
    if (lower.includes('today') || lower === 'posted 0 days ago') {
        return new Date().toISOString();
    }

    // "posted 7 days ago", "posted 30+ days ago"
    const daysMatch = lower.match(/(\d+)\+?\s*days?\s*ago/);
    if (daysMatch) {
        const daysAgo = parseInt(daysMatch[1], 10);
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        return date.toISOString();
    }

    // "posted 1 month ago", "posted 2 months ago"
    const monthsMatch = lower.match(/(\d+)\+?\s*months?\s*ago/);
    if (monthsMatch) {
        const monthsAgo = parseInt(monthsMatch[1], 10);
        const date = new Date();
        date.setMonth(date.getMonth() - monthsAgo);
        return date.toISOString();
    }

    return undefined;
}

/**
 * Fetch job description, real posted date, work sites and country from the
 * Workday job detail endpoint (jobPostingInfo). See parseWorkdayDetail.
 */
async function fetchJobDetails(company: WorkdayCompany, externalPath: string): Promise<WorkdayJobDetails> {
    const url = `https://${company.slug}.wd${company.instance}.myworkdayjobs.com/wday/cxs/${company.slug}/${company.site}${externalPath}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) return EMPTY_DETAILS;

        return parseWorkdayDetail(await res.json());
    } catch {
        return EMPTY_DETAILS;
    }
}

/**
 * Fetch job details for many externalPaths with bounded concurrency.
 * Order of returned details matches the input `paths` order so callers
 * can zip them back to the originating postings.
 */
async function fetchDetailsConcurrent(
    company: WorkdayCompany,
    paths: string[],
    concurrency: number,
): Promise<WorkdayJobDetails[]> {
    const results: WorkdayJobDetails[] = new Array(paths.length);
    let cursor = 0;
    async function worker(): Promise<void> {
        while (true) {
            const idx = cursor++;
            if (idx >= paths.length) return;
            results[idx] = await fetchJobDetails(company, paths[idx]);
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, paths.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

/**
 * Search for PMHNP jobs on a specific Workday company site
 */
async function fetchCompanyJobs(company: WorkdayCompany): Promise<WorkdayJobRaw[]> {
    const baseUrl = `https://${company.slug}.wd${company.instance}.myworkdayjobs.com/wday/cxs/${company.slug}/${company.site}/jobs`;
    const applyBase = `https://${company.slug}.wd${company.instance}.myworkdayjobs.com/en-US/${company.site}`;

    const allJobs: WorkdayJobRaw[] = [];
    const seenPaths = new Set<string>();

    for (const searchText of SEARCH_TERMS) {
        let offset = 0;
        const limit = 20;
        let hasMore = true;

        while (hasMore) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);

                const res = await fetch(baseUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        limit,
                        offset,
                        searchText,
                    }),
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (!res.ok) {
                    console.warn(`[Workday] ${company.name}: HTTP ${res.status} for "${searchText}"`);
                    break;
                }

                const data: WorkdaySearchResponse = await res.json();
                const postings = data.jobPostings || [];
                const total = data.total || 0;

                if (postings.length === 0) break;

                // Pre-filter postings by title BEFORE fetching descriptions —
                // most search hits match the title pre-filter, but a few don't,
                // and skipping description fetches for those saves real time.
                const eligiblePostings = postings.filter((posting) => {
                    if (seenPaths.has(posting.externalPath)) return false;
                    seenPaths.add(posting.externalPath);
                    const titleLower = posting.title.toLowerCase();
                    return TITLE_PREFILTER_TERMS.some((term) => titleLower.includes(term));
                });

                // Fetch descriptions in parallel (concurrency 5). The serial
                // version with 200ms sleeps was the dominant cost — 20 jobs
                // × ~500ms each = 10s/page. Parallel-5 drops this to ~2s.
                const detailResults = await fetchDetailsConcurrent(
                    company,
                    eligiblePostings.map((p) => p.externalPath),
                    5,
                );

                for (let pIdx = 0; pIdx < eligiblePostings.length; pIdx++) {
                    const posting = eligiblePostings[pIdx];
                    const details = detailResults[pIdx];
                    const pathParts = posting.externalPath.split('/');
                    const jobId = pathParts[pathParts.length - 1] || posting.externalPath;
                    const postedDate = details.realPostedDate
                        || parsePostedAgoText(posting.postedOn)
                        || undefined;
                    allJobs.push({
                        externalId: `workday-${company.slug}-${jobId}`,
                        title: posting.title,
                        company: company.name,
                        // "2 Locations" / "United States" name no place;
                        // the detail endpoint's primary location does.
                        location: resolveWorkdayLocation(posting.locationsText, details),
                        description: details.description,
                        applyLink: `${applyBase}${posting.externalPath}`,
                        postedDate,
                        ...(details.additionalLocations.length > 0
                            ? { additionalLocations: details.additionalLocations }
                            : {}),
                        ...(workdayCountries(details) ? { country: workdayCountries(details) } : {}),
                        // Structured fields the normalizer prefers over any
                        // text scan: employment type (H-03), work mode (GFJ-01).
                        ...(details.timeType ? { jobType: details.timeType } : {}),
                        ...(details.remoteType ? { workMode: details.remoteType } : {}),
                    });
                }

                offset += limit;
                hasMore = offset < total && postings.length === limit;

                // Rate limiting between pages — trimmed from 300ms now that
                // descriptions are fetched in parallel.
                await sleep(150);
            } catch (error) {
                console.warn(`[Workday] ${company.name}: Error fetching "${searchText}" at offset ${offset}:`, error);
                break;
            }
        }

        // Rate limiting between search terms
        await sleep(250);
    }

    console.log(`[Workday] ${company.name}: ${allJobs.length} PMHNP jobs found (${seenPaths.size} total searched)`);
    return allJobs;
}

/**
 * Total number of chunks for Workday. The donor NP board runs the same
 * value (verified 2026-07-02). Current tenant list is 112 companies →
 * ~23 per chunk = 5 chunks.
 *
 * MUST match the number of /api/cron/ingest?source=workday&chunk=N
 * entries in vercel.json — see tests/aggregators/chunk-count.test.ts —
 * and CHUNKED_SOURCE_TOTAL_CHUNKS in lib/health/chunked-presence.ts.
 */
export const WORKDAY_TOTAL_CHUNKS = 5;
const WORKDAY_CHUNK_SIZE = Math.ceil(WORKDAY_COMPANIES.length / WORKDAY_TOTAL_CHUNKS);

/**
 * Fetch PMHNP jobs from Workday companies (supports chunked execution)
 * @param options.chunk - Chunk index (0-4). If omitted, processes all companies.
 */
export async function fetchWorkdayJobs(options?: { chunk?: number }): Promise<WorkdayJobRaw[]> {
    let companies = WORKDAY_COMPANIES;

    // Support chunked execution for Vercel cron timeout limits
    if (options?.chunk !== undefined) {
        const start = options.chunk * WORKDAY_CHUNK_SIZE;
        const end = start + WORKDAY_CHUNK_SIZE;
        companies = WORKDAY_COMPANIES.slice(start, end);
        console.log(`[Workday] Chunk ${options.chunk}/${WORKDAY_TOTAL_CHUNKS - 1}: Processing companies ${start + 1}-${Math.min(end, WORKDAY_COMPANIES.length)} of ${WORKDAY_COMPANIES.length}`);
    }

    console.log(`[Workday] Checking ${companies.length} Workday career sites for PMHNP jobs...`);

    const allJobs: WorkdayJobRaw[] = [];
    const failedCompanies: string[] = [];
    const BATCH_SIZE = 5;

    try {
        for (let i = 0; i < companies.length; i += BATCH_SIZE) {
            const batch = companies.slice(i, i + BATCH_SIZE);

            const results = await Promise.allSettled(
                batch.map(company => fetchCompanyJobs(company))
            );

            for (let j = 0; j < results.length; j++) {
                const result = results[j];
                if (result.status === 'fulfilled') {
                    allJobs.push(...result.value);
                } else {
                    failedCompanies.push(batch[j].name);
                    console.error(`[Workday] Failed to fetch from ${batch[j].name}`);
                }
            }

            if (i + BATCH_SIZE < companies.length) {
                await sleep(300);
            }
        }

        console.log(`[Workday] Total PMHNP jobs fetched: ${allJobs.length}`);

        if (failedCompanies.length > 0) {
            console.log(`[Workday] Failed companies (${failedCompanies.length}): ${failedCompanies.join(', ')}`);
        }

        return allJobs;
    } catch (error) {
        console.error('[Workday] Error in main fetch:', error);
        return allJobs;
    }
}

import type { Aggregator, RawJobData, FetchOptions } from './types';
import { checkJobHealth, type HealthDecision } from '@/lib/health/check-job-health';

export const workdayAggregator: Aggregator = {
    key: 'workday',
    chunkCount: WORKDAY_TOTAL_CHUNKS,
    async fetch(opts: FetchOptions = {}): Promise<RawJobData[]> {
        return (await fetchWorkdayJobs({ chunk: opts.chunk })) as unknown as RawJobData[];
    },
    async probeJob(externalId: string, applyLink: string): Promise<HealthDecision | null> {
        // Workday has no clean per-posting JSON API; checkJobHealth's
        // generic HTTP probe + soft-404 detector handles it.
        return checkJobHealth(applyLink, 'workday', { externalId });
    },
};

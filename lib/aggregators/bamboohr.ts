/**
 * BambooHR adapter: public careers JSON endpoints.
 *
 * List:   GET https://{slug}.bamboohr.com/careers/list
 *         { meta: { totalCount }, result: [{ id, jobOpeningName, ... }] }
 * Detail: GET https://{slug}.bamboohr.com/careers/{id}/detail
 *         { result: { jobOpening: { description, compensation,
 *           location, atsLocation, locationType, ... } } }
 *
 * Public, unauthenticated. The list endpoint carries no description, so
 * every relevant opening is read from its detail endpoint. Until
 * 2026-09-28 the adapter skipped the detail call and composed a
 * "description" from the list metadata ("<title> / Employer: / Department:
 * / Employment: / Location: United States"), which published as a full
 * JobPosting (indexing audit GFJ-04: Televero Health, 137 characters). An
 * opening whose detail cannot be read is now skipped for this run; it is
 * never published from metadata.
 *
 * Tenants in lib/aggregators/tenants/bamboohr.ts.
 */

import { isRelevantJob } from '@/lib/utils/job-filter';
import { BAMBOOHR_TENANTS } from './tenants/bamboohr';
import type { Aggregator, RawJobData } from './types';
import { checkJobHealth, type HealthDecision } from '@/lib/health/check-job-health';
import { htmlToReadableText } from '@/lib/sanitize';

interface BambooHrPlace {
    city?: string | null;
    state?: string | null;
    province?: string | null;
    country?: string | null;
    addressCountry?: string | null;
    postalCode?: string | null;
}

interface BambooHrJob {
    id: string;
    jobOpeningName: string;
    departmentId?: string;
    departmentLabel?: string;
    employmentStatusLabel?: string;
    locationCity?: string;
    locationState?: string;
    locationCountry?: string;
    location?: BambooHrPlace;
    atsLocation?: BambooHrPlace;
    /** "0" on-site, "1" remote, "2" hybrid. */
    locationType?: string | number | null;
    jobOpeningStatus?: string;
    datePosted?: string;
    isRemote?: boolean | string | null;
    descriptionHtml?: string;
}

interface BambooHrResponse {
    meta?: { totalCount?: number };
    result?: BambooHrJob[];
}

/** The detail endpoint's opening: the list fields plus the posting itself. */
export interface BambooHrJobOpening extends Partial<BambooHrJob> {
    description?: string | null;
    compensation?: string | null;
}

const TIME_BUDGET_MS = 180_000; // under orchestrator MAX_INGESTION_MS (240s) so the insert loop has headroom
const TENANT_GAP_MS = 300;
const DETAIL_GAP_MS = 150;
const DETAIL_TIMEOUT_MS = 8_000;
const BATCH_SIZE = 5;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(v: string | null | undefined): string | null {
    const t = (v ?? '').trim();
    return t ? t : null;
}

function isRemoteFlag(v: boolean | string | null | undefined): boolean {
    return v === true || (typeof v === 'string' && ['yes', 'true', '1'].includes(v.trim().toLowerCase()));
}

/**
 * The location string for an opening, from the detail record first and the
 * list record second. BambooHR tenants often leave `location` empty and
 * fill `atsLocation`, which is where Televero's "Dallas, Texas" lives; the
 * old adapter never read it and fell back to "United States".
 */
export function buildBambooHrLocation(job: Partial<BambooHrJob>, detail?: BambooHrJobOpening | null): string {
    const sources = [detail?.location, detail?.atsLocation, job.location, job.atsLocation];
    const city = clean(detail?.locationCity) ?? clean(job.locationCity)
        ?? sources.map((s) => clean(s?.city)).find(Boolean) ?? null;
    const state = clean(detail?.locationState) ?? clean(job.locationState)
        ?? sources.map((s) => clean(s?.state) ?? clean(s?.province)).find(Boolean) ?? null;
    const locationType = String(detail?.locationType ?? job.locationType ?? '').trim();
    const remote = locationType === '1' || isRemoteFlag(detail?.isRemote) || isRemoteFlag(job.isRemote);
    const hybrid = locationType === '2';
    const place = city && state ? `${city}, ${state}` : state ?? city;

    if (remote) return state ? `Remote - ${state}` : 'Remote';
    if (hybrid) return place ? `Hybrid - ${place}` : 'Hybrid';
    return place ?? 'United States';
}

/** The country BambooHR records for an opening, for the non-US gate. */
export function bambooHrCountry(job: Partial<BambooHrJob>, detail?: BambooHrJobOpening | null): string | undefined {
    const candidates = [
        detail?.atsLocation?.country, detail?.location?.addressCountry, detail?.location?.country,
        job.atsLocation?.country, job.location?.country, job.locationCountry,
    ];
    return candidates.map(clean).find((c): c is string => c !== null);
}

const COMPENSATION_NUMBER_RE = /\$?\s*(\d+(?:\.\d+)?)\s*(k)?\b/gi;

/**
 * Structured pay from BambooHR's free-text compensation field ("85 to 90
 * an hour", "120000 to 140000 annually", "Up to $95/hr"). Only the
 * employer's own figures are used, never the title; a field without a
 * number yields nothing.
 */
export function parseCompensationText(text: string | null | undefined): {
    minSalary: number | null;
    maxSalary: number | null;
    salaryPeriod: string | null;
} {
    const none = { minSalary: null, maxSalary: null, salaryPeriod: null };
    if (!text) return none;
    const t = text.toLowerCase().replace(/,/g, '');
    const values = Array.from(t.matchAll(COMPENSATION_NUMBER_RE))
        .map((m) => parseFloat(m[1]) * (m[2] ? 1000 : 1))
        .filter((n) => Number.isFinite(n) && n > 0)
        .slice(0, 2);
    if (values.length === 0) return none;
    const salaryPeriod = /\b(?:hour|hr|hourly)\b/.test(t) ? 'hour'
        : /\b(?:year|yr|annual|annually|salary|salaried)\b/.test(t) ? 'year'
        : /\b(?:week|weekly|wk)\b/.test(t) ? 'week'
        : /\b(?:day|daily)\b/.test(t) ? 'day'
        : /\b(?:month|monthly)\b/.test(t) ? 'month'
        : null;
    if (values.length === 1 && /\bup\s+to\b/.test(t)) {
        return { minSalary: null, maxSalary: values[0], salaryPeriod };
    }
    const [a, b] = values;
    const min = b !== undefined ? Math.min(a, b) : a;
    const max = b !== undefined ? Math.max(a, b) : null;
    return { minSalary: min, maxSalary: max, salaryPeriod };
}

function mapEmploymentStatus(label?: string | null): string | null {
    if (!label) return null;
    const l = label.toLowerCase();
    if (l.includes('full')) return 'Full-Time';
    if (l.includes('part')) return 'Part-Time';
    if (l.includes('contract') || l.includes('temp') || l.includes('contractor')) return 'Contract';
    if (l.includes('prn') || l.includes('per diem')) return 'Per Diem';
    if (l.includes('intern')) return 'Internship';
    return null;
}

/** Read the opening out of a detail response; tolerant of both known envelopes. */
export function parseBambooHrDetail(data: unknown): BambooHrJobOpening | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as { result?: { jobOpening?: unknown }; jobOpening?: unknown };
    const opening = d.result?.jobOpening ?? d.jobOpening;
    return opening && typeof opening === 'object' ? (opening as BambooHrJobOpening) : null;
}

async function fetchOpeningDetail(slug: string, id: string): Promise<BambooHrJobOpening | null> {
    const url = `https://${slug}.bamboohr.com/careers/${encodeURIComponent(id)}/detail`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DETAIL_TIMEOUT_MS);
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) {
            console.warn(`[BambooHR] ${slug} opening ${id}: detail HTTP ${res.status}: skipped this run`);
            return null;
        }
        return parseBambooHrDetail(await res.json());
    } catch (err) {
        console.warn(`[BambooHR] ${slug} opening ${id}: detail fetch failed: skipped this run`, err);
        return null;
    }
}

/**
 * The raw job for one opening, or null when the detail record has no
 * description (the posting would otherwise publish without one).
 */
export function buildBambooHrRawJob(
    tenant: { slug: string; name: string },
    job: BambooHrJob,
    detail: BambooHrJobOpening | null,
): RawJobData | null {
    const description = detail?.description ? htmlToReadableText(detail.description) : '';
    if (!description.trim()) return null;
    const pay = parseCompensationText(detail?.compensation);
    const country = bambooHrCountry(job, detail);
    const datePosted = detail?.datePosted ?? job.datePosted;
    return {
        externalId: `bamboohr-${tenant.slug}-${job.id}`,
        title: job.jobOpeningName,
        company: tenant.name,
        employer: tenant.name,
        location: buildBambooHrLocation(job, detail),
        description,
        applyLink: `https://${tenant.slug}.bamboohr.com/careers/${job.id}`,
        postedDate: datePosted,
        postedAt: datePosted,
        jobType: mapEmploymentStatus(detail?.employmentStatusLabel ?? job.employmentStatusLabel) ?? undefined,
        ...(pay.minSalary != null || pay.maxSalary != null
            ? { minSalary: pay.minSalary, maxSalary: pay.maxSalary, salaryPeriod: pay.salaryPeriod ?? undefined }
            : {}),
        ...(country ? { country } : {}),
        sourceProvider: 'bamboohr',
        sourceSite: 'bamboohr',
    } as RawJobData;
}

async function fetchTenantJobs(tenant: { slug: string; name: string }, deadline: number): Promise<RawJobData[]> {
    const url = `https://${tenant.slug}.bamboohr.com/careers/list`;
    const out: RawJobData[] = [];
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
            console.warn(`[BambooHR] ${tenant.name} (${tenant.slug}): HTTP ${res.status}`);
            return out;
        }
        const data = (await res.json()) as BambooHrResponse;
        const jobs = data.result ?? [];

        let skippedNoDetail = 0;
        for (const j of jobs) {
            if (!isRelevantJob(j.jobOpeningName ?? '', '')) continue;
            if (Date.now() >= deadline) {
                console.warn(`[BambooHR] ${tenant.name}: time budget reached, remaining openings wait for the next run`);
                break;
            }
            const detail = await fetchOpeningDetail(tenant.slug, j.id);
            const rawJob = buildBambooHrRawJob(tenant, j, detail);
            if (rawJob) out.push(rawJob);
            else skippedNoDetail++;
            await sleep(DETAIL_GAP_MS);
        }
        console.log(
            `[BambooHR] ${tenant.name}: ${out.length} PMHNP-relevant of ${jobs.length} total` +
            (skippedNoDetail > 0 ? ` (${skippedNoDetail} skipped: no readable description)` : ''),
        );
    } catch (err) {
        console.warn(`[BambooHR] ${tenant.name} (${tenant.slug}): error -`, err);
    }
    return out;
}

export async function fetchBambooHrJobs(): Promise<RawJobData[]> {
    const startTime = Date.now();
    const deadline = startTime + TIME_BUDGET_MS;
    console.log(`[BambooHR] Scanning ${BAMBOOHR_TENANTS.length} tenant career sites...`);

    const allJobs: RawJobData[] = [];

    for (let i = 0; i < BAMBOOHR_TENANTS.length; i += BATCH_SIZE) {
        if (Date.now() >= deadline) {
            console.warn(`[BambooHR] Time budget exhausted at tenant ${i}/${BAMBOOHR_TENANTS.length}`);
            break;
        }
        const batch = BAMBOOHR_TENANTS.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(batch.map((t) => fetchTenantJobs(t, deadline)));
        for (const s of settled) {
            if (s.status === 'fulfilled') allJobs.push(...s.value);
        }
        if (i + BATCH_SIZE < BAMBOOHR_TENANTS.length) await sleep(TENANT_GAP_MS);
    }

    console.log(`[BambooHR] Total: ${allJobs.length} PMHNP-relevant jobs`);
    return allJobs;
}

export const bambooHrAggregator: Aggregator = {
    key: 'bamboohr',
    chunkCount: 1,
    async fetch(): Promise<RawJobData[]> {
        return fetchBambooHrJobs();
    },
    async probeJob(externalId: string, applyLink: string): Promise<HealthDecision | null> {
        return checkJobHealth(applyLink, 'bamboohr', { externalId });
    },
};

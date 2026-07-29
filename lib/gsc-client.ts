/**
 * lib/gsc-client.ts — shared Google Search Console API client (P1 gsc-ops).
 *
 * Extracted from app/api/cron/gsc-health-check/route.ts so the cron, admin
 * surfaces, and one-off scripts share a single auth + fetch path.
 *
 * Auth: service-account JWT → OAuth token exchange with scope
 * `webmasters.readonly`. That scope covers BOTH Search Analytics queries
 * AND the read-only Sitemaps API (sitemaps.list), so per-sitemap submission
 * status needs no new credentials or scope change.
 *
 * Graceful degradation: getGscConfig() returns null when neither
 * GSC_SERVICE_ACCOUNT_KEY nor GOOGLE_INDEXING_CREDENTIALS is configured
 * (local dev) — callers skip GSC work instead of failing.
 *
 * NOTE: GSC's Page-Indexing coverage BREAKDOWN (crawled-not-indexed,
 * duplicate-no-canonical, …) has NO public API — those columns only exist
 * in UI bulk exports (see scripts/seed-deindex-queue.ts). Do not add
 * fetchers for them here; coverage math lives in lib/gsc-coverage.ts and
 * is computed from our own DB instead.
 */
import { createSign } from 'node:crypto';
import { brand } from '@/config/brand';

const GSC_API_BASE = 'https://www.googleapis.com/webmasters/v3/sites';

export interface GscConfig {
    /** Decoded service-account JSON string. */
    keyJson: string;
    /** GSC property, e.g. "sc-domain:example.com" or "https://example.com/". */
    siteUrl: string;
}

/** Structural env subset so tests can pass plain objects. */
export interface GscEnv {
    GSC_SERVICE_ACCOUNT_KEY?: string;
    GOOGLE_INDEXING_CREDENTIALS?: string;
    GSC_SITE_URL?: string;
    /** Index signature keeps process.env assignable without casts. */
    [key: string]: string | undefined;
}

/**
 * Resolve GSC credentials + property from env. Returns null when no service
 * account key is configured so callers can skip (not fail) in local dev.
 * Accepts raw JSON or base64-encoded JSON (matches lib/search-indexing.ts).
 */
export function getGscConfig(env: GscEnv = process.env): GscConfig | null {
    const keyJsonRaw = env.GSC_SERVICE_ACCOUNT_KEY ?? env.GOOGLE_INDEXING_CREDENTIALS;
    if (!keyJsonRaw) return null;

    const siteUrl = env.GSC_SITE_URL || `sc-domain:${brand.domain}`;

    try {
        JSON.parse(keyJsonRaw);
        return { keyJson: keyJsonRaw, siteUrl };
    } catch {
        return { keyJson: Buffer.from(keyJsonRaw, 'base64').toString('utf-8'), siteUrl };
    }
}

/** Exchange a service-account key for a webmasters.readonly access token. */
export async function getGscAccessToken(serviceAccountKey: string): Promise<string> {
    const key = JSON.parse(serviceAccountKey) as {
        client_email: string;
        private_key: string;
    };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/webmasters.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    };
    const header = { alg: 'RS256', typ: 'JWT' };
    const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsignedJwt = `${b64(header)}.${b64(claim)}`;
    const sign = createSign('RSA-SHA256');
    sign.update(unsignedJwt);
    const signature = sign.sign(key.private_key, 'base64url');
    const jwt = `${unsignedJwt}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });
    if (!tokenRes.ok) {
        throw new Error(`OAuth failed: ${await tokenRes.text()}`);
    }
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    return access_token;
}

// ─── Search Analytics ───────────────────────────────────────────────────────

export interface SearchAnalyticsAggregate {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

/** Aggregate totals for a date range (no dimensions = all queries/pages). */
export async function fetchSearchAnalyticsAggregate(
    token: string,
    siteUrl: string,
    startDate: string,
    endDate: string,
): Promise<SearchAnalyticsAggregate | null> {
    const res = await fetch(
        `${GSC_API_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                startDate,
                endDate,
                rowLimit: 1,
                // No dimensions = aggregate over all queries / pages.
            }),
        }
    );
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Search Analytics ${startDate}: ${res.status} ${txt}`);
    }
    const data = (await res.json()) as { rows?: SearchAnalyticsAggregate[] };
    return data.rows?.[0] ?? null;
}

export type GscDimension = 'query' | 'page';

export interface GscDimensionRow {
    /** The query text or page URL depending on the requested dimension. */
    key: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

interface RawDimensionRow {
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
}

/** Hard cap the Search Analytics API enforces on `rowLimit` per request. */
export const GSC_MAX_ROW_LIMIT = 25_000;

/**
 * How deep the gsc-health-check cron pulls each dimension window.
 *
 * This is a correctness knob, not just a volume one. Movers math compares two
 * windows, and a key missing from one of them is only provably at zero when
 * that window reached the zero-click tail (see lib/gsc-movers.ts). At the old
 * default of 100 rows a 165K-URL surface cuts off while rows still have real
 * clicks, so ordinary churn across the boundary looks like traffic appearing
 * and disappearing. 1,000 rows is deep enough to reach the zero-click tail on
 * this surface while keeping the daily GscSnapshot.raw blob small enough for
 * the admin page to load 14 of them.
 */
export const GSC_DIMENSION_ROW_LIMIT = 1_000;

/**
 * Top rows for a single dimension (query or page) over a date range,
 * ordered by clicks desc (API default).
 *
 * `rowLimit` is clamped to GSC_MAX_ROW_LIMIT — asking for more is a 400 from
 * Google, and silently returning nothing would look like a traffic collapse
 * to every caller downstream.
 */
export async function fetchSearchAnalyticsByDimension(
    token: string,
    siteUrl: string,
    opts: {
        startDate: string;
        endDate: string;
        dimension: GscDimension;
        rowLimit?: number;
    },
): Promise<GscDimensionRow[]> {
    const res = await fetch(
        `${GSC_API_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                startDate: opts.startDate,
                endDate: opts.endDate,
                dimensions: [opts.dimension],
                rowLimit: Math.min(opts.rowLimit ?? GSC_DIMENSION_ROW_LIMIT, GSC_MAX_ROW_LIMIT),
            }),
        }
    );
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Search Analytics ${opts.dimension} ${opts.startDate}–${opts.endDate}: ${res.status} ${txt}`);
    }
    const data = (await res.json()) as { rows?: RawDimensionRow[] };
    return (data.rows ?? [])
        .filter((r): r is RawDimensionRow & { keys: string[] } => Array.isArray(r.keys) && r.keys.length > 0)
        .map((r) => ({
            key: r.keys[0],
            clicks: r.clicks ?? 0,
            impressions: r.impressions ?? 0,
            ctr: r.ctr ?? 0,
            position: r.position ?? 0,
        }));
}

// ─── Sitemaps (submission status) ───────────────────────────────────────────

export interface GscSitemapEntry {
    /** Full sitemap URL as submitted to GSC. */
    path: string;
    lastSubmitted: string | null;
    lastDownloaded: string | null;
    isPending: boolean;
    isSitemapsIndex: boolean;
    errors: number;
    warnings: number;
    /** Sum of contents[].submitted across content types (web, image, …). */
    submittedUrls: number;
}

interface RawSitemapEntry {
    path?: string;
    lastSubmitted?: string;
    lastDownloaded?: string;
    isPending?: boolean;
    isSitemapsIndex?: boolean;
    // int64 fields arrive as strings in the JSON payload.
    errors?: string | number;
    warnings?: string | number;
    contents?: Array<{ type?: string; submitted?: string | number }>;
}

function toCount(value: string | number | undefined): number {
    if (value === undefined) return 0;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize a sitemaps.list payload into typed entries. Pure — exported for
 * tests. Tolerates missing fields and Google's int64-as-string encoding.
 */
export function normalizeSitemapEntries(payload: unknown): GscSitemapEntry[] {
    if (!payload || typeof payload !== 'object') return [];
    const list = (payload as { sitemap?: unknown }).sitemap;
    if (!Array.isArray(list)) return [];

    return list
        .filter((e): e is RawSitemapEntry => Boolean(e) && typeof e === 'object' && typeof (e as RawSitemapEntry).path === 'string')
        .map((e) => ({
            path: e.path as string,
            lastSubmitted: e.lastSubmitted ?? null,
            lastDownloaded: e.lastDownloaded ?? null,
            isPending: e.isPending === true,
            isSitemapsIndex: e.isSitemapsIndex === true,
            errors: toCount(e.errors),
            warnings: toCount(e.warnings),
            submittedUrls: Array.isArray(e.contents)
                ? e.contents.reduce((sum, c) => sum + toCount(c?.submitted), 0)
                : 0,
        }));
}

/**
 * Per-sitemap submission status via the read-only Sitemaps API
 * (webmasters.readonly scope — same token as Search Analytics).
 */
export async function fetchSitemapsList(
    token: string,
    siteUrl: string,
): Promise<GscSitemapEntry[]> {
    const res = await fetch(
        `${GSC_API_BASE}/${encodeURIComponent(siteUrl)}/sitemaps`,
        {
            headers: { Authorization: `Bearer ${token}` },
        }
    );
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Sitemaps list: ${res.status} ${txt}`);
    }
    return normalizeSitemapEntries(await res.json());
}

/**
 * One alert line per sitemap Google reports errors for. Pure — exported for
 * tests. Warnings alone don't page anyone; they surface in the admin panel.
 */
export function buildSitemapAlerts(entries: readonly GscSitemapEntry[]): string[] {
    return entries
        .filter((e) => e.errors > 0)
        .map((e) => {
            const warningSuffix = e.warnings > 0 ? `, ${e.warnings} warning${e.warnings === 1 ? '' : 's'}` : '';
            return `🗺️ ${e.path} — ${e.errors} error${e.errors === 1 ? '' : 's'}${warningSuffix} (last downloaded: ${e.lastDownloaded ?? 'never'})`;
        });
}

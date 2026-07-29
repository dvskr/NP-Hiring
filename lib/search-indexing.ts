/**
 * Search Engine Indexing Utility
 * 
 * Supports:
 *  - Google Indexing API (for JobPosting / general pages)
 *  - Bing URL Submission API
 *  - IndexNow (Bing, Yandex, Seznam, Naver — all at once)
 */

import * as crypto from 'crypto';
import { brand } from '@/config/brand';
// P2 #20: the single IndexNow client. Aliased because this module exports its
// own `pingIndexNow` (a per-URL-result adapter over this call).
import { pingIndexNow as submitToIndexNow } from '@/lib/indexnow';

// Env override first so preview/staging deployments never submit the
// canonical domain's URLs; brand.baseUrl keeps prod correct per board.
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl).replace(/\/$/, '');
const INDEXNOW_HOST = new URL(BASE_URL).hostname;

// ─── Types ───────────────────────────────────────────────────────────────────

interface IndexResult {
    engine: string;
    url: string;
    success: boolean;
    error?: string;
}

// ─── Google Indexing API ─────────────────────────────────────────────────────

async function getGoogleAccessToken(): Promise<string | null> {
    const credentialsRaw = process.env.GOOGLE_INDEXING_CREDENTIALS;
    if (!credentialsRaw) return null;

    let credentials;
    try {
        credentials = JSON.parse(credentialsRaw);
    } catch {
        credentials = JSON.parse(Buffer.from(credentialsRaw, 'base64').toString('utf-8'));
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/indexing',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
    };

    const b64url = (obj: object) =>
        Buffer.from(JSON.stringify(obj))
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

    const signatureInput = `${b64url(header)}.${b64url(claimSet)}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign
        .sign(credentials.private_key, 'base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const jwt = `${signatureInput}.${signature}`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
        console.error('[Google] Failed to get access token:', await tokenResponse.text());
        return null;
    }

    const { access_token } = await tokenResponse.json();
    return access_token;
}

export async function pingGoogle(
    url: string,
    type: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED'
): Promise<IndexResult> {
    try {
        const accessToken = await getGoogleAccessToken();
        if (!accessToken) {
            return { engine: 'Google', url, success: false, error: 'No credentials configured' };
        }

        const response = await fetch(
            'https://indexing.googleapis.com/v3/urlNotifications:publish',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ url, type }),
            }
        );

        if (response.ok) {
            return { engine: 'Google', url, success: true };
        }
        return { engine: 'Google', url, success: false, error: await response.text() };
    } catch (error) {
        return { engine: 'Google', url, success: false, error: String(error) };
    }
}

// ─── Bing URL Submission API ─────────────────────────────────────────────────

export async function pingBing(url: string): Promise<IndexResult> {
    const apiKey = process.env.BING_WEBMASTER_API_KEY;
    if (!apiKey) {
        return { engine: 'Bing', url, success: false, error: 'BING_WEBMASTER_API_KEY not set' };
    }

    try {
        const response = await fetch(
            `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrl?apikey=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteUrl: BASE_URL, url }),
            }
        );

        if (response.ok) {
            return { engine: 'Bing', url, success: true };
        }
        return { engine: 'Bing', url, success: false, error: await response.text() };
    } catch (error) {
        return { engine: 'Bing', url, success: false, error: String(error) };
    }
}

// Bing batch submission (up to 500 at once)
export async function pingBingBatch(urls: string[]): Promise<IndexResult[]> {
    const apiKey = process.env.BING_WEBMASTER_API_KEY;
    if (!apiKey) {
        return urls.map(url => ({ engine: 'Bing', url, success: false, error: 'BING_WEBMASTER_API_KEY not set' }));
    }

    const results: IndexResult[] = [];
    // Bing allows up to 500 URLs per batch
    const batchSize = 500;

    for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        try {
            const response = await fetch(
                `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch?apikey=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ siteUrl: BASE_URL, urlList: batch }),
                }
            );

            if (response.ok) {
                results.push(...batch.map(url => ({ engine: 'Bing', url, success: true })));
            } else {
                const errorText = await response.text();
                results.push(...batch.map(url => ({ engine: 'Bing', url, success: false, error: errorText })));
            }
        } catch (error) {
            results.push(...batch.map(url => ({ engine: 'Bing', url, success: false, error: String(error) })));
        }
    }

    return results;
}

// ─── IndexNow (Bing, Yandex, Seznam, Naver) ─────────────────────────────────

/**
 * P2 #20: thin adapter over lib/indexnow.ts — the single IndexNow client.
 *
 * This module used to carry its own copy of the protocol, and the two drifted:
 * this one read INDEXNOW_API_KEY (the other INDEXNOW_KEY), skipped the
 * same-host filter and the 10,000-URL cap, logged nothing, and reported every
 * URL as submitted even when the engine had silently dropped the off-host
 * ones. Everything below is now shape-mapping: the caller-visible
 * `IndexResult[]` contract is unchanged, but the request itself — key
 * resolution, host filtering, cap, logging, error handling — happens in one
 * place for every caller.
 */
export async function pingIndexNow(urls: string | string[]): Promise<IndexResult[]> {
    const urlList = Array.isArray(urls) ? urls : [urls];
    if (urlList.length === 0) return [];

    const result = await submitToIndexNow(urlList);

    // Only URLs that were actually accepted into the submission can be
    // reported as successful — the rest were filtered out client-side.
    const accepted = new Set(result.accepted);
    const error = result.ok
        ? 'not submitted (off-host or over the 10,000-URL cap)'
        : indexNowFailureMessage(result.reason);

    return urlList.map(url =>
        result.ok && accepted.has(url)
            ? { engine: 'IndexNow', url, success: true }
            : { engine: 'IndexNow', url, success: false, error }
    );
}

/** Human-readable text for the shared client's machine-readable reason code. */
function indexNowFailureMessage(reason?: string): string {
    switch (reason) {
        case 'no_key':
            return 'INDEXNOW_KEY / INDEXNOW_API_KEY not set';
        case 'no_same_host_urls':
            return `no URLs on ${INDEXNOW_HOST}`;
        case 'network_error':
            return 'network error reaching IndexNow';
        default:
            return reason ? `IndexNow rejected the batch (${reason})` : 'IndexNow rejected the batch';
    }
}

// ─── Unified Ping ────────────────────────────────────────────────────────────

/**
 * Ping all configured search engines for a single URL.
 * Fire-and-forget safe — never throws.
 */
export async function pingAllSearchEngines(url: string): Promise<IndexResult[]> {
    const results = await Promise.allSettled([
        pingGoogle(url),
        pingBing(url),
        pingIndexNow(url),
    ]);

    const flat: IndexResult[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            if (Array.isArray(result.value)) {
                flat.push(...result.value);
            } else {
                flat.push(result.value);
            }
        }
    }

    // Log results
    for (const r of flat) {
        if (r.success) {
            console.log(`[Indexing] ✅ ${r.engine}: ${r.url}`);
        } else {
            console.log(`[Indexing] ❌ ${r.engine}: ${r.url} — ${r.error}`);
        }
    }

    return flat;
}

/**
 * Ping all configured search engines for multiple URLs in batch.
 * Uses the CREATION quota (100/day) — for new/updated jobs only.
 */
export async function pingAllSearchEnginesBatch(urls: string[]): Promise<{
    google: IndexResult[];
    bing: IndexResult[];
    indexNow: IndexResult[];
}> {
    // Google: must be individual (no batch API)
    // GSC Fix: Split 200/day quota — 100 for new jobs, 100 for expired.
    // This ensures expired jobs are ALWAYS de-indexed, not starved by new submissions.
    const GOOGLE_CREATION_CAP = 100;
    const googleUrls = urls.slice(0, GOOGLE_CREATION_CAP);
    const googleResults: IndexResult[] = [];
    for (const url of googleUrls) {
        const result = await pingGoogle(url);
        googleResults.push(result);
        // Small delay between Google requests
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Bing: batch submit
    const bingResults = await pingBingBatch(urls);

    // IndexNow: batch submit (up to 10,000 at once)
    const indexNowResults = await pingIndexNow(urls);

    return {
        google: googleResults,
        bing: bingResults,
        indexNow: indexNowResults,
    };
}

/**
 * Ping all search engines to DE-INDEX expired URLs.
 * Uses the DELETION quota (100/day) — kept separate from creation quota
 * so expired jobs are always reliably removed from Google.
 */
export async function pingAllSearchEnginesBatchDeleted(urls: string[]): Promise<{
    google: IndexResult[];
    indexNow: IndexResult[];
}> {
    const GOOGLE_DELETION_CAP = 100;
    const googleUrls = urls.slice(0, GOOGLE_DELETION_CAP);
    const googleResults: IndexResult[] = [];
    for (const url of googleUrls) {
        const result = await pingGoogle(url, 'URL_DELETED');
        googleResults.push(result);
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // IndexNow for batch de-indexing (Bing, Yandex, etc.)
    const indexNowResults = await pingIndexNow(urls);

    return {
        google: googleResults,
        indexNow: indexNowResults,
    };
}

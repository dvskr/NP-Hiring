/**
 * IndexNow client — the board's ONLY IndexNow implementation.
 *
 * P2 #20: there used to be two. lib/search-indexing.ts carried a second,
 * divergent client (different endpoint casing, no same-host filter, no 10k
 * cap, no logging, and it read a different env var), so which behaviour a
 * caller got depended on which module it happened to import. That module now
 * delegates here and only maps the result into its own per-URL
 * `IndexResult[]` shape; all protocol handling lives in this file.
 *
 * IndexNow is a free protocol supported by Bing, Yandex, Seznam, and
 * Naver (and indirectly Google via Bing's API surface) that lets a
 * site signal "this URL just changed, please re-crawl." It removes the
 * "wait days for Google to notice your enriched content" problem.
 *
 * Protocol summary:
 *   - Host a key file at /{key}.txt containing the key (already in /public).
 *   - POST a JSON body listing URLs to the endpoint.
 *   - Rate limit: 10,000 URLs per day per host. Engines de-prioritize
 *     sites that spam.
 *
 * Env requirements:
 *   - INDEXNOW_KEY: 32-128 char hex string. Must match the file at /key.txt.
 *
 * Behavior:
 *   - When the key is missing, calls become no-ops (logged) so dev /
 *     preview environments don't pollute the daily quota.
 *   - All URLs must be on the configured host. Cross-host pings are
 *     rejected by the API anyway, so we filter client-side.
 */

import { brand } from '@/config/brand';
import { logger } from './logger';

const ENDPOINT = 'https://api.indexnow.org/IndexNow';
const HOST = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl;

function getKey(): string | null {
  // Historically this module read INDEXNOW_KEY while lib/search-indexing.ts
  // read INDEXNOW_API_KEY — with only one var set, half the indexing
  // pipeline silently no-oped while reporting success. Accept either
  // (own name first) so a single configured key works everywhere;
  // scripts/fork-preflight.ts still warns until both are set identically.
  const key = process.env.INDEXNOW_KEY || process.env.INDEXNOW_API_KEY;
  if (!key || key.length < 8) return null;
  return key;
}

/** Engines cap a submission at 10,000 URLs per host per day. */
const MAX_URLS_PER_SUBMISSION = 10_000;

function sameHost(urls: string[]): string[] {
  const host = new URL(HOST).host;
  return urls.filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
}

export interface IndexNowSubmission {
  /** True when the engine accepted the batch (HTTP 200/202). */
  ok: boolean;
  /** How many URLs were actually sent. */
  submitted: number;
  /** Machine-readable failure cause; absent on success. */
  reason?: string;
  /** The URLs that were sent — same-host, capped. */
  accepted: string[];
  /**
   * URLs dropped before the request: wrong host, unparseable, or past the
   * per-submission cap. Callers that report per-URL outcomes (see
   * lib/search-indexing.ts) need this to avoid claiming success for a URL
   * that was never submitted.
   */
  rejected: string[];
}

/**
 * Submit a list of URLs to IndexNow. Async + fire-and-forget-safe — the
 * caller can await for telemetry or ignore the promise. Throws only on
 * programmer error (no key when expected); network failures resolve
 * with `{ ok: false }` so the caller doesn't crash a cron.
 */
export async function pingIndexNow(urls: string[]): Promise<IndexNowSubmission> {
  if (urls.length === 0) return { ok: true, submitted: 0, accepted: [], rejected: [] };

  const filtered = sameHost(urls).slice(0, MAX_URLS_PER_SUBMISSION);
  const sent = new Set(filtered);
  const rejected = urls.filter((u) => !sent.has(u));

  if (filtered.length === 0) {
    return { ok: false, submitted: 0, reason: 'no_same_host_urls', accepted: [], rejected };
  }

  const key = getKey();
  if (!key) {
    logger.info('IndexNow ping skipped — INDEXNOW_KEY not set', { count: filtered.length });
    return { ok: false, submitted: 0, reason: 'no_key', accepted: [], rejected: urls };
  }

  const host = new URL(HOST).host;
  const body = {
    host,
    key,
    keyLocation: `${HOST}/${key}.txt`,
    urlList: filtered,
  };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 202) {
      // IndexNow returns 200/202 on accept, 4xx on host mismatch / key error.
      const text = await res.text().catch(() => '');
      logger.warn('IndexNow rejected', { status: res.status, body: text.slice(0, 200) });
      return { ok: false, submitted: 0, reason: `http_${res.status}`, accepted: [], rejected: urls };
    }
    return { ok: true, submitted: filtered.length, accepted: filtered, rejected };
  } catch (err) {
    logger.warn('IndexNow network error', { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, submitted: 0, reason: 'network_error', accepted: [], rejected: urls };
  }
}

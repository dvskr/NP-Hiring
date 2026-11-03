/**
 * Client ID Metadata Documents (design 2.4; draft-ietf-oauth-client-id-
 * metadata-document): a client_id that is an https URL names a JSON document
 * describing the client, fetched from that URL.
 *
 * SECURITY: the fetch is a request this server makes to a URL a stranger
 * chose, so it is boxed in: an allowlisted host only (claude.ai, chatgpt.com
 * and MCP_OAUTH_CIMD_HOSTS), the URL in canonical form with a path and no
 * userinfo, port, fragment or dot segment, redirects refused, 3 seconds, and
 * at most 5 KB read. The document must name itself (client_id equal to the
 * URL), list 1 to 10 https or loopback redirect URIs and carry no
 * client_secret field. Good documents are cached for at most 5 minutes;
 * failures never are. tests/oauth/cimd.test.ts
 */
import { z } from 'zod';
import { asJsonObject } from '@/lib/request-body';
import {
    CIMD_CACHE_MAX_ENTRIES,
    CIMD_CACHE_TTL_MS,
    CIMD_FETCH_TIMEOUT_MS,
    CIMD_MAX_BYTES,
    CIMD_MAX_REDIRECT_URIS,
    MAX_CLIENT_ID_LENGTH,
    MAX_CLIENT_NAME_LENGTH,
    cimdHosts,
} from '@/lib/oauth/config';
import { cleanClientName } from '@/lib/oauth/client-name';
import { readStreamText } from '@/lib/oauth/http';
import { isAcceptableCimdRedirectUri } from '@/lib/oauth/redirect-uri';

export interface ClientMetadataDocument {
    clientId: string;
    clientName: string;
    redirectUris: string[];
}

export type CimdFailure = 'url' | 'host' | 'fetch' | 'status' | 'too_large' | 'not_json' | 'document';

export type CimdResult = { ok: true; document: ClientMetadataDocument } | { ok: false; reason: CimdFailure };

/** The fetch the document is read with: globalThis.fetch, or a fake in tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface CimdOptions {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    now?: number;
}

const CimdDocumentSchema = z.object({
    client_id: z.string(),
    redirect_uris: z.array(z.string()).min(1).max(CIMD_MAX_REDIRECT_URIS),
    client_name: z.unknown().optional(),
    // Every CIMD client is treated as public: PKCE binds the code, and only
    // "none" is advertised. private_key_jwt is accepted in the document so a
    // client that also supports it is not refused.
    token_endpoint_auth_method: z.enum(['none', 'private_key_jwt']).optional(),
});

/** A single-dot or double-dot path segment, plain or percent-encoded. */
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;

interface CachedDocument {
    document: ClientMetadataDocument;
    expiresAt: number;
}

const cache = new Map<string, CachedDocument>();

/** Empties the document cache (tests). */
export function clearClientMetadataCache(): void {
    cache.clear();
}

export function isCimdClientId(clientId: string): boolean {
    return clientId.startsWith('https://');
}

/**
 * The client_id as a URL when it may name a metadata document, else null.
 * Canonical form only (the parsed href must equal the string): that refuses
 * dot segments, which the URL parser would silently resolve, a default port,
 * uppercase host letters and every other spelling of the same URL, so the
 * exact client_id comparison below cannot be dodged.
 */
export function parseCimdUrl(clientId: string): URL | null {
    if (clientId.length > MAX_CLIENT_ID_LENGTH || clientId.includes('#') || /[\s\\]/.test(clientId)) return null;
    let url: URL;
    try {
        url = new URL(clientId);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.pathname === '/' || url.href !== clientId) return null;
    const rawPath = clientId.slice(`https://${url.host}`.length).split('?')[0];
    if (DOT_SEGMENT.test(rawPath)) return null;
    return url;
}

/** How long a fetched document may be cached: 5 minutes, less when Cache-Control says so, 0 for no-store or no-cache. */
export function documentCacheTtlMs(cacheControl: string | null): number {
    if (!cacheControl) return CIMD_CACHE_TTL_MS;
    const directives = cacheControl.toLowerCase().split(',').map((directive) => directive.trim());
    if (directives.includes('no-store') || directives.includes('no-cache')) return 0;
    for (const directive of directives) {
        const maxAge = /^max-age=(\d+)$/.exec(directive);
        if (maxAge) return Math.min(CIMD_CACHE_TTL_MS, Number(maxAge[1]) * 1000);
    }
    return CIMD_CACHE_TTL_MS;
}

/** The validated document, or null (design 2.4). */
export function readClientMetadataDocument(parsed: unknown, clientId: string, host: string): ClientMetadataDocument | null {
    const object = asJsonObject(parsed);
    if (!object) return null;
    if (Object.keys(object).some((key) => key.startsWith('client_secret'))) return null;
    const result = CimdDocumentSchema.safeParse(object);
    if (!result.success) return null;
    const { client_id: documentClientId, redirect_uris: redirectUris, client_name: rawName } = result.data;
    if (documentClientId !== clientId) return null;
    if (!redirectUris.every(isAcceptableCimdRedirectUri)) return null;
    const name = cleanClientName(rawName);
    return {
        clientId,
        clientName: name !== null && name.length <= MAX_CLIENT_NAME_LENGTH ? name : host,
        redirectUris: [...new Set(redirectUris)],
    };
}

function remember(clientId: string, document: ClientMetadataDocument, expiresAt: number): void {
    if (cache.size >= CIMD_CACHE_MAX_ENTRIES && !cache.has(clientId)) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(clientId, { document, expiresAt });
}

/** The client's metadata document, from the cache or fetched (see the header for every rule). */
export async function fetchClientMetadata(clientId: string, options: CimdOptions = {}): Promise<CimdResult> {
    const url = parseCimdUrl(clientId);
    if (!url) return { ok: false, reason: 'url' };
    if (!cimdHosts().includes(url.hostname)) return { ok: false, reason: 'host' };

    const now = options.now ?? Date.now();
    const cached = cache.get(clientId);
    if (cached && cached.expiresAt > now) return { ok: true, document: cached.document };
    if (cached) cache.delete(clientId);

    const fetchImpl: FetchLike = options.fetchImpl ?? globalThis.fetch;
    let response: Response;
    try {
        response = await fetchImpl(clientId, {
            method: 'GET',
            redirect: 'error',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(options.timeoutMs ?? CIMD_FETCH_TIMEOUT_MS),
        });
    } catch {
        return { ok: false, reason: 'fetch' };
    }
    if (response.status !== 200) {
        // Nothing of a refused answer is read; a failed cancel changes nothing.
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, reason: 'status' };
    }

    const body = await readStreamText(response.body, CIMD_MAX_BYTES);
    if (!body.ok) return { ok: false, reason: body.reason === 'too_large' ? 'too_large' : 'fetch' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.text);
    } catch {
        return { ok: false, reason: 'not_json' };
    }
    const document = readClientMetadataDocument(parsed, clientId, url.hostname);
    if (!document) return { ok: false, reason: 'document' };

    const ttl = documentCacheTtlMs(response.headers.get('cache-control'));
    if (ttl > 0) remember(clientId, document, now + ttl);
    return { ok: true, document };
}

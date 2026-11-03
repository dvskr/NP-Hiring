/**
 * Client ID Metadata Documents (lib/oauth/cimd.ts, design 2.4). Every fetch
 * goes through an injected fake: no test touches the network.
 *
 * Pinned: the URL rules (https, a path, no userinfo, port, fragment or dot
 * segment, canonical form) and the host allowlist, checked before any fetch;
 * the fetch options (redirect refused, Accept JSON, a timeout); the body
 * cap; the document rules (client_id equal to the URL, 1 to 10 acceptable
 * redirect URIs, no client_secret field, a cleaned client_name falling back
 * to the host); caching of good documents only, never past a shorter
 * max-age, never with no-store.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
    clearClientMetadataCache,
    documentCacheTtlMs,
    fetchClientMetadata,
    parseCimdUrl,
    type FetchLike,
} from '@/lib/oauth/cimd';
import { CLAUDE_CLIENT_ID, CLAUDE_REDIRECT, useOAuthEnv } from './support/fixtures';

function documentFor(clientId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        client_id: clientId,
        client_name: 'Claude',
        redirect_uris: [CLAUDE_REDIRECT, 'https://claude.com/api/mcp/auth_callback'],
        token_endpoint_auth_method: 'none',
        ...overrides,
    };
}

/** A fake fetch answering `body` (an object is sent as JSON) with `init`. */
function answering(body: unknown, init: ResponseInit = {}): Mock<FetchLike> {
    return vi.fn<FetchLike>(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init }));
}

beforeEach(() => {
    useOAuthEnv();
    clearClientMetadataCache();
});

describe('the client_id URL', () => {
    it('accepts a canonical https URL with a path', () => {
        expect(parseCimdUrl(CLAUDE_CLIENT_ID)?.hostname).toBe('claude.ai');
        expect(parseCimdUrl('https://chatgpt.com/oauth/client.json?v=1')).not.toBeNull();
    });

    it('refuses http, no path, userinfo, a port, a fragment, dot segments and non-canonical spellings', () => {
        for (const id of [
            'http://claude.ai/oauth/meta',
            'https://claude.ai',
            'https://claude.ai/',
            'https://user@claude.ai/oauth/meta',
            'https://user:pw@claude.ai/oauth/meta',
            'https://claude.ai:8443/oauth/meta',
            'https://claude.ai:443/oauth/meta',
            'https://claude.ai/oauth/meta#x',
            'https://claude.ai/oauth/../meta',
            'https://claude.ai/oauth/./meta',
            'https://claude.ai/oauth/%2e%2e/meta',
            'https://claude.ai/oauth/%2E/meta',
            'https://CLAUDE.ai/oauth/meta',
            'https://claude.ai/oauth meta',
            'https://claude.ai\\oauth\\meta',
            `https://claude.ai/${'a'.repeat(520)}`,
        ]) {
            expect(parseCimdUrl(id), id).toBeNull();
        }
    });

    it('refuses a host outside the allowlist without fetching', async () => {
        const fetchImpl = answering(documentFor('https://evil.example/oauth/meta'));
        const result = await fetchClientMetadata('https://evil.example/oauth/meta', { fetchImpl });
        expect(result).toEqual({ ok: false, reason: 'host' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('a subdomain of an allowed host is not allowed', async () => {
        const fetchImpl = answering(documentFor('https://evil.claude.ai/meta'));
        expect(await fetchClientMetadata('https://evil.claude.ai/meta', { fetchImpl })).toEqual({ ok: false, reason: 'host' });
    });

    it('MCP_OAUTH_CIMD_HOSTS adds hosts', async () => {
        process.env.MCP_OAUTH_CIMD_HOSTS = 'clients.example.org';
        const id = 'https://clients.example.org/meta.json';
        const result = await fetchClientMetadata(id, { fetchImpl: answering(documentFor(id)) });
        expect(result.ok).toBe(true);
    });
});

describe('the fetch', () => {
    it('refuses redirects, asks for JSON and sets a timeout', async () => {
        const fetchImpl = answering(documentFor(CLAUDE_CLIENT_ID));
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(CLAUDE_CLIENT_ID);
        expect(init.redirect).toBe('error');
        expect(init.method).toBe('GET');
        expect(new Headers(init.headers).get('accept')).toBe('application/json');
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('a redirect (the fetch rejects under redirect: error) is a failure', async () => {
        const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
            if (init.redirect === 'error') throw new TypeError('fetch failed: redirect mode is set to error');
            return new Response(JSON.stringify(documentFor(CLAUDE_CLIENT_ID)));
        });
        expect(await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl })).toEqual({ ok: false, reason: 'fetch' });
    });

    it('a 3xx or any other non-200 answer is a failure', async () => {
        for (const status of [301, 302, 404, 500]) {
            const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status, headers: { Location: 'https://evil.example/' } }));
            expect(await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl }), String(status)).toEqual({ ok: false, reason: 'status' });
        }
    });

    it('a slow server is abandoned at the timeout', async () => {
        const fetchImpl = vi.fn<FetchLike>(
            (_url, init) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
                }),
        );
        expect(await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl, timeoutMs: 20 })).toEqual({ ok: false, reason: 'fetch' });
    });

    it('a body over 5 KB is refused, even one that streams without a length', async () => {
        const big = JSON.stringify(documentFor(CLAUDE_CLIENT_ID, { padding: 'x'.repeat(6000) }));
        expect(await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(big) })).toEqual({ ok: false, reason: 'too_large' });

        let pulled = 0;
        const endless = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled += 1;
                controller.enqueue(new Uint8Array(1024).fill(0x20));
            },
        });
        const result = await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: vi.fn<FetchLike>(async () => new Response(endless)) });
        expect(result).toEqual({ ok: false, reason: 'too_large' });
        expect(pulled).toBeLessThan(10);
    });

    it('a body just under 5 KB is read', async () => {
        const doc = documentFor(CLAUDE_CLIENT_ID);
        const base = JSON.stringify(doc).length;
        const padded = JSON.stringify({ ...doc, padding: 'x'.repeat(5 * 1024 - base - 20) });
        expect(padded.length).toBeLessThanOrEqual(5 * 1024);
        expect((await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(padded) })).ok).toBe(true);
    });

    it('a body that is not JSON is refused', async () => {
        expect(await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering('<html>hello</html>') })).toEqual({ ok: false, reason: 'not_json' });
    });
});

describe('the document', () => {
    it('a good document resolves to the client', async () => {
        const result = await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(documentFor(CLAUDE_CLIENT_ID)) });
        expect(result).toEqual({
            ok: true,
            document: {
                clientId: CLAUDE_CLIENT_ID,
                clientName: 'Claude',
                redirectUris: [CLAUDE_REDIRECT, 'https://claude.com/api/mcp/auth_callback'],
            },
        });
    });

    it('client_id must equal the URL exactly', async () => {
        for (const clientId of [`${CLAUDE_CLIENT_ID}/`, 'https://claude.ai/oauth/other', CLAUDE_CLIENT_ID.toUpperCase()]) {
            const result = await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(documentFor(clientId)) });
            expect(result, clientId).toEqual({ ok: false, reason: 'document' });
        }
    });

    it('any client_secret field is refused', async () => {
        for (const field of ['client_secret', 'client_secret_expires_at']) {
            const doc = documentFor(CLAUDE_CLIENT_ID, { [field]: field === 'client_secret' ? 's3cret' : 0 });
            expect(await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(doc) }), field).toEqual({ ok: false, reason: 'document' });
        }
    });

    it('redirect_uris must be 1 to 10 https or loopback URIs', async () => {
        const bad = [
            [],
            Array.from({ length: 11 }, (_, i) => `https://claude.ai/cb/${i}`),
            ['javascript:alert(1)'],
            ['http://claude.ai/cb'],
            ['https://claude.ai/cb#frag'],
            [42],
            'https://claude.ai/cb',
        ];
        for (const redirect_uris of bad) {
            const doc = documentFor(CLAUDE_CLIENT_ID, { redirect_uris });
            expect(await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(doc) }), JSON.stringify(redirect_uris)).toEqual({ ok: false, reason: 'document' });
        }
        const ten = Array.from({ length: 10 }, (_, i) => `https://claude.ai/cb/${i}`);
        expect((await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(documentFor(CLAUDE_CLIENT_ID, { redirect_uris: ten })) })).ok).toBe(true);
    });

    it('token_endpoint_auth_method may be absent, none or private_key_jwt, nothing else', async () => {
        for (const method of [undefined, 'none', 'private_key_jwt']) {
            clearClientMetadataCache();
            const doc = documentFor(CLAUDE_CLIENT_ID, { token_endpoint_auth_method: method });
            expect((await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(doc) })).ok, String(method)).toBe(true);
        }
        for (const method of ['client_secret_basic', 'client_secret_post', null]) {
            clearClientMetadataCache();
            const doc = documentFor(CLAUDE_CLIENT_ID, { token_endpoint_auth_method: method });
            expect((await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(doc) })).ok, String(method)).toBe(false);
        }
    });

    it('the document must be a JSON object', async () => {
        for (const body of ['[]', 'null', '"x"', '42']) {
            expect(await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(body) }), body).toEqual({ ok: false, reason: 'document' });
        }
    });

    it('client_name is cleaned and bounded, else the host stands in', async () => {
        const named = async (client_name: unknown): Promise<string | undefined> => {
            clearClientMetadataCache();
            const result = await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: answering(documentFor(CLAUDE_CLIENT_ID, { client_name })) });
            return result.ok ? result.document.clientName : undefined;
        };
        const rightToLeftOverride = String.fromCharCode(0x202e);
        const zeroWidthSpace = String.fromCharCode(0x200b);
        expect(await named('  Claude  ')).toBe('Claude');
        expect(await named(`Cla${rightToLeftOverride}ude${String.fromCharCode(7)}`)).toBe('Claude');
        expect(await named(`${zeroWidthSpace}Claude${zeroWidthSpace}`)).toBe('Claude');
        expect(await named(undefined)).toBe('claude.ai');
        expect(await named('')).toBe('claude.ai');
        expect(await named(42)).toBe('claude.ai');
        expect(await named('x'.repeat(101))).toBe('claude.ai');
        expect(await named('x'.repeat(100))).toBe('x'.repeat(100));
    });
});

describe('the cache', () => {
    it('a good document is served from memory on the next call', async () => {
        const fetchImpl = answering(documentFor(CLAUDE_CLIENT_ID));
        const now = Date.now();
        expect((await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl, now })).ok).toBe(true);
        expect((await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl, now: now + 60_000 })).ok).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('for at most 5 minutes', async () => {
        const fetchImpl = answering(documentFor(CLAUDE_CLIENT_ID));
        const now = Date.now();
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl, now });
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl, now: now + 5 * 60_000 + 1 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('respects a shorter max-age, and no-store or no-cache', async () => {
        const now = Date.now();
        const shortLived = answering(documentFor(CLAUDE_CLIENT_ID), { headers: { 'Cache-Control': 'public, max-age=30' } });
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: shortLived, now });
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: shortLived, now: now + 31_000 });
        expect(shortLived).toHaveBeenCalledTimes(2);

        clearClientMetadataCache();
        const noStore = answering(documentFor(CLAUDE_CLIENT_ID), { headers: { 'Cache-Control': 'no-store' } });
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: noStore, now });
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: noStore, now });
        expect(noStore).toHaveBeenCalledTimes(2);

        expect(documentCacheTtlMs('max-age=3600')).toBe(5 * 60_000);
        expect(documentCacheTtlMs('no-cache')).toBe(0);
        expect(documentCacheTtlMs(null)).toBe(5 * 60_000);
    });

    it('never caches a failure', async () => {
        const failing = vi.fn<FetchLike>(async () => new Response('nope', { status: 503 }));
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: failing });
        await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: failing });
        expect(failing).toHaveBeenCalledTimes(2);

        const good = answering(documentFor(CLAUDE_CLIENT_ID));
        expect((await fetchClientMetadata(CLAUDE_CLIENT_ID, { fetchImpl: good })).ok).toBe(true);
    });
});

/**
 * HTTP plumbing shared by the OAuth endpoints: JSON answers with no-store and
 * open CORS (the token, registration and revocation endpoints are called by
 * other origins and carry no cookie), the preflight answer, and request body
 * reading with a size cap.
 */
import { NextResponse } from 'next/server';
import { asJsonObject } from '@/lib/request-body';
import { MAX_REQUEST_BODY_BYTES } from '@/lib/oauth/config';
import type { OAuthErrorCode } from '@/lib/oauth/errors';

const NO_STORE: Readonly<Record<string, string>> = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const ANY_ORIGIN: Readonly<Record<string, string>> = { 'Access-Control-Allow-Origin': '*' };

/** A JSON answer that no cache keeps, readable from any origin. */
export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
    return NextResponse.json(body, { status, headers: { ...NO_STORE, ...ANY_ORIGIN, ...headers } });
}

/** `{ error, error_description }`, 400 unless the caller says otherwise. */
export function oauthError(error: OAuthErrorCode, description: string, status = 400): NextResponse {
    return oauthJson({ error, error_description: description }, status);
}

/** 429 `{ error: 'slow_down' }` with Retry-After (design 2.11). */
export function slowDown(retryAfterSeconds: number): NextResponse {
    return oauthJson({ error: 'slow_down' }, 429, { 'Retry-After': String(retryAfterSeconds) });
}

/** 503 for an endpoint that cannot work without MCP_OAUTH_SIGNING_SECRET (design 2.9). */
export function temporarilyUnavailable(): NextResponse {
    return oauthError('temporarily_unavailable', 'The authorization server is not configured.', 503);
}

/** An empty 200 (RFC 7009 revocation). */
export function emptyOk(): NextResponse {
    return new NextResponse(null, { status: 200, headers: { ...NO_STORE, ...ANY_ORIGIN } });
}

/** 204 answer to a CORS preflight. MCP-Protocol-Version is the header browser MCP clients add. */
export function corsPreflight(methods: string): NextResponse {
    return new NextResponse(null, {
        status: 204,
        headers: {
            ...ANY_ORIGIN,
            'Access-Control-Allow-Methods': methods,
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
            'Access-Control-Max-Age': '86400',
        },
    });
}

/** A public discovery document (design 2.2 and 2.3): cacheable for 5 minutes, readable from any origin. */
export function publicJson(body: unknown): NextResponse {
    return NextResponse.json(body, {
        headers: { 'Cache-Control': 'public, max-age=300', ...ANY_ORIGIN },
    });
}

// ── Body reading ───────────────────────────────────────────────────────────

export type TextRead = { ok: true; text: string } | { ok: false; reason: 'too_large' | 'unreadable' };

/**
 * A byte stream decoded as UTF-8, read chunk by chunk and abandoned as soon as
 * it passes maxBytes, so an oversized body is never held in memory whole.
 */
export async function readStreamText(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<TextRead> {
    if (!stream) return { ok: true, text: '' };
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                // The answer is already "too large"; a failed cancel changes nothing.
                await reader.cancel().catch(() => undefined);
                return { ok: false, reason: 'too_large' };
            }
            chunks.push(value);
        }
    } catch {
        return { ok: false, reason: 'unreadable' };
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch {
        return { ok: false, reason: 'unreadable' };
    }
}

/** The request body as text, refused past maxBytes (by Content-Length first, then while reading). */
export async function readBodyText(request: Request, maxBytes: number = MAX_REQUEST_BODY_BYTES): Promise<TextRead> {
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large' };
    return readStreamText(request.body, maxBytes);
}

export type ParamsRead = { ok: true; params: ReadonlyMap<string, string> } | { ok: false; description: string };

const FORM_TYPE = 'application/x-www-form-urlencoded';
const JSON_TYPE = 'application/json';

function own(object: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * The named parameters of a form-encoded (primary) or JSON body, capped at
 * 16 KB (design 2.7). A parameter sent without a value counts as omitted
 * (RFC 6749 section 3.1); a repeated one, or a JSON value that is not a
 * string, is refused. Every other parameter (client_secret, client_assertion
 * included) is ignored and never read.
 */
export async function readOAuthParams(request: Request, keys: readonly string[]): Promise<ParamsRead> {
    const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== FORM_TYPE && contentType !== JSON_TYPE) {
        return { ok: false, description: 'The request body must be form encoded or JSON.' };
    }
    const body = await readBodyText(request);
    if (!body.ok) return { ok: false, description: 'The request body is too large or not readable.' };
    return contentType === FORM_TYPE ? formParams(body.text, keys) : jsonParams(body.text, keys);
}

function formParams(text: string, keys: readonly string[]): ParamsRead {
    const form = new URLSearchParams(text);
    const params = new Map<string, string>();
    for (const key of keys) {
        const values = form.getAll(key);
        if (values.length > 1) return { ok: false, description: `The ${key} parameter is repeated.` };
        if (values.length === 1 && values[0] !== '') params.set(key, values[0]);
    }
    return { ok: true, params };
}

function jsonParams(text: string, keys: readonly string[]): ParamsRead {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, description: 'The request body is not valid JSON.' };
    }
    const object = asJsonObject(parsed);
    if (!object) return { ok: false, description: 'The request body must be a JSON object.' };
    const params = new Map<string, string>();
    for (const key of keys) {
        if (!own(object, key)) continue;
        const value = object[key];
        if (value === null || value === '') continue;
        if (typeof value !== 'string') return { ok: false, description: `The ${key} parameter must be a string.` };
        params.set(key, value);
    }
    return { ok: true, params };
}

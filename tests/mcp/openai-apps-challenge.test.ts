/**
 * GET /.well-known/openai-apps-challenge (OpenAI's domain verification for
 * the plugin): exactly the challenge token as plain text when
 * OPENAI_APPS_CHALLENGE_TOKEN is set, a 404 otherwise, never cached or
 * indexed. Pure route: no database, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/.well-known/openai-apps-challenge/route';

const ENV = 'OPENAI_APPS_CHALLENGE_TOKEN';
let saved: string | undefined;

beforeEach(() => {
    saved = process.env[ENV];
    delete process.env[ENV];
});
afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
});

describe('GET /.well-known/openai-apps-challenge', () => {
    it('is a 404 without the environment variable', async () => {
        const response = await GET();
        expect(response.status).toBe(404);
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toBe('Not found');
    });

    it('answers exactly the token, as plain text, uncached and not indexed', async () => {
        process.env[ENV] = 'oai-apps-verify_7Hq2Lx9.Zp4';
        const response = await GET();
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('oai-apps-verify_7Hq2Lx9.Zp4');
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('trims whitespace a dashboard paste left around the token', async () => {
        process.env[ENV] = '  abc123TOKEN\n';
        const response = await GET();
        expect(await response.text()).toBe('abc123TOKEN');
    });

    it.each([
        ['blank', '   '],
        ['containing a space', 'abc def'],
        ['containing a newline inside', 'abc\ndef'],
        ['with a non-ASCII character', 'tökén'],
        ['longer than 512 characters', 'a'.repeat(513)],
    ])('a misconfigured token (%s) is a 404, never echoed', async (_label, value) => {
        process.env[ENV] = value;
        const response = await GET();
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('Not found');
    });
});

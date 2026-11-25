/**
 * The admin console used to swallow failed API calls.
 *
 * /admin/users applied a role change and a deactivation only `if (res.ok)`
 * with no else, so a 500 left the <select> snapping back with nothing said;
 * /admin/blog did the same for publish and delete; and the jobs, users and
 * blog list loads acted only on `data.success`, so a 429 rendered an empty
 * table as though there were nothing to list. Every console call now goes
 * through lib/admin/admin-fetch.ts, and each list renders a load-error
 * banner with Retry (app/admin/_components/AdminLoadError.tsx).
 *
 * These assert the wrapper's behaviour (a failure of any shape produces a
 * message), render the banner, and pin the properties the pages have to
 * keep: they do not talk to the API without the wrapper, they render their
 * failed-load state, and an editor stays open when its save fails. The page
 * checks read comment-blanked source (tests/helpers/source.ts), because a
 * whole admin page cannot be rendered past its loading state in a unit test.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { adminFetch, describeApiFailure, describeNetworkFailure } from '@/lib/admin/admin-fetch';
import AdminLoadError from '@/app/admin/_components/AdminLoadError';
import { readCode } from '../helpers/source';

const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
});

function stubFetch(body: unknown, status: number): void {
    globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(body === undefined ? null : JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
}

/** En and em dashes, which no console sentence may carry. */
const DASHES = new RegExp('[\\u2013\\u2014]');

describe('adminFetch', () => {
    it('returns the payload for a successful call', async () => {
        stubFetch({ success: true, users: [{ id: 'u1' }] }, 200);
        const result = await adminFetch<{ users: Array<{ id: string }> }>('/api/admin/users');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.users).toHaveLength(1);
    });

    it('reports the server message when a mutation is refused', async () => {
        stubFetch({ success: false, error: 'You cannot change the role of your own account' }, 403);
        const result = await adminFetch('/api/admin/users/u1', { method: 'PATCH' });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe('You cannot change the role of your own account');
    });

    it('treats a 200 carrying success:false as a failure', async () => {
        // Several admin handlers answer 200 with { success: false }. A caller
        // that only checked res.ok read those as applied changes.
        stubFetch({ success: false, error: 'No valid fields provided' }, 200);
        const result = await adminFetch('/api/admin/jobs/j1', { method: 'PATCH' });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe('No valid fields provided');
    });

    it('keeps the status beside the message of a server fault', async () => {
        stubFetch({ success: false, error: 'Failed to update user' }, 500);
        const result = await adminFetch('/api/admin/users/u1', { method: 'PATCH' });
        if (result.ok) throw new Error('a 500 was reported as success');
        expect(result.error).toBe('Failed to update user (HTTP 500)');
    });

    it('explains a throttled request, with the wait when the limiter sent one', async () => {
        stubFetch({ error: 'Too many requests', message: 'Rate limit exceeded.', retryAfter: 42 }, 429);
        const timed = await adminFetch('/api/admin/jobs?page=1');
        if (timed.ok) throw new Error('a 429 was reported as success');
        expect(timed.error).toMatch(/rate limiting/);
        expect(timed.error).toContain('42 seconds');

        // The 429 that made the list render its empty state had no body at all.
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })) as unknown as typeof fetch;
        const bare = await adminFetch('/api/admin/jobs?page=1');
        if (bare.ok) throw new Error('a 429 was reported as success');
        expect(bare.error).toMatch(/rate limiting/);
        expect(bare.error).not.toContain('undefined');
    });

    it('reports a rejected fetch instead of leaving the caller in the dark', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch')) as unknown as typeof fetch;
        const result = await adminFetch('/api/admin/users');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe(describeNetworkFailure(new Error('Failed to fetch')));
    });

    it('never throws, even when fetch itself throws synchronously', async () => {
        globalThis.fetch = vi.fn(() => { throw new TypeError('Invalid URL'); }) as unknown as typeof fetch;
        const result = await adminFetch('/api/admin/users');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('Invalid URL');
    });

    it('refuses a 2xx whose body is not a JSON object', async () => {
        // A proxy error page, an empty body or a truncated response reached
        // the caller as null, which moved the failure to `result.data.jobs`,
        // one line after the early return that clears the spinner.
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response('<html>502 Bad Gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
        ) as unknown as typeof fetch;
        const result = await adminFetch<{ jobs: unknown[] }>('/api/admin/jobs?page=1');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.trim()).not.toBe('');
    });

    it('hands back an object whenever it reports success', async () => {
        for (const body of [null, 'a string', 42, true] as const) {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
            ) as unknown as typeof fetch;
            const result = await adminFetch('/api/admin/jobs');
            if (result.ok) expect(typeof result.data).toBe('object');
        }
    });

    it('never describes a failure with an empty, placeholder or dashed string', () => {
        for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503]) {
            for (const payload of [null, {}, { error: '' }, { error: '   ' }, 'plain text', { retryAfter: 'soon' }]) {
                const message = describeApiFailure(status, payload);
                expect(message.trim().length).toBeGreaterThan(0);
                expect(message).not.toContain('undefined');
                expect(message).not.toContain('[object Object]');
                expect(message).not.toMatch(DASHES);
            }
        }
    });
});

describe('the load-error banner', () => {
    it('says what failed and why, as an alert with a Retry button', () => {
        const html = renderToStaticMarkup(createElement(AdminLoadError, {
            subject: 'The jobs list',
            message: 'The admin API is rate limiting this session. Wait a minute, then retry.',
            onRetry: () => undefined,
        }));
        expect(html).toContain('role="alert"');
        expect(html).toContain('The jobs list did not load');
        expect(html).toContain('rate limiting this session');
        expect(html).toMatch(/<button[^>]*type="button"[^>]*>\s*Retry\s*<\/button>/);
        expect(html).not.toMatch(DASHES);
    });
});

const PAGES = {
    '/admin/jobs': 'app/admin/jobs/page.tsx',
    '/admin/users': 'app/admin/users/page.tsx',
    '/admin/blog': 'app/admin/blog/page.tsx',
} as const;

describe.each(Object.entries(PAGES))('%s', (_route, file) => {
    const src = readCode(file);

    it('reaches its API only through the failure-aware wrapper', () => {
        // A bare fetch() here is the shape the defect had: the caller decides,
        // usually by omission, what a non-ok response means.
        // (The page may import the wrapper's result type beside it.)
        expect(src).toMatch(/import \{[^}]*\badminFetch\b[^}]*\} from '@\/lib\/admin\/admin-fetch'/);
        expect(src.match(/(^|[^A-Za-z.])fetch\s*\(/g) ?? []).toHaveLength(0);
        expect(src).not.toMatch(/if \(res\.ok\)/);
        expect(src).not.toMatch(/if \(data\.success\)/);
    });

    it('keeps a failed load in its own state and renders it with a Retry', () => {
        // The pages' action message clears itself after three seconds; a list
        // that failed to load stays wrong until it is reloaded.
        expect(src).toMatch(/const \[loadError, setLoadError\] = useState/);
        expect(src).toMatch(/setLoadError\(result\.error\)/);
        expect(src).toMatch(/\{loadError && \(\s*<AdminLoadError [^>]*message=\{loadError\}[^>]*onRetry=/);
    });
});

/**
 * The source of `const <name> = async`, up to the next declaration at the
 * same indentation (the next handler of the component).
 */
function handlerBody(src: string, name: string): string {
    const start = src.indexOf(`const ${name} = async`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const indent = src.slice(src.lastIndexOf('\n', start) + 1, start);
    const end = src.indexOf(`\n${indent}const `, start);
    return src.slice(start, end === -1 ? undefined : end);
}

describe('an editor stays open when its save fails', () => {
    it.each([
        ['app/admin/jobs/page.tsx', 'saveEdit', 'setEditingJob(null)', 'editError'],
        ['app/admin/blog/page.tsx', 'savePost', 'setEditorOpen(false)', 'editorError'],
    ])('%s %s', (file, handler, close, errorState) => {
        const src = readCode(file);
        const body = handlerBody(src, handler);
        const failure = body.indexOf('if (!result.ok)');
        expect(failure, 'the save does not branch on its failure').toBeGreaterThan(-1);
        // The failure branch returns before anything closes the editor, and
        // the close happens only on the way past it.
        const bail = body.indexOf('return;', failure);
        expect(bail, 'the failure branch does not return').toBeGreaterThan(failure);
        expect(body.slice(failure, bail)).not.toContain(close);
        expect(body.indexOf(close, bail)).toBeGreaterThan(bail);
        // The reason shows inside the editor, where the admin is looking.
        expect(src).toMatch(new RegExp(`\\{${errorState} && \\(`));
    });
});

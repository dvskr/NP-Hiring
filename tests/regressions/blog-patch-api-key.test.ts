/**
 * PATCH /api/blog checks BLOG_API_KEY in constant time, as POST does.
 *
 * POST compared the bearer key with crypto.timingSafeEqual; PATCH compared it
 * with !==, which stops at the first differing character, so the time to a 401
 * leaks how much of a guessed key was right. PATCH now uses the same
 * comparison. The timing itself cannot be seen from a response, so one test
 * watches timingSafeEqual; the rest pin the answers around it. The length guard
 * compares bytes, not characters: timingSafeEqual throws on buffers of unequal
 * byte length, and a header can carry a two byte character in place of a one
 * byte one, which keeps the string length equal.
 *
 * The blog, indexing and Supabase modules are mocked: nothing here touches a
 * database or the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of ['from', 'update', 'eq', 'select']) chain[name] = vi.fn(() => chain);
    chain.single = vi.fn();
    return { chain, createClient: vi.fn(() => chain), timingSafeEqual: vi.fn() };
});

vi.mock('crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('crypto')>();
    h.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
    return { ...actual, timingSafeEqual: h.timingSafeEqual };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }));
vi.mock('@/lib/blog', () => ({ createBlogPost: vi.fn(), generateUniqueSlug: vi.fn() }));
vi.mock('@/lib/blog-formatter', () => ({ formatBlogContent: vi.fn() }));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));

import { PATCH } from '@/app/api/blog/route';

const KEY = 'blog-key-0123456789abcdef0123456789abcdef';
const POST_ROW = { id: 'post-1', slug: 'my-post', youtube_video_id: 'abc123', image_url: null };
const originalKey = process.env.BLOG_API_KEY;

function patch(authorization: string | null): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (authorization !== null) headers.authorization = authorization;
    return new NextRequest('http://localhost:3000/api/blog', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ slug: 'my-post', youtube_video_id: 'abc123' }),
    });
}

beforeEach(() => {
    process.env.BLOG_API_KEY = KEY;
    h.chain.single.mockResolvedValue({ data: POST_ROW, error: null });
});

afterEach(() => {
    if (originalKey === undefined) delete process.env.BLOG_API_KEY;
    else process.env.BLOG_API_KEY = originalKey;
});

describe('PATCH /api/blog: the API key', () => {
    it('lets the right key through to the update', async () => {
        const res = await PATCH(patch(`Bearer ${KEY}`));

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, post: POST_ROW });
        expect(h.chain.from).toHaveBeenCalledWith('blog_posts');
        expect(h.chain.update).toHaveBeenCalledWith({ youtube_video_id: 'abc123' });
        expect(h.chain.eq).toHaveBeenCalledWith('slug', 'my-post');
    });

    it.each([
        ['no Authorization header', null],
        ['an empty bearer token', 'Bearer '],
        ['a key that is one character short', `Bearer ${KEY.slice(0, -1)}`],
        ['a key with one character too many', `Bearer ${KEY}x`],
        ['a wrong key of the same length', `Bearer ${KEY.slice(0, -1)}x`],
        ['a wrong key that differs in the first character', `Bearer x${KEY.slice(1)}`],
        // Same string length as the key, but three two byte characters make the
        // buffers unequal in length: timingSafeEqual would throw on them.
        ['a key of the same length but a different byte length', `Bearer ééé${KEY.slice(3)}`],
    ])('refuses %s with 401 and builds no client', async (_label, authorization) => {
        const res = await PATCH(patch(authorization));

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
        expect(h.createClient).not.toHaveBeenCalled();
    });

    it('still answers 500 when no key is configured, before it reads the header', async () => {
        delete process.env.BLOG_API_KEY;

        const res = await PATCH(patch(`Bearer ${KEY}`));

        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'BLOG_API_KEY not configured' });
        expect(h.createClient).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/blog: constant time comparison', () => {
    it('compares the provided key with the configured key through timingSafeEqual', async () => {
        await PATCH(patch(`Bearer ${KEY}`));

        expect(h.timingSafeEqual).toHaveBeenCalledTimes(1);
        const [provided, expected] = h.timingSafeEqual.mock.calls[0];
        expect(Buffer.from(provided).toString()).toBe(KEY);
        expect(Buffer.from(expected).toString()).toBe(KEY);
    });

    it('also runs it for a wrong key of the right length, and the answer is still 401', async () => {
        const res = await PATCH(patch(`Bearer ${KEY.slice(0, -1)}x`));

        expect(h.timingSafeEqual).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(401);
    });

    it('does not call it with buffers of unequal length, which would throw', async () => {
        await PATCH(patch(`Bearer ${KEY}x`));
        await PATCH(patch(`Bearer ééé${KEY.slice(3)}`));

        expect(h.timingSafeEqual).not.toHaveBeenCalled();
    });
});

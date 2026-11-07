/**
 * /guides/library renders from a cookie and a query string anyone can type.
 * An unknown or inherited error key ("__proto__", "constructor") must render
 * the page normally, a browser whose purchases were all refunded must not be
 * told to go and find its email, and the page is private: noindex, a
 * referrer for this site only, rendered per request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

vi.mock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({ get: () => ({ value: 'a'.repeat(48) }) }),
}));
vi.mock('@/lib/guides/library', () => ({ loadLibrary: vi.fn() }));

import { loadLibrary } from '@/lib/guides/library';
import GuideLibraryPage, * as libraryPage from '@/app/guides/library/page';

async function render(error?: string): Promise<string> {
    const element = await GuideLibraryPage({ searchParams: Promise.resolve(error === undefined ? {} : { error }) });
    return renderToStaticMarkup(element as ReactElement);
}

beforeEach(() => {
    vi.mocked(loadLibrary).mockResolvedValue({ purchases: [], guides: [] });
});

describe('the library page', () => {
    it('reads this browser\'s library cookie', async () => {
        await render();
        expect(loadLibrary).toHaveBeenCalledWith(['a'.repeat(48)]);
    });

    it('explains a known error', async () => {
        expect(await render('limit')).toContain('download limit');
    });

    it.each(['__proto__', 'constructor', 'toString', 'nonsense'])('ignores the error key %s', async (key) => {
        const html = await render(key);
        expect(html).toContain('Your guide library');
        expect(html).not.toContain('role="alert"');
    });

    it('lists downloads for active purchases', async () => {
        vi.mocked(loadLibrary).mockResolvedValueOnce({
            purchases: [{ id: 'p1', productSlug: 'interview-prep-pack', guideSlugs: ['interview-prep-pack'], purchasedAt: new Date('2026-10-20T12:00:00Z'), revoked: false }],
            guides: ['interview-prep-pack'],
        });
        const html = await render();
        expect(html).toContain('/api/guides/download?guide=interview-prep-pack');
        expect(html).toContain('October 20, 2026');
    });

    it('tells a browser whose purchases were all refunded why there is nothing to download', async () => {
        vi.mocked(loadLibrary).mockResolvedValueOnce({
            purchases: [{ id: 'p1', productSlug: 'interview-prep-pack', guideSlugs: ['interview-prep-pack'], purchasedAt: new Date('2026-10-20T12:00:00Z'), revoked: true }],
            guides: [],
        });
        const html = await render();
        expect(html).toContain('refunded or disputed');
        expect(html).not.toContain('No guides in this browser yet');
    });

    it('shows an empty library a way back to the store', async () => {
        const html = await render();
        expect(html).toContain('No guides in this browser yet');
        expect(html).toContain('href="/guides"');
    });

    it('is private: noindex, a referrer for this site only, rendered per request', () => {
        expect(libraryPage.dynamic).toBe('force-dynamic');
        expect(libraryPage.metadata.robots).toEqual({ index: false, follow: false });
        // Same origin only: the download route needs it from browsers that
        // send no Sec-Fetch-Site, and no other site ever sees this page's
        // address (which holds no token anyway).
        expect(libraryPage.metadata.referrer).toBe('same-origin');
    });

    it('prints no dash', async () => {
        const html = (await render('limit')).replace(/<style[\s\S]*?<\/style>/g, '');
        expect(html).not.toMatch(/[–—]/);
    });
});

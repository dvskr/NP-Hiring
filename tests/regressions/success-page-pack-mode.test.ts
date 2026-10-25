/**
 * /success after a post published with a 5-post pack credit (2027 re-price,
 * phase 3).
 *
 * The preview sends a pack post to /success?mode=pack (a promo post to
 * ?mode=promo; the Employer plan's ?mode=plan went with the plan's posting
 * path). The page says the job is live and posted with the pack, verifies
 * nothing with Stripe (no payment was made), and reports the no-charge post
 * to GA as submit_free_post with posting_mode 'pack'.
 *
 * Effects do not run under renderToStaticMarkup, so the GA call is pinned
 * in the source; the page itself renders from its query string.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';

const query = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query.value) }));
vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return { default: ({ href, children }: { href: string; children?: React.ReactNode }) => createElement('a', { href }, children) };
});
vi.mock('@/lib/analytics', () => ({ trackSubmitFreePost: vi.fn() }));

import SuccessPage from '@/app/success/page';

const render = (search: string): string => {
    query.value = search;
    return renderToStaticMarkup(React.createElement(SuccessPage));
};
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('/success?mode=pack', () => {
    it('says the job is live and posted with the pack, with no payment step', () => {
        const page = text(render('mode=pack&jobId=job-1'));
        expect(page).toContain('Job Posted Successfully!');
        expect(page).toContain(`Your job is live. Posted with your ${config.packPosts}-post pack.`);
        expect(page).not.toMatch(/Payment Successful|Verifying your payment|receipt/i);
        expect(page).not.toMatch(/Employer plan|launch period/i);
    });

    it('leaves the promo page as it was', () => {
        const page = text(render('mode=promo'));
        expect(page).toContain(`Your job is live. Free during our launch period through ${config.promoEndsLabel}.`);
    });

    it("reports the post to GA with posting_mode 'pack', and the promo with 'promo'", () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'app/success/page.tsx'), 'utf8');
        expect(src).toContain("trackSubmitFreePost(jobId, isPackMode ? 'pack' : 'promo');");
        expect(src).not.toContain("'plan'");
    });
});

/**
 * The return from the 5-post pack's Stripe Checkout on /employer/post-pack
 * (app/employer/post-pack/PackCheckoutReturn.tsx; 2027 re-price, phase 3).
 *
 * The client component asks GET /api/verify-pack-session about the session
 * and says what it answered:
 *   paid, with the pack  → the pack is ready: posts left, the date to use
 *                          them by, and a way to post
 *   paid, no pack yet    → payment received (the webhook and the route's
 *                          self-heal record it; the page checks again)
 *   processing           → a delayed payment is settling
 *   unpaid               → the checkout was not completed
 *   an error             → the route's own message
 * The check itself runs in an effect, which renderToStaticMarkup does not
 * run, so each state is seeded (as tests/regressions/renewal-success-archived
 * .test.ts does), and the fetch is pinned in the source.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import { packUseByLabel } from '@/lib/pricing-copy';

const seeded = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return { ...actual, useState: (initial: unknown) => [seeded.state ?? initial, () => undefined] };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return { default: ({ href, children }: { href: string; children?: React.ReactNode }) => createElement('a', { href }, children) };
});

import PackCheckoutReturn from '@/app/employer/post-pack/PackCheckoutReturn';

const EXPIRES = '2028-03-01T12:00:00.000Z';

function render(state: unknown): string {
    seeded.state = state;
    return renderToStaticMarkup(React.createElement(PackCheckoutReturn, { sessionId: 'cs_test_1' }));
}
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('the return from the pack checkout', () => {
    it('checking: says so while the route answers', () => {
        expect(text(render({ kind: 'checking' }))).toContain('Checking your purchase');
    });

    it('paid, with the pack: ready, the posts left and the date to use them by, and a way to post', () => {
        const html = render({ kind: 'ready', pack: { creditsTotal: config.packPosts, creditsRemaining: config.packPosts, expiresAt: EXPIRES } });
        expect(text(html)).toContain(`Your ${config.packPosts}-post pack is ready`);
        expect(text(html)).toContain(`${config.packPosts} of ${config.packPosts} posts left, to use by ${packUseByLabel(new Date(EXPIRES))}.`);
        expect(html).toContain('href="/post-job"');
    });

    it('paid, the pack not recorded yet: payment received', () => {
        expect(text(render({ kind: 'recording' }))).toContain('Payment received');
    });

    it('processing: a delayed payment is settling', () => {
        expect(text(render({ kind: 'processing' }))).toContain('Your payment is processing');
    });

    it('unpaid: the checkout was not completed', () => {
        expect(text(render({ kind: 'unpaid' }))).toContain('This checkout was not completed');
    });

    it("an error: the route's own message", () => {
        expect(text(render({ kind: 'error', message: 'This purchase belongs to a different account.' }))).toContain('This purchase belongs to a different account.');
    });

    it('asks the verify route about this session, and reloads the list once the pack is ready', () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'app/employer/post-pack/PackCheckoutReturn.tsx'), 'utf8');
        expect(src).toContain('/api/verify-pack-session?session_id=${encodeURIComponent(sessionId)}');
        expect(src).toContain('router.refresh()');
    });
});

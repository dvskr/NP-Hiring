/**
 * /admin/post-packs, the 5-post pack back office page (2027 re-price, phase
 * 3; plan section 3.9), and its sidebar link.
 *
 * Rendered with the page's useState values seeded in order (the vitest
 * environment is node only, so effects never run). Pinned:
 *   - each pack shows its account, its posts left or used, its use-by date
 *     (with a date input holding it as YYYY-MM-DD), when it was bought, the
 *     amount and Stripe's invoice;
 *   - a paid pack offers the changes it allows: revoke while posts are left,
 *     restore while a post was spent, a later use-by date; a refunded or
 *     disputed pack offers none (the Stripe webhook settles those);
 *   - the page changes a pack only through PATCH /api/admin/post-packs/:id,
 *     with the three bodies the route takes, and asks before a revoke;
 *   - the admin sidebar links the page.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import { toAdminPackView, type AdminPackView } from '@/lib/post-pack-admin';

const seeded = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: (initial: unknown) => {
            const i = seeded.index++;
            const value = i < seeded.values.length
                ? seeded.values[i]
                : typeof initial === 'function' ? (initial as () => unknown)() : initial;
            return [value, () => undefined];
        },
    };
});

import AdminPostPacksPage from '@/app/admin/post-packs/page';

const NOW = new Date('2027-06-01T12:00:00.000Z');
const EXPIRES = new Date('2028-03-01T12:00:00.000Z');

function pack(overrides: Record<string, unknown> = {}): AdminPackView {
    return toAdminPackView({
        id: 'pack-1',
        userId: 'user-1',
        email: 'owner@clinic.example',
        status: 'paid',
        source: 'stripe',
        creditsTotal: config.packPosts,
        creditsRemaining: 3,
        creditsRevoked: 0,
        amountCents: config.stripePackPriceInCents,
        currency: 'usd',
        purchasedAt: new Date('2027-03-01T12:00:00.000Z'),
        expiresAt: EXPIRES,
        hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc',
        invoicePdfUrl: null,
        invoiceNumber: 'INV-0042',
        stripePaymentIntentId: 'pi_1',
        refundedAt: null,
        updatedAt: new Date('2027-03-01T12:00:00.000Z'),
        ...overrides,
    }, NOW);
}

/** Seeds in the page's useState order: packs, loading, loadError, busyId, actionMsg, useByDrafts, revokeDrafts. */
function render(packs: AdminPackView[]): string {
    seeded.values = [packs, false, null, null, null, {}, {}];
    seeded.index = 0;
    return renderToStaticMarkup(React.createElement(AdminPostPacksPage));
}

const text = (html: string): string =>
    html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** The markup of the table row that carries `marker`. */
function rowOf(html: string, marker: string): string {
    const at = html.indexOf(marker);
    expect(at, marker).toBeGreaterThan(-1);
    return html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at));
}

describe('/admin/post-packs', () => {
    it('shows a paid pack with posts left: its account, posts, use-by date, purchase and the changes it allows', () => {
        const row = rowOf(render([pack()]), 'owner@clinic.example');
        const cells = text(row);

        expect(cells).toContain('user-1');
        expect(cells).toContain(`3 of ${config.packPosts} posts left`);
        expect(cells).toContain('Use by February 29, 2028');
        expect(row).toContain('type="date"');
        expect(row).toContain('value="2028-02-29"');
        expect(cells).toContain('March 1, 2027');
        expect(cells).toContain(config.formatDollars(config.packPrice));
        expect(row).toContain('href="https://invoice.stripe.test/i/abc"');
        expect(cells).toContain('Revoke');
        expect(row).toContain('value="3"');
        expect(cells).toContain('Restore one post');
    });

    it('a used-up pack can be given a post back but has none to revoke', () => {
        const cells = text(rowOf(render([pack({ creditsRemaining: 0 })]), 'owner@clinic.example'));

        expect(cells).toContain(`${config.packPosts} of ${config.packPosts} posts used`);
        expect(cells).toContain('Restore one post');
        expect(cells).not.toMatch(/\bRevoke\b/);
    });

    it.each(['refunded', 'disputed'])('a %s pack offers no change', (status) => {
        const row = rowOf(render([pack({ status, creditsRemaining: 0, creditsRevoked: 3 })]), 'owner@clinic.example');

        expect(text(row)).not.toMatch(/\bRevoke\b|Restore one post/);
        expect(row).not.toContain('type="date"');
    });

    it('no pack yet', () => {
        expect(text(render([]))).toContain('No packs yet.');
    });
});

describe('how the page changes a pack', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/admin/post-packs/page.tsx'), 'utf8');

    it('only through PATCH /api/admin/post-packs/:id, with the bodies the route takes', () => {
        expect(src).toContain("fetch(`/api/admin/post-packs/${encodeURIComponent(pack.id)}`");
        expect(src).toContain("method: 'PATCH'");
        expect(src).toContain("{ action: 'revoke', credits }");
        expect(src).toContain("{ action: 'extend', useBy }");
        expect(src).toContain("{ action: 'restore' }");
    });

    it('asks before a revoke', () => {
        const revoke = src.slice(src.indexOf('const revoke ='), src.indexOf('const activeCount'));
        expect(revoke.indexOf('window.confirm(')).toBeGreaterThan(-1);
        expect(revoke.indexOf('window.confirm(')).toBeLessThan(revoke.indexOf("action: 'revoke'"));
    });
});

describe('the admin sidebar', () => {
    it('links the pack back office', () => {
        const sidebar = fs.readFileSync(path.join(process.cwd(), 'app/admin/_components/AdminSidebar.tsx'), 'utf8');
        expect(sidebar).toContain("{ name: 'Post Packs', href: '/admin/post-packs', icon: Package }");
    });
});

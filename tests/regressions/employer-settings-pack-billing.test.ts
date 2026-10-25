/**
 * Settings, Billing with 5-post packs (2027 re-price, phase 3; plan section
 * 3.9).
 *
 * Pinned, rendering the settings page with its useState values seeded in
 * order (the vitest environment is node only, so effects never run):
 *   - the account's packs are listed above the post rows: "5-post pack", the
 *     posts left of the total (or used), the date to use them by (or the
 *     pack's state), the date bought, the amount, and Stripe's hosted invoice
 *     page in a new tab; "Pending" until the webhook has stored the invoice;
 *   - a post published with a pack credit reads "Pack post", with no invoice
 *     or receipt link of its own: the pack's invoice covers it, and
 *     GET /api/employer/invoice answers 400 for such a post;
 *   - promo and paid posts read as before;
 *   - a failed pack load says so, and an account with no pack and no post
 *     keeps the empty state;
 *   - the page reads the packs from GET /api/employer/post-packs in an
 *     effect of its own, so a failure there never blocks the rest.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import { packUseByLabel } from '@/lib/pricing-copy';
import { toPostPackView, type PostPackView } from '@/lib/post-pack-view';

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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import EmployerSettingsClient from '@/app/employer/settings/EmployerSettingsClient';

const NOW = new Date('2027-06-01T12:00:00.000Z');
const EXPIRES = new Date('2028-03-01T12:00:00.000Z');
const PACK_PRICE = config.formatDollars(config.packPrice);

function pack(overrides: Record<string, unknown> = {}): PostPackView {
    return toPostPackView({
        id: 'pack-1',
        status: 'paid',
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
        ...overrides,
    }, NOW);
}

function payment(overrides: Record<string, unknown> = {}) {
    return {
        id: 'ej-paid',
        jobId: 'job-paid',
        jobTitle: 'Paid Post Role',
        tier: 'Pro',
        status: 'paid',
        isFree: false,
        date: '2027-03-02T12:00:00.000Z',
        expiresAt: '2027-05-01T12:00:00.000Z',
        isActive: true,
        charges: [{
            id: 'ch-1', type: 'new', amountCents: config.postingPrice * 100, currency: 'usd',
            createdAt: '2027-03-02T12:00:00.000Z', invoicePdfUrl: null, hostedInvoiceUrl: null,
            invoiceNumber: null, refundedAt: null,
        }],
        ...overrides,
    };
}

const PACK_POST = payment({ id: 'ej-pack', jobId: 'job-pack', jobTitle: 'Pack Post Role', tier: 'Pack', status: 'pack', isFree: true, charges: [] });
const PROMO_POST = payment({ id: 'ej-promo', jobId: 'job-promo', jobTitle: 'Promo Post Role', status: 'promo', isFree: true, charges: [] });
const PAID_POST = payment();

const PROFILE = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@clinic.example', phone: null, company: 'Clinic' };
const COMPANY = { name: 'Clinic', logoUrl: null, description: null, website: null, contactEmail: 'ada@clinic.example' };
const ALERT_PREFS = { specialties: [], states: [], minExperience: null, workMode: '', isActive: false };

interface BillingState {
    payments?: unknown[];
    packs?: PostPackView[];
    packsFailed?: boolean;
}

/**
 * The settings page on its Billing section. The seeds follow the component's
 * useState order: loading, saving, sendingReset, message, profile, company,
 * payments, packs, packsFailed, alertPrefs, savingAlerts, activeSection.
 */
function renderBilling(state: BillingState): string {
    seeded.values = [
        false, false, false, null, PROFILE, COMPANY,
        state.payments ?? [], state.packs ?? [], state.packsFailed ?? false,
        ALERT_PREFS, false, 'billing',
    ];
    seeded.index = 0;
    return renderToStaticMarkup(React.createElement(EmployerSettingsClient));
}

const text = (html: string): string =>
    html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/** The markup of the table row that carries `marker`. */
function rowOf(html: string, marker: string): string {
    const at = html.indexOf(marker);
    expect(at, marker).toBeGreaterThan(-1);
    const start = html.lastIndexOf('<tr', at);
    const end = html.indexOf('</tr>', at);
    return html.slice(start, end);
}

describe("Settings, Billing: the account's 5-post packs", () => {
    it('lists a pack: the posts left of the total, the date to use them by, bought, the amount, its invoice', () => {
        const html = renderBilling({ packs: [pack()], payments: [PACK_POST] });
        const row = rowOf(html, 'https://invoice.stripe.test/i/abc');
        const cells = text(row);

        expect(text(html)).toContain(`${config.packPosts}-post packs`);
        expect(cells).toContain(`${config.packPosts}-post pack`);
        expect(cells).toContain(`3 of ${config.packPosts} posts left`);
        expect(cells).toContain(`Use by ${packUseByLabel(EXPIRES)}`);
        expect(cells).toContain('March 1, 2027');
        expect(cells).toContain(PACK_PRICE);
        expect(row).toContain('href="https://invoice.stripe.test/i/abc"');
        expect(row).toContain('target="_blank"');
        expect(row).toContain('rel="noopener noreferrer"');
    });

    it('a used-up pack reads "5 of 5 posts used", a refunded one says so, and an invoice not stored yet is pending', () => {
        const html = renderBilling({
            packs: [
                pack({ id: 'pack-2', creditsRemaining: 0 }),
                pack({ id: 'pack-1', status: 'refunded', creditsRemaining: 0, creditsRevoked: 2, hostedInvoiceUrl: null }),
            ],
        });
        const page = text(html);

        expect(page).toContain(`${config.packPosts} of ${config.packPosts} posts used`);
        expect(page).toContain(`3 of 3 posts used`);
        expect(text(rowOf(html, 'Refunded'))).toContain('Pending');
    });

    it('never prints an invoice link that is not https', () => {
        const html = renderBilling({ packs: [pack({ hostedInvoiceUrl: 'javascript:alert(1)' })] });

        expect(html).not.toContain('javascript:');
        expect(text(html)).toContain('Pending');
    });

    it('a failed pack load says so', () => {
        const html = renderBilling({ packsFailed: true, payments: [PAID_POST] });

        expect(text(html)).toContain(`We could not load your ${config.packPosts}-post packs.`);
        expect(html).toContain('role="alert"');
    });

    it('with packs and no post: the packs, and no empty state', () => {
        const page = text(renderBilling({ packs: [pack()] }));

        expect(page).toContain(`3 of ${config.packPosts} posts left`);
        expect(page).not.toContain('No payment history yet.');
    });

    it('with no pack and no post: the empty state, and no pack table', () => {
        const page = text(renderBilling({}));

        expect(page).toContain('No payment history yet.');
        expect(page).not.toContain(`${config.packPosts}-post pack`);
    });
});

describe('Settings, Billing: the post rows', () => {
    it('a post published with a pack credit reads "Pack post", with no invoice or receipt of its own', () => {
        const html = renderBilling({ payments: [PACK_POST], packs: [pack()] });
        const row = rowOf(html, 'Pack Post Role');

        expect(row).toContain('>Pack post</span>');
        expect(row).not.toContain('Free trial');
        expect(row).not.toContain('/api/employer/invoice?jobId=job-pack');
        expect(row).not.toContain('/api/employer/receipt?jobId=job-pack');
        expect(text(row)).toContain('None');
    });

    it('promo and paid posts read as before', () => {
        const html = renderBilling({ payments: [PROMO_POST, PAID_POST] });

        expect(rowOf(html, 'Promo Post Role')).toContain('>Launch promo</span>');
        const paid = rowOf(html, 'Paid Post Role');
        expect(paid).toContain('/api/employer/invoice?jobId=job-paid');
        expect(paid).toContain('/api/employer/receipt?jobId=job-paid');
        expect(html).not.toContain('>Pack post</span>');
    });

    it('with packs, the post rows sit under a heading of their own', () => {
        expect(text(renderBilling({ payments: [PAID_POST], packs: [pack()] }))).toContain('Job posts');
        expect(text(renderBilling({ payments: [PAID_POST] }))).not.toContain('Job posts');
    });
});

describe('Settings, Billing: loading the packs', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/employer/settings/EmployerSettingsClient.tsx'), 'utf8');

    it('reads GET /api/employer/post-packs in an effect of its own, and a failure shows as one', () => {
        const effect = src.slice(src.indexOf("fetch('/api/employer/post-packs')"));
        expect(src).toContain("fetch('/api/employer/post-packs')");
        expect(effect.slice(0, 400)).toContain('setPacksFailed(true)');
        // Not gated with the settings and billing loads that decide whether the page renders.
        const mainLoad = src.slice(src.indexOf('const [settingsRes, billingRes]'), src.indexOf('setLoading(false)'));
        expect(mainLoad).not.toContain('post-packs');
    });
});

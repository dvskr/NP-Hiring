/**
 * A post published with a 5-post pack credit on the employer dashboard (2027
 * re-price, phase 3; plan section 3.9).
 *
 * The row carries a "Pack post" badge, as a promo post carries "Launch
 * promo", and no invoice or receipt link: the post itself was never charged
 * (the pack's own Stripe invoice is in Settings, Billing and on
 * /employer/post-pack; GET /api/employer/invoice answers 400 for a pack
 * post). A pack post renewed since is 'paid' with its own renewal charge, so
 * it gets the invoice links and no badge, like a renewed promo post.
 *
 * Rendered with the dashboard's useState values seeded in order
 * (tests/support/employer-surface-state.ts), as the dashboard render suites do.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EmployerDashboardClient from '@/components/employer/EmployerDashboardClient';
import { RUNS_UNTIL, dashboardProps, dashboardSeeds, jobRow, type DashboardState } from '../support/employer-surface-state';

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
vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return {
        default: ({ href, title, children }: { href: string; title?: string; children?: React.ReactNode }) =>
            createElement('a', { href, title }, children),
    };
});
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/analytics', () => ({ trackBeginCheckout: vi.fn() }));
vi.mock('@/components/ui/ToastProvider', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/employer/UsageWidget', () => ({ default: () => null }));
vi.mock('@/components/employer/ApplicantsTab', () => ({ default: () => null }));
vi.mock('@/components/employer/AnalyticsTab', () => ({ default: () => null }));
vi.mock('@/components/employer/SavedCandidatesTab', () => ({ default: () => null }));
vi.mock('@/components/employer/MessagesTab', () => ({ default: () => null }));

function renderDashboard(state: DashboardState): string {
    seeded.values = dashboardSeeds(state);
    seeded.index = 0;
    return renderToStaticMarkup(React.createElement(EmployerDashboardClient, dashboardProps(state)));
}

/** The markup of one job row: from its title to the next row's. */
function rowOf(html: string, title: string): string {
    const start = html.indexOf(title);
    expect(start, title).toBeGreaterThan(-1);
    const next = html.indexOf('job-row-end', start);
    return next > -1 ? html.slice(start, next) : html.slice(start, start + 6000);
}

const PACK_POST = jobRow({ id: 'job-pack', title: 'Pack Post Role', paymentStatus: 'pack', pricingTier: 'pack', expiresAt: RUNS_UNTIL });
const PAID_POST = jobRow({ id: 'job-paid', title: 'Paid Post Role', paymentStatus: 'paid', pricingTier: 'pro', expiresAt: RUNS_UNTIL });
const RENEWED_PACK_POST = jobRow({ id: 'job-renewed', title: 'Renewed Pack Role', paymentStatus: 'paid', pricingTier: 'pack', expiresAt: RUNS_UNTIL });

describe('the dashboard row of a 5-post pack post', () => {
    it('carries a "Pack post" badge and no invoice or receipt link', () => {
        const html = renderDashboard({ jobs: [PACK_POST], paidPostingAvailable: true });
        const row = rowOf(html, 'Pack Post Role');

        expect(row).toContain('>Pack post</span>');
        expect(row).not.toContain('/api/employer/invoice?jobId=job-pack');
        expect(row).not.toContain('/api/employer/receipt?jobId=job-pack');
        expect(row).not.toContain('Download Invoice');
    });

    it('a paid post keeps its invoice and receipt links, and no pack badge', () => {
        const html = renderDashboard({ jobs: [PAID_POST], paidPostingAvailable: true });

        expect(html).toContain('/api/employer/invoice?jobId=job-paid');
        expect(html).toContain('/api/employer/receipt?jobId=job-paid');
        expect(html).not.toContain('>Pack post</span>');
    });

    it('a pack post renewed since is invoiced for its renewal, and loses the badge like a renewed promo post', () => {
        const html = renderDashboard({ jobs: [RENEWED_PACK_POST], paidPostingAvailable: true });

        expect(html).toContain('/api/employer/invoice?jobId=job-renewed');
        expect(html).not.toContain('>Pack post</span>');
    });
});

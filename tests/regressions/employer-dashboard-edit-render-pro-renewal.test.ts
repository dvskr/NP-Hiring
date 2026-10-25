/**
 * The employer dashboard and the job edit page, rendered: the renewal modal
 * of a post bought at the posting price (2027 re-price).
 *
 * A renewal costs the base price, or the pro price for a post bought at the
 * posting price. The server sends each row's own price (renewalPrice), and
 * the renewal modal on both surfaces prints it and measures its saving from
 * it, never from the other price. Split from
 * employer-dashboard-edit-render.test.ts, which renders every other case of
 * both surfaces, to keep each file under 800 lines; both seed the components
 * from tests/support/employer-surface-state.ts.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import { renewalSavingsLine } from '@/lib/renewal-offer';
import EmployerDashboardClient from '@/components/employer/EmployerDashboardClient';
import EditJobPage from '@/app/jobs/edit/[token]/page';
import {
    BOUGHT_AT_POSTING_PRICE,
    LADDER_START,
    LAST_PROMO_INSTANT,
    OR_POST_AGAIN_FREE,
    SAVINGS_CLAIM,
    dashboardProps,
    dashboardSeeds,
    editPageProps,
    editPageSeeds,
    jobRow,
    type DashboardJob,
    type DashboardState,
    type EditPageState,
} from '../support/employer-surface-state';

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
// The dashboard's other panels and the edit page's editor: none carries the copy under test.
vi.mock('@/components/employer/UsageWidget', () => ({ default: () => null }));
vi.mock('@/components/employer/ApplicantsTab', () => ({ default: () => null }));
vi.mock('@/components/employer/AnalyticsTab', () => ({ default: () => null }));
vi.mock('@/components/employer/SavedCandidatesTab', () => ({ default: () => null }));
vi.mock('@/components/employer/MessagesTab', () => ({ default: () => null }));
vi.mock('react-quill-new', () => ({ default: () => null }));
vi.mock('react-quill-new/dist/quill.snow.css', () => ({}));
vi.mock('@/components/ScreeningQuestionsBuilder', () => ({ default: () => null }));

function renderWith<P extends object>(component: React.ComponentType<P>, props: P, state: unknown[]): string {
    seeded.values = state;
    seeded.index = 0;
    return renderToStaticMarkup(React.createElement(component, props));
}

function renderDashboard(state: DashboardState): string {
    return renderWith(EmployerDashboardClient, dashboardProps(state), dashboardSeeds(state));
}

function renderEditPage(state: EditPageState): string {
    return renderWith(EditJobPage, editPageProps(), editPageSeeds(state));
}

// The first render of each surface pays for everything React and the
// component load on demand; done once here with room to spare (the repo's
// cold-import pattern, as in tests/api/create-checkout-tier.test.ts).
beforeAll(() => {
    renderDashboard({ jobs: [jobRow()], paidPostingAvailable: true });
    renderEditPage({ paidPostingAvailable: true });
}, 60_000);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('employer dashboard: the renewal modal of a post bought at the posting price', () => {
    const post = jobRow(BOUGHT_AT_POSTING_PRICE);
    const open = (nextPostPrice: number | null, jobs: DashboardJob[] = [post]): string =>
        renderDashboard({ jobs, paidPostingAvailable: true, nextPostPrice, renewModalFor: post });

    it("prints the pro price, not the base one", () => {
        for (const now of [LAST_PROMO_INSTANT, LADDER_START]) {
            vi.setSystemTime(now);
            const html = open(config.postingPrice);

            expect(html, now.toISOString()).toContain('>Renew Job Posting</h3>');
            expect(html, now.toISOString()).toContain(`>$${config.proRenewalPrice}</span>`);
            expect(html, now.toISOString()).not.toContain(`>$${config.renewalPrice}</span>`);
        }
    });

    it('once the promo has ended: the saving is measured from the pro price', () => {
        vi.setSystemTime(LADDER_START);
        const saving = renewalSavingsLine({ purchasable: true, nextPostPrice: config.postingPrice, renewalPrice: config.proRenewalPrice, now: LADDER_START });

        expect(saving).toBe(`Save 28% vs. your next new post at $${config.postingPrice}`);
        expect(open(config.postingPrice)).toContain(`>${saving}</p>`);
        expect(open(null)).toContain(`>Save 28% vs. the $${config.postingPrice} post price</p>`);
    });

    it('claims no saving against a next post that costs the same as the renewal, or against a free one', () => {
        vi.setSystemTime(LADDER_START);

        for (const nextPostPrice of [config.introPrice, 0]) {
            const html = open(nextPostPrice);

            expect(html, String(nextPostPrice)).toContain(`>$${config.proRenewalPrice}</span>`);
            expect(html, String(nextPostPrice)).not.toMatch(SAVINGS_CLAIM);
        }
    });

    it('during the promo: no saving is claimed, and the free repost is still offered', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = open(config.postingPrice);

        expect(html).not.toMatch(SAVINGS_CLAIM);
        expect(html).toContain(`${OR_POST_AGAIN_FREE} <a href="/post-job">Post a new job</a>`);
    });

    it('prints the price of the row that was opened, whatever the other rows pay', () => {
        vi.setSystemTime(LADDER_START);
        const promoPost = jobRow({ id: 'job-promo', paymentStatus: 'promo' });

        const html = open(config.postingPrice, [promoPost, post]);

        expect(html).toContain(`>$${config.proRenewalPrice}</span>`);
        expect(html).not.toContain(`>$${config.renewalPrice}</span>`);
    });

    it('a row that arrives without a price falls back to the base renewal, never to "$undefined"', () => {
        vi.setSystemTime(LADDER_START);
        const noPrice = jobRow({ renewalPrice: undefined });

        const html = renderDashboard({ jobs: [noPrice], paidPostingAvailable: true, renewModalFor: noPrice });

        expect(html).toContain(`>$${config.renewalPrice}</span>`);
        expect(html).not.toContain('$undefined');
    });
});

describe('job edit page: the renewal modal of a post bought at the posting price', () => {
    const open = (): string => renderEditPage({ paidPostingAvailable: true, showRenewModal: true, renewalPrice: config.proRenewalPrice });

    it('prints the pro price, not the base one, in both phases', () => {
        for (const now of [LAST_PROMO_INSTANT, LADDER_START]) {
            vi.setSystemTime(now);
            const html = open();

            expect(html, now.toISOString()).toContain('>Renew Job Posting</h3>');
            expect(html, now.toISOString()).toContain(`>$${config.proRenewalPrice}</span>`);
            expect(html, now.toISOString()).not.toContain(`>$${config.renewalPrice}</span>`);
        }
    });

    it('once the promo has ended: the saving against the standard post price is measured from the pro price', () => {
        vi.setSystemTime(LADDER_START);
        const saving = renewalSavingsLine({ purchasable: true, renewalPrice: config.proRenewalPrice, now: LADDER_START });

        expect(saving).toBe(`Save 28% vs. the $${config.postingPrice} post price`);
        expect(open()).toContain(`>${saving}</p>`);
    });

    it('during the promo: no saving is claimed, and the free repost is still offered', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = open();

        expect(html).not.toMatch(SAVINGS_CLAIM);
        expect(html).toContain(`${OR_POST_AGAIN_FREE} <a href="/post-job">Post a new job</a>`);
    });

    it('an answer without a price falls back to the base renewal', () => {
        vi.setSystemTime(LADDER_START);
        // The edit API always sends renewalPrice; the page still never prints $undefined.
        const html = renderEditPage({ paidPostingAvailable: true, showRenewModal: true, renewalPrice: null });

        expect(html).toContain(`>$${config.renewalPrice}</span>`);
        expect(html).not.toContain('$undefined');
    });
});

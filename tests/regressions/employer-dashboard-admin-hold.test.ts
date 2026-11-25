/**
 * A post an admin took down, on the employer dashboard (lib/admin/job-hold.ts).
 *
 * It used to read as "Paused" with an Unpause button the employer could
 * press, and Renew on offer once it ended. Now the row says it was removed
 * and why, in the message the toggle and the renewal checkout answer with;
 * Unpause is disabled with that message as its title; and the row offers no
 * Renew, no Complete payment and no pause hint. A post an employer paused
 * themselves renders as before.
 *
 * Rendered with the dashboard's useState values seeded in order
 * (tests/support/employer-surface-state.ts), as the dashboard render suites do.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EmployerDashboardClient from '@/components/employer/EmployerDashboardClient';
import { ADMIN_HOLD_MESSAGE } from '@/lib/admin/job-hold';
import { EXPIRED_ON, LADDER_START, RUNS_UNTIL, dashboardProps, dashboardSeeds, jobRow, rendered, type DashboardState } from '../support/employer-surface-state';

// The fixtures' dates are fixed (EXPIRED_ON before LADDER_START, RUNS_UNTIL after it), so the clock is
// pinned as in the other dashboard suites: an ended post has ended, a running one is still running,
// whatever day the suite runs.
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LADDER_START);
});

afterEach(() => {
    vi.useRealTimers();
});

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

const HELD_SINCE = '2026-11-20T09:00:00.000Z';
const PAUSE_HINT = 'Pausing hides the listing';
const RENEW_BUTTON = />(Renew|Post Again)<\/button>/;

const HELD_RUNNING = { ...jobRow({ id: 'job-held', title: 'Held Role', isPublished: false, expiresAt: RUNS_UNTIL }), adminHoldAt: HELD_SINCE };
const HELD_ENDED = { ...jobRow({ id: 'job-held-ended', title: 'Held Ended Role', isPublished: false, expiresAt: EXPIRED_ON }), adminHoldAt: HELD_SINCE };
const HELD_UNPAID = { ...jobRow({ id: 'job-held-unpaid', title: 'Held Unpaid Role', isPublished: false, paymentStatus: 'pending', expiresAt: RUNS_UNTIL }), adminHoldAt: HELD_SINCE };
const PAUSED = jobRow({ id: 'job-paused', title: 'Paused Role', isPublished: false, expiresAt: RUNS_UNTIL });
const ENDED = jobRow({ id: 'job-ended', title: 'Ended Role', expiresAt: EXPIRED_ON });

describe('a post an admin took down', () => {
    it('is marked removed and says why, in the words the server answers with', () => {
        const html = renderDashboard({ jobs: [HELD_RUNNING], paidPostingAvailable: true });

        expect(html).toContain('✕ Removed</span>');
        expect(html).not.toContain('⏸ Paused</span>');
        expect(html).toContain(rendered(ADMIN_HOLD_MESSAGE));
        expect(html).not.toContain(PAUSE_HINT);
    });

    it('offers no Unpause: the button is disabled and its title is the same explanation', () => {
        const html = renderDashboard({ jobs: [HELD_RUNNING], paidPostingAvailable: true });

        const button = html.slice(html.lastIndexOf('<button', html.indexOf('Unpause')), html.indexOf('Unpause'));
        expect(button).toContain('disabled=""');
        expect(button).toContain(`title="${rendered(ADMIN_HOLD_MESSAGE)}"`);
    });

    it('offers no Renew once it has ended, where a post with no hold does', () => {
        expect(renderDashboard({ jobs: [HELD_ENDED], paidPostingAvailable: true })).not.toMatch(RENEW_BUTTON);
        expect(renderDashboard({ jobs: [ENDED], paidPostingAvailable: true })).toMatch(RENEW_BUTTON);
    });

    it('offers no way to pay for it either', () => {
        const html = renderDashboard({ jobs: [HELD_UNPAID], paidPostingAvailable: true });

        expect(html).not.toContain('Complete payment');
        expect(html).not.toContain('Post it free');
        expect(html).toContain('✕ Removed</span>');
    });
});

describe('a post its employer paused', () => {
    it('renders as before: Paused, an Unpause it can press, and the pause hint', () => {
        const html = renderDashboard({ jobs: [PAUSED], paidPostingAvailable: true });

        expect(html).toContain('⏸ Paused</span>');
        expect(html).toContain(PAUSE_HINT);
        expect(html).not.toContain(rendered(ADMIN_HOLD_MESSAGE));
        const button = html.slice(html.lastIndexOf('<button', html.indexOf('Unpause')), html.indexOf('Unpause'));
        expect(button).not.toContain('disabled=""');
    });
});

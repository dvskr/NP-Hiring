/**
 * /employer/renewal-success — a renewal applied to an archived post must not
 * read as live.
 *
 * A renewal never puts an archived post back on the board
 * (app/api/webhooks/stripe/apply-renewal.ts): the payment is recorded and the
 * expiry moves, and the post stays unpublished until the employer restores
 * it. The success page said "Your job is now live and visible to candidates"
 * all the same, offered a "View Your Job" link to a page that is not public,
 * and announced a confirmation email that an archived post does not get.
 *
 * Pins, rendering the client page with its fetched state seeded (effects do
 * not run in renderToStaticMarkup, as in
 * tests/regressions/employer-app-promo-phase.test.ts):
 *   - archived (verify-renewal-session returns archivedAt): the page says the
 *     payment was applied and that the post must be restored from the
 *     Archived tab of the dashboard, with no "live" claim, no job link and no
 *     confirmation email claim;
 *   - not archived: the page reads as before, with the posting period taken
 *     from config;
 *   - the dashboard link works without the management token too (a signed in
 *     owner without the checkout cookie gets no token);
 *   - house style: no dash in anything the page prints.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { config } from '@/lib/config';
import RenewalSuccessPage from '@/app/employer/renewal-success/page';

const seeded = vi.hoisted(() => ({ state: undefined as unknown }));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        // The page holds one piece of state: what the verify call answered.
        useState: (initial: unknown) => [seeded.state ?? initial, () => undefined],
    };
});

vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return {
        default: ({ href, children }: { href: string; children?: React.ReactNode }) => createElement('a', { href }, children),
    };
});
vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams('session_id=cs_test_1'),
}));

interface VerifyAnswer {
    jobTitle: string;
    jobSlug: string;
    tier: string;
    dashboardToken?: string;
    tokenDeliveredViaEmail?: boolean;
    archivedAt?: string | null;
}

const ANSWER: VerifyAnswer = { jobTitle: 'Nurse Practitioner', jobSlug: 'nurse-practitioner-job-1', tier: 'pro', dashboardToken: 'dash-token-1', archivedAt: null };

function render(renewalData: VerifyAnswer): string {
    seeded.state = { loading: false, error: null, renewalData };
    return renderToStaticMarkup(React.createElement(RenewalSuccessPage));
}

/** What a visitor reads: the markup without its tags. */
const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('a renewal applied to an archived post', () => {
    const html = () => render({ ...ANSWER, archivedAt: '2026-09-30T12:00:00.000Z' });

    it('says the payment was applied, and that the post must be restored from the Archived tab to go live', () => {
        const text = visibleText(html());
        expect(text).toContain('Renewal Payment Applied');
        expect(text).toContain('Nurse Practitioner');
        expect(text).toMatch(/payment was received and the renewal has been applied/);
        expect(text).toMatch(/This post is archived, so it is not live yet\./);
        expect(text).toMatch(/restore it from the Archived tab of your dashboard, then republish it/);
    });

    it('does not read as live', () => {
        const text = visibleText(html());
        expect(text).not.toMatch(/now live/i);
        expect(text).not.toMatch(/visible to candidates/i);
        expect(text).not.toContain('Job Renewed Successfully');
        expect(text).not.toContain('Featured placement reactivated');
    });

    it('offers the dashboard, not a job page that is not public', () => {
        const markup = html();
        expect(markup).toContain('href="/employer/dashboard/dash-token-1"');
        expect(markup).not.toContain('/jobs/nurse-practitioner-job-1');
        expect(visibleText(markup)).not.toContain('View Your Job');
    });

    it('announces the payment receipt, not a confirmation email it does not get', () => {
        const text = visibleText(html());
        expect(text).not.toMatch(/confirmation email/i);
        expect(text).toMatch(/payment receipt has been sent/);
    });
});

describe('a renewal applied to a live post reads as before', () => {
    it('says the job is live, with the posting period from config, the job link and the confirmation email', () => {
        const markup = render(ANSWER);
        const text = visibleText(markup);
        expect(text).toContain('Job Renewed Successfully');
        expect(text).toContain(`extended for another ${config.durationDays} days`);
        expect(text).toContain('Your job is now live and visible to candidates.');
        expect(text).toContain('A confirmation email has been sent to your inbox.');
        expect(markup).toContain('href="/jobs/nurse-practitioner-job-1"');
        expect(markup).toContain('href="/employer/dashboard/dash-token-1"');
        expect(text).not.toMatch(/archived/i);
    });

    it('an answer without archivedAt (an older response shape) is a live post', () => {
        const withoutField: VerifyAnswer = { jobTitle: ANSWER.jobTitle, jobSlug: ANSWER.jobSlug, tier: ANSWER.tier, dashboardToken: ANSWER.dashboardToken };
        expect(visibleText(render(withoutField))).toContain('Your job is now live and visible to candidates.');
    });
});

describe('the dashboard link', () => {
    it.each([
        ['an archived post', '2026-09-30T12:00:00.000Z'],
        ['a live post', null],
    ])('goes to the signed in dashboard when no management token came back (%s)', (_label, archivedAt) => {
        const markup = render({ jobTitle: 'Nurse Practitioner', jobSlug: 'nurse-practitioner-job-1', tier: 'pro', tokenDeliveredViaEmail: true, archivedAt });
        expect(markup).toContain('href="/employer/dashboard"');
        expect(markup).not.toContain('/employer/dashboard/undefined');
    });
});

describe('house style', () => {
    it.each([
        ['archived', '2026-09-30T12:00:00.000Z'],
        ['live', null],
    ])('the %s page prints no em dash, en dash or spaced hyphen', (_label, archivedAt) => {
        expect(visibleText(render({ ...ANSWER, archivedAt }))).not.toMatch(/[–—]|\s-\s/);
    });
});

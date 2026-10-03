/**
 * lib/employer-dashboard-rules.ts, the job-row rules of the employer
 * dashboard (components/employer/EmployerDashboardClient.tsx).
 *
 * Pinned:
 *   - Renew is offered on a renewable post that has ended or ends soon, and
 *     never on an archived one, whatever its status or timing.
 *   - The archive request names the state the employer chose ({ archived })
 *     instead of toggling, and the row then shows the archivedAt and
 *     isPublished the route answers, not the tab's guess. A stale tab is the
 *     case that matters: its view of the post can be out of date.
 *   - The dashboard calls these rules (static check on the component).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyArchiveResult, archiveRequestBody, shouldOfferRenew } from '@/lib/employer-dashboard-rules';

const ARCHIVED_ON = '2026-09-20T09:00:00.000Z';
const ENDED = { expired: true, expiringSoon: false };
const ENDING_SOON = { expired: false, expiringSoon: true };
const RUNNING = { expired: false, expiringSoon: false };
const RENEWABLE_STATUSES = ['promo', 'paid', 'free', 'free_renewed', 'free_upgraded'];

interface Row {
    id: string;
    title: string;
    paymentStatus: string;
    archivedAt: string | null;
    isPublished: boolean;
}

function row(overrides: Partial<Row> = {}): Row {
    return { id: 'job-1', title: 'PMHNP Outpatient', paymentStatus: 'promo', archivedAt: null, isPublished: true, ...overrides };
}

describe('shouldOfferRenew', () => {
    it.each(RENEWABLE_STATUSES)("offers Renew on a '%s' post that has ended or ends soon", (paymentStatus) => {
        expect(shouldOfferRenew(row({ paymentStatus }), ENDED)).toBe(true);
        expect(shouldOfferRenew(row({ paymentStatus }), ENDING_SOON)).toBe(true);
    });

    it.each(RENEWABLE_STATUSES)("never offers Renew on an archived '%s' post, ended or ending soon", (paymentStatus) => {
        const archived = row({ paymentStatus, archivedAt: ARCHIVED_ON, isPublished: false });

        expect(shouldOfferRenew(archived, ENDED)).toBe(false);
        expect(shouldOfferRenew(archived, ENDING_SOON)).toBe(false);
    });

    it.each(['plan', 'pending', 'refunded'])("never offers Renew on a '%s' post", (paymentStatus) => {
        expect(shouldOfferRenew(row({ paymentStatus }), ENDED)).toBe(false);
        expect(shouldOfferRenew(row({ paymentStatus }), ENDING_SOON)).toBe(false);
    });

    it('offers nothing while the posting window still has time to run', () => {
        expect(shouldOfferRenew(row(), RUNNING)).toBe(false);
    });
});

describe('archiveRequestBody', () => {
    it('asks to archive a row the tab shows live, and to restore a row it shows archived', () => {
        expect(archiveRequestBody(row())).toEqual({ archived: true });
        expect(archiveRequestBody(row({ archivedAt: ARCHIVED_ON, isPublished: false }))).toEqual({ archived: false });
    });
});

describe('applyArchiveResult', () => {
    it('shows an archive as the route stored it', () => {
        const live = row();

        expect(applyArchiveResult(live, { archivedAt: ARCHIVED_ON, isPublished: false })).toEqual(
            row({ archivedAt: ARCHIVED_ON, isPublished: false }),
        );
    });

    it('shows a stale Restore as the live post the route reports, not as restored and unpublished', () => {
        // The tab still showed the post archived; another tab had restored
        // and republished it, so the route answered its stored live state.
        const staleArchived = row({ archivedAt: ARCHIVED_ON, isPublished: false });

        expect(applyArchiveResult(staleArchived, { archivedAt: null, isPublished: true })).toEqual(row());
    });

    it('shows a stale Archive with the stored archive time, not the time this tab guessed', () => {
        const staleLive = row();

        expect(applyArchiveResult(staleLive, { archivedAt: ARCHIVED_ON, isPublished: false })).toMatchObject({
            archivedAt: ARCHIVED_ON,
            isPublished: false,
        });
    });

    it('returns a new row and leaves the one it was given untouched', () => {
        const live = row();
        const before = { ...live };

        const next = applyArchiveResult(live, { archivedAt: ARCHIVED_ON, isPublished: false });

        expect(next).not.toBe(live);
        expect(live).toEqual(before);
    });

    it('without isPublished in the answer, archiving unpublishes and restoring leaves the row as it was', () => {
        expect(applyArchiveResult(row(), { archivedAt: ARCHIVED_ON })).toMatchObject({ archivedAt: ARCHIVED_ON, isPublished: false });
        expect(applyArchiveResult(row({ archivedAt: ARCHIVED_ON, isPublished: false }), { archivedAt: null })).toMatchObject({
            archivedAt: null,
            isPublished: false,
        });
    });
});

describe('the dashboard uses these rules', () => {
    const dashboard = fs.readFileSync(path.join(process.cwd(), 'components/employer/EmployerDashboardClient.tsx'), 'utf8');
    const between = (start: string, end: string): string => {
        const from = dashboard.indexOf(start);
        const to = dashboard.indexOf(end, from);
        expect(from, start).toBeGreaterThan(-1);
        expect(to, end).toBeGreaterThan(from);
        return dashboard.slice(from, to);
    };

    it('the archive request sends the chosen state and the row takes the answer', () => {
        const archive = between('const performArchiveToggle', 'const handleRenewCheckout');

        expect(archive).toContain('body: JSON.stringify(archiveRequestBody(job))');
        expect(archive).toContain('applyArchiveResult(j, result)');
        expect(archive).not.toContain("{ method: 'PATCH' })");
    });

    it('the Renew button follows shouldOfferRenew', () => {
        const rule = between('const shouldShowRenew', 'const handleRenewClick');

        expect(rule).toContain('shouldOfferRenew(job, { expired: isExpired(job), expiringSoon: isExpiringSoon(job) })');
        expect(dashboard).toContain('shouldShowRenew(job) && canOfferRenewAction');
    });
});

/**
 * lib/post-pack-admin.ts — the 5-post pack back office (2027 re-price, phase
 * 3; plan section 3.9): the three changes an admin can make to one pack.
 *
 * Pinned:
 *   - revoke takes back unused posts, all of them or a count, never more
 *     than are left;
 *   - extend moves the "Use by" date later only, into the future, within
 *     the typo guard, and the pack then reads "Use by" exactly that date;
 *   - restore gives back one post the pack spent, never one it never sold;
 *   - only a paid pack is changed: refunded and disputed packs belong to the
 *     webhook;
 *   - each write is a compare-and-set on what it was planned from, and the
 *     result keeps the table's CHECK (remaining and revoked never below zero,
 *     never more used plus revoked than sold).
 */
import { describe, it, expect } from 'vitest';
import { config } from '@/lib/config';
import { packUseByLabel } from '@/lib/pricing-copy';
import {
    ADMIN_PACK_SELECT,
    MAX_USE_BY_YEARS_AHEAD,
    planPackChange,
    toAdminPackView,
    type AdminPackRow,
} from '@/lib/post-pack-admin';
import { POST_PACK_VIEW_SELECT } from '@/lib/post-pack-view';

const NOW = new Date('2027-06-01T12:00:00.000Z');
const EXPIRES = new Date('2028-03-01T12:00:00.000Z');

function pack(overrides: Partial<AdminPackRow> = {}): AdminPackRow {
    return {
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
        hostedInvoiceUrl: null,
        invoicePdfUrl: null,
        invoiceNumber: 'INV-0042',
        stripePaymentIntentId: 'pi_1',
        refundedAt: null,
        updatedAt: new Date('2027-03-01T12:00:00.000Z'),
        ...overrides,
    };
}

/** The CHECK on employer_post_packs, as the migration states it. */
function satisfiesCheck(total: number, remaining: number, revoked: number): boolean {
    return remaining >= 0 && revoked >= 0 && remaining + revoked <= total;
}

describe('the admin view of a pack', () => {
    it('reads the pack view columns plus the account, the source and the Stripe payment', () => {
        expect(ADMIN_PACK_SELECT).toMatchObject(POST_PACK_VIEW_SELECT);
        expect(Object.keys(ADMIN_PACK_SELECT).sort()).toEqual(Object.keys(pack()).sort());
    });

    it('is the pack view, with dates as ISO strings', () => {
        expect(toAdminPackView(pack(), NOW)).toMatchObject({
            id: 'pack-1', state: 'active', remaining: 3, used: 2, total: config.packPosts,
            userId: 'user-1', email: 'owner@clinic.example', source: 'stripe',
            stripePaymentIntentId: 'pi_1', refundedAt: null, updatedAt: '2027-03-01T12:00:00.000Z',
        });
    });
});

describe('revoke', () => {
    it('takes back every unused post by default, written as a compare-and-set on the counters', () => {
        const plan = planPackChange(pack(), { action: 'revoke' }, NOW);

        expect(plan).toEqual({
            ok: true,
            where: { id: 'pack-1', status: 'paid', creditsRemaining: 3, creditsRevoked: 0 },
            data: { creditsRemaining: 0, creditsRevoked: 3 },
            previous: { creditsRemaining: 3, creditsRevoked: 0, expiresAt: EXPIRES },
            next: { creditsRemaining: 0, creditsRevoked: 3, expiresAt: EXPIRES },
        });
    });

    it('takes back a count of them', () => {
        const plan = planPackChange(pack({ creditsRevoked: 1, creditsRemaining: 2 }), { action: 'revoke', credits: 1 }, NOW);

        expect(plan).toMatchObject({ ok: true, data: { creditsRemaining: 1, creditsRevoked: 2 } });
    });

    it('never more than are left, and not from a pack with none', () => {
        expect(planPackChange(pack(), { action: 'revoke', credits: 4 }, NOW)).toEqual({ ok: false, status: 409, error: 'This pack has 3 unused posts.' });
        expect(planPackChange(pack({ creditsRemaining: 1 }), { action: 'revoke', credits: 2 }, NOW)).toEqual({ ok: false, status: 409, error: 'This pack has 1 unused post.' });
        expect(planPackChange(pack({ creditsRemaining: 0 }), { action: 'revoke' }, NOW)).toEqual({ ok: false, status: 409, error: 'This pack has no unused posts to revoke.' });
    });
});

describe('extend', () => {
    it('moves the use-by date later, and the pack then reads "Use by" exactly that date', () => {
        const plan = planPackChange(pack(), { action: 'extend', useBy: '2028-06-30' }, NOW);

        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.where).toEqual({ id: 'pack-1', status: 'paid', expiresAt: EXPIRES });
        const next = plan.data.expiresAt as Date;
        expect(packUseByLabel(next)).toBe('June 30, 2028');
        expect(plan.next).toEqual({ creditsRemaining: 3, creditsRevoked: 0, expiresAt: next });
    });

    it('revives an expired pack with a date in the future', () => {
        const expired = pack({ expiresAt: new Date('2027-05-01T12:00:00.000Z') });

        expect(planPackChange(expired, { action: 'extend', useBy: '2027-09-30' }, NOW).ok).toBe(true);
    });

    it('refuses a date that is not later, not in the future, too far ahead, or not a date', () => {
        // The current use-by date is February 29, 2028.
        expect(planPackChange(pack(), { action: 'extend', useBy: '2028-02-29' }, NOW)).toEqual({ ok: false, status: 409, error: 'Pick a use-by date after the current one.' });
        expect(planPackChange(pack(), { action: 'extend', useBy: '2028-01-15' }, NOW)).toEqual({ ok: false, status: 409, error: 'Pick a use-by date after the current one.' });
        const expired = pack({ expiresAt: new Date('2027-01-01T12:00:00.000Z') });
        expect(planPackChange(expired, { action: 'extend', useBy: '2027-03-01' }, NOW)).toEqual({ ok: false, status: 409, error: 'Pick a use-by date in the future.' });
        expect(planPackChange(pack(), { action: 'extend', useBy: `${2027 + MAX_USE_BY_YEARS_AHEAD}-07-01` }, NOW)).toEqual({ ok: false, status: 409, error: `Pick a use-by date within ${MAX_USE_BY_YEARS_AHEAD} years.` });
        expect(planPackChange(pack(), { action: 'extend', useBy: '2028-02-30' }, NOW)).toEqual({ ok: false, status: 400, error: 'Pick a real date, as YYYY-MM-DD.' });
    });
});

describe('restore', () => {
    it('gives back one post the pack spent', () => {
        const plan = planPackChange(pack(), { action: 'restore' }, NOW);

        expect(plan).toMatchObject({
            ok: true,
            where: { id: 'pack-1', status: 'paid', creditsRemaining: 3, creditsRevoked: 0 },
            data: { creditsRemaining: 4 },
            next: { creditsRemaining: 4, creditsRevoked: 0, expiresAt: EXPIRES },
        });
    });

    it('never one the pack did not spend: a pack with no used post, or one whose others were revoked', () => {
        expect(planPackChange(pack({ creditsRemaining: config.packPosts }), { action: 'restore' }, NOW)).toEqual({ ok: false, status: 409, error: 'This pack has no used posts to restore.' });
        expect(planPackChange(pack({ creditsRemaining: 2, creditsRevoked: 3 }), { action: 'restore' }, NOW)).toEqual({ ok: false, status: 409, error: 'This pack has no used posts to restore.' });
    });
});

describe('every change', () => {
    it.each(['refunded', 'disputed'])('leaves a %s pack to the webhook', (status) => {
        for (const action of [{ action: 'revoke' as const }, { action: 'extend' as const, useBy: '2028-06-30' }, { action: 'restore' as const }]) {
            expect(planPackChange(pack({ status }), action, NOW)).toEqual({ ok: false, status: 409, error: `This pack is ${status}. Only a paid pack can be changed here.` });
        }
    });

    it('keeps the CHECK on the counters', () => {
        const cases: [Partial<AdminPackRow>, Parameters<typeof planPackChange>[1]][] = [
            [{ creditsRemaining: 5 }, { action: 'revoke' }],
            [{ creditsRemaining: 1, creditsRevoked: 2 }, { action: 'revoke', credits: 1 }],
            [{ creditsRemaining: 0, creditsRevoked: 0 }, { action: 'restore' }],
            [{ creditsRemaining: 3, creditsRevoked: 1 }, { action: 'restore' }],
        ];
        for (const [overrides, action] of cases) {
            const plan = planPackChange(pack(overrides), action, NOW);
            expect(plan.ok, JSON.stringify(overrides)).toBe(true);
            if (!plan.ok) continue;
            expect(satisfiesCheck(config.packPosts, plan.next.creditsRemaining, plan.next.creditsRevoked)).toBe(true);
        }
    });
});

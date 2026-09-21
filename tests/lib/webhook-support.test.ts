/**
 * app/api/webhooks/stripe/webhook-support.ts + plan-admin side effects.
 *
 * Pins:
 *   - alertWebhookFailure never ships raw emails / keys to Sentry extras
 *     (sendDefaultPii does not cover explicit extras) or to Discord;
 *   - subscription period helpers read both the root (older API) and the
 *     SubscriptionItem (2025-03-31+) shapes;
 *   - an admin cancel inside the paid period leaves posts live (the lapse
 *     sweep pauses them at period end); a cancel with no paid time left
 *     pauses now.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureException } from '@/lib/sentry';

const discordMocks = vi.hoisted(() => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/discord-notifier', () => discordMocks);

const planMocks = vi.hoisted(() => ({ pausePlanPosts: vi.fn(), resumePlanPosts: vi.fn() }));
vi.mock('@/lib/employer-plan', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/employer-plan')>()), ...planMocks }));

import { alertWebhookFailure, subscriptionPeriodEnd, subscriptionPeriodStart } from '@/app/api/webhooks/stripe/webhook-support';
import { applyPlanStateToPosts } from '@/app/api/admin/employer-plans/plan-admin';

beforeEach(() => {
    vi.clearAllMocks();
    planMocks.pausePlanPosts.mockResolvedValue(['job-1']);
    planMocks.resumePlanPosts.mockResolvedValue([]);
});

describe('alertWebhookFailure — PII discipline', () => {
    it('redacts emails and secret-shaped values from Sentry extras and the Discord body', async () => {
        await alertWebhookFailure('plan checkout matched no employer', null, {
            eventId: 'evt_1',
            email: 'Owner@Clinic.Example',
            note: 'key sk_live_ABCDEFGHIJKLMNOPQRSTUV leaked',
            amountCents: 39900,
        });

        const [, context] = vi.mocked(captureException).mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
        const sentryPayload = JSON.stringify(context.extra);
        expect(sentryPayload).not.toContain('Owner@Clinic.Example');
        expect(sentryPayload).not.toContain('sk_live_ABCDEFGHIJKLMNOPQRSTUV');
        expect(context.extra).toMatchObject({ reason: 'plan checkout matched no employer', eventId: 'evt_1', amountCents: 39900 });

        const discordPayload = JSON.stringify(discordMocks.sendDiscordMessage.mock.calls);
        expect(discordPayload).not.toContain('Owner@Clinic.Example');
        expect(discordPayload).toContain('eventId=evt_1');
    });

    it('never throws when the alert channels fail', async () => {
        discordMocks.sendDiscordMessage.mockRejectedValueOnce(new Error('discord down'));
        await expect(alertWebhookFailure('x', new Error('y'), {})).resolves.toBeUndefined();
    });
});

describe('subscription period helpers', () => {
    it('reads the root fields (older API versions)', () => {
        const sub = { current_period_start: 1_700_000_000, current_period_end: 1_702_592_000, items: { data: [] } };
        expect(subscriptionPeriodStart(sub as never)).toEqual(new Date(1_700_000_000_000));
        expect(subscriptionPeriodEnd(sub as never)).toEqual(new Date(1_702_592_000_000));
    });

    it('reads the SubscriptionItem fields (2025-03-31+ API shape)', () => {
        const sub = { items: { data: [{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] } };
        expect(subscriptionPeriodStart(sub as never)).toEqual(new Date(1_700_000_000_000));
        expect(subscriptionPeriodEnd(sub as never)).toEqual(new Date(1_702_592_000_000));
    });

    it('returns null when neither shape carries the value', () => {
        expect(subscriptionPeriodEnd({ items: { data: [{}] } } as never)).toBeNull();
    });
});

describe('admin applyPlanStateToPosts — cancellation honours the paid period', () => {
    const base = {
        id: 'plan-1', userId: 'user-1', email: 'o@c.example', slots: 5, priceCents: 39900,
        stripeCustomerId: null, stripeSubscriptionId: null, source: 'admin', createdAt: new Date(), updatedAt: new Date(),
    };

    it('leaves posts live for a cancelled plan that is still inside its paid period', async () => {
        const result = await applyPlanStateToPosts({ ...base, status: 'cancelled', currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000) });
        expect(result).toEqual({ resumed: 0, paused: 0 });
        expect(planMocks.pausePlanPosts).not.toHaveBeenCalled();
    });

    it('pauses now for a cancelled plan with no paid time left', async () => {
        const result = await applyPlanStateToPosts({ ...base, status: 'cancelled', currentPeriodEnd: new Date(Date.now() - 1000) });
        expect(result).toEqual({ resumed: 0, paused: 1 });
        expect(planMocks.pausePlanPosts).toHaveBeenCalledWith('user-1', expect.any(Date));
    });
});

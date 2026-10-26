/**
 * app/api/webhooks/stripe/webhook-support.ts.
 *
 * Pins:
 *   - alertWebhookFailure never ships raw emails / keys to Sentry extras
 *     (sendDefaultPii does not cover explicit extras) or to Discord;
 *   - an alert channel that fails never makes the webhook fail harder.
 *
 * (The subscription period helpers and the plan admin side effects this file
 * also pinned went with the retired Employer plan's code, phase 4 of the 2027
 * re-price.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureException } from '@/lib/sentry';

const discordMocks = vi.hoisted(() => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/discord-notifier', () => discordMocks);

import { alertWebhookFailure, stripeIdOf } from '@/app/api/webhooks/stripe/webhook-support';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('alertWebhookFailure — PII discipline', () => {
    it('redacts emails and secret-shaped values from Sentry extras and the Discord body', async () => {
        await alertWebhookFailure('5-post pack paid with no account reference: refund it in Stripe', null, {
            eventId: 'evt_1',
            email: 'Owner@Clinic.Example',
            note: 'key sk_live_ABCDEFGHIJKLMNOPQRSTUV leaked',
            amountCents: 124500,
        });

        const [, context] = vi.mocked(captureException).mock.calls[0] as [unknown, { extra: Record<string, unknown> }];
        const sentryPayload = JSON.stringify(context.extra);
        expect(sentryPayload).not.toContain('Owner@Clinic.Example');
        expect(sentryPayload).not.toContain('sk_live_ABCDEFGHIJKLMNOPQRSTUV');
        expect(context.extra).toMatchObject({ reason: '5-post pack paid with no account reference: refund it in Stripe', eventId: 'evt_1', amountCents: 124500 });

        const discordPayload = JSON.stringify(discordMocks.sendDiscordMessage.mock.calls);
        expect(discordPayload).not.toContain('Owner@Clinic.Example');
        expect(discordPayload).toContain('eventId=evt_1');
    });

    it('never throws when the alert channels fail', async () => {
        discordMocks.sendDiscordMessage.mockRejectedValueOnce(new Error('discord down'));
        await expect(alertWebhookFailure('x', new Error('y'), {})).resolves.toBeUndefined();
    });
});

describe('stripeIdOf', () => {
    it('reads an id from a string or an expanded object, and null from nothing', () => {
        expect(stripeIdOf('sub_1')).toBe('sub_1');
        expect(stripeIdOf({ id: 'pi_1' })).toBe('pi_1');
        expect(stripeIdOf(null)).toBeNull();
        expect(stripeIdOf(undefined)).toBeNull();
    });
});

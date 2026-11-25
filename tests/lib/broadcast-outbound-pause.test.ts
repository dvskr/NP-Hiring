/**
 * The emergency brake (OUTBOUND_MESSAGING_PAUSED=1) in the background
 * senders: the broadcast engine, its Inngest function and the weekly
 * recommendation digest.
 *
 * While paused, sendAndLog refuses every broadcast send. Had the broadcast
 * engine kept going, each refusal would have been recorded as a failed
 * recipient who is then never mailed. So a paused chunk reads nobody and
 * leaves every recipient 'pending', the broadcast is never finalized, and the
 * stuck-broadcast sweep continues it once the pause is lifted. The Inngest
 * functions read the brake outside their steps, so it is checked again on
 * every invocation and a pause stops a long run at its next step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CapturedFunction {
    handler: (ctx: { event?: { data: unknown }; step: unknown }) => Promise<Record<string, unknown>>;
}

const mocks = vi.hoisted(() => ({
    broadcastFindUnique: vi.fn(),
    broadcastUpdate: vi.fn(),
    recipientFindMany: vi.fn(),
    recipientUpdate: vi.fn(),
    queryRawUnsafe: vi.fn(),
    sendBroadcastEmail: vi.fn(),
    sendAndLog: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
    inngest: { createFunction: vi.fn((opts: unknown, handler: CapturedFunction['handler']) => ({ opts, handler })) },
    BROADCAST_REQUESTED_EVENT: 'admin/broadcast.requested',
}));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        emailBroadcast: { findUnique: mocks.broadcastFindUnique, update: mocks.broadcastUpdate, findMany: vi.fn() },
        emailBroadcastRecipient: { findMany: mocks.recipientFindMany, update: mocks.recipientUpdate },
        $queryRawUnsafe: mocks.queryRawUnsafe,
        candidateRecommendation: { findMany: vi.fn() },
    },
}));
vi.mock('@/lib/email-service', () => ({
    sendBroadcastEmail: mocks.sendBroadcastEmail,
    buildBroadcastHtml: vi.fn(() => '<html></html>'),
    isEmailSuppressed: vi.fn().mockResolvedValue(false),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('tok-fic'),
    sendAndLog: mocks.sendAndLog,
}));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: async () => true }));
vi.mock('@/lib/env', () => ({ getBaseUrl: () => 'https://fixture.invalid' }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { executeBroadcast, processBroadcastChunk } from '@/lib/broadcast-sender';
import { broadcastSend } from '@/lib/inngest/functions/broadcast-send';
import { recommendationDigestWeekly } from '@/lib/inngest/functions/recommendation-digest';
import { OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';

/** An Inngest step stand-in: runs each step, or answers it from `results` by name prefix. */
function fakeStep(results: Record<string, unknown> = {}) {
    const run = vi.fn(async (name: string, fn: () => Promise<unknown>) => {
        const key = Object.keys(results).find((prefix) => name.startsWith(prefix));
        return key ? results[key] : fn();
    });
    return {
        run,
        sleep: vi.fn(async () => undefined),
        sendEvent: vi.fn(async () => undefined),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.OUTBOUND_MESSAGING_PAUSED = '1';
    mocks.broadcastFindUnique.mockResolvedValue({ id: 'b1', subject: 'News', body: 'Hello', status: 'sending', sentCount: 0, failedCount: 0 });
    mocks.recipientFindMany.mockResolvedValue([{ id: 'r1', email: 'reader@example.com', firstName: null, status: 'pending' }]);
    mocks.sendBroadcastEmail.mockResolvedValue({ success: true });
});

afterEach(() => {
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
});

describe('the broadcast engine while paused', () => {
    it('a chunk reads nobody, sends nothing, and leaves every recipient pending', async () => {
        const chunk = await processBroadcastChunk('b1');

        expect(chunk).toMatchObject({ broadcastId: 'b1', processed: 0, sent: 0, failed: 0, paused: true, hasMore: true });
        expect(mocks.broadcastFindUnique).not.toHaveBeenCalled();
        expect(mocks.recipientFindMany).not.toHaveBeenCalled();
        expect(mocks.recipientUpdate).not.toHaveBeenCalled();
        expect(mocks.sendBroadcastEmail).not.toHaveBeenCalled();
    });

    it('the inline send refuses to start instead of reporting a broadcast that mailed nobody', async () => {
        await expect(executeBroadcast('b1')).rejects.toThrow(OUTBOUND_PAUSED_MESSAGE);
        expect(mocks.broadcastFindUnique).not.toHaveBeenCalled();
        expect(mocks.broadcastUpdate).not.toHaveBeenCalled();
        expect(mocks.sendBroadcastEmail).not.toHaveBeenCalled();
    });

    it('sends as before once the pause is lifted', async () => {
        delete process.env.OUTBOUND_MESSAGING_PAUSED;
        const chunk = await processBroadcastChunk('b1');
        expect(chunk.paused).toBeUndefined();
        expect(chunk.sent).toBe(1);
        expect(mocks.sendBroadcastEmail).toHaveBeenCalledTimes(1);
    }, 15_000);
});

describe('the Inngest broadcast function while paused', () => {
    it('returns at once and runs no step, so the broadcast is left for the sweep', async () => {
        const step = fakeStep();
        const result = await (broadcastSend as unknown as CapturedFunction).handler({ event: { data: { broadcastId: 'b1' } }, step });

        expect(result).toEqual({ broadcastId: 'b1', paused: true });
        expect(step.run).not.toHaveBeenCalled();
        expect(mocks.broadcastUpdate).not.toHaveBeenCalled();
    });

    it('stops without finalizing when a chunk reports the pause', async () => {
        delete process.env.OUTBOUND_MESSAGING_PAUSED;
        const step = fakeStep({
            'mark-sending': true,
            'send-chunk-': { broadcastId: 'b1', processed: 0, sent: 0, failed: 0, skipped: 0, hasMore: true, paused: true },
        });
        const result = await (broadcastSend as unknown as CapturedFunction).handler({ event: { data: { broadcastId: 'b1' } }, step });

        expect(result).toMatchObject({ broadcastId: 'b1', paused: true });
        const stepNames = step.run.mock.calls.map((call) => call[0]);
        expect(stepNames).not.toContain('finalize');
        expect(step.sleep).not.toHaveBeenCalled();
    });
});

describe('the weekly recommendation digest while paused', () => {
    it('does no work: no roster query, no step, no send', async () => {
        const step = fakeStep();
        const result = await (recommendationDigestWeekly as unknown as CapturedFunction).handler({ step });

        expect(result).toEqual({ paused: true, sent: 0 });
        expect(step.run).not.toHaveBeenCalled();
        expect(mocks.queryRawUnsafe).not.toHaveBeenCalled();
        expect(mocks.sendAndLog).not.toHaveBeenCalled();
    });
});

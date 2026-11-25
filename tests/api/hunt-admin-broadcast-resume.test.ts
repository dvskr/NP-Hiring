/**
 * POST /api/admin/email/resume: the History tab's Resume.
 *
 * Broadcasts that stop partway are already continued by the stuck-broadcast
 * sweep (lib/inngest/functions/broadcast-send.ts), which re-emits the
 * broadcast event for a 'sending' broadcast silent for BROADCAST_STALE_AFTER_MS.
 * Resume does the same on demand, and these pins keep it from ever being a
 * second way to mail someone twice:
 *  - one conditional claim on a broadcast silent for the sweep's own window,
 *    longer than the inline send's route limit, so no live sender is joined;
 *  - the claim stamps the row, so a second click is a 409, not a second run;
 *  - it hands over through the same Inngest event (serialized per broadcast),
 *    never an in-process sender;
 *  - a failed hand-over gives the claim back and says so;
 *  - the brake (OUTBOUND_MESSAGING_PAUSED=1) answers 503;
 *  - each resume is audited with ids and counts only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type StepRun = <T>(name: string, fn: () => Promise<T>) => Promise<T>;
interface CapturedFunction {
    handler: (ctx: { step: { run: StepRun; sendEvent: (...args: unknown[]) => Promise<unknown> } }) => Promise<unknown>;
}

const mocks = vi.hoisted(() => ({
    requireApiAdminActor: vi.fn(),
    logAudit: vi.fn(),
    inngestSend: vi.fn(),
    broadcastFindUnique: vi.fn(),
    broadcastUpdateMany: vi.fn(),
    broadcastFindMany: vi.fn(),
    recipientCount: vi.fn(),
    executeBroadcast: vi.fn(),
}));

vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdminActor: mocks.requireApiAdminActor }));
vi.mock('@/lib/audit-log', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/inngest/client', () => ({
    inngest: {
        send: mocks.inngestSend,
        createFunction: vi.fn((opts: unknown, handler: CapturedFunction['handler']) => ({ opts, handler })),
    },
    BROADCAST_REQUESTED_EVENT: 'admin/broadcast.requested',
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({
    prisma: {
        emailBroadcast: {
            findUnique: mocks.broadcastFindUnique,
            updateMany: mocks.broadcastUpdateMany,
            findMany: mocks.broadcastFindMany,
        },
        emailBroadcastRecipient: { count: mocks.recipientCount },
    },
}));

import { POST as RESUME } from '@/app/api/admin/email/resume/route';
import { maxDuration as SEND_MAX_DURATION_S } from '@/app/api/admin/email/send/route';
import { BROADCAST_STALE_AFTER_MS } from '@/lib/broadcast-sender';
import { OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';

const ADMIN = { profileId: 'admin-profile-fic', supabaseId: 'sb-admin-fic' };
const LAST_PROGRESS = new Date('2026-11-25T08:00:00.000Z');

function resume(body: unknown): Promise<Response> {
    return RESUME(new NextRequest('https://example.com/api/admin/email/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }));
}

const ORIGINAL_INNGEST_EVENT_KEY = process.env.INNGEST_EVENT_KEY;

afterEach(() => {
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
    if (ORIGINAL_INNGEST_EVENT_KEY === undefined) delete process.env.INNGEST_EVENT_KEY;
    else process.env.INNGEST_EVENT_KEY = ORIGINAL_INNGEST_EVENT_KEY;
});

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
    process.env.INNGEST_EVENT_KEY = 'test-event-key';
    mocks.requireApiAdminActor.mockResolvedValue({ error: null, actor: ADMIN });
    mocks.broadcastFindUnique.mockResolvedValue({ id: 'b1', status: 'sending', updatedAt: LAST_PROGRESS });
    mocks.broadcastUpdateMany.mockResolvedValue({ count: 1 });
    mocks.recipientCount.mockResolvedValue(700);
    mocks.inngestSend.mockResolvedValue({ ids: ['evt-1'] });
});

describe('resuming a stalled broadcast', () => {
    it('claims it once, hands it to the background sender and audits the resume', async () => {
        const res = await resume({ broadcastId: 'b1' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ success: true, broadcastId: 'b1', pending: 700 });

        const claim = mocks.broadcastUpdateMany.mock.calls[0][0];
        expect(claim.where.id).toBe('b1');
        expect(claim.where.status).toBe('sending');
        // Silent for the sweep's window, which is longer than any sender can
        // live: the inline send is cut off by its route limit long before.
        const silenceMs = Date.now() - (claim.where.updatedAt.lt as Date).getTime();
        expect(silenceMs).toBeGreaterThanOrEqual(BROADCAST_STALE_AFTER_MS - 1_000);
        expect(silenceMs).toBeGreaterThan(SEND_MAX_DURATION_S * 1000);
        // The claim stamps the row, so a racing second click no longer matches.
        expect(Date.now() - (claim.data.updatedAt as Date).getTime()).toBeLessThan(5_000);

        expect(mocks.inngestSend).toHaveBeenCalledWith({ name: 'admin/broadcast.requested', data: { broadcastId: 'b1' } });
        expect(mocks.logAudit).toHaveBeenCalledWith({
            action: 'admin.email.broadcast_resume',
            actorType: 'admin',
            actorId: ADMIN.profileId,
            targetType: 'email_broadcast',
            targetId: 'b1',
            metadata: { pending: 700 },
        });
    });

    it('counts only recipients still waiting', async () => {
        await resume({ broadcastId: 'b1' });
        expect(mocks.recipientCount).toHaveBeenCalledWith({ where: { broadcastId: 'b1', status: 'pending' } });
    });

    it('hands over a broadcast with nobody left, so the background run can finish it', async () => {
        mocks.recipientCount.mockResolvedValue(0);
        const body = await (await resume({ broadcastId: 'b1' })).json();
        expect(body.success).toBe(true);
        expect(body.message).toMatch(/marked complete/);
        expect(mocks.inngestSend).toHaveBeenCalledTimes(1);
    });
});

describe('refusals', () => {
    it('refuses while the broadcast may still be sending, so two senders never run', async () => {
        mocks.broadcastUpdateMany.mockResolvedValue({ count: 0 });
        const res = await resume({ broadcastId: 'b1' });
        expect(res.status).toBe(409);
        expect(mocks.inngestSend).not.toHaveBeenCalled();
        expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it('refuses a broadcast that is already finished, without claiming it', async () => {
        mocks.broadcastFindUnique.mockResolvedValue({ id: 'b1', status: 'sent', updatedAt: LAST_PROGRESS });
        const res = await resume({ broadcastId: 'b1' });
        expect(res.status).toBe(409);
        expect(mocks.broadcastUpdateMany).not.toHaveBeenCalled();
    });

    it('404s an unknown broadcast and 400s a missing or malformed id', async () => {
        mocks.broadcastFindUnique.mockResolvedValue(null);
        expect((await resume({ broadcastId: 'nope' })).status).toBe(404);
        expect((await resume({})).status).toBe(400);
        expect((await resume({ broadcastId: { not: '' } })).status).toBe(400);
        expect((await resume({ broadcastId: 'x'.repeat(65) })).status).toBe(400);
    });

    it('answers 503 while OUTBOUND_MESSAGING_PAUSED=1, before reading anything', async () => {
        process.env.OUTBOUND_MESSAGING_PAUSED = '1';
        const res = await resume({ broadcastId: 'b1' });
        expect(res.status).toBe(503);
        expect((await res.json()).error).toBe(OUTBOUND_PAUSED_MESSAGE);
        expect(mocks.broadcastFindUnique).not.toHaveBeenCalled();
    });

    it('answers 503 without claiming when background sending is not set up', async () => {
        delete process.env.INNGEST_EVENT_KEY;
        const res = await resume({ broadcastId: 'b1' });
        expect(res.status).toBe(503);
        expect(mocks.broadcastUpdateMany).not.toHaveBeenCalled();
    });
});

describe('a failed hand-over', () => {
    it('gives the claim back, so the admin can try again at once, and says nothing was resumed', async () => {
        mocks.inngestSend.mockRejectedValue(new Error('inngest down'));
        const res = await resume({ broadcastId: 'b1' });

        expect(res.status).toBe(503);
        expect(mocks.logAudit).not.toHaveBeenCalled();
        expect(mocks.broadcastUpdateMany).toHaveBeenCalledTimes(2);
        const [claim, release] = mocks.broadcastUpdateMany.mock.calls.map((call) => call[0]);
        // Only the stamp this request wrote is undone.
        expect(release.where).toEqual({ id: 'b1', updatedAt: claim.data.updatedAt });
        expect(release.data).toEqual({ updatedAt: LAST_PROGRESS });
    });
});

describe('the sweep and Resume share one window', () => {
    it('the stuck-broadcast sweep waits exactly as long as Resume does', async () => {
        mocks.broadcastFindMany.mockResolvedValue([]);
        const { broadcastStuckSweep } = await import('@/lib/inngest/functions/broadcast-send');
        const sweep = broadcastStuckSweep as unknown as CapturedFunction;
        const before = Date.now();
        await sweep.handler({
            step: {
                run: (async (_name: string, fn: () => Promise<unknown>) => fn()) as StepRun,
                sendEvent: vi.fn(),
            },
        });

        const where = mocks.broadcastFindMany.mock.calls[0][0].where;
        const silenceMs = before - (where.updatedAt.lt as Date).getTime();
        expect(Math.abs(silenceMs - BROADCAST_STALE_AFTER_MS)).toBeLessThan(5_000);
    });
});

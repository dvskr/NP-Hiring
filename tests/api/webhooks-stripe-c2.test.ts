/**
 * C2 regression — Stripe webhook idempotency must roll back when
 * processing fails, so the retry can succeed.
 *
 * The bug (pre-fix): processedStripeEvent.create was called BEFORE
 * processing; if processing then threw, the dedupe row remained,
 * Stripe redelivered, the redelivery hit P2002 ("already processed"),
 * returned 200, and the side-effects (publish flip, JobCharge, email)
 * silently never happened.
 *
 * Fix: every 500-returning path must call cleanupDedupe(), and the
 * outer catch must delete by the captured `dedupedEventId`.
 *
 * These tests assert the dedupe row is deleted before any 500 response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { sendDiscordMessage } from '@/lib/discord-notifier';

// Mock Stripe constructEvent so we can drive the handler without a real signature
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: {
            constructEvent: vi.fn().mockImplementation((rawBody: string) => JSON.parse(rawBody)),
        },
        invoices: { retrieve: vi.fn().mockResolvedValue({ id: 'inv_x', invoice_pdf: null, hosted_invoice_url: null, number: null }) },
    })),
}));
vi.mock('@/lib/email-service', () => ({
    sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendRenewalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
    sendPlanActivatedEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPlanPausedEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/search-indexing', () => ({
    pingAllSearchEngines: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/analytics-server', () => ({
    trackServerPurchase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

function makeRequest(body: object): Request {
    return new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify(body),
    });
}

describe('Stripe webhook C2 — idempotency rollback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    });

    it('deletes dedupe row when EmployerJob is missing (new-post)', async () => {
        vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
        vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job1', title: 't', slug: null } as never);
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_1',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { jobId: 'job1' }, payment_intent: null, amount_total: 19900, currency: 'usd' } },
        }) as never);

        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_1' } });
    });

    it('deletes dedupe row when prisma.job.update throws', async () => {
        vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
        vi.mocked(prisma.job.update).mockRejectedValue(new Error('db boom'));

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_2',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_2', payment_status: 'paid', metadata: { jobId: 'job2' }, payment_intent: null, amount_total: 19900, currency: 'usd' } },
        }) as never);

        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_2' } });
    });

    it('does NOT delete dedupe when handler returns success', async () => {
        vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
        vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job3', title: 't', slug: 'slug-job3' } as never);
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej3', contactEmail: 'x@y.com', dashboardToken: 'tok',
        } as never);
        vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
        vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
        vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'utok' } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_3',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_3', payment_status: 'paid', metadata: { jobId: 'job3', pricing: 'pro' }, payment_intent: null, amount_total: 19900, currency: 'usd' } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
    });

    it('returns 200 (deduped) without re-running on P2002 dedupe collision', async () => {
        vi.mocked(prisma.processedStripeEvent.create).mockRejectedValue(
            Object.assign(new Error('duplicate'), { code: 'P2002' }),
        );

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_4',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_4', metadata: { jobId: 'job4' } } },
        }) as never);

        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.deduped).toBe(true);
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('reclaims a stale processing claim left by a delivery that died mid-flight, and processes the retry', async () => {
        vi.mocked(prisma.processedStripeEvent.create).mockRejectedValue(
            Object.assign(new Error('duplicate'), { code: 'P2002' }),
        );
        vi.mocked(prisma.processedStripeEvent.updateMany)
            .mockResolvedValueOnce({ count: 1 } as never) // reclaim succeeded
            .mockResolvedValue({ count: 1 } as never);    // mark done
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_5',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_5', payment_status: 'paid', metadata: { jobId: 'job5' } } },
        }) as never);

        // The reclaim is conditional on a 'processing' row older than the
        // window: maxDuration (no live delivery holds a claim longer) plus a
        // 30 second clock-skew margin.
        const reclaimArgs = vi.mocked(prisma.processedStripeEvent.updateMany).mock.calls[0][0] as unknown as {
            where: { eventId: string; status: string; claimedAt: { lt: Date } };
        };
        expect(reclaimArgs.where.eventId).toBe('evt_5');
        expect(reclaimArgs.where.status).toBe('processing');
        const { maxDuration } = await import('@/app/api/webhooks/stripe/route');
        const windowMs = Date.now() - reclaimArgs.where.claimedAt.lt.getTime();
        expect(windowMs).toBeGreaterThanOrEqual(maxDuration * 1000 + 30_000);
        expect(windowMs).toBeLessThan(maxDuration * 1000 + 30_000 + 5_000);
        // Processing ran (EmployerJob missing → 500 + rollback) instead of a silent 200.
        expect(res.status).toBe(500);
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_5' } });
    });

    it('declares a maxDuration so a slow handler is not killed mid-processing', async () => {
        const mod = await import('@/app/api/webhooks/stripe/route');
        expect(mod.maxDuration).toBe(60);
    });

    it('derives the reclaim window from maxDuration, so a retry after a killed delivery is processed, not dropped', () => {
        const src = fs.readFileSync(path.join(process.cwd(), 'app/api/webhooks/stripe/route.ts'), 'utf8');
        // One source of truth: raising maxDuration moves the window with it.
        expect(src).toMatch(/const DEDUPE_RECLAIM_AFTER_MS = maxDuration \* 1000 \+ DEDUPE_RECLAIM_MARGIN_MS;/);
        expect(src).toMatch(/const DEDUPE_RECLAIM_MARGIN_MS = 30 \* 1000;/);
        // The old fixed five minute window acknowledged retries in the gap as duplicates.
        expect(src).not.toMatch(/DEDUPE_RECLAIM_AFTER_MS = 5 \* 60 \* 1000/);
    });
});

describe('Stripe webhook — payment_status gate and delayed payment methods', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.STRIPE_SECRET_KEY = 'sk_test_x';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
        vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    });

    it('defers an UNPAID completed session: nothing published, nothing ledgered, 200', async () => {
        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_unpaid',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_u', payment_status: 'unpaid', metadata: { jobId: 'jobU', pricing: 'pro' }, amount_total: 29900 } },
        }) as never);

        expect(res.status).toBe(200);
        expect((await res.json()).deferred).toBe(true);
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(prisma.jobCharge.create).not.toHaveBeenCalled();
    });

    it('defers an unpaid RENEWAL too — no expiry extension, no ledger row', async () => {
        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_unpaid_r',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_ur', payment_status: 'unpaid', metadata: { jobId: 'jobR', type: 'renewal', tier: 'pro' } } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.jobCharge.create).not.toHaveBeenCalled();
    });

    it('fulfils on checkout.session.async_payment_succeeded through the same activation path', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ejA', contactEmail: 'x@y.com', dashboardToken: 'tok', quotaDomain: null } as never);
        vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);
        vi.mocked(prisma.job.update).mockResolvedValue({ id: 'jobA', title: 't', slug: null } as never);
        vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);
        vi.mocked(prisma.jobDraft.deleteMany).mockResolvedValue({ count: 0 } as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_async_ok',
            type: 'checkout.session.async_payment_succeeded',
            data: { object: { id: 'cs_a', payment_status: 'paid', metadata: { jobId: 'jobA', pricing: 'pro' }, payment_intent: 'pi_a', amount_total: 29900, currency: 'usd' } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.employerJob.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'ejA', paymentStatus: 'pending' },
        }));
        expect(prisma.job.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isPublished: true, isVerifiedEmployer: true } }));
        expect(prisma.jobCharge.create).toHaveBeenCalled();
    });

    it('async_payment_failed leaves the posting unpaid and alerts', async () => {
        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_async_fail',
            type: 'checkout.session.async_payment_failed',
            data: { object: { id: 'cs_f', mode: 'payment', payment_status: 'unpaid', metadata: { jobId: 'jobF' } } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('Delayed checkout payment failed');
    });

    it('a second payment for the same posting is ledgered, alerted and acknowledged (never silently swallowed)', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ejD', contactEmail: 'x@y.com', dashboardToken: 'tok' } as never);
        vi.mocked(prisma.employerJob.update).mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ paymentStatus: 'paid' } as never);
        vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([{ stripeSessionId: 'cs_first', type: 'new' }] as never);
        vi.mocked(prisma.jobCharge.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_dup',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_second', payment_status: 'paid', metadata: { jobId: 'jobD', pricing: 'pro' }, payment_intent: 'pi_second', amount_total: 29900, currency: 'usd' } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.jobCharge.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ stripeSessionId: 'cs_second', stripePaymentIntentId: 'pi_second', employerJobId: 'ejD' }),
        }));
        expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('second payment for one posting');
        expect(prisma.processedStripeEvent.delete).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('a second payment on a refunded posting is also ledgered and alerted', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ejX', contactEmail: 'x@y.com', dashboardToken: 'tok' } as never);
        vi.mocked(prisma.employerJob.update).mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ paymentStatus: 'refunded' } as never);
        vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
        vi.mocked(prisma.jobCharge.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.jobCharge.create).mockResolvedValue({} as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_dup_ref',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_late', payment_status: 'paid', metadata: { jobId: 'jobX', pricing: 'pro' }, amount_total: 29900 } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.jobCharge.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stripeSessionId: 'cs_late' }) }));
        expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('second payment for one posting');
    });

    it('a same-session replay after activation stays a quiet no-op', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({ id: 'ejR', contactEmail: 'x@y.com', dashboardToken: 'tok' } as never);
        vi.mocked(prisma.employerJob.update).mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
        vi.mocked(prisma.employerJob.findUnique).mockResolvedValue({ paymentStatus: 'paid' } as never);
        vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([{ stripeSessionId: 'cs_same', type: 'new' }] as never);

        const { POST } = await import('@/app/api/webhooks/stripe/route');
        const res = await POST(makeRequest({
            id: 'evt_replay',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_same', payment_status: 'paid', metadata: { jobId: 'jobR', pricing: 'pro' } } },
        }) as never);

        expect(res.status).toBe(200);
        expect(prisma.jobCharge.create).not.toHaveBeenCalled();
        expect(sendDiscordMessage).not.toHaveBeenCalled();
    });
});

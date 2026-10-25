/**
 * lib/email-service.ts#sendPostPackPurchasedEmail — the notice the 5-post
 * pack webhook sends once the pack is on the books (2027 re-price, phase 2).
 *
 * Minimal on purpose: the pack ships dark, and its copy surfaces are the next
 * phase's. What it must already get right:
 *   - it states the posts and the date to use them by, from what the webhook
 *     recorded (never a price: Stripe's receipt and invoice carry the amount);
 *   - it is transactional (type post_pack_purchased, the transactional
 *     sender), with a real unsubscribe token in the footer and the header;
 *   - house style: no dashes in the subject or the text;
 *   - a send that fails reports { success: false } instead of throwing, so
 *     the webhook can release its email claim for a retry.
 *
 * The REAL email-service runs (the global setup mocks it); Resend is mocked.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.unmock('@/lib/email-service');

const resendSendMock = vi.fn().mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
vi.mock('resend', () => ({
    Resend: vi.fn().mockImplementation(() => ({
        emails: { send: resendSendMock },
        batch: { send: vi.fn().mockResolvedValue({ data: [], error: null }) },
    })),
}));

import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

interface Sent {
    from: string;
    subject: string;
    html: string;
    text: string;
}

const EXPIRES = new Date('2028-03-01T12:00:00.000Z');

beforeAll(async () => {
    await import('@/lib/email-service');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
    resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'tok-pack-1' } as never);
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

async function send(options: Partial<{ posts: number; expiresAt: Date; hostedInvoiceUrl: string | null; invoiceNumber: string | null }> = {}) {
    const { sendPostPackPurchasedEmail } = await import('@/lib/email-service');
    const result = await sendPostPackPurchasedEmail('owner@clinic.example', { posts: config.packPosts, expiresAt: EXPIRES, ...options });
    return { result, sent: resendSendMock.mock.calls.at(-1)?.[0] as Sent | undefined };
}

describe('sendPostPackPurchasedEmail', () => {
    it('states the posts and the date to use them by, and no price', async () => {
        const { result, sent } = await send();

        expect(result).toEqual({ success: true });
        expect(sent!.subject).toBe('Your 5-post pack is ready');
        expect(sent!.text).toContain('You have 5 job posts to use by Wednesday, March 1, 2028.');
        expect(sent!.html).toContain('/post-job');
        expect(sent!.text).not.toMatch(/\$\d/);
    });

    it('is transactional, logged as post_pack_purchased, with a real unsubscribe token', async () => {
        const { sent } = await send();

        const logged = vi.mocked(prisma.emailSend.create).mock.calls.at(-1)![0] as { data: { emailType: string; metadata: Record<string, unknown> } };
        expect(logged.data.emailType).toBe('post_pack_purchased');
        expect(logged.data.metadata).toMatchObject({ posts: 5, expiresAt: EXPIRES.toISOString() });
        expect(sent!.html).toContain('/unsubscribe?token=tok-pack-1');
        expect(sent!.from).not.toMatch(/marketing/i);
    });

    it('links the invoice when Stripe issued one', async () => {
        const { sent } = await send({ hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc', invoiceNumber: 'INV-0042' });

        expect(sent!.html).toContain('href="https://invoice.stripe.test/i/abc"');
        expect(sent!.text).toContain('Invoice #INV-0042');
    });

    it('keeps house style', async () => {
        const { sent } = await send({ hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc', invoiceNumber: 'INV-0042' });

        for (const part of [sent!.subject, sent!.text]) expect(part).not.toMatch(/[–—]/);
        expect(sent!.subject).not.toMatch(/ - /);
        const body = sent!.text.split('\n').filter((line) => /job posts to use by|Invoice #/.test(line)).join('\n');
        expect(body).not.toMatch(/ - /);
    });

    it('reports a failed send instead of throwing', async () => {
        resendSendMock.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'bad address' } });

        const { result } = await send();

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/bad address/);
    });
});

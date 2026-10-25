/**
 * lib/email-service.ts#sendPostPackPurchasedEmail — the notice the 5-post
 * pack webhook sends once the pack is on the books (2027 re-price, phases 2
 * and 3).
 *
 * What it must get right:
 *   - it states the posts and the date to use them by, the same "Use by"
 *     date the dashboard and /employer/post-pack print
 *     (lib/pricing-copy.ts#packUseByLabel: the last day the credits last in
 *     every US time zone, never the UTC date, which a US evening purchase
 *     overstates by a day); never a price: Stripe's receipt and invoice carry
 *     the amount;
 *   - house style: the full package every pack post gets, the invoice when
 *     Stripe issued one, a way to post, the dashboard and support;
 *   - it is transactional (type post_pack_purchased, the transactional
 *     sender), with a real unsubscribe token in the footer and the header;
 *   - no dashes in the subject or the text;
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
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { packUseByLabel } from '@/lib/pricing-copy';

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
    it('states the posts and the date to use them by, the one the dashboard prints, and no price', async () => {
        const { result, sent } = await send();

        expect(result).toEqual({ success: true });
        expect(sent!.subject).toBe('Your 5-post pack is ready');
        // The day before the expiry's date in Hawaii: March 1 at 02:00 there.
        expect(packUseByLabel(EXPIRES)).toBe('February 29, 2028');
        expect(sent!.text).toContain(`You have 5 job posts to use by ${packUseByLabel(EXPIRES)}.`);
        expect(sent!.html).toContain('/post-job');
        expect(sent!.text).not.toMatch(/\$\d/);
    });

    it('in the house style: the full package each post gets, the dashboard and support', async () => {
        const { sent } = await send();

        expect(sent!.text).toContain(`Each is a ${config.durationDays}-day listing with the full package`);
        expect(sent!.text).toContain(`${config.limits.candidateUnlocksPerPosting} candidate unlocks`);
        expect(sent!.text).toContain(`${config.limits.inmailsPerPosting} InMails`);
        expect(sent!.html).toContain('/employer/dashboard');
        expect(sent!.html).toContain(`mailto:${brand.email.support}`);
        expect(sent!.html).toContain('Your 5-Post Pack Is Ready');
    });

    it('is transactional, logged as post_pack_purchased, with a real unsubscribe token', async () => {
        const { sent } = await send();

        const logged = vi.mocked(prisma.emailSend.create).mock.calls.at(-1)![0] as { data: { emailType: string; metadata: Record<string, unknown> } };
        expect(logged.data.emailType).toBe('post_pack_purchased');
        expect(logged.data.metadata).toMatchObject({ posts: 5, expiresAt: EXPIRES.toISOString() });
        expect(sent!.html).toContain('/unsubscribe?token=tok-pack-1');
        expect(sent!.from).not.toMatch(/marketing/i);
    });

    it('links the invoice when Stripe issued one, and shows no invoice block without one', async () => {
        const { sent } = await send({ hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc', invoiceNumber: 'INV-0042' });

        expect(sent!.html).toContain('href="https://invoice.stripe.test/i/abc"');
        expect(sent!.text).toContain('Invoice #INV-0042');

        const { sent: bare } = await send();
        expect(bare!.text).not.toContain('Invoice #');
        expect(bare!.html).not.toContain('invoice.stripe.test');
    });

    it('links only an https invoice, written as an attribute value that cannot be broken out of', async () => {
        const { sent: script } = await send({ hostedInvoiceUrl: 'javascript:alert(1)', invoiceNumber: 'INV-0042' });
        expect(script!.html).not.toContain('javascript:');
        expect(script!.text).not.toContain('Invoice #');

        const { sent: quoted } = await send({ hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc?x="><b>', invoiceNumber: 'INV-0042' });
        expect(quoted!.html).toContain('href="https://invoice.stripe.test/i/abc?x=&quot;&gt;&lt;b&gt;"');
        expect(quoted!.html).not.toContain('"><b>');
    });

    it('keeps house style', async () => {
        const { sent } = await send({ hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc', invoiceNumber: 'INV-0042' });

        for (const part of [sent!.subject, sent!.text]) expect(part).not.toMatch(/[–—]/);
        expect(sent!.subject).not.toMatch(/ - /);
        const body = sent!.text.split('\n').filter((line) => /job posts to use by|Invoice #|full package/.test(line)).join('\n');
        expect(body).not.toMatch(/ - /);
    });

    it('reports a failed send instead of throwing', async () => {
        resendSendMock.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'bad address' } });

        const { result } = await send();

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/bad address/);
    });
});

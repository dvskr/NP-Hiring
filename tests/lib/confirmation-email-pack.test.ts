/**
 * lib/email-service.ts#sendConfirmationEmail for a post published with a
 * 5-post pack credit (2027 re-price, phase 3; plan section 3.9).
 *
 * POST /api/jobs/post-free sends mode 'pack' and the credits the post left.
 * The email says so in one sentence:
 *   "Posted with your 5-post pack. N posts left, to use by <date>."
 * with the "Use by" date the dashboard prints (lib/pricing-copy.ts
 * #packUseByLabel), and "Posted with the last post in your 5-post pack." for
 * the last credit. A pack post carries no invoice block: the pack was
 * invoiced when it was bought. The promo and paid wording do not change.
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
import { packUseByLabel } from '@/lib/pricing-copy';
import type { ConfirmationMode, PackPostCredits } from '@/lib/email-service';

interface Sent {
    subject: string;
    html: string;
    text: string;
}

const EXPIRES = new Date('2027-12-15T18:00:00.000Z');
const TITLE = 'Nurse Practitioner, Primary Care';

beforeAll(async () => {
    await import('@/lib/email-service');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
    resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'tok-1' } as never);
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

async function confirm(mode: ConfirmationMode, pack?: PackPostCredits): Promise<Sent> {
    const { sendConfirmationEmail } = await import('@/lib/email-service');
    const result = await sendConfirmationEmail('owner@clinic.example', TITLE, 'job-1', 'dash-1', undefined, config.durationDays, undefined, mode, pack);
    expect(result.success).toBe(true);
    return resendSendMock.mock.calls.at(-1)![0] as Sent;
}

describe('the confirmation email for a 5-post pack post', () => {
    it('names the pack, the posts left and the date to use them by', async () => {
        const sent = await confirm('pack', { remaining: 3, expiresAt: EXPIRES });

        expect(sent.text).toContain(`Posted with your ${config.packPosts}-post pack. 3 posts left, to use by ${packUseByLabel(EXPIRES)}.`);
        expect(sent.text).toContain(`The listing will remain active for ${config.durationDays} days.`);
    });

    it('says "1 post left" for one', async () => {
        const sent = await confirm('pack', { remaining: 1, expiresAt: EXPIRES });

        expect(sent.text).toContain(`Posted with your ${config.packPosts}-post pack. 1 post left, to use by ${packUseByLabel(EXPIRES)}.`);
    });

    it('says the last post was used, with no date to use it by', async () => {
        const sent = await confirm('pack', { remaining: 0, expiresAt: EXPIRES });

        expect(sent.text).toContain(`Posted with the last post in your ${config.packPosts}-post pack.`);
        expect(sent.text).not.toContain('to use by');
    });

    it('without the credits it still names the pack', async () => {
        const sent = await confirm('pack');

        expect(sent.text).toContain(`Posted with your ${config.packPosts}-post pack.`);
        expect(sent.text).not.toContain('to use by');
    });

    it('carries no invoice block and no price, and logs the mode', async () => {
        const sent = await confirm('pack', { remaining: 2, expiresAt: EXPIRES });

        expect(sent.html).not.toContain('Receipt &amp; Invoice');
        expect(sent.text).not.toMatch(/\$\d/);
        const logged = vi.mocked(prisma.emailSend.create).mock.calls.at(-1)![0] as { data: { metadata: Record<string, unknown> } };
        expect(logged.data.metadata).toMatchObject({ jobId: 'job-1', mode: 'pack' });
    });

    it('leaves the promo and paid wording as they were', async () => {
        const promo = await confirm('promo');
        expect(promo.text).toContain(`It is free during our launch period through ${config.promoEndsLabel}`);
        expect(promo.text).not.toContain('pack');

        const paid = await confirm('paid');
        expect(paid.text).toContain(`The listing will remain active for ${config.durationDays} days.`);
        expect(paid.text).not.toMatch(/Posted with/);
    });

    it('keeps house style', async () => {
        const sent = await confirm('pack', { remaining: 3, expiresAt: EXPIRES });
        const line = sent.text.split('\n').find((candidate) => candidate.includes('Posted with')) ?? '';

        expect(line).not.toMatch(/[–—]| - /);
        expect(sent.subject).not.toMatch(/[–—]| - /);
    });
});

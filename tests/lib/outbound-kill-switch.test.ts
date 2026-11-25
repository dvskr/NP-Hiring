/**
 * The emergency brake (lib/outbound-kill-switch.ts) where mail leaves.
 *
 * OUTBOUND_MESSAGING_PAUSED=1 stops every automated sender. The crons and
 * background jobs check it up front (tests/api/cron-outbound-pause.test.ts,
 * tests/lib/broadcast-outbound-pause.test.ts); sendAndLog checks it too, so a
 * marketing sender added later cannot forget it. Transactional mail is never
 * held back, and neither are the two marketing emails a person asks for and
 * waits on: the job alert confirmation and the salary guide.
 *
 * The global setup mocks @/lib/email-service, so it is unmocked here to run
 * the real sendAndLog. The provider is mocked to see whether anything left.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/email-service');

const resendSendMock = vi.fn();
vi.mock('resend', () => ({
    Resend: vi.fn().mockImplementation(() => ({
        emails: { send: resendSendMock },
        batch: { send: vi.fn().mockResolvedValue({ data: [], error: null }) },
    })),
}));

import { prisma } from '@/lib/prisma';
import { isOutboundPaused, OUTBOUND_PAUSED_MESSAGE } from '@/lib/outbound-kill-switch';
import type { EmailType } from '@/lib/email-service';

const RECIPIENT = 'reader@example.com';
const PAUSED_TYPES: EmailType[] = [
    'broadcast', 'job_alert', 'candidate_alert', 'saved_job_reminder',
    'performance_report', 'recommendation_digest', 'pd_outreach',
];
const NEVER_PAUSED_TYPES: EmailType[] = [
    // A person asked for these and is waiting on them.
    'welcome_alert', 'salary_guide',
    // Transactional mail.
    'job_confirmation', 'application_notification', 'expiry_warning', 'password_reset',
];

const ORIGINAL_RESEND_API_KEY = process.env.RESEND_API_KEY;

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
    process.env.RESEND_API_KEY = 'test-key';
    resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

afterEach(() => {
    delete process.env.OUTBOUND_MESSAGING_PAUSED;
    if (ORIGINAL_RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = ORIGINAL_RESEND_API_KEY;
});

describe('isOutboundPaused', () => {
    // '1', 'true' and 'yes' engage it, in any case and with spaces around
    // them; anything else leaves sending on.
    it.each([
        { value: undefined, paused: false },
        { value: '1', paused: true },
        { value: 'true', paused: true },
        { value: 'TRUE', paused: true },
        { value: 'True', paused: true },
        { value: 'yes', paused: true },
        { value: 'YES', paused: true },
        { value: ' 1 ', paused: true },
        { value: ' true\n', paused: true },
        { value: '\tYes ', paused: true },
        { value: '0', paused: false },
        { value: 'false', paused: false },
        { value: 'no', paused: false },
        { value: 'off', paused: false },
        { value: 'y', paused: false },
        { value: '2', paused: false },
        { value: 'paused', paused: false },
        { value: '', paused: false },
        { value: '   ', paused: false },
    ])('reads $value as paused=$paused', ({ value, paused }) => {
        if (value === undefined) delete process.env.OUTBOUND_MESSAGING_PAUSED;
        else process.env.OUTBOUND_MESSAGING_PAUSED = value;
        expect(isOutboundPaused()).toBe(paused);
    });
});

describe('sendAndLog while OUTBOUND_MESSAGING_PAUSED=1', () => {
    it.each(PAUSED_TYPES)('refuses automated %s mail before anything reaches the provider', async (emailType) => {
        process.env.OUTBOUND_MESSAGING_PAUSED = '1';
        const { sendAndLog } = await import('@/lib/email-service');

        await expect(
            sendAndLog({ from: '', to: RECIPIENT, subject: 'Subject', html: '<p>body</p>' }, emailType),
        ).rejects.toThrow(OUTBOUND_PAUSED_MESSAGE);
        expect(resendSendMock).not.toHaveBeenCalled();
        expect(prisma.emailSend.create).not.toHaveBeenCalled();
    }, 15_000);

    it.each(NEVER_PAUSED_TYPES)('still sends %s mail', async (emailType) => {
        process.env.OUTBOUND_MESSAGING_PAUSED = '1';
        const { sendAndLog } = await import('@/lib/email-service');

        await sendAndLog({ from: '', to: RECIPIENT, subject: 'Subject', html: '<p>body</p>' }, emailType);
        expect(resendSendMock).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('sends marketing mail again once the variable is unset', async () => {
        const { sendAndLog } = await import('@/lib/email-service');
        await sendAndLog({ from: '', to: RECIPIENT, subject: 'Subject', html: '<p>body</p>' }, 'broadcast');
        expect(resendSendMock).toHaveBeenCalledTimes(1);
    }, 15_000);
});

describe('sendBroadcastEmail while paused', () => {
    it('reports the send as not sent, with the reason, instead of throwing or claiming success', async () => {
        process.env.OUTBOUND_MESSAGING_PAUSED = '1';
        vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'tok-fic' } as never);
        const { sendBroadcastEmail } = await import('@/lib/email-service');

        const result = await sendBroadcastEmail(RECIPIENT, 'News', '<p>Hello</p>');
        expect(result.success).toBe(false);
        expect(result.error).toContain('OUTBOUND_MESSAGING_PAUSED');
        expect(resendSendMock).not.toHaveBeenCalled();
    }, 15_000);
});

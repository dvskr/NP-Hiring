/**
 * The job alert welcome email carries an opt-out that works.
 *
 * Its footer links (/unsubscribe?token=, /email-preferences?token=) and its
 * List-Unsubscribe header (/api/one-click-unsubscribe?token=) all resolve
 * EmailLead.unsubscribeToken: app/api/email/unsubscribe,
 * app/api/email/preferences and app/api/one-click-unsubscribe look up nothing
 * else. POST /api/job-alerts handed sendWelcomeEmail the new alert's JobAlert
 * token instead, so both links answered "Invalid token" and a mailbox
 * provider's one-click POST unsubscribed nobody. sendWelcomeEmail now looks
 * up the address's own EmailLead token (getOrCreateUnsubToken, the same as
 * the digest's one-click link) and takes no token from its caller, so the
 * JobAlert token never reaches this email.
 *
 * The REAL email service runs (the global setup mocks it); Resend is mocked to
 * capture what would be sent.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.unmock('@/lib/email-service');

const { resendSendMock } = vi.hoisted(() => ({ resendSendMock: vi.fn() }));
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSendMock } })),
}));

import { prisma } from '@/lib/prisma';

const EMAIL = 'seeker@example.com';
const LEAD_TOKEN = 'lead-unsub-token-1';
const ALERT_TOKEN = 'alert-token-1';

interface Sent {
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

function lastSent(): Sent {
  expect(resendSendMock).toHaveBeenCalled();
  return resendSendMock.mock.calls.at(-1)![0] as Sent;
}

// The first import of the real email service is a cold transform of its
// whole module graph; pay for it once, in a hook with its own budget.
beforeAll(async () => {
  await import('@/lib/email-service');
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: LEAD_TOKEN } as never);
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

describe('sendWelcomeEmail: the unsubscribe links resolve', () => {
  it('reads the token from the EmailLead row for this address', async () => {
    const { sendWelcomeEmail } = await import('@/lib/email-service');
    const result = await sendWelcomeEmail(EMAIL);
    expect(result.success).toBe(true);
    expect(prisma.emailLead.findUnique).toHaveBeenCalledWith({
      where: { email: EMAIL },
      select: { unsubscribeToken: true },
    });
    expect(lastSent().to).toBe(EMAIL);
  });

  it('the footer Unsubscribe and Manage preferences links carry that token', async () => {
    const { sendWelcomeEmail } = await import('@/lib/email-service');
    await sendWelcomeEmail(EMAIL);
    const { html } = lastSent();
    expect(html).toContain(`/unsubscribe?token=${LEAD_TOKEN}`);
    expect(html).toContain(`/email-preferences?token=${LEAD_TOKEN}`);
  });

  it('the List-Unsubscribe header sends the one-click POST and the human page to that token', async () => {
    const { sendWelcomeEmail } = await import('@/lib/email-service');
    await sendWelcomeEmail(EMAIL);
    const { headers } = lastSent();
    expect(headers?.['List-Unsubscribe']).toMatch(
      new RegExp(`^<[^>]*/api/one-click-unsubscribe\\?token=${LEAD_TOKEN}>, <[^>]*/unsubscribe\\?token=${LEAD_TOKEN}>$`),
    );
    expect(headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('an address with no EmailLead row yet gets one, and the email carries its new token', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.emailLead.create).mockResolvedValue({ unsubscribeToken: 'minted-token-1' } as never);
    const { sendWelcomeEmail } = await import('@/lib/email-service');
    await sendWelcomeEmail(EMAIL);
    expect(prisma.emailLead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: EMAIL }),
    }));
    const { html, headers } = lastSent();
    expect(html).toContain('/unsubscribe?token=minted-token-1');
    expect(headers?.['List-Unsubscribe']).toContain('/api/one-click-unsubscribe?token=minted-token-1');
  });

  it('no token a caller passes reaches the email, so an alert token cannot travel in it', async () => {
    // The old signature took the token as a second argument, and the alert
    // route filled it with JobAlert.token. A stray argument must change nothing.
    const { sendWelcomeEmail } = await import('@/lib/email-service');
    const withStrayToken = sendWelcomeEmail as unknown as (email: string, token: string) => Promise<{ success: boolean }>;
    await withStrayToken(EMAIL, ALERT_TOKEN);
    const sent = lastSent();
    expect(sent.html).not.toContain(ALERT_TOKEN);
    expect(JSON.stringify(sent.headers)).not.toContain(ALERT_TOKEN);
    expect(sent.html).toContain(`/unsubscribe?token=${LEAD_TOKEN}`);
  });

  it('a failed token lookup is reported as a failed send, not thrown at the signup route', async () => {
    vi.mocked(prisma.emailLead.findUnique).mockRejectedValue(new Error('db down'));
    const { sendWelcomeEmail } = await import('@/lib/email-service');
    const result = await sendWelcomeEmail(EMAIL);
    expect(result.success).toBe(false);
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

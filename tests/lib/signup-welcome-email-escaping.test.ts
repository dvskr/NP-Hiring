/**
 * The account welcome email writes the account's first name into its HTML
 * escaped.
 *
 * sendSignupWelcomeEmail put firstName raw into the job seeker preheader,
 * which emailShellV2 renders as HTML inside a hidden div. The name is
 * account-written: sign-up metadata (GET /auth/callback, ensureProfileFromAuth)
 * and PATCH /api/auth/profile store it through sanitizeText, which strips
 * script blocks, quoted on*= handlers and "javascript:" only, and is not an
 * HTML escape. A first_name of `</div><a href=https://e.vil>Confirm account</a>`
 * (47 characters, inside the 50 bound) closed the hidden div and put the
 * caller's link, visible, into a branded email this site sends to the address
 * the account was opened under, which need not be the caller's.
 *
 * The REAL email service runs (the global setup mocks it); Resend is mocked to
 * capture what would be sent. The subject is a plain-text header, so the name
 * goes there as typed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.unmock('@/lib/email-service');

const { resendSendMock } = vi.hoisted(() => ({ resendSendMock: vi.fn() }));
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSendMock } })),
}));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';

const EMAIL = 'victim@example.com';
const INJECTED = '</div><a href=https://e.vil>Confirm account</a>';

interface Sent {
  to: string;
  subject: string;
  html: string;
}

function lastSent(): Sent {
  expect(resendSendMock).toHaveBeenCalled();
  return resendSendMock.mock.calls.at(-1)![0] as Sent;
}

/** The hidden preheader div, the first div in the body. */
function preheaderOf(html: string): string {
  const match = html.match(/<body[^>]*>\s*<div style="display:none;[^"]*">([\s\S]*?)<\/div>/);
  expect(match, 'the preheader div').not.toBeNull();
  return match![1];
}

// The first import of the real email service is a cold transform of its
// whole module graph; pay for it once, in a hook with its own budget.
beforeAll(async () => {
  await import('@/lib/email-service');
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
  vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ unsubscribeToken: 'lead-unsub-token-1' } as never);
  vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

describe('sendSignupWelcomeEmail: the first name in the HTML', () => {
  it('markup in the name reaches the HTML only escaped, so it cannot close the preheader or add a link', async () => {
    const { sendSignupWelcomeEmail } = await import('@/lib/email-service');
    const result = await sendSignupWelcomeEmail(EMAIL, INJECTED, 'job_seeker');
    expect(result.success).toBe(true);

    const { html } = lastSent();
    expect(html).not.toContain(INJECTED);
    expect(html).not.toContain('<a href=https://e.vil>');
    expect(preheaderOf(html)).toContain(
      'Welcome, &lt;/div&gt;&lt;a href=https://e.vil&gt;Confirm account&lt;/a&gt;!',
    );
  });

  it('an unquoted handler that sanitizeText lets through is escaped too', async () => {
    const { sendSignupWelcomeEmail } = await import('@/lib/email-service');
    await sendSignupWelcomeEmail(EMAIL, '<img src=x onerror=alert(1)>', 'job_seeker');
    const { html } = lastSent();
    expect(html).not.toContain('<img src=x');
    expect(preheaderOf(html)).toContain('Welcome, &lt;img src=x onerror=alert(1)&gt;!');
  });

  it('an ordinary name reads as before', async () => {
    const { sendSignupWelcomeEmail } = await import('@/lib/email-service');
    await sendSignupWelcomeEmail(EMAIL, 'Grace', 'job_seeker');
    expect(preheaderOf(lastSent().html)).toContain('Welcome, Grace!');
  });

  it('no name gives the plain greeting', async () => {
    const { sendSignupWelcomeEmail } = await import('@/lib/email-service');
    await sendSignupWelcomeEmail(EMAIL, '', 'job_seeker');
    expect(preheaderOf(lastSent().html)).toContain('Welcome! Find your perfect');
  });

  it('the subject, a plain-text header, carries the name as typed and is not escaped twice', async () => {
    const { sendSignupWelcomeEmail } = await import('@/lib/email-service');
    await sendSignupWelcomeEmail(EMAIL, "Siobhan O'Brien", 'job_seeker');
    const sent = lastSent();
    expect(sent.subject).toBe(`Welcome to ${brand.name}, Siobhan O'Brien!`);
    expect(preheaderOf(sent.html)).toContain('Welcome, Siobhan O&#39;Brien!');
  });
});

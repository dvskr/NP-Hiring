/**
 * Regression guards for the email consent / delivery fixes
 * (2026-07-18 med/low backlog wave — B72, B73, B74, B75).
 *
 * B72 — password reset must not depend on Supabase's (broken) email
 *        delivery: recovery link is minted via admin generateLink and
 *        delivered through the board's own Resend path (sendAndLog).
 * B73 — Google OAuth signup must not silently opt users into the
 *        newsletter; consent mirrors the email-signup checkbox semantics.
 * B74 — broadcast custom audiences are validated + deduped; test sends
 *        skip broadcast history.
 * B75 — Resend webhook may only UPGRADE EmailSend status (precedence
 *        ladder), so out-of-order events can't downgrade the funnel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─── B75 behavioral setup: own prisma factory (the shared setup mock lacks
//     updateMany on several models the webhook touches) ───────────────────
const prismaMock = {
  processedStripeEvent: { create: vi.fn(), delete: vi.fn() },
  emailSend: { updateMany: vi.fn() },
  emailLead: { updateMany: vi.fn() },
  userProfile: { updateMany: vi.fn() },
  programDirectorLead: { updateMany: vi.fn() },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

// svix verify: signature check passes, payload is the parsed body
vi.mock('svix', () => ({
  Webhook: class {
    verify(body: string) {
      return JSON.parse(body);
    }
  },
}));

function resendWebhookRequest(payload: unknown): Request {
  return new Request('https://example.com/api/webhooks/resend', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'svix-id': `svix-${Math.random().toString(36).slice(2)}`,
      'svix-timestamp': `${Date.now()}`,
      'svix-signature': 'v1,test',
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_test';
  prismaMock.processedStripeEvent.create.mockResolvedValue({} as never);
  prismaMock.emailSend.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.emailLead.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.userProfile.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.programDirectorLead.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe('B75 — Resend webhook status updates are precedence-guarded', () => {
  const event = (type: string) => ({
    type,
    data: {
      email_id: 'resend-abc',
      to: ['user@example.com'],
      from: 'noreply@example.com',
      subject: 'Test',
      created_at: new Date().toISOString(),
    },
  });

  it('a delivered event only overwrites lower-ranked statuses (sent)', async () => {
    const { POST } = await import('@/app/api/webhooks/resend/route');
    const res = await POST(resendWebhookRequest(event('email.delivered')) as never);

    expect(res.status).toBe(200);
    expect(prismaMock.emailSend.updateMany).toHaveBeenCalledWith({
      where: { resendId: 'resend-abc', status: { in: ['sent'] } },
      data: { status: 'delivered' },
    });
  });

  it('an opened event cannot clobber clicked / bounced / complained', async () => {
    const { POST } = await import('@/app/api/webhooks/resend/route');
    await POST(resendWebhookRequest(event('email.opened')) as never);

    const call = prismaMock.emailSend.updateMany.mock.calls[0][0] as {
      where: { status: { in: string[] } };
      data: { status: string };
    };
    expect(call.data.status).toBe('opened');
    expect(call.where.status.in.sort()).toEqual(['delivered', 'sent']);
    expect(call.where.status.in).not.toContain('clicked');
    expect(call.where.status.in).not.toContain('bounced');
    expect(call.where.status.in).not.toContain('complained');
  });

  it('a bounce cannot downgrade a complained row', async () => {
    const { POST } = await import('@/app/api/webhooks/resend/route');
    const res = await POST(resendWebhookRequest(event('email.bounced')) as never);

    expect(res.status).toBe(200);
    // suppression side-effects still fire
    expect(prismaMock.emailLead.updateMany).toHaveBeenCalled();
    // status write excludes 'complained' from the overwritable set
    const statusCall = prismaMock.emailSend.updateMany.mock.calls[0][0] as {
      where: { status: { in: string[] } };
      data: { status: string };
    };
    expect(statusCall.data.status).toBe('bounced');
    expect(statusCall.where.status.in).not.toContain('complained');
  });
});

describe('B72 — password reset delivered through the board Resend path', () => {
  const src = () => read('app/api/auth/forgot-password/route.ts');

  it('mints the recovery link via admin generateLink instead of resetPasswordForEmail', () => {
    const s = src();
    // no CALL to the Supabase-delivered flow (the doc comment may mention it)
    expect(s).not.toMatch(/\.resetPasswordForEmail\(/);
    expect(s).toMatch(/generateLink\(\{[\s\S]*?type:\s*'recovery'/);
    expect(s).toContain('createAdminClient');
  });

  it('sends via sendAndLog with the password_reset email type', () => {
    const s = src();
    expect(s).toMatch(/sendAndLog\(/);
    expect(s).toContain("'password_reset'");
  });

  it('never logs the live reset link', () => {
    expect(src()).not.toMatch(/logger\.(info|warn|error)\([^)]*resetUrl/);
  });

  it('keeps the enumeration-safe identical 200 response', () => {
    const s = src();
    expect(s).toContain('If an account exists for that email');
    // generateLink error path must return the generic response, not a 4xx/5xx
    expect(s).toMatch(/if \(error\) \{[\s\S]*?return genericOk\(\)/);
  });

  it('the password_reset type exists in the EmailType union as transactional', () => {
    const es = read('lib/email-service.ts');
    expect(es).toMatch(/\|\s*'password_reset'/);
    // NOT in the marketing sender set
    const marketingBlock = es.slice(
      es.indexOf('MARKETING_EMAIL_TYPES = new Set'),
      es.indexOf(']);', es.indexOf('MARKETING_EMAIL_TYPES = new Set')),
    );
    expect(marketingBlock).not.toContain('password_reset');
  });
});

describe('B73 — Google OAuth signup does not silently opt into the newsletter', () => {
  it('auth callback derives newsletter consent from metadata, defaulting to opted-out', () => {
    const s = read('app/auth/callback/route.ts');
    expect(s).toMatch(/newsletter_opt_in === true/);
    // the emailLead upsert must not hardcode newsletterOptIn: true anywhere
    expect(s).not.toMatch(/newsletterOptIn:\s*true[,\s]/);
  });
});

describe('B74 — broadcast custom audience hygiene and history-free test sends', () => {
  const src = () => read('app/api/admin/email/send/route.ts');

  it('custom audiences are normalized, validated, and deduped before use', () => {
    const s = src();
    expect(s).toContain('cleanCustomEmails');
    // cleaning happens in the custom-audience branch before recipients are built
    expect(s.indexOf('cleanCustomEmails(customEmails')).toBeLessThan(
      s.indexOf('prisma.emailBroadcast.create'),
    );
  });

  it('test sends bypass EmailBroadcast history', () => {
    const s = src();
    expect(s).toMatch(/isTest === true/);
    // the isTest early-return sits BEFORE the broadcast row is created
    expect(s.indexOf('isTest === true')).toBeLessThan(
      s.indexOf('prisma.emailBroadcast.create'),
    );
  });
});

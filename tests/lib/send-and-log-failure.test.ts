/**
 * Audit CRIT-2 regression — sendAndLog ignored Resend's non-throwing error
 * contract. The Resend SDK resolves with { data: null, error } on API-level
 * failures; the old wrapper logged an EmailSend row as 'sent' and returned as if
 * successful. That silently lost failed sends — including GDPR purge warnings that
 * then stamp idempotency markers and advance accounts to deletion unwarned.
 *
 * The fix logs status='failed' and throws, so every caller's try/catch reports
 * { success: false } instead of a false success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above imports, so the factory can't close over a normal
// top-level const — use vi.hoisted to create the mock in the same hoisted scope.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

// The global test setup (tests/setup.ts) stubs @/lib/email-service; override it
// here with the real module so we exercise the actual sendAndLog implementation.
vi.mock('@/lib/email-service', async (importOriginal) => {
  return await importOriginal<typeof import('@/lib/email-service')>();
});

import { sendAndLog } from '@/lib/email-service';
import { prisma } from '@/lib/prisma';

describe('sendAndLog — Resend error contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
  });

  it('throws and logs status=failed when Resend returns an error object', async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field' } });

    await expect(
      sendAndLog({ from: '', to: 'bad@example.com', subject: 'S', html: '<p>hi</p>' }, 'contact_confirmation'),
    ).rejects.toThrow(/Email send failed/);

    expect(prisma.emailSend.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed', to: 'bad@example.com', resendId: null }),
      }),
    );
  });

  it('returns the result and logs a normal send (default status) on success', async () => {
    sendMock.mockResolvedValue({ data: { id: 're_123' }, error: null });

    const result = await sendAndLog(
      { from: '', to: 'ok@example.com', subject: 'S', html: '<p>hi</p>' },
      'contact_confirmation',
    );

    expect((result as { data?: { id?: string } })?.data?.id).toBe('re_123');
    const arg = vi.mocked(prisma.emailSend.create).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.status).toBeUndefined(); // success path leaves DB default 'sent'
    expect(arg.data.resendId).toBe('re_123');
  });
});

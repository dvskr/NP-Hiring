/**
 * lib/renewal-checkout-sessions.ts — at most one payable renewal per post
 * (backlog 2.5).
 *
 * Pins:
 *   - expires_at is a pure function of the idempotency window: identical for
 *     every request in one window (a replayed key must send identical
 *     parameters), at least Stripe's 30 minute minimum ahead of any request
 *     in the window, and never past the renewal session cookie set by that
 *     request (so never past cookie lifetime plus window either);
 *   - the session scan keeps only the post's renewal sessions, bounds the
 *     listing by creation time, and stops at the cap with an error log that
 *     names the unread range;
 *   - expiring treats "already expired" as done and anything else as a
 *     session that may still take money;
 *   - payable windows overlap only when each session was created before the
 *     other expired;
 *   - renewalExtension counts the whole days a renewal adds: the full period
 *     inside the renewal cap, only the days left near it, and none at or
 *     past it, so nothing is sold or applied that leaves the expiry where it
 *     was.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import {
  MAX_RENEWAL_SESSIONS_SCANNED,
  RENEWAL_IDEMPOTENCY_WINDOW_MS,
  RENEWAL_SESSION_COOKIE_MAX_AGE_S,
  expireCheckoutSessions,
  listRenewalSessionsForJob,
  payableWindowsOverlap,
  renewalExtension,
  renewalIdempotencyWindow,
  renewalSessionExpiresAt,
} from '@/lib/renewal-checkout-sessions';

/** Stripe: expires_at must be at least 30 minutes after the session is created. */
const STRIPE_MIN_LEAD_MS = 30 * 60 * 1000;
const COOKIE_MS = RENEWAL_SESSION_COOKIE_MAX_AGE_S * 1000;
const WINDOW_START_MS = 1_790_000_400_000; // a multiple of the 10 minute window

function asyncList<T>(items: T[]) {
  return { async *[Symbol.asyncIterator]() { for (const item of items) yield item; } };
}

function session(id: string, metadata: Record<string, string> | null, extra: Record<string, unknown> = {}) {
  return { id, metadata, created: 1_790_000_000, expires_at: 1_790_003_300, status: 'open', ...extra } as unknown as Stripe.Checkout.Session;
}

const list = vi.fn();
const expire = vi.fn();
const retrieve = vi.fn();
const stripe = { checkout: { sessions: { list, expire, retrieve } } } as unknown as Stripe;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe('renewalSessionExpiresAt', () => {
  it('starts from a window boundary (the fixture)', () => {
    expect(WINDOW_START_MS % RENEWAL_IDEMPOTENCY_WINDOW_MS).toBe(0);
  });

  it.each([
    ['at the window start', 0],
    ['one second in', 1_000],
    ['mid window', RENEWAL_IDEMPOTENCY_WINDOW_MS / 2],
    ['in the last millisecond', RENEWAL_IDEMPOTENCY_WINDOW_MS - 1],
  ])('a request %s gets a session Stripe accepts that closes before its cookie', (_label, offsetMs) => {
    const requestMs = WINDOW_START_MS + offsetMs;
    const leadMs = renewalSessionExpiresAt(renewalIdempotencyWindow(requestMs)) * 1000 - requestMs;

    expect(leadMs).toBeGreaterThanOrEqual(STRIPE_MIN_LEAD_MS);
    // The backlog bound, and the tighter one this design keeps: payable only
    // while the cookie the creating request set is still alive.
    expect(leadMs).toBeLessThanOrEqual(COOKIE_MS + RENEWAL_IDEMPOTENCY_WINDOW_MS);
    expect(leadMs).toBeLessThan(COOKIE_MS);
  });

  it('is identical for every moment of one window, so a replayed key sends identical parameters', () => {
    const first = renewalSessionExpiresAt(renewalIdempotencyWindow(WINDOW_START_MS));
    const last = renewalSessionExpiresAt(renewalIdempotencyWindow(WINDOW_START_MS + RENEWAL_IDEMPOTENCY_WINDOW_MS - 1));
    expect(last).toBe(first);
    expect(Number.isInteger(first)).toBe(true);
  });

  it('moves one window later for the next window', () => {
    const now = renewalSessionExpiresAt(renewalIdempotencyWindow(WINDOW_START_MS));
    const next = renewalSessionExpiresAt(renewalIdempotencyWindow(WINDOW_START_MS + RENEWAL_IDEMPOTENCY_WINDOW_MS));
    expect(next - now).toBe(RENEWAL_IDEMPOTENCY_WINDOW_MS / 1000);
  });
});

describe('listRenewalSessionsForJob', () => {
  it("keeps only this post's renewal sessions and passes the creation bound, page size and status", async () => {
    list.mockReturnValue(asyncList([
      session('cs_mine', { jobId: 'job-1', type: 'renewal', tier: 'pro' }),
      session('cs_other_post', { jobId: 'job-2', type: 'renewal', tier: 'pro' }),
      session('cs_new_post', { jobId: 'job-1', pricing: 'pro' }),
      session('cs_no_metadata', null),
    ]));

    const scan = await listRenewalSessionsForJob(stripe, 'job-1', { createdSince: 1_789_900_000, status: 'open' });

    expect(scan.sessions.map((s) => s.id)).toEqual(['cs_mine']);
    expect(scan.capped).toBe(false);
    expect(list).toHaveBeenCalledWith({ created: { gte: 1_789_900_000 }, limit: 100, status: 'open' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reads every state when no status is given', async () => {
    list.mockReturnValue(asyncList([]));
    await listRenewalSessionsForJob(stripe, 'job-1', { createdSince: 1 });
    expect(list).toHaveBeenCalledWith({ created: { gte: 1 }, limit: 100 });
  });

  it('stops at the cap and logs the range it left unread', async () => {
    const many = Array.from({ length: MAX_RENEWAL_SESSIONS_SCANNED + 5 }, (_, i) =>
      session(`cs_${i}`, { jobId: i === MAX_RENEWAL_SESSIONS_SCANNED + 1 ? 'job-1' : 'job-9', type: 'renewal' }, { created: 2_000_000_000 - i }));
    list.mockReturnValue(asyncList(many));

    const scan = await listRenewalSessionsForJob(stripe, 'job-1', { createdSince: 1_000, status: 'open' });

    expect(scan.capped).toBe(true);
    // The match past the cap was never read.
    expect(scan.sessions).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('stopped at the cap'),
      null,
      expect.objectContaining({
        jobId: 'job-1',
        cap: MAX_RENEWAL_SESSIONS_SCANNED,
        uncheckedFrom: 1_000,
        uncheckedUntil: 2_000_000_000 - (MAX_RENEWAL_SESSIONS_SCANNED - 1),
      }),
    );
  });

  it('does not report a cap when the scan ends exactly at it', async () => {
    list.mockReturnValue(asyncList(Array.from({ length: MAX_RENEWAL_SESSIONS_SCANNED }, (_, i) => session(`cs_${i}`, null))));
    const scan = await listRenewalSessionsForJob(stripe, 'job-1', { createdSince: 1 });
    expect(scan.capped).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('lets a Stripe failure reach the caller, which decides what it means', async () => {
    list.mockImplementation(() => { throw new Error('stripe down'); });
    await expect(listRenewalSessionsForJob(stripe, 'job-1', { createdSince: 1 })).rejects.toThrow('stripe down');
  });
});

describe('expireCheckoutSessions', () => {
  it('expires each session', async () => {
    expire.mockResolvedValue({});
    const result = await expireCheckoutSessions(stripe, ['cs_a', 'cs_b']);
    expect(result).toEqual({ expired: ['cs_a', 'cs_b'], failed: [] });
    expect(expire.mock.calls.map(([id]) => id)).toEqual(['cs_a', 'cs_b']);
  });

  it('counts a session that expired meanwhile as expired: the goal is "not payable"', async () => {
    expire.mockRejectedValue(new Error('This Checkout Session is not open'));
    retrieve.mockResolvedValue({ id: 'cs_a', status: 'expired' });
    expect(await expireCheckoutSessions(stripe, ['cs_a'])).toEqual({ expired: ['cs_a'], failed: [] });
  });

  it('reports a session that completed meanwhile: a payment may have gone through', async () => {
    expire.mockRejectedValue(new Error('This Checkout Session is not open'));
    retrieve.mockResolvedValue({ id: 'cs_a', status: 'complete' });
    const result = await expireCheckoutSessions(stripe, ['cs_a']);
    expect(result.expired).toEqual([]);
    expect(result.failed).toEqual([{ sessionId: 'cs_a', reason: expect.stringContaining('complete') }]);
  });

  it('reports a session whose state cannot be read after a failed expire', async () => {
    expire.mockRejectedValue(new Error('rate limited'));
    retrieve.mockRejectedValue(new Error('network'));
    const result = await expireCheckoutSessions(stripe, ['cs_a']);
    expect(result.failed).toEqual([{ sessionId: 'cs_a', reason: expect.stringContaining('rate limited') }]);
  });
});

describe('payableWindowsOverlap', () => {
  const base = { created: 1_000, expires_at: 4_300 };

  it('overlaps when each was created before the other expired', () => {
    expect(payableWindowsOverlap(base, { created: 2_000, expires_at: 5_300 })).toBe(true);
    expect(payableWindowsOverlap({ created: 2_000, expires_at: 5_300 }, base)).toBe(true);
  });

  it('does not overlap when one closed before the other was created', () => {
    expect(payableWindowsOverlap(base, { created: 4_300, expires_at: 7_600 })).toBe(false);
    expect(payableWindowsOverlap(base, { created: 9_000, expires_at: 12_300 })).toBe(false);
  });
});

describe('renewalExtension', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const NOW = new Date('2027-10-01T12:00:00.000Z');
  const fromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);
  const extend = (createdDaysAgo: number, expiresInDays: number | null) => renewalExtension(
    { createdAt: fromNow(-createdDaysAgo), expiresAt: expiresInDays === null ? null : fromNow(expiresInDays) },
    config.durationDays,
    NOW,
  );

  it('an expired post well inside its cap gains the full period, counted from now', () => {
    expect(extend(100, -40)).toEqual({ expiresAt: fromNow(config.durationDays), daysAdded: config.durationDays });
  });

  it('a live post gains the full period on top of the days it still has', () => {
    expect(extend(57, 3)).toEqual({ expiresAt: fromNow(3 + config.durationDays), daysAdded: config.durationDays });
  });

  it('a post with no expiry on record is counted from now', () => {
    expect(extend(10, null)).toEqual({ expiresAt: fromNow(config.durationDays), daysAdded: config.durationDays });
  });

  it('near the cap a renewal adds only the days left before it', () => {
    const daysToCap = 15;
    expect(extend(config.renewalCapDays - daysToCap, -5)).toEqual({ expiresAt: fromNow(daysToCap), daysAdded: daysToCap });
  });

  it('a post that already runs to its cap gains nothing: the expiry would not move', () => {
    const daysToCap = 15;
    expect(extend(config.renewalCapDays - daysToCap, daysToCap)).toEqual({ expiresAt: fromNow(daysToCap), daysAdded: 0 });
  });

  it('a post older than its cap gains nothing: the capped date is already past', () => {
    const extension = extend(config.renewalCapDays + 35, -340);
    expect(extension.daysAdded).toBe(0);
    expect(extension.expiresAt).toEqual(fromNow(-35));
    expect(extension.expiresAt.getTime()).toBeLessThan(NOW.getTime());
  });

  it('less than one full day before the cap counts as nothing', () => {
    const createdAt = new Date(NOW.getTime() - config.renewalCapDays * DAY_MS + 5 * HOUR_MS);
    expect(renewalExtension({ createdAt, expiresAt: fromNow(-200) }, config.durationDays, NOW).daysAdded).toBe(0);
  });

  it('exactly one full day before the cap is one day', () => {
    expect(extend(config.renewalCapDays - 1, -200).daysAdded).toBe(1);
  });
});

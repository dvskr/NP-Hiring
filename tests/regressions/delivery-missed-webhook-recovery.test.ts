/**
 * F32 regression — missed-webhook recovery, two layers:
 *   (a) /api/verify-checkout-session self-heals a paid-but-pending job by
 *       running the SAME shared activation the webhook runs;
 *   (b) a daily Inngest sweep reconciles stale 'pending' EmployerJob rows
 *       against Stripe (activates paid ones, expires abandoned ones, alerts
 *       Discord on any paid-but-pending row).
 *
 * Static source guards — they assert the wiring can't silently drift apart.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('shared activation module (single source of truth)', () => {
  const src = read('app/api/webhooks/stripe/activate-paid-job.ts');

  it('claims pending→paid atomically BEFORE publishing the job', () => {
    const claimIdx = src.indexOf("paymentStatus: 'pending' },");
    const publishIdx = src.indexOf('isPublished: true, isVerifiedEmployer: true');
    expect(claimIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeLessThan(publishIdx);
  });

  it('treats a lost claim (P2025) as already_active instead of re-applying side effects', () => {
    expect(src).toContain("'P2025'");
    expect(src).toContain("outcome: 'already_active'");
  });

  it('surfaces a missing EmployerJob row instead of skipping silently (C3)', () => {
    expect(src).toContain("outcome: 'employer_job_missing'");
  });
});

describe('webhook and verify-checkout-session share the activation path', () => {
  it('the webhook new-post branch calls activatePaidJobCheckout', () => {
    const src = read('app/api/webhooks/stripe/route.ts');
    expect(src).toMatch(/import \{ activatePaidJobCheckout, fetchInvoiceData \} from '\.\/activate-paid-job'/);
    expect(src).toMatch(/await activatePaidJobCheckout\(stripe, session\)/);
  });

  it('verify-checkout-session self-heals paid-but-pending rows via the same function', () => {
    const src = read('app/api/verify-checkout-session/route.ts');
    expect(src).toMatch(/import \{ activatePaidJobCheckout \} from '@\/app\/api\/webhooks\/stripe\/activate-paid-job'/);
    // guarded on the pending state, and only reachable after the
    // payment_status !== 'paid' early return above it
    const guardIdx = src.indexOf("employerJob.paymentStatus === 'pending'");
    const callIdx = src.indexOf('await activatePaidJobCheckout(stripe, session)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeGreaterThan(guardIdx);
  });

  it('the webhook keeps its ProcessedStripeEvent dedupe', () => {
    const src = read('app/api/webhooks/stripe/route.ts');
    expect(src).toContain('processedStripeEvent.create');
    expect(src).toContain("code === 'P2002'");
  });
});

describe('daily reconciliation sweep (Inngest, not vercel.json cron)', () => {
  const src = read('lib/inngest/functions/payment-reconciliation.ts');

  it('runs on an Inngest cron trigger', () => {
    expect(src).toMatch(/triggers:\s*\[\{\s*cron:/);
  });

  it("sweeps EmployerJob rows stuck 'pending' older than the 2h grace window", () => {
    expect(src).toContain("paymentStatus: 'pending'");
    expect(src).toContain('PENDING_MIN_AGE_MS = 2 * 60 * 60 * 1000');
  });

  it('activates paid sessions via the shared activation function', () => {
    expect(src).toMatch(/activatePaidJobCheckout\(stripe, session\)/);
  });

  it("expires abandoned checkouts past Stripe's 24h session lifetime with a guarded update", () => {
    expect(src).toContain('ABANDON_AFTER_MS = 24 * 60 * 60 * 1000');
    expect(src).toContain("data: { paymentStatus: 'expired' }");
    // the expire write must be guarded on still-pending so it can never
    // clobber a concurrent activation
    const expireIdx = src.indexOf("data: { paymentStatus: 'expired' }");
    const guard = src.lastIndexOf("paymentStatus: 'pending' },", expireIdx);
    expect(guard).toBeGreaterThan(-1);
  });

  it('alerts Discord on any paid-but-pending row', () => {
    expect(src).toContain('sendDiscordMessage');
    expect(src).toContain('Paid-but-pending');
  });

  it('is registered in the Inngest serve handler', () => {
    const serveSrc = read('app/api/inngest/route.ts');
    expect(serveSrc).toContain('paymentReconciliationFunctions');
  });

  it('adds no vercel.json cron (Inngest owns the schedule)', () => {
    const vercel = read('vercel.json');
    expect(vercel).not.toMatch(/reconcil/i);
  });
});

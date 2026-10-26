/**
 * Stripe integration hardening (2026-09-13) — static guards that keep the
 * wiring from drifting back.
 *
 *   - no Checkout Session pins `payment_method_types` (Dashboard-managed
 *     methods; every fulfilment path gates on payment_status === 'paid');
 *   - every server Stripe client comes from lib/stripe.ts (pinned apiVersion);
 *   - the bootstrap webhook event list includes the events the webhook now
 *     handles;
 *   - /pricing sells no plan (the Employer plan is retired, owner decision
 *     2026-10-24, and its code, Payment Link variable and routes were
 *     deleted on 2026-10-27);
 *   - token-authenticated invoice/receipt routes are rate-limited;
 *   - the bearer dashboardToken is never written into Stripe metadata.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CHECKOUT_ROUTES = ['app/api/create-checkout/route.ts', 'app/api/create-renewal-checkout/route.ts'];
const STRIPE_CLIENT_FILES = [
  ...CHECKOUT_ROUTES,
  'app/api/webhooks/stripe/route.ts',
  'app/api/verify-checkout-session/route.ts',
  'app/api/verify-renewal-session/route.ts',
  'app/api/employer/invoice/route.ts',
  'app/api/employer/receipt/route.ts',
  'app/api/create-pack-checkout/route.ts',
  'app/api/verify-pack-session/route.ts',
  'lib/inngest/functions/payment-reconciliation.ts',
];

describe('Checkout Sessions', () => {
  it.each(CHECKOUT_ROUTES)('%s does not pin payment_method_types', (rel) => {
    expect(read(rel)).not.toMatch(/payment_method_types/);
  });

  it.each(CHECKOUT_ROUTES)('%s passes an idempotency key and builds URLs from getBaseUrl()', (rel) => {
    const src = read(rel);
    expect(src).toContain('idempotencyKey');
    expect(src).toContain('getBaseUrl()');
    expect(src).not.toMatch(/\$\{process\.env\.NEXT_PUBLIC_BASE_URL\}\//);
  });

  it('never copies the dashboardToken into Stripe metadata', () => {
    expect(read('app/api/create-checkout/route.ts')).not.toMatch(/metadata:\s*\{[^}]*dashboardToken/);
  });
});

describe('Stripe client construction', () => {
  it('lib/stripe.ts pins the API version', () => {
    expect(read('lib/stripe.ts')).toMatch(/apiVersion:\s*STRIPE_API_VERSION/);
  });

  it.each(STRIPE_CLIENT_FILES)('%s uses the shared getStripe()', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/new Stripe\(/);
    expect(src).toContain("from '@/lib/stripe'");
  });
});

// tmp/ is gitignored, so the bootstrap script exists only on the machine that
// created the Stripe sandbox. Reading it unconditionally threw at collection
// time and failed this whole file on every clean checkout, including CI and a
// fresh worktree. Skip the block where the script is absent and keep checking
// it wherever it exists.
const BOOTSTRAP = 'tmp/stripe-bootstrap.js';
const hasBootstrap = fs.existsSync(path.join(ROOT, BOOTSTRAP));

// The events the webhook needs on the endpoint (processEvent in
// app/api/webhooks/stripe/route.ts; the full list is held to .env.example and
// docs/pricing-system.md 9b by docs-pricing-system-matches-code.test.ts).
describe.skipIf(!hasBootstrap)('Stripe bootstrap (webhook events)', () => {
  const src = hasBootstrap ? read(BOOTSTRAP) : '';

  it.each([
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'charge.dispute.closed',
  ])('enables %s on the endpoint', (evt) => {
    expect(src).toContain(`'${evt}'`);
  });
});

describe('plan purchase surfaces (the Employer plan is retired, its code deleted)', () => {
  it('/pricing offers no plan: no subscribe route, no plan-sale gate, no Payment Link', () => {
    const src = read('app/pricing/page.tsx');
    expect(src).not.toContain('/api/employer/plan/subscribe');
    expect(src).not.toContain('isPlanSaleOpen');
    expect(src).not.toContain('employer-plan-link');
    expect(src).not.toContain('STRIPE_PLAN_PAYMENT_LINK');
  });

  it('nothing reads the plan Payment Link variable, and lib/env.ts no longer declares it', () => {
    expect(read('lib/env.ts')).not.toContain('STRIPE_PLAN_PAYMENT_LINK');
    expect(read('.env.example')).not.toContain('STRIPE_PLAN_PAYMENT_LINK');
    expect(read('scripts/fork-preflight.ts')).not.toContain('STRIPE_PLAN_PAYMENT_LINK');
    for (const rel of ['app/api/employer/plan/route.ts', 'app/api/employer/plan/subscribe/route.ts', 'lib/employer-plan-link.ts']) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(false);
    }
  });
});

describe('token-authenticated billing documents', () => {
  it.each(['app/api/employer/invoice/route.ts', 'app/api/employer/receipt/route.ts'])('%s is rate-limited before any lookup', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/await rateLimit\(request, 'employer-(invoice|receipt)', RATE_LIMITS\.employer\)/);
    expect(src.indexOf('rateLimit(request')).toBeLessThan(src.indexOf('prisma.employerJob.findFirst'));
  });
});

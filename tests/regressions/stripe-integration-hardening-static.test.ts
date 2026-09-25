/**
 * Stripe integration hardening (2026-09-13) — static guards that keep the
 * wiring from drifting back.
 *
 *   - no Checkout Session pins `payment_method_types` (Dashboard-managed
 *     methods; every fulfilment path gates on payment_status === 'paid');
 *   - every server Stripe client comes from lib/stripe.ts (pinned apiVersion);
 *   - the bootstrap webhook event list includes the events the webhook now
 *     handles, and the Payment Link collects billing address + tax ID;
 *   - the /pricing plan CTA goes through the account-binding subscribe route,
 *     never the raw Payment Link;
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
  'app/api/employer/billing-portal/route.ts',
  'lib/inngest/functions/payment-reconciliation.ts',
  'lib/inngest/functions/plan-reconciliation.ts',
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

describe.skipIf(!hasBootstrap)('Stripe bootstrap (webhook events + Payment Link)', () => {
  const src = hasBootstrap ? read(BOOTSTRAP) : '';

  it.each([
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'invoice.payment_failed',
    'charge.dispute.closed',
  ])('enables %s on the endpoint', (evt) => {
    expect(src).toContain(`'${evt}'`);
  });

  it('collects billing address and tax ID on the plan Payment Link', () => {
    expect(src).toContain("billing_address_collection: 'required'");
    expect(src).toContain('tax_id_collection: { enabled: true }');
  });
});

describe('plan purchase surfaces', () => {
  it('/pricing sends the plan CTA through the subscribe route and the plan-sale gate', () => {
    const src = read('app/pricing/page.tsx');
    expect(src).toContain("'/api/employer/plan/subscribe'");
    expect(src).toContain('isPlanSaleOpen()');
    expect(src).not.toContain('process.env.STRIPE_PLAN_PAYMENT_LINK');
  });

  it('the plan endpoint builds the account-bound link server-side', () => {
    const src = read('app/api/employer/plan/route.ts');
    expect(src).toContain('buildPlanPaymentLink(');
    expect(src).not.toContain('process.env.STRIPE_PLAN_PAYMENT_LINK');
  });
});

describe('token-authenticated billing documents', () => {
  it.each(['app/api/employer/invoice/route.ts', 'app/api/employer/receipt/route.ts'])('%s is rate-limited before any lookup', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/await rateLimit\(request, 'employer-(invoice|receipt)', RATE_LIMITS\.employer\)/);
    expect(src.indexOf('rateLimit(request')).toBeLessThan(src.indexOf('prisma.employerJob.findFirst'));
  });
});

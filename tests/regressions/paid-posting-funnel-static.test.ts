/**
 * Regression (F3, audit high) — static pins for the paid-posting funnel gate.
 * The pre-F3 bug: an employer with no free post remaining could fill the
 * entire /post-job wizard, reach preview, get routed to /post-job/checkout,
 * click Pay, and only THEN hit a 503 — because ENABLE_PAID_POSTING was read
 * nowhere and no surface warned upfront. These tests pin every layer of the
 * fix so the funnel can't silently regress to the dead-end:
 *   1. /post-job checks the server availability signal BEFORE the form and
 *      renders a "paid posting coming soon" state;
 *   2. /post-job/preview warns upfront and refuses to route into a dead
 *      checkout;
 *   3. /post-job/checkout shows the coming-soon state instead of a 503 Pay;
 *   4. both checkout APIs gate on isFeatureEnabled('paidPosting') before
 *      touching Stripe;
 *   5. .env.example and the launch runbook describe the flag as real.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('F3 static — /post-job gates BEFORE the form', () => {
    const src = read('app/post-job/page.tsx');

    it('fetches the server-checked availability signal and the free-quota status', () => {
        expect(src).toContain("fetch('/api/create-checkout/availability')");
        expect(src).toContain("fetch('/api/employer/free-quota-status')");
    });

    it('only gates employers whose next post requires payment', () => {
        expect(src).toMatch(/eligible === true && quota\?\.willBeFree === false/);
    });

    it('renders the coming-soon state before the wizard form', () => {
        const comingSoonIdx = src.indexOf('Paid posting is coming soon');
        const formIdx = src.indexOf('id="job-post-form"');
        expect(comingSoonIdx).toBeGreaterThan(-1);
        expect(formIdx).toBeGreaterThan(-1);
        expect(comingSoonIdx).toBeLessThan(formIdx);
    });

    it('holds the form while the gate is unresolved', () => {
        expect(src).toMatch(/if \(paidGateLoading\) return <LoadingFallback \/>/);
    });
});

describe('F3 static — /post-job/preview refuses to route into a dead checkout', () => {
    const src = read('app/post-job/preview/page.tsx');

    it('fetches the availability signal', () => {
        expect(src).toContain("fetch('/api/create-checkout/availability')");
    });

    it('guards the requiresPayment redirect on paidPostingAvailable', () => {
        expect(src).toMatch(
            /if \(paidPostingAvailable === false\)[\s\S]*?else \{\s*router\.push\('\/post-job\/checkout'\)/,
        );
    });

    it('shows the upfront warning banner for must-pay employers', () => {
        expect(src).toMatch(
            /paidPostingAvailable === false && quotaStatus\?\.eligible === true && quotaStatus\.willBeFree === false/,
        );
    });
});

describe('F3 static — /post-job/checkout shows coming-soon instead of a 503 Pay', () => {
    const src = read('app/post-job/checkout/page.tsx');

    it('fetches the availability signal', () => {
        expect(src).toContain("fetch('/api/create-checkout/availability')");
    });

    it('early-returns the coming-soon state before the Pay button renders', () => {
        const gateIdx = src.indexOf('paidPostingAvailable === false');
        const payIdx = src.indexOf('Proceed to Payment');
        expect(gateIdx).toBeGreaterThan(-1);
        expect(payIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeLessThan(payIdx);
        expect(src).toContain('Paid posting is coming soon');
    });
});

describe('F3 static — checkout APIs gate on the real flag before Stripe', () => {
    for (const route of [
        'app/api/create-checkout/route.ts',
        'app/api/create-renewal-checkout/route.ts',
    ]) {
        it(`${route} checks isFeatureEnabled('paidPosting') before getStripe()`, () => {
            const src = read(route);
            const flagIdx = src.indexOf("isFeatureEnabled('paidPosting')");
            const stripeIdx = src.indexOf('const stripe = getStripe()');
            expect(flagIdx).toBeGreaterThan(-1);
            expect(stripeIdx).toBeGreaterThan(-1);
            expect(flagIdx).toBeLessThan(stripeIdx);
            expect(src).toContain("code: 'PAID_POSTING_DISABLED'");
            expect(src).toContain("code: 'STRIPE_NOT_CONFIGURED'");
        });
    }

    it('the availability endpoint exists and uses the combined signal', () => {
        const src = read('app/api/create-checkout/availability/route.ts');
        expect(src).toContain('getPaidPostingStatus');
        expect(src).toContain('PAID_POSTING_DISABLED');
        expect(src).toContain('STRIPE_NOT_CONFIGURED');
    });
});

describe('F3 static — the flag is wired in lib/env and documented as real', () => {
    it('lib/env.ts supports the paidPosting feature and reads ENABLE_PAID_POSTING strictly', () => {
        const src = read('lib/env.ts');
        expect(src).toContain("'sentry' | 'paidPosting'");
        expect(src).toContain("env.ENABLE_PAID_POSTING === 'true'");
        expect(src).toContain('export function getPaidPostingStatus');
    });

    it('.env.example documents the enforced flag and its 503 codes', () => {
        const src = read('.env.example');
        expect(src).toContain('ENABLE_PAID_POSTING=false');
        expect(src).toContain('PAID_POSTING_DISABLED');
        expect(src).toContain("isFeatureEnabled('paidPosting')");
    });

    it('the launch runbook describes the flag as enforced, not aspirational', () => {
        const src = read('docs/LAUNCH_RUNBOOK.md');
        expect(src).toContain('ENABLE_PAID_POSTING=false');
        expect(src).toContain('PAID_POSTING_DISABLED');
        expect(src).toContain("isFeatureEnabled('paidPosting')");
    });
});

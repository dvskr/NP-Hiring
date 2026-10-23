/**
 * Register 2.8: lib/stripe.ts pins the wire API version to the one the
 * installed Stripe SDK is typed against. The SDK's types describe only that
 * version, so a pin left behind after an upgrade would type every response
 * for one version while Stripe answers in another.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '@/lib/stripe';

describe('STRIPE_API_VERSION', () => {
    it('is the version the installed SDK is typed against', () => {
        expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION);
    });

    // The live webhook endpoint renders events in its own API version, which
    // the owner sets when creating it (LAUNCH_RUNBOOK 8a).
    it('is the version the launch runbook tells the owner to give the webhook endpoint', () => {
        const runbook = fs.readFileSync(path.resolve(__dirname, '../../docs/LAUNCH_RUNBOOK.md'), 'utf8');
        expect(runbook.replace(/\s+/g, ' ')).toContain(`Set its API version to \`${STRIPE_API_VERSION}\``);
    });
});

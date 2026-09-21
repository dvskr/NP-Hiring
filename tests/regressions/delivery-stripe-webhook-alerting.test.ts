/**
 * V8 regression — Stripe webhook failure paths must reach a human.
 * Every failure/rollback path in the payments webhook now calls
 * alertWebhookFailure(), which fans out to Sentry (captureException) and
 * Discord (sendDiscordMessage) — matching the repo's cron-alert convention.
 *
 * Static source guards.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stripe webhook failure alerting', () => {
  // The helper lives in webhook-support.ts (shared with the plan / renewal
  // modules the webhook delegates to); call sites span the webhook directory.
  const src = read('app/api/webhooks/stripe/webhook-support.ts');
  const WEBHOOK_MODULES = ['route.ts', 'plan-checkout.ts', 'plan-subscription.ts'];
  const allSrc = WEBHOOK_MODULES.map((f) => read(`app/api/webhooks/stripe/${f}`)).join('\n');

  it('imports both alert channels', () => {
    expect(src).toMatch(/import \{ captureException \} from '@\/lib\/sentry'/);
    expect(src).toMatch(/import \{ sendDiscordMessage \} from '@\/lib\/discord-notifier'/);
    expect(read('app/api/webhooks/stripe/route.ts')).toMatch(/alertWebhookFailure,[\s\S]*from '\.\/webhook-support'/);
  });

  it('the alert helper reports to Sentry AND Discord with sanitized content', () => {
    const helperIdx = src.indexOf('async function alertWebhookFailure');
    expect(helperIdx).toBeGreaterThan(-1);
    const helper = src.slice(helperIdx, helperIdx + 1600);
    expect(helper).toContain('captureException(');
    expect(helper).toContain('sendDiscordMessage(');
    expect(helper).toContain('sanitizeForDiscord(');
  });

  it('every failure/rollback path alerts (≥10 call sites)', () => {
    const calls = allSrc.match(/await alertWebhookFailure\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(10);
  });

  it('the dedupe-rollback failure (silently-dropped-retry case) alerts', () => {
    const idx = read('app/api/webhooks/stripe/route.ts').indexOf('Dedupe rollback failed');
    expect(idx).toBeGreaterThan(-1);
  });

  it('alerting is best-effort — the helper swallows its own errors', () => {
    const helperIdx = src.indexOf('async function alertWebhookFailure');
    const helper = src.slice(helperIdx, helperIdx + 1800);
    expect(helper).toMatch(/catch \(alertErr\)/);
  });
});

/**
 * Regressions for B87 — expiry lifecycle notifications:
 *
 *   1. The pre-expiry warning window is [now, +5d] instead of the fragile
 *      one-day [+4d, +5d] band — a missed cron run can no longer let a job
 *      sail through unwarned. Idempotency comes from the existing
 *      expiryWarningSentAt dedup, so re-scans never double-send.
 *   2. A post-expiry pass emails employers whose listing just expired
 *      (renewal CTA), deduped per job via EmailSend metadata (no schema
 *      change) and excluding never-published checkouts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const src = fs.readFileSync(
  path.join(ROOT, 'app/api/cron/expiry-warnings/route.ts'),
  'utf8'
);

describe('B87 — widened, idempotent-safe warning window', () => {
  it('selects jobs expiring anywhere in [now, +5d]', () => {
    expect(src).toMatch(/gte:\s*now,\s*\n\s*lte:\s*fiveDaysFromNow/);
    // The brittle one-day lower bound is gone.
    expect(src).not.toContain('fourDaysFromNow');
  });

  it('keeps the send-before-stamp dedup ordering', () => {
    // Success check precedes the expiryWarningSentAt stamp (pre-existing pin,
    // re-asserted here because this file was restructured).
    expect(src.indexOf('!result.success')).toBeLessThan(
      src.indexOf('expiryWarningSentAt: new Date()')
    );
  });
});

describe('B87 — post-expiry notification pass', () => {
  it('scans recently expired employer jobs within the lookback window', () => {
    expect(src).toMatch(/const POST_EXPIRY_LOOKBACK_DAYS = \d+/);
    expect(src).toMatch(/gte:\s*lookbackStart,\s*\n\s*lt:\s*now/);
    // Never-published checkouts and refunded rows are excluded.
    expect(src).toMatch(/paymentStatus:\s*\{\s*in:\s*\['free',\s*'free_renewed',\s*'free_upgraded',\s*'paid'\]\s*\}/);
  });

  it('dedupes per job via EmailSend metadata and ignores failed sends', () => {
    expect(src).toMatch(/emailType:\s*'expiry_warning'/);
    expect(src).toMatch(/status:\s*\{\s*not:\s*'failed'\s*\}/);
    expect(src).toMatch(/path:\s*\['phase'\],\s*equals:\s*'post_expiry'/);
    expect(src).toMatch(/path:\s*\['jobId'\],\s*equals:\s*job\.id/);
  });

  it('sends via sendAndLog with the dedup metadata attached', () => {
    expect(src).toMatch(/\{\s*phase:\s*'post_expiry',\s*jobId:\s*job\.id,\s*jobTitle:\s*job\.title\s*\}/);
    // Renewal CTA links to the token dashboard.
    expect(src).toMatch(/\/employer\/dashboard\/\$\{employerJob\.dashboardToken \|\| employerJob\.editToken\}/);
  });

  it('reports post-expiry counts in the cron metrics', () => {
    expect(src).toContain('postExpirySent');
    expect(src).toContain('postExpiryCandidates');
  });
});

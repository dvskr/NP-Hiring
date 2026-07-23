/**
 * Static regression guards for the email-cron idempotency fixes
 * (2026-07-18 med/low backlog wave — B68, B69, B71).
 *
 * Each reads the real source and asserts the fix is still present so a
 * future edit can't silently undo it (same pattern as
 * email-highs-static.test.ts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B68 — employer monthly report is idempotent per employer per month', () => {
  const src = () => read('app/api/cron/employer-report/route.ts');

  it('checks the EmailSend log for a performance_report sent this month before sending', () => {
    const s = src();
    expect(s).toMatch(/emailType:\s*'performance_report'/);
    expect(s).toMatch(/createdAt:\s*\{\s*gte:\s*monthStartUtc\s*\}/);
    // failed sends must stay retryable
    expect(s).toMatch(/status:\s*\{\s*not:\s*'failed'\s*\}/);
    // the dedupe lookup must run BEFORE the send call
    expect(s.indexOf("emailType: 'performance_report'")).toBeLessThan(
      s.indexOf('await sendPerformanceReportEmail('),
    );
  });

  it('only counts a report as sent when the send actually succeeded', () => {
    const s = src();
    expect(s).toMatch(/const result = await sendPerformanceReportEmail/);
    expect(s).toMatch(/if \(result\.success\)/);
  });
});

describe('B69 — send-alerts stamps lastSentAt per successful batch, not at run end', () => {
  it('advances lastSentAt inside the batch loop, gated on the batch outcome', () => {
    const s = read('lib/job-alerts-service.ts');
    const okIdx = s.indexOf('if (batchOutcome.ok)');
    expect(okIdx).toBeGreaterThan(-1);
    // the stamp lives inside the success branch (within the same block)
    const successBlock = s.slice(okIdx, okIdx + 600);
    expect(successBlock).toContain('lastSentAt: now');
    // and a failed batch must NOT advance lastSentAt (re-selected next cycle)
    expect(s).toMatch(/do NOT advance lastSentAt/i);
    // per-batch: the stamp occurs before the inter-batch pause, i.e. inside
    // the send loop rather than after it completes
    expect(s.indexOf('lastSentAt: now')).toBeLessThan(
      s.indexOf('Small pause between batches'),
    );
  });
});

describe('B71 — saved-job reminder only stamps the dedup marker after a real send', () => {
  it('checks the EmailResult before lastSavedJobReminderAt is written', () => {
    const s = read('app/api/cron/saved-job-reminder/route.ts');
    expect(s).toMatch(/const result = await sendSavedJobReminderEmail/);
    expect(s).toMatch(/if \(!result\.success\)/);
    // the success check must come BEFORE the stamp (mirrors expiry-warnings)
    expect(s.indexOf('!result.success')).toBeLessThan(
      s.indexOf('lastSavedJobReminderAt: new Date()'),
    );
  });
});

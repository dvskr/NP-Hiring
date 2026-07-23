/**
 * Static regression guards for the email/auth HIGH audit fixes (2026-07-11
 * enterprise gap audit). Each reads the real source and asserts the fix is
 * still present so a future edit can't silently undo it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('expiry-warnings only stamps the dedup marker after a successful send', () => {
  it('checks the EmailResult before expiryWarningSentAt is written', () => {
    const src = read('app/api/cron/expiry-warnings/route.ts');
    expect(src).toMatch(/const result = await sendExpiryWarningEmail/);
    expect(src).toMatch(/if \(!result\.success\)/);
    // the success check must come BEFORE the stamp
    expect(src.indexOf('!result.success')).toBeLessThan(src.indexOf('expiryWarningSentAt: new Date()'));
  });
});

describe('employer performance report honors the suppression list', () => {
  it('gates each recipient on isEmailSuppressed before sending', () => {
    const src = read('app/api/cron/employer-report/route.ts');
    expect(src).toContain('isEmailSuppressed');
    // gate must run before the actual send call (not the import statement)
    expect(src.indexOf('await isEmailSuppressed(email)')).toBeLessThan(
      src.indexOf('await sendPerformanceReportEmail('),
    );
    expect(src.indexOf('await isEmailSuppressed(email)')).toBeGreaterThan(-1);
  });
});

describe("auto-created 'Job Highlights' alerts are visible to the digest sender", () => {
  for (const f of ['app/auth/callback/route.ts', 'app/api/auth/profile/route.ts']) {
    it(`${f} sets confirmedAt at creation (single opt-in)`, () => {
      const src = read(f);
      const createIdx = src.indexOf("name: 'Job Highlights'");
      expect(createIdx).toBeGreaterThan(-1);
      // confirmedAt must appear inside the same create block — window sized to
      // cover the null field list plus the explanatory comment
      const block = src.slice(createIdx, createIdx + 1200);
      expect(block).toContain('confirmedAt: new Date()');
    });
  }
});

describe('send-confirmation route hardening', () => {
  const src = () => read('app/api/auth/send-confirmation/route.ts');
  it('never logs the live magic-link URL', () => {
    expect(src()).not.toMatch(/logger\.info\([^)]*url:\s*confirmationUrl/);
  });
  it('uses brand tokens, not donor PMHNP branding', () => {
    expect(src()).not.toContain('PMHNP Hiring');
    expect(src()).toMatch(/Confirm your \$\{brand\.name\} account/);
  });
});

describe('notification emails are wrapped in after() so serverless freeze cannot drop them', () => {
  const cases: Array<[string, string]> = [
    ['app/api/employer/applicants/route.ts', 'sendStatusUpdateEmail'],
    ['app/api/conversations/[id]/route.ts', 'sendCandidateInquiryNotification'],
    ['app/api/conversations/[id]/route.ts', 'sendEmployerMessageNotification'],
    ['app/api/employer/messages/route.ts', 'sendEmployerMessageNotification'],
    ['app/api/candidate/messages/route.ts', 'sendCandidateInquiryNotification'],
  ];
  for (const [file, fn] of cases) {
    it(`${file} wraps ${fn} in after()`, () => {
      const src = read(file);
      expect(src).toMatch(new RegExp(`after\\(\\s*${fn}\\(`));
      expect(src).toMatch(/import \{[^}]*after[^}]*\} from 'next\/server'/);
    });
  }
  it('no bare fire-and-forget notification sends remain in the messaging routes', () => {
    for (const f of [
      'app/api/conversations/[id]/route.ts',
      'app/api/employer/messages/route.ts',
      'app/api/candidate/messages/route.ts',
    ]) {
      const src = read(f);
      // every notification call site routes errors through logger, not console
      expect(src).not.toMatch(/\)\.catch\(err => console\.error\('(Email notification|Candidate inquiry email) error/);
    }
  });
});

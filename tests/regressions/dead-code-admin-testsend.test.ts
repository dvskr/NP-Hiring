/**
 * Static regression guards for B25 — the admin broadcast "test send" used to
 * hardcode a personal email address ('daggu@live.com'). It now resolves the
 * signed-in admin's own email from /api/auth/profile and refuses to send a
 * test until that email is known. These pins keep hardcoded recipients out.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PAGE = 'app/admin/email/page.tsx';
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B25 — admin test send targets the session admin, not a hardcoded address', () => {
  it('no hardcoded email literal remains in the admin email page', () => {
    const src = read(PAGE);
    expect(src).not.toContain('daggu@live.com');
    // No string-literal recipient list anywhere in the page: customEmails
    // built from state (custom audience textarea) or from adminEmail only.
    expect(src).not.toMatch(/customEmails:\s*\[\s*['"`]/);
  });

  it('the test send uses the fetched session-admin email', () => {
    const src = read(PAGE);
    expect(src).toMatch(/customEmails:\s*\[adminEmail\]/);
    // The email comes from the signed-in profile, not from a constant.
    expect(src).toContain("fetch('/api/auth/profile')");
  });

  it('the test send fails loudly when the admin email is unknown', () => {
    const src = read(PAGE);
    expect(src).toMatch(/if\s*\(!adminEmail\)/);
  });
});

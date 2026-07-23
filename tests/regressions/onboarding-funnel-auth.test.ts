/**
 * Regressions for the onboarding/funnel-seams backlog (auth surfaces):
 *
 *   B77 — confirmed users route through the skippable /onboarding/professional
 *         interstitial when the confirmation link carries no explicit ?next=;
 *         explicit intent always wins.
 *   B84 — expired signup-confirmation links land on an inline
 *         resend-confirmation surface instead of being bounced to password
 *         reset; expired RECOVERY links still go to /forgot-password.
 *   B86 — requireAuth carries the attempted path into /login?next=<path> so
 *         deep links into protected pages survive the login round-trip.
 *   B67 — the decorative "Remember me" checkbox is gone (supabase/ssr offers
 *         no cheap per-login persistence toggle, so a no-op control is worse
 *         than none).
 *   B83 — the dashboard profile-completeness chips deep-link into the
 *         settings tab that holds the missing field.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CONFIRM_PAGE = 'app/auth/confirm/page.tsx';
const PROTECT = 'lib/auth/protect.ts';
const LOGIN_CONTENT = 'components/auth/LoginContent.tsx';
const DASHBOARD_CONTENT = 'components/dashboard/DashboardContent.tsx';

describe('B77 — /auth/confirm routes fresh candidates through the interstitial', () => {
  it('substitutes /onboarding/professional for the default destination only', () => {
    const src = read(CONFIRM_PAGE);
    // Explicit ?next= still validated the same way (F26 pin preserved).
    expect(src).toMatch(/safeInternalPath\(urlParams\.get\('next'\),\s*'\/dashboard'\)/);
    // Default (no explicit intent) becomes the interstitial; explicit wins.
    expect(src).toMatch(
      /requestedNext === '\/dashboard'\s*\?\s*'\/onboarding\/professional'\s*:\s*requestedNext/
    );
    // Both confirmation success paths still push the computed target.
    const pushes = src.match(/router\.push\(nextPath\)/g) ?? [];
    expect(pushes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('B84 — expired confirmation links get a resend surface', () => {
  it('otp_expired signup links render the resend UI instead of redirecting to password reset', () => {
    const src = read(CONFIRM_PAGE);
    // An 'expired' status exists and otp_expired (non-recovery) sets it.
    expect(src).toMatch(/'loading'\s*\|\s*'success'\s*\|\s*'error'\s*\|\s*'expired'/);
    expect(src).toContain("setStatus('expired')");
    // The resend surface posts to the existing send-confirmation endpoint.
    expect(src).toContain("fetch('/api/auth/send-confirmation'");
    // Expired RECOVERY links (type=recovery) still go to /forgot-password…
    expect(src).toMatch(/urlParams\.get\('type'\) === 'recovery'/);
    // …but the old unconditional 4s bounce to /forgot-password is dead.
    expect(src).not.toMatch(/setTimeout\(\(\) => router\.push\('\/forgot-password'\),\s*4000\)/);
  });
});

describe('B86 — requireAuth appends the attempted path as /login?next=', () => {
  it('requireAuth accepts returnTo and encodes it into the login redirect', () => {
    const src = read(PROTECT);
    expect(src).toMatch(/export async function requireAuth\(returnTo\?: string\)/);
    // eslint-disable-next-line no-template-curly-in-string
    expect(src).toContain('`/login?next=${encodeURIComponent(returnTo)}`');
    // The bare redirect survives as the no-returnTo fallback.
    expect(src).toMatch(/:\s*'\/login'\)/);
  });

  it('the role helpers thread returnTo through', () => {
    const src = read(PROTECT);
    expect(src).toMatch(/requireRole\(allowedRoles: UserRole\[\], returnTo\?: string\)/);
    expect(src).toMatch(/requireAuth\(returnTo\)/);
    expect(src).toMatch(/export async function requireEmployer\(returnTo\?: string\)/);
    expect(src).toMatch(/export async function requireAdmin\(returnTo\?: string\)/);
  });

  it('protected pages pass their own path', () => {
    expect(read('app/dashboard/page.tsx')).toContain("requireAuth('/dashboard')");
    expect(read('app/employer/dashboard/page.tsx')).toContain("requireEmployer('/employer/dashboard')");
    expect(read('app/employer/settings/page.tsx')).toContain("requireEmployer('/employer/settings')");
    expect(read('app/employer/applicants/page.tsx')).toContain("requireEmployer('/employer/applicants')");
    expect(read('app/employer/analytics/page.tsx')).toContain("requireEmployer('/employer/analytics')");
    expect(read('app/employer/candidates/page.tsx')).toContain("requireEmployer('/employer/candidates')");
    // Dynamic page builds its path from the awaited param.
    // eslint-disable-next-line no-template-curly-in-string
    expect(read('app/employer/candidates/[id]/page.tsx')).toContain(
      // eslint-disable-next-line no-template-curly-in-string
      'requireEmployer(`/employer/candidates/${encodeURIComponent(id)}`)'
    );
  });
});

describe('B67 — the decorative Remember-me checkbox is removed', () => {
  it('LoginContent renders no Remember me control', () => {
    const src = read(LOGIN_CONTENT);
    expect(src).not.toContain('Remember me');
    expect(src).not.toMatch(/type="checkbox"/);
    // The forgot-password affordance survives.
    expect(src).toContain('/forgot-password');
  });
});

describe('B83 — dashboard completeness chips link to the owning settings tab', () => {
  it('chips are Links built from fieldId (tab-<key> → /settings?tab=<key>)', () => {
    const src = read(DASHBOARD_CONTENT);
    // eslint-disable-next-line no-template-curly-in-string
    expect(src).toContain('`/settings?tab=${item.fieldId.replace(/^tab-/, \'\')}`');
    // The inert span chips must not come back for missing items.
    expect(src).not.toMatch(/missingItems\.slice\(0, 4\)\.map\(\(item\) => \(\s*<span/);
  });

  it('every fieldId emitted by profile-completeness maps to a real settings tab key', () => {
    const completeness = read('lib/profile-completeness.ts');
    const tabs = read('components/settings/SettingsTabs.tsx');
    const fieldIds = [...new Set(
      [...completeness.matchAll(/fieldId:\s*'tab-([a-z]+)'/g)].map((m) => m[1])
    )];
    expect(fieldIds.length).toBeGreaterThan(0);
    for (const key of fieldIds) {
      expect(tabs, `settings tab '${key}' missing for fieldId 'tab-${key}'`)
        .toMatch(new RegExp(`key:\\s*'${key}'`));
    }
  });
});

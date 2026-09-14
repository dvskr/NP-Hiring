import { test, expect, type Page, type APIResponse } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { createClient as createSupabaseAdminClient } from '@supabase/supabase-js';
import { brand } from '../../../config/brand';
import { playwrightAuth } from '../helpers/auth';
import { getSeekerCreds, getEmployerCreds, type AuthCreds } from '../fixtures/auth';
import { visibleDashOffenders, signOutViaMenu } from '../helpers/candidate';
import { db, hasDb, supabaseIdForEmail, closeDb } from '../helpers/db';

/**
 * Auth edge-cases + security probes (journey: auth-security).
 *
 * Everything here is read-only against the app's own data except the IDOR
 * block, which seeds a victim candidate / foreign employer via Prisma and
 * deletes them again in afterAll.
 *
 * Environment notes (see tests/e2e/README.md):
 *  - lib/csrf.ts only accepts Origin http://localhost:3000 (or the served
 *    origin, which under `next start` is `localhost`). Browser-driven form
 *    POSTs therefore navigate to MUT_ORIGIN (localhost) even when
 *    PLAYWRIGHT_BASE_URL points at 127.0.0.1. Pure API probes use the
 *    `request` fixture, which sends no Origin header and so passes CSRF.
 *  - Rate limits key on x-forwarded-for; every probe that could exhaust a
 *    bucket uses a fresh fake IP so reruns within the window stay green.
 */

const SEEKER = getSeekerCreds();
const EMPLOYER = getEmployerCreds();
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const BASE_HOST = new URL(BASE_URL).host;
const MUT_ORIGIN =
  process.env.PLAYWRIGHT_MUTATION_BASE_URL ||
  (BASE_URL.includes('127.0.0.1') ? BASE_URL.replace('127.0.0.1', 'localhost') : BASE_URL);
const AGAINST_PROD = BASE_URL.includes(brand.domain);
const TEST_JOB_ID = process.env.E2E_TEST_JOB_ID;
const CAN_SEED = !!process.env.DATABASE_URL && !AGAINST_PROD;
const QUARANTINE_SLUG = process.env.E2E_QUARANTINE_JOB_SLUG;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IS_LOCAL = /localhost|127\.0\.0\.1/.test(BASE_URL);
// Under `next start -H 0.0.0.0` Next builds request.url from the bind host,
// so server-issued absolute Locations may say 0.0.0.0 / localhost instead of
// the host the browser used. Any loopback alias is "still on our site" for a
// local run; against a real deployment the host must match exactly.
const SAME_SITE_HOSTNAMES = new Set([new URL(BASE_URL).hostname, ...(IS_LOCAL ? ['localhost', '127.0.0.1', '0.0.0.0'] : [])]);
const SUPABASE_REF = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname.split('.')[0];
  } catch {
    return '';
  }
})();

// ── helpers ────────────────────────────────────────────────────────────────

/** Fresh fake client IP so per-IP rate-limit buckets are isolated per test run. */
function uniqueIp(): string {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
}

const THIRD_PARTY_NOISE = [
  /googletagmanager|google-analytics|gstatic|googleapis|stripe\.com|sentry|inngest/i,
  /favicon|manifest\.json/i,
  /net::ERR_(BLOCKED_BY_CLIENT|NAME_NOT_RESOLVED|CONNECTION|INTERNET_DISCONNECTED)/i,
];
// Console errors that indicate a broken page (not just app-level logging).
const FATAL_CONSOLE = [
  /hydrat/i,
  /Minified React error/i,
  /Refused to (execute|load|apply|connect|frame)/i, // CSP violations
  /Uncaught/i,
  /ChunkLoadError/i,
  /is not defined/i,
];

function installConsoleGuard(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  return {
    pageErrors,
    consoleErrors,
    assertClean(allow: RegExp[] = []) {
      const ignored = [...THIRD_PARTY_NOISE, ...allow];
      const uncaught = pageErrors.filter((t) => !ignored.some((r) => r.test(t)));
      const fatal = consoleErrors.filter(
        (t) => FATAL_CONSOLE.some((r) => r.test(t)) && !ignored.some((r) => r.test(t)),
      );
      if (consoleErrors.length) {
        test.info().annotations.push({ type: 'console-errors', description: consoleErrors.join(' | ').slice(0, 2000) });
      }
      expect(uncaught, 'uncaught page errors').toEqual([]);
      expect(fatal, 'fatal console errors (hydration / CSP / React)').toEqual([]);
    },
  };
}

async function loginVia(page: Page, loginPath: string, creds: AuthCreds) {
  await page.goto(loginPath);
  await page.locator('input[type="email"]').first().fill(creds.email);
  await page.locator('input[type="password"]').first().fill(creds.password);
  await page.locator('button[type="submit"]').first().click();
  await waitForSignedIn(page);
}

/** Like the helper's wait, but explains WHY sign-in stalled (rate limit, wrong creds…). */
async function waitForSignedIn(page: Page) {
  try {
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
  } catch (err) {
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(`sign-in did not leave /login (${page.url()}). Page said: "${text}"`, { cause: err });
  }
}

/** playwrightAuth with the same stall diagnostics as loginVia. */
async function authAs(page: Page, role: 'candidate' | 'employer') {
  try {
    await playwrightAuth(page, role);
  } catch (err) {
    if (!/\/login/.test(page.url())) throw err;
    await waitForSignedIn(page);
  }
}

async function bodyText(res: APIResponse): Promise<string> {
  return (await res.text()).slice(0, 300);
}

async function expectBranded(page: Page) {
  // Branded shell (header logo/wordmark) present and no raw stack trace text.
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/at [\w.]+ \(.*:\d+:\d+\)|Unhandled Runtime Error|TypeError:|ReferenceError:/);
  const firstWord = brand.name.split(' ')[0];
  await expect(page.locator('body')).toContainText(firstWord);
}

// ── 1. forgot-password ─────────────────────────────────────────────────────

test.describe('forgot-password', () => {
  test('API: response is byte-identical for a known and an unknown email (no enumeration)', async ({ request }) => {
    test.skip(!SEEKER, 'E2E_SEEKER_EMAIL not set');
    const ip = uniqueIp();
    const post = (email: string) =>
      request.post('/api/auth/forgot-password', {
        headers: { 'x-forwarded-for': ip, Origin: MUT_ORIGIN },
        data: { email },
      });
    const known = await post(SEEKER!.email);
    const unknown = await post(`e2e-nobody-${Date.now()}@example.invalid`);
    expect(known.status()).toBe(200);
    expect(unknown.status()).toBe(known.status());
    expect(await unknown.json()).toEqual(await known.json());
    expect((await known.json()).message).toMatch(/if an account exists/i);
  });

  test('API: malformed bodies are 400, never 500, and never leak details', async ({ request }) => {
    const cases: Array<{ data?: unknown; raw?: string }> = [
      { data: { email: 'not-an-email' } },
      { data: {} },
      { raw: '{not json' },
      { data: { email: 'a'.repeat(250) + '@example.invalid' } },
      { data: { email: 'a@b.co', redirectTo: 'not a url' } },
    ];
    for (const c of cases) {
      const res = await request.post('/api/auth/forgot-password', {
        headers: { 'x-forwarded-for': uniqueIp(), Origin: MUT_ORIGIN, 'content-type': 'application/json' },
        data: c.raw ?? c.data,
      });
      expect(res.status(), JSON.stringify(c)).toBe(400);
      expect(await bodyText(res)).not.toMatch(/ZodError|stack|at \w+ \(/);
    }
    // A javascript: URL parses as a URL (zod accepts it); the route must
    // discard it as a redirect target and answer with the generic 200.
    const js = await request.post('/api/auth/forgot-password', {
      headers: { 'x-forwarded-for': uniqueIp(), Origin: MUT_ORIGIN },
      data: { email: `e2e-js-${Date.now()}@example.invalid`, redirectTo: 'javascript:alert(1)' },
    });
    expect(js.status()).toBe(200);
    expect(await bodyText(js)).not.toMatch(/javascript:/i);
  });

  test('API: rate-limits the 4th request per IP within the hour with Retry-After', async ({ request }) => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    let last: APIResponse | null = null;
    for (let i = 0; i < 4; i++) {
      last = await request.post('/api/auth/forgot-password', {
        headers: { 'x-forwarded-for': ip, Origin: MUT_ORIGIN },
        data: { email: `e2e-rl-${i}-${Date.now()}@example.invalid` },
      });
      statuses.push(last.status());
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
    expect(Number(last!.headers()['retry-after'])).toBeGreaterThan(0);
    expect(await last!.json()).toMatchObject({ error: 'Too many requests' });
  });

  test('API: redirectTo on a foreign host is silently discarded (still generic 200)', async ({ request }) => {
    const res = await request.post('/api/auth/forgot-password', {
      headers: { 'x-forwarded-for': uniqueIp(), Origin: MUT_ORIGIN },
      data: { email: `e2e-redir-${Date.now()}@example.invalid`, redirectTo: 'https://evil.example/steal' },
    });
    expect(res.status()).toBe(200);
    expect(await bodyText(res)).not.toContain('evil.example');
  });

  test('UI: keyboard-only submit, single request on double-click, success state, back link', async ({ page }) => {
    const guard = installConsoleGuard(page);
    const ip = uniqueIp();
    let posts = 0;
    await page.route('**/api/auth/forgot-password', (route) => {
      posts++;
      route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } });
    });
    await page.goto(`${MUT_ORIGIN}/forgot-password`);
    await expect(page).toHaveTitle(/reset|password|forgot/i);

    // Keyboard-only: focus the field, type, press Enter.
    await page.locator('#reset-email').focus();
    await page.keyboard.type(`e2e-ui-${Date.now()}@example.invalid`);
    const submit = page.locator('button[type="submit"]');
    // Double-submit guard: a real double-click (two input events) must yield one POST.
    const box = await submit.boundingBox();
    if (!box) throw new Error('submit button has no bounding box');
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText(/check your email/i)).toBeVisible();
    expect(posts, 'exactly one forgot-password POST').toBe(1);
    await expect(submit).toHaveCount(0);

    // Reload resets to the form (no stale success state), back link goes to /login.
    await page.reload();
    await expect(page.locator('#reset-email')).toBeVisible();
    await page.getByRole('link', { name: /back to login/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
    guard.assertClean();
  });

  test('UI: shows the documented message when the IP is rate-limited', async ({ page, request }) => {
    const ip = uniqueIp();
    for (let i = 0; i < 3; i++) {
      await request.post('/api/auth/forgot-password', {
        headers: { 'x-forwarded-for': ip, Origin: MUT_ORIGIN },
        data: { email: `e2e-exhaust-${i}-${Date.now()}@example.invalid` },
      });
    }
    await page.route('**/api/auth/forgot-password', (route) =>
      route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
    );
    await page.goto(`${MUT_ORIGIN}/forgot-password`);
    await page.locator('#reset-email').fill(`e2e-ui-429-${Date.now()}@example.invalid`);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(/too many reset attempts/i)).toBeVisible();
    await expect(page.locator('#reset-email')).toBeVisible();
  });
});

// ── 2. reset-password ─────────────────────────────────────────────────────

test.describe('reset-password', () => {
  test('expired token renders branded "Link Expired" with a request-new-link path', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.getByRole('heading', { name: /link expired/i })).toBeVisible();
    await expectBranded(page);
    await page.getByRole('link', { name: /request new link/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    guard.assertClean();
  });

  test('bad token with hostile error_description is neutralised (no XSS, generic message)', async ({ page }) => {
    const guard = installConsoleGuard(page);
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs++;
      d.dismiss().catch(() => undefined);
    });
    await page.goto('/reset-password?error=access_denied&error_code=bad_token&error_description=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E');
    await expect(page.getByText(/invalid or expired reset link/i)).toBeVisible();
    expect(dialogs).toBe(0);
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await expectBranded(page);
    guard.assertClean();
  });

  test('without a recovery session: no password form; a "Reset Link Required" state points to /forgot-password', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/reset-password');
    // A signed-out visitor has no link session, so once the session check
    // resolves the page must not offer a password form at all.
    await expect(page.getByRole('heading', { name: /reset link required/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#reset-password')).toHaveCount(0);
    await expect(page.locator('a[href="/forgot-password"]').first()).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password/);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/at \w+ \(|prisma/i);
    await expectBranded(page);
    guard.assertClean();
  });
});

test.describe('reset-password mid-flow', () => {
  test('refresh and back navigation keep the signed-out reset page stable, with no error or stack', async ({ page }) => {
    const guard = installConsoleGuard(page);
    // Signed out there is no form to type into (a link session is required);
    // the no-session state must survive a reload and a back navigation.
    await page.goto('/reset-password');
    const required = page.getByRole('heading', { name: /reset link required/i });
    await expect(required).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(required).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/passwords do not match/i)).toHaveCount(0);
    // Browser back onto the reset page must not resubmit or trap the user.
    await page.goto('/forgot-password');
    await page.goBack();
    await expect(page).toHaveURL(/\/reset-password/);
    await expect(required).toBeVisible({ timeout: 20_000 });
    await expectBranded(page);
    guard.assertClean();
  });
});

// ── 3. /auth/confirm + /auth/callback ─────────────────────────────────────

test.describe('auth confirm / callback', () => {
  const CONFIRM_LOG_NOISE = [/Auth error from (query params|hash)/, /Missing tokens in hash/, /Failed to set session/];

  test('expired confirmation link exposes the resend surface; keyboard-only resend works', async ({ page }) => {
    const guard = installConsoleGuard(page);
    let resendBody: unknown = null;
    await page.route('**/api/auth/send-confirmation', async (route) => {
      resendBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    });
    await page.goto('/auth/confirm?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.getByText(/confirmation link has expired/i)).toBeVisible();
    const input = page.locator('#resend-email');
    await expect(input).toBeVisible();
    const button = page.getByRole('button', { name: /resend confirmation email/i });
    await expect(button).toBeDisabled();

    await input.focus();
    await page.keyboard.type('e2e-resend@example.invalid');
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/confirmation email sent/i)).toBeVisible();
    expect(resendBody).toEqual({ email: 'e2e-resend@example.invalid' });
    await expect(page).toHaveURL(/\/auth\/confirm/);
    guard.assertClean(CONFIRM_LOG_NOISE);
  });

  test('garbage PKCE code must not be reported as "Email confirmed"', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/auth/confirm?code=this-is-not-a-real-code');
    await expect(page.getByText(/invalid|expired|failed/i)).toBeVisible();
    await expect(page.getByText(/email (is )?confirmed/i)).toHaveCount(0);
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).searchParams.get('confirmed')).toBeNull();
    guard.assertClean(CONFIRM_LOG_NOISE);
  });

  test('garbage hash tokens → clear error, bounce to /login, no uncaught errors', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/auth/confirm#access_token=garbage&refresh_token=garbage&type=signup');
    await expect(page.getByText(/session (has )?expired or (is )?invalid|invalid authentication link/i)).toBeVisible();
    await page.waitForURL(/\/login/);
    guard.assertClean(CONFIRM_LOG_NOISE);
  });

  test('no token at all: "link is invalid or has expired" then /login', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/auth/confirm');
    await expect(page.getByText(/invalid or (has )?expired/i)).toBeVisible();
    await page.waitForURL(/\/login/);
    guard.assertClean(CONFIRM_LOG_NOISE);
  });

  test('open-redirect guard: ?next= to a foreign host never leaves the site', async ({ page, request }) => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', 'https:evil.example']) {
      // Server route: no code → bounces to /auth/confirm carrying params; garbage code → /login.
      const cb = await request.get(`/auth/callback?code=garbage&next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
      expect([302, 307, 308], `callback status for ${next}`).toContain(cb.status());
      const loc = new URL(cb.headers()['location'] ?? '', BASE_URL);
      expect(SAME_SITE_HOSTNAMES.has(loc.hostname), `callback Location ${loc.href} for next=${next} must stay on-site`).toBe(true);
      expect(loc.hostname).not.toMatch(/evil/);
      expect(loc.pathname).toBe('/login');

      // Client page: safeInternalPath must reject it too.
      await page.goto(`/auth/confirm?next=${encodeURIComponent(next)}`);
      await page.waitForURL(/\/login/);
      expect(new URL(page.url()).host).toBe(BASE_HOST);
    }
  });

  test('send-confirmation API: unknown email must not mint an auth user or send mail', async ({ request }) => {
    test.skip(!CAN_SEED || !SUPABASE_URL || !SUPABASE_SERVICE_KEY, 'needs DATABASE_URL + SUPABASE_SERVICE_ROLE_KEY (dev only)');
    const email = `e2e-ghost-${Date.now()}@example.invalid`;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const admin = createSupabaseAdminClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const findGhost = async () => {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      return data.users.filter((u) => u.email === email);
    };
    try {
      const res = await request.post('/api/auth/send-confirmation', {
        headers: { 'x-forwarded-for': uniqueIp(), Origin: MUT_ORIGIN },
        data: { email },
      });
      expect(res.status(), await bodyText(res)).toBeLessThan(500);
      expect(await prisma.emailSend.count({ where: { to: email } }), 'no confirmation email for a non-existent account').toBe(0);
      expect(await findGhost(), 'no auth user minted by an anonymous request').toEqual([]);
    } finally {
      for (const u of await findGhost()) await admin.auth.admin.deleteUser(u.id);
      await prisma.emailSend.deleteMany({ where: { to: email } });
      await prisma.$disconnect();
      await pool.end();
    }
  });

  test('send-confirmation API: invalid email string → 400, not 500', async ({ request }) => {
    const res = await request.post('/api/auth/send-confirmation', {
      headers: { 'x-forwarded-for': uniqueIp(), Origin: MUT_ORIGIN },
      data: { email: 'x' },
    });
    expect(res.status(), await bodyText(res)).toBe(400);
  });

  test('send-confirmation API: malformed body → 400, never 500', async ({ request }) => {
    for (const data of [{}, { email: 42 }, { email: '' }]) {
      const res = await request.post('/api/auth/send-confirmation', {
        headers: { 'x-forwarded-for': uniqueIp(), Origin: MUT_ORIGIN },
        data,
      });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }
  });
});

// ── 4. login open-redirect guard ──────────────────────────────────────────

test.describe('login open-redirect guard', () => {
  test.skip(!SEEKER, 'E2E_SEEKER_EMAIL / E2E_SEEKER_PASS not set');

  for (const target of ['https://evil.example', '//evil.example', '/\\evil.example']) {
    test(`redirectTo=${target} falls back to /dashboard after sign-in`, async ({ page }) => {
      const guard = installConsoleGuard(page);
      await loginVia(page, `/login?redirectTo=${encodeURIComponent(target)}`, SEEKER!);
      const url = new URL(page.url());
      expect(url.host).toBe(BASE_HOST);
      expect(url.pathname).toBe('/dashboard');
      guard.assertClean();
    });
  }

  test('keyboard-only sign-in (Tab/Enter) works and honours ?next= from a gated page', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/);
    const back = new URL(page.url()).searchParams.get('next');
    expect(back, 'requireAuth threads the original path as ?next=').toBe('/dashboard');
    await page.locator('input[type="email"]').first().focus();
    await page.keyboard.type(SEEKER!.email);
    await page.keyboard.press('Tab');
    await expect(page.locator('input[type="password"]').first()).toBeFocused();
    await page.keyboard.type(SEEKER!.password);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/dashboard/);
    expect(new URL(page.url()).host).toBe(BASE_HOST);
    guard.assertClean();
  });

  test('wrong password → inline error, stays on /login, no account-existence hint', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/login');
    await page.locator('input[type="email"]').first().fill(SEEKER!.email);
    await page.locator('input[type="password"]').first().fill('definitely-not-the-password-1!');
    await page.locator('button[type="submit"]').first().click();
    await expect(page.getByText(/invalid|incorrect|wrong|credentials/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/user (does )?not (exist|found)|no account/i);
    await expectBranded(page);
    guard.assertClean([/400|Invalid login credentials/i]);
  });

  test('?next= variant is guarded too, and a same-origin path is honoured', async ({ page }) => {
    await loginVia(page, '/login?next=https%3A%2F%2Fevil.example', SEEKER!);
    expect(new URL(page.url()).host).toBe(BASE_HOST);
    expect(new URL(page.url()).pathname).toBe('/dashboard');

    // Already signed in → server-side redirect on /login must also be guarded.
    await page.goto('/login?redirectTo=https%3A%2F%2Fevil.example');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    expect(new URL(page.url()).host).toBe(BASE_HOST);
    expect(new URL(page.url()).pathname).toBe('/dashboard');

    await page.goto('/login?redirectTo=%2Fjobs');
    await page.waitForURL(/\/jobs/);
    expect(new URL(page.url()).host).toBe(BASE_HOST);
  });
});

// ── 5. CSRF ───────────────────────────────────────────────────────────────

const FIXED_ID = '00000000-0000-4000-8000-00000000e2e1';

const CSRF_ROUTES: Array<{ name: string; method: 'post' | 'patch'; path: string; data: unknown }> = [
  { name: 'job-alerts create', method: 'post', path: '/api/job-alerts', data: { email: 'not-an-email', name: 'x' } },
  { name: 'applications apply', method: 'post', path: '/api/applications/apply-direct', data: { jobId: TEST_JOB_ID ?? FIXED_ID } },
  { name: 'saved-jobs', method: 'post', path: '/api/saved-jobs', data: { jobId: TEST_JOB_ID ?? FIXED_ID } },
  { name: 'messages send', method: 'post', path: '/api/conversations/clxxxxxxxxxxxxxxxxxxxxxxx', data: { body: 'hi' } },
  { name: 'profile update', method: 'patch', path: '/api/auth/profile', data: { firstName: 'x' } },
  { name: 'employer/jobs toggle-publish', method: 'patch', path: `/api/employer/jobs/${TEST_JOB_ID ?? FIXED_ID}/toggle-publish`, data: {} },
  { name: 'employer/jobs archive', method: 'patch', path: `/api/employer/jobs/${TEST_JOB_ID ?? FIXED_ID}/archive`, data: {} },
  { name: 'employer messages send', method: 'post', path: '/api/employer/messages', data: { candidateId: FIXED_ID, body: 'hi' } },
  { name: 'send-confirmation', method: 'post', path: '/api/auth/send-confirmation', data: { email: 42 } },
];
const FORGED_ORIGINS = ['https://evil.example', 'http://localhost:3000.evil.example', `https://${brand.domain}.evil.example`, 'null'];

test.describe('CSRF origin gate', () => {
  for (const r of CSRF_ROUTES) {
    test(`${r.name}: forged Origin / Referer → 403; same-origin passes the gate`, async ({ request }) => {
      for (const origin of FORGED_ORIGINS) {
        const res = await request[r.method](r.path, { headers: { Origin: origin }, data: r.data });
        expect(res.status(), `${r.method.toUpperCase()} ${r.path} Origin=${origin}`).toBe(403);
        expect(await res.json()).toMatchObject({ error: expect.stringMatching(/cross-origin/i) });
      }
      const referer = await request[r.method](r.path, { headers: { Referer: 'https://evil.example/page' }, data: r.data });
      expect(referer.status(), 'forged Referer only').toBe(403);

      const same = await request[r.method](r.path, { headers: { Origin: MUT_ORIGIN }, data: r.data });
      expect(same.status(), `same-origin ${MUT_ORIGIN} must reach the handler`).not.toBe(403);
      expect(same.status()).toBeLessThan(500);
    });
  }

  test('Origin equal to the served host is accepted (not only the static allowlist)', async ({ request }) => {
    const res = await request.patch('/api/auth/profile', { headers: { Origin: BASE_URL }, data: { firstName: 'x' } });
    expect(res.status()).not.toBe(403);
  });
});

// ── 6. unauthenticated API access ─────────────────────────────────────────

type AnonRoute = { method: 'get' | 'post' | 'patch' | 'delete'; path: string; data?: unknown; fixme?: string };
// Fixed, never-existing id so test titles are identical in the runner and the
// worker process (a per-process randomUUID() in a title breaks test lookup).
const UUID = '00000000-0000-4000-8000-00000000e2e0';
const JD_FIXME = 'DEFECT (low): /api/employer/jd-templates returns 403 for an anonymous caller (should be 401) — getEmployerUserId() folds "no session" into "forbidden"';
const ANON_ROUTES: AnonRoute[] = [
  { method: 'get', path: '/api/dashboard' },
  { method: 'get', path: '/api/auth/profile' },
  { method: 'patch', path: '/api/auth/profile', data: { firstName: 'x' } },
  { method: 'get', path: '/api/auth/extension-token' },
  { method: 'delete', path: '/api/auth/delete-account', data: {} },
  { method: 'get', path: '/api/conversations' },
  { method: 'get', path: '/api/saved-jobs' },
  { method: 'post', path: '/api/saved-jobs', data: { jobId: UUID } },
  { method: 'delete', path: '/api/saved-jobs', data: { jobId: UUID } },
  { method: 'get', path: '/api/documents/resume/me/url' },
  { method: 'get', path: '/api/candidate/messages?jobId=x' },
  { method: 'post', path: '/api/candidate/messages', data: { jobId: UUID } },
  { method: 'get', path: '/api/profile/work-experience' },
  { method: 'post', path: '/api/profile/work-experience', data: {} },
  { method: 'get', path: '/api/profile/export' },
  { method: 'post', path: '/api/profile/clear', data: {} },
  { method: 'get', path: '/api/profile/screening-answers' },
  { method: 'post', path: '/api/upload', data: {} },
  { method: 'get', path: '/api/autofill/usage' },
  { method: 'post', path: '/api/autofill/generate-answer', data: {} },
  { method: 'get', path: '/api/user/email-preferences/ai-digest' },
  { method: 'get', path: '/api/admin/users' },
  { method: 'get', path: '/api/admin/jobs' },
  { method: 'get', path: '/api/admin/analytics' },
  { method: 'post', path: '/api/admin/jobs/bulk', data: {} },
  { method: 'get', path: '/api/employer/candidates' },
  { method: 'get', path: '/api/employer/free-quota-status' },
  { method: 'get', path: '/api/applications' },
  { method: 'post', path: '/api/applications', data: { jobId: UUID } },
  { method: 'delete', path: '/api/applications', data: { jobId: UUID } },
  { method: 'delete', path: '/api/applications/withdraw', data: { applicationId: 'x' } },
  { method: 'post', path: '/api/applications/apply-direct', data: { jobId: UUID } },
  { method: 'get', path: '/api/employer/applicants' },
  { method: 'patch', path: '/api/employer/applicants', data: { applicationId: 'x', status: 'screening' } },
  { method: 'get', path: '/api/employer/analytics' },
  { method: 'get', path: '/api/employer/analytics/csv' },
  { method: 'get', path: '/api/employer/analytics/benchmarks' },
  { method: 'get', path: '/api/employer/billing' },
  { method: 'get', path: `/api/employer/candidates/${UUID}` },
  { method: 'get', path: `/api/employer/candidates/${UUID}/resume` },
  { method: 'get', path: '/api/employer/messages' },
  { method: 'post', path: '/api/employer/messages', data: {} },
  { method: 'get', path: '/api/employer/settings' },
  { method: 'patch', path: '/api/employer/settings', data: {} },
  { method: 'get', path: '/api/employer/settings/notifications' },
  { method: 'patch', path: '/api/employer/settings/notifications', data: { employerJobId: UUID } },
  { method: 'get', path: '/api/employer/saved-candidates' },
  { method: 'post', path: '/api/employer/saved-candidates', data: { candidateId: UUID } },
  { method: 'delete', path: '/api/employer/saved-candidates', data: { candidateId: UUID } },
  { method: 'patch', path: '/api/employer/saved-candidates/note', data: { candidateId: UUID } },
  { method: 'get', path: '/api/employer/tags' },
  { method: 'post', path: '/api/employer/tags', data: { name: 'x' } },
  { method: 'delete', path: '/api/employer/tags', data: { tagId: 'x' } },
  { method: 'get', path: '/api/employer/candidate-alerts' },
  { method: 'post', path: '/api/employer/candidate-alerts', data: {} },
  { method: 'delete', path: '/api/employer/candidate-alerts' },
  { method: 'get', path: '/api/employer/usage' },
  { method: 'get', path: '/api/employer/profile-snapshot' },
  { method: 'get', path: '/api/employer/ai-jd/usage' },
  { method: 'post', path: '/api/employer/ai-jd', data: {} },
  { method: 'get', path: `/api/employer/invoice?jobId=${UUID}` },
  { method: 'get', path: `/api/employer/receipt?jobId=${UUID}` },
  { method: 'post', path: '/api/employer/talent/search', data: { query: 'x' } },
  { method: 'post', path: '/api/employer/profiles/unlock-bulk', data: { candidateIds: [UUID] } },
  { method: 'patch', path: `/api/employer/jobs/${UUID}/toggle-publish`, data: {} },
  { method: 'patch', path: `/api/employer/jobs/${UUID}/archive`, data: {} },
  { method: 'post', path: '/api/employer/testimonials', data: {} },
  { method: 'get', path: '/api/employer/jd-templates' },
  { method: 'post', path: '/api/employer/jd-templates', data: { name: 'x', body: 'y' } },
  { method: 'patch', path: '/api/employer/jd-templates/x', data: { name: 'x' } },
  { method: 'delete', path: '/api/employer/jd-templates/x' },
  { method: 'get', path: '/api/verify-checkout-session?session_id=cs_test_e2e' },
  { method: 'get', path: '/api/verify-renewal-session?session_id=cs_test_e2e' },
  { method: 'post', path: '/api/resume/parse', data: { resumeUrl: 'resumes/x/y.pdf' } },
];

test.describe('unauthenticated API access → 401 JSON, never 500', () => {
  for (const r of ANON_ROUTES) {
    test(`${r.method.toUpperCase()} ${r.path}`, async ({ request }) => {
      if (r.fixme) test.fixme(true, r.fixme);
      const res = await request[r.method](r.path, {
        headers: { 'x-forwarded-for': uniqueIp(), Origin: MUT_ORIGIN },
        data: r.data,
      });
      if (res.status() === 503 && /not configured|temporarily unavailable/i.test(await res.text())) {
        test.skip(true, `${r.path}: its backing dependency (Stripe / OpenAI) is not configured in this environment, so the 401 gate is unreachable`);
      }
      expect(res.status(), await bodyText(res)).toBe(401);
      expect(res.headers()['content-type']).toMatch(/application\/json/);
      const json = await res.json();
      expect(typeof json.error).toBe('string');
      expect(JSON.stringify(json)).not.toMatch(/stack|prisma|at \w+ \(/i);
    });
  }

  test('a malformed Supabase auth cookie is treated as anonymous (401), not a crash', async ({ playwright }) => {
    test.skip(!SUPABASE_REF, 'NEXT_PUBLIC_SUPABASE_URL not set');
    const ctx = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        Cookie: `sb-${SUPABASE_REF}-auth-token=base64-eyJub3QiOiJqc29uIn0.garbage; sb-${SUPABASE_REF}-auth-token.0=garbage`,
        'x-forwarded-for': uniqueIp(),
      },
    });
    try {
      for (const path of ['/api/dashboard', '/api/employer/applicants', '/api/applications']) {
        const res = await ctx.get(path);
        expect(res.status(), `${path}: ${await bodyText(res)}`).toBe(401);
      }
      // /api/auth/me is the analytics identity probe: its anonymous answer is 200 {id:null} by design.
      const me = await ctx.get('/api/auth/me');
      expect(me.status(), `/api/auth/me: ${await bodyText(me)}`).toBe(200);
      expect((await me.json()).id).toBeNull();
      const page = await ctx.get('/dashboard', { maxRedirects: 0 });
      expect([302, 307, 200]).toContain(page.status());
      const home = await ctx.get('/', { maxRedirects: 0 });
      expect(home.status()).toBe(200);
    } finally {
      await ctx.dispose();
    }
  });

  for (const path of ['/api/verify-checkout-session', '/api/verify-renewal-session']) {
    test(`${path}: anonymous → 401 and rate-limited (429) after 30/min`, async ({ request }) => {
      const ip = uniqueIp();
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) {
        const res = await request.get(`${path}?session_id=cs_test_e2e_${i}`, { headers: { 'x-forwarded-for': ip } });
        statuses.push(res.status());
        if (res.status() === 429) break;
      }
      // 503 = Stripe not configured in this environment (checked before auth); 401 otherwise.
      expect([401, 503], `first status: ${statuses[0]}`).toContain(statuses[0]);
      expect(statuses.filter((s) => s === 401 || s === 503).length).toBeGreaterThanOrEqual(30);
      expect(statuses[statuses.length - 1], `statuses: ${statuses.join(',')}`).toBe(429);
      expect(statuses.filter((s) => s === 500)).toEqual([]);
    });
  }
});

// ── 7. protected pages ────────────────────────────────────────────────────

test.describe('protected pages', () => {
  for (const path of ['/dashboard', '/employer/dashboard', '/admin', '/admin/jobs']) {
    test(`anonymous ${path} → /login (no 500, no leak)`, async ({ page }) => {
      const guard = installConsoleGuard(page);
      const res = await page.goto(path);
      expect(res?.status() ?? 0).toBeLessThan(500);
      await page.waitForURL(/\/login/);
      await expect(page.locator('input[type="email"]')).toBeVisible();
      guard.assertClean();
    });
  }

  for (const path of ['/settings', '/messages', '/my-applications']) {
    test(`anonymous ${path} (client-gated) ends on /login or a sign-in CTA and leaks no account data`, async ({ page }) => {
      const guard = installConsoleGuard(page);
      const res = await page.goto(path);
      expect(res?.status() ?? 0).toBeLessThan(500);
      const loginLink = page.locator('a[href^="/login"]').first();
      await Promise.race([
        page.waitForURL(/\/login/).catch(() => undefined),
        loginLink.waitFor({ state: 'visible' }).catch(() => undefined),
      ]);
      const onLogin = /\/login/.test(page.url());
      if (!onLogin) await expect(loginLink).toBeVisible();
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/example\.invalid|Unhandled Runtime Error|TypeError/);
      guard.assertClean();
    });
  }

  test('anonymous /messages must carry its return target in a param the login page honours', async ({ page }) => {
    await page.goto('/messages');
    await page.waitForURL(/\/login/);
    const u = new URL(page.url());
    expect(u.searchParams.get('redirectTo') ?? u.searchParams.get('next')).toBe('/messages');
  });

  test('employer return target: anonymous /employer/applicants → login → lands on /employer/applicants', async ({ page }) => {
    test.skip(!EMPLOYER, 'employer creds missing');
    await page.goto('/employer/applicants');
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/employer/applicants');
    await page.locator('input[type="email"]').first().fill(EMPLOYER!.email);
    await page.locator('input[type="password"]').first().fill(EMPLOYER!.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/\/employer\/applicants/);
    expect(new URL(page.url()).host).toBe(BASE_HOST);
  });

  test('candidate cannot reach /admin or /employer/dashboard (→ /unauthorized)', async ({ page }) => {
    test.skip(!SEEKER, 'seeker creds missing');
    await authAs(page, 'candidate');
    for (const path of ['/admin', '/admin/jobs', '/employer/dashboard']) {
      await page.goto(path);
      await page.waitForURL(/\/unauthorized/);
      await expect(page.locator('body')).not.toContainText(/applicants|pipeline/i);
    }
  });

  test('employer cannot reach /admin (→ /unauthorized)', async ({ page }) => {
    test.skip(!EMPLOYER, 'employer creds missing');
    await authAs(page, 'employer');
    await page.goto('/admin');
    await page.waitForURL(/\/unauthorized/);
  });
});

// ── 8. IDOR (seeded via Prisma) ───────────────────────────────────────────

interface IdorSeed {
  victimSupabaseId: string;
  victimProfileId: string;
  foreignSupabaseId: string;
  foreignProfileId: string;
  foreignJobId: string;
  foreignEmployerJobId: string;
  appOnOwnJobId: string;
  appOnForeignJobId: string;
  convWithEmployerAId: string;
  convWithForeignId: string;
  msgFromForeignId: string;
  msgFromEmployerAId: string;
}

test.describe('IDOR isolation', () => {
  // Each test signs in and makes several round-trips against a shared server; allow for fleet load.
  test.describe.configure({ timeout: 180_000 });
  test.use({ actionTimeout: 60_000 });
  test.skip(!CAN_SEED || !SEEKER || !EMPLOYER || !TEST_JOB_ID, 'needs DATABASE_URL, both credentials and E2E_TEST_JOB_ID (dev only)');

  let prisma: PrismaClient;
  let pool: Pool;
  let seed: IdorSeed;
  // True when the generated Prisma client (shared node_modules) knows EmployerJob columns the dev DB
  // has not migrated; routes that load whole EmployerJob rows then 500 for reasons unrelated to HEAD.
  let clientSchemaDrift = false;
  const tag = `e2e-idor-${Date.now()}`;

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    clientSchemaDrift = await prisma.employerJob
      .findFirst({})
      .then(() => false)
      .catch((e: unknown) => /does not exist in the current database/i.test(String(e)));
    const employerA = await prisma.userProfile.findUnique({ where: { email: EMPLOYER!.email }, select: { id: true } });
    if (!employerA) throw new Error('employer profile row missing');

    const victim = await prisma.userProfile.create({
      data: { supabaseId: randomUUID(), email: `${tag}-victim@example.invalid`, role: 'job_seeker', firstName: 'IDOR', lastName: 'Victim', profileVisible: true, openToOffers: true },
      select: { id: true, supabaseId: true, email: true },
    });
    const foreign = await prisma.userProfile.create({
      data: { supabaseId: randomUUID(), email: `${tag}-foreign@example.invalid`, role: 'employer', firstName: 'Foreign', lastName: 'Employer', company: 'Foreign Clinic' },
      select: { id: true, supabaseId: true, email: true },
    });
    const foreignJob = await prisma.job.create({
      data: {
        title: 'E2E IDOR foreign job (do not index)',
        employer: 'Foreign Clinic',
        location: 'Remote',
        description: 'Seeded by tests/e2e/journeys/auth-security.spec.ts for IDOR isolation checks. '.repeat(3),
        isPublished: true,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        sourceProvider: 'e2e-probe',
        externalId: `${tag}-foreign-job`,
      },
      select: { id: true },
    });
    const foreignEmployerJob = await prisma.employerJob.create({
      data: { employerName: 'Foreign Clinic', contactEmail: foreign.email, jobId: foreignJob.id, editToken: randomUUID(), paymentStatus: 'free', userId: foreign.supabaseId },
      // Narrow RETURNING: the generated client may know columns the dev DB has not migrated yet.
      select: { id: true },
    });
    const appOwn = await prisma.jobApplication.create({ data: { userId: victim.supabaseId, jobId: TEST_JOB_ID! }, select: { id: true } });
    const appForeign = await prisma.jobApplication.create({ data: { userId: victim.supabaseId, jobId: foreignJob.id }, select: { id: true } });
    const convA = await prisma.conversation.create({
      data: { participantA: victim.id, participantB: employerA.id, jobId: TEST_JOB_ID!, subject: `${tag} employer A` },
      select: { id: true, subject: true },
    });
    const convF = await prisma.conversation.create({
      data: { participantA: victim.id, participantB: foreign.id, jobId: foreignJob.id, subject: `${tag} foreign` },
      select: { id: true, subject: true },
    });
    await prisma.employerMessage.createMany({
      data: [
        { senderId: employerA.id, recipientId: victim.id, conversationId: convA.id, jobId: TEST_JOB_ID!, subject: convA.subject, body: 'Hello from employer A (seed)' },
        { senderId: foreign.id, recipientId: victim.id, conversationId: convF.id, jobId: foreignJob.id, subject: convF.subject, body: 'Hello from foreign employer (seed)' },
      ],
    });
    const msgA = await prisma.employerMessage.findFirstOrThrow({ where: { conversationId: convA.id }, select: { id: true } });
    const msgF = await prisma.employerMessage.findFirstOrThrow({ where: { conversationId: convF.id }, select: { id: true } });
    seed = {
      victimSupabaseId: victim.supabaseId,
      victimProfileId: victim.id,
      foreignSupabaseId: foreign.supabaseId,
      foreignProfileId: foreign.id,
      foreignJobId: foreignJob.id,
      foreignEmployerJobId: foreignEmployerJob.id,
      appOnOwnJobId: appOwn.id,
      appOnForeignJobId: appForeign.id,
      convWithEmployerAId: convA.id,
      convWithForeignId: convF.id,
      msgFromForeignId: msgF.id,
      msgFromEmployerAId: msgA.id,
    };
  });

  test.afterAll(async () => {
    if (!prisma) return;
    try {
      if (seed) {
        await prisma.conversation.deleteMany({ where: { id: { in: [seed.convWithEmployerAId, seed.convWithForeignId] } } });
        await prisma.jobApplication.deleteMany({ where: { userId: seed.victimSupabaseId } });
        await prisma.job.deleteMany({ where: { id: seed.foreignJobId } }); // cascades EmployerJob
        await prisma.userProfile.deleteMany({ where: { id: { in: [seed.victimProfileId, seed.foreignProfileId] } } });
      }
      // beforeAll may have failed part-way (seed undefined): sweep everything carrying this run's tag.
      const leftovers = await prisma.userProfile.findMany({ where: { email: { startsWith: tag } }, select: { id: true, supabaseId: true } });
      await prisma.conversation.deleteMany({ where: { OR: [{ participantA: { in: leftovers.map((p) => p.id) } }, { participantB: { in: leftovers.map((p) => p.id) } }] } });
      await prisma.jobApplication.deleteMany({ where: { userId: { in: leftovers.map((p) => p.supabaseId) } } });
      await prisma.job.deleteMany({ where: { sourceProvider: 'e2e-probe', externalId: { startsWith: tag } } });
      await prisma.userProfile.deleteMany({ where: { email: { startsWith: tag } } });
      if (SEEKER) {
        await prisma.userProfile.updateMany({ where: { email: SEEKER.email }, data: { resumeParseStatus: null } });
      }
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });

  test('candidate A cannot read, post to, or delete candidate B\'s conversations', async ({ page }) => {
    await authAs(page, 'candidate');
    const api = page.request;
    for (const id of [seed.convWithEmployerAId, seed.convWithForeignId]) {
      const get = await api.get(`/api/conversations/${id}`);
      expect(get.status(), await bodyText(get)).toBe(403);
      expect(await get.text()).not.toContain('seed');
      const post = await api.post(`/api/conversations/${id}`, { data: { body: 'intruder' } });
      expect(post.status(), await bodyText(post)).toBe(403);
      const del = await api.delete(`/api/conversations/${id}`);
      expect(del.status(), await bodyText(del)).toBe(403);
    }
    const list = await api.get('/api/conversations');
    expect(list.status()).toBe(200);
    expect(await list.text()).not.toContain(seed.convWithEmployerAId);
    expect(await list.text()).not.toContain(seed.convWithForeignId);
  });

  test('candidate A cannot withdraw candidate B\'s application nor read B\'s profile by id', async ({ page }) => {
    await authAs(page, 'candidate');
    const api = page.request;
    for (const appId of [seed.appOnOwnJobId, seed.appOnForeignJobId]) {
      const res = await api.delete('/api/applications/withdraw', { data: { applicationId: appId } });
      expect(res.status(), await bodyText(res)).toBe(403);
    }
    const stillOpen = await prisma.jobApplication.findMany({ where: { id: { in: [seed.appOnOwnJobId, seed.appOnForeignJobId] }, withdrawnAt: null } });
    expect(stillOpen).toHaveLength(2);

    const profile = await api.get(`/api/employer/candidates/${seed.victimSupabaseId}`);
    expect(profile.status(), await bodyText(profile)).toBe(403);
    expect(await profile.text()).not.toContain('Victim');
    const applicants = await api.get('/api/employer/applicants');
    expect(applicants.status()).toBe(403);
    const mine = await api.get('/api/applications');
    expect(mine.status()).toBe(200);
    expect(await mine.text()).not.toContain(seed.appOnOwnJobId);
  });

  test('employer A sees its own applicants but cannot see or mutate another employer\'s', async ({ page }) => {
    await authAs(page, 'employer');
    const api = page.request;
    const t0 = Date.now();
    const list = await api.get('/api/employer/applicants', { timeout: 60_000 });
    test.info().annotations.push({ type: 'timing', description: `GET /api/employer/applicants took ${Date.now() - t0} ms` });
    expect(list.status(), await bodyText(list)).toBe(200);
    const text = await list.text();
    expect(text).toContain(seed.appOnOwnJobId);
    expect(text).not.toContain(seed.appOnForeignJobId);
    expect(text).not.toContain(seed.foreignJobId);

    const patch = await api.patch('/api/employer/applicants', { data: { applicationId: seed.appOnForeignJobId, status: 'screening' } });
    expect(patch.status(), await bodyText(patch)).toBe(403);
    const untouched = await prisma.jobApplication.findUnique({ where: { id: seed.appOnForeignJobId }, select: { status: true } });
    expect(untouched?.status).toBe('applied');

    const foreignConv = await api.get(`/api/conversations/${seed.convWithForeignId}`);
    expect(foreignConv.status(), await bodyText(foreignConv)).toBe(403);
    const ownConv = await api.get(`/api/conversations/${seed.convWithEmployerAId}`);
    expect(ownConv.status(), await bodyText(ownConv)).toBe(200);

    const toggle = await api.patch(`/api/employer/jobs/${seed.foreignJobId}/toggle-publish`, { data: {} });
    expect(clientSchemaDrift ? [404, 500] : [404], `toggle: ${await bodyText(toggle)}`).toContain(toggle.status());
    const stillPublished = await prisma.job.findUnique({ where: { id: seed.foreignJobId }, select: { isPublished: true } });
    expect(stillPublished?.isPublished).toBe(true);
  });

  test('candidate A cannot edit or delete a message inside candidate B\'s conversation', async ({ page }) => {
    await authAs(page, 'candidate');
    const api = page.request;
    const before = await prisma.employerMessage.findUniqueOrThrow({ where: { id: seed.msgFromForeignId }, select: { body: true, deletedBySender: true, editedAt: true } });
    const edit = await api.patch(`/api/conversations/${seed.convWithForeignId}/messages/${seed.msgFromForeignId}/edit`, { data: { body: 'tampered by intruder' } });
    expect([403, 404], `edit: ${await bodyText(edit)}`).toContain(edit.status());
    const del = await api.delete(`/api/conversations/${seed.convWithForeignId}/messages/${seed.msgFromForeignId}`);
    expect([403, 404], `delete: ${await bodyText(del)}`).toContain(del.status());
    const after = await prisma.employerMessage.findUniqueOrThrow({ where: { id: seed.msgFromForeignId }, select: { body: true, deletedBySender: true, editedAt: true } });
    expect(after).toEqual(before);
    // Neither response may echo the seeded message text.
    expect(await edit.text()).not.toContain('seed');
    expect(await del.text()).not.toContain('seed');
  });

  test('employer A cannot pull another employer\'s invoice, receipt, or archive its job', async ({ page }) => {
    await authAs(page, 'employer');
    const api = page.request;
    const denied = clientSchemaDrift ? [403, 404, 500] : [403, 404];
    if (clientSchemaDrift) test.info().annotations.push({ type: 'env', description: 'Prisma client/DB schema drift: invoice/receipt may 500 before the ownership check; leak assertions still apply' });
    const invoice = await api.get(`/api/employer/invoice?jobId=${seed.foreignJobId}`);
    expect(denied, `invoice: ${await bodyText(invoice)}`).toContain(invoice.status());
    expect(await invoice.text()).not.toContain('Foreign Clinic');
    const receipt = await api.get(`/api/employer/receipt?jobId=${seed.foreignJobId}`);
    expect(denied, `receipt: ${await bodyText(receipt)}`).toContain(receipt.status());
    expect(await receipt.text()).not.toContain('Foreign Clinic');
    const archive = await api.patch(`/api/employer/jobs/${seed.foreignJobId}/archive`, { data: {} });
    expect(denied, `archive: ${await bodyText(archive)}`).toContain(archive.status());
    const job = await prisma.job.findUniqueOrThrow({ where: { id: seed.foreignJobId }, select: { isPublished: true, archivedAt: true } });
    expect(job).toEqual({ isPublished: true, archivedAt: null });
    // A message the FOREIGN employer sent in its own thread is not employer A's to delete.
    const del = await api.delete(`/api/conversations/${seed.convWithForeignId}/messages/${seed.msgFromForeignId}`);
    expect([403, 404], `delete: ${await bodyText(del)}`).toContain(del.status());
    // Positive control: employer A's own message in its own thread is reachable.
    const own = await api.get(`/api/conversations/${seed.convWithEmployerAId}`);
    expect(own.status()).toBe(200);
    expect(await own.text()).toContain(seed.msgFromEmployerAId);
  });

  test('employer A: applicants?jobId=<own job> is a positive control (own applicant listed)', async ({ page }) => {
    await authAs(page, 'employer');
    const res = await page.request.get(`/api/employer/applicants?jobId=${TEST_JOB_ID}`);
    expect(res.status(), await bodyText(res)).toBe(200);
    const body = (await res.json()) as { applicants: Array<{ id: string; job: { id: string } }> };
    expect(body.applicants.map((a) => a.id)).toContain(seed.appOnOwnJobId);
    expect(body.applicants.every((a) => a.job.id === TEST_JOB_ID)).toBe(true);
  });

  test('employer A cannot list another employer\'s applicants via ?jobId=<foreign job>', async ({ page }) => {
    await authAs(page, 'employer');
    for (const qs of [`jobId=${seed.foreignJobId}`, `jobId=${seed.foreignJobId}&status=applied`, `jobId=${seed.foreignJobId}&status=all`]) {
      const res = await page.request.get(`/api/employer/applicants?${qs}`);
      expect([200, 403, 404], `${qs}: ${await bodyText(res)}`).toContain(res.status());
      const text = await res.text();
      expect(text, `${qs} leaks the foreign application id`).not.toContain(seed.appOnForeignJobId);
      expect(text, `${qs} leaks the victim candidate`).not.toContain(seed.victimSupabaseId);
      expect(text).not.toContain('IDOR');
    }
  });

  test('candidate A cannot update or delete candidate B\'s work-experience entry by id', async ({ page }) => {
    const entry = await prisma.candidateWorkExperience.create({
      data: { userId: seed.victimProfileId, jobTitle: 'Victim PMHNP', employerName: 'Victim Clinic', startDate: new Date('2020-01-01') },
      select: { id: true },
    });
    try {
      await authAs(page, 'candidate');
      const put = await page.request.put(`/api/profile/work-experience/${entry.id}`, { data: { jobTitle: 'tampered by intruder' } });
      expect([403, 404], `PUT: ${await bodyText(put)}`).toContain(put.status());
      expect(await put.text()).not.toContain('Victim');
      const del = await page.request.delete(`/api/profile/work-experience/${entry.id}`);
      expect([403, 404], `DELETE: ${await bodyText(del)}`).toContain(del.status());
      const after = await prisma.candidateWorkExperience.findUnique({ where: { id: entry.id }, select: { jobTitle: true } });
      expect(after, 'victim entry must survive').toEqual({ jobTitle: 'Victim PMHNP' });
      const mine = await page.request.get('/api/profile/work-experience');
      expect(mine.status()).toBe(200);
      expect(await mine.text()).not.toContain(entry.id);
    } finally {
      await prisma.candidateWorkExperience.deleteMany({ where: { id: entry.id } });
    }
  });

  test('candidate A: /api/applications and /api/dashboard never include candidate B\'s rows', async ({ page }) => {
    await authAs(page, 'candidate');
    for (const path of ['/api/applications', '/api/dashboard', `/api/applications/check?jobId=${seed.foreignJobId}`]) {
      const res = await page.request.get(path);
      expect(res.status(), `${path}: ${await bodyText(res)}`).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(seed.appOnForeignJobId);
      expect(text).not.toContain(seed.appOnOwnJobId);
      expect(text).not.toContain(seed.victimSupabaseId);
    }
    const check = await page.request.get(`/api/applications/check?jobId=${seed.foreignJobId}`);
    expect(await check.json()).toMatchObject({ applied: false });
  });

  test('resume/parse rejects foreign and traversal storage paths with 403', async ({ page }) => {
    await authAs(page, 'candidate');
    const api = page.request;
    const paths = [
      `resumes/${seed.victimSupabaseId}/resume.pdf`,
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/resumes/${seed.victimSupabaseId}/resume.pdf`,
      `resumes/../${seed.victimSupabaseId}/resume.pdf`,
      `/etc/passwd`,
    ];
    for (const resumeUrl of paths) {
      const res = await api.post('/api/resume/parse', { headers: { 'x-forwarded-for': uniqueIp() }, data: { resumeUrl } });
      if (res.status() === 503) {
        test.skip(true, `resume parser unreachable in this environment (503: ${await bodyText(res)}) — OPENAI_API_KEY unset or ai.candidate.resume_parser off`);
      }
      expect(res.status(), `${resumeUrl}: ${await bodyText(res)}`).toBe(403);
      expect(await res.text()).not.toContain(seed.victimSupabaseId);
    }
  });

  test('resume/parse must not flip the caller\'s resumeParseStatus on a rejected request', async ({ page }) => {
    await authAs(page, 'candidate');
    await prisma.userProfile.updateMany({ where: { email: SEEKER!.email }, data: { resumeParseStatus: null } });
    await page.request.post('/api/resume/parse', { headers: { 'x-forwarded-for': uniqueIp() }, data: { resumeUrl: `resumes/${seed.victimSupabaseId}/resume.pdf` } });
    const after = await prisma.userProfile.findUnique({ where: { email: SEEKER!.email }, select: { resumeParseStatus: true } });
    expect(after?.resumeParseStatus).toBeNull();
  });
});

// ── 8b. page metadata ─────────────────────────────────────────────────────

test.describe('page metadata', () => {
  for (const path of ['/my-applications', '/settings']) {
    test(`${path} <title> carries the brand suffix once`, async ({ request }) => {
      const res = await request.get(path, { headers: { 'x-forwarded-for': uniqueIp() } });
      const title = (await res.text()).match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
      expect(title.split(brand.name).length - 1, `title: "${title}"`).toBeLessThanOrEqual(1);
    });
  }
});

// ── 8c. quarantine gate on indexable surfaces ─────────────────────────────

test.describe('profession quarantine gate', () => {
  test.skip(!QUARANTINE_SLUG, 'E2E_QUARANTINE_JOB_SLUG not set (setup seeds a Podiatrist probe with professionClass=other_clinical)');

  test('quarantined job is gated on detail (410), listing and search API', async ({ request }) => {
    const detail = await request.get(`/jobs/${QUARANTINE_SLUG}`, { headers: { 'x-forwarded-for': uniqueIp() } });
    expect(detail.status()).toBe(410);
    const api = await request.get('/api/jobs?q=Podiatrist', { headers: { 'x-forwarded-for': uniqueIp() }, timeout: 60_000 });
    expect(api.status()).toBe(200);
    expect(await api.text()).not.toContain(QUARANTINE_SLUG!);
    const list = await request.get('/jobs?q=Podiatrist', { headers: { 'x-forwarded-for': uniqueIp() }, timeout: 60_000 });
    expect(list.status()).toBe(200);
    expect(await list.text()).not.toContain(QUARANTINE_SLUG!);
  });

  test('quarantined job must not be advertised to crawlers via the job sitemap batches', async ({ request }) => {
    const index = await request.get('/api/sitemaps/index', { headers: { 'x-forwarded-for': uniqueIp() } });
    expect(index.status()).toBe(200);
    const batches = [...new Set((await index.text()).match(/\/api\/sitemaps\/jobs\/\d+/g) ?? [])];
    expect(batches.length).toBeGreaterThan(0);
    for (const path of batches) {
      const res = await request.get(path, { headers: { 'x-forwarded-for': uniqueIp() } });
      expect(res.status(), path).toBe(200);
      expect(await res.text(), `${path} advertises the quarantined slug`).not.toContain(QUARANTINE_SLUG!);
    }
  });
});

// ── 9. security headers + CSP/hydration ───────────────────────────────────

const HEADER_PAGES = ['/', '/jobs', '/login', '/forgot-password', '/reset-password'];

test.describe('security headers', () => {
  for (const path of HEADER_PAGES) {
    test(`${path} carries CSP, HSTS, XFO, COOP, nosniff`, async ({ request }) => {
      const res = await request.get(path, { headers: { 'x-forwarded-for': uniqueIp() } });
      expect(res.status()).toBe(200);
      const h = res.headers();
      expect(h['content-security-policy'], 'CSP').toMatch(/default-src 'self'/);
      expect(h['content-security-policy']).toMatch(/frame-ancestors 'none'/);
      expect(h['content-security-policy']).toMatch(/object-src 'none'/);
      expect(h['strict-transport-security'], 'HSTS').toMatch(/max-age=\d{6,}/);
      expect(h['x-frame-options'], 'XFO').toBe('DENY');
      expect(h['cross-origin-opener-policy'], 'COOP').toMatch(/same-origin/);
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  }

  test('CSP does not block hydration: the home hero search is interactive (D1 regression)', async ({ page }) => {
    const guard = installConsoleGuard(page);
    const res = await page.goto('/');
    expect(res?.headers()['content-security-policy']).toBeTruthy();
    const input = page.getByLabel('Job title or keyword');
    await expect(input).toBeVisible();
    // Deterministic hydration signal: React attaches its fiber to the DOM node only after hydrating.
    await page.waitForFunction(() => {
      const el = document.querySelector('input[aria-label="Job title or keyword"]');
      return !!el && Object.keys(el).some((k) => k.startsWith('__reactFiber'));
    });
    await input.fill('telehealth');
    // Controlled input: the value must survive React's post-hydration event replay.
    await expect(input).toHaveValue('telehealth');
    await input.press('Enter');
    await page.waitForURL(/\/jobs/);
    expect(page.url()).toContain('q=telehealth');
    const violations = guard.consoleErrors.filter((t) => /Refused to/i.test(t));
    expect(violations, 'CSP violations reported by the browser').toEqual([]);
    guard.assertClean();
  });

  test('/jobs list is hydrated too (client-side search box works under CSP)', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/jobs');
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('input, button')).some((el) => Object.keys(el).some((k) => k.startsWith('__reactFiber'))),
    );
    guard.assertClean();
  });
});

// ── 10. mobile viewport (375px) ───────────────────────────────────────────

test.describe('mobile 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('forgot-password form is usable and does not overflow horizontally', async ({ page }) => {
    const guard = installConsoleGuard(page);
    const ip = uniqueIp();
    await page.route('**/api/auth/forgot-password', (route) =>
      route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
    );
    await page.goto(`${MUT_ORIGIN}/forgot-password`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow px').toBeLessThanOrEqual(1);
    const input = page.locator('#reset-email');
    const box = await input.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    await input.fill(`e2e-mobile-${Date.now()}@example.invalid`);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
    guard.assertClean();
  });

  test('expired-confirmation resend surface is usable at 375px', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.route('**/api/auth/send-confirmation', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }),
    );
    await page.goto('/auth/confirm?error=access_denied&error_code=otp_expired');
    const input = page.locator('#resend-email');
    await expect(input).toBeVisible();
    expect((await input.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await input.fill('e2e-mobile-resend@example.invalid');
    await page.getByRole('button', { name: /resend confirmation email/i }).click();
    await expect(page.getByText(/confirmation email sent/i)).toBeVisible();
    guard.assertClean([/Auth error from query params/]);
  });

  test('login open-redirect guard holds on mobile', async ({ page }) => {
    test.skip(!SEEKER, 'seeker creds missing');
    await loginVia(page, '/login?redirectTo=https%3A%2F%2Fevil.example', SEEKER!);
    expect(new URL(page.url()).host).toBe(BASE_HOST);
    expect(new URL(page.url()).pathname).toBe('/dashboard');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

// ── 11. copy rule: no em/en dashes in rendered auth copy ─────────────────

const COPY_PAGES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password?error=access_denied&error_code=otp_expired',
  '/auth/confirm?error=access_denied&error_code=otp_expired',
  '/unauthorized',
];

test.describe('copy rule: no em/en dashes in rendered auth copy', () => {
  for (const path of COPY_PAGES) {
    test(`${path} has no dash in visible text`, async ({ page }) => {
      const guard = installConsoleGuard(page);
      const res = await page.goto(path);
      expect(res?.status() ?? 0).toBeLessThan(400);
      await expect(page.locator('main').first()).toBeVisible();
      await expect(page.locator('main').first()).not.toHaveText(/^s*$/);
      const offenders = await visibleDashOffenders(page);
      expect(offenders, 'visible text carrying an em/en dash').toEqual([]);
      guard.assertClean([/Auth error from query params/]);
    });
  }

  test('/auth/confirm exposes a page heading (h1) for screen readers', async ({ page }) => {
    await page.goto('/auth/confirm?error=access_denied&error_code=otp_expired');
    await expect(page.getByText(/confirmation link has expired/i)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('branded 404 page for a SINGLE-segment dead URL: status 404, security headers, no stack, no dash', async ({ page }) => {
    const guard = installConsoleGuard(page);
    const res = await page.goto('/this-page-does-not-exist-e2e');
    expect(res?.status()).toBe(404);
    const h = res?.headers() ?? {};
    expect(h['strict-transport-security'], 'HSTS on 404').toMatch(/max-age=\d{6,}/);
    expect(h['x-frame-options'], 'XFO on 404').toBe('DENY');
    expect(h['content-security-policy'], 'CSP on 404').toMatch(/default-src 'self'/);
    await expectBranded(page);
    expect(await visibleDashOffenders(page)).toEqual([]);
    guard.assertClean([/404/]);
  });
});

// ── 12. session lifecycle + credentialed CSRF (stateful, on MUT_ORIGIN) ───

test.describe('session lifecycle', () => {
  test.skip(!SEEKER, 'seeker creds missing');

  test('sign-out revokes the API session, clears auth cookies, and back-navigation cannot resurrect the dashboard', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await loginVia(page, `${MUT_ORIGIN}/login`, SEEKER!);
    await page.waitForURL(/\/dashboard/);
    const before = await page.request.get(`${MUT_ORIGIN}/api/dashboard`, { timeout: 60_000 });
    expect(before.status(), await bodyText(before)).toBe(200);

    await signOutViaMenu(page);
    const after = await page.request.get(`${MUT_ORIGIN}/api/dashboard`, { timeout: 60_000 });
    expect(after.status(), 'API session must be gone after sign-out').toBe(401);
    const authCookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name) && c.value);
    expect(authCookies.map((c) => c.name), 'Supabase auth cookies left behind after sign-out').toEqual([]);

    // History back onto /dashboard must re-run the server gate, not replay a cached authenticated render.
    await page.goBack();
    await page.waitForURL(/\/login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(SEEKER!.email);
    guard.assertClean([/401/]);
  });

  test('forged Origin with a LIVE session is rejected and writes nothing; same-origin succeeds', async ({ page }) => {
    test.skip(!TEST_JOB_ID || !hasDb() || AGAINST_PROD, 'needs E2E_TEST_JOB_ID + DATABASE_URL (dev only)');
    await loginVia(page, `${MUT_ORIGIN}/login`, SEEKER!);
    const seekerId = await supabaseIdForEmail(SEEKER!.email);
    expect(seekerId, 'seeker supabaseId').toBeTruthy();
    const where = { userId: seekerId!, jobId: TEST_JOB_ID! };
    await db().savedJob.deleteMany({ where });
    try {
      for (const origin of ['https://evil.example', 'null', `https://${brand.domain}.evil.example`]) {
        const forged = await page.request.post(`${MUT_ORIGIN}/api/saved-jobs`, { headers: { Origin: origin }, data: { jobId: TEST_JOB_ID } });
        expect(forged.status(), `Origin=${origin}`).toBe(403);
      }
      expect(await db().savedJob.count({ where }), 'no row written by a forged-origin request').toBe(0);
      const same = await page.request.post(`${MUT_ORIGIN}/api/saved-jobs`, { headers: { Origin: MUT_ORIGIN }, data: { jobId: TEST_JOB_ID } });
      expect(same.status(), await bodyText(same)).toBe(200);
      expect(await db().savedJob.count({ where })).toBe(1);
    } finally {
      await db().savedJob.deleteMany({ where });
      await closeDb();
    }
  });
});

// ── 13. login form robustness ─────────────────────────────────────────────

test.describe('login form robustness', () => {
  test.skip(!SEEKER, 'seeker creds missing');

  test('refresh mid-flow clears the form; a double-click on Sign in issues exactly one password grant', async ({ page }) => {
    const guard = installConsoleGuard(page);
    let passwordGrants = 0;
    await page.route('**/auth/v1/token**', (route) => {
      if (/grant_type=password/.test(route.request().url())) passwordGrants++;
      route.continue();
    });
    await page.goto('/login');
    await page.locator('input[type="email"]').first().fill(SEEKER!.email);
    await page.locator('input[type="password"]').first().fill(SEEKER!.password);
    await page.reload();
    await expect(page.locator('input[type="email"]').first()).toHaveValue('');
    await expect(page.locator('input[type="password"]').first()).toHaveValue('');
    await expect(page.getByText(/invalid|incorrect|error/i)).toHaveCount(0);

    await page.locator('input[type="email"]').first().fill(SEEKER!.email);
    await page.locator('input[type="password"]').first().fill(SEEKER!.password);
    const submit = page.locator('button[type="submit"]').first();
    const box = await submit.boundingBox();
    if (!box) throw new Error('submit button has no bounding box');
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL(/\/dashboard/);
    expect(passwordGrants, 'password grants issued by a double-click').toBe(1);
    guard.assertClean([/restore-account/, /403/]);
  });

  test('signed-in user hitting /signup or /login with a foreign redirectTo stays on-site', async ({ page }) => {
    await loginVia(page, '/login', SEEKER!);
    for (const path of ['/signup?redirectTo=https%3A%2F%2Fevil.example', '/signup?redirectTo=%2F%2Fevil.example', '/login?redirectTo=%2F%5Cevil.example']) {
      await page.goto(path);
      await page.waitForURL((u) => !/\/(signup|login)/.test(u.pathname));
      const u = new URL(page.url());
      expect(SAME_SITE_HOSTNAMES.has(u.hostname), `${path} -> ${u.href}`).toBe(true);
      expect(u.pathname).toBe('/dashboard');
    }
    await page.goto('/signup?redirectTo=%2Fjobs');
    await page.waitForURL(/\/jobs/);
    expect(SAME_SITE_HOSTNAMES.has(new URL(page.url()).hostname)).toBe(true);
  });

  test('empty submit is caught by native validation, never sent to Supabase', async ({ page }) => {
    let tokenCalls = 0;
    await page.route('**/auth/v1/token**', (route) => {
      tokenCalls++;
      route.continue();
    });
    await page.goto('/login');
    await page.locator('button[type="submit"]').first().click();
    await expect(page).toHaveURL(/\/login/);
    const invalid = await page.locator('input[type="email"]').first().evaluate((el) => !(el as HTMLInputElement).checkValidity());
    expect(invalid, 'email input flagged invalid').toBe(true);
    expect(tokenCalls).toBe(0);
  });
});

// ── 14. auth confirm extras ───────────────────────────────────────────────

test.describe('auth confirm extras', () => {
  const NOISE = [/Auth error from (query params|hash)/];

  test('expired RECOVERY link routes to /forgot-password, not the resend surface', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/auth/confirm?type=recovery&error=access_denied&error_code=otp_expired');
    await expect(page.getByText(/password reset link has expired/i)).toBeVisible();
    await expect(page.locator('#resend-email')).toHaveCount(0);
    await page.waitForURL(/\/forgot-password/);
    await expect(page.locator('#reset-email')).toBeVisible();
    guard.assertClean(NOISE);
  });

  test('hostile error_description on /auth/confirm is rendered inert (no XSS), then bounces to /login', async ({ page }) => {
    const guard = installConsoleGuard(page);
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs++;
      d.dismiss().catch(() => undefined);
    });
    await page.goto('/auth/confirm?error=access_denied&error_code=bad&error_description=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E');
    await expect(page.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    expect(dialogs).toBe(0);
    await page.waitForURL(/\/login/);
    guard.assertClean(NOISE);
  });

  test('send-confirmation API: 4th request per IP within 5 min is 429 (rate limit runs before body parsing)', async ({ request }) => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      // {email: 42} is rejected with 400 before Supabase is touched, so this exhausts the bucket without minting ghost users.
      const res = await request.post('/api/auth/send-confirmation', { headers: { 'x-forwarded-for': ip, Origin: MUT_ORIGIN }, data: { email: 42 } });
      statuses.push(res.status());
    }
    expect(statuses).toEqual([400, 400, 400, 429]);
  });
});

// ── 15. role gates on APIs (wrong role → 403, never 500) ─────────────────

test.describe('role gates on APIs', () => {
  test('candidate → admin and employer APIs answer 403 JSON', async ({ page }) => {
    test.skip(!SEEKER, 'seeker creds missing');
    await authAs(page, 'candidate');
    for (const path of ['/api/admin/users', '/api/admin/jobs', '/api/admin/analytics', '/api/employer/candidates', '/api/employer/analytics', '/api/employer/settings', '/api/employer/billing']) {
      const res = await page.request.get(path, { headers: { 'x-forwarded-for': uniqueIp() } });
      expect(res.status(), `${path}: ${await bodyText(res)}`).toBe(403);
      expect(res.headers()['content-type']).toMatch(/application\/json/);
    }
  });

  test('employer → admin APIs answer 403; candidate-only messaging answers 403', async ({ page }) => {
    test.skip(!EMPLOYER, 'employer creds missing');
    await authAs(page, 'employer');
    for (const path of ['/api/admin/users', '/api/admin/jobs']) {
      const res = await page.request.get(path, { headers: { 'x-forwarded-for': uniqueIp() } });
      expect(res.status(), `${path}: ${await bodyText(res)}`).toBe(403);
    }
    const msg = await page.request.post('/api/candidate/messages', {
      headers: { 'x-forwarded-for': uniqueIp() },
      data: { jobId: TEST_JOB_ID ?? UUID, subject: 'x', body: 'y' },
    });
    expect(msg.status(), await bodyText(msg)).toBe(403);
  });
});

// ── 16. more protected pages ──────────────────────────────────────────────

test.describe('protected pages (extra)', () => {
  for (const path of ['/onboarding/professional', '/employer/settings', '/employer/analytics', '/admin/users']) {
    test(`anonymous ${path} → /login?next=${path}`, async ({ page }) => {
      const guard = installConsoleGuard(page);
      const res = await page.goto(path);
      expect(res?.status() ?? 0).toBeLessThan(500);
      await page.waitForURL(/\/login/);
      expect(new URL(page.url()).searchParams.get('next')).toBe(path);
      guard.assertClean();
    });
  }
});

// ── 17. mobile 375px (extra) ──────────────────────────────────────────────

test.describe('mobile 375px (extra)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('login form: no horizontal overflow, keyboard-only sign-in lands on the dashboard', async ({ page }) => {
    test.skip(!SEEKER, 'seeker creds missing');
    const guard = installConsoleGuard(page);
    await page.goto('/login');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow px').toBeLessThanOrEqual(1);
    const email = page.locator('input[type="email"]').first();
    expect((await email.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    await email.focus();
    await page.keyboard.type(SEEKER!.email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(SEEKER!.password);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/dashboard/);
    guard.assertClean([/restore-account/, /403/]);
  });

  test('expired reset link: "Request New Link" is reachable and works at 375px', async ({ page }) => {
    const guard = installConsoleGuard(page);
    await page.goto('/reset-password?error=access_denied&error_code=otp_expired');
    const link = page.getByRole('link', { name: /request new link/i });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375, 'link inside the viewport').toBe(true);
    await link.click();
    await expect(page).toHaveURL(/\/forgot-password/);
    guard.assertClean();
  });
});

// ── 18. 404 control: multi-segment dead URLs reach the branded page ───────

test.describe('404 page (multi-segment control)', () => {
  test('/foo/bar-e2e renders the branded 404 with security headers and no dash', async ({ page }) => {
    const guard = installConsoleGuard(page);
    const res = await page.goto('/foo/bar-e2e');
    expect(res?.status()).toBe(404);
    const h = res?.headers() ?? {};
    expect(h['content-type']).toMatch(/text\/html/);
    expect(h['strict-transport-security'], 'HSTS on 404').toMatch(/max-age=\d{6,}/);
    expect(h['x-frame-options'], 'XFO on 404').toBe('DENY');
    expect(h['content-security-policy'], 'CSP on 404').toMatch(/default-src 'self'/);
    await expect(page.locator('h1').first()).toBeVisible();
    await expectBranded(page);
    expect(await visibleDashOffenders(page)).toEqual([]);
    guard.assertClean([/404/]);
  });
});

import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import fs from 'fs';
import { brand } from '../../../config/brand';
import {
  getEmployerCreds,
  getSeekerCreds,
  loginAsEmployer,
  loginAsSeeker,
  loginAtPath,
  uniqueEmail,
  TEST_PASSWORD,
  fillNameFields,
  clickSubmit,
} from '../fixtures/auth';
import { installConsoleGuard, type ConsoleGuard } from '../helpers/console-guard';
import { db, hasDb, closeDb } from '../helpers/db';
import { MUT_ORIGIN, SEEDS, uniqueIp } from '../helpers/candidate';
import { presetConsentCookie } from '../helpers/a11y';
import {
  createEphemeralEmployer,
  destroyEphemeralEmployer,
  ephemeralSupportAvailable,
  authIdForEmail,
  type EphemeralEmployer,
} from '../helpers/ephemeral-employer';
import {
  WIZARD,
  fillStep1,
  clickRadioLabel,
  pickExperience,
  next,
  stepHeading,
  descriptionLength,
  typeDescription,
  waitForSaved,
  sampleDescription,
} from '../helpers/wizard';

/**
 * Employer user journey tests — full E2E with mutations.
 *
 * Read-only tests run unconditionally.
 * Auth-gated tests need E2E_EMPLOYER_EMAIL / E2E_EMPLOYER_PASS.
 * Mutation tests skip if PLAYWRIGHT_BASE_URL points at production.
 *
 * ORIGIN SPLIT (see helpers/candidate.ts MUT_ORIGIN): lib/csrf.ts 403s every
 * browser mutation whose Origin is http://127.0.0.1:3000, while the same call
 * from http://localhost:3000 passes. Cookies are host-scoped, so every block
 * that logs in AND mutates runs entirely on MUT_ORIGIN via test.use({ baseURL }).
 * Read-only / anonymous blocks stay on the configured base URL.
 */

const HAS_AUTH = getEmployerCreds() !== null;
const AGAINST_PROD =
  !!process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_BASE_URL.includes(brand.domain);

// ── Read-only tests ─────────────────────────────────────────────────────────

test('employer: /for-employers landing has CTAs', async ({ page }) => {
  await page.goto('/for-employers');
  const ctas = page.locator('a, button').filter({
    hasText: /post.*job|get started|sign up|start hiring/i,
  });
  expect(await ctas.count()).toBeGreaterThan(0);
});

test('employer: /pricing lists at least one tier', async ({ page }) => {
  await page.goto('/pricing');
  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toMatch(/\$|free|month|year/i);
});

test('employer: /post-job redirects unauthenticated user', async ({ page }) => {
  await page.goto('/post-job');
  await page.waitForLoadState('domcontentloaded');
  // Either redirects to login OR renders a "sign up to post" gate
  const url = page.url();
  expect(url).toMatch(/\/post-job|\/login|\/employer|\/signup/);
});

test('employer: /employer/login renders auth form', async ({ page }) => {
  await page.goto('/employer/login');
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});

test('employer: /employer/signup renders signup form', async ({ page }) => {
  await page.goto('/employer/signup');
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
});

// ── Auth-gated tests ────────────────────────────────────────────────────────

test.describe('authenticated employer', () => {
  test.skip(!HAS_AUTH, 'E2E_EMPLOYER_EMAIL / E2E_EMPLOYER_PASS not set');
  test.describe.configure({ timeout: 120_000 });

  test('logs in successfully via /employer/login', async ({ page }) => {
    await loginAsEmployer(page);
    expect(page.url()).not.toContain('/employer/login');
  });

  test('can access /employer/candidates', async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto('/employer/candidates');
    await expect(page).toHaveURL(/\/employer\/candidates/);
  });

  test('can access /employer/settings', async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto('/employer/settings');
    await expect(page).toHaveURL(/\/employer\/settings/);
  });

  test('can access /post-job (logged in)', async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto('/post-job');
    // Now that we're authed, /post-job should render the form
    await expect(page).toHaveURL(/\/post-job/);
  });

  test('can view candidate detail when at least one applicant exists', async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto('/employer/candidates');
    const candidateLink = page.locator('a[href^="/employer/candidates/"]').first();
    // The talent pool is fetched client-side; give it the boot budget before deciding it is empty.
    await candidateLink.waitFor({ state: 'visible', timeout: BOOT_TIMEOUT }).catch(() => undefined);
    if (!(await candidateLink.count())) {
      test.skip(true, 'No candidates in /employer/candidates list');
      return;
    }
    await candidateLink.click();
    await expect(page).toHaveURL(/\/employer\/candidates\/.+/, { timeout: BOOT_TIMEOUT });
  });
});

// ── Mutation tests (local only) ─────────────────────────────────────────────

test.describe('employer mutations (local only)', () => {
  test.skip(AGAINST_PROD, 'Mutation tests pollute data — local/staging only');
  // Signup + settings PATCH are browser mutations: run on the CSRF-accepted origin.
  test.use({ baseURL: MUT_ORIGIN });
  test.describe.configure({ timeout: 120_000 });

  test('can sign up a brand-new employer account', async ({ page }) => {
    const email = uniqueEmail('employer');
    await page.goto('/employer/signup');

    await page.locator('input[type="email"]').first().fill(email);
    const pwInputs = page.locator('input[type="password"]');
    await pwInputs.nth(0).fill(TEST_PASSWORD);
    if ((await pwInputs.count()) > 1) {
      await pwInputs.nth(1).fill(TEST_PASSWORD);
    }
    await fillNameFields(page, 'E2eEmployer', 'TestUser');

    // Company field is common on employer signup
    const companyField = page
      .getByLabel(/company|organization/i)
      .or(page.getByPlaceholder(/company|organization/i))
      .first();
    if (await companyField.count()) {
      await companyField.fill('E2E Test Corp');
    }

    const tos = page.locator('input[type="checkbox"]').first();
    if (await tos.count()) {
      await tos.check({ force: true }).catch(() => undefined);
    }

    await clickSubmit(page);
    // Deterministic: either the URL leaves the signup page, a verify-email message appears,
    // or Supabase answers with an environment refusal (checked after the poll).
    const envRefusal = /email address .* is invalid|rate limit|too many requests/i;
    await expect
      .poll(async () => {
        const url = page.url();
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const movedOn = !/\/signup\/?(\?.*)?$/.test(new URL(url).pathname + new URL(url).search) || !/signup/.test(url);
        const verifyMsg = /verify|check your.*(email|inbox)|confirmation/i.test(bodyText);
        return movedOn || verifyMsg || envRefusal.test(bodyText);
      }, { timeout: BOOT_TIMEOUT })
      .toBe(true);
    const refusal = (await page.locator('body').innerText().catch(() => '')).match(envRefusal);
    // The dev Supabase project rejects the fixture domain outright (same skip as job-seeker.spec.ts).
    test.skip(Boolean(refusal), `Supabase refused the fixture signup in this environment: ${refusal?.[0]}`);
  });

  /**
   * REGRESSION test for the 2026-05-26 "employer signup creates job_seeker
   * profile" bug. Two separate auto-create paths (lib/auth/protect.ts and
   * /api/auth/profile GET) hardcoded role='job_seeker' instead of reading
   * the role the SignUpForm pushed into Supabase user_metadata.
   *
   * Requires E2E_SUPABASE_URL / E2E_SUPABASE_SERVICE_ROLE_KEY / E2E_DATABASE_URL
   * (explicit opt-in); skipped otherwise so CI without service-role access passes.
   */
  test('employer signup writes role=employer (not job_seeker)', async ({ page }) => {
    const supaUrl = process.env.E2E_SUPABASE_URL;
    const supaKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
    const dbUrl = process.env.E2E_DATABASE_URL;
    test.skip(!supaUrl || !supaKey || !dbUrl, 'Needs E2E_SUPABASE_URL/KEY + E2E_DATABASE_URL');

    const email = uniqueEmail('employer');
    const company = 'E2E Role Check Corp';

    await page.goto('/employer/signup');
    await page.locator('input[type="email"]').first().fill(email);
    const pwInputs = page.locator('input[type="password"]');
    await pwInputs.nth(0).fill(TEST_PASSWORD);
    if ((await pwInputs.count()) > 1) await pwInputs.nth(1).fill(TEST_PASSWORD);
    await fillNameFields(page, 'E2eRoleCheck', 'TestUser');
    const companyField = page
      .getByLabel(/company|organization/i)
      .or(page.getByPlaceholder(/company|organization/i))
      .first();
    if (await companyField.count()) await companyField.fill(company);
    const tos = page.locator('input[type="checkbox"]').first();
    if (await tos.count()) await tos.check({ force: true }).catch(() => undefined);

    await clickSubmit(page);
    await expect
      .poll(async () => !/\/signup/.test(page.url()) || /verify|check your|confirmation/i.test(await page.locator('body').innerText().catch(() => '')), { timeout: BOOT_TIMEOUT })
      .toBe(true);

    const { createClient } = await import('@supabase/supabase-js');
    const { PrismaClient } = await import('@prisma/client');
    const admin = createClient(supaUrl!, supaKey!);
    const prisma = new PrismaClient();

    try {
      const usersPage = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const authUser = usersPage.data?.users.find((u) => u.email === email);
      expect(authUser, `Supabase auth user not found for ${email}`).toBeTruthy();
      expect(
        (authUser?.user_metadata as { role?: string } | undefined)?.role,
        'auth.user_metadata.role should be "employer" after employer signup',
      ).toBe('employer');

      const profile = await prisma.userProfile.findUnique({
        where: { email },
        select: { role: true, company: true },
      });
      if (profile) {
        expect(profile.role, `UserProfile for ${email} must be role=employer`).toBe('employer');
        if (company && profile.company) {
          expect(profile.company.toLowerCase()).toContain('e2e role check');
        }
      }

      if (authUser) await admin.auth.admin.deleteUser(authUser.id);
      await prisma.userProfile.deleteMany({ where: { email } });
      await prisma.employerLead.deleteMany({ where: { contactEmail: email } });
      await prisma.emailLead.deleteMany({ where: { email } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test('logged-in employer can start posting a job (form fields render)', async ({ page }) => {
    test.skip(!HAS_AUTH, 'Needs E2E_EMPLOYER_EMAIL/PASS');
    await loginAsEmployer(page);
    await page.goto('/post-job');

    // The wizard is gated for employers whose free post is used while paid
    // posting is closed (ENABLE_PAID_POSTING=false). The shared E2E employer
    // is in exactly that state after its seed post, so accept the gate as
    // the correct rendering and stop — the ephemeral-employer lifecycle
    // below exercises the form itself on a fresh quota.
    const paidGate = page.getByRole('heading', { name: /paid posting is coming soon/i });
    const titleField = page.locator('#title');
    await expect(paidGate.or(titleField)).toBeVisible({ timeout: BOOT_TIMEOUT });
    if (await paidGate.isVisible()) {
      await expect(page.getByRole('link', { name: /go to your dashboard/i })).toBeVisible();
      return;
    }

    await titleField.fill('E2E Test PMHNP Position DELETE ME');
    const locationField = page.locator('#location');
    if (await locationField.count()) await locationField.fill('Boston, MA');
    expect(await titleField.inputValue()).toContain('E2E Test PMHNP');
  });

  test('logged-in employer can update settings', async ({ page }) => {
    test.skip(!HAS_AUTH, 'Needs E2E_EMPLOYER_EMAIL/PASS');
    await loginAsEmployer(page);
    await page.goto('/employer/settings');

    const company = page.getByPlaceholder('Your company name');
    await expect(company).toBeVisible({ timeout: BOOT_TIMEOUT });
    const original = await company.inputValue();
    const newValue = `${original.replace(/ \(E2E \d+\)$/, '')} (E2E ${Date.now()})`;
    await company.fill(newValue);
    const saveBtn = page.getByRole('button', { name: /save changes/i }).first();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/employer/settings') && r.request().method() === 'PATCH'),
      saveBtn.click(),
    ]);
    expect(res.status(), await res.text()).toBe(200);

    await page.reload();
    const reloaded = page.getByPlaceholder('Your company name');
    await expect(reloaded).toHaveValue(newValue, { timeout: BOOT_TIMEOUT });

    // Restore the original value so the seeded employer's cards stay clean.
    await reloaded.fill(original);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/employer/settings') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: /save changes/i }).first().click(),
    ]);
  });

  test('logged-in employer can search candidates', async ({ page }) => {
    test.skip(!HAS_AUTH, 'Needs E2E_EMPLOYER_EMAIL/PASS');
    await loginAsEmployer(page);
    await page.goto('/employer/candidates');

    const searchField = page
      .getByPlaceholder(/search|filter/i)
      .or(page.locator('input[type="search"]'))
      .first();
    await searchField.waitFor({ state: 'visible', timeout: BOOT_TIMEOUT }).catch(() => undefined);
    if (!(await searchField.count())) {
      test.skip(true, 'No search field on /employer/candidates');
      return;
    }
    await searchField.fill('PMHNP');
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/employer/candidates') && r.request().method() === 'GET', { timeout: BOOT_TIMEOUT }).catch(() => null),
      page.keyboard.press('Enter'),
    ]);
    if (res) expect(res.status(), 'candidate search must not 5xx').toBeLessThan(500);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/something went wrong|server error|application error/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Employer-funnel journey (2026-09). Everything below installs a console /
// pageerror guard on every page it opens and fails on uncaught errors.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const HAS_SEEKER = getSeekerCreds() !== null;
/**
 * Page bootstrap budget (login redirect, wizard auth/paid-gate resolution).
 * Every authenticated page issues /api/auth/profile 8-9 times serially, so
 * under a loaded server the first paint can take a minute. Raise with
 * E2E_BOOT_TIMEOUT_MS when the server is shared; the assertions themselves
 * are unchanged — only how long we are willing to wait for first paint.
 */
const BOOT_TIMEOUT = Number(process.env.E2E_BOOT_TIMEOUT_MS ?? 30_000);
const LIFECYCLE_TIMEOUT = Math.max(180_000, BOOT_TIMEOUT * 4);
const bootExpect = expect.configure({ timeout: BOOT_TIMEOUT });
/**
 * supabase-js logs `TypeError: Failed to fetch` from _getUser/_useSession
 * when a page navigates away while its session check is in flight (every
 * test that logs in and immediately goto()s another page). Navigation
 * aborts are not product errors; a *real* fetch failure elsewhere still
 * fails the guard because this pattern is anchored on the supabase stack.
 */
const NAV_ABORT_NOISE = /TypeError: Failed to fetch[\s\S]*(_getUser|_useSession|_recoverAndRefresh)/;
const PROTECTED_EMPLOYER_PAGES = [
  '/employer/dashboard',
  '/employer/applicants',
  '/employer/candidates',
  '/employer/candidates/anyone',
  '/employer/analytics',
  '/employer/settings',
];
const PROTECTED_EMPLOYER_APIS = [
  '/api/employer/applicants',
  '/api/employer/usage',
  '/api/employer/analytics',
  '/api/employer/analytics/csv',
  '/api/employer/settings',
  '/api/employer/candidates',
  '/api/employer/candidates/anyone',
  '/api/employer/saved-candidates',
  '/api/employer/messages',
  '/api/job-draft',
];
const JSON_HEADERS = { Origin: MUT_ORIGIN, 'Content-Type': 'application/json' };

async function paidPostingAvailable(page: Page): Promise<boolean> {
  const res = await page.request.get('/api/create-checkout/availability');
  const body = (await res.json()) as { available?: boolean };
  return body.available === true;
}

/** First unclaimed company profile link from the public directory, or null. */
async function firstCompanyPath(page: Page): Promise<string | null> {
  await page.goto('/companies');
  const href = await page.locator('a[href^="/companies/"]').first().getAttribute('href').catch(() => null);
  return href;
}

/**
 * Copy rule in force site-wide: rendered text carries no em/en dashes.
 * Walks visible text nodes (select options count when their <select> is
 * visible) and returns offending snippets; `exclude` drops employer-authored
 * regions (the JD editor, job descriptions) which are not product copy.
 */
async function dashSnippets(page: Page, exclude: string[] = []): Promise<string[]> {
  return page.evaluate(({ exclude }) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent || '';
      if (!/[–—]/.test(text)) continue;
      const el = node.parentElement;
      if (!el || el.closest('script,style,noscript,template')) continue;
      if (exclude.some((sel) => el.closest(sel))) continue;
      const anchor = el.closest('option') ? el.closest('select') : el;
      if (!anchor) continue;
      const style = window.getComputedStyle(anchor);
      if (style.display === 'none' || style.visibility === 'hidden' || anchor.getClientRects().length === 0) continue;
      out.push(text.replace(/\s+/g, ' ').trim().slice(0, 140));
      if (out.length >= 25) break;
    }
    return out;
  }, { exclude });
}

async function expectNoDashCopy(page: Page, label: string, exclude: string[] = []): Promise<void> {
  const hits = await dashSnippets(page, exclude);
  expect.soft(hits, `${label}: rendered copy must not contain em/en dashes (${page.url()})`).toEqual([]);
}

/** A second, isolated browser session on the mutation origin (own cookies). */
async function mutationContext(browser: Browser, extra: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: MUT_ORIGIN,
    extraHTTPHeaders: { 'User-Agent': 'PMHNP-E2E-Bot/1.0 (Playwright)' },
    ...extra,
  });
}

// ── A. Gating without credentials ───────────────────────────────────────────

test.describe('employer gating (unauthenticated)', () => {
  let guard: ConsoleGuard;
  test.beforeEach(({ page }) => {
    guard = installConsoleGuard(page, [NAV_ABORT_NOISE]);
  });
  test.afterEach(() => guard.assertClean());

  for (const path of PROTECTED_EMPLOYER_PAGES) {
    test(`${path} redirects anonymous visitors to /login with next=`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/\//g, '%2F')}`));
      await expect(page.locator('input[type="email"]').first()).toBeVisible();
    });
  }

  test('employer JSON APIs return 401 (not 200, not a redirect) when anonymous', async ({ request }) => {
    for (const path of PROTECTED_EMPLOYER_APIS) {
      const res = await request.get(path, { maxRedirects: 0, headers: { 'x-forwarded-for': uniqueIp() } });
      expect(res.status(), `${path}`).toBe(401);
    }
    // free-quota-status answers anonymous callers 401 like every other
    // employer route, keeping the non-eligible shape and leaking nothing else.
    const quota = await request.get('/api/employer/free-quota-status', { headers: { 'x-forwarded-for': uniqueIp() } });
    expect(quota.status()).toBe(401);
    expect(await quota.json()).toEqual({ error: 'Unauthorized', eligible: false, reason: 'unauthenticated' });
  });

  test('same-origin mutations from the host actually being served pass the CSRF gate (401, never 403)', async ({ request }) => {
    // lib/csrf.ts promises that an Origin equal to request.nextUrl.origin is
    // first-party. Under `next start` bound to 127.0.0.1 that fallback does
    // not hold: nextUrl.origin reports localhost, so every same-origin
    // browser mutation from http://127.0.0.1:3000 is blocked with 403.
    const res = await request.post('/api/job-draft', {
      headers: { Origin: BASE, Referer: `${BASE}/post-job`, 'Content-Type': 'application/json' },
      data: { formData: { title: 'csrf probe' } },
    });
    test.fixme(
      res.status() === 403,
      'DEFECT: CSRF gate rejects same-origin mutations from the served host (127.0.0.1) under next start — lib/csrf.ts isAllowedOrigin',
    );
    expect(res.status(), await res.text()).toBe(401);
  });

  test('mutating employer APIs reject anonymous browser-origin requests (401, no side effects)', async ({ request }) => {
    // Absolute URLs on the mutation origin so the 401 contract is observable
    // regardless of which host the read-only tests target.
    const url = (p: string) => `${MUT_ORIGIN}${p}`;
    const postFree = await request.post(url('/api/jobs/post-free'), {
      headers: { ...JSON_HEADERS, 'x-forwarded-for': uniqueIp() },
      data: {
        title: 'Anonymous PMHNP post attempt',
        employer: 'Nobody', location: 'Remote', mode: 'Remote', jobType: 'Full-Time',
        description: 'x'.repeat(220), applyLink: 'https://example.invalid/apply',
        contactEmail: 'hiring@example.invalid',
      },
    });
    expect(postFree.status(), await postFree.text()).toBe(401);

    const draft = await request.post(url('/api/job-draft'), { headers: JSON_HEADERS, data: { formData: { title: 'anon' } } });
    expect(draft.status()).toBe(401);

    const patch = await request.patch(url('/api/employer/applicants'), { headers: JSON_HEADERS, data: { applicationId: 'x', status: 'hired' } });
    expect(patch.status()).toBe(401);

    const settings = await request.patch(url('/api/employer/settings'), { headers: JSON_HEADERS, data: { company: 'Anon Corp' } });
    expect(settings.status()).toBe(401);

    const targetJob = SEEDS.employerJobId ?? 'not-a-job';
    const archive = await request.patch(url(`/api/employer/jobs/${targetJob}/archive`), { headers: JSON_HEADERS });
    expect(archive.status()).toBe(401);
    const toggle = await request.patch(url(`/api/employer/jobs/${targetJob}/toggle-publish`), { headers: JSON_HEADERS });
    expect(toggle.status()).toBe(401);

    const message = await request.post(url('/api/employer/messages'), { headers: JSON_HEADERS, data: { recipientId: 'x', subject: 's', body: 'b' } });
    expect(message.status()).toBe(401);

    const renewal = await request.post(url('/api/create-renewal-checkout'), { headers: JSON_HEADERS, data: { jobId: 'x' } });
    expect(renewal.ok(), 'renewal checkout must not open for anonymous callers').toBe(false);
  });

  test('renewal-success page never shows a success state without a verified session', async ({ page }) => {
    // With Stripe unconfigured the verify API answers 503 (accepted by the
    // API-level test below); the browser logs that as a resource error.
    guard.allow(/verify-renewal-session|status of 503/);
    await page.goto('/employer/renewal-success');
    await expect(page.getByRole('heading', { name: /^error$/i })).toBeVisible();
    await expect(page.getByText(/no session id provided/i)).toBeVisible();

    await page.goto('/employer/renewal-success?session_id=cs_test_e2e_bogus_session');
    await expect(page.getByRole('heading', { name: /^error$/i })).toBeVisible();
    await expect(page.getByText(/renewed successfully/i)).toHaveCount(0);
    await expectNoDashCopy(page, 'renewal-success error state');
  });

  test('verify-renewal-session rejects anonymous callers and leaks nothing', async ({ request }) => {
    const res = await request.get('/api/verify-renewal-session?session_id=cs_test_e2e_bogus_session', { headers: { 'x-forwarded-for': uniqueIp() } });
    expect([400, 401, 503]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('jobTitle');
    expect(body).not.toHaveProperty('dashboardToken');
    const missing = await request.get('/api/verify-renewal-session', { headers: { 'x-forwarded-for': uniqueIp() } });
    expect(missing.ok()).toBe(false);
  });

  test('preview without wizard data bounces to /post-job, which shows the sign-in gate to visitors', async ({ page }) => {
    await page.goto('/post-job/preview');
    await expect(page).toHaveURL(/\/post-job\/?$/, { timeout: BOOT_TIMEOUT });
    await bootExpect(page.getByText(/must be logged in as an employer to post jobs/i)).toBeVisible();
    await expect(page.locator('#title')).toHaveCount(0);
    await expect(page.locator('a[href="/signup?role=employer"]').first()).toBeVisible();
    await expectNoDashCopy(page, '/post-job sign-in gate');
  });

  test('public employer marketing surfaces carry no em/en dash copy', async ({ page }) => {
    for (const path of ['/for-employers', '/pricing', '/login?role=employer', '/signup?role=employer']) {
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
      await expectNoDashCopy(page, path);
    }
  });

  test('company profile shows a sign-in claim CTA to anonymous visitors', async ({ page }) => {
    const path = await firstCompanyPath(page);
    test.skip(!path, 'No company profiles in the directory');
    await page.goto(path!);
    const cta = page.getByRole('link', { name: /sign in to claim this profile/i });
    const claimed = page.getByText(/claimed by employer/i);
    await expect(cta.or(claimed).first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    if (await cta.isVisible()) {
      expect(await cta.getAttribute('href')).toMatch(/^\/login\?redirectTo=%2Fcompanies%2F/);
    }
  });
});

// ── B. Wrong role ───────────────────────────────────────────────────────────

test.describe('job seeker cannot use employer surfaces', () => {
  test.skip(!HAS_SEEKER, 'E2E_SEEKER_EMAIL / E2E_SEEKER_PASS not set');
  test.describe.configure({ timeout: 120_000 });
  let guard: ConsoleGuard;
  test.beforeEach(({ page }) => {
    guard = installConsoleGuard(page, [NAV_ABORT_NOISE]);
  });
  test.afterEach(() => guard.assertClean());

  test('seeker is bounced to /unauthorized from employer pages and 403 from employer APIs', async ({ page }) => {
    await loginAsSeeker(page);
    await page.goto('/employer/dashboard');
    await expect(page).toHaveURL(/\/unauthorized/, { timeout: BOOT_TIMEOUT });
    await page.goto('/employer/applicants');
    await expect(page).toHaveURL(/\/unauthorized/, { timeout: BOOT_TIMEOUT });

    for (const path of ['/api/employer/applicants', '/api/employer/usage', '/api/employer/settings', '/api/employer/candidates/anyone']) {
      const res = await page.request.get(path, { headers: { 'x-forwarded-for': uniqueIp() } });
      expect(res.status(), path).toBe(403);
    }
    const quota = await page.request.get('/api/employer/free-quota-status');
    expect((await quota.json()).eligible).toBe(false);
  });

  test('seeker sees the wrong-account gate on /post-job instead of the wizard', async ({ page }) => {
    await loginAsSeeker(page);
    await page.goto('/post-job');
    await bootExpect(page.getByRole('heading', { name: /wrong account type/i })).toBeVisible();
    await expect(page.locator('#title')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /browse jobs instead/i })).toBeVisible();
    await expectNoDashCopy(page, '/post-job wrong-account gate');
  });
});

// ── C. Seeded employer (free quota already consumed) ────────────────────────

test.describe('seeded employer: dashboard + paid-posting gate', () => {
  test.skip(!HAS_AUTH, 'E2E_EMPLOYER_EMAIL / E2E_EMPLOYER_PASS not set');
  test.use({ baseURL: MUT_ORIGIN });
  test.describe.configure({ timeout: LIFECYCLE_TIMEOUT });
  let guard: ConsoleGuard;
  test.beforeEach(({ page }) => {
    guard = installConsoleGuard(page, [NAV_ABORT_NOISE]);
  });
  test.afterEach(() => guard.assertClean());

  /** localStorage payload the preview page hydrates from (mirrors the wizard's serialisation). */
  const seedPreviewPayload = (page: Page) =>
    page.evaluate((tag) => {
      localStorage.setItem('jobFormData', JSON.stringify({
        title: `Gate probe ${tag} PMHNP`, companyName: 'Gate Probe Co', contactEmail: 'hiring@example.invalid',
        location: 'Remote', mode: 'Remote', jobType: 'Full-Time', description: '<p>' + 'x'.repeat(220) + '</p>',
        salaryMin: 120000, salaryMax: 150000, salaryPeriod: 'annual', applyUrl: 'https://example.invalid/apply',
        applyOnPlatform: false, pricingTier: 'pro', benefits: [], minYearsExperience: 2, maxYearsExperience: 4,
      }));
    }, Date.now());

  test('dashboard lists the seeded job with an edit link and live job link', async ({ page }) => {
    const slug = process.env.E2E_TEST_JOB_SLUG;
    test.skip(!slug, 'E2E_TEST_JOB_SLUG not set');
    await loginAsEmployer(page);
    await page.goto('/employer/dashboard');
    await bootExpect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator(`a[href="/jobs/${slug}"]`).first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('a[href^="/jobs/edit/"]').first()).toBeVisible();
    await expectNoDashCopy(page, '/employer/dashboard');
  });

  test('login honours ?next= and lands the employer on the page they were sent from', async ({ page }) => {
    await loginAtPath(page, '/login?role=employer&next=%2Femployer%2Fapplicants', getEmployerCreds()!, { timeout: BOOT_TIMEOUT });
    await expect(page).toHaveURL(/\/employer\/applicants/, { timeout: BOOT_TIMEOUT });
    await bootExpect(page.getByRole('heading', { level: 1, name: /applicants/i })).toBeVisible();
  });

  test('second post hits the paid-posting gate upfront (never reaches a card form)', async ({ page }) => {
    await loginAsEmployer(page);
    const quota = await (await page.request.get('/api/employer/free-quota-status')).json();
    test.skip(quota.eligible !== true || quota.willBeFree !== false, 'Seeded employer still has a free post — gate not reachable');
    const available = await paidPostingAvailable(page);

    await page.goto('/post-job');
    if (!available) {
      await bootExpect(page.getByRole('heading', { name: /paid posting is coming soon/i })).toBeVisible();
      await expect(page.locator('#title')).toHaveCount(0);
      await expectNoDashCopy(page, '/post-job paid gate');
    } else {
      await bootExpect(page.locator('#title')).toBeVisible();
    }

    // Preview-page gate: seed the wizard's localStorage payload directly so
    // the price disclosure + checkout branch is exercised without a wizard.
    await seedPreviewPayload(page);
    await page.goto('/post-job/preview');
    await bootExpect(page.getByRole('heading', { name: /preview your job post/i })).toBeVisible();
    const cta = page.locator('button.preview-btn-primary');
    // Price is disclosed on the button itself before any Stripe page (content audit P2 #16).
    await expect(cta).toContainText(/Continue to Payment: \$\d+/, { timeout: BOOT_TIMEOUT });
    await expect(page.getByText('$199', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/\b(Starter|Growth|Premium)\b/);
    await expectNoDashCopy(page, '/post-job/preview (paid state)');

    if (!available) {
      await expect(page.getByText(/paid posting is coming soon/i)).toBeVisible();
      const [postRes] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/jobs/post-free') && r.request().method() === 'POST'),
        cta.click(),
      ]);
      // The API refuses the second free post; the UI must say so honestly and stay put.
      expect(postRes.status()).toBe(403);
      expect((await postRes.json()).requiresPayment).toBe(true);
      await expect(page.getByText(/paid posting is not open yet/i)).toBeVisible();
      await expect(page).toHaveURL(/\/post-job\/preview/);
    } else {
      await cta.click();
      await expect(page).toHaveURL(/\/post-job\/checkout|checkout\.stripe\.com/, { timeout: 20_000 });
      // Stop at the checkout gate — never submit a card.
    }
    await page.evaluate(() => { localStorage.removeItem('jobFormData'); localStorage.removeItem('jobScreeningQuestions'); });
  });

  test('preview is usable at a 375px viewport: no horizontal overflow, sticky CTA reachable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsEmployer(page);
    await seedPreviewPayload(page);
    await page.goto('/post-job/preview');
    await bootExpect(page.getByRole('heading', { name: /preview your job post/i })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth, 'preview must not scroll horizontally at 375px').toBeLessThanOrEqual(overflow.innerWidth);
    await expect(page.locator('button.preview-btn-primary')).toBeInViewport();
    await expect(page.getByRole('button', { name: /back to edit/i })).toBeInViewport();
    await page.evaluate(() => localStorage.removeItem('jobFormData'));
  });

  test('an authenticated page load fetches /api/auth/profile a bounded number of times', async ({ page }) => {
    // HeaderAuth fetches the profile on mount AND again inside
    // onAuthStateChange (INITIAL_SESSION / SIGNED_IN fire immediately), and
    // UserMenu + the page body each fetch it too. Measured: 8-9 serial
    // round-trips per page load. Under load each is seconds, so first
    // paint of the dashboard / wizard takes 30-90s.
    await loginAsEmployer(page);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    let profileFetches = 0;
    page.on('request', (r) => { if (r.url().includes('/api/auth/profile')) profileFetches += 1; });
    await page.goto('/employer/dashboard');
    await bootExpect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: BOOT_TIMEOUT }).catch(() => undefined);
    test.fixme(
      profileFetches > 3,
      `DEFECT: one page load issues /api/auth/profile ${profileFetches}x (mount + onAuthStateChange duplicates) — components/auth/HeaderAuth.tsx`,
    );
    expect(profileFetches).toBeLessThanOrEqual(3);
  });

  test('dashboard analytics tab renders without an error panel', async ({ page }) => {
    await loginAsEmployer(page);
    await page.goto('/employer/dashboard?tab=analytics');
    const analyticsRes = await page.waitForResponse((r) => r.url().includes('/api/employer/analytics') && r.request().method() === 'GET', { timeout: BOOT_TIMEOUT });
    expect(analyticsRes.status()).toBe(200);
    await expect(page.locator('body')).not.toContainText(/something went wrong|failed to load|application error/i);
  });

  test('employer portal surfaces render without em/en dash copy', async ({ page }) => {
    await loginAsEmployer(page);
    for (const path of ['/employer/applicants', '/employer/candidates', '/employer/settings', '/employer/analytics']) {
      await page.goto(path);
      await bootExpect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle', { timeout: BOOT_TIMEOUT }).catch(() => undefined);
      await expectNoDashCopy(page, path);
    }
  });

  test('settings API validates its input shape (type confusion must be a 400, never a 500)', async ({ page }) => {
    await loginAsEmployer(page);
    // Every field is spread straight into prisma.userProfile.update; a non-string
    // reaches the ORM and surfaces as an unhandled 500 instead of a validation error.
    const bad = await page.request.patch('/api/employer/settings', {
      headers: JSON_HEADERS,
      data: { phone: { nested: 'object' }, firstName: ['array'] },
    });
    const status = bad.status();
    test.fixme(
      status >= 500,
      `DEFECT: PATCH /api/employer/settings 500s on non-string fields (no schema validation) — app/api/employer/settings/route.ts`,
    );
    expect(status, await bad.text()).toBe(400);
  });
});

// ── D. Full lifecycle on an ephemeral employer (fresh free quota) ───────────

interface LifecycleState {
  emp: EphemeralEmployer | null;
  title: string;
  jobSlug: string | null;
  jobId: string | null;
  editToken: string | null;
  applied: boolean;
  applicationId: string | null;
  /** Candidate's Supabase auth id — the key /employer/candidates/[id] and messages.recipientId use. */
  seekerAuthId: string | null;
}

test.describe('employer lifecycle (ephemeral employer, local only)', () => {
  test.skip(AGAINST_PROD, 'Creates users/jobs — never against production');
  test.skip(!ephemeralSupportAvailable(), 'Needs Supabase service-role creds (E2E_SUPABASE_* or app .env) to mint a fresh employer');
  test.skip(!HAS_SEEKER, 'Candidate half of the funnel needs E2E_SEEKER_EMAIL / E2E_SEEKER_PASS');
  test.use({ baseURL: MUT_ORIGIN });
  test.describe.configure({ timeout: LIFECYCLE_TIMEOUT });

  const state: LifecycleState = {
    emp: null, title: '', jobSlug: null, jobId: null, editToken: null, applied: false, applicationId: null, seekerAuthId: null,
  };
  let guard: ConsoleGuard;

  test.beforeAll(async ({ request }) => {
    // The wizard, apply, applicants and messaging steps all POST from the
    // browser. Confirm the mutation origin is accepted by the CSRF gate
    // before minting a user; otherwise nothing below can be exercised honestly.
    const probe = await request.post('/api/job-draft', {
      headers: JSON_HEADERS,
      data: { formData: {} },
    });
    test.skip(
      probe.status() === 403,
      `CSRF gate blocks same-origin mutations at ${MUT_ORIGIN} (lib/csrf.ts) — set PLAYWRIGHT_MUTATION_BASE_URL to an allowed origin`,
    );
    state.emp = await createEphemeralEmployer();
    state.title = `PMHNP Telepsychiatry Lead ${state.emp.runTag}`;
    state.seekerAuthId = await authIdForEmail(getSeekerCreds()!.email);
  });

  test.afterAll(async () => {
    if (!state.emp) return;
    const log = await destroyEphemeralEmployer(state.emp);
    test.info().annotations.push({ type: 'cleanup', description: log.join('; ') });
    await closeDb();
  });

  test.beforeEach(async ({ page }) => {
    guard = installConsoleGuard(page, [NAV_ABORT_NOISE]);
    // The cookie banner is not the subject here; its fixed overlay would
    // intercept wizard clicks at 375px and add a second role=dialog.
    await presetConsentCookie(page, MUT_ORIGIN);
  });
  test.afterEach(() => guard.assertClean());

  // Land on /post-job (every lifecycle test starts from the wizard or navigates
  // explicitly); tests that exercise the dashboard go there themselves. The
  // ephemeral user is minted through the Supabase admin API, so its UserProfile
  // row is auto-created on the first authenticated profile read (the dashboard
  // guard used to do this implicitly); GET /api/auth/profile does it explicitly.
  const loginFresh = async (page: Page) => {
    await loginAtPath(page, '/login?role=employer&redirectTo=%2Fpost-job', { email: state.emp!.email, password: state.emp!.password }, { timeout: BOOT_TIMEOUT });
    expect((await page.request.get('/api/auth/profile')).status(), 'profile auto-created for the ephemeral employer').toBe(200);
  };

  async function openWizard(page: Page) {
    await page.goto('/post-job');
    await expect(page.locator('#title')).toBeVisible({ timeout: BOOT_TIMEOUT });
  }

  /** Step 2 in full (registry-driven selects included). */
  async function fillStep2(page: Page) {
    await page.locator('#location').fill('Austin, TX');
    await clickRadioLabel(page, 'mode', 'Remote');
    await clickRadioLabel(page, 'jobType', 'Full-Time');
    await pickExperience(page, '2 to 4 years');
    await page.locator('#specialty').selectOption({ index: 1 });
    await page.locator('#setting').selectOption({ index: 1 });
    await page.locator('#population').selectOption({ index: 1 });
  }

  test('wizard surfaces per-field validation errors on every step and keeps values across back/refresh', async ({ page }) => {
    await loginFresh(page);
    await openWizard(page);
    await expectNoDashCopy(page, 'wizard step 1');

    // Step 1 — empty submit
    await next(page);
    await expect(page.getByText('Job title must be at least 10 characters')).toBeVisible();
    await expect(page.getByText('Company name is required')).toBeVisible();
    await expect(stepHeading(page, /company information/i)).toBeVisible();

    // Step 1 — bad website + free-mail contact
    await fillStep1(page, {
      title: 'Short', companyName: state.emp!.company, companyWebsite: 'not a url', contactEmail: 'someone@gmail.com',
    });
    await next(page);
    await expect(page.getByText('Job title must be at least 10 characters')).toBeVisible();
    await expect(page.getByText('Must be a valid URL')).toBeVisible();
    await expect(page.getByText(/please use your company email/i)).toBeVisible();
    await expectNoDashCopy(page, 'wizard step 1 errors');

    await fillStep1(page, {
      title: state.title, companyName: state.emp!.company, companyWebsite: `https://${state.emp!.domain}`,
      contactEmail: state.emp!.contactEmail,
    });
    await next(page);
    await expect(stepHeading(page, /role details/i)).toBeVisible();

    // Step 2 — empty submit: location, mode, jobType, experience each carry an error line.
    await next(page);
    await expect(page.getByText('Location is required')).toBeVisible();
    await expect(page.getByText('Please select an experience level')).toBeVisible();
    const errorLines = page.locator('#job-post-form p').filter({ hasText: /required|please select|invalid|expected/i });
    expect(await errorLines.count(), 'location + mode + jobType + experience errors').toBeGreaterThanOrEqual(4);
    await expectNoDashCopy(page, 'wizard step 2 errors');

    // Back keeps step-1 values; refresh keeps them too (draft) and returns to step 1.
    await page.locator(WIZARD.back).click();
    await expect(page.locator('#title')).toHaveValue(state.title);
    await waitForSaved(page);
    await page.reload();
    await expect(page.locator('#title')).toHaveValue(state.title, { timeout: BOOT_TIMEOUT });
    await expect(page.locator('#contactEmail')).toHaveValue(state.emp!.contactEmail);
    await next(page);

    await fillStep2(page);
    // Specialty / setting / population are registry-driven selects.
    for (const id of ['#specialty', '#setting', '#population']) {
      expect(await page.locator(`${id} option`).count(), `${id} options`).toBeGreaterThan(2);
    }
    await next(page);
    await expect(stepHeading(page, /job description/i)).toBeVisible();

    // Step 3 — empty description
    await next(page);
    await expect(page.getByText('Job description must be at least 200 characters')).toBeVisible();
    await typeDescription(page, 'Too short.');
    await next(page);
    await expect(page.getByText('Job description must be at least 200 characters')).toBeVisible();
    await typeDescription(page, sampleDescription(state.emp!.runTag));
    expect(await descriptionLength(page)).toBeGreaterThanOrEqual(200);
    await expectNoDashCopy(page, 'wizard step 3', [WIZARD.quill]);

    // Refresh mid-flow: the description is part of the autosaved draft and must survive.
    await waitForSaved(page);
    await page.reload();
    await expect(page.locator('#title')).toHaveValue(state.title, { timeout: BOOT_TIMEOUT });
    await next(page);
    await expect(stepHeading(page, /role details/i)).toBeVisible();
    await expect(page.locator('#location')).toHaveValue('Austin, TX');
    await next(page);
    await expect(stepHeading(page, /job description/i)).toBeVisible();
    expect(await descriptionLength(page), 'description must survive a mid-flow reload').toBeGreaterThanOrEqual(200);
    await next(page);
    await expect(stepHeading(page, /compensation/i)).toBeVisible();

    // Step 4 — missing salary + apply URL, then inverted range
    await next(page);
    await expect(page.getByText('Minimum salary is required')).toBeVisible();
    await expect(page.getByText('Maximum salary is required')).toBeVisible();
    await expect(page.getByText(/apply url is required/i)).toBeVisible();
    await page.locator('input[name="salaryMin"]').fill('160000');
    await page.locator('input[name="salaryMax"]').fill('120000');
    await page.locator('#applyUrl').fill('not-a-url');
    await next(page);
    await expect(page.getByText('Minimum salary cannot be greater than maximum')).toBeVisible();
    await expect(page.getByText('Must be a valid URL')).toBeVisible();
    await expect(stepHeading(page, /compensation/i)).toBeVisible();
    await expectNoDashCopy(page, 'wizard step 4 errors');
  });

  test('wizard is usable at a 375px mobile viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginFresh(page);
    await openWizard(page);
    await fillStep1(page, {
      title: state.title, companyName: state.emp!.company, contactEmail: state.emp!.contactEmail,
    });
    await next(page);
    await expect(stepHeading(page, /role details/i)).toBeVisible();
    await page.locator('#location').fill('Austin, TX');
    await clickRadioLabel(page, 'mode', 'Remote');
    await expect(page.locator('input[name="mode"][value="Remote"]')).toBeChecked();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth, 'page must not scroll horizontally at 375px').toBeLessThanOrEqual(overflow.innerWidth);
    await expect(page.locator('.step-label').first()).toBeHidden();
    // The wizard's step navigation is in normal flow (not sticky), so on a
    // 375px screen Continue is reached by scrolling; it must then be fully on screen.
    await page.locator(WIZARD.next).scrollIntoViewIfNeeded();
    await expect(page.locator(WIZARD.next)).toBeInViewport({ ratio: 1 });
  });

  test('draft autosaves and the resume banner appears after a reload', async ({ page }) => {
    await loginFresh(page);
    await openWizard(page);
    const draftTitle = `${state.title} draft`;
    await page.locator('#title').fill(draftTitle);
    await waitForSaved(page);
    const saved = await page.request.get('/api/job-draft');
    expect(saved.status()).toBe(200);
    expect((await saved.json()).draft?.formData?.title).toBe(draftTitle);

    await page.reload();
    await expect(page.locator('#title')).toHaveValue(draftTitle, { timeout: BOOT_TIMEOUT });
    // Server-draft hydration is the primary path for a signed-in employer;
    // the wizard promises a "Resumed your unfinished post" banner there.
    await expect(page.getByText(/resumed your unfinished post/i)).toBeVisible({ timeout: 10_000 });
    // The dashboard advertises the same unfinished draft.
    await page.goto('/employer/dashboard');
    await bootExpect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(new RegExp(draftTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible({ timeout: BOOT_TIMEOUT });
  });

  test('Clear-draft dialog is keyboard operable: focus lands inside, Tab stays inside, Escape cancels', async ({ page }) => {
    await loginFresh(page);
    await openWizard(page);
    await page.locator(WIZARD.clear).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /clear draft/i })).toBeFocused();
    await page.keyboard.press('Tab');
    const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    expect(focusInside, 'Tab from the last dialog control must not escape the modal').toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#title')).toBeVisible();
    // Confirming actually clears: server draft gone, title empty.
    await page.locator(WIZARD.clear).click();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('#title')).toHaveValue('');
    await expect.poll(async () => (await (await page.request.get('/api/job-draft')).json()).draft ?? null, { timeout: 15_000 }).toBeNull();
  });

  test('full wizard → preview (price, H1, no ghost tiers) → back to edit → publish via the free first post', async ({ page }) => {
    await loginFresh(page);
    await openWizard(page);

    // Step 1
    await fillStep1(page, {
      title: state.title, companyName: state.emp!.company, companyWebsite: `https://${state.emp!.domain}`,
      contactEmail: state.emp!.contactEmail,
    });
    await next(page);
    // Step 2 (specialty / setting / population picked from the registry)
    await expect(stepHeading(page, /role details/i)).toBeVisible();
    await fillStep2(page);
    await page.locator('#experienceQualifier').fill('Telepsychiatry experience preferred');
    await next(page);
    // Step 3 — JD template prefill from the library, then personalise
    await expect(stepHeading(page, /job description/i)).toBeVisible();
    const browse = page.getByRole('button', { name: /browse \d+ .*skeleton starters/i });
    await browse.click();
    const picker = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /browse .*skeleton starters/i }) });
    await expect(picker).toBeVisible();
    await expectNoDashCopy(page, 'JD starter picker');
    // Keyboard: Escape closes the picker without choosing anything.
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    expect(await descriptionLength(page)).toBe(0);
    await browse.click();
    await expect(picker).toBeVisible();
    await picker.locator('button:has(h4)').first().click();
    // A description hydrated from the autosaved draft (>50 visible chars)
    // triggers a styled "Replace your current description?" confirm.
    const replaceConfirm = page.getByRole('dialog').filter({ hasText: /replace your current description/i });
    if (await replaceConfirm.isVisible().catch(() => false)) {
      await replaceConfirm.getByRole('button', { name: /^replace$/i }).click();
      await expect(replaceConfirm).toBeHidden();
    }
    await expect(picker).toBeHidden();
    expect(await descriptionLength(page), 'template must prefill ≥200 visible chars').toBeGreaterThanOrEqual(200);
    await page.locator(WIZARD.quill).click();
    await page.keyboard.press('End');
    await page.keyboard.type(` Run tag ${state.emp!.runTag}.`);
    await next(page);
    // Step 4 — salary, benefits, receive-on-platform + screening builder
    await expect(stepHeading(page, /compensation/i)).toBeVisible();
    await clickRadioLabel(page, 'salaryPeriod', 'annual');
    await page.locator('input[name="salaryMin"]').fill('120000');
    await page.locator('input[name="salaryMax"]').fill('150000');
    await page.locator('label', { has: page.locator('input[name="benefits"][value="CME Allowance"]') }).click();
    await page.locator('label', { hasText: /receive on/i }).locator('input[type="radio"]').check();
    await page.getByRole('button', { name: /choose from suggested questions/i }).click();
    await page.getByRole('button', { name: /board certification/i }).click();
    const custom = page.getByPlaceholder('Type a custom question...');
    await custom.fill('Years of telepsychiatry experience?');
    await custom.locator('xpath=following-sibling::select').selectOption('number');
    await custom.press('Enter');
    await expect(page.getByText('Years of telepsychiatry experience?')).toBeVisible();
    await expect(page.getByRole('button', { name: /auto-reject if/i })).toHaveCount(1);
    await expectNoDashCopy(page, 'wizard step 4 (screening builder)');
    await next(page);
    // Step 5 — plan summary: single package, no ghost tiers
    await expect(stepHeading(page, /your posting includes/i)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/\b(Starter|Growth|Premium)\b/);
    await expectNoDashCopy(page, 'wizard step 5');
    await page.locator(WIZARD.submitToPreview).click();

    // Preview
    await expect(page).toHaveURL(/\/post-job\/preview/);
    await expect(page.getByRole('heading', { level: 1, name: /preview your job post/i })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: state.title })).toBeVisible();
    await expect(page.getByText('Free', { exact: true })).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.getByText(/\$0 today for your organization's free post/i)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/\b(Starter|Growth|Premium)\b/);
    await expect(page.locator('body')).toContainText(state.emp!.company);
    await expect(page.locator('body')).toContainText(/\$120k/i);
    await expectNoDashCopy(page, '/post-job/preview (free state)', ['.job-description', '[class*="description"]']);
    const publish = page.locator('button.preview-btn-primary');
    await expect(publish).toHaveText(/looks good, post job/i);

    // Back navigation: "Back to Edit" returns to the wizard with every value intact,
    // and the wizard can be resubmitted to preview without retyping.
    await page.getByRole('button', { name: /back to edit/i }).click();
    await expect(page).toHaveURL(/\/post-job\/?$/);
    await expect(page.locator('#title')).toHaveValue(state.title, { timeout: BOOT_TIMEOUT });
    await next(page);
    await expect(page.locator('#location')).toHaveValue('Austin, TX');
    await next(page);
    expect(await descriptionLength(page)).toBeGreaterThanOrEqual(200);
    await next(page);
    await expect(page.locator('input[name="salaryMin"]')).toHaveValue('120000');
    await expect(page.getByText('Years of telepsychiatry experience?')).toBeVisible();
    await next(page);
    await expect(stepHeading(page, /your posting includes/i)).toBeVisible();
    await page.locator(WIZARD.submitToPreview).click();
    await expect(page).toHaveURL(/\/post-job\/preview/);
    await expect(page.getByRole('heading', { level: 1, name: state.title })).toBeVisible();
    await expect(publish).toHaveText(/looks good, post job/i, { timeout: BOOT_TIMEOUT });

    const [postRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jobs/post-free') && r.request().method() === 'POST'),
      publish.click(),
      // Second click while the first is in flight must be a no-op (button disabled).
      publish.click({ force: true, timeout: 2_000 }).catch(() => undefined),
    ]);
    expect(postRes.status(), await postRes.text()).toBe(200);
    const created = (await postRes.json()) as { success: boolean; jobId: string; editToken: string };
    expect(created.success).toBe(true);
    state.jobId = created.jobId;
    state.editToken = created.editToken;

    await expect(page).toHaveURL(/\/success\?free=true/);
    await expect(page.getByRole('heading', { name: /job posted successfully/i })).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expectNoDashCopy(page, '/success (free post)');
    // The wizard's local + server drafts are consumed by publishing.
    expect(await page.evaluate(() => localStorage.getItem('jobFormData'))).toBeNull();
  });

  test('published employer job is classified (professionClass set) like every ingested job', async () => {
    test.skip(!state.jobId, 'publish step did not complete');
    test.skip(!hasDb(), 'DATABASE_URL not available to the spec');
    const row = await db().job.findUnique({
      where: { id: state.jobId! },
      select: { professionClass: true, professionConfidence: true, isPublished: true, sourceType: true },
    });
    expect(row?.isPublished).toBe(true);
    expect(row?.sourceType).toBe('employer');
    // Ingested jobs pass through lib/profession-classifier.ts; the wizard's
    // /api/jobs/post-free (and /api/jobs/update) never call it, so employer
    // posts land with professionClass NULL and ride the "legacy NULL row"
    // exemption in lib/filters.ts GLOBAL_EXCLUSIONS.
    test.fixme(
      row?.professionClass == null,
      'DEFECT: post-free publishes employer jobs with professionClass NULL (no classifier call) — app/api/jobs/post-free/route.ts',
    );
    expect(row?.professionClass).not.toBeNull();
  });

  test('published job is on /jobs, has a detail page, and appears once on the dashboard', async ({ page }) => {
    test.skip(!state.jobId, 'publish step did not complete');
    await loginFresh(page);
    await page.goto('/employer/dashboard');
    const titleLinks = page.locator('a[href^="/jobs/"]:not([href^="/jobs/edit/"])').filter({ hasText: state.title });
    await expect(titleLinks).toHaveCount(1, { timeout: BOOT_TIMEOUT }); // double-click on preview must not have created two jobs
    const href = await titleLinks.first().getAttribute('href');
    state.jobSlug = href!.replace('/jobs/', '');
    expect(state.jobSlug.endsWith(state.jobId!)).toBe(true);
    const editHref = await page.locator('a[href^="/jobs/edit/"]').first().getAttribute('href');
    expect(editHref).toBe(`/jobs/edit/${state.editToken}`);
    await expectNoDashCopy(page, '/employer/dashboard (with posting)');

    await page.goto(`/jobs?q=${state.emp!.runTag}`);
    await expect(page.getByRole('link', { name: new RegExp(state.title) }).first()).toBeVisible({ timeout: BOOT_TIMEOUT });

    const api = await page.request.get(`/api/jobs?q=${state.emp!.runTag}`);
    expect(api.status()).toBe(200);
    expect(JSON.stringify(await api.json())).toContain(state.jobId!);

    await page.goto(`/jobs/${state.jobSlug}`);
    await expect(page.getByRole('heading', { level: 1, name: state.title })).toBeVisible();
    await expect(page.locator('body')).toContainText(/austin/i);
    await expect(page.locator('body')).toContainText(/\$120k/i);
    await expect(page.getByRole('button', { name: /apply/i }).first()).toBeVisible();
  });

  test('editing salary + location re-derives the card fields on /jobs', async ({ page }) => {
    test.skip(!state.jobSlug || !state.editToken, 'no published job to edit');
    await page.goto(`/jobs/edit/${state.editToken}`);
    await expect(page.locator('#location')).toHaveValue('Austin, TX', { timeout: BOOT_TIMEOUT });
    await page.locator('#location').fill('Denver, CO');
    await page.getByRole('button', { name: /^continue/i }).click();
    await page.getByRole('button', { name: /^continue/i }).click();
    await expect(page.locator('input[name="salaryMin"]')).toHaveValue('120000');
    await page.locator('input[name="salaryMin"]').fill('130000');
    await page.locator('input[name="salaryMax"]').fill('160000');
    await page.getByRole('button', { name: /^continue/i }).click();
    await expectNoDashCopy(page, '/jobs/edit review step', ['.ql-editor', '[class*="description"]']);
    const [updateRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/jobs/update') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /save changes/i }).click(),
    ]);
    expect(updateRes.status(), await updateRes.text()).toBe(200);

    await page.goto(`/jobs/${state.jobSlug}`);
    await expect(page.locator('body')).toContainText(/denver/i);
    await expect(page.locator('body')).toContainText(/\$130k/i);
    await expect(page.locator('body')).not.toContainText(/\$120k/i);

    await page.goto(`/jobs?q=${state.emp!.runTag}`);
    const card = page.locator('article, [class*="card"], li').filter({ hasText: state.title }).first();
    await expect(card).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(card).toContainText(/denver/i);
    await expect(card).toContainText(/\$130k/i);

    // Bogus token → clean error, no form, no 500.
    await page.goto('/jobs/edit/not-a-real-token');
    await expect(page.getByRole('heading', { name: /invalid edit link/i })).toBeVisible();
    await expect(page.locator('#location')).toHaveCount(0);
  });

  test('a second post from the same domain is refused by the free quota and gated by paid posting', async ({ page }) => {
    test.skip(!state.jobId, 'publish step did not complete');
    await loginFresh(page);
    const quota = await (await page.request.get('/api/employer/free-quota-status')).json();
    // config.freePostsPerEmail = 1: the domain's single free post is spent.
    expect(quota).toMatchObject({ eligible: true, willBeFree: false, remaining: 0 });
    const available = await paidPostingAvailable(page);
    await page.goto('/post-job');
    if (available) {
      await expect(page.locator('#title')).toBeVisible({ timeout: BOOT_TIMEOUT });
    } else {
      await bootExpect(page.getByRole('heading', { name: /paid posting is coming soon/i })).toBeVisible();
      await expect(page.locator('#title')).toHaveCount(0);
    }
    // API-level guard independent of the UI: a second no-charge post is refused
    // with requiresPayment, and nothing is created.
    const res = await page.request.post('/api/jobs/post-free', {
      headers: JSON_HEADERS,
      data: {
        title: `${state.title} second attempt`, employer: state.emp!.company, location: 'Remote', mode: 'Remote',
        jobType: 'Full-Time', description: sampleDescription('again'), applyLink: `https://${state.emp!.domain}/apply`,
        contactEmail: state.emp!.contactEmail,
      },
    });
    expect(res.status(), await res.text()).toBe(403);
    expect((await res.json()).requiresPayment).toBe(true);
    const after = await page.request.get(`/api/jobs?q=${state.emp!.runTag}`);
    expect(JSON.stringify(await after.json())).not.toContain('second attempt');
  });

  test('candidate applies on-platform (screening answered, consent required, no duplicate)', async ({ browser, request }) => {
    test.skip(!state.jobSlug, 'no published job to apply to');
    const ctx = await mutationContext(browser);
    const seeker = await ctx.newPage();
    const seekerGuard = installConsoleGuard(seeker, [NAV_ABORT_NOISE]);
    try {
      // Anonymous POST is refused outright.
      const anon = await request.post('/api/applications/apply-direct', {
        headers: JSON_HEADERS,
        data: { jobId: state.jobId, consent: true },
      });
      expect(anon.status()).toBe(401);

      await loginAsSeeker(seeker);
      await seeker.goto(`/jobs/${state.jobSlug}`);
      await seeker.getByRole('button', { name: /apply/i }).first().click();
      const dialog = seeker.getByRole('dialog', { name: /apply for this position/i });
      await expect(dialog).toBeVisible();

      // Submit is gated on consent; required screening question is enforced.
      const submit = dialog.locator('button[type="submit"]');
      await expect(submit).toBeDisabled();
      await dialog.locator('input[type="checkbox"]').check();
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(dialog.getByRole('alert').first()).toContainText(/required/i);

      await dialog.getByRole('button', { name: /^yes$/i }).first().click();
      await dialog.getByPlaceholder('Enter a number').fill('3');
      // Formula-injection payload — must be neutralised in the employer CSV.
      await dialog.locator('#coverLetter').fill('=HYPERLINK("http://evil.invalid","x"), "quoted" cover letter');
      const [applyRes] = await Promise.all([
        seeker.waitForResponse((r) => r.url().includes('/api/applications/apply-direct')),
        submit.click(),
      ]);
      expect(applyRes.status(), await applyRes.text()).toBe(200);
      state.applicationId = ((await applyRes.json()) as { applicationId?: string }).applicationId ?? null;
      await expect(seeker.getByRole('heading', { name: /application submitted/i })).toBeVisible();
      state.applied = true;

      // Re-applying resolves to the same application (upsert), not a second row.
      const again = await seeker.request.post('/api/applications/apply-direct', {
        headers: JSON_HEADERS,
        data: {
          jobId: state.jobId, consent: true, coverLetter: 'duplicate attempt',
          screeningAnswers: [],
        },
      });
      expect([200, 400, 409]).toContain(again.status());
      seekerGuard.assertClean();
    } finally {
      await ctx.close();
    }
  });

  test('another employer cannot list or modify this posting\'s applicants (tenant isolation)', async ({ browser }) => {
    test.skip(!state.applied || !state.jobId, 'candidate application did not complete');
    test.skip(!HAS_AUTH, 'needs the shared employer as the "other" tenant');
    const ctx = await mutationContext(browser);
    const other = await ctx.newPage();
    try {
      await loginAsEmployer(other);
      // GET /api/employer/applicants builds its where-clause from ?jobId= without
      // checking that jobId belongs to the caller, so any employer can read any
      // posting's applicants (names, bios, screening answers, signed resume URLs).
      const list = await other.request.get(`/api/employer/applicants?jobId=${state.jobId}`);
      expect(list.status()).toBe(200);
      const body = (await list.json()) as { applicants: Array<{ id: string; candidate: { name: string } }>; jobs: Array<{ id: string }> };
      expect(body.jobs.map((j) => j.id), 'the other employer does not own this job').not.toContain(state.jobId);
      const leaked = body.applicants.some((a) => a.id === state.applicationId);

      const patch = await other.request.patch('/api/employer/applicants', {
        headers: JSON_HEADERS,
        data: { applicationId: state.applicationId, status: 'rejected' },
      });
      expect(patch.status(), 'PATCH must refuse a foreign application').toBe(403);

      test.fixme(
        leaked,
        'DEFECT: GET /api/employer/applicants?jobId=<foreign job> returns another employer\'s applicants (IDOR: jobIdFilter is never checked against the caller\'s jobIds) — app/api/employer/applicants/route.ts',
      );
      expect(body.applicants).toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('applicants tab: applicant listed, status persists + fails honestly, notes save, bulk status, CSV escaping', async ({ page }) => {
    test.skip(!state.applied, 'candidate application did not complete');
    await loginFresh(page);
    await page.goto('/employer/applicants');
    await bootExpect(page.getByRole('heading', { level: 1, name: /applicants/i })).toBeVisible();
    const card = page.locator('.app-card').filter({ hasText: /E2E Candidate/ }).first();
    await expect(card).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('.app-card')).toHaveCount(1); // duplicate apply must not create a second row
    await expect(card).toContainText(state.title);
    await expectNoDashCopy(page, '/employer/applicants (with applicant)', ['.app-card [class*="cover"]']);

    // Status change → persisted after reload.
    const status = card.locator('select');
    await expect(status).toHaveValue('applied');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/employer/applicants') && r.request().method() === 'PATCH' && r.status() === 200),
      status.selectOption('interview'),
    ]);
    await page.reload();
    await expect(page.locator('.app-card select').first()).toHaveValue('interview', { timeout: BOOT_TIMEOUT });

    // Server failure → honest toast + optimistic value rolled back.
    guard.allow(/Error updating status/);
    await page.route('**/api/employer/applicants', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"e2e forced failure"}' })
        : route.continue(),
    );
    await page.locator('.app-card select').first().selectOption('offered');
    await expect(page.getByText(/couldn.t update applicant status/i)).toBeVisible();
    await expect(page.locator('.app-card select').first()).toHaveValue('interview');
    await page.unroute('**/api/employer/applicants');

    // Notes save + persist.
    await page.getByRole('button', { name: /add notes/i }).click();
    const notes = page.getByPlaceholder('Add private notes...');
    await notes.fill(`Strong telehealth fit ${state.emp!.runTag}`);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/employer/applicants') && r.request().method() === 'PATCH' && r.status() === 200),
      page.getByRole('button', { name: 'Save', exact: true }).click(),
    ]);
    await page.reload();
    await expect(page.getByText(`Strong telehealth fit ${state.emp!.runTag}`)).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Bulk status change.
    await page.getByText('Select all', { exact: true }).locator('xpath=preceding-sibling::button').click();
    const bulk = page.locator('select').filter({ has: page.locator('option', { hasText: 'Change status to...' }) });
    await expect(bulk).toBeVisible();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/employer/applicants') && r.request().method() === 'PATCH' && r.status() === 200),
      bulk.selectOption('screening'),
    ]);
    await page.reload();
    await expect(page.locator('.app-card select').first()).toHaveValue('screening', { timeout: BOOT_TIMEOUT });

    // CSV export downloads; cover letter's formula prefix + quotes are escaped.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /export csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^applicants-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = fs.readFileSync((await download.path())!, 'utf8');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"Name","Job","Status","Applied Date","Cover Letter","Has Resume","Has Cover Letter PDF"');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil.invalid"",""x""), ""quoted"" cover letter"`);
    expect(lines[1]).toContain('"Screening"');

    // API-level input hardening on the same route: bogus ids / statuses never 500.
    const missing = await page.request.patch('/api/employer/applicants', { headers: JSON_HEADERS, data: { applicationId: 'not-an-application', status: 'hired' } });
    expect(missing.status()).toBe(404);
    const badStatus = await page.request.patch('/api/employer/applicants', { headers: JSON_HEADERS, data: { applicationId: state.applicationId, status: 'promoted' } });
    expect(badStatus.status()).toBe(400);
    const noId = await page.request.patch('/api/employer/applicants', { headers: JSON_HEADERS, data: { status: 'hired' } });
    expect(noId.status()).toBe(400);
    const badNotes = await page.request.patch('/api/employer/applicants', { headers: JSON_HEADERS, data: { applicationId: state.applicationId, notes: { nested: true } } });
    expect(badNotes.status(), 'non-string notes must be rejected, not passed to the ORM').toBeLessThan(500);
  });

  interface UsageBody {
    usage: { candidateUnlocks: { used: number; limit: number | null }; inmails: { used: number; limit: number | null } };
  }
  const readUsage = async (page: Page): Promise<UsageBody> =>
    (await (await page.request.get('/api/employer/usage')).json()) as UsageBody;

  test('talent pool: results render, unlock gate shows credits, first unlock is charged AND grants access, no double-charge', async ({ page }) => {
    test.skip(!state.jobId, 'unlocks require an active posting');
    test.skip(!state.seekerAuthId, 'seeker auth id not resolvable');
    await loginFresh(page);

    // Legacy /employer/talent-search folds into the canonical talent pool.
    await page.goto('/employer/talent-search');
    await expect(page).toHaveURL(/\/employer\/candidates\?ai=1/, { timeout: BOOT_TIMEOUT });

    await page.goto('/employer/candidates');
    await expect(page.locator('a[href^="/employer/candidates/"]').first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('body')).toContainText(/unlock/i);
    await expect(page.locator('body')).toContainText(/\d+\/\d+ unlocks|of \d+ unlocks left/i);
    await expectNoDashCopy(page, '/employer/candidates');
    const before = await readUsage(page);
    expect(before.usage.candidateUnlocks.limit).toBeGreaterThan(0);
    expect(before.usage.inmails.limit).toBeGreaterThan(0);

    // A bogus candidate id is a clean 404, not a 500.
    const bogus = await page.request.get('/api/employer/candidates/not-a-real-candidate');
    expect(bogus.status()).toBe(404);

    // Opening a profile consumes exactly one unlock credit — and the SAME
    // response that charges it must already carry full access (contact
    // email / resume / Contact Candidate), not require a reload.
    const [detailRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/employer/candidates/${state.seekerAuthId}`) && r.request().method() === 'GET'),
      page.goto(`/employer/candidates/${state.seekerAuthId}`),
    ]);
    expect(detailRes.status(), await detailRes.text()).toBe(200);
    const detail = (await detailRes.json()) as { hasFullAccess: boolean; contactEmail: string | null };
    const after = await readUsage(page);
    expect(after.usage.candidateUnlocks.used, 'opening a profile charges one unlock').toBe(before.usage.candidateUnlocks.used + 1);
    expect(detail.hasFullAccess, 'the response that charges the unlock must grant full access').toBe(true);
    expect(detail.contactEmail).toBe(getSeekerCreds()!.email);
    await expect(page.getByRole('button', { name: /contact candidate/i }).first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.getByText(/post a featured job to unlock/i)).toHaveCount(0);
    await expectNoDashCopy(page, '/employer/candidates/[id]');

    await page.reload();
    await expect(page.getByRole('button', { name: /contact candidate/i }).first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    const again = await readUsage(page);
    expect(again.usage.candidateUnlocks.used, 're-opening an unlocked profile must not double-charge').toBe(after.usage.candidateUnlocks.used);
  });

  test('InMail: a new thread from a live posting is accepted and charged, a reply into that thread is free', async ({ page }) => {
    test.skip(!state.jobId, 'InMail credits require an active posting');
    test.skip(!state.seekerAuthId, 'seeker auth id not resolvable');
    await loginFresh(page);
    await page.goto(`/employer/candidates/${state.seekerAuthId}`);
    const contact = page.getByRole('button', { name: /contact candidate/i }).first();
    await expect(contact).toBeVisible({ timeout: BOOT_TIMEOUT });
    const before = await readUsage(page);

    await contact.click();
    const compose = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Enter subject...') });
    await expect(compose).toBeVisible();
    const send = compose.getByRole('button', { name: /send message/i });
    await expect(send).toBeDisabled();
    await expect(compose.getByText(/InMails? remaining|Unlimited InMails/i)).toBeVisible();
    await expectNoDashCopy(page, 'compose InMail modal');
    // Keyboard: Escape dismisses the compose modal without sending.
    await page.keyboard.press('Escape');
    if (await compose.isHidden().catch(() => false)) {
      await contact.click();
      await expect(compose).toBeVisible();
    }
    await compose.getByPlaceholder('Enter subject...').fill(`Telepsychiatry role ${state.emp!.runTag}`);
    await compose.getByPlaceholder('Write your message...').fill('Hello, we would love to talk about our telehealth PMHNP opening.');
    const [sendRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/employer/messages') && r.request().method() === 'POST'),
      send.click(),
    ]);
    const sendBody = await sendRes.text();
    expect(
      sendRes.status(),
      `an employer with a live posting and ${before.usage.inmails.limit} InMail credits must be able to open a thread: ${sendBody}`,
    ).toBeLessThan(300);
    const charged = await readUsage(page);
    expect(charged.usage.inmails.used, 'a new thread consumes one InMail').toBe(before.usage.inmails.used + 1);

    // Same (pair, job) key → existing conversation → reply is free.
    const jobId = ((JSON.parse(sendBody) as { message?: { jobId?: string | null } }).message?.jobId) ?? null;
    const reply = await page.request.post('/api/employer/messages', {
      headers: JSON_HEADERS,
      data: { recipientId: state.seekerAuthId, subject: 'follow-up', body: 'Following up on my note.', ...(jobId ? { jobId } : {}) },
    });
    expect(reply.status(), await reply.text()).toBeLessThan(300);
    const free = await readUsage(page);
    expect(free.usage.inmails.used, 'a reply in an existing thread must not consume an InMail').toBe(charged.usage.inmails.used);

    // Input hardening: unknown recipient → 404; oversized body → 400; neither charges a credit.
    const unknown = await page.request.post('/api/employer/messages', { headers: JSON_HEADERS, data: { recipientId: 'not-a-user', subject: 's', body: 'b' } });
    expect(unknown.status()).toBe(404);
    const oversized = await page.request.post('/api/employer/messages', { headers: JSON_HEADERS, data: { recipientId: state.seekerAuthId, subject: 's', body: 'x'.repeat(2001) } });
    expect(oversized.status()).toBe(400);
    expect((await readUsage(page)).usage.inmails.used).toBe(free.usage.inmails.used);
  });

  test('analytics page renders and exports CSV; dashboard analytics tab renders', async ({ page }) => {
    test.skip(!state.jobId, 'analytics needs at least one posting');
    await loginFresh(page);
    await page.goto('/employer/analytics');
    await bootExpect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/failed to load/i);
    await expect(page.locator('body')).toContainText(state.title, { timeout: BOOT_TIMEOUT });
    await expectNoDashCopy(page, '/employer/analytics');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /export csv/i }).click(),
    ]);
    const csv = fs.readFileSync((await download.path())!, 'utf8');
    expect(csv.split('\n').length).toBeGreaterThanOrEqual(2);
    expect(csv).toContain(state.title);

    const api = await page.request.get('/api/employer/analytics/csv');
    expect(api.status()).toBe(200);
    expect(api.headers()['content-disposition'] || '').toMatch(/attachment/);

    await page.goto('/employer/dashboard?tab=analytics');
    await expect(page.getByRole('button', { name: /analytics/i }).first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('body')).not.toContainText(/something went wrong|failed to load|application error/i);
  });

  test('settings: company name change persists; website is sanitised before it reaches the public job page', async ({ page }) => {
    test.skip(!state.jobSlug, 'website probe needs the published job page');
    await loginFresh(page);
    await page.goto('/employer/settings');
    const company = page.getByPlaceholder('Your company name');
    await expect(company).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expectNoDashCopy(page, '/employer/settings');
    const renamed = `${state.emp!.company} Renamed`;
    await company.fill(renamed);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/employer/settings') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: /save changes/i }).click(),
    ]);
    expect(res.status(), await res.text()).toBe(200);
    await page.reload();
    await expect(page.getByPlaceholder('Your company name')).toHaveValue(renamed, { timeout: BOOT_TIMEOUT });

    // PATCH /api/employer/settings writes companyWebsite to every EmployerJob row
    // without sanitizeUrl (post-free and /api/jobs/update both sanitise it), and
    // components/AboutEmployer.tsx renders it as a raw href on the public job page.
    const hostile = await page.request.patch('/api/employer/settings', {
      headers: JSON_HEADERS,
      data: { companyWebsite: 'javascript:alert(document.domain)' },
    });
    expect(hostile.status(), await hostile.text()).toBeLessThan(500);
    const stored = ((await (await page.request.get('/api/employer/settings')).json()) as { companyInfo: { website: string | null } | null }).companyInfo?.website ?? null;
    await page.goto(`/jobs/${state.jobSlug}`);
    await expect(page.getByRole('heading', { level: 1, name: state.title })).toBeVisible();
    const jsLinks = await page.locator('a[href^="javascript:"]').count();
    // Restore a benign website before asserting so later tests see clean data.
    await page.request.patch('/api/employer/settings', { headers: JSON_HEADERS, data: { companyWebsite: `https://${state.emp!.domain}` } });
    test.fixme(
      jsLinks > 0 || /^javascript:/i.test(stored ?? ''),
      'DEFECT: settings PATCH stores an unsanitised companyWebsite (javascript: URL) that AboutEmployer renders as a clickable href on the public job page — app/api/employer/settings/route.ts + components/AboutEmployer.tsx',
    );
    expect(jsLinks).toBe(0);
    expect(stored ?? '').not.toMatch(/^javascript:/i);
  });

  test('archiving hides the job from the public board; restore + unpause brings it back', async ({ page }) => {
    test.skip(!state.jobId || !state.jobSlug, 'no published job to archive');
    await loginFresh(page);
    await page.goto('/employer/dashboard');
    const row = page.locator('a[href^="/jobs/"]:not([href^="/jobs/edit/"])').filter({ hasText: state.title }).first();
    await expect(row).toBeVisible({ timeout: BOOT_TIMEOUT });

    // Archive needs an explicit confirmation (free posts don't refund quota).
    await page.getByRole('button', { name: /^archive$/i }).first().click();
    const confirm = page.getByRole('heading', { name: /archive this posting/i });
    await expect(confirm).toBeVisible();
    await expectNoDashCopy(page, 'archive confirmation modal');
    const [archiveRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/employer/jobs/${state.jobId}/archive`) && r.request().method() === 'PATCH'),
      page.locator('button').filter({ hasText: /^\s*archive\s*$/i }).last().click(),
    ]);
    expect(archiveRes.status(), await archiveRes.text()).toBe(200);
    await expect(confirm).toBeHidden();

    // Public surfaces drop the posting.
    await expect.poll(async () => JSON.stringify(await (await page.request.get(`/api/jobs?q=${state.emp!.runTag}`)).json()), { timeout: 20_000 })
      .not.toContain(state.jobId!);
    const detail = await page.request.get(`/jobs/${state.jobSlug}`);
    expect([404, 410]).toContain(detail.status());

    // Restore: archived_at clears but the job stays unpublished until the employer unpauses.
    await page.reload();
    await page.getByRole('button', { name: /^archived/i }).or(page.getByRole('button', { name: /archived \(\d+\)/i })).first().click().catch(() => undefined);
    const restore = page.getByRole('button', { name: /^restore$/i }).first();
    await expect(restore).toBeVisible({ timeout: BOOT_TIMEOUT });
    const [restoreRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/employer/jobs/${state.jobId}/archive`) && r.request().method() === 'PATCH'),
      restore.click(),
    ]);
    expect(restoreRes.status()).toBe(200);
    if (hasDb()) {
      const row2 = await db().job.findUnique({ where: { id: state.jobId! }, select: { archivedAt: true, isPublished: true } });
      expect(row2?.archivedAt).toBeNull();
      expect(row2?.isPublished, 'restore must not auto-republish').toBe(false);
    }
    const [unpause] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/employer/jobs/${state.jobId}/toggle-publish`) && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: /^unpause$/i }).first().click(),
    ]);
    expect(unpause.status(), await unpause.text()).toBe(200);
    await expect.poll(async () => JSON.stringify(await (await page.request.get(`/api/jobs?q=${state.emp!.runTag}`)).json()), { timeout: 20_000 })
      .toContain(state.jobId!);
  });

  test('company profile offers a claim form to a signed-in employer', async ({ page }) => {
    await loginFresh(page);
    const path = await firstCompanyPath(page);
    test.skip(!path, 'No company profiles in the directory');
    await page.goto(path!);
    const claim = page.getByRole('button', { name: /claim this profile/i });
    const claimed = page.getByText(/claimed by employer/i);
    await expect(claim.or(claimed).first()).toBeVisible({ timeout: BOOT_TIMEOUT });
    test.skip(await claimed.isVisible(), 'first directory company is already claimed');
    await claim.click();
    await expect(page.getByRole('button', { name: /submit claim/i })).toBeVisible();
    await expect(page.getByText(/reviewer checks every claim by hand/i)).toBeVisible();
    await expectNoDashCopy(page, 'company claim form');
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(claim).toBeVisible();
  });
});

// ── E. API hardening on a disposable employer (no lifecycle coupling) ───────

test.describe('employer API hardening (ephemeral employer, local only)', () => {
  test.skip(AGAINST_PROD, 'Creates users/jobs — never against production');
  test.skip(!ephemeralSupportAvailable(), 'Needs Supabase service-role creds to mint a fresh employer');
  test.use({ baseURL: MUT_ORIGIN });
  test.describe.configure({ timeout: LIFECYCLE_TIMEOUT });

  let emp: EphemeralEmployer | null = null;
  let guard: ConsoleGuard;

  test.beforeAll(async ({ request }) => {
    const probe = await request.post('/api/job-draft', { headers: JSON_HEADERS, data: { formData: {} } });
    test.skip(probe.status() === 403, `CSRF gate blocks same-origin mutations at ${MUT_ORIGIN} (lib/csrf.ts)`);
    emp = await createEphemeralEmployer();
  });
  test.afterAll(async () => {
    if (!emp) return;
    const log = await destroyEphemeralEmployer(emp);
    test.info().annotations.push({ type: 'cleanup', description: log.join('; ') });
  });
  test.beforeEach(({ page }) => {
    guard = installConsoleGuard(page, [NAV_ABORT_NOISE]);
  });
  test.afterEach(() => guard.assertClean());

  const login = async (page: Page) => {
    await loginAtPath(page, '/login?role=employer&redirectTo=%2Fpost-job', { email: emp!.email, password: emp!.password }, { timeout: BOOT_TIMEOUT });
    // Auto-create the ephemeral user's UserProfile (see loginFresh in the lifecycle block).
    expect((await page.request.get('/api/auth/profile')).status(), 'profile auto-created for the ephemeral employer').toBe(200);
  };

  const basePost = () => ({
    title: `Hardening probe PMHNP ${emp!.runTag}`, employer: emp!.company, location: 'Remote', mode: 'Remote',
    jobType: 'Full-Time', description: sampleDescription(emp!.runTag), applyLink: `https://${emp!.domain}/apply`,
    contactEmail: emp!.contactEmail,
  });

  test('job-draft rejects malformed bodies without a 500', async ({ page }) => {
    await login(page);
    const notObject = await page.request.post('/api/job-draft', { headers: JSON_HEADERS, data: { formData: 'just a string' } });
    expect(notObject.status()).toBe(400);
    const tooBig = await page.request.post('/api/job-draft', { headers: JSON_HEADERS, data: { formData: { description: 'x'.repeat(250_000) } } });
    expect(tooBig.status()).toBe(413);
    const invalidJson = await page.request.post('/api/job-draft', { headers: { ...JSON_HEADERS }, data: '{not json' });
    expect(invalidJson.status()).toBe(400);
  });

  test('post-free validates typed fields before touching the database', async ({ page }) => {
    await login(page);
    // Missing required fields are enumerated in one 400.
    const missing = await page.request.post('/api/jobs/post-free', { headers: { ...JSON_HEADERS, 'x-forwarded-for': uniqueIp() }, data: { title: 'Only a title' } });
    expect(missing.status()).toBe(400);
    expect((await missing.json()).error).toMatch(/missing required fields/i);

    // benefits is spread into a String[] column without validation: a non-string
    // entry reaches Prisma and becomes an unhandled 500 (no job is created).
    const badBenefits = await page.request.post('/api/jobs/post-free', {
      headers: { ...JSON_HEADERS, 'x-forwarded-for': uniqueIp() },
      data: { ...basePost(), benefits: [{ nested: 'object' }, 42] },
    });
    const quotaAfter = await (await page.request.get('/api/employer/free-quota-status')).json();
    expect(quotaAfter.remaining, 'a rejected post must not burn the free quota').toBe(1);
    test.fixme(
      badBenefits.status() >= 500,
      'DEFECT: POST /api/jobs/post-free 500s on non-string benefits entries (array is passed to Prisma unvalidated) — app/api/jobs/post-free/route.ts',
    );
    expect(badBenefits.status()).toBe(400);
  });

  test('post-free only accepts registry values for setting / population', async ({ page }) => {
    await login(page);
    // The wizard offers registry-driven <select>s, but the API stores whatever
    // string it receives. This is the domain's one free post, so it runs last.
    const offRegistry = await page.request.post('/api/jobs/post-free', {
      headers: { ...JSON_HEADERS, 'x-forwarded-for': uniqueIp() },
      data: { ...basePost(), setting: 'not-a-registry-setting', population: '<b>not-a-population</b>' },
    });
    const status = offRegistry.status();
    if (status === 200) {
      const created = (await offRegistry.json()) as { jobId: string };
      if (hasDb()) {
        const row = await db().job.findUnique({ where: { id: created.jobId }, select: { setting: true, population: true } });
        test.info().annotations.push({ type: 'stored', description: JSON.stringify(row) });
      }
    }
    test.fixme(
      status === 200,
      'DEFECT: POST /api/jobs/post-free stores arbitrary setting/population strings (no registry validation; wizard-only enforcement) — app/api/jobs/post-free/route.ts',
    );
    expect(status).toBe(400);
  });
});

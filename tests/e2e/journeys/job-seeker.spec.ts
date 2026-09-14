import { test as base, expect, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { brand } from '../../../config/brand';
import {
  getSeekerCreds,
  loginAsSeeker,
  loginAtPath,
  uniqueEmail,
  TEST_PASSWORD,
  fillNameFields,
  clickSubmit,
} from '../fixtures/auth';
import { installConsoleGuard, type ConsoleGuard } from '../helpers/console-guard';
import { hasDb, closeDb, db } from '../helpers/db';
import { activeElementDescription, assertFocusTrapped, assertNoHorizontalOverflow, focusIsInside, MOBILE_VIEWPORT } from '../helpers/a11y';
import {
  BASE_URL,
  MUT_ORIGIN,
  SEEDS,
  uniqueIp,
  resolveSeekerId,
  resetSeekerState,
  clearSeekerResume,
  canDeleteAuthUsers,
  deleteAuthUserByEmail,
  fetchScreeningQuestions,
  applyViaApi,
  saveJobViaApi,
  savedJobIds,
  applicationsViaApi,
  applyDialog,
  easyApplyButton,
  openApplyModal,
  confirmDialog,
  signOutViaMenu,
  resumeFixtureFile,
} from '../helpers/candidate';

/**
 * Candidate account lifecycle (journey: candidate-account).
 *
 * Read-only tests run unconditionally. Auth-gated tests skip when
 * E2E_SEEKER_EMAIL / E2E_SEEKER_PASS are missing. Mutation tests skip against
 * production (PLAYWRIGHT_BASE_URL contains brand.domain).
 *
 * Stateful blocks run on MUT_ORIGIN (see helpers/candidate.ts) because the
 * CSRF gate rejects mutations from a 127.0.0.1 origin under `next start`.
 * Every test that creates data resets the seeded candidate's rows first
 * (Prisma) so runs are idempotent.
 */

const SEEKER_CREDS = getSeekerCreds();
const HAS_AUTH = SEEKER_CREDS !== null;
const AGAINST_PROD = BASE_URL.includes(brand.domain);
const CAN_MUTATE = HAS_AUTH && !AGAINST_PROD;
const CAN_RESET = CAN_MUTATE && hasDb();
const RESUME_PATH = path.resolve(process.cwd(), process.env.E2E_TEST_RESUME_PATH || 'tests/e2e/fixtures/sample-resume.pdf');
const TXT_FIXTURE = path.resolve(process.cwd(), 'tests/e2e/fixtures/sample-resume.txt');

// Every page in this file is console/pageerror guarded; teardown fails the
// test on anything unexpected (console-guard.ts lists the ignored noise).
const test = base.extend<{ guard: ConsoleGuard }>({
  guard: async ({ page }, provide) => {
    const guard = installConsoleGuard(page, [
      // supabase-js logs its in-flight getUser() as "TypeError: Failed to
      // fetch" when a test navigates away from the post-login /dashboard
      // before the auth probe settles (the request is aborted, not failed).
      /TypeError: Failed to fetch[\s\S]*(_getUser|_useSession)/,
    ]);
    // Diagnostics the console alone does not give: which same-origin /
    // Supabase request failed at the network level, and any 5xx response.
    const own = (url: string) => url.startsWith(MUT_ORIGIN) || url.startsWith(BASE_URL) || /supabase\.co/.test(url);
    page.on('requestfailed', (req) => {
      const reason = req.failure()?.errorText ?? 'unknown';
      // Navigations cancel in-flight RSC prefetches (ERR_ABORTED) — not a defect.
      if (/ERR_ABORTED/i.test(reason)) return;
      if (own(req.url())) guard.errors.push(`[requestfailed] ${req.method()} ${req.url()} → ${reason}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 500 && own(res.url())) guard.errors.push(`[5xx] ${res.request().method()} ${res.url()} → ${res.status()}`);
    });
    await provide(guard);
    guard.assertClean();
  },
});

// The fleet shares one `next start` server; multi-step account flows need
// more than the 60s default when several journeys run at once.
test.describe.configure({ timeout: 150_000 });

test.afterAll(async () => {
  await closeDb();
});

/** Visible app alert — Next's route announcer is also role="alert". */
function alertBox(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)').first();
}

/** Navigate to a job detail and wait for ApplyButton's client-side auth probe. */
async function gotoJob(page: Page, path: string): Promise<void> {
  const probe = page.waitForResponse((r) => r.url().includes('/api/auth/me'), { timeout: 45_000 });
  await page.goto(path);
  await probe;
}

/** Navigate to a job detail and wait until useSavedJobs has synced with the server. */
async function gotoJobSynced(page: Page, path: string): Promise<void> {
  const sync = page.waitForResponse(
    (r) => r.url().includes('/api/saved-jobs') && r.request().method() === 'GET',
    { timeout: 45_000 },
  );
  await page.goto(path);
  const res = await sync;
  expect(res.status(), 'GET /api/saved-jobs during page load').toBe(200);
}

/** Navigate to the dashboard and wait for its data load (slow under load). */
async function gotoDashboard(page: Page): Promise<void> {
  const data = page.waitForResponse((r) => r.url().includes('/api/dashboard'), { timeout: 45_000 });
  await page.goto('/dashboard');
  await data;
  await expect(page.locator('h1').first()).toContainText(/good (morning|afternoon|evening)/i);
}

async function resetState(): Promise<void> {
  if (CAN_RESET && SEEKER_CREDS) await resetSeekerState(SEEKER_CREDS.email);
}

// ── Read-only tests (always run) ────────────────────────────────────────────

test('seeker: can browse jobs without logging in', async ({ page, guard }) => {
  void guard;
  await page.goto('/jobs');
  await expect(page).toHaveURL(/\/jobs/);
  await expect(page.locator('body')).toContainText(/job|position|opening/i);
});

test('seeker: can filter jobs by remote', async ({ page, guard }) => {
  void guard;
  await page.goto('/jobs/remote');
  await expect(page.locator('h1').first()).toContainText(/remote/i);
});

test('seeker: can navigate from listings to a job detail', async ({ page, guard }) => {
  void guard;
  const jobUrl = await pickFirstJob(page);
  if (!jobUrl) {
    test.skip(true, 'No job-detail links visible on /jobs');
    return;
  }
  await page.goto(jobUrl);
  await expect(page.locator('h1').first()).toBeVisible();
});

test('seeker: signup form rejects empty submission (native required fields)', async ({ page, guard }) => {
  void guard;
  await page.goto('/signup');
  await page.locator('button[type="submit"]').first().click();
  // Native constraint validation blocks the submit: required inputs are :invalid
  // and the URL never leaves /signup.
  const invalid = await page.locator('form input:invalid').count();
  expect(invalid).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/signup/);
});

test('seeker: login page renders auth form', async ({ page, guard }) => {
  void guard;
  await page.goto('/login');
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});

test('seeker: login with an unknown account shows an error and stays on /login', async ({ page, guard }) => {
  void guard;
  await page.goto('/login');
  await page.locator('input[type="email"]').first().fill('definitely-not-a-real-user@example.invalid');
  await page.locator('input[type="password"]').first().fill('wrong-password-123');
  await page.locator('button[type="submit"]').first().click();
  await expect(alertBox(page)).toContainText(/invalid|incorrect|not confirmed/i);
  await expect(page).toHaveURL(/\/login/);
});

// ── Signup (mutation, local only) ───────────────────────────────────────────

test.describe('signup', () => {
  test.skip(AGAINST_PROD, 'Mutation tests pollute data — local/staging only');
  test.use({ baseURL: MUT_ORIGIN });

  test('client-side validation: password mismatch, short password, employer free-mail', async ({ page, guard }) => {
    void guard;
    await page.goto('/signup');
    await fillNameFields(page, 'E2eSeeker', 'Validation');
    await page.locator('#signup-email').fill(uniqueEmail('seeker'));

    // Mismatch is caught before any network call.
    await page.locator('#signup-password').fill(TEST_PASSWORD);
    await page.locator('#signup-confirmPassword').fill(`${TEST_PASSWORD}x`);
    await clickSubmit(page);
    await expect(alertBox(page)).toContainText(/passwords do not match/i);
    await expect(page).toHaveURL(/\/signup/);

    // Short password is blocked by minLength=8 (native validity).
    await page.locator('#signup-password').fill('short');
    await page.locator('#signup-confirmPassword').fill('short');
    const pwValid = await page.locator('#signup-password').evaluate((el) => (el as HTMLInputElement).checkValidity());
    expect(pwValid, 'password minLength=8 should be enforced natively').toBe(false);

    // Employer role rejects free-mail domains client-side.
    await page.getByRole('button', { name: /^employer$/i }).click();
    await page.locator('#signup-company').fill('E2E Clinic');
    await page.locator('#signup-email').fill('someone@gmail.com');
    await page.locator('#signup-password').fill(TEST_PASSWORD);
    await page.locator('#signup-confirmPassword').fill(TEST_PASSWORD);
    await clickSubmit(page);
    await expect(alertBox(page)).toContainText(/company email/i);
    await expect(page).toHaveURL(/\/signup/);
  });

  test('fresh seeker signup reaches the "check your email" state', async ({ page, guard }) => {
    void guard;
    const email = uniqueEmail('seeker');
    try {
      await page.goto('/signup');
      await fillNameFields(page, 'E2eSeeker', 'TestUser');
      await page.locator('#signup-email').fill(email);
      await page.locator('#signup-password').fill(TEST_PASSWORD);
      await page.locator('#signup-confirmPassword').fill(TEST_PASSWORD);
      await clickSubmit(page);

      const checkEmail = page.getByRole('heading', { name: /check your email/i });
      const alert = alertBox(page);
      await expect(checkEmail.or(alert).first()).toBeVisible({ timeout: 20_000 });

      if (await alert.isVisible().catch(() => false)) {
        const text = await alert.innerText();
        // Supabase's built-in mailer throttles signups per hour; that is an
        // environment limit, not a product defect — skip rather than fail.
        test.skip(/rate limit|too many|seconds/i.test(text), `Supabase signup throttled: ${text}`);
        // The dev Supabase project rejects the fixture domain outright; the
        // stubbed test below covers the UI state deterministically.
        test.skip(/email address .* is invalid/i.test(text), `Supabase rejects the fixture email domain: ${text}`);
        throw new Error(`signup surfaced an error: ${text}`);
      }
      await expect(checkEmail).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
      await expect(page.getByRole('button', { name: /resend/i })).toBeVisible();
      await expect(page.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', /\/login/);
    } finally {
      if (canDeleteAuthUsers()) await deleteAuthUserByEmail(email);
    }
  });

  test('signup success state (Supabase signup stubbed): check-your-email, resend cooldown, login link', async ({ page, guard }) => {
    void guard;
    const email = `e2e-stub-${Date.now().toString(36)}@example.invalid`;
    let signupBody: Record<string, unknown> | null = null;
    // Confirm-required project: Supabase answers a signup with the user and no session.
    await page.route(/\/auth\/v1\/signup/, async (route) => {
      signupBody = route.request().postDataJSON() as Record<string, unknown>;
      const now = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-000000000e2e', aud: 'authenticated', role: '', email,
          email_confirmed_at: null, confirmation_sent_at: now, created_at: now, updated_at: now,
          app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
          identities: [{ id: 'x', user_id: 'x', provider: 'email', identity_data: { email }, created_at: now, updated_at: now }],
        }),
      });
    });
    await page.route(/\/api\/auth\/welcome/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"sent":false}' }));

    await page.goto('/signup');
    await fillNameFields(page, 'E2eSeeker', 'Stub');
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-password').fill(TEST_PASSWORD);
    await page.locator('#signup-confirmPassword').fill(TEST_PASSWORD);
    // Double-submit: the button disables while the request is in flight.
    await page.locator('button[type="submit"]').first().dblclick();

    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(email)).toBeVisible();
    expect(signupBody, 'signup request reached Supabase').not.toBeNull();
    const meta = (signupBody as unknown as { data?: Record<string, unknown> }).data ?? {};
    expect(meta.role).toBe('job_seeker');
    expect(meta.first_name).toBe('E2eSeeker');
    await expect(page.getByRole('link', { name: /go to login/i })).toHaveAttribute('href', /\/login/);
    await expect(page.getByRole('button', { name: /resend/i })).toBeVisible();
    // No session was created, so the visitor is still anonymous.
    expect((await (await page.request.get('/api/auth/me')).json()).id).toBeNull();
  });
});

// ── Login ───────────────────────────────────────────────────────────────────

test.describe('login', () => {
  test.skip(!HAS_AUTH, 'E2E_SEEKER_EMAIL / E2E_SEEKER_PASS not set');
  test.use({ baseURL: MUT_ORIGIN });

  test('wrong password shows the Supabase error, leaves no session; then succeeds', async ({ page, guard }) => {
    void guard;
    await page.goto('/login');
    await page.locator('#login-email').fill(SEEKER_CREDS!.email);
    await page.locator('#login-password').fill('definitely-wrong-password-1!');
    await page.locator('button[type="submit"]').click();
    await expect(alertBox(page)).toContainText(/invalid login credentials/i);
    await expect(page).toHaveURL(/\/login/);
    const me = await (await page.request.get('/api/auth/me')).json();
    expect(me.id, 'no session after a failed login').toBeNull();

    await page.locator('#login-password').fill(SEEKER_CREDS!.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/dashboard/);
    const meAfter = await (await page.request.get('/api/auth/me')).json();
    expect(meAfter.role).toBe('job_seeker');

    // Already-authenticated visitors are bounced off the auth pages.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/signup');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('?redirectTo= is honoured after sign-in', async ({ page, guard }) => {
    void guard;
    await loginAtPath(page, '/login?redirectTo=%2Fsaved', SEEKER_CREDS!);
    await expect(page).toHaveURL(/\/saved/);
  });
});

// ── Onboarding interstitial + dashboard ─────────────────────────────────────

test.describe('onboarding and dashboard', () => {
  test.skip(!CAN_MUTATE, 'Needs seeker creds and a non-production target');
  test.use({ baseURL: MUT_ORIGIN });

  // The interstitial only renders for a non-searchable profile. The shared
  // candidate is usually searchable, so snapshot the embedder fields, blank
  // them for the test, and restore them afterwards (Prisma, dev DB only).
  const SEARCHABLE_FIELDS = {
    headline: true, yearsExperience: true, certifications: true, licenseStates: true,
    specialties: true, skills: true, bio: true,
  } as const;
  let snapshot: Record<string, unknown> | null = null;

  test.beforeEach(async () => {
    test.skip(!CAN_RESET, 'Needs DATABASE_URL to blank and restore the candidate profile');
    await resetState();
    const id = await resolveSeekerId(SEEKER_CREDS!.email);
    test.skip(!id, 'Seeded candidate supabaseId not resolvable');
    snapshot = await db().userProfile.findUnique({ where: { supabaseId: id! }, select: SEARCHABLE_FIELDS });
    await db().userProfile.update({
      where: { supabaseId: id! },
      data: { headline: null, yearsExperience: null, certifications: null, licenseStates: null, specialties: null, skills: [], bio: null },
    });
  });

  test.afterEach(async () => {
    const id = CAN_RESET ? await resolveSeekerId(SEEKER_CREDS!.email) : null;
    if (id && snapshot) await db().userProfile.update({ where: { supabaseId: id }, data: snapshot as never });
    snapshot = null;
  });

  test('interstitial is skippable; dashboard shows completeness meter, stats and empty states', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await page.goto('/onboarding/professional');
    await expect(page, 'a blanked profile must see the interstitial').toHaveURL(/\/onboarding\/professional/);
    const save = page.getByRole('button', { name: /save and continue/i });
    await expect(save).toBeDisabled();
    await expect(page.getByText(/at least a headline and one specialty/i)).toBeVisible();
    await page.locator('#headline').fill('PMHNP-BC | E2E headline');
    await expect(save, 'headline alone is not enough').toBeDisabled();

    const data = page.waitForResponse((r) => r.url().includes('/api/dashboard'), { timeout: 45_000 });
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.waitForURL(/\/dashboard/);
    await data;
    await expect(page.locator('h1').first()).toContainText(/good (morning|afternoon|evening)/i);
    await expect(page.getByText(/^\d{1,3}%$/).first()).toBeVisible();
    await expect(page.getByText(/jobs saved/i).first()).toBeVisible();
    await expect(page.getByText(/applications sent/i).first()).toBeVisible();
    await expect(page.getByText(/active alerts?/i).first()).toBeVisible();
    await expect(page.getByText(/no applications yet/i)).toBeVisible();
    await expect(page.getByText(/^no saved jobs$/i)).toBeVisible();
    // The alerts stat card deep-links to alert management.
    await expect(page.locator('a[href="/job-alerts/manage"]').first()).toBeVisible();
  });

  test('interstitial save persists headline/specialty and stops re-prompting', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await page.goto('/onboarding/professional');
    await expect(page, 'a blanked profile must see the interstitial').toHaveURL(/\/onboarding\/professional/);
    {
      await page.locator('#headline').fill('PMHNP-BC | E2E telehealth');
      await page.locator('#bio').fill('E2E bio: adult and adolescent psychiatry, telehealth and outpatient settings.');
      const chip = page.locator('button').filter({ hasText: /telehealth|adult|child|adolescent|addiction/i }).first();
      await chip.click();
      const save = page.getByRole('button', { name: /save and continue/i });
      await expect(save).toBeEnabled();
      await save.click();
      await page.waitForURL(/\/dashboard/);

      const profile = await (await page.request.get('/api/auth/profile')).json();
      expect(profile.headline).toBe('PMHNP-BC | E2E telehealth');
      expect(profile.specialties).toBeTruthy();

      // A now-searchable profile is not re-prompted.
      await page.goto('/onboarding/professional');
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });
});

// ── Saved jobs ──────────────────────────────────────────────────────────────

test.describe('saved jobs', () => {
  test.skip(!CAN_MUTATE, 'Needs seeker creds and a non-production target');
  test.skip(!SEEDS.employerJobSlug || !SEEDS.employerJobId, 'E2E_TEST_JOB_SLUG / E2E_TEST_JOB_ID not set');
  test.use({ baseURL: MUT_ORIGIN });

  test.beforeEach(async () => {
    await resetState();
  });

  test('hard load of /saved with a saved job in localStorage hydrates without a React error', async ({ page, guard }) => {
    await loginAsSeeker(page);
    await gotoJobSynced(page, `/jobs/${SEEDS.employerJobSlug}`);
    await page.getByRole('button', { name: /^save job$/i }).first().click();
    await expect.poll(() => savedJobIds(page)).toContain(SEEDS.employerJobId);
    await page.goto('/saved');
    await expect(page.getByRole('heading', { name: /my jobs/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^saved/i }).first()).toBeVisible();
    const hydrationErrors = guard.pageErrors.filter((e) => /React error #418/.test(e));
    if (hydrationErrors.length) guard.pageErrors.length = 0; // reported as a fixme, not a hard failure
    test.fixme(
      hydrationErrors.length > 0,
      'DEFECT: /saved throws React hydration error #418 when localStorage already holds saved jobs (useSavedJobs reads localStorage during render)',
    );
  });

  test('save on the detail page persists across reload, shows on dashboard + /saved, unsave clears it', async ({ page, guard }) => {
    // Known defect (reported separately, fixme test above): hydration #418 on /saved.
    guard.allow(/Minified React error #418/);
    // pageerrors are asserted unconditionally by the guard, so drop #418 ones here.
    page.on('pageerror', () => {
      const idx = guard.pageErrors.findIndex((e) => /React error #418/.test(e));
      if (idx >= 0) guard.pageErrors.splice(idx, 1);
    });
    await loginAsSeeker(page);
    // Wait for useSavedJobs' first GET: a click before it settles is kept
    // local-only (defect reported separately: saveJob skips the POST until isAuth).
    await gotoJobSynced(page, `/jobs/${SEEDS.employerJobSlug}`);
    const title = (await page.locator('h1').first().innerText()).trim();

    const saveBtn = page.getByRole('button', { name: /^save job$/i }).first();
    await saveBtn.click();
    const savedBtn = page.getByRole('button', { name: /^remove saved job$/i }).first();
    await expect(savedBtn).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => savedJobIds(page)).toContain(SEEDS.employerJobId);

    await page.reload();
    await expect(page.getByRole('button', { name: /^remove saved job$/i }).first()).toBeVisible();

    await gotoDashboard(page);
    const savedCard = page.locator('.clay-section-card').filter({ hasText: /saved jobs/i });
    await expect(savedCard).toContainText(title.slice(0, 40));

    await page.goto('/saved');
    await expect(page.getByRole('link', { name: new RegExp(escapeRe(title.slice(0, 40)), 'i') }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /^saved\s*1$/i }).first()).toBeVisible();

    // Back-navigation keeps the list (no refetch flicker into an empty state).
    await page.goBack();
    await page.goForward();
    await expect(page.getByRole('link', { name: new RegExp(escapeRe(title.slice(0, 40)), 'i') }).first()).toBeVisible();

    await gotoJobSynced(page, `/jobs/${SEEDS.employerJobSlug}`);
    await page.getByRole('button', { name: /^remove saved job$/i }).first().click();
    await expect(page.getByRole('button', { name: /^save job$/i }).first()).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => savedJobIds(page)).not.toContain(SEEDS.employerJobId);
    await page.goto('/saved');
    await expect(page.getByRole('heading', { name: /no saved jobs yet/i })).toBeVisible();
  });

  test('clear-all confirm dialog: Escape cancels, keyboard confirm clears server + client state', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await saveJobViaApi(page, SEEDS.employerJobId!);
    await page.goto('/saved');
    const clearBtn = page.getByRole('button', { name: /^clear all$/i });
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();
    const dialog = confirmDialog(page, /clear all saved jobs\?/i);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/removes all 1 saved job\b/i);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await savedJobIds(page), 'Escape must not clear anything').toContain(SEEDS.employerJobId);

    await clearBtn.click();
    await expect(dialog).toBeVisible();
    // The confirm button is autoFocused so Enter activates it.
    await expect(dialog.getByRole('button', { name: /^clear all$/i })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: /no saved jobs yet/i })).toBeVisible();
    await expect.poll(() => savedJobIds(page)).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { name: /no saved jobs yet/i })).toBeVisible();
  });

  test('clear-all confirm dialog traps keyboard focus', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await saveJobViaApi(page, SEEDS.employerJobId!);
    await page.goto('/saved');
    await page.getByRole('button', { name: /^clear all$/i }).click();
    const dialog = confirmDialog(page, /clear all saved jobs\?/i);
    await expect(dialog).toBeVisible();
    await assertFocusTrapped(page, dialog, 'ConfirmDialog (clear all saved jobs)');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

// ── Easy Apply ──────────────────────────────────────────────────────────────

test.describe('easy apply', () => {
  test.skip(!CAN_MUTATE, 'Needs seeker creds and a non-production target');
  test.skip(!SEEDS.easyApplyJobSlug || !SEEDS.easyApplyJobId, 'E2E_EASY_APPLY_JOB_SLUG / E2E_EASY_APPLY_JOB_ID not set');
  test.use({ baseURL: MUT_ORIGIN });

  const jobPath = () => `/jobs/${SEEDS.easyApplyJobSlug}`;

  test.beforeEach(async () => {
    await resetState();
  });

  test('anonymous visitor is gated; sign-in returns to the job with the modal auto-opened', async ({ page, guard }) => {
    void guard;
    await page.goto(jobPath());
    await easyApplyButton(page).click();
    await expect(page.getByRole('heading', { name: /sign in to apply/i })).toBeVisible();
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(/\/login\?redirectTo=/);
    expect(decodeURIComponent(page.url())).toContain('apply=1');

    await page.locator('#login-email').fill(SEEKER_CREDS!.email);
    await page.locator('#login-password').fill(SEEKER_CREDS!.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/apply=1/);
    await expect(applyDialog(page)).toBeVisible();
  });

  test('modal is focus-trapped, Escape closes it and focus returns to the trigger', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await gotoJob(page, jobPath());
    const dialog = await openApplyModal(page);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await assertFocusTrapped(page, dialog, 'Easy Apply modal');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // useFocusTrap restores focus to the element focused when the trap armed.
    await expect
      .poll(() => activeElementDescription(page), { message: 'focus should return to the Easy Apply trigger after Escape' })
      .toMatch(/easy apply|apply again/i);

    // Keyboard-only reopen + close via the Close button.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^close$/i }).click();
    await expect(dialog).toBeHidden();
  });

  test('required screening validation, cover-letter counter, single submit, status everywhere', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    const questions = await fetchScreeningQuestions(page, SEEDS.easyApplyJobId!);
    const required = questions.find((q) => q.isRequired);
    test.skip(!required, 'Easy Apply seed has no required screening question');

    await gotoJob(page, jobPath());
    const jobTitle = (await page.locator('h1').first().innerText()).trim();
    const dialog = await openApplyModal(page);
    const submit = dialog.getByRole('button', { name: /submit application/i });
    const consent = dialog.locator('input[type="checkbox"]').first();
    // Screening questions load separately from the profile; wait for them.
    await expect(dialog.locator(`#screening-${required!.id}`)).toBeVisible({ timeout: 45_000 });

    await expect(submit, 'consent gate').toBeDisabled();
    await consent.check();
    await expect(submit).toBeEnabled();

    // Required question left blank → inline error + focus moves to the question.
    await submit.click();
    const error = dialog.locator(`#screening-${required!.id}-error`);
    await expect(error).toContainText(/required/i);
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(dialog.locator(`#screening-${required!.id}`)).toBeFocused();
    expect(await seedApp(page), 'nothing submitted on a validation failure').toBeUndefined();

    // Answer it; the inline error clears immediately.
    await dialog.locator(`#screening-${required!.id}`).click(); // "Yes" for boolean
    await expect(error).toHaveCount(0);

    // Cover letter counter + hard cap.
    const cover = dialog.locator('#coverLetter');
    const counter = dialog.locator('#cover-letter-counter');
    await expect(counter).toContainText(/up to 5,000 characters/i);
    await cover.fill('Hello');
    await expect(counter).toHaveText(/^5 \/ 5,000 characters$/);
    await cover.fill('x'.repeat(5_200));
    await expect(counter).toContainText(/5,000 \/ 5,000 characters \(limit reached\)/i);
    expect((await cover.inputValue()).length).toBe(5_000);
    await cover.fill('E2E cover letter, submitted through the in-platform apply modal.');

    // Double-click: the button disables while submitting; exactly one row results.
    const applyRes = page.waitForResponse((r) => r.url().includes('/api/applications/apply-direct'), { timeout: 45_000 });
    await submit.dblclick();
    const applyResponse = await applyRes;
    expect(applyResponse.status(), `apply-direct → ${await applyResponse.text()}`).toBe(200);
    // The success confirmation is covered by its own (fixme) test; here the
    // durable outcome is asserted: one row, status applied, modal closed.
    await expect(applyDialog(page)).toBeHidden();
    const apps = await applicationsViaApi(page);
    expect(apps.filter((a) => a.job.id === SEEDS.easyApplyJobId)).toHaveLength(1);
    expect((await seedApp(page))!.status).toBe('applied');
    await page.reload();
    await expect(page.getByText(/you've already applied/i).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /apply again/i })).toBeVisible();

    await page.goto('/my-applications');
    const row = page.locator('.app-card').filter({ hasText: jobTitle }).first();
    await expect(row).toBeVisible();
    await expect(page.getByText(/^applied$/i).first()).toBeVisible();

    await gotoDashboard(page);
    const recent = page.locator('.clay-section-card').filter({ hasText: /recent applications/i });
    await expect(recent).toContainText(jobTitle.slice(0, 40));
    await expect(recent).toContainText(/applied/i);
    await expect(page.locator('a[href="/my-applications"]').first()).toBeVisible();
  });

  test('a successful submit shows the "Application Submitted" confirmation', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    const questions = await fetchScreeningQuestions(page, SEEDS.easyApplyJobId!);
    await gotoJob(page, jobPath());
    const dialog = await openApplyModal(page);
    for (const q of questions.filter((x) => x.isRequired)) {
      await dialog.locator(`#screening-${q.id}`).click({ timeout: 45_000 });
    }
    await dialog.locator('input[type="checkbox"]').first().check();
    const res = page.waitForResponse((r) => r.url().includes('/api/applications/apply-direct'), { timeout: 60_000 });
    await dialog.getByRole('button', { name: /submit application/i }).click();
    expect((await res).status()).toBe(200);
    const success = page.getByRole('dialog', { name: /application submitted/i });
    const shown = await success.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    test.fixme(
      !shown,
      'DEFECT: Easy Apply success confirmation never appears (ApplyButton onSuccess unmounts InPlatformApplyForm right after setSubmitted)',
    );
    await success.getByRole('button', { name: /^done$/i }).click();
    await expect(page.getByText(/you've already applied/i).filter({ visible: true }).first()).toBeVisible();
  });

  test('refresh mid-flow closes the modal cleanly; ?apply=1 re-opens it; back navigation is stable', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await gotoJob(page, jobPath());
    const dialog = await openApplyModal(page);
    await dialog.locator('#coverLetter').fill('draft that will be lost on refresh');
    await page.reload();
    await expect(applyDialog(page)).toHaveCount(0);
    await expect(page.locator('h1').first()).toBeVisible();

    await gotoJob(page, `${jobPath()}?apply=1`);
    await expect(applyDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(applyDialog(page)).toBeHidden();

    await page.goto('/my-applications');
    await page.goBack();
    await expect(page).toHaveURL(/apply=1/);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(easyApplyButton(page)).toBeVisible();
  });

  test('withdraw via confirm dialog (Escape cancels, Enter confirms); re-apply restores an active status', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await applyViaApi(page, SEEDS.easyApplyJobId!);
    await page.goto('/my-applications');

    const withdrawBtn = page.getByRole('button', { name: /^withdraw application for .*easy apply/i }).first();
    await expect(withdrawBtn).toBeVisible();
    await withdrawBtn.click();
    const dialog = confirmDialog(page, /withdraw this application\?/i);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect((await seedApp(page))!.status, 'Escape must not withdraw').toBe('applied');

    await withdrawBtn.click();
    await expect(dialog.getByRole('button', { name: /^withdraw$/i })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/^withdrawn$/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^withdraw application for .*easy apply/i })).toHaveCount(0);
    const afterWithdraw = (await seedApp(page))!;
    expect(afterWithdraw.status).toBe('withdrawn');
    expect(afterWithdraw.withdrawnAt).not.toBeNull();

    // The detail page must treat a withdrawn application as not applied.
    const appsSync = page.waitForResponse(
      (r) => /\/api\/applications(\?|$)/.test(r.url()) && r.request().method() === 'GET',
      { timeout: 45_000 },
    ).catch(() => null);
    await gotoJob(page, jobPath());
    await appsSync;
    await expect(easyApplyButton(page)).toBeVisible();
    await expect(page.getByText(/you've already applied/i)).toHaveCount(0);
    const labelAfterWithdraw = (await easyApplyButton(page).innerText()).trim();

    const dlg = await openApplyModal(page);
    const questions = await fetchScreeningQuestions(page, SEEDS.easyApplyJobId!);
    for (const q of questions.filter((x) => x.isRequired)) {
      await dlg.locator(`#screening-${q.id}`).click({ timeout: 45_000 });
    }
    await dlg.locator('input[type="checkbox"]').first().check();
    const reapplyRes = page.waitForResponse((r) => r.url().includes('/api/applications/apply-direct'), { timeout: 45_000 });
    await dlg.getByRole('button', { name: /submit application/i }).click();
    expect((await reapplyRes).status()).toBe(200);
    await expect(applyDialog(page)).toBeHidden();

    const reapplied = (await seedApp(page))!;
    expect(reapplied.withdrawnAt).toBeNull();

    test.fixme(
      /apply again/i.test(labelAfterWithdraw),
      'DEFECT: after withdrawing, the job page still labels the CTA "Apply Again" (useAppliedJobs counts withdrawn rows as applied)',
    );
    expect(labelAfterWithdraw).toMatch(/^easy apply$/i);
  });

  test('re-applying after a withdrawal returns the application to an active status', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    const id = await applyViaApi(page, SEEDS.easyApplyJobId!);
    const w = await page.request.delete('/api/applications/withdraw', { headers: { Origin: MUT_ORIGIN }, data: { applicationId: id }, timeout: 60_000 });
    expect(w.status()).toBe(200);
    await applyViaApi(page, SEEDS.easyApplyJobId!, 'E2E re-application');
    const row = (await seedApp(page))!;
    expect(row.withdrawnAt).toBeNull();
    test.fixme(row.status === 'withdrawn', 'DEFECT: re-applying after withdrawing leaves the application status "withdrawn" (apply-direct upsert resets withdrawnAt but not status)');
    expect(row.status, 're-applying after withdraw must yield an active status').toBe('applied');
    await page.goto('/my-applications');
    await expect(page.getByRole('button', { name: /^withdraw application for .*easy apply/i }).first()).toBeVisible();
  });
});

// ── Resume upload ───────────────────────────────────────────────────────────

test.describe('resume', () => {
  test.skip(!CAN_MUTATE, 'Needs seeker creds and a non-production target');
  // *.pdf is gitignored: resumeFixtureFile falls back to an in-memory PDF.
  test.use({ baseURL: MUT_ORIGIN });

  test.afterEach(async () => {
    if (CAN_RESET && SEEKER_CREDS) await clearSeekerResume(SEEKER_CREDS.email);
  });

  test('rejects a non-PDF/Word file client-side; PDF uploads, persists, and can be deleted', async ({ page, guard }) => {
    // The AI parse after upload needs OPENAI_API_KEY; without it /api/resume/parse
    // 5xxs. That is environmental in this dev setup, so only that URL is allowed.
    // Since the parse route checks config after auth it answers 503 here, and
    // Chromium's "Failed to load resource" console line omits the URL, so the
    // 503 status line is allowed too (the trace shows it is the parse call).
    guard.allow(/\/api\/resume\/parse/);
    guard.allow(/status of 503 \(Service Unavailable\)/);
    await loginAsSeeker(page);
    await page.goto('/settings');
    const section = page.locator('#section-resume');
    await expect(section).toBeVisible();
    const fileInput = section.locator('input[type="file"]');

    if (fs.existsSync(TXT_FIXTURE)) {
      await fileInput.setInputFiles(TXT_FIXTURE);
      await expect(section).toContainText(/invalid file type/i);
      const profile = await (await page.request.get('/api/auth/profile')).json();
      expect(profile.resumeUrl, 'rejected file must not be persisted').toBeNull();
    }

    const uploadRes = page.waitForResponse((r) => r.url().includes('/api/upload'), { timeout: 60_000 });
    await fileInput.setInputFiles(resumeFixtureFile(RESUME_PATH));
    const upload = await uploadRes;
    if (upload.status() === 500) {
      guard.allow(/\/api\/upload/);
      guard.allow(/status of 500/);
    }
    test.fixme(
      upload.status() === 500,
      'DEFECT: resume upload of a valid PDF returns 500 "Failed to upload file" (app/api/upload/route.ts collapses every failure into a generic 500)',
    );
    expect(upload.status(), `/api/upload → ${await upload.text()}`).toBe(200);
    await expect(page.getByText(/resume uploaded/i).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await (await page.request.get('/api/auth/profile')).json()).resumeUrl).toBeTruthy();

    // The AI autofill review opens after upload (parse may fail without an
    // OpenAI key in this env — that surfaces as a Close button, not a crash).
    const review = page.getByRole('dialog').filter({ has: page.locator('#resume-review-title') });
    if (await review.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await review.getByRole('button', { name: /^(close|skip for now)$/i }).click();
      await expect(review).toBeHidden();
    }

    await page.reload();
    await expect(section.getByRole('button', { name: /view resume/i })).toBeVisible();
    await expect(section.getByRole('button', { name: /replace/i })).toBeVisible();

    await section.getByRole('button', { name: /delete resume/i }).click();
    await expect(section).toContainText(/delete your resume\?/i);
    await section.getByRole('button', { name: /yes, delete/i }).click();
    await expect(section.getByRole('button', { name: /view resume/i })).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get('/api/auth/profile')).json()).resumeUrl).toBeNull();
  });
});

// ── Settings ────────────────────────────────────────────────────────────────

test.describe('settings', () => {
  test.skip(!CAN_MUTATE, 'Needs seeker creds and a non-production target');
  test.use({
    baseURL: MUT_ORIGIN,
    // Fresh per-run client IP: /api/data-request allows 3 per IP per hour.
    extraHTTPHeaders: { 'User-Agent': 'PMHNP-E2E-Bot/1.0 (Playwright)', 'x-forwarded-for': uniqueIp() },
  });

  test('name change persists across reload (and is restored)', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await page.goto('/settings');
    const first = page.getByPlaceholder('First name');
    await expect(first).toBeVisible();
    // An interrupted earlier run can leave the suffix behind; never compound it.
    const original = (await first.inputValue()).replace(/(-Renamed)+$/, '') || 'E2E';
    const changed = `${original}-Renamed`;
    const id = CAN_RESET ? await resolveSeekerId(SEEKER_CREDS!.email) : null;

    try {
      await first.fill(changed);
      await expect(first).toHaveValue(changed);
      const patch = page.waitForResponse((r) => r.url().includes('/api/auth/profile') && r.request().method() === 'PATCH', { timeout: 45_000 });
      await page.getByRole('button', { name: /save changes/i }).click();
      expect((await patch).status()).toBe(200);
      // The toast auto-hides after 4s; the PATCH above is the durable signal.
      await expect(page.getByText(/^profile updated\.?$/i)).toBeVisible({ timeout: 3_000 }).catch(() => undefined);
      await page.reload();
      await expect(page.getByPlaceholder('First name')).toHaveValue(changed);
      await expect(page.locator('h2').filter({ hasText: changed }).first()).toBeVisible();

      // Restore through the UI as well, so the second save path is exercised.
      await page.getByPlaceholder('First name').fill(original);
      await expect(page.getByPlaceholder('First name')).toHaveValue(original);
      const patch2 = page.waitForResponse((r) => r.url().includes('/api/auth/profile') && r.request().method() === 'PATCH', { timeout: 45_000 });
      await page.getByRole('button', { name: /save changes/i }).click();
      const res2 = await patch2;
      expect(res2.status()).toBe(200);
      expect((res2.request().postDataJSON() as { firstName?: string }).firstName, 'PATCH carries the edited first name').toBe(original);
      await expect.poll(async () => (await (await page.request.get('/api/auth/profile')).json()).firstName).toBe(original);
    } finally {
      if (id) await db().userProfile.update({ where: { supabaseId: id }, data: { firstName: original } });
    }
  });

  test('email cannot be changed from the form or by a crafted PATCH', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await page.goto('/settings');
    const email = page.locator('#section-contact input[type="email"]');
    await expect(email).toBeDisabled();
    await expect(email).toHaveValue(SEEKER_CREDS!.email);
    await expect(page.getByText(/email cannot be changed/i)).toBeVisible();

    const res = await page.request.patch('/api/auth/profile', {
      headers: { Origin: MUT_ORIGIN },
      data: { email: 'hijack@example.invalid', supabaseId: 'someone-else', role: 'admin' },
    });
    expect(res.status()).toBe(200);
    const profile = await (await page.request.get('/api/auth/profile')).json();
    expect(profile.email).toBe(SEEKER_CREDS!.email);
    expect(profile.role).toBe('job_seeker');
  });

  test('password: reset email from Account tab; /reset-password validates mismatch client-side', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await page.goto('/settings?tab=account');
    const reset = page.getByRole('button', { name: /send reset email/i });
    await expect(reset).toBeVisible();
    await reset.click();
    // Supabase throttles repeat reset emails; both outcomes are the documented UI copy.
    // The settings toast has no role=status, so it is located by its fixed position.
    const resetMsg = page.locator('div[style*="position: fixed"][style*="top: 80px"]');
    await expect(resetMsg.first()).toBeVisible({ timeout: 30_000 });
    const shown = (await resetMsg.first().innerText()).trim();
    test.info().annotations.push({ type: 'reset-email-message', description: shown });
    expect(shown, 'reset email outcome copy').toMatch(/password reset email sent|please wait before requesting/i);

    await page.goto('/reset-password');
    await page.locator('#reset-password').fill(TEST_PASSWORD);
    await page.locator('#reset-confirm').fill(`${TEST_PASSWORD}x`);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test('data request (CCPA opt-out + access) succeeds; do-not-sell opt-out records consent', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await page.goto('/data-request');
    const email = page.locator('#email');
    await expect(email).toHaveValue(SEEKER_CREDS!.email);
    await expect(email).toHaveAttribute('readonly', '');

    await page.locator('#type').selectOption('opt_out_sale');
    await page.locator('#jurisdiction').selectOption('ccpa');
    await page.locator('#description').fill('E2E: do not sell or share my personal information.');
    await page.getByRole('button', { name: /submit request/i }).click();
    await expect(page.getByText(/request received/i)).toBeVisible();
    await expect(page.getByText(/reference id/i)).toBeVisible();
    await expect(page.getByText(/we will respond by/i)).toBeVisible();

    if (hasDb()) {
      const rows = await db().dataRequest.findMany({
        where: { email: SEEKER_CREDS!.email.toLowerCase(), type: 'opt_out_sale' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].identityVerified).toBe(true);
    }

    // Access request executes immediately and returns the export inline.
    const access = await page.request.post('/api/data-request', {
      headers: { Origin: MUT_ORIGIN },
      data: { email: SEEKER_CREDS!.email, type: 'access', jurisdiction: 'gdpr' },
    });
    expect(access.status(), await access.text()).toBe(201);
    const body = await access.json();
    expect(body.export?.email?.toLowerCase()).toBe(SEEKER_CREDS!.email.toLowerCase());

    // Filing for someone else's email is refused.
    const spoof = await page.request.post('/api/data-request', {
      headers: { Origin: MUT_ORIGIN },
      data: { email: 'victim@example.invalid', type: 'access' },
    });
    expect(spoof.status()).toBe(403);

    await page.goto('/do-not-sell');
    await page.getByRole('button', { name: /opt out on this device/i }).click();
    await expect(page.getByText(/you(?:'re| are) opted out on this device/i)).toBeVisible();
    const consent = (await page.context().cookies()).find((c) => c.name === 'pmhnp_consent_v2');
    expect(consent, 'consent cookie written').toBeTruthy();
    expect(decodeURIComponent(consent!.value)).toMatch(/"analytics":false/);
  });
});

// ── Logout + unauthenticated access ─────────────────────────────────────────

test.describe('session end', () => {
  test.skip(!HAS_AUTH, 'E2E_SEEKER_EMAIL / E2E_SEEKER_PASS not set');
  test.use({ baseURL: MUT_ORIGIN });

  test('sign out clears the session: protected pages redirect, APIs 401', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await page.goto('/dashboard');
    await signOutViaMenu(page);

    for (const path of ['/dashboard', '/settings', '/onboarding/professional']) {
      await page.goto(path);
      await page.waitForURL(/\/login/);
    }
    for (const api of ['/api/auth/profile', '/api/saved-jobs', '/api/applications', '/api/dashboard']) {
      const res = await page.request.get(api);
      expect(res.status(), api).toBe(401);
    }
    const me = await (await page.request.get('/api/auth/me')).json();
    expect(me.id).toBeNull();
  });
});

test.describe('unauthenticated access', () => {
  test('protected pages bounce to /login; /my-applications explains sign-in', async ({ page, guard }) => {
    void guard;
    for (const path of ['/dashboard', '/settings', '/onboarding/professional']) {
      const res = await page.goto(path);
      expect(res?.status() ?? 0, path).toBeLessThan(500);
      await page.waitForURL(/\/login/);
    }
    await page.goto('/my-applications');
    await expect(page.getByRole('heading', { name: /sign in required/i })).toBeVisible();
  });

  test('candidate APIs return 401 JSON for anonymous callers', async ({ request }) => {
    const probes: Array<{ method: 'get' | 'post' | 'delete' | 'patch'; path: string; data?: unknown }> = [
      { method: 'get', path: '/api/saved-jobs' },
      { method: 'post', path: '/api/saved-jobs', data: { jobId: SEEDS.employerJobId || 'x' } },
      { method: 'delete', path: '/api/saved-jobs', data: { jobId: 'x' } },
      { method: 'get', path: '/api/applications' },
      { method: 'post', path: '/api/applications/apply-direct', data: { jobId: SEEDS.easyApplyJobId || 'x', consent: true } },
      { method: 'delete', path: '/api/applications/withdraw', data: { applicationId: 'x' } },
      { method: 'get', path: '/api/auth/profile' },
      { method: 'patch', path: '/api/auth/profile', data: { firstName: 'x' } },
      { method: 'get', path: '/api/dashboard' },
      { method: 'delete', path: '/api/profile/resume' },
      { method: 'post', path: '/api/data-request', data: { email: 'a@example.invalid', type: 'access' } },
    ];
    for (const p of probes) {
      const res = await request[p.method](p.path, { data: p.data });
      expect(res.status(), `${p.method.toUpperCase()} ${p.path}`).toBe(401);
      expect(res.headers()['content-type']).toMatch(/json/);
    }
  });
});

// ── Adversarial API probes ──────────────────────────────────────────────────

test.describe('adversarial api probes', () => {
  test.skip(AGAINST_PROD, 'Probes create rows / send mail; local only');

  test('POST /api/auth/welcome is not an unauthenticated account-existence oracle', async ({ request }) => {
    const headers = { Origin: MUT_ORIGIN, 'x-forwarded-for': uniqueIp() };
    const unknown = await request.post(`${MUT_ORIGIN}/api/auth/welcome`, {
      headers, data: { email: `nobody-${Date.now()}@example.invalid` },
    });
    const known = await request.post(`${MUT_ORIGIN}/api/auth/welcome`, {
      headers, data: { email: SEEKER_CREDS?.email ?? 'e2e-candidate@example.invalid' },
    });
    // An anonymous caller must get the same answer for both, or a 401.
    expect(known.status()).toBe(unknown.status());
    expect(await known.text()).toBe(await unknown.text());
  });

  test.describe('signed in', () => {
    test.skip(!CAN_MUTATE, 'Needs seeker creds and a non-production target');
    test.use({ baseURL: MUT_ORIGIN });

    test('withdraw and save reject bad input; foreign application ids are not withdrawable', async ({ page, guard }) => {
      void guard;
      await loginAsSeeker(page);
      const h = { Origin: MUT_ORIGIN };
      const missing = await page.request.delete('/api/applications/withdraw', { headers: h, data: {} });
      expect(missing.status()).toBe(400);
      const notFound = await page.request.delete('/api/applications/withdraw', { headers: h, data: { applicationId: 'does-not-exist' } });
      expect(notFound.status()).toBe(404);
      const noJob = await page.request.post('/api/saved-jobs', { headers: h, data: {} });
      expect(noJob.status()).toBe(400);
      // Saving a nonexistent job id must be a clean 4xx, not a 500 (FK violation).
      const bogus = await page.request.post('/api/saved-jobs', { headers: h, data: { jobId: '00000000-0000-0000-0000-000000000000' } });
      expect(bogus.status(), `POST /api/saved-jobs bogus id → ${bogus.status()}`).toBeLessThan(500);
      // Wrong origin is refused by CSRF even with a valid session.
      const xorigin = await page.request.post('/api/saved-jobs', { headers: { Origin: 'https://evil.example' }, data: { jobId: SEEDS.employerJobId || 'x' } });
      expect(xorigin.status()).toBe(403);
      const accepted = bogus.status() === 200;
      await resetState();
      test.fixme(accepted, 'DEFECT: POST /api/saved-jobs stores a saved-job row for a job id that does not exist');
      expect([400, 404]).toContain(bogus.status());
    });
  });
});

// ── Password change on an ephemeral seeker ──────────────────────────────────

test.describe('password change', () => {
  test.skip(AGAINST_PROD || !canDeleteAuthUsers(), 'Needs service-role key and a non-production target');
  test.use({ baseURL: MUT_ORIGIN });

  test('/reset-password validates length; an ordinary session cannot silently set a new password', async ({ page, guard }) => {
    void guard;
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `e2e-pwchange-${Date.now().toString(36)}@example.invalid`;
    const password = 'E2ePwChange!9Kq#2026';
    const { error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { role: 'job_seeker', first_name: 'E2E', last_name: 'PwChange' },
    });
    test.skip(Boolean(error), `createUser failed: ${error?.message}`);
    try {
      await loginAtPath(page, '/login', { email, password }, { timeout: 60_000 });
      await page.goto('/reset-password');
      await page.locator('#reset-password').fill('Short1!');
      await page.locator('#reset-confirm').fill('Short1!');
      // minLength=8 blocks natively; the JS guard is a second line.
      expect(await page.locator('#reset-password').evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(false);

      const next = 'E2eNewPass!4Zt#2026';
      await page.locator('#reset-password').fill(next);
      await page.locator('#reset-confirm').fill(next);
      await page.locator('button[type="submit"]').click();
      const updated = page.getByRole('heading', { name: /password updated/i });
      const banner = page.getByText(/reauthenticat|nonce|current password|recent login/i);
      await expect(updated.or(banner).first()).toBeVisible({ timeout: 20_000 });
      test.fixme(
        await updated.isVisible(),
        'DEFECT: /reset-password changes the password for any signed-in session without a recovery token or the current password',
      );
      await expect(updated).toHaveCount(0);
    } finally {
      await deleteAuthUserByEmail(email);
    }
  });
});

// ── Mobile (375px) ──────────────────────────────────────────────────────────

test.describe('mobile 375px', () => {
  test.skip(!CAN_MUTATE, 'Needs seeker creds and a non-production target');
  test.use({ baseURL: MUT_ORIGIN, viewport: MOBILE_VIEWPORT, isMobile: true, hasTouch: true });

  test.beforeEach(async () => {
    await resetState();
  });

  test('dashboard renders without horizontal overflow', async ({ page, guard }) => {
    void guard;
    await loginAsSeeker(page);
    await gotoDashboard(page);
    await expect(page.getByText(/recent applications/i).first()).toBeVisible();
    await assertNoHorizontalOverflow(page, 'dashboard@375');
  });

  test('easy apply modal fits the viewport and submits', async ({ page, guard }) => {
    void guard;
    test.skip(!SEEDS.easyApplyJobSlug || !SEEDS.easyApplyJobId, 'Easy Apply seed missing');
    await loginAsSeeker(page);
    await gotoJob(page, `/jobs/${SEEDS.easyApplyJobSlug}`);
    // At 375px the cookie banner sits over the sticky Easy Apply bar and
    // swallows the tap; a first-time visitor has to answer it first.
    const consent = page.getByRole('dialog', { name: /cookie consent/i });
    if (await consent.isVisible().catch(() => false)) {
      await consent.getByRole('button', { name: /^decline$/i }).tap();
      await expect(consent).toBeHidden();
    }
    const dialog = await openApplyModal(page);
    const box = await dialog.boundingBox();
    expect(box, 'dialog box').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    expect(await focusIsInside(dialog)).toBe(true);

    const questions = await fetchScreeningQuestions(page, SEEDS.easyApplyJobId!);
    for (const q of questions.filter((x) => x.isRequired)) {
      await expect(dialog.locator(`#screening-${q.id}`)).toBeVisible({ timeout: 45_000 });
      await dialog.locator(`#screening-${q.id}`).tap();
    }
    await dialog.locator('input[type="checkbox"]').first().check();
    const mobileApply = page.waitForResponse((r) => r.url().includes('/api/applications/apply-direct'), { timeout: 45_000 });
    await dialog.getByRole('button', { name: /submit application/i }).tap();
    expect((await mobileApply).status()).toBe(200);
    // Success confirmation is tracked by the desktop fixme test; assert the outcome.
    await expect(applyDialog(page)).toBeHidden();
    await page.reload();
    // The notice renders in both the inline and sticky apply areas; check the visible one.
    await expect(page.getByText(/you've already applied/i).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await assertNoHorizontalOverflow(page, 'job detail after apply@375');
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Find the first real job URL on /jobs. Returns null if none. */
async function pickFirstJob(page: Page): Promise<string | null> {
  await page.goto('/jobs');
  const links = await page
    .locator('a[href^="/jobs/"]')
    .evaluateAll((els) =>
      els
        .map((e) => (e as HTMLAnchorElement).getAttribute('href') || '')
        .filter((h) =>
          /^\/jobs\/[a-z0-9-]+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(h)
        )
    );
  return links[0] || null;
}

/** The seeded candidate's application on the Easy Apply seed (other journeys apply to other jobs). */
async function seedApp(page: Page) {
  return (await applicationsViaApi(page)).find((a) => a.job.id === SEEDS.easyApplyJobId);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keep the id resolver warm for cleanup even if the first stateful test skips.
test.beforeAll(async () => {
  if (CAN_RESET && SEEKER_CREDS) await resolveSeekerId(SEEKER_CREDS.email);
});

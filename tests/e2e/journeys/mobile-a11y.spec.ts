import { test as base, expect, type Page, type Locator } from '@playwright/test';
import { getSeekerCreds, getEmployerCreds } from '../fixtures/auth';
import { playwrightAuth } from '../helpers/auth';
import {
  MOBILE_VIEWPORT,
  MIN_TAP_TARGET,
  attachErrorGuard,
  type ErrorGuard,
  presetConsentCookie,
  assertNoHorizontalOverflow,
  expectTapTarget,
  assertBottomContentNotCovered,
  assertHeadingNotCovered,
  fixedBottomBars,
  runAxe,
  assertFocusTrapped,
  focusIsInside,
  activeElementDescription,
  activeElementHasFocusRing,
  installMotionRecorder,
  readMotionLog,
  scrollToBottomInstant,
  findDashesInVisibleText,
} from '../helpers/a11y';
import { MUT_ORIGIN, uniqueIp } from '../helpers/candidate';
import { loginAtPath } from '../fixtures/auth';
import { createEphemeralEmployer, destroyEphemeralEmployer, ephemeralSupportAvailable, type EphemeralEmployer } from '../helpers/ephemeral-employer';

/**
 * Mobile + accessibility sweep.
 *
 *  1. 375x812: home, /jobs (+ filter drawer), job detail (+ report dialog,
 *     apply gate, sticky apply bar), /salary-guide, a tool, /post-job step 1,
 *     the seeker dashboard, the header menu and the cookie banner. Every page
 *     is checked for horizontal overflow (document.scrollingElement.scrollWidth
 *     <= innerWidth), >= 44px primary tap targets, and sticky/fixed elements
 *     not covering the H1 or the bottom-most control.
 *  2. axe-core (wcag2a/aa, 2.1, 2.2 AA) on 15 representative pages — any
 *     serious/critical violation fails. The site-wide `color-contrast`
 *     defect is isolated into its own tracked test (see DEFECTS) so the
 *     sweep keeps catching every OTHER regression.
 *  3. Keyboard-only: skip link, visible focus, and every dialog trapping
 *     focus + closing on Escape.
 *  4. prefers-reduced-motion: no entrance transform tweens / running
 *     transform-opacity animations on the home page or when the mobile menu
 *     opens.
 *
 * Every test runs under an error guard (uncaught exceptions, first-party
 * console errors, 5xx responses). 4xx resource loads are filtered because
 * lib/csrf.ts rejects POSTs from a 127.0.0.1 Origin (the documented
 * environment quirk) — see helpers/a11y.ts CONSOLE_NOISE.
 *
 * DEFECTS — tests declared with `test.fixme(title, body)` reproduce a
 * confirmed product defect (the title IS the defect). Their bodies are the
 * exact assertions that fail today; flip them back to `test(...)` once the
 * product is fixed. Nothing was weakened to go green.
 */

const JOB_SLUG = process.env.E2E_TEST_JOB_SLUG;
const EASY_APPLY_SLUG = process.env.E2E_EASY_APPLY_JOB_SLUG;
const TOOL_PATH = '/tools/1099-vs-w2-calculator';
const SECOND_TOOL_PATH = '/tools/salary-benchmark';

/** Longest entrance tween in the app (HomepageHero stagger ≈ 0.1 + 4×0.08 + 0.4s). */
const ENTRANCE_WINDOW_MS = 2_500;

/**
 * axe rule tracked by its own test ("DEFECT: color-contrast ...") because it
 * fires on every page (footer legal links #78716c on #1c1917, breadcrumb
 * spans, tool hints, salary pills). Excluded from the per-page sweep ONLY so
 * the sweep stays sensitive to new violations of every other rule.
 */
const SITE_WIDE_AXE_DEFECTS = ['color-contrast'];

type Fixtures = { guard: ErrorGuard };

const test = base.extend<Fixtures>({
  guard: async ({ page }, run, testInfo) => {
    const guard = attachErrorGuard(page);
    await run(guard);
    guard.assertClean(testInfo.title);
  },
});

async function gotoReady(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#main-content')).toBeVisible();
}

async function gotoJobsReady(page: Page, path = '/jobs'): Promise<void> {
  await gotoReady(page, path);
  await expect(page.locator('section[aria-label="Job results"]')).toBeVisible();
  // Results are fetched client-side; wait for the list (or the empty state) to render.
  await expect(page.locator('section[aria-label="Job results"] a[href^="/jobs/"], section[aria-label="Job results"] :text-matches("no jobs|0 jobs", "i")').first()).toBeVisible();
}

/**
 * /post-job renders a sign-in gate for anonymous visitors; the wizard needs an
 * employer session with an unused free post. The shared E2E employer has
 * already spent its free post, so /post-job shows it the paid-posting gate
 * instead of the wizard; a fresh ephemeral employer (unique domain) is minted
 * once per worker and removed in afterAll.
 */
let wizardEmployer: EphemeralEmployer | null = null;

async function gotoWizardStep1(page: Page): Promise<void> {
  test.skip(!ephemeralSupportAvailable(), 'Needs Supabase service-role creds to mint a fresh employer for the wizard');
  wizardEmployer ??= await createEphemeralEmployer();
  await loginAtPath(page, '/login?role=employer&redirectTo=%2Fpost-job', { email: wizardEmployer.email, password: wizardEmployer.password }, { timeout: 30_000 });
  // Admin-API users get their UserProfile on the first authenticated profile read.
  await page.request.get('/api/auth/profile');
  await gotoReady(page, '/post-job');
  await expect(page.locator('#title')).toBeVisible({ timeout: 30_000 });
}

test.afterAll(async () => {
  if (!wizardEmployer) return;
  await destroyEphemeralEmployer(wizardEmployer).catch(() => undefined);
  wizardEmployer = null;
});

async function bodyScrollLock(page: Page): Promise<string> {
  return page.evaluate(() => document.body.style.overflow);
}

function visibleApplyButton(page: Page): Locator {
  return page.getByRole('button', { name: /apply now|direct apply|easy apply|apply again|^apply$/i }).filter({ visible: true }).first();
}

function annotateAxe(testInfo: { annotations: { type: string; description?: string }[] }, all: string[]): void {
  testInfo.annotations.push({ type: 'axe', description: `${all.length} violation(s): ${all.join(' || ') || 'none'}` });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Mobile 375x812
// ═══════════════════════════════════════════════════════════════════════════

test.describe('mobile 375x812', () => {
  test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

  test.beforeEach(async ({ page, baseURL }) => {
    // The cookie banner has its own tests below; keep it out of the geometry checks here.
    await presetConsentCookie(page, baseURL!);
  });

  test('home: no overflow, H1 clear of the header, primary CTAs tappable, footer reachable', async ({ page }) => {
    await gotoReady(page, '/');
    await assertNoHorizontalOverflow(page, 'home');
    await assertHeadingNotCovered(page, 'home');
    await expectTapTarget(page.locator('main form button[type="submit"]').first(), 'home: hero search submit');
    await expectTapTarget(page.getByRole('button', { name: 'Toggle menu' }), 'home: menu toggle');
    const bottomNavLinks = page.locator('.md\\:hidden.fixed.bottom-0 a');
    const n = await bottomNavLinks.count();
    expect(n, 'home: bottom nav renders links at 375px').toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expectTapTarget(bottomNavLinks.nth(i), `home: bottom nav item #${i + 1}`);
    }
    await assertBottomContentNotCovered(page, 'home');
  });

  test('/jobs: filter drawer opens, traps focus, closes on Escape / Close, restores focus + scroll', async ({ page }) => {
    await gotoJobsReady(page);
    await assertNoHorizontalOverflow(page, '/jobs');
    await assertHeadingNotCovered(page, '/jobs');

    const filtersBtn = page.locator('button.jp-mobile-filter-btn');
    await expectTapTarget(filtersBtn, '/jobs: Filters button');
    const drawer = page.getByRole('dialog', { name: 'Filter jobs' });

    // Open → trapped → body locked
    await filtersBtn.click();
    await expect(drawer).toBeVisible();
    expect(await bodyScrollLock(page), 'body scroll locked while drawer open').toBe('hidden');
    await assertNoHorizontalOverflow(page, '/jobs with drawer open');
    await assertFocusTrapped(page, drawer, 'filter drawer');
    await expectTapTarget(drawer.getByRole('button', { name: 'Apply Filters' }), 'filter drawer: Apply Filters');

    // Escape closes, focus returns to the trigger, scroll lock released
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect.poll(() => activeElementDescription(page), { message: 'focus restored to Filters button after Escape' }).toContain('jp-mobile-filter-btn');
    expect(await bodyScrollLock(page), 'body scroll unlocked after Escape').toBe('');

    // Reopen → Close button → closed
    await filtersBtn.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Close filters' }).click();
    await expect(drawer).toBeHidden();
    expect(await bodyScrollLock(page), 'body scroll unlocked after Close').toBe('');

    // Reopen → keyboard: focus Apply Filters and press Enter → closed
    await filtersBtn.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Apply Filters' }).focus();
    await page.keyboard.press('Enter');
    await expect(drawer).toBeHidden();

    // Refresh mid-flow: reopen, reload, page must come back unlocked with no drawer
    await filtersBtn.click();
    await expect(drawer).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('section[aria-label="Job results"]')).toBeVisible();
    await expect(drawer).toBeHidden();
    expect(await bodyScrollLock(page), 'body scroll unlocked after reload').toBe('');
  });

  test('/jobs?q=telehealth: create-alert control collapses to its icon in the nav bar; modal opens, traps focus, closes on Escape', async ({ page }) => {
    await gotoJobsReady(page, '/jobs?q=telehealth');
    const alertBtn = page.locator('#nav-alert-slot button.jp-alert-btn');
    await expect(alertBtn, 'create-alert control is portaled into the nav bar when a filter is active').toBeVisible();
    await expect(alertBtn.locator('.jp-alert-label'), 'text label collapses at 375px').toBeHidden();
    await expect(alertBtn.locator('svg'), 'bell icon stays visible').toBeVisible();
    await expect(alertBtn).toHaveAccessibleName(/create alert/i);
    const box = (await alertBtn.boundingBox())!;
    expect(box.x + box.width, 'alert control fits inside the 375px viewport').toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
    expect(box.x, 'alert control is not pushed off the left edge').toBeGreaterThanOrEqual(0);
    await assertNoHorizontalOverflow(page, '/jobs with the alert control in the nav bar');

    await alertBtn.click();
    const dialog = page.locator('[role="dialog"][aria-labelledby="create-alert-title"]');
    await expect(dialog).toBeVisible();
    await assertNoHorizontalOverflow(page, '/jobs with the create-alert modal open');
    await assertFocusTrapped(page, dialog, 'create-alert modal @375');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => activeElementDescription(page), { message: 'focus restored to the alert control' }).toContain('jp-alert-btn');

    // Removing the only active filter must remove the control from the nav bar again.
    await gotoJobsReady(page, '/jobs');
    await expect(page.locator('#nav-alert-slot button.jp-alert-btn'), 'no create-alert control without active filters').toHaveCount(0);
  });

  test('/jobs: icon-only create-alert control and the modal controls meet the 44px tap-target minimum', async ({ page }) => {
    await gotoJobsReady(page, '/jobs?q=telehealth');
    const alertBtn = page.locator('#nav-alert-slot button.jp-alert-btn');
    await expectTapTarget(alertBtn, '/jobs: create-alert control (icon-only)');
    await alertBtn.click();
    const dialog = page.locator('[role="dialog"][aria-labelledby="create-alert-title"]');
    await expect(dialog).toBeVisible();
    await expectTapTarget(dialog.locator('#email'), 'create-alert modal: email input');
    await expectTapTarget(dialog.locator('#frequency'), 'create-alert modal: frequency select');
    await expectTapTarget(dialog.locator('button[type="submit"]'), 'create-alert modal: submit');
  });

  test('job detail: no overflow, sidebar content below description, sticky apply bar present and tappable', async ({ page }) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    await assertNoHorizontalOverflow(page, 'job detail');
    await assertHeadingNotCovered(page, 'job detail');

    // Description, then sidebar content (share block + sidebar cards) below it
    const about = page.getByRole('heading', { name: 'About this role' });
    await expect(about).toBeVisible();
    const aboutBox = (await about.boundingBox())!;
    const share = page.getByText('Share this job:');
    await expect(share).toBeVisible();
    const shareBox = (await share.boundingBox())!;
    expect(shareBox.y, 'mobile share block renders BELOW the description').toBeGreaterThan(aboutBox.y);
    await expect(page.locator('h3', { hasText: /career pulse|pro tips/i }).first()).toBeVisible();

    // Sticky apply bar
    const bars = await fixedBottomBars(page);
    const applyBar = bars.find((b) => /apply/i.test(b.desc));
    expect(applyBar, `a fixed bottom bar with the Apply CTA is present (bars: ${bars.map((b) => b.desc).join(' | ')})`).toBeTruthy();
    await expectTapTarget(visibleApplyButton(page), 'job detail: Apply CTA');
    await expectTapTarget(page.getByRole('button', { name: /save job|remove saved job/i }).filter({ visible: true }).first(), 'job detail: Save CTA');
  });

  test('DEFECT: job detail sticky apply bar covers the last footer links at 375px (main padding-bottom < bar height)', async ({ page }) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    // Observed: bottom-most control a "YouTube" (footer social link) is hit-tested to the
    // fixed Apply bar (div.flex.flex-col.w-full "Direct Apply…"). components/MainContent.tsx
    // gives /jobs* routes pb-24 (96px) but app/jobs/[slug]/page.tsx renders a ~110px+ fixed
    // bar (Apply + Save/Message row) on top of the 64px BottomNav.
    await assertBottomContentNotCovered(page, 'job detail');
  });

  test('job detail: report dialog traps focus, closes on Escape and via Close, restores focus', async ({ page }) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    const trigger = page.getByRole('button', { name: 'Report this job' });
    await expectTapTarget(trigger, 'job detail: report trigger');
    const dialog = page.getByRole('dialog', { name: 'Report Job' });

    await trigger.click();
    await expect(dialog).toBeVisible();
    await assertFocusTrapped(page, dialog, 'report dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => activeElementDescription(page), { message: 'focus restored to the report trigger' }).toContain('Report this job');

    await trigger.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close report dialog' }).click();
    await expect(dialog).toBeHidden();
  });

  test('job detail: signed-out Apply shows the sign-in gate, Back restores the CTA, Sign In deep-links back', async ({ page }) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    const apply = visibleApplyButton(page);
    await expect(apply).toBeVisible();
    await apply.click();
    const gate = page.getByRole('heading', { name: 'Sign in to apply' }).filter({ visible: true }).first();
    await expect(gate).toBeVisible();
    await assertNoHorizontalOverflow(page, 'job detail with sign-in gate');
    await expectTapTarget(page.getByRole('button', { name: 'Create Free Account' }).filter({ visible: true }).first(), 'gate: Create Free Account');

    // Back returns to the CTA
    await page.getByRole('button', { name: /back/i }).filter({ visible: true }).first().click();
    await expect(gate).toBeHidden();
    await expect(visibleApplyButton(page)).toBeVisible();

    // Sign In → /login?redirectTo=<this job>
    await visibleApplyButton(page).click();
    await page.getByRole('button', { name: 'Sign In' }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/login\?redirectTo=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('redirectTo') ?? '')).toContain(`/jobs/${JOB_SLUG}`);

    // Browser back lands on the job again with the bar intact
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'About this role' })).toBeVisible();
    await expect(visibleApplyButton(page)).toBeVisible();
  });

  test('DEFECT: sign-in gate "Sign In" button is 42px tall on mobile (below the 44px tap-target minimum)', async ({ page }) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    await visibleApplyButton(page).click();
    await expect(page.getByRole('heading', { name: 'Sign in to apply' }).filter({ visible: true }).first()).toBeVisible();
    // Observed 343x42 — components/ApplyButton.tsx "Sign In" uses py-2.5 while "Create Free Account" uses py-3.
    await expectTapTarget(page.getByRole('button', { name: 'Sign In' }).filter({ visible: true }).first(), 'gate: Sign In');
  });

  test('/salary-guide: no overflow, H1 clear, footer reachable', async ({ page }) => {
    await gotoReady(page, '/salary-guide');
    await assertNoHorizontalOverflow(page, '/salary-guide');
    await assertHeadingNotCovered(page, '/salary-guide');
    await assertBottomContentNotCovered(page, '/salary-guide');
  });

  test(`${TOOL_PATH}: no overflow, inputs tall enough to tap, footer reachable`, async ({ page }) => {
    await gotoReady(page, TOOL_PATH);
    await assertNoHorizontalOverflow(page, TOOL_PATH);
    await assertHeadingNotCovered(page, TOOL_PATH);
    const inputs = page.locator('main input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), main select');
    const count = await inputs.count();
    expect(count, 'tool renders inputs').toBeGreaterThan(0);
    for (let i = 0; i < Math.min(count, 4); i++) {
      const el = inputs.nth(i);
      if (!(await el.isVisible())) continue;
      const box = (await el.boundingBox())!;
      expect.soft(Math.round(box.height), `${TOOL_PATH}: input #${i + 1} height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
    await assertBottomContentNotCovered(page, TOOL_PATH);
  });

  test('/post-job (signed out): renders the employer sign-in gate, not the wizard', async ({ page }) => {
    await gotoReady(page, '/post-job');
    await expect(page.locator('#title')).toHaveCount(0);
    await expect(page.locator('a[href^="/login?next=/post-job"], a[href^="/employer/signup"]').first()).toBeVisible();
    await assertNoHorizontalOverflow(page, '/post-job signed out');
  });

  test('/post-job step 1 (employer): no overflow, Continue tappable, empty submit shows validation and stays on step 1', async ({ page }) => {
    test.skip(!getEmployerCreds(), 'E2E_EMPLOYER_EMAIL/PASS not set');
    await gotoWizardStep1(page);
    await assertNoHorizontalOverflow(page, '/post-job');
    const next = page.locator('button.wizard-next-btn');
    await expectTapTarget(next, '/post-job: Continue');

    // Empty submit + double-click must not advance
    await next.dblclick();
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.getByText(/at least 10 characters/i).first()).toBeVisible();

    // Too-short title keeps the error; a valid one clears it
    await page.locator('#title').fill('Short');
    await next.click();
    await expect(page.getByText(/at least 10 characters/i).first()).toBeVisible();
    await expect(page.locator('#title')).toBeVisible();
    await page.locator('#title').fill('Psychiatric Mental Health NP - E2E');
    await next.click();
    await expect(page.getByText(/at least 10 characters/i)).toHaveCount(0);
    await assertNoHorizontalOverflow(page, '/post-job with validation errors');
  });

  test('/post-job (employer): Clear-draft confirm dialog closes on Escape', async ({ page }) => {
    test.skip(!getEmployerCreds(), 'E2E_EMPLOYER_EMAIL/PASS not set');
    await gotoWizardStep1(page);
    const dialog = page.getByRole('dialog', { name: 'Clear this draft?' });
    await page.getByRole('button', { name: /^clear$/i }).click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => focusIsInside(dialog), { message: 'confirm dialog receives focus' }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#title')).toBeVisible();
  });

  test('/post-job (employer): Clear-draft confirm dialog traps focus', async ({ page }) => {
    test.skip(!getEmployerCreds(), 'E2E_EMPLOYER_EMAIL/PASS not set');
    await gotoWizardStep1(page);
    await page.getByRole('button', { name: /^clear$/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Clear this draft?' });
    await expect(dialog).toBeVisible();
    await assertFocusTrapped(page, dialog, 'confirm dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('dashboard (seeker): no overflow, H1 clear, bottom nav not covering content', async ({ page }) => {
    test.skip(!getSeekerCreds(), 'E2E_SEEKER_EMAIL/PASS not set');
    await playwrightAuth(page, 'candidate');
    await gotoReady(page, '/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await assertNoHorizontalOverflow(page, '/dashboard');
    await assertHeadingNotCovered(page, '/dashboard');
    await assertBottomContentNotCovered(page, '/dashboard');
  });

  test('employer dashboard @375: no overflow, H1 clear, bottom content reachable', async ({ page }) => {
    test.skip(!getEmployerCreds(), 'E2E_EMPLOYER_EMAIL/PASS not set');
    await playwrightAuth(page, 'employer');
    await gotoReady(page, '/employer/dashboard');
    await expect(page).toHaveURL(/\/employer\/dashboard/);
    await assertNoHorizontalOverflow(page, '/employer/dashboard');
    await assertHeadingNotCovered(page, '/employer/dashboard');
    await assertBottomContentNotCovered(page, '/employer/dashboard');
  });

  test('DEFECT: /login show-password toggle is a 24x24 tap target on mobile (below the 44px minimum)', async ({ page }) => {
    await gotoReady(page, '/login');
    await expectTapTarget(page.getByRole('button', { name: /show password/i }), '/login: show-password toggle');
  });

  test('/login @375: no overflow, inputs tappable, empty submit blocked natively, bad credentials show an alert and stay on /login', async ({ page }) => {
    await gotoReady(page, '/login');
    await assertNoHorizontalOverflow(page, '/login');
    const email = page.locator('#login-email');
    const password = page.locator('#login-password');
    const submit = page.locator('form button[type="submit"]');
    await expectTapTarget(submit, '/login: submit');
    for (const [loc, name] of [[email, 'email input'], [password, 'password input']] as const) {
      await expect(loc).toBeVisible();
      const box = (await loc.boundingBox())!;
      expect.soft(Math.round(box.height), `/login: ${name} height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }

    // Empty submit: native required validation blocks it; we stay on /login with no network round-trip.
    await submit.click();
    await expect(page).toHaveURL(/\/login/);
    expect(await email.evaluate((el: HTMLInputElement) => el.validity.valueMissing), 'empty email flagged by native validation').toBe(true);

    // Unknown account: an alert renders, nothing navigates, the form stays usable.
    await email.fill('nobody-e2e@example.invalid');
    await password.fill('definitely-not-the-password');
    await submit.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(submit).toBeEnabled();
    await assertNoHorizontalOverflow(page, '/login with error banner');
  });

  test('easy-apply modal @375 (seeker): no overflow while open, traps focus, Escape closes, reload mid-flow leaves no modal or scroll lock', async ({ page }) => {
    test.skip(!getSeekerCreds(), 'E2E_SEEKER_EMAIL/PASS not set');
    test.skip(!EASY_APPLY_SLUG, 'E2E_EASY_APPLY_JOB_SLUG not set');
    await playwrightAuth(page, 'candidate');
    await gotoReady(page, `/jobs/${EASY_APPLY_SLUG}`);
    const apply = visibleApplyButton(page);
    await expectTapTarget(apply, 'easy-apply job: Apply CTA');
    await apply.click();
    const dialog = page.getByRole('dialog', { name: 'Apply for this position' });
    await expect(dialog).toBeVisible();
    expect(await bodyScrollLock(page), 'body scroll locked while apply modal open').toBe('hidden');
    await assertNoHorizontalOverflow(page, 'easy-apply modal open @375');
    const dialogBox = (await dialog.boundingBox())!;
    expect(dialogBox.x + dialogBox.width, 'modal fits inside the viewport').toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    await assertFocusTrapped(page, dialog, 'apply modal @375');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await bodyScrollLock(page), 'body scroll unlocked after Escape').toBe('');

    // Reopen, then reload mid-flow: the page must come back with no modal and no scroll lock.
    await visibleApplyButton(page).click();
    await expect(dialog).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'About this role' })).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await bodyScrollLock(page), 'body scroll unlocked after reload').toBe('');
    await expect(visibleApplyButton(page)).toBeVisible();
  });

  test('header menu: opens as a dialog, Escape closes it, aria-expanded + scroll lock track state', async ({ page }) => {
    await gotoReady(page, '/');
    const toggle = page.getByRole('button', { name: 'Toggle menu' });
    const menu = page.getByRole('dialog', { name: 'Mobile navigation menu' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(menu).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await bodyScrollLock(page), 'body scroll locked while menu open').toBe('hidden');
    await assertNoHorizontalOverflow(page, 'home with menu open');
    const links = menu.locator('a[href]');
    const n = await links.count();
    expect(n, 'menu has links').toBeGreaterThan(0);
    for (let i = 0; i < Math.min(n, 5); i++) {
      await expectTapTarget(links.nth(i), `menu link #${i + 1}`);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await bodyScrollLock(page), 'body scroll unlocked after Escape').toBe('');
  });

  test('DEFECT: mobile navigation menu (role=dialog, aria-modal) never receives focus and does not trap Tab', async ({ page }) => {
    await gotoReady(page, '/');
    await page.getByRole('button', { name: 'Toggle menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Mobile navigation menu' });
    await expect(menu).toBeVisible();
    // Observed: focus stays on the toggle button; Tab walks the page behind the overlay.
    // components/Header.tsx mobile menu handles Escape but has no useFocusTrap.
    await assertFocusTrapped(page, menu, 'mobile menu');
  });

  test('unauthenticated: protected seeker pages redirect to /login or render a sign-in gate', async ({ page }) => {
    // /dashboard → server redirect (lib/auth/protect.ts requireAuth); /settings → client
    // redirect; /my-applications → in-page "Sign in required" gate with a Sign In link.
    for (const path of ['/dashboard', '/settings', '/my-applications']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      // /settings redirects client-side after its profile fetch 401s, so wait
      // for either outcome instead of sampling the URL at domcontentloaded.
      const signIn = page.locator('#main-content').getByRole('link', { name: /sign in/i }).or(page.locator('#main-content a[href*="/login"]')).first();
      await expect
        .poll(async () => /\/login/.test(page.url()) || (await signIn.isVisible().catch(() => false)), {
          message: `${path}: signed-out visitor is sent to /login or gets a sign-in gate`,
          timeout: 15_000,
        })
        .toBe(true);
    }
  });

  test('DEFECT: /saved renders an empty "No saved jobs yet" state to signed-out visitors instead of a sign-in gate', async ({ page }) => {
    await page.goto('/saved', { waitUntil: 'domcontentloaded' });
    // Observed: 200, "My Jobs … No saved jobs yet … Browse Jobs", no login link — the API 401 is
    // swallowed as an empty list (app/saved/page.tsx). Compare /my-applications which gates.
    const onLogin = /\/login/.test(page.url());
    if (!onLogin) {
      const signIn = page.locator('#main-content').getByRole('link', { name: /sign in/i }).or(page.locator('#main-content a[href*="/login"]')).first();
      await expect(signIn, '/saved: signed-out visitor gets a sign-in gate').toBeVisible();
    }
  });

  test('DEFECT: /settings redirects signed-out visitors to /login without a return path (next=), unlike /dashboard', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    const url = new URL(page.url());
    expect(url.searchParams.get('next') ?? url.searchParams.get('redirectTo'), '/settings login redirect carries a return path').toContain('/settings');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1b. Cookie consent (no preset cookie → strict region → banner)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('cookie consent @ 375x812', () => {
  test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

  test('banner renders above the bottom nav, Accept All tappable, no overflow, Customize exposes switches', async ({ page }) => {
    await gotoReady(page, '/');
    const banner = page.getByRole('dialog', { name: 'Cookie consent' });
    await expect(banner).toBeVisible();
    await assertNoHorizontalOverflow(page, 'home with cookie banner');
    await expectTapTarget(banner.getByRole('button', { name: 'Accept All' }), 'cookie: Accept All');

    const bannerBox = (await banner.boundingBox())!;
    const bottomNav = page.locator('.md\\:hidden.fixed.bottom-0').first();
    await expect(bottomNav).toBeVisible();
    const navBox = (await bottomNav.boundingBox())!;
    expect(bannerBox.y + bannerBox.height, 'banner sits above the bottom nav, not over it').toBeLessThanOrEqual(navBox.y + 1);

    await banner.getByRole('button', { name: 'Customize' }).click();
    const switches = banner.getByRole('switch');
    await expect(switches.first()).toBeVisible();
    for (let i = 0; i < (await switches.count()); i++) {
      await expectTapTarget(switches.nth(i), `cookie: switch #${i + 1}`);
    }
    await expectTapTarget(banner.getByRole('button', { name: 'Save Preferences' }), 'cookie: Save Preferences');
    await assertNoHorizontalOverflow(page, 'home with cookie categories expanded');
  });

  test('DEFECT: cookie banner "Decline" and "Customize" buttons are 38px tall (below the 44px tap-target minimum)', async ({ page }) => {
    await gotoReady(page, '/');
    const banner = page.getByRole('dialog', { name: 'Cookie consent' });
    await expect(banner).toBeVisible();
    // Observed 84x38 and 123x38 — components/CookieConsent.tsx uses py-2 on both.
    await expectTapTarget(banner.getByRole('button', { name: /^decline$/i }), 'cookie: Decline');
    await expectTapTarget(banner.getByRole('button', { name: 'Customize' }), 'cookie: Customize');
  });

  test('DEFECT: cookie consent dialog does not close on Escape', async ({ page }) => {
    await gotoReady(page, '/');
    const banner = page.getByRole('dialog', { name: 'Cookie consent' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Accept All' }).focus();
    await page.keyboard.press('Escape');
    // Observed: still visible. components/CookieConsent.tsx has role="dialog" but no
    // keydown handler (also no aria-modal, no focus management).
    await expect(banner).toBeHidden();
  });

  test('Decline hides the banner; Cookie Settings in the footer re-opens it', async ({ page }) => {
    await gotoReady(page, '/');
    const banner = page.getByRole('dialog', { name: 'Cookie consent' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: /^decline$/i }).click();
    await expect(banner).toBeHidden();
    await scrollToBottomInstant(page);
    await page.getByRole('button', { name: 'Cookie Settings' }).click();
    await expect(banner).toBeVisible();
  });

  test('Accept All persists across reload (same-origin POST)', async ({ page, baseURL }) => {
    // lib/csrf.ts only accepts localhost / NEXT_PUBLIC_BASE_URL Origins, so the
    // persistence round-trip is exercised from the localhost origin when the
    // suite runs at 127.0.0.1. Skips if that origin is not reachable.
    const origin = new URL(baseURL!).hostname === '127.0.0.1' ? baseURL!.replace('127.0.0.1', 'localhost') : baseURL!;
    const reachable = await page.request.get(`${origin}/`, { timeout: 15_000 }).then((r) => r.ok()).catch(() => false);
    test.skip(!reachable, `${origin} not reachable`);

    await page.goto(`${origin}/faq`, { waitUntil: 'domcontentloaded' });
    const banner = page.getByRole('dialog', { name: 'Cookie consent' });
    await expect(banner).toBeVisible();
    const consentPost = page.waitForResponse((r) => /\/api\/consent/.test(r.url()) && r.request().method() === 'POST');
    await banner.getByRole('button', { name: 'Accept All' }).click();
    const res = await consentPost;
    expect(res.status(), 'POST /api/consent succeeds').toBeLessThan(400);
    await expect(banner).toBeHidden();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#main-content')).toBeVisible();
    // Banner shows 1.5s after mount when no consent is recorded; wait past that window.
    await page.waitForFunction(() => performance.now() > 3_000);
    await expect(banner).toBeHidden();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. axe-core sweep
// ═══════════════════════════════════════════════════════════════════════════

const AXE_PAGES: { path: string; label: string }[] = [
  { path: '/', label: 'home' },
  { path: '/jobs', label: 'jobs' },
  { path: '/post-job', label: 'post-job' },
  { path: TOOL_PATH, label: 'tool: 1099 vs W2' },
  { path: SECOND_TOOL_PATH, label: 'tool: salary benchmark' },
  { path: '/salary-guide', label: 'salary-guide' },
  { path: '/scope-of-practice', label: 'scope-of-practice' },
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/compare', label: 'compare' },
  { path: '/reports', label: 'reports' },
  { path: '/faq', label: 'faq' },
  { path: '/accessibility', label: 'accessibility' },
];

test.describe('axe-core', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await presetConsentCookie(page, baseURL!);
  });

  for (const { path, label } of AXE_PAGES) {
    test(`axe: ${label} (${path})`, async ({ page }, testInfo) => {
      await gotoReady(page, path);
      if (path === '/jobs') await expect(page.locator('section[aria-label="Job results"]')).toBeVisible();
      const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
      annotateAxe(testInfo, result.all);
      expect(result.serious, `${label}: serious/critical axe violations`).toEqual([]);
    });
  }

  test('DEFECT: axe aria-prohibited-attr — job detail "Verified employer" badge is a <div aria-label> with no role', async ({ page }, testInfo) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    // app/jobs/[slug]/page.tsx:983 — aria-label on a generic div is prohibited; needs role="img" (or sr-only text).
    const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
    annotateAxe(testInfo, result.all);
    expect(result.serious, 'job detail: serious/critical axe violations').toEqual([]);
  });

  test('axe: dashboard (seeker)', async ({ page }, testInfo) => {
    test.skip(!getSeekerCreds(), 'E2E_SEEKER_EMAIL/PASS not set');
    await playwrightAuth(page, 'candidate');
    await gotoReady(page, '/dashboard');
    const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
    annotateAxe(testInfo, result.all);
    expect(result.serious, 'dashboard: serious/critical axe violations').toEqual([]);
  });

  test.describe('mobile viewport', () => {
    test.use({ viewport: MOBILE_VIEWPORT });
    for (const { path, label } of [{ path: '/', label: 'home' }, { path: '/jobs', label: 'jobs' }]) {
      test(`axe @375: ${label}`, async ({ page }, testInfo) => {
        await gotoReady(page, path);
        const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
        annotateAxe(testInfo, result.all);
        expect(result.serious, `${label} @375: serious/critical axe violations`).toEqual([]);
      });
    }
  });

  test('axe: job detail (every rule except the two tracked defects)', async ({ page }, testInfo) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    // aria-prohibited-attr is tracked by its own DEFECT test above; keep the page in the sweep for everything else.
    const result = await runAxe(page, { disableRules: [...SITE_WIDE_AXE_DEFECTS, 'aria-prohibited-attr'] });
    annotateAxe(testInfo, result.all);
    expect(result.serious, 'job detail: serious/critical axe violations').toEqual([]);
  });

  test('axe: employer dashboard', async ({ page }, testInfo) => {
    test.skip(!getEmployerCreds(), 'E2E_EMPLOYER_EMAIL/PASS not set');
    await playwrightAuth(page, 'employer');
    await gotoReady(page, '/employer/dashboard');
    const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
    annotateAxe(testInfo, result.all);
    expect(result.serious, 'employer dashboard: serious/critical axe violations').toEqual([]);
  });

  test('axe: /post-job step 1 (employer wizard)', async ({ page }, testInfo) => {
    test.skip(!getEmployerCreds(), 'E2E_EMPLOYER_EMAIL/PASS not set');
    await gotoWizardStep1(page);
    const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
    annotateAxe(testInfo, result.all);
    expect(result.serious, '/post-job step 1: serious/critical axe violations').toEqual([]);
  });

  test('axe: /jobs with the create-alert modal open', async ({ page }, testInfo) => {
    await gotoJobsReady(page, '/jobs?q=telehealth');
    await page.locator('button.jp-alert-btn').click();
    await expect(page.locator('[role="dialog"][aria-labelledby="create-alert-title"]')).toBeVisible();
    const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
    annotateAxe(testInfo, result.all);
    expect(result.serious, '/jobs + create-alert modal: serious/critical axe violations').toEqual([]);
  });

  test.describe('mobile viewport (overlays open)', () => {
    test.use({ viewport: MOBILE_VIEWPORT, hasTouch: true });

    test('axe @375: /jobs with the filter drawer open', async ({ page }, testInfo) => {
      await gotoJobsReady(page);
      await page.locator('button.jp-mobile-filter-btn').click();
      await expect(page.getByRole('dialog', { name: 'Filter jobs' })).toBeVisible();
      const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
      annotateAxe(testInfo, result.all);
      expect(result.serious, '/jobs + filter drawer @375: serious/critical axe violations').toEqual([]);
    });

    test('axe @375: home with the navigation menu open', async ({ page }, testInfo) => {
      await gotoReady(page, '/');
      await page.getByRole('button', { name: 'Toggle menu' }).click();
      await expect(page.getByRole('dialog', { name: 'Mobile navigation menu' })).toBeVisible();
      const result = await runAxe(page, { disableRules: SITE_WIDE_AXE_DEFECTS });
      annotateAxe(testInfo, result.all);
      expect(result.serious, 'home + mobile menu @375: serious/critical axe violations').toEqual([]);
    });

    test('axe @375: job detail (every rule except the two tracked defects)', async ({ page }, testInfo) => {
      test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
      await gotoReady(page, `/jobs/${JOB_SLUG}`);
      const result = await runAxe(page, { disableRules: [...SITE_WIDE_AXE_DEFECTS, 'aria-prohibited-attr'] });
      annotateAxe(testInfo, result.all);
      expect(result.serious, 'job detail @375: serious/critical axe violations').toEqual([]);
    });
  });

  // Reverify round 2 (fresh build): still failing after the fix wave on /jobs
  // (header > p #6B7F8A on #F5F0EB 3.68:1 in app/jobs/JobsPageClient.tsx; "About This Board"
  // #E86C2C on #FDFBF7 3.07:1 in app/jobs/page.tsx) and on /tools/1099-vs-w2-calculator
  // ("Model last reviewed" line #94A3B8 on #FFFFFF 2.56:1). Home, /salary-guide and /login are clean.
  // Round 3 fix wave moved those three nodes to compliant colours; re-armed as a live test.
  test('axe color-contrast (serious) is clean on the sampled pages: footer legal links, breadcrumb spans, tool hints, salary pills', async ({ page }, testInfo) => {
    // Observed on all 15 pages. Recurring nodes: footer a[href$="privacy"|"terms"|"security"]
    // (#78716c on #1c1917, components/Footer.tsx), .bc-link > span (breadcrumbs), .sal-stat-pill
    // spans (/salary-guide, 66 nodes), #takehome-*-hint (/tools/1099-vs-w2-calculator, 30 nodes),
    // .jc-card p on /jobs (64 nodes), login/signup role-toggle button + helper text.
    const failures: string[] = [];
    for (const { path, label } of [AXE_PAGES[0], AXE_PAGES[1], AXE_PAGES[3], AXE_PAGES[5], AXE_PAGES[7]]) {
      await gotoReady(page, path);
      // Let entrance fades (.animate-fade-in-up on /jobs cards) settle: axe blends
      // mid-animation opacity into the foreground and reports false contrast nodes.
      // The /jobs cards arrive from a client fetch, so wait for them before polling.
      if (path === '/jobs') await expect(page.locator('.jc-card').first()).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime as number)).length), { timeout: 15_000 })
        .toBe(0)
        .catch(() => undefined);
      const result = await runAxe(page, { onlyRules: ['color-contrast'] });
      annotateAxe(testInfo, result.all);
      failures.push(...result.serious.map((v) => `${label}: ${v}`));
    }
    expect(failures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Keyboard-only
// ═══════════════════════════════════════════════════════════════════════════

test.describe('keyboard-only', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await presetConsentCookie(page, baseURL!);
  });

  for (const path of ['/', '/jobs']) {
    test(`skip link is first in tab order, becomes visible, and moves focus into main (${path})`, async ({ page }) => {
      await gotoReady(page, path);
      await page.keyboard.press('Tab');
      const skip = page.locator('a.skip-to-content');
      await expect(skip).toBeFocused();
      const box = (await skip.boundingBox())!;
      expect(box.x, 'skip link is on-screen while focused').toBeGreaterThanOrEqual(0);
      expect(box.y, 'skip link is on-screen while focused').toBeGreaterThanOrEqual(0);
      expect(await activeElementHasFocusRing(page), 'skip link paints a focus ring').toBe(true);
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => location.hash)).toBe('#main-content');
      await page.keyboard.press('Tab');
      const inMain = await page.evaluate(() => !!document.activeElement && !!document.getElementById('main-content')?.contains(document.activeElement));
      expect(inMain, `after activating the skip link, the next Tab lands inside <main> (got ${await activeElementDescription(page)})`).toBe(true);
    });
  }

  test('DEFECT: desktop nav pills (a.nav-pill-floating) have no visible focus indicator — inline boxShadow:none overrides the global :focus-visible ring', async ({ page }) => {
    await gotoJobsReady(page);
    // app/globals.css `*:focus-visible { outline: none; box-shadow: … }` is beaten by the inline
    // style boxShadow (components/Header.tsx ~287) on non-active pills → neither outline nor shadow.
    const missing: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      if (!(await activeElementHasFocusRing(page))) missing.push(`#${i + 1} ${await activeElementDescription(page)}`);
    }
    expect(missing, 'tab stops without a visible focus ring').toEqual([]);
  });

  test('/jobs: non-nav tab stops paint a visible focus indicator', async ({ page }) => {
    await gotoJobsReady(page);
    const missing: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const desc = await activeElementDescription(page);
      if (/nav-pill-floating/.test(desc)) continue; // tracked by the DEFECT test above
      if (!(await activeElementHasFocusRing(page))) missing.push(`#${i + 1} ${desc}`);
    }
    expect(missing, 'tab stops without a visible focus ring').toEqual([]);
  });

  test('/jobs: create-alert modal traps focus and closes on Escape', async ({ page }) => {
    await gotoJobsReady(page, '/jobs?q=telehealth');
    const trigger = page.locator('button.jp-alert-btn');
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[role="dialog"][aria-labelledby="create-alert-title"]');
    await expect(dialog).toBeVisible();
    await assertFocusTrapped(page, dialog, 'create-alert modal');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => activeElementDescription(page), { message: 'focus restored to the alert trigger' }).toContain('jp-alert-btn');
  });

  test('/jobs: create-alert form rejects an empty and a malformed email inline (keyboard-only) without closing the modal', async ({ page }) => {
    await gotoJobsReady(page, '/jobs?q=telehealth');
    await page.locator('button.jp-alert-btn').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[role="dialog"][aria-labelledby="create-alert-title"]');
    await expect(dialog).toBeVisible();
    const email = dialog.locator('#email');
    await expect(email).toBeVisible();
    await expect(dialog.locator('label[for="email"]'), 'email input has a programmatic label').toBeVisible();
    const submit = dialog.locator('button[type="submit"]');

    // Empty submit via keyboard: inline error, no request, modal stays open.
    let posted = 0;
    page.on('request', (r) => { if (/\/api\/job-alerts/.test(r.url()) && r.method() === 'POST') posted++; });
    await submit.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByText('Email address is required.')).toBeVisible();
    await expect(dialog).toBeVisible();

    // "a@b" passes the browser's type=email check but not the form's pattern.
    await email.fill('a@b');
    await email.press('Enter');
    await expect(dialog.getByText('Please enter a valid email address.')).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(posted, 'no POST /api/job-alerts was sent for invalid input').toBe(0);

    // Escape still closes after validation errors and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => activeElementDescription(page)).toContain('jp-alert-btn');
  });

  test('easy-apply modal (seeker): traps focus, Escape closes, scroll lock released', async ({ page }) => {
    test.skip(!getSeekerCreds(), 'E2E_SEEKER_EMAIL/PASS not set');
    test.skip(!EASY_APPLY_SLUG, 'E2E_EASY_APPLY_JOB_SLUG not set');
    await playwrightAuth(page, 'candidate');
    await gotoReady(page, `/jobs/${EASY_APPLY_SLUG}`);
    const apply = visibleApplyButton(page);
    await expect(apply).toBeVisible();
    await apply.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Apply for this position' });
    await expect(dialog).toBeVisible();
    await assertFocusTrapped(page, dialog, 'apply modal');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await bodyScrollLock(page), 'body scroll unlocked after apply modal closes').toBe('');
  });

  test('DEFECT: closing the Easy Apply modal drops focus to <body> — the Apply button is re-mounted while the modal is open so useFocusTrap restores focus to a detached node', async ({ page }) => {
    test.skip(!getSeekerCreds(), 'E2E_SEEKER_EMAIL/PASS not set');
    test.skip(!EASY_APPLY_SLUG, 'E2E_EASY_APPLY_JOB_SLUG not set');
    await playwrightAuth(page, 'candidate');
    await gotoReady(page, `/jobs/${EASY_APPLY_SLUG}`);
    const apply = visibleApplyButton(page);
    await apply.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Apply for this position' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Probe: the button tagged before opening is gone from the DOM while the modal is open
    // (components/ApplyButton.tsx); lib/hooks/useFocusTrap.ts then calls .focus() on the
    // detached element and focus lands on <body>.
    await expect.poll(() => activeElementDescription(page), { message: 'focus restored to Apply after Escape' }).toMatch(/apply/i);
  });

  test('job detail: report dialog is fully keyboard operable', async ({ page }) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    const trigger = page.getByRole('button', { name: 'Report this job' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Report Job' });
    await expect(dialog).toBeVisible();
    await assertFocusTrapped(page, dialog, 'report dialog');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. prefers-reduced-motion
// ═══════════════════════════════════════════════════════════════════════════

test.describe('prefers-reduced-motion', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    // Applies to every subsequent navigation on this page (matchMedia + CSS media queries).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await presetConsentCookie(page, baseURL!);
  });

  test('home: CSS honours reduced motion (smooth scrolling off, hero visible)', async ({ page }) => {
    await gotoReady(page, '/');
    const h1 = page.locator('main h1').first();
    await expect(h1).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'smooth scrolling disabled').toBe('auto');
    await expect(h1).toHaveCSS('opacity', '1');
  });

  test('DEFECT: HomepageHero framer-motion entrance (translateY + opacity stagger) runs under prefers-reduced-motion', async ({ page }) => {
    await installMotionRecorder(page);
    await gotoReady(page, '/');
    await expect(page.locator('main h1').first()).toBeVisible();
    // Observed: h1, subtitle <p>, search <form> and the chip row each tween translateY(12px→0)
    // over ~23 frames plus WAAPI opacity. components/HomepageHero.tsx uses m.div variants with
    // initial="hidden" animate="show" and never calls useReducedMotion / MotionConfig.
    const log = await readMotionLog(page, ENTRANCE_WINDOW_MS);
    expect.soft(log.transformTweens, 'elements tweened via inline transform under reduced motion').toEqual([]);
    expect.soft(log.runningAnimations, 'transform/opacity animations ran under reduced motion').toEqual([]);
  });

  test('DEFECT: mobile navigation menu fades in (opacity animation) under prefers-reduced-motion', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await installMotionRecorder(page);
    await gotoReady(page, '/');
    await readMotionLog(page, ENTRANCE_WINDOW_MS); // let the page's own entrance drain first
    const before = await readMotionLog(page, 0);
    await page.getByRole('button', { name: 'Toggle menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Mobile navigation menu' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS('opacity', '1');
    // Observed: div#mobile-nav-menu animates opacity (components/Header.tsx AnimatePresence
    // initial/animate/exit opacity, no useReducedMotion).
    const after = await readMotionLog(page, before.observedMs + 600);
    const newAnimations = after.runningAnimations.filter((a) => !before.runningAnimations.includes(a) && /mobile-nav-menu|dialog/i.test(a));
    expect(newAnimations, 'mobile menu animated opacity/transform under reduced motion').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Copy rule: no em/en dashes in rendered copy (employer-authored job data excluded)
// ═══════════════════════════════════════════════════════════════════════════

/** Employer-authored job data the copy rule does not cover. */
const JOB_DATA_EXCLUDES = ['.job-description-html', 'section[aria-label="Job results"]', 'a[href^="/jobs/"]'];

const DASH_PAGES: { path: string; label: string; exclude?: string[] }[] = [
  { path: '/', label: 'home', exclude: ['a[href^="/jobs/"]'] },
  { path: '/jobs', label: 'jobs', exclude: JOB_DATA_EXCLUDES },
  { path: '/salary-guide', label: 'salary-guide' },
  { path: TOOL_PATH, label: 'tool: 1099 vs W2' },
  { path: SECOND_TOOL_PATH, label: 'tool: salary benchmark' },
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/post-job', label: 'post-job (signed out)' },
  { path: '/faq', label: 'faq' },
  { path: '/compare', label: 'compare' },
  { path: '/reports', label: 'reports' },
  { path: '/scope-of-practice', label: 'scope-of-practice' },
  { path: '/accessibility', label: 'accessibility' },
];

test.describe('copy rule: no em/en dashes', () => {
  // No consent preset here on purpose: the cookie banner's copy is scanned too.
  for (const { path, label, exclude } of DASH_PAGES) {
    test(`no dashes: ${label} (${path})`, async ({ page }) => {
      await gotoReady(page, path);
      if (path === '/jobs') await expect(page.locator('section[aria-label="Job results"]')).toBeVisible();
      // Bare auth routes (/login, /signup) render without site chrome, which
      // includes the cookie banner (components/LayoutShell.tsx BARE_ROUTES).
      if (!['/login', '/signup'].includes(path)) await expect(page.getByRole('dialog', { name: 'Cookie consent' })).toBeVisible();
      const hits = await findDashesInVisibleText(page, exclude);
      expect(hits, `${label}: rendered copy with em/en dashes`).toEqual([]);
    });
  }

  test('no dashes: home with the mobile menu open @375', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await gotoReady(page, '/');
    await page.getByRole('button', { name: 'Toggle menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Mobile navigation menu' })).toBeVisible();
    const hits = await findDashesInVisibleText(page, ['a[href^="/jobs/"]']);
    expect(hits, 'mobile menu: rendered copy with em/en dashes').toEqual([]);
  });

  test('no dashes: job detail chrome (description, title and related-job links excluded)', async ({ page }) => {
    test.skip(!JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await gotoReady(page, `/jobs/${JOB_SLUG}`);
    const hits = await findDashesInVisibleText(page, [...JOB_DATA_EXCLUDES, 'h1']);
    expect(hits, 'job detail chrome: rendered copy with em/en dashes').toEqual([]);
  });

  test('no dashes: seeker dashboard', async ({ page }) => {
    test.skip(!getSeekerCreds(), 'E2E_SEEKER_EMAIL/PASS not set');
    await playwrightAuth(page, 'candidate');
    await gotoReady(page, '/dashboard');
    const hits = await findDashesInVisibleText(page, ['a[href^="/jobs/"]']);
    expect(hits, 'dashboard: rendered copy with em/en dashes').toEqual([]);
  });

  test('no dashes: /post-job step 1 (employer)', async ({ page }) => {
    test.skip(!getEmployerCreds(), 'E2E_EMPLOYER_EMAIL/PASS not set');
    await gotoWizardStep1(page);
    const hits = await findDashesInVisibleText(page);
    expect(hits, '/post-job step 1: rendered copy with em/en dashes').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Unauthenticated access to the surfaces this sweep touches
// ═══════════════════════════════════════════════════════════════════════════

test.describe('unauthenticated access', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await presetConsentCookie(page, baseURL!);
  });

  test('protected pages redirect to /login (server-side), keeping a return path', async ({ page }) => {
    for (const path of ['/dashboard', '/employer/dashboard', '/admin', '/onboarding/professional']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page, `${path}: signed-out visitor lands on /login`).toHaveURL(/\/login/);
      const url = new URL(page.url());
      expect(url.searchParams.get('next') ?? url.searchParams.get('redirectTo'), `${path}: login redirect carries a return path`).toContain(path);
    }
  });

  test('API surfaces behind the pages: 401 for session-scoped reads, 400 (never 500) for malformed public writes', async ({ page }) => {
    const headers = { Origin: MUT_ORIGIN, 'x-forwarded-for': uniqueIp() };
    const savedJobs = await page.request.get('/api/saved-jobs', { headers });
    expect(savedJobs.status(), 'GET /api/saved-jobs signed out').toBe(401);

    // Public, email-based alert creation: validation must reject junk with a JSON 400.
    const empty = await page.request.post(`${MUT_ORIGIN}/api/job-alerts`, { headers, data: {} });
    expect(empty.status(), 'POST /api/job-alerts {} -> 400').toBe(400);
    expect((await empty.json()).error, 'validation error message present').toBeTruthy();

    const badEmail = await page.request.post(`${MUT_ORIGIN}/api/job-alerts`, { headers, data: { email: 'not-an-email', frequency: 'daily' } });
    expect(badEmail.status(), 'POST /api/job-alerts bad email -> 400').toBe(400);

    const badFrequency = await page.request.post(`${MUT_ORIGIN}/api/job-alerts`, { headers, data: { email: 'nobody-e2e@example.invalid', frequency: 'hourly' } });
    expect(badFrequency.status(), 'POST /api/job-alerts bad frequency -> 400').toBe(400);

    const noToken = await page.request.get('/api/job-alerts', { headers });
    expect(noToken.status(), 'GET /api/job-alerts without a token -> 400').toBe(400);

    // Wrong-origin browser mutation is rejected by lib/csrf.ts with 403, never 500.
    const crossOrigin = await page.request.post('/api/job-alerts', { headers: { Origin: 'https://evil.example', 'x-forwarded-for': uniqueIp() }, data: { email: 'nobody-e2e@example.invalid', frequency: 'daily' } });
    expect(crossOrigin.status(), 'POST /api/job-alerts from a foreign Origin -> 403').toBe(403);
  });
});

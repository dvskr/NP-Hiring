import { test as base, expect as baseExpect, type Page, type BrowserContext, type Browser, type APIRequestContext } from '@playwright/test';
import { brand } from '../../../config/brand';
import { playwrightAuth } from '../helpers/auth';
import { getSeekerCreds, getEmployerCreds } from '../fixtures/auth';
import * as db from '../helpers/messaging-db';
import { uniqueIp } from '../helpers/candidate';

/**
 * Messaging + retention journey.
 *
 *   Messaging  — employer → candidate InMail from the applicant thread,
 *                candidate inbox (unread state, keyboard rows, labeled back
 *                button on mobile), reply, edit (sanitized + 2000 cap),
 *                delete-conversation confirm, API error panels with Retry.
 *   Retention  — job alert create/manage/pause/downsell/unsubscribe-token
 *                flow, RFC 8058 one-click unsubscribe idempotency,
 *                /unsubscribe + resubscribe, /email-preferences saves,
 *                push-notification prompt dismissal persistence.
 *
 * Requirements (each test `test.skip`s cleanly when missing):
 *   E2E_SEEKER_EMAIL/PASS, E2E_EMPLOYER_EMAIL/PASS  — role logins
 *   DATABASE_URL (dev DB)                            — seeds a featured probe
 *                                                      posting + application,
 *                                                      reads email tokens,
 *                                                      cleans up after itself
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY                     — push prompt test only
 *
 * Run against the production build with the host the CSRF gate accepts
 * (lib/csrf.ts allows http://localhost:3000, not 127.0.0.1, for mutations):
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test messaging-alerts --reporter=list
 */

// The production server is shared with every journey agent and the dev DB is
// remote; a first-party fetch can take well over the 15s config default. Each
// assertion still waits on a condition, only the ceiling is raised.
const expect = baseExpect.configure({ timeout: 35_000 });

const SEEKER = getSeekerCreds();
const EMPLOYER = getEmployerCreds();
const AGAINST_PROD =
  !!process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_BASE_URL.includes(brand.domain);
const HAS_DB = db.dbAvailable();
const MESSAGING_READY = !!SEEKER && !!EMPLOYER && HAS_DB && !AGAINST_PROD;
const ALERTS_READY = !!SEEKER && HAS_DB && !AGAINST_PROD;

/* ─────────────────────────────────────────────────────────────────────────
 * Console / pageerror guard — every visited page fails the test on an
 * uncaught exception or a first-party console.error. Third-party and
 * resource-load noise is filtered; tests that deliberately break an API
 * call `guard.allow(/pattern/)` for the app's own logged error.
 * ───────────────────────────────────────────────────────────────────────── */

const CONSOLE_NOISE: RegExp[] = [
  /Failed to load resource/i,            // Chromium's line for any non-2xx fetch
  /favicon/i,
  /googletagmanager|google-analytics|gstatic|doubleclick|vercel\.live|vercel-insights|beehiiv|sentry|hotjar|clarity|posthog|stripe\.com/i,
  /third-party cookie/i,
  /ERR_BLOCKED_BY_CLIENT|net::ERR_/i,
  /Download the React DevTools/i,
  /service ?worker|push-sw\.js/i,
  /preloaded using link preload/i,
  // Supabase's client-side getUser() fetch aborted by the test navigating
  // away mid-request; not an app error.
  /TypeError: Failed to fetch[\s\S]*_getUser/,
];

interface ConsoleGuard {
  errors: string[];
  pageErrors: string[];
  allow: (re: RegExp) => void;
  assertClean: (label?: string) => void;
  reset: () => void;
}

function guardConsole(page: Page): ConsoleGuard {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const allowed: RegExp[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_NOISE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(`${err.name}: ${err.message}`);
  });
  return {
    errors,
    pageErrors,
    allow: (re) => allowed.push(re),
    assertClean: (label = 'page') => {
      const unexpected = errors.filter((e) => !allowed.some((re) => re.test(e)));
      expect(pageErrors, `${label}: uncaught page errors`).toEqual([]);
      expect(unexpected, `${label}: unexpected console errors`).toEqual([]);
    },
    reset: () => {
      errors.length = 0;
      pageErrors.length = 0;
      allowed.length = 0;
    },
  };
}

const test = base.extend<{ guard: ConsoleGuard }>({
  guard: async ({ page }, provide) => {
    const guard = guardConsole(page);
    await provide(guard);
    guard.assertClean();
  },
});

/**
 * lib/csrf.ts accepts mutations only from http://localhost:3000 (or the
 * served origin), never from http://127.0.0.1:3000. Nearly every block here
 * mutates, and cookies are host-scoped, so the whole spec runs on the
 * mutation origin regardless of the PLAYWRIGHT_BASE_URL the runner passed.
 */
const RUNNER_BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const MUT_ORIGIN =
  process.env.PLAYWRIGHT_MUTATION_BASE_URL ||
  (RUNNER_BASE.includes('127.0.0.1') ? RUNNER_BASE.replace('127.0.0.1', 'localhost') : RUNNER_BASE);
test.use({ baseURL: MUT_ORIGIN });

// The production server is shared with the other journey agents and the dev
// database is remote (~450ms per query), so a page can legitimately take
// 10s+ to answer. Give each test twice the config budget; every wait is
// still condition-based, never a sleep.
test.describe.configure({ timeout: 120_000 });

/* ─────────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ───────────────────────────────────────────────────────────────────────── */

interface RoleSession {
  context: BrowserContext;
  page: Page;
  guard: ConsoleGuard;
  request: APIRequestContext;
}

/**
 * Record a "deny all" cookie-consent choice for this context BEFORE the
 * first navigation. The dev server classifies local traffic as a strict
 * region, so every fresh context otherwise gets the consent banner — a
 * z-index 9990 fixed dialog that intercepts clicks on anything near the
 * bottom of the viewport (see the 'consent banner must not cover the
 * compose dialog' test for the defect that surfaces).
 */
async function presetConsent(page: Page): Promise<void> {
  const res = await page.request.post('/api/consent', { data: { categories: { analytics: false, marketing: false } } });
  expect(res.ok(), 'POST /api/consent (test setup)').toBe(true);
}

async function openSession(
  browser: Browser,
  role: 'candidate' | 'employer',
  options: { viewport?: { width: number; height: number }; keepConsentBanner?: boolean } = {},
): Promise<RoleSession> {
  // A context created in beforeAll does not inherit test.use() options, so
  // the mutation origin is passed explicitly (relative URLs otherwise throw).
  const context = await browser.newContext({
    baseURL: MUT_ORIGIN,
    ...(options.viewport ? { viewport: options.viewport } : {}),
    extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() },
  });
  const page = await context.newPage();
  const guard = guardConsole(page);
  if (!options.keepConsentBanner) await presetConsent(page);
  await login(page, role);
  return { context, page, guard, request: context.request };
}

// Every test's default page starts with consent recorded so the banner
// never races a click; tests that need the banner open a session with
// `keepConsentBanner: true`.
test.beforeEach(async ({ page }) => {
  // lib/rate-limit.ts keys its buckets on x-forwarded-for. The job-alert
  // bucket is 10 req/min and the server is shared with other test runs, so
  // every test gets its own client IP; the app's behaviour is unchanged.
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': uniqueIp() });
  await presetConsent(page);
});

/**
 * Role login through the shared helper. The helper's post-login wait is a
 * fixed 20s; on this shared server the first navigation after a cold route
 * can exceed that, so one retry is allowed before the test is failed.
 */
async function login(page: Page, role: 'candidate' | 'employer'): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await playwrightAuth(page, role);
      return;
    } catch (err) {
      if (attempt >= 3 || !/Timeout|timeout/.test(String(err))) throw err;
    }
  }
}

interface ConversationSummary {
  id: string;
  subject: string;
  unreadCount: number;
  otherUser: { name: string; role: string };
  lastMessage: { preview: string; isFromMe: boolean } | null;
}

async function listConversations(request: APIRequestContext): Promise<{ conversations: ConversationSummary[]; totalUnread: number }> {
  const res = await request.get('/api/conversations');
  expect(res.status(), 'GET /api/conversations').toBe(200);
  return res.json();
}

interface ThreadMessage {
  id: string;
  body: string;
  isFromMe: boolean;
  readAt: string | null;
  editedAt: string | null;
}

async function readThread(request: APIRequestContext, convId: string): Promise<{ messages: ThreadMessage[] }> {
  const res = await request.get(`/api/conversations/${convId}`);
  expect(res.status(), `GET /api/conversations/${convId}`).toBe(200);
  return res.json();
}

/**
 * Set in beforeAll. When the employer dashboard cannot render (it 500s when
 * the server's Prisma client and the dev DB disagree on employer_jobs
 * columns), the dialog tests skip with that reason and candidate-side tests
 * seed the InMail through the same API the dialog calls.
 */
let employerDashboardOk = true;
let inMailApiFallback: ((body: string) => Promise<void>) | null = null;
const DASHBOARD_SKIP_REASON =
  'Employer dashboard returns 500 in this environment (server Prisma client generated from a schema with columns the dev DB lacks); applicant-thread dialog unreachable';

/** Employer → candidate InMail through the real applicant-thread dialog. */
async function sendInMailViaDialog(employer: RoleSession, candidateName: string, body: string): Promise<void> {
  if (!employerDashboardOk && inMailApiFallback) {
    await inMailApiFallback(body);
    return;
  }
  const { page } = employer;
  await page.goto('/employer/dashboard?tab=applicants');
  const messageBtn = page.getByRole('button', { name: `Message ${candidateName}` }).first();
  await expect(messageBtn, 'Message button on the applicant card (featured posting)').toBeVisible();
  await messageBtn.click();
  const dialog = page.getByRole('dialog', { name: 'New Message' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#compose-body').fill(body);
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  // Wait for the dialog to report either outcome, then assert success so a
  // rejected send fails with the server's message instead of a bare timeout.
  const success = dialog.getByText('Message sent successfully!');
  const failure = dialog.locator('[role="alert"], .text-red-500, .text-red-600').filter({ hasText: /\S/ });
  await expect(success.or(failure).first()).toBeVisible({ timeout: 30_000 });
  const failureText = (await failure.count()) ? await failure.first().innerText() : '';
  expect(failureText, 'InMail send rejected by the server').toBe('');
  await expect(success).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

/* ═════════════════════════════════════════════════════════════════════════
 * MESSAGING
 * ═════════════════════════════════════════════════════════════════════════ */

test.describe('messaging: employer InMail → candidate inbox', () => {
  let fixture: db.MessagingFixture | null = null;
  let employer: RoleSession | null = null;
  let candidateName = '';
  let employerName = '';

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    test.skip(!MESSAGING_READY, 'Needs seeker + employer creds and a dev DATABASE_URL (not prod)');
    fixture = await db.seedMessagingFixture(SEEKER!.email, EMPLOYER!.email);
    candidateName = [fixture.seeker.firstName, fixture.seeker.lastName].filter(Boolean).join(' ') || 'PMHNP Candidate';
    employerName = [fixture.employer.firstName, fixture.employer.lastName].filter(Boolean).join(' ');
    employer = await openSession(browser, 'employer');
    const dash = await employer.page.goto('/employer/dashboard?tab=applicants');
    employerDashboardOk = !!dash && dash.status() < 500;
    if (!employerDashboardOk) employer.guard.reset();
    const f = fixture;
    const emp = employer;
    inMailApiFallback = async (body: string) => {
      const res = await emp.request.post('/api/employer/messages', {
        data: { recipientId: f.seeker.supabaseId, subject: `Regarding: ${f.jobTitle}`, body, jobId: f.jobId },
        timeout: 90_000,
      });
      expect(res.status(), `InMail API fallback: ${await res.text()}`).toBe(200);
    };
  });

  test.afterAll(async () => {
    if (employer) {
      await employer.context.close().catch(() => undefined);
      employer = null;
    }
    if (MESSAGING_READY) {
      await db.cleanupMessagingFixture(SEEKER!.email, EMPLOYER!.email).catch(() => undefined);
    }
    await db.closeDb();
  });

  test.beforeEach(() => {
    test.skip(!MESSAGING_READY, 'Needs seeker + employer creds and a dev DATABASE_URL (not prod)');
    employer?.guard.reset();
  });

  test.afterEach(() => {
    employer?.guard.assertClean('employer page');
  });

  /** Later tests are independent of test order: make sure one InMail exists. */
  async function ensureInMail(candidate: RoleSession, body = 'Hi, we would like to talk about the telehealth role.'): Promise<ConversationSummary> {
    const { conversations } = await listConversations(candidate.request);
    if (conversations.length > 0) return conversations[0];
    await sendInMailViaDialog(employer!, candidateName, body);
    const after = await listConversations(candidate.request);
    expect(after.conversations.length).toBeGreaterThan(0);
    return after.conversations[0];
  }

  test('unauthenticated: /messages redirects to login and every messaging API rejects', async ({ page, request, guard }) => {
    guard.allow(/AuthSessionMissingError|Auth session missing/i);
    await page.goto('/messages');
    await expect(page).toHaveURL(/\/login/);
    // The return target travels in a param the login page honours (redirectTo or next).
    const loginParams = new URL(page.url()).searchParams;
    expect(loginParams.get('redirectTo') ?? loginParams.get('next')).toBe('/messages');

    expect((await request.get('/api/conversations')).status()).toBe(401);
    expect((await request.get('/api/conversations/does-not-exist')).status()).toBe(401);
    expect((await request.post('/api/conversations/does-not-exist', { data: { body: 'x' } })).status()).toBe(401);
    expect((await request.delete('/api/conversations/does-not-exist')).status()).toBe(401);
    expect((await request.patch('/api/conversations/x/messages/y/edit', { data: { body: 'x' } })).status()).toBe(401);
    expect((await request.delete('/api/conversations/x/messages/y')).status()).toBe(401);
    expect((await request.post('/api/employer/messages', { data: { recipientId: 'x', subject: 's', body: 'b' } })).status()).toBe(401);
    expect((await request.get('/api/employer/messages')).status()).toBe(401);
  });

  // DEFECT: /messages sends ?redirect= but /login only honours redirectTo/next
  test('unauthenticated: signing in from the /messages redirect lands back on /messages', async ({ page, guard }) => {
    // /messages sends the visitor to /login?redirect=/messages; after a
    // successful sign-in the return target must be honored, otherwise a
    // candidate following an email's "Reply Now" link is dumped on the
    // dashboard and has to find their inbox by hand.
    guard.allow(/AuthSessionMissingError|Auth session missing/i);
    await page.goto('/messages');
    await expect(page).toHaveURL(/\/login\?/);
    await page.fill('input[type="email"]', SEEKER!.email);
    await page.fill('input[type="password"]', SEEKER!.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
    expect(new URL(page.url()).pathname, 'post-login return target from the /messages redirect').toBe('/messages');
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  });

  // DEFECT: Conversation reply and employer send APIs return 500 on non-string body or recipientId
  test('API hardening: non-string message bodies and recipient ids are rejected with 400, never a 500', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    const conv = await ensureInMail({ context: page.context(), page, guard, request });

    // Reply path: the handler calls `.trim()` / `.length` on whatever `body` is.
    for (const body of [123, ['x'], { nested: true }, true]) {
      const res = await request.post(`/api/conversations/${conv.id}`, { data: { body } });
      expect(res.status(), `POST reply with body=${JSON.stringify(body)}`).toBe(400);
    }
    // Attachment name type confusion
    expect((await request.post(`/api/conversations/${conv.id}`, { data: { body: 'x', attachmentUrl: 'not-mine.pdf', attachmentName: 5 } })).status()).toBe(400);

    // Edit path: malformed JSON while signed in
    const badJson = await request.patch(`/api/conversations/${conv.id}/messages/nope/edit`, {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{not json'),
    });
    expect(badJson.status(), 'PATCH edit with a malformed JSON body').toBe(400);

    // Employer send path: recipientId / jobId type confusion
    for (const payload of [
      { recipientId: { $ne: '' }, subject: 's', body: 'b' },
      { recipientId: 'x', subject: 's', body: 'b', jobId: { id: 1 } },
      { recipientId: ['x'], subject: 's', body: 'b' },
    ]) {
      const res = await employer!.request.post('/api/employer/messages', { data: payload });
      expect([400, 404], `POST /api/employer/messages with ${JSON.stringify(payload)} → ${res.status()}`).toContain(res.status());
    }
  });

  // DEFECT: Employer InMail subject is stored unsanitized and uncapped
  test('employer: InMail subject is sanitized and length-capped like the body', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    // A fresh thread (no jobId) so the subject we send becomes the conversation subject.
    const probeSubject = '<script>alert("s")</script>Subject probe onclick="x()"';
    const sent = await employer!.request.post('/api/employer/messages', {
      data: { recipientId: fixture!.seeker.supabaseId, subject: probeSubject, body: 'Subject sanitization probe.' },
    });
    if (sent.status() === 403 && (await sent.json()).upgradeRequired) {
      test.skip(true, 'employer InMail credits exhausted on this account — cannot open a fresh thread');
    }
    expect(sent.status(), 'send with a scripted subject').toBe(200);
    const { conversations } = await listConversations(request);
    const probe = conversations.find((c) => c.subject.includes('Subject probe'));

    // Second probe: a 20,000-character subject (the body is capped at 2000).
    const huge = await employer!.request.post('/api/employer/messages', {
      data: { recipientId: fixture!.seeker.supabaseId, subject: 'x'.repeat(20_000), body: 'Subject length probe.' },
    });
    const hugeStatus = huge.status();

    // Cleanup BEFORE asserting so a failing assertion never leaves the probe
    // threads behind for the next test's ensureInMail().
    await db.deleteConversationsBetween(fixture!.seeker.id, fixture!.employer.id);
    guard.reset();

    expect(probe, 'thread created').toBeTruthy();
    expect(probe!.subject, 'subject went through the same sanitizer as the body').not.toMatch(/<script|onclick=/i);
    expect(hugeStatus, 'a 20,000-character subject must be rejected (body is capped at 2000)').toBe(400);
  });

  // DEFECT: Reply composer double-submit sends duplicate messages
  test('candidate: two Enter presses in the same tick send exactly one reply', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    const conv = await ensureInMail({ context: page.context(), page, guard, request });
    await page.goto('/messages');
    await page.locator('.conv-row').filter({ hasText: employerName }).first().click();
    const thread = page.locator('.messages-thread-panel');
    const composer = thread.getByPlaceholder('Write a message...');
    await expect(composer).toBeVisible();

    const posts: number[] = [];
    page.on('response', (res) => {
      if (res.request().method() === 'POST' && res.url().includes(`/api/conversations/${conv.id}`)) posts.push(res.status());
    });
    const before = await db.countMessagesBetween(fixture!.employer.id, fixture!.seeker.id);
    const text = 'Double-Enter probe reply';
    await composer.fill(text);
    // Two keydowns dispatched synchronously — a `sending` flag held in React
    // state has not re-rendered between them, so only a ref/closure guard
    // stops the second submit.
    await composer.evaluate((el) => {
      const fire = () => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      fire();
      fire();
    });
    await expect(thread.locator('.msg-row').filter({ hasText: text }).first()).toBeVisible();
    await expect(composer).toHaveValue('');
    await expect.poll(() => db.countMessagesBetween(fixture!.employer.id, fixture!.seeker.id)).toBeGreaterThanOrEqual(before + 1);
    expect(posts.filter((s) => s === 200).length, 'successful POSTs fired by the double Enter').toBe(1);
    expect(await db.countMessagesBetween(fixture!.employer.id, fixture!.seeker.id), 'messages persisted').toBe(before + 1);
    await expect(thread.locator('.msg-row').filter({ hasText: text })).toHaveCount(1);
  });

  test('candidate: a reload mid-compose returns to a clean inbox with the thread closed', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    await ensureInMail({ context: page.context(), page, guard, request });
    await page.goto('/messages');
    await page.locator('.conv-row').first().click();
    const composer = page.locator('.messages-thread-panel').getByPlaceholder('Write a message...');
    await composer.fill('draft that is about to be lost');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
    await expect(page.locator('.conv-row').first()).toBeVisible();
    await expect(page.getByText('Select a conversation to view')).toBeVisible();
    await expect(page.getByPlaceholder('Write a message...')).toHaveCount(0);
    // Next's always-mounted, empty route announcer is role=alert; only an alert with content is an error.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  });

  test('employer: compose dialog is keyboard operable, validates, and sends one InMail', async ({ browser }) => {
    test.skip(!employerDashboardOk, DASHBOARD_SKIP_REASON);
    const { page } = employer!;
    const candidate = await openSession(browser, 'candidate');
    try {
      await page.goto('/employer/dashboard?tab=applicants');
      const messageBtn = page.getByRole('button', { name: `Message ${candidateName}` }).first();
      await expect(messageBtn).toBeVisible();

      // Keyboard open: focus + Enter
      await messageBtn.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'New Message' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');

      // Focus lands inside the dialog and Tab stays trapped in it
      await expect
        .poll(async () => dialog.evaluate((el) => el.contains(document.activeElement)), { message: 'initial focus inside dialog' })
        .toBe(true);
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `focus trapped after Tab #${i + 1}`).toBe(true);
      }

      // Prefilled context + validation
      await expect(dialog.locator('#compose-subject')).toHaveValue(`Regarding: ${fixture!.jobTitle}`);
      await expect(dialog.getByText(`Re: ${fixture!.jobTitle}`)).toBeVisible();
      await expect(dialog.getByText('0/2000 characters')).toBeVisible();
      const sendBtn = dialog.getByRole('button', { name: 'Send Message' });
      await expect(sendBtn, 'Send disabled with empty body').toBeDisabled();

      // Escape closes (keyboard dismiss) and focus returns to the trigger
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(messageBtn).toBeFocused();

      // Reopen and send once (the same-tick double-click probe is its own
      // fixme test below).
      const before = await db.countMessagesBetween(fixture!.employer.id, fixture!.seeker.id);
      await messageBtn.click();
      await expect(dialog).toBeVisible();
      await dialog.locator('#compose-body').fill('Hi, we would like to talk about the telehealth role.');
      await expect(dialog.getByText('52/2000 characters')).toBeVisible();
      await expect(sendBtn).toBeEnabled();
      await sendBtn.click();
      await expect(dialog.getByText('Message sent successfully!')).toBeVisible();
      await expect(dialog).toBeHidden();

      await expect
        .poll(() => db.countMessagesBetween(fixture!.employer.id, fixture!.seeker.id), { message: 'message created by the send' })
        .toBe(before + 1);

      // The employer's Messages tab lists the sent InMail
      await page.goto('/employer/dashboard?tab=messages');
      await expect(page.getByText(`Regarding: ${fixture!.jobTitle}`).first()).toBeVisible();
      await expect(page.getByText('No messages yet')).toBeHidden();

      // Candidate side (API) sees it unread
      const { conversations, totalUnread } = await listConversations(candidate.request);
      expect(conversations.length).toBe(1);
      expect(conversations[0].unreadCount).toBe(1);
      expect(totalUnread).toBe(1);
    } finally {
      candidate.guard.assertClean('candidate context');
      await candidate.context.close();
    }
  });

  // DEFECT: New Message dialog double-click sends two InMails (ComposeMessageModal has no in-flight guard)
  test('employer: a same-tick double-click on Send Message delivers exactly one InMail', async () => {
    test.skip(!employerDashboardOk, DASHBOARD_SKIP_REASON);
    const { page } = employer!;
    await page.goto('/employer/dashboard?tab=applicants');
    await page.getByRole('button', { name: `Message ${candidateName}` }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New Message' });
    await expect(dialog).toBeVisible();
    const before = await db.countMessagesBetween(fixture!.employer.id, fixture!.seeker.id);
    await dialog.locator('#compose-body').fill('Double-click probe InMail');
    const sendBtn = dialog.getByRole('button', { name: 'Send Message' });
    await expect(sendBtn).toBeEnabled();
    await sendBtn.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
    await expect(dialog.getByText('Message sent successfully!')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => db.countMessagesBetween(fixture!.employer.id, fixture!.seeker.id))
      .toBeGreaterThanOrEqual(before + 1);
    expect(await db.countMessagesBetween(fixture!.employer.id, fixture!.seeker.id), 'messages created by the double-click').toBe(before + 1);
  });

  test('employer: InMail body over 2000 characters is rejected with a visible error', async () => {
    test.skip(!employerDashboardOk, DASHBOARD_SKIP_REASON);
    const { page } = employer!;
    await page.goto('/employer/dashboard?tab=applicants');
    await page.getByRole('button', { name: `Message ${candidateName}` }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New Message' });
    await expect(dialog).toBeVisible();
    await dialog.locator('#compose-body').fill('x'.repeat(2001));
    await expect(dialog.getByText('2001/2000 characters')).toBeVisible();
    const sendBtn = dialog.getByRole('button', { name: 'Send Message' });
    // No client-side block: the server cap is the only guard, so the button is
    // enabled and the 400 must surface as an inline error, not a silent no-op.
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    await expect(dialog.getByText(/under 2000 characters/i)).toBeVisible();
    await expect(dialog, 'dialog stays open so the employer can fix the body').toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('employer: the cookie-consent banner must not cover the New Message dialog\'s actions', async ({ browser }) => {
    test.skip(!employerDashboardOk, DASHBOARD_SKIP_REASON);
    // A first-time visitor in a strict-consent region has the banner open
    // (fixed, z-index 9990). The compose modal is z-50, so its footer
    // buttons sit UNDER the banner and cannot be clicked until the visitor
    // answers the cookie prompt — with no hint why the button is dead.
    const session = await openSession(browser, 'employer', { keepConsentBanner: true });
    try {
      const { page } = session;
      await page.goto('/employer/dashboard?tab=applicants');
      const banner = page.getByRole('dialog', { name: 'Cookie consent' });
      const bannerShown = await banner.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false);
      test.skip(!bannerShown, 'consent banner not shown for this region — nothing to overlap');
      await page.getByRole('button', { name: `Message ${candidateName}` }).first().click();
      const dialog = page.getByRole('dialog', { name: 'New Message' });
      await expect(dialog).toBeVisible();
      for (const name of ['Cancel', 'Send Message']) {
        const btn = dialog.getByRole('button', { name });
        const box = await btn.boundingBox();
        expect(box, `${name} rendered`).not.toBeNull();
        const topmost = await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? document.elementFromPoint(x, y)?.closest('[role="dialog"]')?.id ?? 'none',
          { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
        );
        expect(topmost, `${name} button is the topmost hit target, not the consent banner`).not.toBe('Cookie consent');
      }
    } finally {
      session.guard.assertClean('employer (consent banner) context');
      await session.context.close();
    }
  });

  test('candidate: inbox shows the InMail unread, rows open from the keyboard, opening marks it read', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    const conv = await ensureInMail({ context: page.context(), page, guard, request });

    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
    const row = page.locator('.conv-row').filter({ hasText: employerName }).first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('role', 'button');
    await expect(row).toHaveAttribute('tabindex', '0');

    // Unread state: bold name, unread dot, header badge
    const nameEl = row.getByText(employerName, { exact: true });
    await expect(nameEl).toHaveCSS('font-weight', '700');
    await expect(page.getByRole('heading', { name: 'Messages' }).locator('..').getByText('1', { exact: true })).toBeVisible();
    await expect(row.getByText(conv.subject)).toBeVisible();
    await expect(row.getByText(fixture!.jobTitle)).toBeVisible();

    // Keyboard: focus the row, press Enter → thread opens
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press('Enter');
    const thread = page.locator('.messages-thread-panel');
    await expect(thread.getByText(employerName, { exact: true })).toBeVisible();
    await expect(thread.getByText('E2E Behavioral Health Group')).toBeVisible();
    await expect(thread.getByText('Hi, we would like to talk about the telehealth role.')).toBeVisible();
    await expect(thread.getByRole('link', { name: /View Job/ })).toHaveAttribute('href', `/jobs/${fixture!.jobSlug}`);

    // Opening cleared the unread badge client-side...
    await expect(page.getByRole('heading', { name: 'Messages' }).locator('..').getByText('1', { exact: true })).toBeHidden();
    await expect(nameEl).toHaveCSS('font-weight', '600');
    // ...and server-side (persists across reload)
    const { totalUnread } = await listConversations(request);
    expect(totalUnread).toBe(0);
    await page.reload();
    await expect(page.locator('.conv-row').filter({ hasText: employerName }).first().getByText(employerName, { exact: true })).toHaveCSS('font-weight', '600');
  });

  test('candidate: reply, edit is sanitized and capped at 2000, and the read receipt turns editing off', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    const conv = await ensureInMail({ context: page.context(), page, guard, request });
    page.on('dialog', async (d) => {
      await d.dismiss();
      throw new Error(`Unexpected browser dialog opened: ${d.message()}`);
    });

    await page.goto('/messages');
    await page.locator('.conv-row').filter({ hasText: employerName }).first().click();
    const thread = page.locator('.messages-thread-panel');
    const composer = thread.getByPlaceholder('Write a message...');
    await expect(composer).toBeVisible();
    const sendBtn = thread.getByRole('button', { name: 'Send message' });
    await expect(sendBtn, 'send disabled while composer is empty').toBeDisabled();

    // Over the cap: server 400 surfaces as an inline banner with Retry and the draft is kept
    await composer.fill('y'.repeat(2001));
    await composer.press('Enter');
    const banner = thread.getByRole('alert');
    await expect(banner).toContainText(/under 2000 characters/i);
    await expect(banner).toContainText('your message was not delivered');
    await expect(banner.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(composer).toHaveValue('y'.repeat(2001));

    // Valid reply via Enter
    const replyText = 'Thanks — happy to chat this week.';
    await composer.fill(replyText);
    await composer.press('Enter');
    await expect(banner).toBeHidden();
    const myBubble = thread.locator('.msg-row').filter({ hasText: replyText }).first();
    await expect(myBubble).toBeVisible();
    await expect(composer).toHaveValue('');
    await expect(page.locator('.conv-row').first()).toContainText(`You: ${replyText}`);

    // Edit → sanitizer strips script tags, inline handlers and javascript: URLs
    await myBubble.hover();
    await myBubble.getByRole('button', { name: 'Edit' }).click();
    const editBox = myBubble.locator('textarea');
    await expect(editBox).toBeVisible();
    await expect(editBox).toHaveValue(replyText);
    // While editing, the row's text lives in the textarea value (not text
    // content), and after saving it carries the new body, so address the row
    // being edited and the edited row explicitly instead of by the old text.
    const editingRow = thread.locator('.msg-row').filter({ has: page.locator('textarea') }).first();
    const editedBubble = thread.locator('.msg-row').filter({ hasText: 'Updated reply void(0)' }).first();
    await editBox.fill('<script>alert("xss")</script>Updated reply onclick="evil()" javascript:void(0)');
    await editingRow.getByRole('button', { name: 'Save' }).click();
    await expect(editedBubble.locator('p').first()).toHaveText('Updated reply void(0)');
    await expect(editedBubble.getByText('(edited)')).toBeVisible();
    await expect(page.getByText('Message edited')).toBeVisible();

    // Persisted, not just optimistic
    const { messages } = await readThread(request, conv.id);
    const mine = messages.filter((m) => m.isFromMe);
    expect(mine.map((m) => m.body)).toContain('Updated reply void(0)');
    expect(mine.find((m) => m.body === 'Updated reply void(0)')?.editedAt).toBeTruthy();

    // Escape cancels an edit without saving
    await editedBubble.hover();
    await editedBubble.getByRole('button', { name: 'Edit' }).click();
    await editingRow.locator('textarea').fill('should not be saved');
    await page.keyboard.press('Escape');
    await expect(thread.locator('.msg-row textarea')).toHaveCount(0);
    await expect(editedBubble.locator('p').first()).toHaveText('Updated reply void(0)');

    // Edit over the cap is rejected server-side and surfaced as a toast
    await editedBubble.hover();
    await editedBubble.getByRole('button', { name: 'Edit' }).click();
    await editingRow.locator('textarea').fill('z'.repeat(2001));
    await editingRow.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/under 2000 characters/i)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editedBubble.locator('p').first()).toHaveText('Updated reply void(0)');

    // Employer opens the thread → read receipt → Edit is no longer offered
    await readThread(employer!.request, conv.id);
    await page.reload();
    await page.locator('.conv-row').filter({ hasText: employerName }).first().click();
    const readBubble = thread.locator('.msg-row').filter({ hasText: 'Updated reply void(0)' }).first();
    await expect(readBubble.getByText('✓ Read')).toBeVisible();
    await readBubble.hover();
    await expect(readBubble.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(readBubble.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('cross-role: employer cannot edit/delete the candidate\'s message; candidate cannot use employer send', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    const conv = await ensureInMail({ context: page.context(), page, guard, request });
    const { messages } = await readThread(request, conv.id);
    let mine = messages.find((m) => m.isFromMe);
    if (!mine) {
      const sent = await request.post(`/api/conversations/${conv.id}`, { data: { body: 'Ownership probe reply' } });
      expect(sent.status()).toBe(200);
      mine = (await sent.json()).message;
    }

    const editByEmployer = await employer!.request.patch(`/api/conversations/${conv.id}/messages/${mine!.id}/edit`, { data: { body: 'hijacked' } });
    expect(editByEmployer.status()).toBe(403);
    const deleteByEmployer = await employer!.request.delete(`/api/conversations/${conv.id}/messages/${mine!.id}`);
    expect(deleteByEmployer.status()).toBe(403);

    const seekerAsEmployer = await request.post('/api/employer/messages', {
      data: { recipientId: fixture!.employer.supabaseId, subject: 'nope', body: 'nope' },
    });
    expect(seekerAsEmployer.status()).toBe(403);

    // Body still intact
    const after = await readThread(request, conv.id);
    expect(after.messages.find((m) => m.id === mine!.id)?.body).toBe(mine!.body);
  });

  test('candidate: API failure shows an error panel with Retry — never the empty state', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    const conv = await ensureInMail({ context: page.context(), page, guard, request });
    guard.allow(/Error fetching (conversations|thread)/i);

    // List: 500
    await page.route('**/api/conversations', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }),
    );
    await page.goto('/messages');
    const listAlert = page.getByRole('alert').filter({ hasText: "Couldn't load your messages" });
    await expect(listAlert).toBeVisible();
    await expect(page.getByText('No messages yet')).toBeHidden();
    await page.unroute('**/api/conversations');
    await listAlert.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.locator('.conv-row').first()).toBeVisible();
    await expect(listAlert).toBeHidden();

    // List: network abort (catch path)
    await page.route('**/api/conversations', (route) => route.abort('connectionrefused'));
    await page.reload();
    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load your messages" })).toBeVisible();
    await expect(page.getByText('No messages yet')).toBeHidden();
    await page.unroute('**/api/conversations');
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.locator('.conv-row').first()).toBeVisible();

    // Thread: 500 on open
    await page.route(`**/api/conversations/${conv.id}`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) })
        : route.continue(),
    );
    await page.locator('.conv-row').first().click();
    const threadAlert = page.getByRole('alert').filter({ hasText: "Couldn't open this conversation" });
    await expect(threadAlert).toBeVisible();
    await expect(page.getByText('Could not open conversation. Please try again.')).toBeVisible();
    await expect(threadAlert.getByRole('button', { name: 'Back to conversations' })).toBeVisible();
    await page.unroute(`**/api/conversations/${conv.id}`);
    await threadAlert.getByRole('button', { name: 'Try Again' }).click();
    await expect(threadAlert).toBeHidden();
    await expect(page.locator('.messages-thread-panel').getByPlaceholder('Write a message...')).toBeVisible();
  });

  // DEFECT: a new employer message on a thread the candidate deleted never restored it
  test('candidate: delete conversation asks for confirmation; Cancel keeps it; a new employer reply restores it', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    await ensureInMail({ context: page.context(), page, guard, request });

    await page.goto('/messages');
    const row = page.locator('.conv-row').first();
    await expect(row).toBeVisible();
    const options = row.getByRole('button', { name: 'Conversation options' });
    await expect(options).toHaveAttribute('aria-haspopup', 'true');
    await options.click();
    await expect(options).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'Delete conversation' }).click();

    const heading = page.getByRole('heading', { name: 'Delete conversation?' });
    await expect(heading).toBeVisible();
    await expect(page.getByText('The other person will still be able to see it.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(heading).toBeHidden();
    await expect(row).toBeVisible();

    // Confirm → gone locally and after reload; the employer still sees it
    await options.click();
    await page.getByRole('button', { name: 'Delete conversation' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Conversation deleted')).toBeVisible();
    await expect(page.getByText('No messages yet')).toBeVisible();
    await page.reload();
    await expect(page.getByText('No messages yet')).toBeVisible();
    expect((await listConversations(request)).conversations).toHaveLength(0);
    expect((await listConversations(employer!.request)).conversations.length).toBeGreaterThan(0);

    // A fresh employer message on the same thread un-deletes it for the candidate
    await sendInMailViaDialog(employer!, candidateName, 'Following up — are you still interested?');
    await page.reload();
    const restored = page.locator('.conv-row').filter({ hasText: employerName }).first();
    await expect(restored).toBeVisible();
    await expect(restored).toContainText('Following up — are you still interested?');
    await expect(restored.getByText(employerName, { exact: true })).toHaveCSS('font-weight', '700');
  });

  // DEFECT: Messages delete-confirm modal has no dialog role, focus move or Escape
  test('candidate: delete-confirm modal is a keyboard-dismissible dialog', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    await ensureInMail({ context: page.context(), page, guard, request });
    await page.goto('/messages');
    const row = page.locator('.conv-row').first();
    const options = row.getByRole('button', { name: 'Conversation options' });
    await options.focus();
    await page.keyboard.press('Enter');
    const deleteItem = page.getByRole('button', { name: 'Delete conversation' });
    await expect(deleteItem).toBeVisible();
    await deleteItem.focus();
    await page.keyboard.press('Enter');

    const heading = page.getByRole('heading', { name: 'Delete conversation?' });
    await expect(heading).toBeVisible();

    // A confirm dialog must expose role=dialog, move focus inside, and close on Escape
    const dialog = page.getByRole('dialog', { name: /Delete conversation/ });
    await expect(dialog, 'confirmation is exposed as role=dialog').toBeVisible();
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      'focus moved into the confirmation dialog',
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(heading, 'Escape dismisses the confirmation').toBeHidden();
    await expect(row, 'conversation was not deleted').toBeVisible();
  });

  // DEFECT: Conversation options menu cannot be closed with Escape
  test('candidate: Space opens a row; the options menu closes on Escape and returns focus to its trigger', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    await ensureInMail({ context: page.context(), page, guard, request });
    await page.goto('/messages');
    const row = page.locator('.conv-row').first();
    await expect(row).toBeVisible();

    // Space is the other activation key for role=button
    await row.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.messages-thread-panel').getByPlaceholder('Write a message...')).toBeVisible();

    // Options menu: opened from the keyboard it must also close from the
    // keyboard. It is a menu-like popup (aria-haspopup); Escape is the
    // universal dismiss and focus must not be lost.
    const options = row.getByRole('button', { name: 'Conversation options' });
    await options.focus();
    await page.keyboard.press('Enter');
    const deleteItem = page.getByRole('button', { name: 'Delete conversation' });
    await expect(deleteItem).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(deleteItem, 'Escape closes the conversation-options popup').toBeHidden();
    await expect(options).toHaveAttribute('aria-expanded', 'false');
    await expect(options, 'focus stays on the trigger after Escape').toBeFocused();
  });

  // DEFECT: deleting an already-read reply blanked it for the recipient as a tombstone
  test('candidate: deleting an unread reply removes it for everyone; a read reply is only hidden from the sender', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    const conv = await ensureInMail({ context: page.context(), page, guard, request });

    // Two replies: the first is read by the employer, the second stays unread.
    const readText = 'Reply the employer has already read';
    const unreadText = 'Reply the employer has not opened yet';
    const first = await request.post(`/api/conversations/${conv.id}`, { data: { body: readText } });
    expect(first.status()).toBe(200);
    await readThread(employer!.request, conv.id); // marks it read
    const second = await request.post(`/api/conversations/${conv.id}`, { data: { body: unreadText } });
    expect(second.status()).toBe(200);

    await page.goto('/messages');
    await page.locator('.conv-row').filter({ hasText: employerName }).first().click();
    const thread = page.locator('.messages-thread-panel');

    // Unread: the confirm says "Delete for everyone" and the employer loses it
    const unreadBubble = thread.locator('.msg-row').filter({ hasText: unreadText }).first();
    await unreadBubble.hover();
    await unreadBubble.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { name: 'Delete message?' })).toBeVisible();
    await expect(page.getByText("This message hasn't been read yet. It will be deleted for everyone.")).toBeVisible();
    await page.getByRole('button', { name: 'Delete for everyone' }).click();
    await expect(page.getByText('Message deleted for everyone')).toBeVisible();
    await expect(thread.locator('.msg-row').filter({ hasText: unreadText })).toHaveCount(0);
    const employerView = await readThread(employer!.request, conv.id);
    expect(employerView.messages.some((m) => m.body === unreadText), 'employer no longer sees the unread reply').toBe(false);

    // Read: only removed from the sender's view; the employer keeps it
    const readBubble = thread.locator('.msg-row').filter({ hasText: readText }).first();
    await readBubble.hover();
    await readBubble.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('This message has already been read. It will only be removed from your view; the recipient will still see it.')).toBeVisible();
    await page.getByRole('dialog', { name: 'Delete message?' }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Message removed from your view')).toBeVisible();
    await expect(thread.locator('.msg-row').filter({ hasText: readText })).toHaveCount(0);
    const employerAfter = await readThread(employer!.request, conv.id);
    expect(employerAfter.messages.some((m) => m.body === readText), 'employer still sees the read reply').toBe(true);

    // Persisted for the candidate too
    await page.reload();
    await page.locator('.conv-row').filter({ hasText: employerName }).first().click();
    await expect(thread.getByPlaceholder('Write a message...')).toBeVisible();
    await expect(thread.locator('.msg-row').filter({ hasText: readText })).toHaveCount(0);
    await expect(thread.locator('.msg-row').filter({ hasText: unreadText })).toHaveCount(0);

    // Deleting the other party's message or an unknown id is a clean rejection
    const mine = (await readThread(request, conv.id)).messages;
    const theirs = mine.find((m) => !m.isFromMe);
    expect(theirs, 'employer message present').toBeTruthy();
    expect((await request.delete(`/api/conversations/${conv.id}/messages/${theirs!.id}`)).status()).toBe(403);
    expect((await request.delete(`/api/conversations/${conv.id}/messages/does-not-exist`)).status()).toBe(404);
  });

  test('candidate: a network failure on reply keeps the draft and offers Retry; Retry delivers it', async ({ page, guard }) => {
    await login(page, 'candidate');
    const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
    const conv = await ensureInMail({ context: page.context(), page, guard, request });
    guard.allow(/Error sending reply/i);
    await page.goto('/messages');
    await page.locator('.conv-row').filter({ hasText: employerName }).first().click();
    const thread = page.locator('.messages-thread-panel');
    const composer = thread.getByPlaceholder('Write a message...');
    await expect(composer).toBeVisible();

    await page.route(`**/api/conversations/${conv.id}`, (route) =>
      route.request().method() === 'POST' ? route.abort('connectionrefused') : route.continue(),
    );
    const text = 'Retry-after-outage probe';
    await composer.fill(text);
    await thread.getByRole('button', { name: 'Send message' }).click();
    const banner = thread.getByRole('alert');
    await expect(banner).toContainText('your message was not delivered');
    await expect(composer, 'draft preserved on failure').toHaveValue(text);
    await expect(thread.locator('.msg-row').filter({ hasText: text })).toHaveCount(0);

    await page.unroute(`**/api/conversations/${conv.id}`);
    await banner.getByRole('button', { name: 'Retry' }).click();
    await expect(banner).toBeHidden();
    await expect(thread.locator('.msg-row').filter({ hasText: text })).toHaveCount(1);
    await expect(composer).toHaveValue('');
  });

  test.describe('mobile 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('list → thread → labeled back button returns to the list, no horizontal overflow', async ({ page, guard }) => {
      await login(page, 'candidate');
      const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
      await ensureInMail({ context: page.context(), page, guard, request });
      await page.goto('/messages');

      const list = page.locator('.messages-list-panel');
      const thread = page.locator('.messages-thread-panel');
      await expect(list).toBeVisible();
      await expect(thread).toBeHidden();
      const row = page.locator('.conv-row').first();
      await expect(row).toBeVisible();

      // No horizontal scroll on the inbox
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'page must not scroll horizontally at 375px').toBeLessThanOrEqual(0);

      await row.click();
      await expect(thread).toBeVisible();
      await expect(list).toBeHidden();
      const back = thread.getByRole('button', { name: 'Back to conversations' });
      await expect(back).toBeVisible();
      await expect(thread.getByPlaceholder('Write a message...')).toBeVisible();

      const composerBox = await thread.getByPlaceholder('Write a message...').boundingBox();
      expect(composerBox, 'composer is rendered').not.toBeNull();
      expect(composerBox!.x + composerBox!.width, 'composer fits within 375px').toBeLessThanOrEqual(375);

      await back.click();
      await expect(list).toBeVisible();
      await expect(thread).toBeHidden();
    });

    // DEFECT: Browser back from an open thread leaves /messages
  test('browser back from an open thread returns to the list, not out of Messages', async ({ page, guard }) => {
      await login(page, 'candidate');
      const request = page.request; // shares the signed-in context's cookies (the `request` fixture does not)
      await ensureInMail({ context: page.context(), page, guard, request });
      await page.goto('/messages');
      const list = page.locator('.messages-list-panel');
      const thread = page.locator('.messages-thread-panel');
      await page.locator('.conv-row').first().click();
      await expect(thread).toBeVisible();
      await expect(list).toBeHidden();

      // On a phone the thread replaces the list full-screen; the hardware /
      // browser back gesture is how people leave it. It must not leave /messages.
      await page.goBack();
      await expect(page, 'back from a thread stays inside Messages').toHaveURL(/\/messages/);
      await expect(list).toBeVisible();
      await expect(thread).toBeHidden();
    });
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * JOB ALERTS
 * ═════════════════════════════════════════════════════════════════════════ */

test.describe('job alerts: create, manage, downsell, unsubscribe', () => {
  const seekerEmail = SEEKER?.email ?? '';

  test.beforeAll(async () => {
    test.skip(!ALERTS_READY, 'Needs seeker creds and a dev DATABASE_URL (not prod)');
    await db.deleteJobAlerts(seekerEmail);
    await db.ensureCleanEmailLead(seekerEmail);
  });

  test.afterAll(async () => {
    if (ALERTS_READY) {
      await db.deleteJobAlerts(seekerEmail).catch(() => undefined);
      await db.ensureCleanEmailLead(seekerEmail).catch(() => undefined);
    }
    await db.closeDb();
  });

  test.beforeEach(() => {
    test.skip(!ALERTS_READY, 'Needs seeker creds and a dev DATABASE_URL (not prod)');
  });

  test('form validation: empty and malformed emails never create an alert; API rejects bad criteria', async ({ page, request }) => {
    await page.goto('/job-alerts');
    const email = page.locator('#alert-email');
    await expect(email).toBeVisible();

    await page.getByRole('button', { name: 'Create Job Alert' }).click();
    // Scoped by id: Next's route announcer is also role=alert on every page.
    const emailError = page.locator('#alert-email-error');
    await expect(emailError).toHaveText('Email address is required');
    await expect(emailError).toHaveAttribute('role', 'alert');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAttribute('aria-describedby', 'alert-email-error');

    await email.fill('not-an-email');
    await expect(emailError, 'error clears while typing').toHaveCount(0);
    await page.getByRole('button', { name: 'Create Job Alert' }).click();
    expect(await email.evaluate((el: HTMLInputElement) => el.validity.valid), 'native email validation blocks submit').toBe(false);
    await expect(page.getByText('Job alert created!')).toHaveCount(0);
    await expect(page).toHaveURL(/\/job-alerts$/);

    // API-level guards (the UI can't reach these with its selects)
    const bad = async (data: Record<string, unknown>) => (await request.post('/api/job-alerts', { data })).status();
    expect(await bad({ email: 'bad' })).toBe(400);
    expect(await bad({ email: seekerEmail, frequency: 'hourly' })).toBe(400);
    expect(await bad({ email: seekerEmail, minSalary: -5 })).toBe(400);
    expect(await bad({ email: seekerEmail, minSalary: 200000, maxSalary: 100000 })).toBe(400);
    expect(await bad({ email: seekerEmail, minYearsExperience: 99 })).toBe(400);
    expect(await bad({ email: seekerEmail, newGradFriendly: 'yes' })).toBe(400);
    expect(await db.listJobAlerts(seekerEmail), 'no alert rows leaked from rejected requests').toHaveLength(0);
  });

  // DEFECT: a double-submit of the /job-alerts form stored two identical alerts
  test('signed-in seeker creates an alert with every criterion; a double-submit dedupes; it appears in Manage', async ({ page }) => {
    await login(page, 'candidate');
    await page.goto('/job-alerts');
    await expect(page.locator('#alert-email'), 'email prefilled from the session').toHaveValue(seekerEmail);

    await page.locator('#alert-keyword').fill('Telehealth');
    await page.locator('#alert-location').selectOption('Texas');
    await page.locator('#alert-mode').selectOption('Remote');
    await page.locator('#alert-job-type').selectOption('Full-Time');
    await page.locator('#alert-new-grad').check();
    await page.locator('#alert-min-years').selectOption('2');
    await page.locator('#alert-min-salary').selectOption('150000');
    const weekly = page.getByRole('group', { name: /How often/ }).getByRole('button', { name: /Weekly/ });
    await weekly.click();
    await expect(weekly).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('"Telehealth" · Remote · Full-Time · in Texas · open to new grads · fits 2+ yrs experience · $150,000+')).toBeVisible();

    const submit = page.getByRole('button', { name: 'Create Job Alert' });
    await submit.evaluate((el: HTMLButtonElement) => { el.click(); el.click(); });
    await expect(page.getByText('Job alert created!')).toBeVisible();
    await expect(page.getByRole('link', { name: 'manage your alerts' }).first()).toBeVisible();

    await expect.poll(async () => (await db.listJobAlerts(seekerEmail)).length, { message: 'exactly one alert after the double-submit' }).toBe(1);
    const [row] = await db.listJobAlerts(seekerEmail);
    expect(row).toMatchObject({
      keyword: 'Telehealth', location: 'Texas', mode: 'Remote', jobType: 'Full-Time',
      minSalary: 150000, newGradFriendly: true, minYearsExperience: 2, frequency: 'weekly', isActive: true,
    });

    // Manage (signed-in, no token) lists it
    await page.goto('/job-alerts/manage');
    await expect(page.getByText(`1 active alert · ${seekerEmail}`)).toBeVisible();
    const card = page.locator('.alert-card').first();
    await expect(card).toContainText('"Telehealth" · Remote · Full-Time · in Texas');
    await expect(card).toContainText('$150k+');
    await expect(card).toContainText('● Active');
    await expect(card).toContainText('Weekly');
    await expect(card).not.toContainText('Invalid Date');
  });

  // DEFECT: Signed-in manage page drops new-grad and experience criteria (by-email API omits them)
  test('manage page shows the experience criteria on both the signed-in and token paths', async ({ page }) => {
    await login(page, 'candidate');
    let alerts = await db.listJobAlerts(seekerEmail);
    let probe = alerts.find((a) => a.newGradFriendly === true && a.minYearsExperience === 2);
    if (!probe) {
      const res = await page.request.post('/api/job-alerts', {
        data: { email: seekerEmail, keyword: 'Telehealth', newGradFriendly: true, minYearsExperience: 2, frequency: 'weekly' },
      });
      expect(res.status()).toBe(200);
      alerts = await db.listJobAlerts(seekerEmail);
      probe = alerts.find((a) => a.newGradFriendly === true && a.minYearsExperience === 2)!;
    }

    // Token path (email-link management) — full criteria
    await page.goto(`/job-alerts/manage?token=${encodeURIComponent(probe.token)}`);
    const tokenCard = page.locator('.alert-card').filter({ hasText: '"Telehealth"' }).first();
    await expect(tokenCard).toContainText('open to new grads');
    await expect(tokenCard).toContainText('fits 2+ yrs experience');

    // Signed-in path (/api/job-alerts/by-email) must render the same criteria
    await page.goto('/job-alerts/manage');
    const sessionCard = page.locator('.alert-card').filter({ hasText: '"Telehealth"' }).first();
    await expect(sessionCard).toBeVisible();
    await expect(sessionCard, 'signed-in manage shows new-grad criterion').toContainText('open to new grads');
    await expect(sessionCard, 'signed-in manage shows experience criterion').toContainText('fits 2+ yrs experience');
  });

  test('manage: pause/resume, cadence toggle and delete-confirm persist; New Alert form re-reads the list', async ({ page }) => {
    await login(page, 'candidate');
    if ((await db.listJobAlerts(seekerEmail)).length === 0) {
      await db.createJobAlert(seekerEmail, { keyword: 'Telehealth', frequency: 'weekly' });
    }
    await page.goto('/job-alerts/manage');
    const card = page.locator('.alert-card').first();
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Pause' }).click();
    await expect(card).toContainText('⏸ Paused');
    await page.reload();
    await expect(page.locator('.alert-card').first()).toContainText('⏸ Paused');
    await expect(page.getByText(/0 active alerts/)).toBeVisible();

    await page.locator('.alert-card').first().getByRole('button', { name: 'Resume' }).click();
    await expect(page.locator('.alert-card').first()).toContainText('● Active');

    await page.locator('.alert-card').first().getByRole('button', { name: 'Daily', exact: true }).click();
    await expect.poll(async () => (await db.listJobAlerts(seekerEmail))[0]?.frequency).toBe('daily');
    await page.reload();
    await expect(page.locator('.alert-card').first().locator('span', { hasText: 'Daily' }).first()).toBeVisible();

    // Delete: No keeps it, Yes removes it
    await page.locator('.alert-card').first().getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'No' }).click();
    await expect(page.locator('.alert-card').first()).toBeVisible();
    const countBefore = (await db.listJobAlerts(seekerEmail)).length;
    await page.locator('.alert-card').first().getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect.poll(async () => (await db.listJobAlerts(seekerEmail)).length).toBe(countBefore - 1);
    if (countBefore === 1) {
      await expect(page.getByRole('heading', { name: 'No alerts yet' })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: 'No alerts yet' })).toBeVisible();
    }

    // Create from the manage page
    await page.getByRole('button', { name: 'New Alert' }).click();
    await page.locator('#new-alert-keyword').fill('Inpatient');
    await page.locator('#new-alert-mode').selectOption('Hybrid');
    await page.getByRole('group', { name: 'Frequency' }).getByRole('button', { name: /Weekly/ }).click();
    await page.getByRole('button', { name: 'Create Alert' }).click();
    await expect(page.getByText('Alert created!')).toBeVisible();
    const created = page.locator('.alert-card').filter({ hasText: '"Inpatient"' }).first();
    await expect(created).toBeVisible();
    await expect(created).toContainText('Hybrid');
    await expect(created).toContainText('● Active');
    await expect(created).not.toContainText('Invalid Date');
    await expect(page.locator('#new-alert-keyword'), 'form collapses after create').toBeHidden();
  });

  test('manage: signed-out shows a sign-in prompt, a bogus token is not found, and the token APIs are guarded', async ({ page, request, guard }) => {
    guard.allow(/AuthSessionMissingError|Auth session missing/i);
    await page.goto('/job-alerts/manage');
    await expect(page.getByText('Please sign in to manage your alerts.')).toBeVisible();
    await expect(page.locator('.alert-card')).toHaveCount(0);

    await page.goto('/job-alerts/manage?token=bogus-token');
    await expect(page.getByText('Job alert not found')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No alerts yet' })).toBeHidden();

    // IDOR guard: tokens are never handed out for someone else's address
    expect((await request.get(`/api/job-alerts/by-email?email=${encodeURIComponent(seekerEmail)}`)).status()).toBe(401);
    expect((await request.get('/api/job-alerts?token=bogus-token')).status()).toBe(404);
    expect((await request.get('/api/job-alerts')).status()).toBe(400);
    expect((await request.patch('/api/job-alerts/bogus-token', { data: { frequency: 'weekly' } })).status()).toBe(404);
    expect((await request.delete('/api/job-alerts')).status()).toBe(400);
    expect((await request.delete('/api/job-alerts?token=bogus-token')).status()).toBe(404);

    if (EMPLOYER) {
      const employerCtx = await page.context().browser()!.newContext({ baseURL: MUT_ORIGIN, extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } });
      try {
        const employerPage = await employerCtx.newPage();
        await login(employerPage, 'employer');
        const cross = await employerCtx.request.get(`/api/job-alerts/by-email?email=${encodeURIComponent(seekerEmail)}`);
        expect(cross.status(), 'another signed-in user cannot read the seeker\'s alert tokens').toBe(403);
      } finally {
        await employerCtx.close();
      }
    }
  });

  test('unsubscribe page: weekly downsell → pause → delete, each state offering only the right choices', async ({ page }) => {
    const alert = await db.createJobAlert(seekerEmail, { keyword: 'Downsell probe', frequency: 'daily' });
    const sibling = await db.createJobAlert(seekerEmail, { keyword: 'Sibling alert', frequency: 'weekly' });
    const url = `/job-alerts/unsubscribe?token=${encodeURIComponent(alert.token)}`;

    // Daily + running: every option shown
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Too many emails?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause this alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send it weekly instead' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Change what it sends me' })).toHaveAttribute('href', `/job-alerts/manage?token=${encodeURIComponent(alert.token)}`);
    await expect(page.getByRole('link', { name: 'Never mind, keep everything as-is' })).toHaveAttribute('href', '/jobs');
    await expect(page.getByRole('link', { name: 'your alerts page' })).toHaveAttribute('href', `/job-alerts/manage?token=${encodeURIComponent(alert.token)}`);

    await page.getByRole('button', { name: 'Send it weekly instead' }).click();
    await expect(page.getByRole('heading', { name: 'Switched to Weekly' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage This Alert' })).toHaveAttribute('href', `/job-alerts/manage?token=${encodeURIComponent(alert.token)}`);
    await expect.poll(async () => (await db.listJobAlerts(seekerEmail)).find((a) => a.id === alert.id)?.frequency).toBe('weekly');
    expect((await db.listJobAlerts(seekerEmail)).find((a) => a.id === alert.id)?.isActive, 'cadence change never pauses').toBe(true);

    // Weekly + running: no further downsell, pause still offered
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Too many emails?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send it weekly instead' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pause this alert' }).click();
    await expect(page.getByRole('heading', { name: 'Alert Paused' })).toBeVisible();
    await expect.poll(async () => (await db.listJobAlerts(seekerEmail)).find((a) => a.id === alert.id)?.isActive).toBe(false);

    // Paused: only "change" and "delete" remain
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'This alert is already paused' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause this alert' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send it weekly instead' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete this alert permanently' }).click();
    await expect(page.getByRole('heading', { name: 'Alert Deleted' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage My Other Alerts' })).toHaveAttribute('href', `/job-alerts/manage?token=${encodeURIComponent(sibling.token)}`);
    await expect.poll(async () => (await db.listJobAlerts(seekerEmail)).some((a) => a.id === alert.id)).toBe(false);
    expect((await db.listJobAlerts(seekerEmail)).some((a) => a.id === sibling.id), 'sibling alert untouched').toBe(true);

    // Deleted token → clear fatal state; missing token → invalid link
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Something Went Wrong' })).toBeVisible();
    await expect(page.getByText(/couldn.t find this job alert|job alert not found/i)).toBeVisible();
    await page.goto('/job-alerts/unsubscribe');
    await expect(page.getByText('Invalid unsubscribe link. No token provided.')).toBeVisible();
  });

  test('unsubscribe page: a failed PATCH reports the error and keeps the alert unchanged', async ({ page }) => {
    const alert = await db.createJobAlert(seekerEmail, { keyword: 'Retry probe', frequency: 'daily' });
    await page.goto(`/job-alerts/unsubscribe?token=${encodeURIComponent(alert.token)}`);
    await expect(page.getByRole('heading', { name: 'Too many emails?' })).toBeVisible();
    await page.route(`**/api/job-alerts/${alert.token}`, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Simulated outage' }) }),
    );
    await page.getByRole('button', { name: 'Pause this alert' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Simulated outage' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Too many emails?' }), 'no false success').toBeVisible();
    expect((await db.listJobAlerts(seekerEmail)).find((a) => a.id === alert.id)?.isActive).toBe(true);
    await page.unroute(`**/api/job-alerts/${alert.token}`);
    await page.getByRole('button', { name: 'Pause this alert' }).click();
    await expect(page.getByRole('heading', { name: 'Alert Paused' })).toBeVisible();
  });

  // DEFECT: Job alert signup silently opts the address into the newsletter and Beehiiv
  test('creating an alert does not silently opt the address into the newsletter', async ({ page }) => {
    // The alert form has no newsletter checkbox and never mentions one, so a
    // job-alert signup must not flip EmailLead.newsletterOptIn (or sync the
    // address to the newsletter provider) on the visitor's behalf.
    const lead = await db.ensureCleanEmailLead(seekerEmail);
    expect(lead.newsletterOptIn).toBe(false);
    await page.goto('/job-alerts');
    await page.locator('#alert-email').fill(seekerEmail);
    await page.locator('#alert-keyword').fill('Consent probe');
    await page.getByRole('button', { name: 'Create Job Alert' }).click();
    await expect(page.getByText('Job alert created!')).toBeVisible();
    await expect.poll(async () => (await db.listJobAlerts(seekerEmail)).some((a) => a.keyword === 'Consent probe')).toBe(true);
    expect((await db.getEmailLead(seekerEmail))?.newsletterOptIn, 'newsletterOptIn must stay false without an explicit opt-in').toBe(false);
  });

  // DEFECT: Job alert success copy says check your email to confirm, but no confirmation is sent
  test('success copy must not promise a confirmation email the single-opt-in flow never sends', async ({ page }) => {
    // app/api/job-alerts/route.ts creates alerts already confirmed (single
    // opt-in) and sends a welcome email; there is no confirmation link to
    // click. The form's success banner still says "Check your email to
    // confirm", so every new subscriber waits for a step that never comes.
    await page.goto('/job-alerts');
    await page.locator('#alert-email').fill(seekerEmail);
    await page.locator('#alert-keyword').fill('Copy probe');
    await page.getByRole('button', { name: 'Create Job Alert' }).click();
    const success = page.getByText('Job alert created!');
    await expect(success).toBeVisible();
    const created = (await db.listJobAlerts(seekerEmail)).find((a) => a.keyword === 'Copy probe');
    expect(created?.isActive, 'the alert is live immediately (single opt-in)').toBe(true);
    await expect(success, 'copy must not tell an already-confirmed subscriber to confirm').not.toContainText(/confirm/i);
  });

  test('manage?email= for another address never lists or leaks their alerts', async ({ page, guard }) => {
    guard.allow(/AuthSessionMissingError|Auth session missing/i);
    // Signed out: the by-email path needs a session
    await page.goto(`/job-alerts/manage?email=${encodeURIComponent(seekerEmail)}`);
    await expect(page.locator('.alert-card')).toHaveCount(0);
    await expect(page.getByText(/Authentication required|sign in/i).first()).toBeVisible();

    if (!EMPLOYER) return;
    // Signed in as someone else: refused, no cards
    await login(page, 'employer');
    await page.goto(`/job-alerts/manage?email=${encodeURIComponent(seekerEmail)}`);
    await expect(page.getByText('You can only view alerts for your own email')).toBeVisible();
    await expect(page.locator('.alert-card')).toHaveCount(0);
  });

  // DEFECT: New alert for a suppressed address is created but can never send
  test('an unsubscribed (suppressed) address that creates a new alert gets a deliverable alert', async ({ page }) => {
    // The digest cron gates every send on isEmailSuppressed(); a visitor who
    // once clicked Unsubscribe and now signs up again is told "Job alert
    // created!" — the alert must actually be able to send, or the page must
    // say it cannot.
    await db.suppressEmailLead(seekerEmail);
    await page.goto('/job-alerts');
    await page.locator('#alert-email').fill(seekerEmail);
    await page.locator('#alert-keyword').fill('Suppressed probe');
    await page.getByRole('button', { name: 'Create Job Alert' }).click();
    await expect(page.getByText('Job alert created!')).toBeVisible();
    const created = (await db.listJobAlerts(seekerEmail)).find((a) => a.keyword === 'Suppressed probe');
    expect(created?.isActive, 'alert row is active').toBe(true);
    const lead = await db.getEmailLead(seekerEmail);
    expect(lead?.isSuppressed, 'a fresh, explicit alert signup must lift the unsubscribe suppression or the digest never sends').toBe(false);
    expect(await db.isProfileEmailSuppressed(seekerEmail), 'profile-level suppression lifted too').toBe(false);
    await db.ensureCleanEmailLead(seekerEmail);
  });

  // DEFECT: PATCH /api/job-alerts/[token] returns 500 for non-boolean isActive
  test('PATCH /api/job-alerts/[token] rejects a non-boolean isActive with 400', async ({ request }) => {
    const alert = await db.createJobAlert(seekerEmail, { keyword: 'Type probe', frequency: 'daily' });
    for (const isActive of ['yes', 1, { on: true }]) {
      const res = await request.patch(`/api/job-alerts/${alert.token}`, { data: { isActive } });
      expect(res.status(), `isActive=${JSON.stringify(isActive)}`).toBe(400);
    }
    expect((await request.patch(`/api/job-alerts/${alert.token}`, { data: { frequency: 5 } })).status()).toBe(400);
    const malformed = await request.patch(`/api/job-alerts/${alert.token}`, {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{not json'),
    });
    expect(malformed.status(), 'PATCH with a malformed JSON body').toBe(400);
    expect((await db.listJobAlerts(seekerEmail)).find((a) => a.id === alert.id)?.isActive, 'alert untouched by rejected payloads').toBe(true);
  });

  test('a ?specialty= link prefills the keyword field, offers suggestions, and the created alert stores it', async ({ page }) => {
    // Category pages link to /job-alerts?specialty=<term>; the page treats
    // specialty as an alias of keyword (app/job-alerts/page.tsx).
    const specialty = 'Child and Adolescent';
    await page.goto(`/job-alerts?specialty=${encodeURIComponent(specialty)}&mode=Remote&salaryMin=not-a-bucket`);
    const keyword = page.getByRole('combobox', { name: /Specialty or keyword/ });
    await expect(keyword).toHaveValue(specialty);
    await expect(page.locator('#alert-mode')).toHaveValue('Remote');
    await expect(page.locator('#alert-min-salary'), 'an unknown salary bucket is ignored, not injected').toHaveValue('');
    expect(await page.locator('#alert-specialty-options option').count(), 'datalist suggestions rendered').toBeGreaterThan(0);
    await expect(page.getByText(`"${specialty}" · Remote`)).toBeVisible();

    await page.locator('#alert-email').fill(seekerEmail);
    await page.locator('#alert-min-years').selectOption('5');
    await page.getByRole('button', { name: 'Create Job Alert' }).click();
    await expect(page.getByText('Job alert created!')).toBeVisible();
    await expect(keyword, 'form resets after a successful create').toHaveValue('');
    await expect
      .poll(async () => (await db.listJobAlerts(seekerEmail)).find((a) => a.keyword === specialty) ?? null)
      .toMatchObject({ keyword: specialty, mode: 'Remote', minYearsExperience: 5, minSalary: null, isActive: true });
  });

  test('token APIs: a missing or unknown token is a clean 400/404, never a 500', async ({ request }) => {
    // (Malformed JSON on PATCH /api/job-alerts/[token] is probed in the fixme'd isActive test.)
    expect((await request.get('/api/email/preferences')).status(), 'preferences GET without token').toBe(400);
    expect((await request.get('/api/email/preferences?token=bogus-token')).status()).toBe(404);
    expect((await request.post('/api/email/preferences', { data: {} })).status(), 'preferences POST without token').toBe(400);
    expect((await request.post('/api/email/preferences', { data: { token: 'bogus-token', isSubscribed: true } })).status()).toBe(404);
    expect((await request.get('/api/email/unsubscribe')).status(), 'unsubscribe GET without token').toBe(400);
    expect((await request.get('/api/email/unsubscribe?token=bogus-token')).status()).toBe(404);
  });

  test.describe('mobile 375px', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('manage page fits the viewport and delete-confirm is keyboard operable', async ({ page }) => {
      await db.createJobAlert(seekerEmail, { keyword: 'Mobile manage probe', frequency: 'weekly' });
      await login(page, 'candidate');
      await page.goto('/job-alerts/manage');
      const card = page.locator('.alert-card').filter({ hasText: '"Mobile manage probe"' }).first();
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'no horizontal overflow at 375px').toBeLessThanOrEqual(0);
      const cardBox = await card.boundingBox();
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(375);

      // Keyboard: Enter on Delete opens the inline confirm; Enter on No keeps the alert.
      const del = card.getByRole('button', { name: 'Delete' });
      await del.focus();
      await page.keyboard.press('Enter');
      const no = page.getByRole('button', { name: 'No' });
      await expect(no).toBeVisible();
      await no.focus();
      await page.keyboard.press('Enter');
      await expect(no).toBeHidden();
      await expect(card).toBeVisible();
      expect((await db.listJobAlerts(seekerEmail)).some((a) => a.keyword === 'Mobile manage probe'), 'not deleted').toBe(true);
    });

    test('a visitor creates an alert end-to-end at 375px', async ({ page }) => {
      await page.goto('/job-alerts');
      await page.locator('#alert-email').fill(seekerEmail);
      await page.locator('#alert-keyword').fill('Mobile create probe');
      await page.locator('#alert-mode').selectOption('Remote');
      const weekly = page.getByRole('group', { name: /How often/ }).getByRole('button', { name: /Weekly/ });
      await weekly.click();
      await expect(weekly).toHaveAttribute('aria-pressed', 'true');
      const submit = page.getByRole('button', { name: 'Create Job Alert' });
      const box = await submit.boundingBox();
      expect(box, 'submit rendered').not.toBeNull();
      expect(box!.x + box!.width, 'submit fits within 375px').toBeLessThanOrEqual(375);
      expect(box!.height, 'tap target height').toBeGreaterThanOrEqual(44);
      await submit.click();
      await expect(page.getByText('Job alert created!')).toBeVisible();
      const created = (await db.listJobAlerts(seekerEmail)).find((a) => a.keyword === 'Mobile create probe');
      expect(created).toMatchObject({ mode: 'Remote', frequency: 'weekly', isActive: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'no horizontal overflow after submit').toBeLessThanOrEqual(0);
    });

    test('alert form and unsubscribe page fit the viewport', async ({ page }) => {
      await page.goto('/job-alerts');
      await expect(page.locator('#alert-email')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      const alert = await db.createJobAlert(seekerEmail, { keyword: 'Mobile probe', frequency: 'daily' });
      await page.goto(`/job-alerts/unsubscribe?token=${encodeURIComponent(alert.token)}`);
      await expect(page.getByRole('heading', { name: 'Too many emails?' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const del = page.getByRole('button', { name: 'Delete this alert permanently' });
      const box = await del.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
      expect(box!.height, 'tap target height').toBeGreaterThanOrEqual(44);
    });
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * EMAIL RETENTION: one-click unsubscribe, /unsubscribe, /email-preferences
 * ═════════════════════════════════════════════════════════════════════════ */

test.describe('email retention: unsubscribe tokens and preferences', () => {
  const seekerEmail = SEEKER?.email ?? '';

  test.beforeAll(async () => {
    test.skip(!ALERTS_READY, 'Needs seeker creds and a dev DATABASE_URL (not prod)');
  });

  test.afterAll(async () => {
    if (ALERTS_READY) {
      await db.deleteJobAlerts(seekerEmail).catch(() => undefined);
      await db.ensureCleanEmailLead(seekerEmail).catch(() => undefined);
    }
    await db.closeDb();
  });

  test.beforeEach(async () => {
    test.skip(!ALERTS_READY, 'Needs seeker creds and a dev DATABASE_URL (not prod)');
    await db.ensureCleanEmailLead(seekerEmail);
  });

  // DEFECT: One-click unsubscribe does not mirror suppression to the profile or record the reason
  test('RFC 8058 one-click unsubscribe: suppresses on first POST, is idempotent, and never reveals unknown tokens', async ({ request }) => {
    const lead = await db.ensureCleanEmailLead(seekerEmail);
    const url = `/api/one-click-unsubscribe?token=${encodeURIComponent(lead.unsubscribeToken)}`;

    const first = await request.post(url, { form: { 'List-Unsubscribe': 'One-Click' } });
    expect(first.status()).toBe(200);
    let state = await db.getEmailLead(seekerEmail);
    expect(state).toMatchObject({ isSubscribed: false, isSuppressed: true, newsletterOptIn: false });
    expect(await db.isProfileEmailSuppressed(seekerEmail), 'registered profile mirrors the suppression').toBe(true);

    const second = await request.post(url, { form: { 'List-Unsubscribe': 'One-Click' } });
    expect(second.status(), 'repeat is idempotent (2xx)').toBe(200);
    state = await db.getEmailLead(seekerEmail);
    expect(state).toMatchObject({ isSubscribed: false, isSuppressed: true });

    expect((await request.post('/api/one-click-unsubscribe?token=unknown-token', { form: { 'List-Unsubscribe': 'One-Click' } })).status()).toBe(200);
    expect((await request.post('/api/one-click-unsubscribe')).status()).toBe(400);
    expect((await request.get(url)).status()).toBe(405);
  });

  // DEFECT: Resubscribe after one-click unsubscribe leaves the address suppressed
  test('resubscribing after a one-click unsubscribe restores deliverability', async ({ request }) => {
    const lead = await db.ensureCleanEmailLead(seekerEmail);
    expect((await request.post(`/api/one-click-unsubscribe?token=${lead.unsubscribeToken}`, { form: { 'List-Unsubscribe': 'One-Click' } })).status()).toBe(200);
    expect((await db.getEmailLead(seekerEmail))?.isSuppressed).toBe(true);

    // The canonical resubscribe endpoint (used by /email-preferences "Subscribe")
    const res = await request.post('/api/email/unsubscribe', { data: { token: lead.unsubscribeToken } });
    expect(res.status()).toBe(200);
    expect((await res.json()).success).toBe(true);
    const state = await db.getEmailLead(seekerEmail);
    expect(state?.isSubscribed).toBe(true);
    expect(state?.isSuppressed, 'resubscribe lifts the one-click suppression').toBe(false);
    expect(await db.isProfileEmailSuppressed(seekerEmail), 'profile suppression lifted too').toBe(false);
  });

  // DEFECT: /unsubscribe Resubscribe shows Welcome back but leaves the address suppressed
  test('/unsubscribe?token: unsubscribes on load, is idempotent on reload, and "Resubscribe" restores deliverability', async ({ page }) => {
    const lead = await db.ensureCleanEmailLead(seekerEmail);
    await page.goto(`/unsubscribe?token=${encodeURIComponent(lead.unsubscribeToken)}`);
    await expect(page.getByRole('heading', { name: "You've been unsubscribed" })).toBeVisible();
    let state = await db.getEmailLead(seekerEmail);
    expect(state).toMatchObject({ isSubscribed: false, isSuppressed: true, suppressionReason: 'unsubscribe' });
    expect(await db.isProfileEmailSuppressed(seekerEmail)).toBe(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: "You've been unsubscribed" }), 'repeat visit is a no-op success').toBeVisible();

    await page.getByRole('button', { name: 'Changed your mind? Resubscribe' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back!' })).toBeVisible();
    state = await db.getEmailLead(seekerEmail);
    expect(state?.isSubscribed).toBe(true);
    expect(state?.isSuppressed, 'resubscribe from /unsubscribe must clear suppression or the user still gets nothing').toBe(false);
    expect(await db.isProfileEmailSuppressed(seekerEmail), 'profile suppression cleared').toBe(false);

    await page.goto('/unsubscribe');
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await expect(page.getByText('No unsubscribe token was provided.')).toBeVisible();
    await page.goto('/unsubscribe?token=bogus-token');
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    expect((await db.getEmailLead(seekerEmail))?.isSubscribed, 'bogus token touches nothing').toBe(true);
  });

  test('/email-preferences?token: every toggle saves, survives reload, and unsubscribe-all → subscribe round-trips', async ({ page }) => {
    const lead = await db.ensureCleanEmailLead(seekerEmail);
    await page.goto(`/email-preferences?token=${encodeURIComponent(lead.unsubscribeToken)}`);
    await expect(page.getByRole('heading', { name: 'Email Preferences' })).toBeVisible();
    await expect(page.getByText('e***@example.invalid')).toBeVisible();

    const card = (title: string) => page.locator('div.bg-gray-50').filter({ hasText: title });
    const jobAlerts = card('Weekly Job Alerts');
    const newsletter = card('Monthly Newsletter');
    const nudges = card('Profile Completion Nudges');
    const reminders = card('Saved Job Reminders');

    await expect(jobAlerts.getByRole('button')).toHaveText('Unsubscribe');
    await expect(newsletter.getByRole('button')).toHaveText('Subscribe');

    await newsletter.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.getByText('You are now subscribed to the newsletter.')).toBeVisible();
    await expect(newsletter.getByRole('button')).toHaveText('Unsubscribe');

    await nudges.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(page.getByText('You have been unsubscribed from profile nudge emails.')).toBeVisible();
    await reminders.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(page.getByText('You have been unsubscribed from saved job reminders.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Email Preferences' })).toBeVisible();
    await expect(newsletter.getByRole('button')).toHaveText('Unsubscribe');
    await expect(nudges.getByRole('button')).toHaveText('Subscribe');
    await expect(reminders.getByRole('button')).toHaveText('Subscribe');
    const saved = await db.getEmailLead(seekerEmail);
    expect(saved?.newsletterOptIn).toBe(true);
    expect(saved?.preferences).toMatchObject({ profileNudge: false, savedJobReminder: false });

    // Unsubscribe from all → suppressed; Subscribe → fully restored
    await page.getByRole('button', { name: 'Unsubscribe from All Emails' }).click();
    await expect(page.getByText('You have been unsubscribed from all emails.')).toBeVisible();
    await expect(jobAlerts.getByRole('button')).toHaveText('Subscribe');
    await expect(newsletter.getByRole('button')).toHaveText('Subscribe');
    await expect(page.getByRole('button', { name: 'Unsubscribe from All Emails' })).toBeHidden();
    let state = await db.getEmailLead(seekerEmail);
    expect(state).toMatchObject({ isSubscribed: false, isSuppressed: true, newsletterOptIn: false });

    await jobAlerts.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.getByText('You have been resubscribed to job alerts.')).toBeVisible();
    await expect(jobAlerts.getByRole('button')).toHaveText('Unsubscribe');
    state = await db.getEmailLead(seekerEmail);
    expect(state).toMatchObject({ isSubscribed: true, isSuppressed: false });
    expect(await db.isProfileEmailSuppressed(seekerEmail)).toBe(false);

    // Token-less and bogus links
    await page.goto('/email-preferences');
    await expect(page.getByRole('heading', { name: 'Invalid Link' })).toBeVisible();
    await page.goto('/email-preferences?token=bogus-token');
    await expect(page.getByRole('heading', { name: 'Invalid Link' })).toBeVisible();
  });

  test('/email-preferences: a failed save shows an error and does not flip the toggle', async ({ page }) => {
    const lead = await db.ensureCleanEmailLead(seekerEmail);
    await page.goto(`/email-preferences?token=${encodeURIComponent(lead.unsubscribeToken)}`);
    const newsletter = page.locator('div.bg-gray-50').filter({ hasText: 'Monthly Newsletter' });
    await expect(newsletter.getByRole('button')).toHaveText('Subscribe');
    await page.route('**/api/email/preferences', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Simulated outage' }) })
        : route.continue(),
    );
    await newsletter.getByRole('button', { name: 'Subscribe' }).click();
    await expect(page.getByText('Simulated outage')).toBeVisible();
    await expect(newsletter.getByRole('button'), 'toggle did not flip on failure').toHaveText('Subscribe');
    expect((await db.getEmailLead(seekerEmail))?.newsletterOptIn).toBe(false);
  });

  // DEFECT: /api/email/preferences stores arbitrary non-object preferences payloads
  test('/api/email/preferences rejects a non-object preferences payload instead of storing it', async ({ request }) => {
    const lead = await db.ensureCleanEmailLead(seekerEmail);
    for (const preferences of ['garbage', 42, ['a', 'b'], { nested: { deep: { blob: 'x'.repeat(5000) } } }]) {
      const res = await request.post('/api/email/preferences', { data: { token: lead.unsubscribeToken, preferences } });
      expect(res.status(), `preferences=${JSON.stringify(preferences).slice(0, 40)}`).toBe(400);
    }
    expect((await db.getEmailLead(seekerEmail))?.preferences, 'stored preferences untouched').toEqual({});
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * PUSH NOTIFICATION PROMPT
 * ═════════════════════════════════════════════════════════════════════════ */

test.describe('push notification prompt', () => {
  test('dismissal persists across reloads (logged-in, 3rd+ visit)', async ({ page }) => {
    test.skip(!SEEKER, 'Needs seeker creds');
    test.skip(
      !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY is not configured for this build — PushNotificationPrompt never renders',
    );
    await login(page, 'candidate');
    await page.evaluate(() => {
      localStorage.setItem('pmhnp_visit_count', '5');
      localStorage.removeItem('pmhnp_push_prompt_dismissed');
    });

    // The prompt arms a 20s timer — drive it with a fake clock instead of sleeping.
    await page.clock.install();
    await page.goto('/dashboard');
    await page.clock.runFor(21_000);
    const prompt = page.getByText('Get notified about new jobs');
    await expect(prompt).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(prompt).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('pmhnp_push_prompt_dismissed'))).toBe('1');

    await page.reload();
    await page.clock.runFor(21_000);
    await expect(prompt, 'dismissed prompt stays dismissed').toBeHidden();
  });
});

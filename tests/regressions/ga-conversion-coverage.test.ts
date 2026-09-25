/**
 * GA4 conversion coverage ratchet.
 *
 * Google Analytics is off in production: NEXT_PUBLIC_GA_MEASUREMENT_ID is
 * empty and it is inlined at build time, so gtag.js never loads and no live
 * report can tell anyone a conversion went missing. Every gap this file
 * pins was found by reading source, and every one of them survived months
 * of refactoring precisely because nothing failed when it was dropped.
 *
 * So the pins guard the code path, not the data:
 *
 *   1. the on-site (Easy Apply) conversion reaches GA4 once per application,
 *      on the apply route's own answer, not just the first-party counter
 *   2. both job-alert signup surfaces report a subscribe once per alert, on
 *      the alert route's own answer
 *   3. the main /jobs board emits a list impression like the category hubs
 *   4. a card click can be joined back to that impression
 *   5. item payloads carry real fields and never a placeholder, including
 *      the save from the job detail page
 *   6. the Google signup path is counted alongside the email path
 *   7. the exit popup tells the visitor what the server actually answered
 *
 * Gap 4 is the one to read carefully. JobCard fires select_item only when a
 * surface hands it both halves of the list attribution, so the card alone
 * closes nothing. This file pins the card side and the pair invariant that
 * catches a half-done wiring; which surfaces pass the pair is pinned in
 * tests/regressions/ga-list-clicks.test.ts, and JobCard's own note must
 * agree with what the render sites actually do.
 *
 * Gaps 1 and 2 hinge on a flag (`isNew`) that two routes return, so those
 * routes are exercised for real against mocked dependencies: a static pin
 * on a response literal would pass even if the flag were computed wrongly.
 * Everything else is static source reads plus runtime checks of the pure
 * helpers, matching the repo's regression style (see
 * shell-isr-static-layout.test.ts and p10-job-alerts-consent-validation.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { buildTrackedJobItem, JOBS_BOARD_LIST_NAME } from '@/components/analytics/ViewTrackers';

// ── Route harness (gaps 1 and 2) ─────────────────────────────────────────────
// Every database and network dependency of the two routes is replaced, so
// nothing here can reach the production database the checkout's .env points
// at. `tx` is a separate object from `prisma` on purpose: the routes must do
// their existence read INSIDE the locked transaction, and a read that slipped
// back onto the bare client would hit the empty `prisma.jobApplication` stub
// below and fail loudly instead of passing.
const h = vi.hoisted(() => ({
  emailLead: { upsert: vi.fn(), update: vi.fn() },
  userProfile: { updateMany: vi.fn(), findUnique: vi.fn() },
  job: { findUnique: vi.fn() },
  jobScreeningQuestion: { findMany: vi.fn() },
  txJobAlert: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  txJobApplication: { findUnique: vi.fn(), upsert: vi.fn() },
  bareJobApplication: { findUnique: vi.fn(), upsert: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
  getUser: vi.fn(),
  after: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailLead: h.emailLead,
    userProfile: h.userProfile,
    job: h.job,
    jobScreeningQuestion: h.jobScreeningQuestion,
    jobApplication: h.bareJobApplication,
    $transaction: h.$transaction,
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMITS: {
    jobAlerts: { limit: 10, windowSeconds: 60 },
    applyDirect: { limit: 10, windowSeconds: 60 },
  },
}));
vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));
vi.mock('@/lib/email-service', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue({ success: true }),
  sendNewApplicationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendApplicationConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: h.getUser } }),
}));
vi.mock('@/lib/candidate-scorer', () => ({ scoreCandidate: vi.fn().mockResolvedValue(undefined) }));
// `after` throws outside a real request scope; everything else in
// next/server (NextRequest, NextResponse) stays the real implementation.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: h.after,
}));

import { POST as postJobAlert } from '@/app/api/job-alerts/route';
import { POST as postApplyDirect } from '@/app/api/applications/apply-direct/route';
import { readApplyOutcome } from '@/components/InPlatformApplyForm';
import { describeSubscribeFailure } from '@/components/ExitIntentPopup';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const APPLY_BUTTON = 'components/ApplyButton.tsx';
const APPLY_FORM = 'components/InPlatformApplyForm.tsx';
const APPLY_ROUTE = 'app/api/applications/apply-direct/route.ts';
const ALERT_ROUTE = 'app/api/job-alerts/route.ts';
const SAVE_BUTTON = 'components/SaveJobButton.tsx';
const ALERT_FORM = 'components/CreateAlertForm.tsx';
const EXIT_POPUP = 'components/ExitIntentPopup.tsx';
const SIGNUP_FORM = 'components/auth/SignUpForm.tsx';
const VIEW_TRACKERS = 'components/analytics/ViewTrackers.tsx';
const JOBS_PAGE = 'app/jobs/page.tsx';
const JOB_CARD = 'components/JobCard.tsx';
const JOB_DETAIL_PAGE = 'app/jobs/[slug]/page.tsx';

/** The body of ApplyButton's platform success handler, whatever it is passed. */
function platformSuccessHandler(src: string): string {
  const start = src.search(/const handlePlatformApplySuccess = \([^)]*\) => \{/);
  expect(start, 'handlePlatformApplySuccess not found').toBeGreaterThan(-1);
  const end = src.indexOf('\n  };', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

function alertRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/job-alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function applyRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/applications/apply-direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Array form is the alert route's suppression-lift batch; callback form is
  // the locked find-then-write both routes run, handed the tx delegates.
  h.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => Promise<unknown>)({
          $executeRaw: h.$executeRaw,
          jobAlert: h.txJobAlert,
          jobApplication: h.txJobApplication,
        })
      : Promise.resolve([]),
  );
  h.$executeRaw.mockResolvedValue(1);

  h.emailLead.upsert.mockResolvedValue({ isSuppressed: false, suppressionReason: null });
  h.txJobAlert.findFirst.mockResolvedValue(null);
  h.txJobAlert.create.mockResolvedValue({ id: 'alert-1', token: 'token-1' });
  h.txJobAlert.update.mockResolvedValue({ id: 'alert-1', token: 'token-1' });

  h.getUser.mockResolvedValue({ data: { user: { id: 'seeker-1' } }, error: null });
  h.job.findUnique.mockResolvedValue({
    id: 'job-1',
    title: 'Family Nurse Practitioner',
    employer: 'Northside Clinic',
    applyOnPlatform: true,
    isPublished: true,
    expiresAt: null,
    // No employer contact and no candidate email, so neither notification
    // path runs; they are out of scope for the isNew contract.
    employerJobs: null,
  });
  h.userProfile.findUnique.mockResolvedValue({
    id: 'profile-1',
    firstName: 'Sam',
    lastName: 'Rivera',
    email: null,
    resumeUrl: null,
    headline: null,
    yearsExperience: null,
  });
  h.jobScreeningQuestion.findMany.mockResolvedValue([]);
  h.txJobApplication.findUnique.mockResolvedValue(null);
  h.txJobApplication.upsert.mockResolvedValue({ id: 'application-1' });
});

/** Every surface this file guards, for the shared consent-model check. */
const TRACKED_SURFACES = [
  APPLY_BUTTON,
  APPLY_FORM,
  SAVE_BUTTON,
  ALERT_FORM,
  EXIT_POPUP,
  SIGNUP_FORM,
  JOBS_PAGE,
  JOB_CARD,
];

/** Every .tsx under app/ and components/, for the whole-repo scans below. */
function collectTsx(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      collectTsx(rel, found);
    } else if (entry.name.endsWith('.tsx')) {
      found.push(rel);
    }
  }
  return found;
}

const ALL_TSX = [...collectTsx('app'), ...collectTsx('components')];

describe('gap 1: the on-platform apply is a tracked conversion', () => {
  const src = read(APPLY_BUTTON);

  it('fires trackJobApply on BOTH apply branches, not just the external link', () => {
    const calls = src.match(/trackJobApply\(/g) ?? [];
    expect(calls.length).toBe(2);
    // Bounded by the statement, not by a paren: the item argument is itself
    // a call, so a non-greedy paren match would stop inside it.
    expect(src).toMatch(/trackJobApply\([^;]*'external'\);/);
    expect(src).toMatch(/trackJobApply\([^;]*'platform'\);/);
  });

  it('the platform event fires on the submitted application, not on the modal opening', () => {
    expect(platformSuccessHandler(src)).toMatch(/trackJobApply\([^;]*'platform'\);/);
  });

  it('success still keeps the modal mounted now that the handler takes the outcome', () => {
    // p10-apply-flow-status-and-applied-map.test.ts pins this against the
    // handler's old zero-argument spelling. The handler now receives the
    // route's answer, so the same guarantee is held here against any
    // parameter list: closing the modal on success would unmount the
    // "Application Submitted!" confirmation the instant it rendered.
    expect(platformSuccessHandler(src)).not.toContain('setShowPlatformApply(false)');
  });

  it('counts one lead per application, not one per submission', () => {
    // The apply route upserts on (userId, jobId) and answers 200 whether or
    // not it created a row, and the button offers "Apply Again" to someone who
    // has already applied, so an ungated call books a second generate_lead
    // against one application. The guard must also be READ before markApplied,
    // which flips isApplied(), or its local fallback always reports true.
    const body = platformSuccessHandler(src);

    expect(body).toMatch(/const isFirstApplication = [^;]+;/);
    expect(body).toMatch(/if \(isFirstApplication\) \{\s*\n\s*trackJobApply\([^;]*'platform'\);/);
    expect(body.indexOf('const isFirstApplication')).toBeLessThan(body.indexOf('markApplied(jobId)'));
  });

  it("the route's answer decides, and the local guard runs only when the route did not say", () => {
    // The local guard alone misses an application made on another device or
    // before site data was cleared, and reads a still-loading check as "not
    // applied". The route decides isNew under a lock, so it wins whenever it
    // answered with a boolean. The fallback keeps an older route build (no
    // flag) counting real applications instead of none.
    const body = platformSuccessHandler(src);
    expect(src).toMatch(/const handlePlatformApplySuccess = \(\{ isNew \}: PlatformApplyOutcome\) => \{/);
    expect(body).toMatch(
      /const isFirstApplication = typeof isNew === 'boolean'\s*\?\s*isNew\s*:\s*!serverApplied\?\.applied && !isApplied\(jobId\);/,
    );
  });

  it('the modal hands the route answer to the button through its success callback', () => {
    const form = read(APPLY_FORM);
    expect(form).toContain('onSuccess: (outcome: PlatformApplyOutcome) => void;');
    expect(form).toContain('onSuccess(readApplyOutcome(data));');
    // Still called only after the !res.ok branch has thrown, so a rejected
    // submit never reaches the button's success handler at all.
    const throwIdx = form.indexOf("throw new Error(data.error || 'Failed to submit application');");
    expect(throwIdx).toBeGreaterThan(-1);
    expect(form.indexOf('onSuccess(readApplyOutcome(data));')).toBeGreaterThan(throwIdx);
    expect(src).toContain("import InPlatformApplyForm, { type PlatformApplyOutcome } from '@/components/InPlatformApplyForm';");
    expect(src).toContain('onSuccess={handlePlatformApplySuccess}');
  });

  it('believes only a real boolean from the response body', () => {
    // A malformed body must neither invent a conversion nor suppress one:
    // anything that is not a boolean reads as "unknown", which sends the
    // button to its local guard.
    expect(readApplyOutcome({ success: true, isNew: true })).toEqual({ isNew: true });
    expect(readApplyOutcome({ success: true, isNew: false })).toEqual({ isNew: false });
    for (const body of [{ success: true }, { isNew: 'false' }, { isNew: 0 }, { isNew: null }, null, undefined, 'ok']) {
      expect(readApplyOutcome(body), JSON.stringify(body)).toEqual({});
    }
  });

  it('keeps the first-party click counter beside it (employer dashboards read that one)', () => {
    expect(src).toContain('/track-apply');
  });
});

describe('gap 1: the apply route says whether this submit created the application', () => {
  it('a first submit answers isNew: true', async () => {
    const res = await postApplyDirect(applyRequest({ jobId: 'job-1', consent: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, applicationId: 'application-1', isNew: true });
  });

  it('a re-submit of an existing application answers isNew: false, still 200', async () => {
    h.txJobApplication.findUnique.mockResolvedValue({ status: 'applied', withdrawnAt: null });
    const res = await postApplyDirect(applyRequest({ jobId: 'job-1', consent: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, applicationId: 'application-1', isNew: false });
  });

  it('re-applying after a withdrawal is not a new application either', async () => {
    // The row already exists (the upsert re-activates it), so the lead was
    // counted when it was first created.
    h.txJobApplication.findUnique.mockResolvedValue({ status: 'withdrawn', withdrawnAt: new Date('2026-09-01') });
    const res = await postApplyDirect(applyRequest({ jobId: 'job-1', consent: true }));
    expect((await res.json()).isNew).toBe(false);
  });

  it('decides isNew inside one transaction, after taking the per-application lock', async () => {
    // Two concurrent submits of one application could otherwise both read
    // "no row" and both report a new application for a single row.
    await postApplyDirect(applyRequest({ jobId: 'job-1', consent: true }));
    const lockAt = h.$executeRaw.mock.invocationCallOrder[0];
    const readAt = h.txJobApplication.findUnique.mock.invocationCallOrder[0];
    const writeAt = h.txJobApplication.upsert.mock.invocationCallOrder[0];
    expect(lockAt).toBeLessThan(readAt);
    expect(readAt).toBeLessThan(writeAt);
    expect(h.bareJobApplication.findUnique).not.toHaveBeenCalled();
    expect(h.bareJobApplication.upsert).not.toHaveBeenCalled();
    const lockSql = (h.$executeRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(lockSql).toContain('pg_advisory_xact_lock');
    expect(h.$executeRaw.mock.calls[0][1]).toBe('job_application:submit:seeker-1:job-1');
  });

  it('the auto-reject fields still ride beside it', async () => {
    h.jobScreeningQuestion.findMany.mockResolvedValue([
      { id: 'q1', questionText: 'Licensed?', isRequired: true, isKnockout: true, knockoutAnswer: 'no' },
    ]);
    const res = await postApplyDirect(
      applyRequest({ jobId: 'job-1', consent: true, screeningAnswers: [{ questionId: 'q1', answer: 'no' }] }),
    );
    expect(await res.json()).toEqual({
      success: true,
      applicationId: 'application-1',
      isNew: true,
      autoRejected: true,
      autoRejectReason: 'Does not meet requirement: Licensed?',
    });
  });

  it('source pin: the response carries the transaction answer, not a second read', () => {
    const route = read(APPLY_ROUTE);
    expect(route).toContain('return { application: saved, isNew: existingApplication === null };');
    expect(route).toMatch(/return NextResponse\.json\(\{\s*success: true,\s*applicationId: application\.id,[\s\S]*?\bisNew,/);
  });
});

describe('gap 2: job alert signup reports one subscribe per alert', () => {
  it('the alert modal fires only after the route confirmed the alert', () => {
    const src = read(ALERT_FORM);
    expect(src).toMatch(/import \{ trackEmailSubscribe \} from '@\/lib\/analytics'/);
    // The failure branch throws, so anything below it runs on success only.
    const throwIdx = src.indexOf('throw new Error(result.error');
    const trackIdx = src.indexOf('trackEmailSubscribe(');
    expect(throwIdx).toBeGreaterThan(-1);
    expect(trackIdx).toBeGreaterThan(throwIdx);
  });

  it('neither surface counts a resubmission that the route merged into an existing alert', () => {
    // app/api/job-alerts/route.ts answers 200 for a repeat of identical
    // criteria and updates the row in place, so a 2xx alone does not mean a
    // new alert exists. Both call sites therefore read the route's own
    // `isNew` answer (pinned at runtime in the next describe). Written as
    // "not false" so an older route build that omits the field still
    // reports its real signups: see the comments at each call site.
    expect(read(ALERT_FORM)).toMatch(
      /if \(result\.isNew !== false\) trackEmailSubscribe\(SUBSCRIBE_SOURCE\);/,
    );
    const popup = read(EXIT_POPUP);
    expect(popup).toContain('const isRepeat = body?.isNew === false;');
    expect(popup).toContain('if (!isRepeat) trackEmailSubscribe(SUBSCRIBE_SOURCE);');
    expect(popup.match(/trackEmailSubscribe\(/g)).toHaveLength(1);
  });

  it('the exit popup still requires a successful response before counting anything', () => {
    const src = read(EXIT_POPUP);
    expect(src).toMatch(/import \{ trackEmailSubscribe \} from '@\/lib\/analytics'/);
    // The failure branch returns, so anything below it runs on success only.
    const failIdx = src.indexOf('if (!response.ok || body?.success === false) {');
    expect(failIdx).toBeGreaterThan(-1);
    expect(src.indexOf('trackEmailSubscribe(SUBSCRIBE_SOURCE)')).toBeGreaterThan(failIdx);
    // A network failure never reaches the count either: its catch returns.
    expect(src).toMatch(/\} catch \{\s*failWith\(describeSubscribeFailure\(null\)\);\s*return;\s*\}/);
    // The body read must not be able to fail the submit handler: a route
    // that answers a non-JSON body would otherwise throw past every state
    // and leave the popup spinning.
    expect(src).toMatch(/await response\.json\(\)\.catch\(\(\) => null\)/);
  });

  it('each surface names itself, so the two are never read as one number', () => {
    expect(read(ALERT_FORM)).toMatch(/const SUBSCRIBE_SOURCE = 'job_alert_modal'/);
    expect(read(EXIT_POPUP)).toMatch(/const SUBSCRIBE_SOURCE = 'exit_intent_popup'/);
  });
});

describe('gap 2: the alert route says whether it stored a new alert', () => {
  const EMAIL = 'seeker@example.com';

  it('a first signup answers isNew: true', async () => {
    const res = await postJobAlert(alertRequest({ email: EMAIL, frequency: 'daily' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      isNew: true,
      alert: { id: 'alert-1', token: 'token-1' },
    });
    expect(h.txJobAlert.create).toHaveBeenCalledTimes(1);
  });

  it('a repeat of the same criteria answers isNew: false with the same status and fields', async () => {
    // Exactly the exit popup's case: no criteria, so every signup from one
    // address lands on the one all-null alert.
    h.txJobAlert.findFirst.mockResolvedValue({
      id: 'alert-1',
      token: 'token-1',
      name: null,
      confirmedAt: new Date('2026-09-01'),
    });
    const res = await postJobAlert(alertRequest({ email: EMAIL, frequency: 'daily' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      isNew: false,
      alert: { id: 'alert-1', token: 'token-1' },
    });
    expect(h.txJobAlert.create).not.toHaveBeenCalled();
  });

  it('decides isNew from the read taken under the per-address lock', async () => {
    await postJobAlert(alertRequest({ email: EMAIL }));
    expect(h.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      h.txJobAlert.findFirst.mock.invocationCallOrder[0],
    );
    expect(read(ALERT_ROUTE)).toMatch(/success: true,[\s\S]*?isNew: existing === null,[\s\S]*?alert: \{/);
  });

  it('a rejected signup carries no isNew at all, so no surface can count it', async () => {
    const res = await postJobAlert(alertRequest({ email: 'not-an-address' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid email address' });
  });
});

describe('gap 7: the exit popup tells the visitor what the server answered', () => {
  const src = read(EXIT_POPUP);

  it('shows the confirmation only after the failure branch has returned', () => {
    // It used to set 'done' after the try/catch whatever happened, so a
    // rejected address or a server error still read "You're subscribed!".
    expect(src).not.toContain("setStatus('done')");
    const failIdx = src.indexOf('if (!response.ok || body?.success === false) {');
    const confirmIdx = src.indexOf("setStatus(isRepeat ? 'repeat-confirmed' : 'subscribed');");
    expect(failIdx).toBeGreaterThan(-1);
    expect(confirmIdx).toBeGreaterThan(failIdx);
    expect(src).toMatch(/failWith\(describeSubscribeFailure\(response\.status\)\);\s*return;/);
  });

  it('closes itself only after a confirmed signup, so a failure stays readable', () => {
    const timers = src.match(/setTimeout\(dismiss, [A-Z_]+\)/g) ?? [];
    expect(timers).toEqual(['setTimeout(dismiss, CONFIRMATION_VISIBLE_MS)']);
    expect(src.indexOf('setTimeout(dismiss')).toBeGreaterThan(
      src.indexOf("setStatus(isRepeat ? 'repeat-confirmed' : 'subscribed');"),
    );
  });

  it('announces the failure next to the field it concerns', () => {
    expect(src).toMatch(/id=\{EXIT_POPUP_ERROR_ID\}\s*role="alert"/);
    expect(src).toContain('aria-describedby={failure ? EXIT_POPUP_ERROR_ID : undefined}');
    expect(src).toContain('aria-invalid={failure?.blamesEmail ? true : undefined}');
    expect(src).toContain('{failure.message}');
  });

  it.each([
    ['no answer (network)', null],
    ['a rejected address', 400],
    ['rate limited', 429],
    ['a server error', 500],
    ['an unexpected status', 503],
  ])('%s: says the visitor is not subscribed and what to do', (_label, status) => {
    const { message } = describeSubscribeFailure(status);
    expect(message).toContain('not subscribed yet');
    expect(message).toMatch(/try again/i);
    // House style: no en or em dash and no spaced hyphen in visible copy.
    expect(message).not.toMatch(/[\u2013\u2014]| - /);
  });

  it('marks the field invalid only when the address itself was the problem', () => {
    expect(describeSubscribeFailure(400).blamesEmail).toBe(true);
    for (const status of [null, 429, 500]) {
      expect(describeSubscribeFailure(status).blamesEmail).toBe(false);
    }
  });

  it('a repeat signup is confirmed without promising a welcome email', () => {
    // The route sends the welcome email only for an alert it newly
    // confirmed, so the repeat branch must not send the visitor to look for
    // one. The first-signup branch keeps the promise.
    const start = src.indexOf("{status === 'repeat-confirmed' ? (");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(') : (', start);
    const repeatBranch = src.slice(start, end);
    expect(repeatBranch).toContain('Daily job alerts for this address are on.');
    expect(repeatBranch).not.toMatch(/welcome email|check your inbox/i);
    expect(src.slice(end)).toContain('Check your inbox for a welcome email.');
  });

  it('a repeat signup never claims the visitor was subscribed before this click', () => {
    // The route answers isNew false for any matched row, including one the
    // visitor paused, one whose address clicked Unsubscribe (the JobAlert
    // row survives unsubscribeLead), and a legacy pending alert. None of
    // them were receiving alerts, so "already subscribed" was false for
    // them, and it told someone who unsubscribed that the unsubscribe had
    // not worked. The status name is sliced in too, so it cannot carry the
    // word back in by accident.
    const start = src.indexOf("{status === 'repeat-confirmed' ? (");
    expect(start).toBeGreaterThan(-1);
    const repeatBranch = src.slice(start, src.indexOf(') : (', start));
    expect(repeatBranch).toContain('✓ You&apos;re subscribed');
    expect(repeatBranch).not.toContain('already');
    expect(src).not.toMatch(/already subscribed/i);
  });
});

describe('gap 3: the main /jobs board emits a list impression', () => {
  const src = read(JOBS_PAGE);

  it('mounts the board list tracker, the way the category hubs mount theirs', () => {
    expect(src).toMatch(
      /import \{ JobsBoardListViewTracker \} from '@\/components\/analytics\/ViewTrackers'/,
    );
    expect(src).toContain('<JobsBoardListViewTracker');
  });

  it('feeds it the server-rendered rows, not a hand-rolled list', () => {
    const start = src.indexOf('<JobsBoardListViewTracker');
    const end = src.indexOf('/>', start);
    const block = src.slice(start, end);
    expect(block).toContain('jobs.map(');
    expect(block).toContain('title: j.title');
    expect(block).toContain('employer: j.employer');
  });

  it('sends the state CODE, so item_category3 matches every other surface', () => {
    // Job.state is "California" and Job.stateCode is "CA", in separate
    // columns. item_category3 is one item-scoped dimension, and the detail
    // page (view_item) and the card click (select_item) both send the code,
    // so the long name from this one surface would split every Californian
    // listing across two values.
    const start = src.indexOf('<JobsBoardListViewTracker');
    const end = src.indexOf('/>', start);
    const block = src.slice(start, end);
    expect(block).toContain('stateCode: j.stateCode');
    expect(block).not.toMatch(/\bstate: j\.state\b/);
    // The mapping can only read a column the query selected.
    expect(src).toMatch(/^\s*stateCode: true,$/m);
  });

  it('the list name never crosses the server boundary as a bare constant', () => {
    // A "use client" module's non-component exports arrive in a Server
    // Component as client references, not values, so the page must import
    // the wrapper component and never JOBS_BOARD_LIST_NAME itself.
    expect(src).not.toContain('JOBS_BOARD_LIST_NAME');
    const trackers = read(VIEW_TRACKERS);
    expect(trackers).toMatch(/export function JobsBoardListViewTracker/);
    expect(trackers).toContain('listName={JOBS_BOARD_LIST_NAME}');
  });
});

describe('gap 4: a card click can be joined back to the list impression', () => {
  const src = read(JOB_CARD);

  /**
   * The <JobCard> elements in each file that renders one, which is where
   * attribution enters. Scoped to the element rather than the file on
   * purpose: the category hubs already spell `listName=` on their
   * JobListViewTracker, and a whole-file match would read that impression
   * as a wired card click.
   *
   * The word boundary matters too, or the pattern also claims
   * <JobCardSkeleton>, which renders no job and tracks nothing. Every site
   * self-closes the element, so `/>` is the reliable end marker.
   */
  const elementsPerSite = ALL_TSX.filter((rel) => rel !== JOB_CARD).map((rel) => ({
    rel,
    elements: read(rel).match(/<JobCard\b[\s\S]*?\/>/g) ?? [],
  }));
  const renderSites = elementsPerSite.filter((site) => site.elements.length > 0);

  it('imports trackJobClick and fires it from every route out of the card', () => {
    expect(src).toMatch(/import \{ trackJobClick \} from '@\/lib\/analytics'/);
    const cardClick = src.indexOf('const handleCardClick = () => {');
    const easyApply = src.indexOf('const handleEasyApplyClick = (e: React.MouseEvent) => {');
    expect(cardClick).toBeGreaterThan(-1);
    expect(easyApply).toBeGreaterThan(-1);
    expect(src.slice(cardClick, src.indexOf('};', cardClick))).toContain('trackListClick()');
    expect(src.slice(easyApply, src.indexOf('};', easyApply))).toContain('trackListClick()');
  });

  it('refuses to invent a list name or a position', () => {
    expect(src).toMatch(/if \(!listName \|\| typeof listIndex !== 'number'\) return;/);
  });

  it('keeps both attribution props optional so existing call sites still compile', () => {
    expect(src).toMatch(/listName\?: string;/);
    expect(src).toMatch(/listIndex\?: number;/);
  });

  it('finds the card render sites at all, so the two scans below mean something', () => {
    // A rename that broke the element match would make every scan pass by
    // finding nothing.
    expect(renderSites.length).toBeGreaterThan(10);
    expect(renderSites.map((site) => site.rel)).toContain('app/jobs/JobsPageClient.tsx');
  });

  it('every card supplies the attribution as a pair, or supplies neither', () => {
    // The guard above drops a select_item that carries only one half, so a
    // card wired with a list name but no index would look instrumented in
    // review and emit nothing at runtime. This is the assertion that
    // catches that, on whichever surface is wired first.
    const halfWired = renderSites
      .filter((site) =>
        site.elements.some((el) => el.includes('listName=') !== el.includes('listIndex=')),
      )
      .map((site) => site.rel);
    expect(halfWired).toEqual([]);
  });

  it("JobCard's note on who passes the attribution matches the render sites", () => {
    // The render sites are wired by a different change from the one that
    // owns JobCard, so the card's prop note and the surfaces can disagree.
    // While no site passed the pair, the note said "No render site passes
    // them yet" so nobody read gap 4 as closed. Once a site passes it, that
    // sentence is false and has to go. Pinned as agreement rather than as
    // one state, so the test is right whichever side of the wiring the
    // branch is on. Which surfaces must pass the pair, and how, is pinned in
    // tests/regressions/ga-list-clicks.test.ts; this file keeps the JobCard
    // side of it.
    const wired = renderSites
      .filter((site) => site.elements.some((el) => el.includes('listIndex=')))
      .map((site) => site.rel);
    const noteSaysUnwired = src.includes('No render site passes them yet');
    expect(noteSaysUnwired, `wired render sites: ${wired.join(', ') || 'none'}`).toBe(
      wired.length === 0,
    );
  });

  it('the shared list name is one exported constant, so impression and click cannot drift', () => {
    expect(read(VIEW_TRACKERS)).toMatch(/export const JOBS_BOARD_LIST_NAME = /);
    expect(typeof JOBS_BOARD_LIST_NAME).toBe('string');
    expect(JOBS_BOARD_LIST_NAME.length).toBeGreaterThan(0);
  });
});

describe('gap 5: item payloads carry real fields, never a placeholder', () => {
  it('omits item_brand rather than sending the literal Unknown', () => {
    const item = buildTrackedJobItem({ id: 'job-1', title: 'Nurse Practitioner' });
    expect(item.item_id).toBe('job-1');
    expect(item.item_name).toBe('Nurse Practitioner');
    expect('item_brand' in item).toBe(false);
  });

  it('omits item_name rather than sending a blank one', () => {
    // The Save button on the job detail page used to be handed a job id and
    // nothing else, and it sent item_name: ''. GA4 stores that as a real
    // value, so the same job showed its title on view_item and a blank row
    // on add_to_wishlist. Absent reports as "(not set)", which is still the
    // right answer for any caller that has no title to give.
    const noTitle = buildTrackedJobItem({ id: 'job-2' });
    expect(noTitle.item_id).toBe('job-2');
    expect('item_name' in noTitle).toBe(false);
    const blankTitle = buildTrackedJobItem({ id: 'job-3', title: '' });
    expect('item_name' in blankTitle).toBe(false);
  });

  it('keeps item_id on every item, so an unnamed item still joins its funnel', () => {
    // item_id is the only key GA4 uses to line an item up across view_item,
    // add_to_wishlist and generate_lead, so dropping a name costs a label
    // and not the funnel.
    for (const job of [{ id: 'a' }, { id: 'b', title: 'Family NP' }, { id: 'c', employer: null }]) {
      expect(buildTrackedJobItem(job).item_id).toBe(job.id);
    }
  });

  it('keeps a real employer name and the dimensions the caller supplied', () => {
    const item = buildTrackedJobItem({
      id: 'job-4',
      title: 'Family NP',
      employer: 'Northside Clinic',
      jobType: 'Full-time',
      stateCode: 'CA',
      sourceProvider: 'employer',
      normalizedMinSalary: 120000,
    });
    expect(item.item_brand).toBe('Northside Clinic');
    expect(item.item_category).toBe('Full-time');
    expect(item.item_category3).toBe('CA');
    expect(item.item_category4).toBe('employer');
    expect(item.price).toBe(120000);
  });

  it('treats a null or empty employer as absent, not as a company named Unknown', () => {
    expect('item_brand' in buildTrackedJobItem({ id: 'a', title: 'Acute Care NP', employer: null })).toBe(false);
    expect('item_brand' in buildTrackedJobItem({ id: 'b', title: 'Acute Care NP', employer: '' })).toBe(false);
  });

  it('reports the state as a code or not at all, never as a long name', () => {
    // TrackedJob has no `state` field, so the only way into item_category3
    // is the two-letter code. A row with no recorded code omits the
    // dimension on every surface rather than carrying "California" on one.
    const withCode = buildTrackedJobItem({ id: 'd', title: 'Acute Care NP', stateCode: 'CA' });
    expect(withCode.item_category3).toBe('CA');
    const withoutCode = buildTrackedJobItem({ id: 'e', title: 'Acute Care NP', stateCode: null });
    expect(withoutCode.item_category3).toBeUndefined();
    // Pinned in source too: buildJobItem still accepts `state` and falls
    // back to it, so re-adding the field here would silently reopen the gap.
    const trackers = read(VIEW_TRACKERS);
    expect(trackers).not.toMatch(/^\s*state\?: string \| null;$/m);
    expect(trackers).not.toMatch(/^\s*state: job\.state/m);
  });

  it('every surface that names a state to GA4 names it as a code', () => {
    for (const rel of [JOBS_PAGE, JOB_CARD, APPLY_BUTTON, SAVE_BUTTON]) {
      const src = read(rel);
      if (!src.includes('stateCode')) continue;
      expect(src, rel).not.toMatch(/\bstate: (j|job)\.state\b/);
    }
  });

  it('keeps an employer whose recorded name really is Unknown', () => {
    // The drop is keyed on what the caller supplied, so a row that genuinely
    // carries that name is reported as itself rather than erased.
    const item = buildTrackedJobItem({ id: 'c', title: 'Acute Care NP', employer: 'Unknown' });
    expect(item.item_brand).toBe('Unknown');
  });

  it('the apply and save buttons build their item through the honest builder', () => {
    for (const rel of [APPLY_BUTTON, SAVE_BUTTON]) {
      const src = read(rel);
      expect(src, rel).toContain('buildTrackedJobItem(');
      // The old degraded payload: buildJobItem called with an id and a
      // hand-written title, bypassing the omissions above.
      expect(src, rel).not.toMatch(/buildJobItem\(\{ id: jobId/);
    }
  });

  it('the save button forwards its title untouched instead of defaulting it', () => {
    // `jobTitle ?? ''` reads like a fix and changes nothing: the event still
    // carries a blank name. The prop must reach the builder as undefined so
    // the key is dropped.
    const src = read(SAVE_BUTTON);
    expect(src).toContain('title: jobTitle,');
    expect(src).not.toMatch(/title: jobTitle \?\?/);
    expect(src).not.toMatch(/title: jobTitle \|\|/);
  });

  it('the save button accepts the dimensions the detail page can supply', () => {
    const src = read(SAVE_BUTTON);
    for (const prop of ['jobTitle?', 'employer?', 'jobType?', 'stateCode?', 'sourceProvider?']) {
      expect(src, prop).toContain(prop);
    }
  });

  it('the job detail page hands the save button every field it accepts', () => {
    // The prop list is read from the component, so a dimension added to
    // SaveJobButton later is demanded here too instead of silently arriving
    // in GA4 as "(not set)" from the one page that renders the button.
    const saveSrc = read(SAVE_BUTTON);
    const propsStart = saveSrc.indexOf('interface SaveJobButtonProps {');
    expect(propsStart).toBeGreaterThan(-1);
    const propsBlock = saveSrc.slice(propsStart, saveSrc.indexOf('\n}', propsStart));
    const accepted = [...propsBlock.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(accepted).toEqual(['jobId', 'jobTitle', 'employer', 'jobType', 'stateCode', 'sourceProvider']);

    // Both render sites: the desktop sidebar and the mobile sticky bar.
    const sites = read(JOB_DETAIL_PAGE).match(/<SaveJobButton\b[\s\S]*?\/>/g) ?? [];
    expect(sites).toHaveLength(2);
    for (const site of sites) {
      for (const prop of accepted) {
        expect(site, prop).toMatch(new RegExp(`\\b${prop}=\\{`));
      }
    }
  });

  it('the detail page save reports the same row as the detail view', () => {
    // add_to_wishlist and view_item are joined on item_id, but the labels
    // must agree too, so both read the raw job row rather than the display
    // strings the page renders.
    const page = read(JOB_DETAIL_PAGE);
    const sites = page.match(/<SaveJobButton\b[\s\S]*?\/>/g) ?? [];
    const fromRow: Array<[string, string]> = [
      ['jobId', 'job.id'],
      ['jobTitle', 'job.title'],
      ['employer', 'job.employer'],
      ['jobType', 'job.jobType'],
      ['stateCode', 'job.stateCode'],
      ['sourceProvider', 'job.sourceProvider'],
    ];
    for (const site of sites) {
      for (const [prop, expr] of fromRow) {
        expect(site).toContain(`${prop}={${expr}}`);
      }
    }
    const viewTracker = page.slice(page.indexOf('<JobViewTracker'), page.indexOf('/>', page.indexOf('<JobViewTracker')));
    expect(viewTracker).toContain('title: job.title');
    expect(viewTracker).toContain('employer: job.employer');
  });

  it('neither conversion button accepts a salary, because it lands as the event value', () => {
    // trackJobApply sends the item's price as generate_lead's `value` and
    // trackJobSave sends it as add_to_wishlist's. A salary there books a
    // six-figure conversion value for one click, which is what Google Ads
    // bidding and every ROAS report would read. The impression and the
    // detail view still carry it, where it is an item attribute.
    for (const rel of [APPLY_BUTTON, SAVE_BUTTON]) {
      expect(read(rel), rel).not.toContain('normalizedMinSalary');
    }
    expect(read(VIEW_TRACKERS)).toContain('normalizedMinSalary');
  });
});

describe('gap 6: the Google signup cohort is counted', () => {
  const src = read(SIGNUP_FORM);

  it('fires trackSignUp for the email path and the Google path', () => {
    expect(src).toMatch(/trackSignUp\('email',/);
    expect(src).toMatch(/trackSignUp\('google', 'job_seeker'\)/);
  });

  it('tracks the Google path from a wrapper, leaving the button props untouched', () => {
    // GoogleSignInButton exposes no callback, and the redirect wiring is
    // pinned by signup-redirect-intent.test.ts, so the wrapper must not
    // rewrite the element.
    expect(src).toMatch(/<GoogleSignInButton\s+mode="signup"\s+redirectTo=\{redirectTo\}/);
    expect(src).toMatch(/onClickCapture=\{\(\) => trackSignUp\('google', 'job_seeker'\)\}/);
  });
});

describe('every tracked surface respects the existing consent model', () => {
  it.each(TRACKED_SURFACES)('%s never touches window.gtag directly', (rel) => {
    // lib/analytics.ts owns the Consent Mode v2 gating and the dataLayer
    // shim. A component reaching for window.gtag would bypass both and
    // start sending hits the visitor did not agree to.
    expect(read(rel)).not.toMatch(/window\.gtag/);
  });

  it.each(TRACKED_SURFACES)('%s carries no console.log', (rel) => {
    expect(read(rel)).not.toMatch(/console\.log\(/);
  });
});

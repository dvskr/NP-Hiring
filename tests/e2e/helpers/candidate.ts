/**
 * Shared helpers for the candidate-account journey
 * (tests/e2e/journeys/job-seeker.spec.ts).
 *
 * Everything here is deterministic — no arbitrary sleeps. Seed ids come from
 * .env.test (written by the E2E setup step); every export tolerates a
 * missing seed so the spec can `test.skip` with a reason instead of crashing.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { db, hasDb, supabaseIdForEmail } from './db';

// ── Environment ─────────────────────────────────────────────────────────────

export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

/**
 * lib/csrf.ts accepts Origin http://localhost:3000 (static allowlist) or the
 * served origin, which under `next start` resolves to `localhost` — so a
 * browser at http://127.0.0.1:3000 gets 403 on every mutating API call
 * (verified: POST /api/saved-jobs → 403 from 127.0.0.1, 401 from localhost).
 * Stateful blocks therefore run on MUT_ORIGIN. Cookies are per-host, so a
 * block must stay on one origin from login to logout.
 */
export const MUT_ORIGIN =
  process.env.PLAYWRIGHT_MUTATION_BASE_URL ||
  (BASE_URL.includes('127.0.0.1') ? BASE_URL.replace('127.0.0.1', 'localhost') : BASE_URL);

export const SEEDS = {
  easyApplyJobId: process.env.E2E_EASY_APPLY_JOB_ID || null,
  easyApplyJobSlug: process.env.E2E_EASY_APPLY_JOB_SLUG || null,
  employerJobId: process.env.E2E_TEST_JOB_ID || null,
  employerJobSlug: process.env.E2E_TEST_JOB_SLUG || null,
};

/** Fresh fake client IP — lib/rate-limit.ts keys buckets on x-forwarded-for. */
export function uniqueIp(): string {
  const octet = () => 1 + Math.floor(Math.random() * 253);
  return `10.${octet()}.${octet()}.${octet()}`;
}

// ── Seeker state reset (Prisma) ─────────────────────────────────────────────

let seekerSupabaseId: string | null | undefined;

export async function resolveSeekerId(email: string): Promise<string | null> {
  if (seekerSupabaseId !== undefined) return seekerSupabaseId;
  seekerSupabaseId = hasDb() ? await supabaseIdForEmail(email) : null;
  return seekerSupabaseId;
}

/**
 * Remove every row this journey creates for the seeded candidate so each
 * test (and each run) starts from the same empty state: applications on the
 * seed jobs, saved jobs, and the resume reference.
 */
export async function resetSeekerState(email: string): Promise<void> {
  const id = await resolveSeekerId(email);
  if (!id) return;
  const jobIds = [SEEDS.easyApplyJobId, SEEDS.employerJobId].filter((v): v is string => Boolean(v));
  await db().jobApplication.deleteMany({ where: { userId: id, jobId: { in: jobIds } } });
  await db().savedJob.deleteMany({ where: { userId: id } });
}

export async function clearSeekerResume(email: string): Promise<void> {
  const id = await resolveSeekerId(email);
  if (!id) return;
  await db().userProfile.updateMany({
    where: { supabaseId: id },
    data: { resumeUrl: null, resumeParseStatus: null },
  });
}

// ── Supabase auth cleanup for throwaway signups ─────────────────────────────

export function canDeleteAuthUsers(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Delete the auth user (and any profile row) a signup test created. */
export async function deleteAuthUserByEmail(email: string): Promise<boolean> {
  if (!canDeleteAuthUsers()) return false;
  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return false;
    const found = data.users.find((u) => (u.email || '').toLowerCase() === target);
    if (found) {
      if (hasDb()) await db().userProfile.deleteMany({ where: { supabaseId: found.id } });
      const { error: delErr } = await admin.auth.admin.deleteUser(found.id);
      return !delErr;
    }
    if (data.users.length < 200) break;
  }
  return false;
}

// ── API helpers (browser-context cookies, same-origin headers) ──────────────

interface ScreeningQuestion {
  id: string;
  questionText: string;
  questionType: string;
  isRequired: boolean;
}

export async function fetchScreeningQuestions(page: Page, jobId: string): Promise<ScreeningQuestion[]> {
  const res = await page.request.get(`/api/jobs/${jobId}/screening-questions`);
  if (!res.ok()) return [];
  const body = (await res.json()) as { questions?: ScreeningQuestion[] };
  return body.questions ?? [];
}

/** Submit an Easy Apply application through the real API using the page's session. */
export async function applyViaApi(page: Page, jobId: string, coverLetter = 'E2E application via API'): Promise<string> {
  const questions = await fetchScreeningQuestions(page, jobId);
  const res = await page.request.post('/api/applications/apply-direct', {
    headers: { Origin: MUT_ORIGIN },
    timeout: 60_000,
    data: {
      jobId,
      coverLetter,
      consent: true,
      screeningAnswers: questions.map((q) => ({
        questionId: q.id,
        answer: q.questionType === 'boolean' ? 'yes' : 'E2E answer',
      })),
    },
  });
  expect(res.status(), `apply-direct: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { applicationId: string };
  return body.applicationId;
}

export async function saveJobViaApi(page: Page, jobId: string): Promise<void> {
  const res = await page.request.post('/api/saved-jobs', { headers: { Origin: MUT_ORIGIN }, data: { jobId }, timeout: 60_000 });
  expect(res.status(), `POST /api/saved-jobs: ${await res.text()}`).toBe(200);
}

export async function savedJobIds(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/saved-jobs');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { savedJobs: Array<{ jobId: string }> };
  return body.savedJobs.map((r) => r.jobId);
}

export interface ApplicationRow {
  id: string;
  status: string;
  withdrawnAt: string | null;
  job: { id: string; title: string };
}

export async function applicationsViaApi(page: Page): Promise<ApplicationRow[]> {
  const res = await page.request.get('/api/applications');
  expect(res.status()).toBe(200);
  return (await res.json()) as ApplicationRow[];
}

// ── UI helpers ──────────────────────────────────────────────────────────────

export const APPLY_DIALOG_NAME = /apply for this position/i;

export function applyDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: APPLY_DIALOG_NAME });
}

export function easyApplyButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(easy apply|apply again)$/i }).first();
}

/** Click Easy Apply and wait for the in-platform modal (profile loaded). */
export async function openApplyModal(page: Page): Promise<Locator> {
  await easyApplyButton(page).click();
  const dialog = applyDialog(page);
  await expect(dialog).toBeVisible();
  // The profile fetch is slow on a shared, loaded server; allow it time.
  await expect(dialog.getByText(/loading your profile/i)).toHaveCount(0, { timeout: 45_000 });
  return dialog;
}

/** The shared ConfirmDialog (components/ui/ConfirmDialog.tsx). */
export function confirmDialog(page: Page, title: RegExp): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) });
}

/** Open the header user menu and click "Sign out". */
export async function signOutViaMenu(page: Page): Promise<void> {
  await page.locator('button.um-trigger').first().click();
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.waitForURL((url) => !/\/(dashboard|settings|saved|my-applications)/.test(url.pathname));
}

// ── Resume fixture ──────────────────────────────────────────────────────────

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/**
 * The resume the upload tests send. Uses tests/e2e/fixtures/sample-resume.pdf
 * when present (E2E_TEST_RESUME_PATH overrides), otherwise a minimal
 * single-page PDF generated in memory — *.pdf is gitignored, so a checkout
 * never carries the binary and the block must not skip for that reason.
 * The bytes start with %PDF- so lib/supabase-storage.ts's magic-byte check
 * accepts them.
 */
export function resumeFixtureFile(fromPath?: string): FilePayload {
  if (fromPath && fs.existsSync(fromPath)) {
    return { name: path.basename(fromPath), mimeType: 'application/pdf', buffer: fs.readFileSync(fromPath) };
  }
  const text = 'E2E Candidate, PMHNP-BC. Telehealth psychiatry. Board certified. e2e-candidate@example.invalid';
  const stream = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: 'sample-resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from(body, 'latin1') };
}

// ── Copy rule: no em/en dashes in rendered text ─────────────────────────────

/**
 * Visible text nodes on the page that contain an em dash (U+2014) or en dash
 * (U+2013). Employer-authored job data is not subject to the copy rule, so
 * callers pass the strings to exclude (job titles/descriptions). Returns
 * short snippets with their element path for the defect report.
 */
export async function visibleDashOffenders(page: Page, exclude: string[] = []): Promise<string[]> {
  const found = await page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const isVisible = (el: Element | null) => {
      for (let n = el; n; n = n.parentElement) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(n.tagName)) return false;
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (n.getAttribute('aria-hidden') === 'true') return false;
      }
      return true;
    };
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/[–—]/.test(text)) continue;
      const el = node.parentElement;
      if (!isVisible(el)) continue;
      const tag = el ? el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') : 'text';
      out.push(`<${tag}> ${text.slice(0, 120)}`);
      if (out.length >= 25) break;
    }
    return out;
  });
  return found.filter((snippet) => !exclude.some((s) => s && snippet.includes(s)));
}

// ── Application status (Prisma) ─────────────────────────────────────────────

/** Move the seeded candidate's application on a job into an employer-set pipeline status. */
export async function setApplicationStatus(email: string, jobId: string, status: string): Promise<void> {
  const id = await resolveSeekerId(email);
  if (!id) throw new Error('seeker supabaseId not resolvable');
  await db().jobApplication.update({
    where: { userId_jobId: { userId: id, jobId } },
    data: { status, statusUpdatedAt: new Date() },
  });
}

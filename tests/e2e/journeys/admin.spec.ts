import { type Page, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getAdminCreds,
  getEmployerCreds,
  getSeekerCreds,
  loginAsAdmin,
  type AuthCreds,
} from '../fixtures/auth';
import { auditRows, closeDb, db, hasDb, supabaseIdForEmail } from '../helpers/db';
import {
  test,
  expect,
  REPO_ROOT,
  BASE,
  MUTATION_BASE,
  AGAINST_PROD,
  USER_AGENT,
  PLACEHOLDER_ID,
  RENDER_ERROR,
  nextIp,
  ipHeaders,
  expectCleanConsole,
  ensureAuthState,
  listAdminApiRoutes,
  listAdminPages,
  probeBody,
  describeGate,
  isUnauthGate,
  isWrongRoleGate,
  bodyText,
  waitForBody,
  visibleDashes,
  listCronRoutes,
  searchAdminJobs,
} from '../helpers/admin-fixtures';

/**
 * Admin console journey — full E2E with mutations and adversarial checks.
 *
 * Coverage:
 *   1. Gating — every /admin page and every /api/admin route (enumerated from
 *      the filesystem so a new route can never be forgotten) rejects both an
 *      anonymous visitor and a signed-in NON-admin.
 *   2. Jobs management — publish/unpublish toggle, edit modal (mouse + keyboard),
 *      refresh mid-flow, validation on the PATCH/DELETE API, audit trail.
 *   3. Companies — recruitment-type classification saves, is audit-logged,
 *      surfaces on the public profile and moves the /jobs filter count.
 *   4. Testimonials — employer submits, admin features, /testimonials renders
 *      (and 404s before), attribution can only be narrowed.
 *   5. Company claims — employer claims from the public profile, admin approves,
 *      Claimed badge on the profile, revoke clears it, duplicate claim is refused.
 *   6. Dashboards — seo-health coverage panel (+ sitemap quarantine), cron list,
 *      outreach, pd-campaign, dmarc, health all render without console/page errors.
 *   7. API hardening — throwaway fixtures probed with wrong-typed payloads, bulk
 *      guard parity, audit coverage, rate-limit parity, silent-failure UI paths.
 *   8. Mobile (375px) — sidebar toggle + classification flow, no horizontal
 *      overflow on the data tables.
 *   9. Copy audit — no em/en dash in rendered admin or public-surface copy
 *      (employer-authored data exempt), per the site-wide copy rule.
 *  10. Cron surface — every app/api/cron handler (admin-triggerable from
 *      /admin/cron) refuses anonymous and non-admin callers; a signed-in
 *      EMPLOYER is refused by the admin pages/APIs too (not only a seeker).
 *  11. Self-lockout + user admin — an admin cannot demote themselves; user
 *      deactivate/hard-delete validation and audit coverage.
 *
 * Credentials come from .env.test (E2E_ADMIN_*, E2E_EMPLOYER_*, E2E_SEEKER_*);
 * DB-backed assertions need DATABASE_URL (dev database only). Each block
 * `test.skip`s with a reason when a prerequisite is missing. Tests that pin a
 * confirmed product defect are `test.fixme` with the defect title so the fix
 * agent has a target — the assertions stay intact underneath.
 *
 * Plumbing (role fixtures, console guard, rate-limit dodge, admin-surface
 * enumeration, origin note) lives in tests/e2e/helpers/admin-fixtures.ts.
 */

// ── Contention headroom ─────────────────────────────────────────────────────
// Several journey specs share one `next start` process in CI-style runs; page
// loads there have been measured at 15-30s. Waits stay deterministic (no
// sleeps) — this only widens the ceilings so a slow server is not misread
// as a defect.
test.setTimeout(120_000);
test.use({ navigationTimeout: 60_000, actionTimeout: 30_000 });

// ── Constants ───────────────────────────────────────────────────────────────

const HAS_AUTH = getAdminCreds() !== null;
const HAS_EMPLOYER = getEmployerCreds() !== null;
const HAS_SEEKER = getSeekerCreds() !== null;
const E2E_JOB_ID = process.env.E2E_TEST_JOB_ID || '';
const E2E_JOB_SLUG = process.env.E2E_TEST_JOB_SLUG || '';
const E2E_QUARANTINE_SLUG = process.env.E2E_QUARANTINE_JOB_SLUG || '';

/** Seed fixture for the companies / claims blocks (created + destroyed here). */
const E2E_COMPANY = {
  // Fixed id: /companies/[slug] is ISR-cached for an hour and the claim CTA
  // posts the company id baked into that HTML. The fixture row is deleted and
  // recreated every run, so a random id made the cached page post a stale id
  // (404 "Employer profile not found") on any rerun within the hour.
  id: 'e2e-company-behavioral-health-group',
  name: 'E2E Behavioral Health Group',
  normalizedName: 'e2e-behavioral-health-group',
  website: 'https://e2e-bh.example.invalid',
  slug: 'e2e-behavioral-health-group',
};
const TESTIMONIAL_MARKER = 'E2E admin-journey testimonial';

/**
 * Admin-only routes that live OUTSIDE app/api/admin (the outreach dashboard
 * posts to /api/outreach). They are gated by requireApiAdmin like the rest,
 * so the gating enumeration covers them too.
 */
const EXTRA_ADMIN_ONLY_ROUTES = [
  { url: '/api/outreach', methods: ['GET', 'POST'], file: 'app/api/outreach/route.ts' },
];
const ADMIN_API_ROUTES = [...listAdminApiRoutes(), ...EXTRA_ADMIN_ONLY_ROUTES];
const ADMIN_PAGES = listAdminPages();
const CRON_ROUTES = listCronRoutes();

/** Public surfaces the admin decisions land on (badge, hub, testimonials). */
const PUBLIC_SURFACES = ['/companies', '/testimonials', '/unauthorized'];

/** Consolidated defect titles shared by several tests (one target per fix). */
const USERS_AUDIT_DEFECT =
  'DEFECT: admin user mutations (role change incl. promotion to admin, deactivate, hard delete) write no AuditLog row — app/api/admin/users/[id]/route.ts never calls logAudit although lib/audit-log.ts lists role.change as required wiring (GDPR Art. 30 gap for hard delete)';
const USERS_VALIDATION_DEFECT =
  'DEFECT: PATCH/DELETE /api/admin/users/:id answer 500 for an unknown id (Prisma P2025 unmapped) and PATCH copies unvalidated values into prisma.userProfile.update (profileVisible:"no" → 500) — app/api/admin/users/[id]/route.ts';
const TESTIMONIAL_AUDIT_DEFECT =
  'DEFECT: featuring, unfeaturing and narrowing a testimonial write no AuditLog row — app/api/admin/testimonials/[id]/route.ts never calls logAudit (a public-display decision with no trail)';
const SELF_LOCKOUT_DEFECT =
  'DEFECT: PATCH /api/admin/users/:id lets an admin demote their own account (no self-target guard) — one mis-click in the /admin/users role select locks the console with no way back (app/api/admin/users/[id]/route.ts)';

/**
 * Gate probes that currently answer with something other than 401/403/redirect.
 * Keyed `${METHOD} ${url}`; the value is the defect title the fix agent should
 * search for. Each entry turns the generated test into a `test.fixme` so the
 * enumeration keeps running for every other route while the defect stays
 * visible in the report (not silently green).
 */
const KNOWN_API_GATE_DEFECTS: Record<string, string> = {};

// ═══════════════════════════════════════════════════════════════════════════
// 1. GATING — anonymous
// ═══════════════════════════════════════════════════════════════════════════

test.describe('admin gating: anonymous visitor', () => {
  test('enumeration found the admin surface', () => {
    expect(ADMIN_PAGES.length, 'app/admin/**/page.tsx').toBeGreaterThan(10);
    expect(ADMIN_API_ROUTES.length, 'app/api/admin/**/route.ts').toBeGreaterThan(15);
    for (const r of ADMIN_API_ROUTES) expect(r.methods.length, `${r.file} exports no HTTP handler`).toBeGreaterThan(0);
  });

  for (const pageDef of ADMIN_PAGES) {
    test(`${pageDef.url} redirects an anonymous visitor to /login`, async ({ page }) => {
      const res = await page.goto(pageDef.url);
      await page.waitForLoadState('domcontentloaded');
      const url = new URL(page.url());
      expect(url.pathname, `anonymous visitor reached ${pageDef.url} (${pageDef.file})`).toMatch(/^\/login/);
      // The login page itself must render (not a 500 masquerading as a redirect).
      expect(res?.status(), `/login answered ${res?.status()} after the guard redirect`).toBe(200);
      await expect(page.locator('input[type="email"]')).toBeVisible();
    });
  }

  test('anonymous redirect preserves the attempted admin path as ?next= (B86 deep link)', async ({ request }) => {
    for (const pageDef of ADMIN_PAGES) {
      const res = await request.get(pageDef.url, { maxRedirects: 0, headers: ipHeaders() });
      expect(res.status(), `${pageDef.url} should redirect`).toBeGreaterThanOrEqual(300);
      const loc = new URL(res.headers()['location'] ?? '/', BASE);
      expect(loc.pathname).toBe('/login');
      expect(loc.searchParams.get('next'), `?next= lost for ${pageDef.url} (${pageDef.file})`).toBe(pageDef.url);
    }
  });

  for (const route of ADMIN_API_ROUTES) {
    for (const method of route.methods) {
      test(`${method} ${route.url} rejects an anonymous request`, async ({ request }) => {
        const known = KNOWN_API_GATE_DEFECTS[`${method} ${route.url}`];
        test.fixme(Boolean(known), known);
        const res = await request.fetch(route.url, {
          method,
          data: probeBody(method),
          headers: ipHeaders(),
          maxRedirects: 0,
        });
        expect(isUnauthGate(res), `${route.file}: got ${describeGate(res)} — expected 401/403 or a redirect to /login`).toBe(true);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 1b. GATING — signed-in NON-admin (job seeker)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('admin gating: signed-in job seeker', () => {
  test.skip(!HAS_SEEKER, 'E2E_SEEKER_EMAIL / E2E_SEEKER_PASS not set');

  let seekerContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    const storageState = await ensureAuthState(browser, 'candidate', BASE);
    seekerContext = await browser.newContext({ baseURL: BASE, storageState, extraHTTPHeaders: { 'User-Agent': USER_AGENT } });
  });
  test.afterAll(async () => {
    await seekerContext?.close();
  });

  for (const pageDef of ADMIN_PAGES) {
    test(`${pageDef.url} sends a job seeker to /unauthorized`, async () => {
      const page = await seekerContext.newPage();
      try {
        await page.goto(pageDef.url);
        await page.waitForLoadState('domcontentloaded');
        expect(new URL(page.url()).pathname, `seeker reached ${pageDef.url} (${pageDef.file})`).toBe('/unauthorized');
      } finally {
        await page.close();
      }
    });
  }

  for (const route of ADMIN_API_ROUTES) {
    for (const method of route.methods) {
      test(`${method} ${route.url} rejects a job seeker`, async () => {
        const known = KNOWN_API_GATE_DEFECTS[`${method} ${route.url}`];
        test.fixme(Boolean(known), known);
        const res = await seekerContext.request.fetch(route.url, {
          method,
          data: probeBody(method),
          headers: ipHeaders(),
          maxRedirects: 0,
        });
        expect(isWrongRoleGate(res), `${route.file}: got ${describeGate(res)} — expected 403 (or redirect to /unauthorized)`).toBe(true);
        expect(res.status(), `${route.file} answered 2xx to a non-admin`).not.toBe(200);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 1c. GATING — signed-in EMPLOYER (the role most likely to probe /admin)
// ═══════════════════════════════════════════════════════════════════════════
// requireEmployer() admits ['employer', 'admin']; the reverse must never hold.
// A representative sample (not the full enumeration, which 1b covers) keeps
// the suite's Supabase sign-ins to one per role.

test.describe('admin gating: signed-in employer', () => {
  test.skip(!HAS_EMPLOYER, 'E2E_EMPLOYER_EMAIL / E2E_EMPLOYER_PASS not set');

  let employerContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    const storageState = await ensureAuthState(browser, 'employer', BASE);
    employerContext = await browser.newContext({ baseURL: BASE, storageState, extraHTTPHeaders: { 'User-Agent': USER_AGENT } });
  });
  test.afterAll(async () => {
    await employerContext?.close();
  });

  for (const url of ['/admin', '/admin/jobs', '/admin/companies', '/admin/company-claims', '/admin/users']) {
    test(`${url} sends an employer to /unauthorized`, async () => {
      const page = await employerContext.newPage();
      try {
        await page.goto(url);
        await page.waitForLoadState('domcontentloaded');
        expect(new URL(page.url()).pathname, `employer reached ${url}`).toBe('/unauthorized');
        // /unauthorized must itself be a rendered page, not a blank 500.
        await expect(page.locator('h1, h2').first()).toBeVisible();
      } finally {
        await page.close();
      }
    });
  }

  const employerProbes: Array<[string, string]> = [
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/jobs'],
    ['PATCH', `/api/admin/jobs/${PLACEHOLDER_ID}`],
    ['POST', '/api/admin/jobs/bulk'],
    ['PATCH', `/api/admin/companies/${PLACEHOLDER_ID}`],
    ['PATCH', `/api/admin/company-claims/${PLACEHOLDER_ID}`],
    ['PATCH', `/api/admin/testimonials/${PLACEHOLDER_ID}`],
    ['PATCH', `/api/admin/users/${PLACEHOLDER_ID}`],
    ['DELETE', `/api/admin/users/${PLACEHOLDER_ID}`],
    ['POST', '/api/admin/email/send'],
  ];
  for (const [method, url] of employerProbes) {
    test(`${method} ${url} rejects an employer`, async () => {
      const res = await employerContext.request.fetch(url, { method, data: probeBody(method), headers: ipHeaders(), maxRedirects: 0 });
      expect(isWrongRoleGate(res), `got ${describeGate(res)} — expected 403`).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 1d. GATING — cron handlers (manually triggerable from /admin/cron)
// ═══════════════════════════════════════════════════════════════════════════
// lib/auth/verify-cron-or-admin.ts admits either the CRON_SECRET bearer or an
// admin session cookie. Under `next start` (NODE_ENV=production) the dev
// short-circuit is off, so every handler must answer 401 to an anonymous
// caller and 403 to a signed-in seeker. Nothing here triggers a cron as
// admin — a passing gate is the only thing asserted.

test.describe('admin gating: cron handlers', () => {
  test('enumeration found the cron surface', () => {
    expect(CRON_ROUTES.length, 'app/api/cron/**/route.ts').toBeGreaterThan(10);
    for (const r of CRON_ROUTES) expect(r.methods.length, `${r.file} exports no HTTP handler`).toBeGreaterThan(0);
  });

  for (const route of CRON_ROUTES) {
    for (const method of route.methods) {
      test(`${method} ${route.url} rejects an anonymous caller`, async ({ request }) => {
        const res = await request.fetch(route.url, { method, data: probeBody(method), headers: ipHeaders(), maxRedirects: 0 });
        expect([401, 403], `${route.file}: got ${describeGate(res)} — an anonymous caller must not run a cron`).toContain(res.status());
      });
    }
  }

  test.describe('signed-in job seeker', () => {
    test.skip(!HAS_SEEKER, 'E2E_SEEKER_EMAIL / E2E_SEEKER_PASS not set');
    let seekerContext: BrowserContext;
    test.beforeAll(async ({ browser }) => {
      const storageState = await ensureAuthState(browser, 'candidate', BASE);
      seekerContext = await browser.newContext({ baseURL: BASE, storageState, extraHTTPHeaders: { 'User-Agent': USER_AGENT } });
    });
    test.afterAll(async () => {
      await seekerContext?.close();
    });
    for (const route of CRON_ROUTES) {
      for (const method of route.methods) {
        test(`${method} ${route.url} rejects a job seeker`, async () => {
          const res = await seekerContext.request.fetch(route.url, { method, data: probeBody(method), headers: ipHeaders(), maxRedirects: 0 });
          expect(res.status(), `${route.file}: got ${describeGate(res)} — a seeker session must not run a cron`).toBe(403);
        });
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Legacy read-only checks (kept from the original spec)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('authenticated admin', () => {
  test.skip(!HAS_AUTH, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASS not set');

  test('logs in via the form and reaches /admin', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible({ timeout: 60_000 });
  });

  for (const pageDef of ADMIN_PAGES) {
    test(`${pageDef.url} renders for an admin without errors`, async ({ adminPage }) => {
      const res = await adminPage.goto(pageDef.url);
      expect(res?.status(), `${pageDef.file} HTTP status`).toBe(200);
      await expect(adminPage).toHaveURL(new RegExp(`${pageDef.url.replace(/\//g, '\\/')}(\\?|$)`));
      await expect(adminPage.locator('h1').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
      // Client dashboards fetch after mount — wait for real content rather
      // than 'networkidle' (which never settles on a busy server).
      await expect.poll(async () => (await bodyText(adminPage)).length, { message: 'page body suspiciously empty' }).toBeGreaterThan(50);
      const text = await bodyText(adminPage);
      expect(text).not.toMatch(RENDER_ERROR);
      expectCleanConsole(adminPage);
    });
  }

  // ── Copy audit — site-wide rule: rendered copy carries no em/en dashes ──
  for (const pageDef of ADMIN_PAGES) {
    test(`${pageDef.url} rendered copy carries no em/en dash`, async ({ adminPage }) => {
      await adminPage.goto(pageDef.url);
      await expect(adminPage.locator('h1').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
      await waitForBody(adminPage);
      const offenders = await visibleDashes(adminPage);
      expect(offenders, `${pageDef.file}: dash in rendered copy (employer-authored table data is exempt)`).toEqual([]);
    });
  }

  for (const url of PUBLIC_SURFACES) {
    test(`${url} rendered copy carries no em/en dash`, async ({ page }) => {
      const res = await page.goto(url);
      test.skip(res?.status() === 404, `${url} is a 404 in this environment (nothing featured yet)`);
      await expect(page.locator('h1').filter({ visible: true }).first()).toBeVisible();
      const offenders = await visibleDashes(page);
      expect(offenders, `${url}: dash in rendered copy`).toEqual([]);
    });
  }

  test('sidebar navigation + browser back keeps the admin shell intact', async ({ adminPage }) => {
    await adminPage.goto('/admin/jobs');
    await expect(adminPage.getByRole('heading', { name: 'Jobs Management' })).toBeVisible();
    await adminPage.getByRole('link', { name: 'Companies' }).click();
    await expect(adminPage).toHaveURL(/\/admin\/companies/);
    await expect(adminPage.getByRole('heading', { name: /Companies: Employer Type/ })).toBeVisible();
    await adminPage.goBack();
    await expect(adminPage).toHaveURL(/\/admin\/jobs/);
    await expect(adminPage.getByRole('heading', { name: 'Jobs Management' })).toBeVisible();
    await expect(adminPage.locator('table')).toBeVisible();
    expectCleanConsole(adminPage);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Dashboards — seo-health, cron, outreach, pd-campaign, dmarc, health
// ═══════════════════════════════════════════════════════════════════════════

test.describe('admin dashboards', () => {
  test.skip(!HAS_AUTH, 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASS not set');

  test('/admin/seo-health renders the pSEO coverage panel', async ({ adminPage }) => {
    await adminPage.goto('/admin/seo-health');
    await expect(adminPage.getByRole('heading', { name: 'SEO Health' })).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: /pSEO coverage: renderable vs indexable/ })).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: /Search Console: last 14 days/ })).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: /Cron run log/ })).toBeVisible();
    // The coverage panel either has data (KPI tiles) or explains why it is empty.
    const panelHasNumbers = await adminPage.getByText('Category×city combos').count();
    const panelExplainsEmpty = await adminPage.getByText(/No pseoStats rows yet/).count();
    expect(panelHasNumbers + panelExplainsEmpty, 'coverage panel neither rendered data nor its empty state').toBeGreaterThan(0);
    expectCleanConsole(adminPage);
  });

  test('seo-health surface: the job sitemap batch honours the profession quarantine', async ({ request }) => {
    test.skip(!E2E_QUARANTINE_SLUG, 'E2E_QUARANTINE_JOB_SLUG not set (setup seeds a professionClass=other_clinical probe)');
    // The detail page and listing are gated by GLOBAL_EXCLUSIONS …
    const detail = await request.get(`/jobs/${E2E_QUARANTINE_SLUG}`, { maxRedirects: 0, headers: ipHeaders() });
    expect([404, 410], `quarantined detail page answered ${detail.status()}`).toContain(detail.status());
    const api = await request.get('/api/jobs?q=Podiatrist&limit=5', { headers: ipHeaders() });
    expect(api.status()).toBe(200);
    expect(await api.text()).not.toContain(E2E_QUARANTINE_SLUG);
    // … so the sitemap the seo-health panel reports on must not advertise it.
    const batch = await request.get('/api/sitemaps/jobs/0', { headers: ipHeaders() });
    expect(batch.status()).toBe(200);
    const xml = await batch.text();
    expect(
      xml.includes(E2E_QUARANTINE_SLUG),
      `quarantined job ${E2E_QUARANTINE_SLUG} is advertised in /api/sitemaps/jobs/0 while its URL answers ${detail.status()} — lib/active-job-filter.ts activeIndexableJobWhere() has no professionClass/GLOBAL_EXCLUSIONS clause`,
    ).toBe(false);
  });

  test('/admin/cron lists every vercel.json cron with a manual trigger (not clicked)', async ({ adminPage }) => {
    const vercelJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as { crons?: Array<{ path: string; schedule: string }> };
    const crons = vercelJson.crons ?? [];
    expect(crons.length, 'vercel.json has no crons to render').toBeGreaterThan(0);

    await adminPage.goto('/admin/cron');
    await expect(adminPage.getByRole('heading', { name: 'Cron Health Dashboard' })).toBeVisible();
    const triggers = adminPage.getByRole('button', { name: 'Trigger Manually' });
    await expect(triggers).toHaveCount(crons.length);
    for (const cron of crons.slice(0, 5)) {
      await expect(adminPage.locator('code', { hasText: cron.path }).first()).toBeVisible();
    }
    expect(await bodyText(adminPage)).not.toMatch(/Error loading crons/);
    expectCleanConsole(adminPage);
  });

  test('/admin/outreach loads leads + templates without errors', async ({ adminPage }) => {
    await adminPage.goto('/admin/outreach');
    await expect(adminPage.getByRole('heading', { name: 'Employer Outreach' })).toBeVisible();
    await expect(adminPage.getByText('Total Leads')).toBeVisible();
    await adminPage.getByRole('button', { name: /Email Templates/ }).click();
    await expect(adminPage.getByRole('heading', { name: 'Initial Outreach' })).toBeVisible();
    await adminPage.getByRole('button', { name: /Add New Lead/ }).click();
    // Empty submit must be refused client-side, not create a blank lead.
    await adminPage.getByRole('button', { name: 'Add Lead', exact: true }).click();
    await expect(adminPage.getByText('Company name is required')).toBeVisible();
    expectCleanConsole(adminPage);
  });

  test('/admin/pd-campaign renders its dashboard shell', async ({ adminPage }) => {
    await adminPage.goto('/admin/pd-campaign');
    await expect(adminPage.locator('h1').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    expect(await bodyText(adminPage)).not.toMatch(RENDER_ERROR);
    expectCleanConsole(adminPage);
  });

  test('/admin/dmarc renders the monitoring page (token missing is a banner, not a crash)', async ({ adminPage }) => {
    await adminPage.goto('/admin/dmarc');
    await expect(adminPage.getByRole('heading', { name: 'DMARC monitoring' })).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: 'Current DMARC policy' })).toBeVisible();
    expect(await bodyText(adminPage)).not.toMatch(RENDER_ERROR);
    expectCleanConsole(adminPage);
  });

  test('/admin/health loads the job-health metrics from /api/admin/health', async ({ adminPage }) => {
    await adminPage.goto('/admin/health');
    await expect(adminPage.getByRole('heading', { name: 'Job Health' })).toBeVisible();
    await expect(adminPage.getByText('Published', { exact: true })).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: 'By source' })).toBeVisible();
    expect(await bodyText(adminPage)).not.toMatch(/Error loading job-health data/);
    expectCleanConsole(adminPage);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Mutations — jobs, companies, testimonials, claims (localhost origin)
// ═══════════════════════════════════════════════════════════════════════════

interface Seeds {
  adminId: string;
  employerId: string | null;
  companyId: string;
  jobId: string;
  jobTitle: string;
  jobSlug: string;
  jobWasPublished: boolean;
  jobPrevCompanyId: string | null;
}

test.describe('admin mutations (local only)', () => {
  test.skip(AGAINST_PROD, 'Mutation tests pollute data — local/staging only');
  test.skip(!HAS_AUTH, 'Needs E2E_ADMIN_EMAIL/PASS');
  test.skip(!hasDb(), 'Needs DATABASE_URL for audit-log / seed verification');
  test.skip(!E2E_JOB_ID, 'Needs E2E_TEST_JOB_ID (seeded employer job)');
  test.use({ baseURL: MUTATION_BASE });

  let seeds: Seeds;

  test.beforeAll(async () => {
    const prisma = db();
    const adminCreds = getAdminCreds() as AuthCreds;
    const adminId = await supabaseIdForEmail(adminCreds.email);
    if (!adminId) throw new Error(`No user_profiles row for ${adminCreds.email}`);
    const employerCreds = getEmployerCreds();
    const employerId = employerCreds ? await supabaseIdForEmail(employerCreds.email) : null;

    const job = await prisma.job.findUnique({
      where: { id: E2E_JOB_ID },
      select: { id: true, title: true, slug: true, isPublished: true, companyId: true },
    });
    if (!job) throw new Error(`E2E_TEST_JOB_ID ${E2E_JOB_ID} not found in the dev database`);

    // Company fixture: the profile page 404s without ≥1 active job, so the
    // seeded employer job is linked to it for the duration of the run.
    const company = await prisma.company.upsert({
      where: { normalizedName: E2E_COMPANY.normalizedName },
      create: { id: E2E_COMPANY.id, name: E2E_COMPANY.name, normalizedName: E2E_COMPANY.normalizedName, website: E2E_COMPANY.website },
      update: { website: E2E_COMPANY.website, recruitmentType: null, claimVerifiedAt: null },
      select: { id: true },
    });
    await prisma.companyClaim.deleteMany({ where: { companyId: company.id } });
    await prisma.job.update({ where: { id: job.id }, data: { companyId: company.id, isPublished: true } });
    if (employerId) {
      await prisma.employerTestimonial.deleteMany({ where: { userId: employerId, content: { startsWith: TESTIMONIAL_MARKER } } });
    }

    seeds = {
      adminId,
      employerId,
      companyId: company.id,
      jobId: job.id,
      jobTitle: job.title,
      jobSlug: job.slug ?? E2E_JOB_SLUG,
      jobWasPublished: job.isPublished,
      jobPrevCompanyId: job.companyId,
    };
  });

  test.afterAll(async () => {
    if (!seeds) {
      await closeDb();
      return;
    }
    const prisma = db();
    await prisma.job.update({
      where: { id: seeds.jobId },
      data: { title: seeds.jobTitle, isPublished: seeds.jobWasPublished, companyId: seeds.jobPrevCompanyId },
    }).catch(() => undefined);
    await prisma.companyClaim.deleteMany({ where: { companyId: seeds.companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: seeds.companyId } }).catch(() => undefined);
    if (seeds.employerId) {
      await prisma.employerTestimonial.deleteMany({ where: { userId: seeds.employerId, content: { startsWith: TESTIMONIAL_MARKER } } }).catch(() => undefined);
    }
    await closeDb();
  });

  // ── helpers scoped to the seeded job ──────────────────────────────────

  async function findJobRow(page: Page) {
    await page.goto('/admin/jobs');
    await expect(page.getByRole('heading', { name: 'Jobs Management' })).toBeVisible();
    await searchAdminJobs(page, 'E2E Telehealth');
    const row = page.locator('tbody tr', { hasText: 'E2E Telehealth' });
    await expect(row).toHaveCount(1);
    return row.first();
  }

  async function jobState() {
    return db().job.findUniqueOrThrow({ where: { id: seeds.jobId }, select: { isPublished: true, title: true } });
  }

  // ── 4a. Jobs management ───────────────────────────────────────────────

  test('jobs: unpublish then republish from the status toggle, public URL follows', async ({ adminPage }) => {
    test.setTimeout(180_000);
    await db().job.update({ where: { id: seeds.jobId }, data: { isPublished: true } });
    const row = await findJobRow(adminPage);

    await row.getByTitle('Click to unpublish').click();
    await expect(adminPage.getByRole('status').filter({ hasText: /^Unpublished$/ })).toBeVisible();
    await expect.poll(async () => (await jobState()).isPublished, { message: 'DB should flip to unpublished' }).toBe(false);
    const gone = await adminPage.request.get(`/jobs/${seeds.jobSlug}`, { maxRedirects: 0, headers: ipHeaders() });
    expect([404, 410], `unpublished job still served ${gone.status()}`).toContain(gone.status());

    await row.getByTitle('Click to publish').click();
    await expect(adminPage.getByRole('status').filter({ hasText: /^Published$/ })).toBeVisible();
    await expect.poll(async () => (await jobState()).isPublished, { message: 'DB should flip back to published' }).toBe(true);
    // middleware.ts keeps a job's 410 ruling in a 60 s in-process cache by design
    // ("re-publishing a job becomes visible within a minute"), and the unpublish
    // probe above just populated it, so allow that window before the page is live.
    await expect
      .poll(
        async () => (await adminPage.request.get(`/jobs/${seeds.jobSlug}`, { maxRedirects: 0, headers: ipHeaders() })).status(),
        { message: 'republished job should be served again within the 60 s middleware cache window', timeout: 90_000, intervals: [5_000] },
      )
      .toBe(200);
    expectCleanConsole(adminPage);
  });

  test('jobs: publish/unpublish writes an AuditLog row', async ({ adminPage }) => {
    const since = new Date();
    await db().job.update({ where: { id: seeds.jobId }, data: { isPublished: true } });
    const row = await findJobRow(adminPage);
    await row.getByTitle('Click to unpublish').click();
    await expect(adminPage.getByRole('status').filter({ hasText: /^Unpublished$/ })).toBeVisible();
    await expect.poll(async () => (await jobState()).isPublished).toBe(false);
    await row.getByTitle('Click to publish').click();
    await expect(adminPage.getByRole('status').filter({ hasText: /^Published$/ })).toBeVisible();
    await expect.poll(async () => (await jobState()).isPublished).toBe(true);

    const rows = await auditRows({ since, targetId: seeds.jobId });
    expect(rows.map((r) => r.action), 'no AuditLog row for the publish/unpublish toggle').not.toEqual([]);
  });

  test('jobs: edit modal saves a title change (mouse) and refresh mid-flow discards the dialog', async ({ adminPage }) => {
    await db().job.update({ where: { id: seeds.jobId }, data: { title: seeds.jobTitle } });
    const row = await findJobRow(adminPage);
    await row.getByTitle('Edit').click();
    await expect(adminPage.getByRole('heading', { name: 'Edit Job' })).toBeVisible();

    // Refresh mid-flow: the dialog is client state, so it must vanish cleanly.
    await adminPage.reload();
    await expect(adminPage.getByRole('heading', { name: 'Jobs Management' })).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: 'Edit Job' })).toHaveCount(0);

    const row2 = await findJobRow(adminPage);
    await row2.getByTitle('Edit').click();
    const titleInput = adminPage.locator('label', { hasText: /^Title$/ }).locator('..').locator('input');
    await expect(titleInput).toHaveValue(seeds.jobTitle);
    const edited = `${seeds.jobTitle} (E2E edited)`;
    await titleInput.fill(edited);
    await adminPage.getByRole('button', { name: 'Save Changes' }).click();
    await expect(adminPage.getByText('Job updated', { exact: true })).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: 'Edit Job' })).toHaveCount(0);
    await expect.poll(async () => (await jobState()).title).toBe(edited);
    await expect(adminPage.locator('tbody tr', { hasText: '(E2E edited)' })).toHaveCount(1);

    await db().job.update({ where: { id: seeds.jobId }, data: { title: seeds.jobTitle } });
    expectCleanConsole(adminPage);
  });

  test('jobs: edit writes an AuditLog row', async ({ adminPage }) => {
    const since = new Date();
    await db().job.update({ where: { id: seeds.jobId }, data: { title: seeds.jobTitle } });
    const row = await findJobRow(adminPage);
    await row.getByTitle('Edit').click();
    const titleInput = adminPage.locator('label', { hasText: /^Title$/ }).locator('..').locator('input');
    await titleInput.fill(`${seeds.jobTitle} (E2E audit)`);
    await adminPage.getByRole('button', { name: 'Save Changes' }).click();
    await expect(adminPage.getByText('Job updated', { exact: true })).toBeVisible();
    await expect.poll(async () => (await jobState()).title).toContain('(E2E audit)');
    await db().job.update({ where: { id: seeds.jobId }, data: { title: seeds.jobTitle } });

    const rows = await auditRows({ since, targetId: seeds.jobId });
    expect(rows.map((r) => r.action), 'no AuditLog row for the admin job edit').not.toEqual([]);
  });

  test('jobs: edit modal is keyboard operable (Enter opens, Cancel via keyboard closes, overlay click closes)', async ({ adminPage }) => {
    const row = await findJobRow(adminPage);
    const editBtn = row.getByTitle('Edit');
    await editBtn.focus();
    await adminPage.keyboard.press('Enter');
    const heading = adminPage.getByRole('heading', { name: 'Edit Job' });
    await expect(heading).toBeVisible();

    // Cancel via keyboard.
    const cancel = adminPage.getByRole('button', { name: 'Cancel' });
    await cancel.focus();
    await adminPage.keyboard.press('Enter');
    await expect(heading).toHaveCount(0);

    // Overlay click dismisses.
    await editBtn.focus();
    await adminPage.keyboard.press('Enter');
    await expect(heading).toBeVisible();
    await adminPage.mouse.click(5, 5);
    await expect(heading).toHaveCount(0);
    expectCleanConsole(adminPage);
  });

  test('jobs: edit modal has dialog semantics (role=dialog, focus moves in, Escape closes)', async ({ adminPage }) => {
    const row = await findJobRow(adminPage);
    const editBtn = row.getByTitle('Edit');
    await editBtn.focus();
    await adminPage.keyboard.press('Enter');
    const heading = adminPage.getByRole('heading', { name: 'Edit Job' });
    await expect(heading).toBeVisible();

    const dialog = adminPage.getByRole('dialog');
    await expect(dialog, 'Edit Job modal should be role="dialog" (aria-modal)').toHaveCount(1);
    const focusInside = await adminPage.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return Boolean(d && d.contains(document.activeElement));
    });
    expect(focusInside, 'focus should move into the dialog on open').toBe(true);

    await adminPage.keyboard.press('Escape');
    await expect(heading, 'Escape did not close the Edit Job dialog').toHaveCount(0);
    const focusRestored = await adminPage.evaluate(() => document.activeElement?.getAttribute('title'));
    expect(focusRestored, 'focus should return to the Edit trigger').toBe('Edit');
  });

  test('jobs: PATCH/DELETE API validation (empty patch, past expiry, unknown id, hard-delete guard)', async ({ adminPage }) => {
    const api = adminPage.request;
    const empty = await api.patch(`/api/admin/jobs/${seeds.jobId}`, { data: {}, headers: ipHeaders() });
    expect(empty.status(), 'empty PATCH should be 400').toBe(400);

    const past = await api.patch(`/api/admin/jobs/${seeds.jobId}`, { data: { expiresAt: '2020-01-01T00:00:00.000Z' }, headers: ipHeaders() });
    expect(past.status(), 'past expiresAt should be 400').toBe(400);

    const farFuture = await api.patch(`/api/admin/jobs/${seeds.jobId}`, { data: { expiresAt: '2099-01-01T00:00:00.000Z' }, headers: ipHeaders() });
    expect(farFuture.status(), '>12mo expiresAt should be 400').toBe(400);

    const missing = await api.get(`/api/admin/jobs/${PLACEHOLDER_ID}`, { headers: ipHeaders() });
    expect(missing.status()).toBe(404);

    // Unknown field must not be silently written — the allowlist should drop it
    // and, with nothing left, refuse the request.
    const unknownField = await api.patch(`/api/admin/jobs/${seeds.jobId}`, { data: { professionClass: 'other_clinical' }, headers: ipHeaders() });
    expect(unknownField.status(), 'PATCH with only a non-allowlisted field should be 400').toBe(400);

    // Audit #25 guard: hard-deleting a free post must be refused and the job kept.
    const hard = await api.delete(`/api/admin/jobs/${seeds.jobId}?hard=true`, { headers: ipHeaders() });
    expect(hard.status(), 'hard delete of a free posting should be 409').toBe(409);
    const still = await db().job.findUnique({ where: { id: seeds.jobId }, select: { id: true } });
    expect(still, 'free posting was hard-deleted despite the guard').not.toBeNull();
  });

  // ── 4b. Companies — recruitment-type classification ───────────────────

  async function findCompanyRow(page: Page) {
    await page.goto('/admin/companies');
    await expect(page.getByRole('heading', { name: /Companies: Employer Type/ })).toBeVisible();
    await page.locator('#company-class-filter').selectOption('all');
    await page.getByRole('searchbox', { name: 'Search companies by name' }).fill('E2E Behavioral');
    const row = page.locator('tbody tr', { hasText: E2E_COMPANY.name });
    await expect(row).toHaveCount(1, { timeout: 45_000 });
    return row.first();
  }

  async function companyState() {
    return db().company.findUniqueOrThrow({ where: { id: seeds.companyId }, select: { recruitmentType: true, claimVerifiedAt: true } });
  }

  async function jobsTotal(page: Page, query: string): Promise<number> {
    const res = await page.request.get(`/api/jobs?${query}&limit=1`, { headers: ipHeaders() });
    expect(res.status(), `/api/jobs?${query}`).toBe(200);
    const json = (await res.json()) as { total: number };
    return json.total;
  }

  test('companies: classify as direct employer → saved, audit-logged, /jobs filter count moves, clear undoes it', async ({ adminPage }) => {
    await db().company.update({ where: { id: seeds.companyId }, data: { recruitmentType: null } });
    const before = await jobsTotal(adminPage, 'recruitmentType=direct_hire');
    const since = new Date();

    const row = await findCompanyRow(adminPage);
    await expect(row.getByText('Unclassified')).toBeVisible();
    await row.getByRole('button', { name: 'Direct' }).click();
    await expect(adminPage.getByRole('status')).toContainText('classified as a direct employer');
    await expect(row.getByText('Direct employer')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Direct' })).toBeDisabled();
    expect((await companyState()).recruitmentType).toBe('direct_hire');

    const setRows = await auditRows({ since, targetId: seeds.companyId, action: 'company.recruitment_type.set' });
    expect(setRows.length, 'company.recruitment_type.set audit row').toBe(1);
    expect(setRows[0].actorType).toBe('admin');
    expect(setRows[0].actorId, 'audit actorId should be the admin supabase id').toBe(seeds.adminId);
    expect(setRows[0].metadata).toMatchObject({ recruitmentType: 'direct_hire', previousRecruitmentType: null });

    // The seeded job now sits behind the direct_hire facet.
    const after = await jobsTotal(adminPage, 'recruitmentType=direct_hire');
    expect(after, '/api/jobs direct_hire total should grow by the linked job').toBe(before + 1);
    const staffing = await jobsTotal(adminPage, 'recruitmentType=staffing_agency&q=E2E+Telehealth');
    expect(staffing, 'direct-hire company must not match the staffing facet').toBe(0);

    // Undo — null is the documented "unclassified" state.
    await row.getByRole('button', { name: 'Clear' }).click();
    await expect(adminPage.getByRole('status')).toContainText('unclassified again');
    expect((await companyState()).recruitmentType).toBeNull();
    const clearRows = await auditRows({ since, targetId: seeds.companyId, action: 'company.recruitment_type.clear' });
    expect(clearRows.length, 'company.recruitment_type.clear audit row').toBe(1);
    expect(await jobsTotal(adminPage, 'recruitmentType=direct_hire')).toBe(before);
    expectCleanConsole(adminPage);
  });

  test('companies: /jobs page count for the direct-hire facet matches the API', async ({ adminPage }) => {
    await db().company.update({ where: { id: seeds.companyId }, data: { recruitmentType: 'direct_hire' } });
    try {
      const apiTotal = await jobsTotal(adminPage, 'recruitmentType=direct_hire');
      await adminPage.goto('/jobs?recruitmentType=direct_hire');
      const counter = adminPage.getByText(/jobs found/).first();
      await expect(counter).toBeVisible();
      await expect.poll(async () => {
        const text = await counter.innerText();
        const m = text.replace(/,/g, '').match(/(\d+)\s*jobs found/);
        return m ? Number(m[1]) : NaN;
      }, { message: '/jobs visible count should equal /api/jobs total for the same facet' }).toBe(apiTotal);
      expect(apiTotal).toBeGreaterThanOrEqual(1);
      expectCleanConsole(adminPage);
    } finally {
      await db().company.update({ where: { id: seeds.companyId }, data: { recruitmentType: null } });
    }
  });

  test('companies: classification badge appears on the public profile', async ({ adminPage }) => {
    await db().company.update({ where: { id: seeds.companyId }, data: { recruitmentType: null } });
    // A visitor (or Googlebot) has seen the unclassified page first — this is
    // the realistic order, and it is what an ISR cache has to survive.
    const beforeRes = await adminPage.goto(`/companies/${E2E_COMPANY.slug}`);
    expect(beforeRes?.status(), 'seeded company profile should render').toBe(200);
    await expect(adminPage.getByRole('heading', { name: E2E_COMPANY.name, exact: true })).toBeVisible();
    await expect(adminPage.getByText('Direct employer', { exact: true })).toHaveCount(0);

    const row = await findCompanyRow(adminPage);
    await row.getByRole('button', { name: 'Direct' }).click();
    await expect(adminPage.getByRole('status')).toContainText('classified as a direct employer');
    try {
      await adminPage.goto(`/companies/${E2E_COMPANY.slug}`);
      await expect(adminPage.getByText('Direct employer', { exact: true }), 'public profile should show the classification badge').toBeVisible();
      await expect(adminPage.getByText(/classified .* as a direct employer/)).toBeVisible();
    } finally {
      await db().company.update({ where: { id: seeds.companyId }, data: { recruitmentType: null } });
    }
  });

  test('companies: PATCH validation (bad enum, unknown id, empty body)', async ({ adminPage }) => {
    const api = adminPage.request;
    const bad = await api.patch(`/api/admin/companies/${seeds.companyId}`, { data: { recruitmentType: 'in_house' }, headers: ipHeaders() });
    expect(bad.status()).toBe(400);
    const empty = await api.patch(`/api/admin/companies/${seeds.companyId}`, { data: {}, headers: ipHeaders() });
    expect(empty.status()).toBe(400);
    const missing = await api.patch(`/api/admin/companies/${PLACEHOLDER_ID}`, { data: { recruitmentType: 'direct_hire' }, headers: ipHeaders() });
    expect(missing.status()).toBe(404);
    expect((await companyState()).recruitmentType, 'rejected PATCHes must not write').toBeNull();
  });

  // ── 4c. Testimonials ──────────────────────────────────────────────────

  test.describe('testimonials', () => {
    test.skip(!HAS_EMPLOYER, 'Needs E2E_EMPLOYER_EMAIL/PASS to submit a testimonial');

    let testimonialId = '';
    const content = `${TESTIMONIAL_MARKER} ${Date.now()} — hiring a PMHNP through the board was quick and the candidates were qualified.`;

    async function testimonialState() {
      return db().employerTestimonial.findUniqueOrThrow({ where: { id: testimonialId }, select: { featuredAt: true, displayAs: true, consent: true } });
    }

    test('employer submits a consented testimonial (and non-consented / short ones are refused)', async ({ employerPage }) => {
      const api = employerPage.request;
      const noConsent = await api.post('/api/employer/testimonials', { data: { content, consent: false }, headers: ipHeaders() });
      expect(noConsent.status(), 'consent=false must be refused').toBe(400);
      const tooShort = await api.post('/api/employer/testimonials', { data: { content: 'great', consent: true }, headers: ipHeaders() });
      expect(tooShort.status(), '<10 chars must be refused').toBe(400);

      const ok = await api.post('/api/employer/testimonials', { data: { content, consent: true, rating: 5, displayAs: 'initial' }, headers: ipHeaders() });
      expect(ok.status(), await ok.text()).toBe(200);
      const row = await db().employerTestimonial.findFirst({ where: { content }, select: { id: true, consent: true, featuredAt: true } });
      expect(row).not.toBeNull();
      testimonialId = row!.id;
      expect(row!.consent).toBe(true);
      expect(row!.featuredAt, 'a fresh submission must not be featured').toBeNull();
    });

    test('/testimonials is a 404 while nothing is featured', async ({ request }) => {
      test.skip(!testimonialId, 'submission test did not run');
      const featured = await db().employerTestimonial.count({ where: { consent: true, featuredAt: { not: null } } });
      test.skip(featured > 0, `dev DB already has ${featured} featured testimonial(s); the 404-before state is not observable`);
      const res = await request.get('/testimonials', { headers: ipHeaders() });
      expect(res.status()).toBe(404);
    });

    test('admin features the testimonial → /testimonials renders it', async ({ adminPage }) => {
      test.skip(!testimonialId, 'submission test did not run');
      await adminPage.goto('/admin/testimonials');
      await expect(adminPage.getByRole('heading', { name: 'Employer Testimonials' })).toBeVisible();
      const row = adminPage.locator('tbody tr', { hasText: TESTIMONIAL_MARKER });
      await expect(row).toHaveCount(1);
      await expect(row.getByText('Pending')).toBeVisible();
      await row.getByRole('button', { name: 'Feature' }).click();
      await expect(adminPage.getByRole('status')).toContainText('Approved for public display');
      await expect(row.getByText('Featured')).toBeVisible();
      expect((await testimonialState()).featuredAt).not.toBeNull();

      const res = await adminPage.goto('/testimonials');
      expect(res?.status(), '/testimonials should be live once a testimonial is featured').toBe(200);
      await expect(adminPage.getByRole('heading', { name: /What Hiring Teams/ })).toBeVisible();
      await expect(adminPage.locator('blockquote', { hasText: TESTIMONIAL_MARKER })).toBeVisible();
      // Attribution never leaks the account email.
      expect(await bodyText(adminPage)).not.toContain('@example.invalid');
      expectCleanConsole(adminPage);
    });

    test('featuring a testimonial writes an AuditLog row', async ({ adminPage }) => {
      test.skip(!testimonialId, 'submission test did not run');
      const since = new Date();
      await db().employerTestimonial.update({ where: { id: testimonialId }, data: { featuredAt: null } });
      await adminPage.goto('/admin/testimonials');
      const row = adminPage.locator('tbody tr', { hasText: TESTIMONIAL_MARKER });
      await row.getByRole('button', { name: 'Feature' }).click();
      await expect(adminPage.getByRole('status')).toContainText('Approved for public display');
      expect((await testimonialState()).featuredAt).not.toBeNull();
      const rows = await auditRows({ since, targetId: testimonialId });
      expect(rows.map((r) => r.action), 'no AuditLog row for featuring a testimonial').not.toEqual([]);
    });

    test('attribution can be narrowed but never widened; non-boolean featured is refused', async ({ adminPage }) => {
      test.skip(!testimonialId, 'submission test did not run');
      const api = adminPage.request;
      const widen = await api.patch(`/api/admin/testimonials/${testimonialId}`, { data: { displayAs: 'full' }, headers: ipHeaders() });
      expect(widen.status(), "initial → full must be refused").toBe(400);
      const badBool = await api.patch(`/api/admin/testimonials/${testimonialId}`, { data: { featured: 'yes' }, headers: ipHeaders() });
      expect(badBool.status()).toBe(400);
      const nothing = await api.patch(`/api/admin/testimonials/${testimonialId}`, { data: {}, headers: ipHeaders() });
      expect(nothing.status()).toBe(400);
      expect((await testimonialState()).displayAs).toBe('initial');

      await adminPage.goto('/admin/testimonials');
      const row = adminPage.locator('tbody tr', { hasText: TESTIMONIAL_MARKER });
      const select = row.getByRole('combobox', { name: /Attribution for testimonial/ });
      await expect(select.locator('option')).toHaveCount(2); // initial + anonymous only
      await select.selectOption('anonymous');
      await expect(adminPage.getByRole('status')).toContainText('Attribution narrowed');
      expect((await testimonialState()).displayAs).toBe('anonymous');
      await expect(select.locator('option')).toHaveCount(1);
      expectCleanConsole(adminPage);
    });

    test('Feature button is double-submit safe (one PATCH) and keeps the original featuredAt on repeat', async ({ adminPage }) => {
      test.skip(!testimonialId, 'submission test did not run');
      await db().employerTestimonial.update({ where: { id: testimonialId }, data: { featuredAt: null } });
      let patches = 0;
      adminPage.on('request', (req) => {
        if (req.method() === 'PATCH' && req.url().includes(`/api/admin/testimonials/${testimonialId}`)) patches += 1;
      });
      await adminPage.goto('/admin/testimonials');
      const row = adminPage.locator('tbody tr', { hasText: TESTIMONIAL_MARKER });
      await row.getByRole('button', { name: 'Feature' }).dblclick();
      await expect(adminPage.getByRole('status')).toContainText('Approved for public display');
      await expect(row.getByText('Featured')).toBeVisible();
      expect(patches, 'double-click on Feature must issue a single PATCH').toBe(1);
      const first = (await testimonialState()).featuredAt;
      expect(first).not.toBeNull();
      // Re-featuring via the API keeps the original approval date.
      const again = await adminPage.request.patch(`/api/admin/testimonials/${testimonialId}`, { data: { featured: true }, headers: ipHeaders() });
      expect(again.status()).toBe(200);
      expect((await testimonialState()).featuredAt?.toISOString()).toBe(first?.toISOString());
      expectCleanConsole(adminPage);
    });

    test('unfeature pulls it from /testimonials again', async ({ adminPage }) => {
      test.skip(!testimonialId, 'submission test did not run');
      await db().employerTestimonial.update({ where: { id: testimonialId }, data: { featuredAt: new Date() } });
      await adminPage.goto('/admin/testimonials');
      const row = adminPage.locator('tbody tr', { hasText: TESTIMONIAL_MARKER });
      await row.getByRole('button', { name: 'Unfeature' }).click();
      await expect(adminPage.getByRole('status')).toContainText('Removed from public display');
      expect((await testimonialState()).featuredAt).toBeNull();

      const others = await db().employerTestimonial.count({ where: { consent: true, featuredAt: { not: null } } });
      const res = await adminPage.request.get('/testimonials', { headers: ipHeaders() });
      if (others === 0) {
        expect(res.status(), '/testimonials should 404 again once nothing is featured').toBe(404);
      } else {
        expect(await res.text()).not.toContain(TESTIMONIAL_MARKER);
      }
    });
  });

  // ── 4d. Company claims ────────────────────────────────────────────────

  test.describe('company claims', () => {
    test.skip(!HAS_EMPLOYER, 'Needs E2E_EMPLOYER_EMAIL/PASS to submit a claim');

    let claimId = '';

    async function claimState() {
      return db().companyClaim.findUniqueOrThrow({ where: { id: claimId }, select: { status: true, reviewNote: true, reviewedBy: true, pendingCompanyId: true } });
    }

    test('anonymous and seeker callers cannot create a claim', async ({ request, seekerPage }) => {
      const anon = await request.post('/api/companies/claim', { data: { companyId: seeds.companyId }, headers: ipHeaders() });
      expect(anon.status()).toBe(401);
      const seeker = await seekerPage.request.post('/api/companies/claim', { data: { companyId: seeds.companyId }, headers: ipHeaders() });
      expect(seeker.status(), 'a job seeker must not be able to claim an employer profile').toBe(403);
      expect(await db().companyClaim.count({ where: { companyId: seeds.companyId } })).toBe(0);
    });

    test('employer claims the profile from the public page; duplicate open claim is refused', async ({ employerPage }) => {
      await db().companyClaim.deleteMany({ where: { companyId: seeds.companyId } });
      await db().company.update({ where: { id: seeds.companyId }, data: { claimVerifiedAt: null } });
      const since = new Date();

      await employerPage.goto(`/companies/${E2E_COMPANY.slug}`);
      await expect(employerPage.getByRole('heading', { name: E2E_COMPANY.name, exact: true })).toBeVisible();
      await employerPage.getByRole('button', { name: 'Claim this profile' }).click();
      await employerPage.getByLabel(/Your role at/).fill('Talent Acquisition Manager');
      await employerPage.getByLabel(/Anything that helps us verify you/).fill('E2E claim — careers page at https://e2e-bh.example.invalid/careers');
      await employerPage.getByRole('button', { name: 'Submit claim' }).click();
      await expect(employerPage.getByRole('heading', { name: 'Claim submitted' })).toBeVisible();

      const claim = await db().companyClaim.findFirst({ where: { companyId: seeds.companyId }, select: { id: true, status: true, claimantEmail: true, domainMatch: true, pendingCompanyId: true } });
      expect(claim).not.toBeNull();
      claimId = claim!.id;
      expect(claim!.status).toBe('pending');
      expect(claim!.pendingCompanyId).toBe(seeds.companyId);
      expect(claim!.domainMatch, 'example.invalid claimant vs e2e-bh.example.invalid website should match by suffix').toBe(true);

      const submitted = await auditRows({ since, targetId: seeds.companyId, action: 'company.claim.submitted' });
      expect(submitted.length).toBe(1);
      expect(submitted[0].actorType).toBe('user');

      // Nothing public changed yet.
      await employerPage.goto(`/companies/${E2E_COMPANY.slug}`);
      await expect(employerPage.getByText('Claimed by employer')).toHaveCount(0);

      // Double submit → 409, no second row.
      const dup = await employerPage.request.post('/api/companies/claim', { data: { companyId: seeds.companyId }, headers: ipHeaders() });
      expect(dup.status()).toBe(409);
      expect((await dup.json()).code).toBe('already_pending');
      expect(await db().companyClaim.count({ where: { companyId: seeds.companyId } })).toBe(1);
      expectCleanConsole(employerPage, [/409/]);
    });

    test('admin approves the claim → claimVerifiedAt stamped, audit-logged, Claimed badge on profile', async ({ adminPage }) => {
      test.skip(!claimId, 'claim submission did not run');
      const since = new Date();
      await adminPage.goto('/admin/company-claims');
      await expect(adminPage.getByRole('heading', { name: 'Employer Profile Claims' })).toBeVisible();
      const row = adminPage.locator('tbody tr', { hasText: E2E_COMPANY.name });
      await expect(row).toHaveCount(1);
      await expect(row.getByText('Domain match')).toBeVisible();
      await expect(row.getByText('Pending')).toBeVisible();
      await row.getByPlaceholder('What did you check?').fill('E2E: careers page matches');
      const approve = row.getByRole('button', { name: 'Approve' });
      await approve.click();
      await expect(adminPage.getByRole('status')).toContainText('Claim approved');
      // The list defaults to the Pending filter, so an approved claim leaves the view.
      await adminPage.locator('select').first().selectOption('all');
      await expect(row.getByText('Approved', { exact: true })).toBeVisible();
      await expect(approve).toBeDisabled();

      const state = await claimState();
      expect(state.status).toBe('approved');
      expect(state.reviewNote).toBe('E2E: careers page matches');
      expect(state.reviewedBy).toBe(seeds.adminId);
      expect(state.pendingCompanyId, 'approval must free the unique pending slot').toBeNull();
      expect((await companyState()).claimVerifiedAt).not.toBeNull();

      const approved = await auditRows({ since, targetId: seeds.companyId, action: 'company.claim.approved' });
      expect(approved.length, 'exactly one company.claim.approved audit row').toBe(1);
      expect(approved[0].actorId).toBe(seeds.adminId);
      expect(approved[0].metadata).toMatchObject({ claimId, previousStatus: 'pending' });

      await adminPage.goto(`/companies/${E2E_COMPANY.slug}`);
      await expect(adminPage.getByText('Claimed by employer'), 'public profile should show the Claimed badge').toBeVisible();
      // Once claimed the CTA must not re-offer the claim.
      await expect(adminPage.getByRole('button', { name: 'Claim this profile' })).toHaveCount(0);
      expectCleanConsole(adminPage);
    });

    test('the linked job posting shows the Claimed badge (AboutEmployer) once the claim is approved', async ({ adminPage }) => {
      test.skip(!claimId, 'claim submission did not run');
      await db().company.update({ where: { id: seeds.companyId }, data: { claimVerifiedAt: new Date() } });
      const res = await adminPage.goto(`/jobs/${seeds.jobSlug}`);
      expect(res?.status()).toBe(200);
      await expect(adminPage.getByText('Claimed by employer').first(), 'job detail AboutEmployer block should carry the Claimed badge').toBeVisible();
      expectCleanConsole(adminPage);
    });

    test('A–Z employer hub marks the claimed employer', async ({ adminPage }) => {
      test.skip(!claimId, 'claim submission did not run');
      await db().company.update({ where: { id: seeds.companyId }, data: { claimVerifiedAt: new Date() } });
      await adminPage.goto('/companies');
      const entry = adminPage.locator('a', { hasText: E2E_COMPANY.name }).first();
      await expect(entry, 'seeded employer should be listed in the A–Z hub').toBeVisible();
      const claimedMarker = entry.locator('[aria-label*="Claimed" i], [title*="Claimed" i]').or(entry.getByText(/Claimed/i));
      await expect(claimedMarker, 'A–Z hub entry should carry a Claimed marker').toHaveCount(1);
    });

    test('a second employer claim on an already-claimed profile is refused with already_claimed', async ({ employerPage }) => {
      test.skip(!claimId, 'claim submission did not run');
      await db().company.update({ where: { id: seeds.companyId }, data: { claimVerifiedAt: new Date() } });
      const res = await employerPage.request.post('/api/companies/claim', { data: { companyId: seeds.companyId }, headers: ipHeaders() });
      expect(res.status()).toBe(409);
      expect((await res.json()).code).toBe('already_claimed');
    });

    test('admin PATCH validation on claims (bad action, unknown id)', async ({ adminPage }) => {
      test.skip(!claimId, 'claim submission did not run');
      const api = adminPage.request;
      const bad = await api.patch(`/api/admin/company-claims/${claimId}`, { data: { action: 'archive' }, headers: ipHeaders() });
      expect(bad.status()).toBe(400);
      const missing = await api.patch(`/api/admin/company-claims/${PLACEHOLDER_ID}`, { data: { action: 'approve' }, headers: ipHeaders() });
      expect(missing.status()).toBe(404);
    });

    test('claim review note is client state: refresh mid-flow discards it, Approve is double-submit safe (one PATCH, one audit row)', async ({ adminPage }) => {
      test.skip(!claimId, 'claim submission did not run');
      await db().companyClaim.update({ where: { id: claimId }, data: { status: 'pending', pendingCompanyId: seeds.companyId, reviewedAt: null, reviewedBy: null } });
      await db().company.update({ where: { id: seeds.companyId }, data: { claimVerifiedAt: null } });
      const since = new Date();
      let patches = 0;
      adminPage.on('request', (req) => {
        if (req.method() === 'PATCH' && req.url().includes(`/api/admin/company-claims/${claimId}`)) patches += 1;
      });

      await adminPage.goto('/admin/company-claims');
      const row = adminPage.locator('tbody tr', { hasText: E2E_COMPANY.name });
      await expect(row).toHaveCount(1);
      await row.getByPlaceholder('What did you check?').fill('E2E: draft note');
      await adminPage.reload();
      const row2 = adminPage.locator('tbody tr', { hasText: E2E_COMPANY.name });
      await expect(row2).toHaveCount(1);
      await expect(row2.getByPlaceholder('What did you check?')).toHaveValue('');

      await row2.getByRole('button', { name: 'Approve' }).dblclick();
      await expect(adminPage.getByRole('status')).toContainText('Claim approved');
      // The list defaults to the Pending filter, so an approved claim leaves the view.
      await adminPage.locator('select').first().selectOption('all');
      await expect(row2.getByText('Approved', { exact: true })).toBeVisible();
      expect(patches, 'double-click on Approve must issue a single PATCH').toBe(1);
      const approved = await auditRows({ since, targetId: seeds.companyId, action: 'company.claim.approved' });
      expect(approved.length, 'exactly one audit row for a double-clicked Approve').toBe(1);
      expectCleanConsole(adminPage);
    });

    test('revoking the approved claim clears the badge and is audit-logged', async ({ adminPage }) => {
      test.skip(!claimId, 'claim submission did not run');
      await db().companyClaim.update({ where: { id: claimId }, data: { status: 'approved', pendingCompanyId: null } });
      await db().company.update({ where: { id: seeds.companyId }, data: { claimVerifiedAt: new Date() } });
      const since = new Date();

      await adminPage.goto('/admin/company-claims');
      await adminPage.locator('select').first().selectOption('approved');
      const row = adminPage.locator('tbody tr', { hasText: E2E_COMPANY.name });
      await expect(row).toHaveCount(1);
      await row.getByRole('button', { name: 'Revoke' }).click();
      await expect(adminPage.getByRole('status')).toContainText('Claimed badge has been removed');
      expect((await claimState()).status).toBe('rejected');
      expect((await companyState()).claimVerifiedAt).toBeNull();
      const rejected = await auditRows({ since, targetId: seeds.companyId, action: 'company.claim.rejected' });
      expect(rejected.length).toBe(1);
      expect(rejected[0].metadata).toMatchObject({ claimVerifiedAt: null });
      expectCleanConsole(adminPage);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4e. API hardening — throwaway fixtures, adversarial payloads
// ═══════════════════════════════════════════════════════════════════════════
// Everything here runs against rows this block creates and destroys itself
// (a free employer posting + an orphan user profile), so no assertion can
// corrupt the shared E2E_TEST_JOB_ID seed other journeys depend on.

test.describe('admin API hardening (local only)', () => {
  test.skip(AGAINST_PROD, 'Mutation tests pollute data — local/staging only');
  test.skip(!HAS_AUTH, 'Needs E2E_ADMIN_EMAIL/PASS');
  test.skip(!hasDb(), 'Needs DATABASE_URL for throwaway fixtures');
  test.use({ baseURL: MUTATION_BASE });

  const STAMP = Date.now().toString(36);
  const PROBE_TITLE = `E2E Hardening Probe ${STAMP}`;
  let probeJobId = '';
  let probeProfileId = '';

  test.beforeAll(async () => {
    const prisma = db();
    const job = await prisma.job.create({
      data: {
        title: PROBE_TITLE,
        employer: 'E2E Hardening Clinic',
        location: 'Remote',
        description: 'Throwaway row created by tests/e2e/journeys/admin.spec.ts (hardening block). Safe to delete.',
        applyLink: 'https://hardening.example.invalid/apply',
        slug: `e2e-hardening-probe-${STAMP}`,
        sourceType: 'employer',
        isPublished: true,
        professionClass: 'np_eligible',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    probeJobId = job.id;
    // `select` keeps the RETURNING clause to known columns: the generated
    // Prisma client can be ahead of the dev database (extra EmployerJob
    // columns), and a bare create() then fails reading them back.
    await prisma.employerJob.create({
      data: {
        jobId: job.id,
        employerName: 'E2E Hardening Clinic',
        contactEmail: 'hr@hardening.example.invalid',
        editToken: `e2e-hardening-${STAMP}`,
        paymentStatus: 'free',
        quotaDomain: 'hardening.example.invalid',
      },
      select: { id: true },
    });
    const profile = await prisma.userProfile.create({
      data: { supabaseId: randomUUID(), email: `e2e-hardening-${STAMP}@example.invalid`, role: 'job_seeker' },
      select: { id: true },
    });
    probeProfileId = profile.id;
  });

  test.afterAll(async () => {
    const prisma = db();
    // Job delete cascades to EmployerJob (onDelete: Cascade).
    if (probeJobId) await prisma.job.delete({ where: { id: probeJobId } }).catch(() => undefined);
    if (probeProfileId) await prisma.userProfile.delete({ where: { id: probeProfileId } }).catch(() => undefined);
    await closeDb();
  });

  async function probeJob() {
    return db().job.findUniqueOrThrow({
      where: { id: probeJobId },
      select: { title: true, isPublished: true, isManuallyUnpublished: true },
    });
  }

  async function findProbeRow(page: Page) {
    await page.goto('/admin/jobs');
    await expect(page.getByRole('heading', { name: 'Jobs Management' })).toBeVisible();
    await searchAdminJobs(page, 'E2E Hardening Probe');
    const row = page.locator('tbody tr', { hasText: PROBE_TITLE });
    await expect(row).toHaveCount(1);
    return row.first();
  }

  const titleField = (page: Page) => page.locator('label', { hasText: /^Title$/ }).locator('..').locator('input');

  test('PATCH /api/admin/jobs/:id rejects wrong-typed and empty values instead of writing (or 500ing on) them', async ({ adminPage }) => {
    const api = adminPage.request;
    try {
      const wrongType = await api.patch(`/api/admin/jobs/${probeJobId}`, { data: { isPublished: 'yes' }, headers: ipHeaders() });
      expect.soft([400, 422], `isPublished:'yes' answered ${wrongType.status()} — expected a validation 400, not a Prisma 500`).toContain(wrongType.status());
      const emptyTitle = await api.patch(`/api/admin/jobs/${probeJobId}`, { data: { title: '' }, headers: ipHeaders() });
      expect.soft([400, 422], `title:'' answered ${emptyTitle.status()} — an empty title must be refused`).toContain(emptyTitle.status());
      const badLink = await api.patch(`/api/admin/jobs/${probeJobId}`, { data: { applyLink: 'javascript:alert(1)' }, headers: ipHeaders() });
      expect.soft([400, 422], `applyLink javascript: URL answered ${badLink.status()}`).toContain(badLink.status());
      const row = await db().job.findUniqueOrThrow({ where: { id: probeJobId }, select: { title: true, isPublished: true, applyLink: true } });
      expect(row.title, 'empty title must not be persisted').toBe(PROBE_TITLE);
      expect(row.applyLink, 'javascript: apply link must not be persisted').toBe('https://hardening.example.invalid/apply');
      expect(row.isPublished).toBe(true);
    } finally {
      await db().job.update({ where: { id: probeJobId }, data: { title: PROBE_TITLE, isPublished: true, applyLink: 'https://hardening.example.invalid/apply' } });
    }
  });

  test('admin unpublish (PATCH isPublished=false + soft DELETE) writes an AuditLog row', async ({ adminPage }) => {
    const since = new Date();
    const api = adminPage.request;
    const patch = await api.patch(`/api/admin/jobs/${probeJobId}`, { data: { isPublished: false }, headers: ipHeaders() });
    expect(patch.status()).toBe(200);
    expect((await probeJob()).isPublished).toBe(false);
    await db().job.update({ where: { id: probeJobId }, data: { isPublished: true } });
    const del = await api.delete(`/api/admin/jobs/${probeJobId}`, { headers: ipHeaders() });
    expect(del.status()).toBe(200);
    expect((await del.json()).action).toBe('soft_deleted');
    expect((await probeJob()).isPublished).toBe(false);
    await db().job.update({ where: { id: probeJobId }, data: { isPublished: true } });

    const rows = await auditRows({ since, targetId: probeJobId });
    expect(rows.length, 'two admin unpublish actions produced no AuditLog row (app/api/admin/jobs/[id]/route.ts only audits expiresAt changes)').toBeGreaterThanOrEqual(2);
  });

  test('admin unpublish pins the job against ingest renewal (isManuallyUnpublished)', async ({ adminPage }) => {
    const api = adminPage.request;
    try {
      const del = await api.delete(`/api/admin/jobs/${probeJobId}`, { headers: ipHeaders() });
      expect(del.status()).toBe(200);
      const row = await probeJob();
      expect(row.isPublished).toBe(false);
      expect(
        row.isManuallyUnpublished,
        'admin unpublish left isManuallyUnpublished=false — lib/ingestion-service.ts renewJob() only skips jobs with that flag, so the next ingest run republishes an admin-hidden aggregator job; /admin/health also miscounts it as a pipeline unpublish',
      ).toBe(true);
    } finally {
      await db().job.update({ where: { id: probeJobId }, data: { isPublished: true, isManuallyUnpublished: false } });
    }
  });

  test('PATCH /api/admin/users/:id — invalid role refused, valid role change persists', async ({ adminPage }) => {
    const api = adminPage.request;
    const badRole = await api.patch(`/api/admin/users/${probeProfileId}`, { data: { role: 'superuser' }, headers: ipHeaders() });
    expect(badRole.status()).toBe(400);
    const empty = await api.patch(`/api/admin/users/${probeProfileId}`, { data: {}, headers: ipHeaders() });
    expect(empty.status()).toBe(400);
    const promote = await api.patch(`/api/admin/users/${probeProfileId}`, { data: { role: 'employer' }, headers: ipHeaders() });
    expect(promote.status()).toBe(200);
    const profile = await db().userProfile.findUniqueOrThrow({ where: { id: probeProfileId }, select: { role: true } });
    expect(profile.role).toBe('employer');
  });

  test('PATCH /api/admin/users/:id — role change is audit-logged (role.change)', async ({ adminPage }) => {
    const since = new Date();
    const promote = await adminPage.request.patch(`/api/admin/users/${probeProfileId}`, { data: { role: 'job_seeker' }, headers: ipHeaders() });
    expect(promote.status()).toBe(200);
    const rows = await auditRows({ since, targetId: probeProfileId });
    expect(rows.map((r) => r.action), 'role change produced no AuditLog row').not.toEqual([]);
  });

  test('PATCH/DELETE /api/admin/users/:id — unknown id is 404 and a wrong-typed flag is 400 (not Prisma 500s)', async ({ adminPage }) => {
    const api = adminPage.request;
    const missing = await api.patch(`/api/admin/users/${PLACEHOLDER_ID}`, { data: { role: 'employer' }, headers: ipHeaders() });
    expect.soft(missing.status(), 'unknown user id should be 404 (Prisma P2025), not 500').toBe(404);
    const missingDelete = await api.delete(`/api/admin/users/${PLACEHOLDER_ID}`, { headers: ipHeaders() });
    expect.soft(missingDelete.status(), 'deactivating an unknown user id should be 404 (Prisma P2025), not 500').toBe(404);
    const badFlag = await api.patch(`/api/admin/users/${probeProfileId}`, { data: { profileVisible: 'no' }, headers: ipHeaders() });
    expect.soft([400, 422], `profileVisible:'no' answered ${badFlag.status()} — expected validation 400, not Prisma 500`).toContain(badFlag.status());
  });

  test('rate limit parity: admin routes that omit the request argument still throttle at 20/min', async ({ request }) => {
    const burst = async (url: string, ip: string): Promise<number[]> => {
      const out: number[] = [];
      for (let i = 0; i < 23; i += 1) {
        const res = await request.get(url, { headers: { 'x-forwarded-for': ip } });
        out.push(res.status());
      }
      return out;
    };
    const jobs = await burst('/api/admin/jobs', nextIp());
    test.skip(!jobs.includes(429), `limiter never fired on /api/admin/jobs (${[...new Set(jobs)].join(',')}) — no rate-limit backend in this environment`);
    const health = await burst('/api/admin/health', nextIp());
    expect(
      health,
      '/api/admin/health (and email/*, pipeline-flow) call requireApiAdmin() without the request, so RATE_LIMITS.admin is never applied to them',
    ).toContain(429);
  });

  test('edit modal reports a failed save instead of swallowing it', async ({ adminPage }) => {
    await adminPage.route('**/api/admin/jobs/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Failed to update job' }) });
    });
    const row = await findProbeRow(adminPage);
    await row.getByTitle('Edit').click();
    await titleField(adminPage).fill(`${PROBE_TITLE} (must not save)`);
    await adminPage.getByRole('button', { name: 'Save Changes' }).click();
    await expect(
      adminPage.getByText(/failed|error|could not|try again/i).first(),
      'a 500 from PATCH left the modal open with no feedback — app/admin/jobs/page.tsx saveEdit() only reports errors from the catch branch, never from !res.ok',
    ).toBeVisible({ timeout: 5_000 });
    expect((await probeJob()).title).toBe(PROBE_TITLE);
    expectCleanConsole(adminPage, [/500/]);
  });

  test('status toggle reports a failed PATCH instead of swallowing it', async ({ adminPage }) => {
    await adminPage.route('**/api/admin/jobs/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Failed to update job' }) });
    });
    const row = await findProbeRow(adminPage);
    await row.getByTitle('Click to unpublish').click();
    await expect(
      adminPage.getByText(/failed|error|could not|try again/i).first(),
      'a 500 from the publish toggle produced no feedback — app/admin/jobs/page.tsx toggleField() ignores !res.ok',
    ).toBeVisible({ timeout: 5_000 });
    await expect(row.getByTitle('Click to unpublish'), 'row must not optimistically flip on a failed PATCH').toBeVisible();
    expect((await probeJob()).isPublished).toBe(true);
    expectCleanConsole(adminPage, [/500/]);
  });

  test('edit modal Save is double-submit safe (exactly one PATCH)', async ({ adminPage }) => {
    let patches = 0;
    adminPage.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes(`/api/admin/jobs/${probeJobId}`)) patches += 1;
    });
    const row = await findProbeRow(adminPage);
    await row.getByTitle('Edit').click();
    await titleField(adminPage).fill(`${PROBE_TITLE} (dbl)`);
    await adminPage.getByRole('button', { name: 'Save Changes' }).dblclick();
    await expect(adminPage.getByText('Job updated', { exact: true })).toBeVisible();
    await expect.poll(async () => (await probeJob()).title).toBe(`${PROBE_TITLE} (dbl)`);
    expect(patches, 'double-click on Save must issue a single PATCH').toBe(1);
    await db().job.update({ where: { id: probeJobId }, data: { title: PROBE_TITLE } });
    expectCleanConsole(adminPage);
  });

  test('bulk action validation (missing action, >100 ids, unknown action) and a no-op on unknown ids', async ({ adminPage }) => {
    const api = adminPage.request;
    const noAction = await api.post('/api/admin/jobs/bulk', { data: { jobIds: [probeJobId] }, headers: ipHeaders() });
    expect(noAction.status()).toBe(400);
    const tooMany = await api.post('/api/admin/jobs/bulk', { data: { action: 'publish', jobIds: Array.from({ length: 101 }, () => PLACEHOLDER_ID) }, headers: ipHeaders() });
    expect(tooMany.status()).toBe(400);
    const unknownAction = await api.post('/api/admin/jobs/bulk', { data: { action: 'archive', jobIds: [probeJobId] }, headers: ipHeaders() });
    expect(unknownAction.status()).toBe(400);
    const noop = await api.post('/api/admin/jobs/bulk', { data: { action: 'unpublish', jobIds: [PLACEHOLDER_ID] }, headers: ipHeaders() });
    expect(noop.status()).toBe(200);
    expect((await noop.json()).affected).toBe(0);
    expect((await probeJob()).isPublished).toBe(true);
  });

  test('validation parity across the smaller admin write routes (empty bodies are 400, never 500 or a write)', async ({ adminPage }) => {
    const api = adminPage.request;
    const probes: Array<[string, string, unknown]> = [
      ['POST', '/api/admin/blog', {}],
      ['PUT', `/api/admin/blog/${PLACEHOLDER_ID}`, {}],
      ['PATCH', '/api/admin/pd-campaign', {}],
      ['PATCH', '/api/admin/pd-campaign', { id: PLACEHOLDER_ID, status: 'installed' }], // installed needs widgetInstalledUrl
      ['POST', '/api/admin/ai/flags', {}],
      ['POST', '/api/admin/email/preview', {}],
      ['POST', '/api/admin/email/send', {}],
      ['POST', '/api/admin/email/templates', {}],
      ['DELETE', '/api/admin/email/templates', undefined],
      ['POST', '/api/admin/email/test', {}],
    ];
    for (const [method, url, data] of probes) {
      const res = await api.fetch(url, { method, data, headers: ipHeaders() });
      expect.soft([400, 404, 422], `${method} ${url} with an empty/invalid body answered ${res.status()}`).toContain(res.status());
    }
  });

  test('an admin cannot demote their own account (self-lockout guard)', async ({ adminPage }) => {
    const adminCreds = getAdminCreds() as AuthCreds;
    const me = await db().userProfile.findFirstOrThrow({ where: { email: { equals: adminCreds.email, mode: 'insensitive' } }, select: { id: true } });
    try {
      const res = await adminPage.request.patch(`/api/admin/users/${me.id}`, { data: { role: 'job_seeker' }, headers: ipHeaders() });
      const after = await db().userProfile.findUniqueOrThrow({ where: { id: me.id }, select: { role: true } });
      expect(
        [400, 403, 409],
        `PATCH own role answered ${res.status()} and the DB now says role=${after.role} — an admin demoting themselves locks the console with no way back (app/api/admin/users/[id]/route.ts has no self-target guard)`,
      ).toContain(res.status());
      expect(after.role).toBe('admin');
    } finally {
      await db().userProfile.update({ where: { id: me.id }, data: { role: 'admin' } });
    }
  });

  test('DELETE /api/admin/users/:id — deactivate persists (profile hidden, not open to offers)', async ({ adminPage }) => {
    const ok = await adminPage.request.delete(`/api/admin/users/${probeProfileId}`, { headers: ipHeaders() });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).action).toBe('deactivated');
    const profile = await db().userProfile.findUniqueOrThrow({ where: { id: probeProfileId }, select: { profileVisible: true, openToOffers: true } });
    expect(profile.profileVisible).toBe(false);
    expect(profile.openToOffers).toBe(false);
  });

  test('DELETE /api/admin/users/:id — deactivation is audit-logged', async ({ adminPage }) => {
    const since = new Date();
    await db().userProfile.update({ where: { id: probeProfileId }, data: { profileVisible: true, openToOffers: true } });
    const ok = await adminPage.request.delete(`/api/admin/users/${probeProfileId}`, { headers: ipHeaders() });
    expect(ok.status()).toBe(200);
    const rows = await auditRows({ since, targetId: probeProfileId });
    expect(rows.map((r) => r.action), 'user deactivation produced no AuditLog row').not.toEqual([]);
  });

  // Destroys the probe PROFILE (not the probe job) — keep it after every other
  // users/:id probe in this block.
  test('DELETE /api/admin/users/:id?hard=true — permanent deletion of an account is audit-logged', async ({ adminPage }) => {
    const since = new Date();
    const res = await adminPage.request.delete(`/api/admin/users/${probeProfileId}?hard=true`, { headers: ipHeaders() });
    expect(res.status()).toBe(200);
    expect((await res.json()).action).toBe('hard_deleted');
    const gone = await db().userProfile.findUnique({ where: { id: probeProfileId }, select: { id: true } });
    expect(gone).toBeNull();
    const rows = await auditRows({ since, targetId: probeProfileId });
    expect(
      rows.map((r) => r.action),
      'an admin permanently deleted a user profile and no AuditLog row records it (app/api/admin/users/[id]/route.ts DELETE ?hard=true never calls logAudit; GDPR Art. 30 record-of-processing gap)',
    ).not.toEqual([]);
  });

  // LAST in this block: if the guard is missing the probe job is gone.
  test('bulk hard_delete refuses a free posting like DELETE ?hard=true does (audit #25 guard)', async ({ adminPage }) => {
    const res = await adminPage.request.post('/api/admin/jobs/bulk', { data: { action: 'hard_delete', jobIds: [probeJobId] }, headers: ipHeaders() });
    const still = await db().job.findUnique({ where: { id: probeJobId }, select: { id: true } });
    expect(still, 'bulk hard_delete erased a free posting (its EmployerJob quota record cascaded away) — app/api/admin/jobs/bulk/route.ts has no paymentStatus=free guard').not.toBeNull();
    expect(res.status(), 'bulk hard_delete on a free posting should be 409 (parity with app/api/admin/jobs/[id]/route.ts DELETE)').toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4f. Audit coverage + robustness across the remaining admin writers
// ═══════════════════════════════════════════════════════════════════════════
// Rule under test: every admin mutation writes an AuditLog row. 4a-4e cover
// jobs, companies, testimonials, claims and users; this block sweeps the
// writers that are left (admin job creation, blog, AI feature-flag kill
// switches, pd-campaign) plus the list endpoints' parameter handling. Every
// fixture is created and destroyed here.

const JOB_CREATE_AUDIT_DEFECT =
  'DEFECT: POST /api/admin/jobs (admin job creation) and DELETE /api/admin/jobs/:id?hard=true (permanent deletion) write no AuditLog row and record no creator — app/api/admin/jobs/route.ts and app/api/admin/jobs/[id]/route.ts never call logAudit';
const JOB_CREATE_VALIDATION_DEFECT =
  'DEFECT: POST /api/admin/jobs copies unvalidated fields into prisma.job.create — minSalary:"abc" → 500, applyLink "javascript:…" is persisted and published (app/api/admin/jobs/route.ts)';
const BLOG_AUDIT_DEFECT =
  'DEFECT: admin blog create/update/delete write no AuditLog row — app/api/admin/blog/route.ts and app/api/admin/blog/[id]/route.ts never call logAudit';
const BLOG_VALIDATION_DEFECT =
  'DEFECT: PUT /api/admin/blog/:id copies unvalidated fields (status:"bogus", title:"" persist) and PUT/DELETE answer 500 for an unknown id (Prisma P2025 unmapped) — app/api/admin/blog/[id]/route.ts';
const FLAG_AUDIT_DEFECT =
  'DEFECT: AI feature-flag overrides (kill switches) record no actor — POST /api/admin/ai/flags never fills AiFeatureFlagOverride.setBy and writes no AuditLog row (app/api/admin/ai/flags/route.ts)';
const PD_CAMPAIGN_ERROR_DEFECT =
  'DEFECT: PATCH /api/admin/pd-campaign answers 500 with the raw Prisma error message ({ error: err.message }) for an unknown lead id instead of 404 — app/api/admin/pd-campaign/route.ts';
const JOBS_LIST_PAGING_DEFECT =
  'DEFECT: GET /api/admin/jobs answers 500 for non-numeric paging (page=abc / limit=abc → NaN skip/take reaches Prisma) — app/api/admin/jobs/route.ts';

test.describe('admin audit coverage + list robustness (local only)', () => {
  test.skip(AGAINST_PROD, 'Mutation tests pollute data — local/staging only');
  test.skip(!HAS_AUTH, 'Needs E2E_ADMIN_EMAIL/PASS');
  test.skip(!hasDb(), 'Needs DATABASE_URL for throwaway fixtures + audit verification');
  test.use({ baseURL: MUTATION_BASE });

  const STAMP = Date.now().toString(36);
  const CREATED_TITLE_PREFIX = 'E2E Admin-Created Posting';
  const CREATED_TITLE = `${CREATED_TITLE_PREFIX} ${STAMP}`;
  const BLOG_TITLE_PREFIX = 'E2E Admin Blog Probe';
  const BLOG_TITLE = `${BLOG_TITLE_PREFIX} ${STAMP}`;
  const FLAG_REASON_PREFIX = 'E2E admin-journey probe';
  const FLAG_REASON = `${FLAG_REASON_PREFIX} ${STAMP}`;
  const FLAG = 'ai.platform.support_bot';
  let adminSupabaseId = '';

  const jobPayload = (title: string) => ({
    title,
    employer: 'E2E Admin Clinic',
    location: 'Remote',
    description: 'Throwaway row created by tests/e2e/journeys/admin.spec.ts (audit block). Safe to delete.',
    applyLink: 'https://admin-created.example.invalid/apply',
  });

  test.beforeAll(async () => {
    const adminCreds = getAdminCreds() as AuthCreds;
    adminSupabaseId = (await supabaseIdForEmail(adminCreds.email)) ?? '';
  });

  test.afterAll(async () => {
    const prisma = db();
    await prisma.job.deleteMany({ where: { title: { startsWith: CREATED_TITLE_PREFIX } } }).catch(() => undefined);
    await prisma.blogPost.deleteMany({ where: { title: { startsWith: BLOG_TITLE_PREFIX } } }).catch(() => undefined);
    await prisma.aiFeatureFlagOverride.deleteMany({ where: { reason: { startsWith: FLAG_REASON_PREFIX } } }).catch(() => undefined);
    await closeDb();
  });

  // ── list endpoints ────────────────────────────────────────────────────

  test('GET /api/admin/jobs tolerates non-numeric paging (page=abc, limit=abc) without a 500', async ({ adminPage }) => {
    const api = adminPage.request;
    for (const q of ['page=abc', 'limit=abc', 'page=abc&limit=abc']) {
      const res = await api.get(`/api/admin/jobs?${q}`, { headers: ipHeaders() });
      expect.soft([200, 400], `/api/admin/jobs?${q} answered ${res.status()} — Math.max(1, NaN) is NaN, so skip/take reach Prisma as NaN`).toContain(res.status());
    }
  });

  test('GET /api/admin/jobs clamps out-of-range paging and ignores unknown filter values (never 500)', async ({ adminPage }) => {
    const api = adminPage.request;
    const queries = ['page=-5&limit=0', 'page=1000000000', 'limit=100000', 'sort=drop', 'published=maybe', 'featured=1', 'source=%27%3B--'];
    for (const q of queries) {
      const res = await api.get(`/api/admin/jobs?${q}`, { headers: ipHeaders() });
      expect.soft([200, 400], `/api/admin/jobs?${q} answered ${res.status()}`).toContain(res.status());
      if (res.status() === 200) {
        const json = (await res.json()) as { success: boolean; page: number; jobs: unknown[] };
        expect.soft(json.success, `/api/admin/jobs?${q} success flag`).toBe(true);
        expect.soft(json.page, `/api/admin/jobs?${q} page must be >= 1`).toBeGreaterThanOrEqual(1);
        expect.soft(json.jobs.length, `/api/admin/jobs?${q} must cap at 100 rows`).toBeLessThanOrEqual(100);
      }
    }
  });

  test('GET /api/admin/jobs search with SQL / regex metacharacters answers 200 with an empty or filtered set', async ({ adminPage }) => {
    const api = adminPage.request;
    for (const term of [`%'"--`, '(unbalanced', '\\', "' OR 1=1 --", '%%%']) {
      const res = await api.get(`/api/admin/jobs?search=${encodeURIComponent(term)}&limit=5`, { headers: ipHeaders() });
      expect.soft(res.status(), `search=${term} answered ${res.status()}`).toBe(200);
    }
  });

  // ── admin job creation ────────────────────────────────────────────────

  test('POST /api/admin/jobs creates an admin-sourced posting the list can find, and DELETE ?hard=true removes it', async ({ adminPage }) => {
    const api = adminPage.request;
    const res = await api.post('/api/admin/jobs', { data: jobPayload(CREATED_TITLE), headers: ipHeaders() });
    expect(res.status(), await res.text()).toBe(201);
    const { job } = (await res.json()) as { job: { id: string; slug: string; sourceProvider: string | null } };
    expect(job.sourceProvider).toBe('admin');
    const row = await db().job.findUniqueOrThrow({ where: { id: job.id }, select: { isPublished: true, sourceType: true } });
    expect(row.isPublished).toBe(true);
    expect(row.sourceType).toBe('direct');

    const listed = await api.get(`/api/admin/jobs?search=${encodeURIComponent(CREATED_TITLE)}`, { headers: ipHeaders() });
    expect(listed.status()).toBe(200);
    expect(((await listed.json()) as { total: number }).total, 'admin list should find the just-created posting').toBe(1);

    // No EmployerJob row → not a free posting → hard delete is allowed.
    const del = await api.delete(`/api/admin/jobs/${job.id}?hard=true`, { headers: ipHeaders() });
    expect(del.status()).toBe(200);
    expect(((await del.json()) as { action: string }).action).toBe('hard_deleted');
    expect(await db().job.findUnique({ where: { id: job.id }, select: { id: true } })).toBeNull();

    const gone = await api.delete(`/api/admin/jobs/${job.id}?hard=true`, { headers: ipHeaders() });
    expect.soft([404, 500], `re-deleting a gone job answered ${gone.status()}`).toContain(gone.status());
  });

  test('admin job creation and permanent deletion are audit-logged', async ({ adminPage }) => {
    const since = new Date();
    const api = adminPage.request;
    const res = await api.post('/api/admin/jobs', { data: jobPayload(`${CREATED_TITLE} audit`), headers: ipHeaders() });
    expect(res.status()).toBe(201);
    const { job } = (await res.json()) as { job: { id: string } };
    const del = await api.delete(`/api/admin/jobs/${job.id}?hard=true`, { headers: ipHeaders() });
    expect(del.status()).toBe(200);
    const rows = await auditRows({ since, targetId: job.id });
    expect(rows.map((r) => r.action), 'admin create + hard delete produced no AuditLog row').toHaveLength(2);
    expect(rows.every((r) => r.actorId === adminSupabaseId), 'audit rows should name the acting admin').toBe(true);
  });

  test('POST /api/admin/jobs refuses a wrong-typed salary and a javascript: apply link (no 500, nothing persisted)', async ({ adminPage }) => {
    const api = adminPage.request;
    const salaryTitle = `${CREATED_TITLE} salary`;
    const linkTitle = `${CREATED_TITLE} link`;
    const badSalary = await api.post('/api/admin/jobs', { data: { ...jobPayload(salaryTitle), minSalary: 'abc', maxSalary: 'xyz' }, headers: ipHeaders() });
    expect.soft([400, 422], `minSalary:'abc' answered ${badSalary.status()} — expected a validation 400, not a Prisma 500`).toContain(badSalary.status());
    const badLink = await api.post('/api/admin/jobs', { data: { ...jobPayload(linkTitle), applyLink: 'javascript:alert(1)' }, headers: ipHeaders() });
    expect.soft([400, 422], `applyLink javascript: URL answered ${badLink.status()}`).toContain(badLink.status());
    const persisted = await db().job.count({ where: { title: { in: [salaryTitle, linkTitle] } } });
    expect(persisted, 'rejected admin job payloads must not be persisted (a javascript: apply link would be published)').toBe(0);
  });

  // ── blog ──────────────────────────────────────────────────────────────

  test('blog: create draft → publish via PUT → delete through the admin API', async ({ adminPage }) => {
    const api = adminPage.request;
    const created = await api.post('/api/admin/blog', {
      data: { title: BLOG_TITLE, content: 'Throwaway post body from tests/e2e/journeys/admin.spec.ts. Safe to delete.', category: 'job_seeker_attraction' },
      headers: ipHeaders(),
    });
    expect(created.status(), await created.text()).toBe(201);
    const { post } = (await created.json()) as { post: { id: string; slug: string; status: string; publishDate: string | null } };
    expect(post.status).toBe('draft');
    expect(post.publishDate, 'a draft must not carry a publish date').toBeNull();
    expect(post.slug).toMatch(/^e2e-admin-blog-probe-/);

    const listed = await api.get('/api/admin/blog', { headers: ipHeaders() });
    expect(listed.status()).toBe(200);
    const { posts } = (await listed.json()) as { posts: Array<{ id: string }> };
    expect(posts.some((p) => p.id === post.id), 'admin blog list should include the draft').toBe(true);

    const published = await api.put(`/api/admin/blog/${post.id}`, { data: { status: 'published' }, headers: ipHeaders() });
    expect(published.status()).toBe(200);
    expect(((await published.json()) as { post: { publishDate: string | null } }).post.publishDate, 'publishing stamps publishDate').not.toBeNull();

    // Un-publishing must keep the original publishDate (re-publish keeps it too).
    const drafted = await api.put(`/api/admin/blog/${post.id}`, { data: { status: 'draft' }, headers: ipHeaders() });
    expect(drafted.status()).toBe(200);
    const again = await api.put(`/api/admin/blog/${post.id}`, { data: { status: 'published' }, headers: ipHeaders() });
    expect(again.status()).toBe(200);

    const del = await api.delete(`/api/admin/blog/${post.id}`, { headers: ipHeaders() });
    expect(del.status()).toBe(200);
    expect(await db().blogPost.findUnique({ where: { id: post.id }, select: { id: true } })).toBeNull();
  });

  test('blog: create, update and delete are audit-logged', async ({ adminPage }) => {
    const since = new Date();
    const api = adminPage.request;
    const created = await api.post('/api/admin/blog', { data: { title: `${BLOG_TITLE} audit`, content: 'Throwaway.', category: 'job_seeker_attraction' }, headers: ipHeaders() });
    expect(created.status()).toBe(201);
    const { post } = (await created.json()) as { post: { id: string } };
    expect((await api.put(`/api/admin/blog/${post.id}`, { data: { status: 'published' }, headers: ipHeaders() })).status()).toBe(200);
    expect((await api.delete(`/api/admin/blog/${post.id}`, { headers: ipHeaders() })).status()).toBe(200);
    const rows = await auditRows({ since, targetId: post.id });
    expect(rows.map((r) => r.action), 'blog create/publish/delete produced no AuditLog row').toHaveLength(3);
  });

  test('blog: PUT refuses an unknown status and an empty title; unknown id is 404 (not 500)', async ({ adminPage }) => {
    const api = adminPage.request;
    const created = await api.post('/api/admin/blog', { data: { title: `${BLOG_TITLE} validation`, content: 'Throwaway.', category: 'job_seeker_attraction' }, headers: ipHeaders() });
    expect(created.status()).toBe(201);
    const { post } = (await created.json()) as { post: { id: string } };
    try {
      const badStatus = await api.put(`/api/admin/blog/${post.id}`, { data: { status: 'bogus' }, headers: ipHeaders() });
      expect.soft([400, 422], `status:'bogus' answered ${badStatus.status()}`).toContain(badStatus.status());
      const emptyTitle = await api.put(`/api/admin/blog/${post.id}`, { data: { title: '' }, headers: ipHeaders() });
      expect.soft([400, 422], `title:'' answered ${emptyTitle.status()}`).toContain(emptyTitle.status());
      const row = await db().blogPost.findUniqueOrThrow({ where: { id: post.id }, select: { status: true, title: true } });
      expect(row.status, 'unknown status must not be persisted').toBe('draft');
      expect(row.title, 'empty title must not be persisted').toBe(`${BLOG_TITLE} validation`);
      const missingPut = await api.put(`/api/admin/blog/${PLACEHOLDER_ID}`, { data: { title: 'x' }, headers: ipHeaders() });
      expect.soft(missingPut.status(), 'PUT unknown blog id should be 404').toBe(404);
      const missingDel = await api.delete(`/api/admin/blog/${PLACEHOLDER_ID}`, { headers: ipHeaders() });
      expect.soft(missingDel.status(), 'DELETE unknown blog id should be 404').toBe(404);
    } finally {
      await db().blogPost.delete({ where: { id: post.id } }).catch(() => undefined);
    }
  });

  // ── AI feature-flag kill switches ─────────────────────────────────────

  test('ai flags: an admin-scoped override round-trips, is listed, and bad shapes are refused', async ({ adminPage }) => {
    test.skip(!adminSupabaseId, 'admin supabase id not resolvable');
    const api = adminPage.request;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // self-heals if cleanup fails
    const res = await api.post('/api/admin/ai/flags', {
      data: { flag: FLAG, tenantType: 'admin', tenantId: adminSupabaseId, enabled: false, reason: FLAG_REASON, expiresAt },
      headers: ipHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const { override } = (await res.json()) as { override: { id: string; enabled: boolean } };
    expect(override.enabled).toBe(false);

    const list = await api.get('/api/admin/ai/flags', { headers: ipHeaders() });
    expect(list.status()).toBe(200);
    const { flags, overrides } = (await list.json()) as { flags: Array<{ flag: string }>; overrides: Array<{ id: string }> };
    expect(flags.some((f) => f.flag === FLAG)).toBe(true);
    expect(overrides.some((o) => o.id === override.id), 'the new override should be listed').toBe(true);

    // Re-posting the same scope replaces rather than duplicates.
    const again = await api.post('/api/admin/ai/flags', {
      data: { flag: FLAG, tenantType: 'admin', tenantId: adminSupabaseId, enabled: true, reason: FLAG_REASON, expiresAt },
      headers: ipHeaders(),
    });
    expect(again.status()).toBe(200);
    expect(await db().aiFeatureFlagOverride.count({ where: { flag: FLAG, tenantType: 'admin', tenantId: adminSupabaseId } })).toBe(1);

    const unknownFlag = await api.post('/api/admin/ai/flags', { data: { flag: 'ai.nope', tenantType: 'global', tenantId: null, enabled: true }, headers: ipHeaders() });
    expect(unknownFlag.status()).toBe(400);
    const globalWithTenant = await api.post('/api/admin/ai/flags', { data: { flag: FLAG, tenantType: 'global', tenantId: 'x', enabled: true }, headers: ipHeaders() });
    expect(globalWithTenant.status()).toBe(400);
    const scopedWithoutTenant = await api.post('/api/admin/ai/flags', { data: { flag: FLAG, tenantType: 'employer', tenantId: null, enabled: true }, headers: ipHeaders() });
    expect(scopedWithoutTenant.status()).toBe(400);
    const badDate = await api.post('/api/admin/ai/flags', { data: { flag: FLAG, tenantType: 'global', tenantId: null, enabled: true, expiresAt: 'tomorrow' }, headers: ipHeaders() });
    expect(badDate.status()).toBe(400);

    await db().aiFeatureFlagOverride.deleteMany({ where: { id: override.id } });
  });

  test('ai flags: an override records who set it and is audit-logged', async ({ adminPage }) => {
    test.skip(!adminSupabaseId, 'admin supabase id not resolvable');
    const since = new Date();
    const res = await adminPage.request.post('/api/admin/ai/flags', {
      data: { flag: FLAG, tenantType: 'admin', tenantId: adminSupabaseId, enabled: false, reason: `${FLAG_REASON} audit`, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
      headers: ipHeaders(),
    });
    expect(res.status()).toBe(200);
    const { override } = (await res.json()) as { override: { id: string } };
    try {
      const row = await db().aiFeatureFlagOverride.findUniqueOrThrow({ where: { id: override.id }, select: { setBy: true } });
      expect.soft(row.setBy, 'AiFeatureFlagOverride.setBy should name the admin who flipped the switch').toBe(adminSupabaseId);
      const rows = await auditRows({ since, action: /flag/i });
      expect(rows.length, 'flipping an AI kill switch produced no AuditLog row').toBeGreaterThan(0);
    } finally {
      await db().aiFeatureFlagOverride.deleteMany({ where: { id: override.id } });
    }
  });

  // ── pd-campaign ───────────────────────────────────────────────────────

  test('pd-campaign: unknown lead id is a 404 and the error body leaks no Prisma internals', async ({ adminPage }) => {
    const res = await adminPage.request.patch('/api/admin/pd-campaign', { data: { id: PLACEHOLDER_ID, status: 'replied' }, headers: ipHeaders() });
    const text = await res.text();
    expect.soft(res.status(), `unknown lead id answered ${res.status()}: ${text.slice(0, 200)}`).toBe(404);
    expect(text, 'error body must not leak Prisma internals to the client').not.toMatch(/prisma|invocation|P2025|clientVersion/i);
  });

  test('pd-campaign: non-uuid id and a non-settable status (wave1_sent) are 400', async ({ adminPage }) => {
    const api = adminPage.request;
    const badId = await api.patch('/api/admin/pd-campaign', { data: { id: 'not-a-uuid', status: 'replied' }, headers: ipHeaders() });
    expect(badId.status()).toBe(400);
    const sentStatus = await api.patch('/api/admin/pd-campaign', { data: { id: PLACEHOLDER_ID, status: 'wave1_sent' }, headers: ipHeaders() });
    expect(sentStatus.status(), 'wave1_sent is set by the send script only').toBe(400);
    const installedNoUrl = await api.patch('/api/admin/pd-campaign', { data: { id: PLACEHOLDER_ID, status: 'installed' }, headers: ipHeaders() });
    expect(installedNoUrl.status()).toBe(400);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// 5. Mobile viewport (375px) — core classification flow
// ═══════════════════════════════════════════════════════════════════════════

test.describe('admin on a 375px viewport', () => {
  test.skip(AGAINST_PROD, 'Mutation tests pollute data — local/staging only');
  test.skip(!HAS_AUTH, 'Needs E2E_ADMIN_EMAIL/PASS');
  test.skip(!hasDb(), 'Needs DATABASE_URL');
  test.use({ baseURL: MUTATION_BASE, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  let companyId = '';

  test.beforeAll(async () => {
    const company = await db().company.upsert({
      where: { normalizedName: E2E_COMPANY.normalizedName },
      create: { id: E2E_COMPANY.id, name: E2E_COMPANY.name, normalizedName: E2E_COMPANY.normalizedName, website: E2E_COMPANY.website },
      update: {},
      select: { id: true },
    });
    companyId = company.id;
  });

  test.afterAll(async () => {
    if (companyId) {
      await db().company.update({ where: { id: companyId }, data: { recruitmentType: null } }).catch(() => undefined);
    }
    await closeDb();
  });

  async function noHorizontalOverflow(page: Page, label: string) {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${label}: page scrolls horizontally (${scrollWidth}px > ${innerWidth}px)`).toBeLessThanOrEqual(innerWidth + 1);
  }

  test('sidebar toggle opens the nav and the classification flow works on mobile', async ({ adminPage }) => {
    await adminPage.goto('/admin');
    // The dashboard heading renders after /api/admin/analytics?days=30 returns, which can take
    // well over the default 15 s on the shared dev database.
    await expect(adminPage.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible({ timeout: 60_000 });
    await noHorizontalOverflow(adminPage, '/admin');

    const toggle = adminPage.getByRole('button', { name: 'Toggle sidebar' });
    await expect(toggle).toBeVisible();
    const companiesLink = adminPage.getByRole('link', { name: 'Companies' });
    await expect(companiesLink).not.toBeInViewport();
    await toggle.click();
    await expect(companiesLink).toBeInViewport();
    await companiesLink.click();
    await expect(adminPage).toHaveURL(/\/admin\/companies/);
    await expect(adminPage.getByRole('heading', { name: /Companies: Employer Type/ })).toBeVisible();
    await noHorizontalOverflow(adminPage, '/admin/companies');

    await adminPage.locator('#company-class-filter').selectOption('all');
    await adminPage.getByRole('searchbox', { name: 'Search companies by name' }).fill('E2E Behavioral');
    const row = adminPage.locator('tbody tr', { hasText: E2E_COMPANY.name });
    await expect(row).toHaveCount(1);
    const staffing = row.getByRole('button', { name: 'Staffing' });
    await staffing.scrollIntoViewIfNeeded();
    await staffing.click();
    await expect(adminPage.getByRole('status')).toContainText('classified as a staffing agency');
    const state = await db().company.findUniqueOrThrow({ where: { id: companyId }, select: { recruitmentType: true } });
    expect(state.recruitmentType).toBe('staffing_agency');
    await row.getByRole('button', { name: 'Clear' }).click();
    await expect(adminPage.getByRole('status')).toContainText('unclassified again');
    expectCleanConsole(adminPage);
  });

  test('/admin/jobs table scrolls inside its container, not the page', async ({ adminPage }) => {
    await adminPage.goto('/admin/jobs');
    await expect(adminPage.getByRole('heading', { name: 'Jobs Management' })).toBeVisible();
    await expect(adminPage.locator('table')).toBeVisible();
    await noHorizontalOverflow(adminPage, '/admin/jobs');
    expectCleanConsole(adminPage);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Legacy mutation smoke (kept from the original spec, timeouts removed)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('admin mutation smoke (local only)', () => {
  test.skip(AGAINST_PROD, 'Mutation tests pollute data — local/staging only');
  test.skip(!HAS_AUTH, 'Needs E2E_ADMIN_EMAIL/PASS');

  test('jobs page lets admin filter or search', async ({ adminPage }) => {
    await adminPage.goto('/admin/jobs');
    const searchField = adminPage.getByPlaceholder(/search|filter/i).first();
    await expect(searchField).toBeVisible();
    const listed = adminPage.waitForResponse((r) => r.url().includes('/api/admin/jobs?') && r.url().includes('search=PMHNP') && (r.status() < 300 || r.status() >= 400));
    await searchField.fill('PMHNP');
    expect((await listed).status()).toBe(200);
    expect(await bodyText(adminPage)).not.toMatch(RENDER_ERROR);
    expectCleanConsole(adminPage);
  });

  test('admin can open the email composer (no send)', async ({ adminPage }) => {
    await adminPage.goto('/admin/email');
    const composeBtn = adminPage
      .getByRole('button', { name: /compose|new.*email|create/i })
      .or(adminPage.getByRole('link', { name: /compose|new.*email|create/i }))
      .first();
    if (await composeBtn.count()) await composeBtn.click();
    const subjectField = adminPage.getByLabel(/subject/i).or(adminPage.getByPlaceholder(/subject/i)).first();
    if (!(await subjectField.count())) {
      test.skip(true, 'No subject field — admin email UI may be different');
      return;
    }
    await subjectField.fill('E2E test subject — DO NOT SEND');
    expect(await subjectField.inputValue()).toContain('E2E test');
    // Deliberately no send.
  });

  test('admin can navigate the blog editor list', async ({ adminPage }) => {
    await adminPage.goto('/admin/blog');
    const firstPost = adminPage.locator('a[href^="/admin/blog/"]').first();
    if (!(await firstPost.count())) {
      test.skip(true, 'No blog posts in /admin/blog');
      return;
    }
    await firstPost.click();
    await expect(adminPage).toHaveURL(/\/admin\/blog\/.+/);
    expect(await bodyText(adminPage)).not.toMatch(RENDER_ERROR);
  });
});

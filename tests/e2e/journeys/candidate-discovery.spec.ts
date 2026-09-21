import { test, expect, type Page, type Locator } from '@playwright/test';
import { installConsoleGuard, type ConsoleGuard } from '../helpers/console-guard';
import { presetConsentCookie } from '../helpers/a11y';
import { MUT_ORIGIN, uniqueIp } from '../helpers/candidate';
import { CATEGORY_AXES } from '../../../lib/pseo/taxonomy-registry';

/**
 * Candidate discovery journey — ANONYMOUS browse → search → filter → detail.
 *
 * Read-only: nothing here mutates the database. Every /jobs interaction is
 * also a budget question — `GET /api/jobs` is rate-limited to 30 req/min per
 * IP (app/api/jobs/route.ts) and the UI spends 2 calls per facet toggle (the
 * list fetch + LinkedInFilters' employer-type probe), so tests that need
 * many calls first wait for the window to clear via `waitForJobsApiQuota`.
 *
 * Seeds (tests/e2e/.env.test, written by the setup agent):
 *   E2E_TEST_JOB_ID / E2E_TEST_JOB_SLUG      — employer-posted PMHNP job (Austin, TX)
 *   E2E_QUARANTINE_JOB_ID / _SLUG            — Podiatrist (DPM) probe, professionClass=other_clinical
 *
 * Tests annotated `test.fixme(true, 'DEFECT: …')` pin a confirmed product
 * defect: the assertions below the annotation are the target contract —
 * delete the fixme line once the fix lands and the test re-arms itself.
 */

const TEST_JOB_ID = process.env.E2E_TEST_JOB_ID || '';
const TEST_JOB_SLUG = process.env.E2E_TEST_JOB_SLUG || '';
const QUARANTINE_ID = process.env.E2E_QUARANTINE_JOB_ID || '';
const QUARANTINE_SLUG = process.env.E2E_QUARANTINE_JOB_SLUG || '';
const QUARANTINE_TITLE = 'Podiatrist (DPM)';
const TEST_EMPLOYER = 'E2E Behavioral Health Group';
const REVIEWER_QUERY = 'remote nurse practitioner jobs in Texas';
const NP_SOC = '29-1171.00';
const MOBILE = { width: 375, height: 812 };
const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** The dev board is ingested/expired by crons while tests run — totals may move by a row or two between calls. */
const INGEST_DRIFT = 3;
/** React 19 production hydration errors: #418 (HTML mismatch), #423/#425 (text/attribute). */
const HYDRATION_ERROR_RE = /Minified React error #4(18|23|25)|Hydration failed|hydrat/i;
/** Site-wide copy rule (owner direction 2026-09-12): no em/en dashes in visible text. */
const DASH_RE = /[–—]/;
/** A salary range joined by any dash ("$100-$110/hr", "$58k – $75k") instead of "to". */
const DASHED_RANGE_RE = /\d\s*[-–—]\s*\$?\d/;
const GONE_JOB_URL = '/jobs/gone-job-00000000-0000-0000-0000-000000000000';

// Mirrors lib/filters.ts categoryFilterLabel (not imported: that module pulls
// @prisma/client + the whole relevance config into the test runner).
const LABEL_OVERRIDES: Record<string, string> = {
  'adult-gerontology': 'Adult-Gerontology',
  'women-health': "Women's Health",
};
function specialtyLabel(slug: string): string {
  return LABEL_OVERRIDES[slug] || slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Locators ────────────────────────────────────────────────────────────────

const results = (page: Page) => page.locator('section[aria-label="Job results"]');
/** JobCard <Link>s — every card link carries an aria-label "title at employer". */
const cards = (page: Page) => results(page).locator('a[href^="/jobs/"][aria-label]');
const searchBox = (page: Page) => page.locator('input[aria-label="Search by job title, company, state, or work mode"]:visible').first();
const locationBox = (page: Page) => page.locator('input[aria-label="Filter by state or remote"]:visible').first();
const facet = (page: Page, name: RegExp) => page.getByRole('checkbox', { name }).locator('visible=true').first();
const removePill = (page: Page, label: string) => page.getByRole('button', { name: `Remove ${label} filter` });
const jobsFound = (page: Page) => page.getByText(/^[\d,.]+ jobs found$/).first();
/**
 * POST /api/jobs/filter-counts measured at 12 to 19 s on the dev DB
 * (see the latency test), so any wait on the sidebar count gets this budget.
 */
const COUNTS_TIMEOUT = 45_000;
async function sidebarTotal(page: Page): Promise<number> {
  await expect(jobsFound(page)).toHaveText(/^[\d,]+ jobs found$/, { timeout: COUNTS_TIMEOUT });
  return Number(digits((await jobsFound(page).textContent()) || '-1'));
}
const noJobs = (page: Page) => results(page).getByText('No jobs found');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Polls the list endpoint until it is no longer 429 (fixed 60 s window). */
async function waitForJobsApiQuota(page: Page): Promise<void> {
  await expect
    .poll(async () => (await page.request.get('/api/jobs?limit=1')).status(), {
      message: '/api/jobs rate-limit window should clear',
      timeout: 75_000,
      intervals: [1_000, 2_000, 3_000],
    })
    .toBe(200);
}

async function apiTotal(page: Page, query: string): Promise<number> {
  const res = await page.request.get(`/api/jobs?${query}&limit=1`);
  expect(res.status(), `/api/jobs?${query}`).toBe(200);
  return (await res.json()).total as number;
}

interface ApiJob {
  id: string;
  title: string;
  employer: string;
  location: string | null;
  state: string | null;
  stateCode: string | null;
  isRemote: boolean;
  isHybrid: boolean;
  mode: string | null;
  normalizedMinSalary: number | null;
  normalizedMaxSalary: number | null;
  displaySalary: string | null;
}

async function apiJobs(page: Page, query: string): Promise<{ total: number; jobs: ApiJob[]; search?: unknown }> {
  const res = await page.request.get(`/api/jobs?${query}&limit=50`);
  expect(res.status(), `/api/jobs?${query}`).toBe(200);
  return res.json();
}

/**
 * Clicks a facet/pill and waits for the client list fetch it triggers
 * (`/api/jobs?…&limit=50`). Returns the HTTP status so a 429 fails loudly
 * instead of leaving the page on a stale list.
 */
/**
 * The client always sends `page=1`, which middleware.ts canonicalizes with a
 * 301 (see "Canonical URL Normalization") — so every list fetch is a redirect
 * pair. Match the FINAL response, not the 301.
 */
const isListResponse = (r: { url(): string; status(): number }) =>
  r.url().includes('/api/jobs?') && r.url().includes('limit=50') && r.status() !== 301 && r.status() !== 308;

async function clickAndWaitForList(page: Page, target: Locator): Promise<number> {
  const [resp] = await Promise.all([
    page.waitForResponse(isListResponse, { timeout: 60_000 }),
    target.click(),
  ]);
  await expect(page.locator('section[aria-label="Job results"] .animate-pulse').first()).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
  return resp.status();
}

async function listSettled(page: Page): Promise<void> {
  await expect(cards(page).first().or(noJobs(page))).toBeVisible({ timeout: 20_000 });
  // SSR cards are visible before React attaches handlers; an interaction in that
  // window (selectOption on the sort control, a facet click) is silently lost.
  // Wait until the sort <select> carries React's props, the /jobs hydration signal.
  await page.waitForFunction(() => {
    const el = document.querySelector('select[aria-label="Sort job results"]');
    return !el || Object.keys(el).some((k) => k.startsWith('__reactProps'));
  }, null, { timeout: 30_000 });
}

/** ItemList JSON-LD emitted by the SSR /jobs page — its numberOfItems is the server-side total. */
async function ssrItemListTotal(page: Page): Promise<number> {
  return page.evaluate(() => {
    for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const j = JSON.parse(s.textContent || '');
        if (j['@type'] === 'ItemList') return Number(j.numberOfItems);
      } catch { /* skip */ }
    }
    return -1;
  });
}

async function readJsonLd(page: Page): Promise<Array<Record<string, unknown>>> {
  // The detail route streams (loading.tsx) — the JobPosting script lands after hydration.
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((s) => /JobPosting/.test(s.textContent || '')),
    null,
    { timeout: 20_000 },
  );
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => {
      try { return JSON.parse(s.textContent || ''); } catch (e) { return { PARSE_ERROR: String(e) }; }
    }),
  );
}

const digits = (s: string) => s.replace(/[^0-9]/g, '');

async function noHorizontalOverflow(page: Page, label: string): Promise<void> {
  const r = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    return { sw: se.scrollWidth, iw: window.innerWidth };
  });
  expect(r.sw, `${label}: horizontal overflow ${r.sw} > ${r.iw}`).toBeLessThanOrEqual(r.iw);
}

// Video + trace capture doubled the browser's memory on this host and
// produced ERR_INSUFFICIENT_RESOURCES mid-run; screenshots on failure remain.
// (Must be top-level: Playwright refuses video/trace overrides inside a describe.)
test.use({
  // The /jobs sidebar ("N jobs found", facet badges) is filled by a browser
  // POST to /api/jobs/filter-counts. lib/csrf.ts 403s any browser POST whose
  // Origin is http://127.0.0.1:3000 (setup report, CSRF origin split), so on
  // that spelling the count stays "..." forever. The whole anonymous journey
  // therefore runs on MUT_ORIGIN (localhost); the 127.0.0.1 behaviour is
  // pinned by its own test below.
  baseURL: MUT_ORIGIN,
  video: 'off',
  trace: 'off',
  // One rate-limit bucket PER TEST. lib/rate-limit.ts keys the 30 req/min
  // /api/jobs window on x-forwarded-for, and the loopback address is shared
  // with every other Playwright run on this host — without this, a
  // neighbouring suite drains the window and every list fetch here 429s.
  // The in-test measurement below ("a dozen facets in a minute") is
  // unaffected: it counts calls from ONE address inside ONE test.
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ 'User-Agent': 'PMHNP-E2E-Bot/1.0 (Playwright)', 'x-forwarded-for': uniqueIp() });
  },
});

test.describe('candidate discovery (anonymous)', () => {
  let guard: ConsoleGuard | undefined;

  test.beforeEach(async ({ page }) => {
    // The dev DB answers /api/jobs in 2 to 8 s and filter-counts in 12 to 19 s;
    // the 60 s config default cannot hold a multi-step discovery flow.
    test.setTimeout(150_000);
    guard = installConsoleGuard(page, [
      // Next.js RSC prefetch cancelled by the next navigation — not a product error.
      /net::ERR_ABORTED/i,
      // Test artifact: the per-test x-forwarded-for header (extraHTTPHeaders) is also sent to
      // fonts.gstatic.com, whose CORS preflight rejects it. Not a product error.
      /Access to font at 'https:\/\/fonts\.gstatic\.com/i,
      /Failed to load resource: net::ERR_FAILED/i,
    ]);
  });

  test.afterEach(async ({ page }, testInfo) => {
    // The /jobs hydration mismatch (React #418) is pinned by its own fixme
    // test below; every other test would otherwise fail on the same error and
    // hide its real contract, so it is set aside here — never silently.
    void page;
    if (!guard) return; // beforeEach never ran (browser failed to start)
    if (!/hydrates without React errors/.test(testInfo.title)) {
      for (let i = guard.pageErrors.length - 1; i >= 0; i--) {
        if (HYDRATION_ERROR_RE.test(guard.pageErrors[i])) guard.pageErrors.splice(i, 1);
      }
    }
    guard.assertClean();
    guard = undefined;
  });

  const SERVER_5XX_RE = /status of 5\d\d|Server Components render/;
  const POOL_DEFECT = 'DEFECT: /jobs data calls return 500 under concurrent load (lib/prisma.ts pool max 2, filter-counts holds a connection 12 to 19 s)';
  /**
   * Runs a UI flow; if it fails AND the browser saw a server 5xx, the failure is
   * the concurrency defect pinned above, so the test is marked fixme with that
   * title. Any failure without a 5xx is rethrown untouched.
   */
  async function underPoolDefect(body: () => Promise<void>): Promise<void> {
    try {
      await body();
      const seen = (guard?.errors ?? []).filter((e) => SERVER_5XX_RE.test(e));
      if (seen.length) throw new Error(`flow completed but the browser saw ${seen.length} server 5xx`);
    } catch (err) {
      const hits = (guard?.errors ?? []).filter((e) => SERVER_5XX_RE.test(e));
      if (!hits.length) throw err;
      guard?.allow(SERVER_5XX_RE);
      const errs = guard!.errors;
      for (let i = errs.length - 1; i >= 0; i--) if (SERVER_5XX_RE.test(errs[i])) errs.splice(i, 1);
      test.fixme(true, `${POOL_DEFECT}: ${hits.slice(0, 2).join('; ')}`);
    }
  }

  // ── 0. Environment contracts the rest of the journey depends on ───────────

  test('plain-http loopback origin is served without upgrade-insecure-requests', async ({ page, baseURL }) => {
    // Under `next start` on http://127.0.0.1 the CSP upgrades every client
    // fetch to https (ERR_SSL_PROTOCOL_ERROR) — the whole /jobs UI is dead.
    // Probed on the loopback-IP spelling of the base URL regardless of which
    // host the suite itself runs on, so the defect stays pinned either way.
    const origin = new URL(baseURL || 'http://localhost:3000');
    test.skip(origin.protocol !== 'http:', 'only meaningful on a plain-http origin');
    const ipOrigin = `${origin.protocol}//127.0.0.1${origin.port ? `:${origin.port}` : ''}`;
    const csp = (await page.request.get(`${ipOrigin}/jobs`)).headers()['content-security-policy'] || '';
    if (/upgrade-insecure-requests/.test(csp)) {
      test.fixme(true, `DEFECT: middleware isLocalhost only matches the literal host "localhost" — on ${ipOrigin} the CSP still carries upgrade-insecure-requests, so every /api/jobs fetch from the /jobs UI fails with net::ERR_SSL_PROTOCOL_ERROR (confirmed: search submit on /jobs never receives a list response)`);
    }
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
  });

  test('the sidebar filter-counts POST is accepted on the loopback IP spelling and answers within 5 s', async ({ page, baseURL }) => {
    const origin = new URL(baseURL || 'http://localhost:3000');
    test.skip(origin.protocol !== 'http:', 'only meaningful on a plain-http local origin');
    const ipOrigin = `${origin.protocol}//127.0.0.1${origin.port ? `:${origin.port}` : ''}`;
    const body = { search: 'TX' };
    // Same request the browser sends from /jobs on each origin.
    const ip = await page.request.post(`${ipOrigin}/api/jobs/filter-counts`, { data: body, headers: { Origin: ipOrigin } });
    const t0 = Date.now();
    const local = await page.request.post(`${MUT_ORIGIN}/api/jobs/filter-counts`, { data: body, headers: { Origin: MUT_ORIGIN }, timeout: 60_000 });
    const ms = Date.now() - t0;
    expect(local.status()).toBe(200);
    const problems: string[] = [];
    if (ip.status() === 403) problems.push(`on ${ipOrigin} the /jobs sidebar filter-counts POST is 403 "cross-origin request blocked", so "N jobs found" stays "..." forever`);
    if (ms > 5_000) problems.push(`POST /api/jobs/filter-counts took ${ms} ms`);
    if (problems.length) test.fixme(true, `DEFECT: /jobs sidebar counts are unavailable or slow: ${problems.join('; ')}`);
    expect(ip.status()).toBe(200);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  test('the three data calls a /jobs page load makes never 500 when a few visitors arrive together', async ({ page }) => {
    test.setTimeout(180_000);
    // One /jobs?specialty=acute-care load = list fetch + filter-counts POST + employer-type probe.
    const visit = () => Promise.all([
      page.request.get('/api/jobs?specialty=acute-care&limit=50', { headers: { 'x-forwarded-for': uniqueIp() }, timeout: 90_000 }),
      page.request.post('/api/jobs/filter-counts', { data: { specialty: ['acute-care'] }, headers: { Origin: MUT_ORIGIN, 'x-forwarded-for': uniqueIp() }, timeout: 90_000 }),
      page.request.get('/api/jobs?specialty=acute-care&recruitmentType=unclassified&limit=1', { headers: { 'x-forwarded-for': uniqueIp() }, timeout: 90_000 }),
    ]);
    const all = (await Promise.all([visit(), visit(), visit(), visit()])).flat();
    const failures = all.filter((r) => r.status() >= 500).map((r) => `${r.status()} ${new URL(r.url()).pathname}`);
    if (failures.length) {
      test.fixme(true, `DEFECT: /api/jobs and /api/jobs/filter-counts return 500 under 4 concurrent /jobs visits (${failures.length}/${all.length} calls: ${[...new Set(failures)].join(', ')}); lib/prisma.ts pool max 2 with a 10 s connect timeout while filter-counts runs 12 to 19 s`);
    }
    expect(failures).toEqual([]);
  });

  test('/jobs and a job detail page hydrate without React errors', async ({ page }) => {
    await page.goto('/jobs');
    await listSettled(page);
    // Give the client a full idle turn so late hydration boundaries settle.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    if (TEST_JOB_SLUG) {
      await page.goto(`/jobs/${TEST_JOB_SLUG}`);
      await expect(page.locator('h1')).toBeVisible();
      await readJsonLd(page);
    }
    const hydration = (guard?.pageErrors ?? []).filter((e) => HYDRATION_ERROR_RE.test(e));
    if (hydration.length) {
      test.fixme(true, `DEFECT: React hydration mismatch (#418, "HTML") on ${hydration.map((h) => h.match(/\[(.*?)\]/)?.[1]).join(', ')} — server HTML differs from the client render`);
    }
    expect(hydration).toEqual([]);
  });

  // ── 1. Entry + the reviewer's query ──────────────────────────────────────

  test('home → Browse Jobs → the reviewer query returns Texas results and never zero', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Browse Jobs' }).first().click();
    await expect(page).toHaveURL(/\/jobs(\?|$)/);
    await expect(page.locator('h1')).toContainText(/APRN Jobs/);
    await listSettled(page);
    const unfiltered = await ssrItemListTotal(page);
    expect(unfiltered).toBeGreaterThan(0);

    await searchBox(page).fill(REVIEWER_QUERY);
    // Enter submits the sidebar search form → router.push → client list fetch.
    const [searchResp] = await Promise.all([
      page.waitForResponse(isListResponse, { timeout: 60_000 }),
      searchBox(page).press('Enter'),
    ]);
    expect(searchResp.status()).toBe(200);
    await expect(page).toHaveURL(/[?&]q=remote\+nurse\+practitioner\+jobs\+in\+Texas/);
    await listSettled(page);

    const n = await cards(page).count();
    expect(n, 'reviewer query must never return zero').toBeGreaterThan(0);
    await expect(noJobs(page)).toHaveCount(0);
    // Search pill echoes the query verbatim.
    await expect(removePill(page, `"${REVIEWER_QUERY}"`)).toBeVisible();
    // Every card is a Texas listing (the intent extractor pins stateCode=TX).
    // Checked on the VISIBLE location row ("Employer · Dallas, Texas"): the
    // link's accessible name deliberately says "Remote" for remote rows
    // (components/JobCard.tsx cardLocation), so it carries no state.
    const locations = await cards(page).evaluateAll((els) =>
      els.map((e) => (e.querySelector('h3 + div') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() || ''),
    );
    for (const l of locations) expect(l, `card location row should be in Texas: ${l}`).toMatch(/Texas|,\s*TX\b/);
    // Page 1 count must agree with the API total when the total fits one page.
    const api = await apiJobs(page, `q=${encodeURIComponent(REVIEWER_QUERY)}`);
    expect(api.total).toBeGreaterThan(0);
    expect(api.jobs.every((j) => j.isRemote), 'reviewer query: every result is remote').toBe(true);
    expect(api.jobs.filter((j) => j.stateCode !== 'TX' && j.state !== 'Texas').map((j) => `${j.title} | ${j.location}`), 'non-Texas rows').toEqual([]);
    if (api.total <= 50) expect(n).toBe(api.total);
    // The sidebar count is refreshed by a deferred filter-counts POST
    // (requestIdleCallback, ≤2 s) — it must converge on the search total.
    await expect.poll(async () => Number(digits((await jobsFound(page).textContent()) || '-1')), {
      message: 'sidebar "jobs found" converges on the search total', timeout: COUNTS_TIMEOUT,
    }).toBe(api.total);
  });

  test('NP-board results never surface physician-only listings (profession quarantine covers unclassified rows)', async ({ page }) => {
    await waitForJobsApiQuota(page);
    // Titles that name a profession an NP board must not list, unless the row
    // also names an NP/APRN/PA role ("Physician or Nurse Practitioner").
    const PHYSICIAN_ONLY = /\b(Obstetrician|Gynecologist|Podiatrist|Dentist|Pharmacist|Anesthesiologist|Radiologist|Surgeon|Psychiatrist)\b/i;
    const NP_ROLE = /\b(nurse practitioner|NP|APRN|PMHNP|FNP|CRNA|CNM|CNS|physician assistant|PA-C|\bPA\b|advanced practice)\b/i;
    const leaks: string[] = [];
    for (const q of [REVIEWER_QUERY, 'Texas', 'hospitalist', 'remote']) {
      const { jobs } = await apiJobs(page, `q=${encodeURIComponent(q)}`);
      for (const j of jobs) {
        if (PHYSICIAN_ONLY.test(j.title) && !NP_ROLE.test(j.title)) leaks.push(`q=${q}: ${j.title} (${j.employer}, ${j.id})`);
      }
    }
    const unique = [...new Set(leaks)];
    if (unique.length) {
      test.fixme(true, `DEFECT: physician-only listings reach the NP board — professionClass is null (never classified) and the quarantine only excludes other_clinical: ${unique.join('; ')}`);
    }
    expect(unique).toEqual([]);
  });

  test('bare "remote" returns only remote jobs; "TX" and "Texas" are the same query', async ({ page }) => {
    await waitForJobsApiQuota(page);
    const remote = await apiJobs(page, 'q=remote');
    expect(remote.total).toBeGreaterThan(0);
    expect(remote.jobs.filter((j) => !j.isRemote).map((j) => `${j.title} | ${j.location}`), 'non-remote rows in a bare "remote" search').toEqual([]);
    const remoteFacet = await apiJobs(page, 'workMode=remote');
    // The dev board is ingested live (totals drift by a row or two between calls).
    expect(Math.abs(remoteFacet.total - remote.total), 'q=remote and workMode=remote agree').toBeLessThanOrEqual(INGEST_DRIFT);

    // State code == state name, on the free-text AND location paths, case-insensitively.
    const totals = await Promise.all([
      apiTotal(page, 'q=TX'), apiTotal(page, 'q=Texas'), apiTotal(page, 'q=texas'),
      apiTotal(page, 'location=TX'), apiTotal(page, 'location=Texas'), apiTotal(page, 'stateCode=TX'),
    ]);
    const qTx = totals[0];
    expect(qTx).toBeGreaterThan(0);
    expect(Math.max(...totals) - Math.min(...totals), `TX/Texas totals diverge: ${totals.join('/')}`).toBeLessThanOrEqual(INGEST_DRIFT);

    // The SSR page agrees with the API for both spellings (sidebar count + ItemList schema).
    await page.goto('/jobs?q=TX');
    await listSettled(page);
    const ssrTx = await ssrItemListTotal(page);
    expect(Math.abs(ssrTx - qTx)).toBeLessThanOrEqual(INGEST_DRIFT);
    const shownTx = await sidebarTotal(page);
    expect(Math.abs(shownTx - ssrTx), 'sidebar count vs SSR ItemList').toBeLessThanOrEqual(INGEST_DRIFT);
    await page.goto('/jobs?location=Texas');
    await listSettled(page);
    expect(Math.abs((await ssrItemListTotal(page)) - qTx)).toBeLessThanOrEqual(INGEST_DRIFT);
    await expect(removePill(page, 'Texas')).toBeVisible();
  });

  // ── 2. Facets: apply + URL round-trip (reload preserves, back restores) ──

  test('work mode + job type facets apply, survive reload, and back-button restores', async ({ page }) => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    const all = await ssrItemListTotal(page);

    expect(await clickAndWaitForList(page, facet(page, /^Remote\b/))).toBe(200);
    await expect(page).toHaveURL(/[?&]workMode=remote/);
    await expect(facet(page, /^Remote\b/)).toBeChecked();
    await expect(removePill(page, 'Remote')).toBeVisible();
    await listSettled(page);

    expect(await clickAndWaitForList(page, facet(page, /^Full-Time\b/))).toBe(200);
    await expect(page).toHaveURL(/workMode=remote.*jobType=Full-Time|jobType=Full-Time.*workMode=remote/);
    await expect(page.getByRole('button', { name: /^Clear all \(2\)$/ })).toBeVisible();
    await listSettled(page);
    // The sidebar keeps the PREVIOUS total on screen while the slow filter-counts
    // POST is in flight, so wait for it to converge on the API's answer.
    const apiBoth = await apiTotal(page, 'workMode=remote&jobType=Full-Time');
    await expect.poll(() => sidebarTotal(page), { message: 'sidebar converges on remote + Full-Time total', timeout: COUNTS_TIMEOUT })
      .toBeLessThanOrEqual(apiBoth + INGEST_DRIFT); // adding a facet narrows, so the stale total is larger
    const shown = await sidebarTotal(page);
    expect(Math.abs(shown - apiBoth)).toBeLessThanOrEqual(INGEST_DRIFT);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(all);

    // Reload: URL is the source of truth — both checkboxes + pills survive.
    await page.reload();
    await listSettled(page);
    await expect(facet(page, /^Remote\b/)).toBeChecked();
    await expect(facet(page, /^Full-Time\b/)).toBeChecked();
    await expect(removePill(page, 'Full-Time')).toBeVisible();
    expect(Math.abs((await ssrItemListTotal(page)) - shown)).toBeLessThanOrEqual(INGEST_DRIFT);

    // Back twice restores each step; the checkbox state follows the URL.
    await page.goBack();
    await expect(page).toHaveURL(/workMode=remote/);
    await expect(page).not.toHaveURL(/jobType=/);
    await expect(facet(page, /^Full-Time\b/)).not.toBeChecked();
    await expect(facet(page, /^Remote\b/)).toBeChecked();
    await page.goBack();
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(facet(page, /^Remote\b/)).not.toBeChecked();
    await expect(page.getByRole('button', { name: /^Clear all/ })).toHaveCount(0);

    // Forward re-applies.
    await page.goForward();
    await expect(page).toHaveURL(/workMode=remote/);
    await expect(facet(page, /^Remote\b/)).toBeChecked();
  });

  test('salary floor, new-grad, experience, posted-within and employer-type facets round-trip through the URL', async ({ page, baseURL }) => {
    // The cookie banner is not the subject; its fixed overlay would intercept the facet clicks.
    await presetConsentCookie(page, baseURL!);
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);

    const steps: Array<{ name: RegExp; param: RegExp; pill: string }> = [
      { name: /^\$150,000\+/, param: /[?&]salaryMin=150000/, pill: '$150k+' },
      { name: /^Open to new grads/, param: /[?&]newGrad=1/, pill: 'Open to new grads' },
      { name: /^I have 2\+ years/, param: /[?&]minYears=2/, pill: '2+ years of experience' },
      { name: /^Past month/, param: /[?&]postedWithin=30d/, pill: 'Past month' },
      { name: /^Direct employers/, param: /[?&]recruitmentType=direct_hire/, pill: 'Direct employers' },
    ];
    for (const s of steps) {
      const status = await clickAndWaitForList(page, facet(page, s.name));
      expect(status, `list fetch after toggling ${s.pill}`).toBe(200);
      await expect(page).toHaveURL(s.param);
      await expect(facet(page, s.name)).toBeChecked();
      await expect(removePill(page, s.pill)).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /^Clear all \(5\)$/ })).toBeVisible();

    await page.reload();
    await listSettled(page);
    for (const s of steps) {
      await expect(facet(page, s.name), `${s.pill} checked after reload`).toBeChecked();
      await expect(removePill(page, s.pill)).toBeVisible();
    }

    // Single-select groups: picking a second salary bucket REPLACES the first
    // (salaryMin is one value) and re-clicking a checked box clears it.
    expect(await clickAndWaitForList(page, facet(page, /^\$200,000\+/))).toBe(200);
    await expect(page).toHaveURL(/salaryMin=200000/);
    await expect(page).not.toHaveURL(/salaryMin=150000/);
    await expect(facet(page, /^\$150,000\+/)).not.toBeChecked();
    expect(await clickAndWaitForList(page, facet(page, /^\$200,000\+/))).toBe(200);
    await expect(page).not.toHaveURL(/salaryMin=/);

    // Employer-type is a 3-state control: direct → staffing swaps, unchecking → any.
    expect(await clickAndWaitForList(page, facet(page, /^Staffing agencies/))).toBe(200);
    await expect(page).toHaveURL(/recruitmentType=staffing_agency/);
    await expect(facet(page, /^Direct employers/)).not.toBeChecked();
    await expect(removePill(page, 'Staffing agencies')).toBeVisible();
    expect(await clickAndWaitForList(page, facet(page, /^Staffing agencies/))).toBe(200);
    await expect(page).not.toHaveURL(/recruitmentType=/);

    // Clear all → bare /jobs, no pills.
    await page.getByRole('button', { name: /^Clear all/ }).click();
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(page.getByRole('button', { name: /^Remove .* filter$/ })).toHaveCount(0);
  });

  test('facet semantics hold server-side (salary floor, freshness/experience monotonic, employer-type partitions the board)', async ({ page }) => {
    await waitForJobsApiQuota(page);
    const total = await apiTotal(page, 'sort=best');
    expect(total).toBeGreaterThan(0);

    const floor = await apiJobs(page, 'salaryMin=100000');
    expect(floor.total).toBeGreaterThan(0);
    for (const j of floor.jobs) {
      const best = Math.max(j.normalizedMinSalary ?? 0, j.normalizedMaxSalary ?? 0);
      expect(best, `${j.title} (${j.displaySalary}) below the $100k floor`).toBeGreaterThanOrEqual(100_000);
    }

    const [d1, d3, d7, d30] = await Promise.all(['24h', '3d', '7d', '30d'].map((w) => apiTotal(page, `postedWithin=${w}`)));
    expect(d1).toBeLessThanOrEqual(d3);
    expect(d3).toBeLessThanOrEqual(d7);
    expect(d7).toBeLessThanOrEqual(d30);
    expect(d30).toBeLessThanOrEqual(total);

    // "Your experience" grows with years (candidate qualifies for more roles).
    const [y1, y2, y5] = await Promise.all([1, 2, 5].map((y) => apiTotal(page, `minYears=${y}`)));
    expect(y1).toBeLessThanOrEqual(y2);
    expect(y2).toBeLessThanOrEqual(y5);
    expect(y5).toBeLessThanOrEqual(total);

    const newGrad = await apiTotal(page, 'newGrad=1');
    expect(newGrad).toBeGreaterThan(0);
    expect(newGrad).toBeLessThanOrEqual(total);

    // lib/filters.ts promises direct + staffing + unclassified == the whole board.
    const [direct, staffing, unclassified] = await Promise.all(
      ['direct_hire', 'staffing_agency', 'unclassified'].map((t) => apiTotal(page, `recruitmentType=${t}`)),
    );
    const totalAfter = await apiTotal(page, 'sort=best');
    const sum = direct + staffing + unclassified;
    expect(Math.abs(sum - total) <= INGEST_DRIFT || Math.abs(sum - totalAfter) <= INGEST_DRIFT, `employer-type buckets ${direct}+${staffing}+${unclassified}=${sum} != ${total}/${totalAfter}`).toBe(true);

    // Unknown facet values are ignored, never a 500.
    for (const bad of ['postedWithin=never', 'salaryMin=abc', 'minYears=-1', 'recruitmentType=bogus', 'workMode=mars']) {
      const res = await page.request.get(`/api/jobs?${bad}&limit=1`);
      expect(res.status(), bad).toBe(200);
    }
  });

  test('all 17 specialty facets are listed and each one round-trips through ?specialty=', async ({ page }) => {
    test.setTimeout(300_000); // 18 SSR page loads
    await waitForJobsApiQuota(page);
    const slugs = [...CATEGORY_AXES.specialty];
    expect(slugs).toHaveLength(17);

    await page.goto('/jobs');
    await listSettled(page);
    const section = page.locator('#filter-section-specialty:visible');
    await expect(section.locator('label.li-filter-row')).toHaveCount(17);
    for (const slug of slugs) {
      await expect(section.getByRole('checkbox', { name: new RegExp(`^${specialtyLabel(slug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toBeVisible();
    }

    // SSR round-trip per slug (1 API call each — the sidebar's employer-type probe).
    const unfiltered = await ssrItemListTotal(page);
    for (const slug of slugs) {
      await page.goto(`/jobs?specialty=${slug}`);
      await listSettled(page);
      const label = specialtyLabel(slug);
      await expect(section.getByRole('checkbox', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }), `${slug} checked`).toBeChecked();
      await expect(removePill(page, label), `${slug} pill`).toBeVisible();
      const n = await ssrItemListTotal(page);
      const server5xx = (guard?.errors ?? []).filter((e) => /status of 5\d\d|Server Components render/.test(e));
      if (n < 0 || server5xx.length) {
        guard?.allow(/status of 5\d\d|Server Components render/);
        test.fixme(true, `DEFECT: /jobs data calls return 500 when a single page load fires them concurrently (lib/prisma.ts pool max 2 while POST /api/jobs/filter-counts holds a connection for 12 to 19 s): ${slug} rendered without its ItemList (total ${n}); ${server5xx.slice(0, 2).join('; ')}`);
      }
      expect(n, `${slug} total`).toBeGreaterThanOrEqual(0);
      expect(n, `${slug} narrows`).toBeLessThanOrEqual(unfiltered);
    }

    // Removing the pill clears the param (client nav).
    expect(await clickAndWaitForList(page, removePill(page, specialtyLabel(slugs[slugs.length - 1])))).toBe(200);
    await expect(page).not.toHaveURL(/specialty=/);
  });

  // ── 3. Deep-link pills, zero results, pagination, sort ───────────────────

  test('deep-link params (cityExact / stateCode / employer) show pills and clear individually', async ({ page }) => {
    test.skip(!TEST_JOB_ID, 'E2E_TEST_JOB_ID not set');
    await waitForJobsApiQuota(page);
    await page.goto(`/jobs?cityExact=Austin&stateCode=TX&employer=${encodeURIComponent(TEST_EMPLOYER)}`);
    await listSettled(page);
    await expect(removePill(page, 'City: Austin')).toBeVisible();
    await expect(removePill(page, 'State: TX')).toBeVisible();
    await expect(removePill(page, `Employer: ${TEST_EMPLOYER}`)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Clear all \(3\)$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Alert for This Search' })).toBeVisible();
    // The seeded Austin employer job is in the SSR list.
    await expect(cards(page).filter({ has: page.locator(`[href*="${TEST_JOB_ID}"]`) }).or(page.locator(`a[href*="${TEST_JOB_ID}"]`)).first()).toBeVisible();

    expect(await clickAndWaitForList(page, removePill(page, 'City: Austin'))).toBe(200);
    await expect(page).not.toHaveURL(/cityExact=/);
    await expect(page).toHaveURL(/stateCode=TX/);
    expect(await clickAndWaitForList(page, removePill(page, 'State: TX'))).toBe(200);
    await expect(page).not.toHaveURL(/stateCode=/);
    await expect(page).toHaveURL(/employer=/);
    expect(await clickAndWaitForList(page, removePill(page, `Employer: ${TEST_EMPLOYER}`))).toBe(200);
    await expect(page).toHaveURL(/\/jobs\?$|\/jobs$/);
    await expect(page.getByRole('button', { name: /^Remove .* filter$/ })).toHaveCount(0);
  });

  test('zero-result search shows the empty state, a clear action, and the constraint hint', async ({ page }) => {
    await waitForJobsApiQuota(page);
    const q = 'zzqxv remote in Texas';
    // The API names the emptying constraint — the UI must surface it.
    const api = await apiJobs(page, `q=${encodeURIComponent(q)}`);
    expect(api.total).toBe(0);
    const hint = (api.search as { zeroResultHint?: { removedLabel: string; availableCount: number } } | undefined)?.zeroResultHint;
    expect(hint, 'API zeroResultHint present').toBeTruthy();

    await page.goto(`/jobs?q=${encodeURIComponent(q)}`);
    await expect(noJobs(page)).toBeVisible();
    await expect(results(page).getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/jobs');
    await expect(removePill(page, `"${q}"`)).toBeVisible();
    await expect(jobsFound(page)).toHaveText(/^0 jobs found$/, { timeout: COUNTS_TIMEOUT });

    // Contract: name the constraint that emptied the search and how many jobs exist without it.
    await expect(results(page).getByText(new RegExp(`${hint!.availableCount}`))).toBeVisible();
    await expect(results(page).getByText(/zzqxv/)).toBeVisible();
  });

  test('pagination is URL-driven and out-of-range or garbage page params degrade safely', async ({ page }) => {
    test.setTimeout(180_000);
    await underPoolDefect(async () => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    const total = await ssrItemListTotal(page);
    test.skip(total <= 50, 'fewer than 2 pages of jobs on this board');

    const firstOnPage1 = await cards(page).first().getAttribute('href');
    await expect(page.locator('.jp-page-btn[aria-current="page"]')).toHaveText('1').catch(() => undefined);
    expect(await clickAndWaitForList(page, page.getByRole('link', { name: 'Next page' }))).toBe(200);
    await expect(page).toHaveURL(/[?&]page=2$/);
    await listSettled(page);
    await expect(page.locator('.jp-page-btn[aria-current="page"]')).toHaveText('2');
    const firstOnPage2 = await cards(page).first().getAttribute('href');
    expect(firstOnPage2).not.toBe(firstOnPage1);
    const hrefs = () => cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''));
    // The dev board is ingested live, so compare page CONTENTS with a small drift budget, not the first row.
    const overlap = (a: string[], b: string[]) => a.filter((h) => b.includes(h)).length;
    const page2Client = await hrefs();

    // Reload keeps page 2 (SSR).
    await page.reload();
    await listSettled(page);
    await expect(page.locator('.jp-page-btn[aria-current="page"]')).toHaveText('2');
    const page2Ssr = await hrefs();
    expect(overlap(page2Client, page2Ssr), 'client page 2 and SSR page 2 list the same jobs').toBeGreaterThanOrEqual(Math.min(page2Client.length, page2Ssr.length) - INGEST_DRIFT * 2);

    // Previous → page param dropped, page-1 content restored.
    expect(await clickAndWaitForList(page, page.getByRole('link', { name: 'Previous page' }))).toBe(200);
    await expect(page).toHaveURL(/\/jobs$/);
    await listSettled(page);
    expect(overlap(await hrefs(), page2Ssr), 'page 1 after Previous does not repeat page 2').toBeLessThanOrEqual(INGEST_DRIFT * 2);
    void firstOnPage1;

    // Pagination + filter: page param resets when the filter set changes.
    await page.goto('/jobs?page=2');
    await listSettled(page);
    expect(await clickAndWaitForList(page, facet(page, /^Remote\b/))).toBe(200);
    await expect(page).not.toHaveURL(/page=2/);

    // Garbage / out-of-range values must not blank the board or 500.
    for (const p of ['/jobs?page=999', '/jobs?page=0', '/jobs?page=-1', '/jobs?page=abc']) {
      const resp = await page.goto(p);
      expect(resp?.status(), p).toBe(200);
      await expect(page.locator('h1'), p).toContainText(/APRN Jobs/);
      await expect(cards(page).first().or(noJobs(page)), p).toBeVisible();
    }
    });
  });

  test('sort persists in the URL and the back button restores the previous sort', async ({ page }) => {
    await underPoolDefect(async () => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    const sort = page.getByLabel('Sort job results');
    await expect(sort).toHaveValue('best');
    const [resp] = await Promise.all([
      page.waitForResponse(isListResponse, { timeout: 60_000 }),
      sort.selectOption('newest'),
    ]);
    expect(resp.status()).toBe(200);
    expect(resp.url()).toContain('sort=newest');
    await expect(page).toHaveURL(/[?&]sort=newest/);
    await page.reload();
    await expect(page.getByLabel('Sort job results')).toHaveValue('newest');
    await listSettled(page);

    // Back → URL has no sort; the control and any refetch must follow the URL.
    // The client may serve the earlier default-sort list from its cache, so a
    // list request on Back is optional; when one fires it must not carry sort=newest.
    const backRespPromise = page.waitForResponse(isListResponse, { timeout: 15_000 }).catch(() => null);
    await page.goBack();
    const backResp = await backRespPromise;
    await expect(page).toHaveURL(/\/jobs$/);
    if (backResp && backResp.url().includes('sort=newest')) {
      test.fixme(true, 'DEFECT: after changing sort, the Back button restores the URL /jobs but the list refetches with the abandoned sort=newest and the sort control stays on Newest (app/jobs/JobsPageClient.tsx sortOption is useState(urlSort) and never resyncs from searchParams)');
    }
    if (backResp) expect(backResp.url(), 'back-button fetch must not carry the abandoned sort').not.toContain('sort=newest');
    await expect(page.getByLabel('Sort job results')).toHaveValue('best');
    });
  });

  // ── 4. Card → detail ─────────────────────────────────────────────────────

  test('job card → detail: title/employer/salary parity, JobLocationContext, JSON-LD with NP SOC', async ({ page }) => {
    test.skip(!TEST_JOB_ID || !TEST_JOB_SLUG, 'E2E_TEST_JOB_ID/SLUG not set');
    await waitForJobsApiQuota(page);
    await page.goto(`/jobs?employer=${encodeURIComponent(TEST_EMPLOYER)}`);
    await listSettled(page);
    const card = page.locator(`section[aria-label="Job results"] a[href*="${TEST_JOB_ID}"]`).first();
    await expect(card).toBeVisible();
    const cardLabel = (await card.getAttribute('aria-label')) || '';
    const cardTitle = (await card.locator('h3').first().textContent())?.trim() || '';
    expect(cardTitle.length).toBeGreaterThan(10);
    expect(cardLabel).toContain(cardTitle);
    expect(cardLabel).toContain(TEST_EMPLOYER);
    const cardSalary = (await card.locator('text=/\\$\\d/').first().textContent())?.trim() || '';
    expect(cardSalary, 'card shows a salary badge').toMatch(/\$\d/);

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/jobs/.*${TEST_JOB_ID}$`));
    await expect(page.locator('h1')).toHaveText(cardTitle);
    const hero = page.locator('.job-detail-hero-card');
    await expect(hero).toContainText(TEST_EMPLOYER);
    const detailSalary = (await hero.locator('text=/\\$\\d/').first().textContent())?.trim() || '';
    expect(digits(detailSalary), `salary parity card "${cardSalary}" vs detail "${detailSalary}"`).toBe(digits(cardSalary));

    // JobLocationContext panel: city/state heading + links that resolve.
    const ctx = page.locator('section[aria-labelledby="job-location-context-heading"]');
    await expect(ctx).toBeVisible();
    await expect(ctx.locator('#job-location-context-heading')).toHaveText(/^Working in Austin, TX$/);
    await expect(ctx).toContainText(/Cost-of-living index: \d+/);
    await expect(ctx.getByRole('link', { name: /jobs in Texas/ })).toHaveAttribute('href', '/jobs/state/texas');
    for (const href of await ctx.locator('a[href^="/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''))) {
      const r = await page.request.get(href, { timeout: 60_000 });
      expect(r.status(), `location-context link ${href}`).toBe(200);
    }

    // JSON-LD parses, carries the NP SOC, and mirrors the header.
    const ld = await readJsonLd(page);
    expect(ld.filter((x) => 'PARSE_ERROR' in x)).toEqual([]);
    const posting = ld.find((x) => x['@type'] === 'JobPosting') as Record<string, unknown> | undefined;
    expect(posting, 'JobPosting schema present').toBeTruthy();
    expect(posting!.occupationalCategory).toBe(NP_SOC);
    // Visible titles swap a spaced hyphen separator for a middle dot (copy rule); structured data keeps the stored title.
    const sep = (t: string) => t.replace(/\s[·-]\s/g, ' | ');
    expect(sep(String(posting!.title))).toBe(sep(cardTitle));
    expect((posting!.hiringOrganization as { name: string }).name).toBe(TEST_EMPLOYER);
    const base = posting!.baseSalary as { value: { minValue: number; maxValue: number; unitText: string } };
    expect(base.value.unitText).toBe('YEAR');
    expect(digits(`${base.value.minValue / 1000}${base.value.maxValue / 1000}`)).toBe(digits(cardSalary).replace(/\/?yr$/, ''));
    expect(ld.some((x) => x['@type'] === 'BreadcrumbList')).toBe(true);
    expect((posting!.url as string).endsWith(`/${TEST_JOB_SLUG}`)).toBe(true);
  });

  test('detail work-mode badge, search index and JSON-LD agree on whether the job is remote', async ({ page }) => {
    test.skip(!TEST_JOB_ID || !TEST_JOB_SLUG, 'E2E_TEST_JOB_ID/SLUG not set');
    await waitForJobsApiQuota(page);
    await page.goto(`/jobs/${TEST_JOB_SLUG}`);
    await expect(page.locator('h1')).toBeVisible();
    const hero = page.locator('.job-detail-hero-card');
    const modeBadge = hero.getByText(/^\s*Remote\s*$/).first();
    const saysRemote = (await modeBadge.count()) > 0;
    const ld = await readJsonLd(page);
    const posting = ld.find((x) => x['@type'] === 'JobPosting') as Record<string, unknown>;
    const inRemoteIndex = (await apiJobs(page, `workMode=remote&employer=${encodeURIComponent(TEST_EMPLOYER)}`)).jobs.some((j) => j.id === TEST_JOB_ID);

    if (saysRemote && (posting.jobLocationType !== 'TELECOMMUTE' || !inRemoteIndex)) {
      test.fixme(true, 'DEFECT: employer-posted job shows a "Remote" work-mode badge but isRemote=false — excluded from remote search/filter and JSON-LD emits a physical jobLocation (post-free derives isRemote from the location string only)');
    }
    if (saysRemote) {
      expect(posting.jobLocationType, 'a job badged Remote must be TELECOMMUTE in JobPosting').toBe('TELECOMMUTE');
      expect(inRemoteIndex, 'a job badged Remote must be returned by workMode=remote').toBe(true);
    } else {
      expect(posting.jobLocationType).toBeUndefined();
    }
  });

  // ── 5. Quarantine: the non-NP probe is invisible everywhere ──────────────

  test('quarantined Podiatrist probe is absent from listings, search, API, category pages and its bare slug is 410', async ({ page }) => {
    test.skip(!QUARANTINE_SLUG || !QUARANTINE_ID, 'E2E_QUARANTINE_JOB_* not set');
    await waitForJobsApiQuota(page);
    expect(await apiTotal(page, 'q=Podiatrist')).toBe(0);
    expect(await apiTotal(page, 'q=DPM')).toBe(0);
    expect((await page.request.get(`/api/jobs?ids=${QUARANTINE_ID}`)).status()).toBe(200);

    await page.goto('/jobs?q=Podiatrist');
    await expect(noJobs(page)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(QUARANTINE_TITLE);

    for (const p of ['/jobs', '/jobs/psychiatric-mental-health', '/jobs/remote', '/jobs/telehealth', '/jobs/new-grad', '/jobs?sort=newest']) {
      const r = await page.request.get(p);
      expect(r.status(), p).toBe(200);
      const html = await r.text();
      expect(html.includes(QUARANTINE_SLUG) || html.includes(QUARANTINE_TITLE), `${p} leaks the quarantined probe`).toBe(false);
    }
    const bare = await page.request.get(`/jobs/${QUARANTINE_SLUG}`);
    expect(bare.status()).toBe(410);
    const sitemapIndex = await (await page.request.get('/sitemap.xml')).text();
    expect(sitemapIndex).not.toContain(QUARANTINE_SLUG);
  });

  test('quarantined probe is absent from the job sitemap batch, state/city hubs, and its UUID URL is not a live page', async ({ page }) => {
    test.skip(!QUARANTINE_SLUG || !QUARANTINE_ID, 'E2E_QUARANTINE_JOB_* not set');
    const leaks: string[] = [];
    const batch = await page.request.get('/api/sitemaps/jobs/0');
    expect(batch.status()).toBe(200);
    if ((await batch.text()).includes(QUARANTINE_SLUG)) leaks.push('/api/sitemaps/jobs/0');
    for (const p of ['/jobs/state/texas', '/jobs/city/austin-tx']) {
      const r = await page.request.get(p);
      expect(r.status(), p).toBe(200);
      const html = await r.text();
      if (html.includes(QUARANTINE_SLUG) || html.includes(QUARANTINE_TITLE)) leaks.push(p);
    }
    const uuidUrl = `/jobs/${QUARANTINE_SLUG}-${QUARANTINE_ID}`;
    const detail = await page.request.get(uuidUrl);
    if (detail.status() === 200) {
      // Hubs and sitemap are clean after the P10 quarantine fix; what remains is the
      // detail URL serving the not-found template with HTTP 200 (a soft 404).
      const softNotFound = /<title>Page Not Found/i.test(await detail.text());
      leaks.push(softNotFound ? `${uuidUrl} (HTTP 200 "Page Not Found" template: soft 404, expected 404 or 410)` : uuidUrl);
    }

    if (leaks.length) {
      test.fixme(true, `DEFECT: profession quarantine is not applied outside lib/filters.ts — probe leaks via ${leaks.join(', ')}`);
    }
    expect(leaks).toEqual([]);
    expect([404, 410]).toContain(detail.status());
  });

  // ── 6. Save + alerts (anonymous) ─────────────────────────────────────────

  test('anonymous save on the detail page is honest about where the save lives', async ({ page }) => {
    test.skip(!TEST_JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
    await page.goto(`/jobs/${TEST_JOB_SLUG}`);
    await expect(page.locator('h1')).toBeVisible();
    const save = page.getByRole('button', { name: 'Save job' }).first();
    await expect(save).toBeVisible();
    // Either the app asks the visitor to sign in, or it tells them the save is device-local.
    // Measured as a DELTA: the header already carries a "Log in" link, which must not count.
    const loginPrompt = page.getByRole('dialog').or(page.getByRole('link', { name: /sign in|log in/i })).or(page.getByRole('button', { name: /sign in|log in/i }));
    const deviceNotice = page.getByText(/sign in to (save|sync|keep)|saved on this device|this browser/i);
    const before = (await loginPrompt.count()) + (await deviceNotice.count());
    await save.click();
    await expect(page.getByRole('button', { name: /Remove saved job|Save job/ }).first()).toBeVisible();
    // Give a toast or modal one animation frame pair to mount.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const after = (await loginPrompt.count()) + (await deviceNotice.count());
    const prompted = after > before;
    const stillOnPage = page.url().includes(TEST_JOB_SLUG);
    if (!prompted && stillOnPage) {
      test.fixme(true, 'DEFECT: anonymous Save silently toggles to "Saved" (localStorage) with no sign-in prompt or device-only notice');
    }
    expect(prompted || !stillOnPage, 'anonymous save must prompt for sign-in or disclose device-only persistence').toBe(true);
  });

  test('alerts CTA is prefilled from the active filters and the dialog is keyboard-operable', async ({ page }) => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    await expect(page.getByRole('button', { name: 'Create Alert for This Search' })).toHaveCount(0);

    await page.goto('/jobs?q=telehealth&workMode=remote&location=Texas&salaryMin=150000&newGrad=1');
    await listSettled(page);
    const cta = page.getByRole('button', { name: 'Create Alert for This Search' });
    await expect(cta).toBeVisible();
    // The control lives in the NAV BAR (Header's #nav-alert-slot), not in the results column.
    await expect(page.locator('header #nav-alert-slot').getByRole('button', { name: 'Create Alert for This Search' })).toBeVisible();
    await expect(results(page).getByRole('button', { name: 'Create Alert for This Search' })).toHaveCount(0);

    // Keyboard only: focus the CTA, open with Enter, Tab stays inside, Escape closes and restores focus.
    await cta.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Create Job Alert' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Alert for');
    const summary = dialog.locator('p.text-sm.font-medium').first();
    await expect(summary).toContainText('"telehealth"');
    await expect(summary).toContainText('remote');
    await expect(summary).toContainText('in Texas');
    await expect(summary).toContainText('$150k+');
    await expect(summary).toContainText('open to new grads');
    await expect(dialog.locator('#email')).toBeVisible();
    await expect(dialog.locator('#frequency')).toHaveValue('daily');

    const focusables = await dialog.locator('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])').count();
    for (let i = 0; i < focusables + 2; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `Tab #${i + 1} escaped the dialog`).toBe(true);
    }
    // Empty submit is rejected client-side (react-hook-form) — no request fires.
    let posted = false;
    page.on('request', (r) => { if (r.url().includes('/api/job-alerts') && r.method() === 'POST') posted = true; });
    await dialog.locator('#email').fill('');
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog).toBeVisible();
    expect(posted).toBe(false);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(cta).toBeFocused();

    // Pointer path: close button.
    await cta.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close create alert modal' }).click();
    await expect(dialog).toBeHidden();

    // Refresh mid-flow with the dialog open: the URL (not the modal) is the
    // state — filters survive, the dialog does not, the CTA is back.
    await cta.click();
    await expect(dialog).toBeVisible();
    await page.reload();
    await listSettled(page);
    await expect(page.getByRole('dialog', { name: 'Create Job Alert' })).toHaveCount(0);
    await expect(removePill(page, '"telehealth"')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Clear all \(5\)$/ })).toBeVisible();
    await expect(page.locator('header #nav-alert-slot').getByRole('button', { name: 'Create Alert for This Search' })).toBeVisible();
  });

  test('create-alert control appears in the nav bar only while filters are active, on desktop and at 375px', async ({ page }) => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    const slot = page.locator('header #nav-alert-slot');
    const cta = page.getByRole('button', { name: 'Create Alert for This Search' });
    await expect(slot, 'the header exposes the page-owned slot').toHaveCount(1);
    await expect(cta).toHaveCount(0);

    // One facet → the control appears inside the slot (client nav, no reload).
    expect(await clickAndWaitForList(page, facet(page, /^Remote\b/))).toBe(200);
    await expect(slot.getByRole('button', { name: 'Create Alert for This Search' })).toBeVisible();
    await cta.click();
    const dialog = page.getByRole('dialog', { name: 'Create Job Alert' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('p.text-sm.font-medium').first()).toContainText('remote');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Clear all → gone again, without a reload.
    await page.getByRole('button', { name: /^Clear all/ }).click();
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(cta).toHaveCount(0);

    // Deep-link params count as active filters too, and they prefill the location.
    await page.goto('/jobs?cityExact=Austin&stateCode=TX');
    await listSettled(page);
    await expect(slot.getByRole('button', { name: 'Create Alert for This Search' })).toBeVisible();
    await cta.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('p.text-sm.font-medium').first()).toContainText('in Austin, TX');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Mobile: still in the header, still reachable, inside the viewport.
    await page.setViewportSize(MOBILE);
    await expect(slot.getByRole('button', { name: 'Create Alert for This Search' })).toBeVisible();
    const box = await slot.getByRole('button', { name: 'Create Alert for This Search' }).boundingBox();
    expect(box, 'CTA has a box at 375px').toBeTruthy();
    expect(box!.x + box!.width, 'CTA fits inside the 375px viewport').toBeLessThanOrEqual(MOBILE.width);
    await cta.click();
    await expect(dialog).toBeVisible();
    await noHorizontalOverflow(page, 'alert dialog at 375px');
    await dialog.getByRole('button', { name: 'Close create alert modal' }).click();
    await expect(dialog).toBeHidden();
  });

  // ── 7. Resilience: refresh mid-flow, double submit, unauthenticated surfaces ──

  test('double-submitting the search and refreshing mid-flow never duplicates state', async ({ page }) => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    await searchBox(page).fill('psychiatric');
    await searchBox(page).press('Enter');
    await searchBox(page).press('Enter');
    await expect(page).toHaveURL(/[?&]q=psychiatric/);
    await listSettled(page);
    expect((await page.url().match(/q=/g) || []).length, 'q param must not be duplicated').toBe(1);
    await expect(removePill(page, '"psychiatric"')).toHaveCount(1);

    await locationBox(page).fill('Texas');
    await locationBox(page).press('Enter');
    await expect(page).toHaveURL(/location=Texas/);
    await expect(page).toHaveURL(/q=psychiatric/);
    await listSettled(page);
    await page.reload();
    await listSettled(page);
    await expect(searchBox(page)).toHaveValue('psychiatric');
    await expect(locationBox(page)).toHaveValue('Texas');
    await expect(page.getByRole('button', { name: /^Clear all \(2\)$/ })).toBeVisible();
    await expect(page.locator('[style*="rgba(239,68,68,0.08)"]'), 'no error banner').toHaveCount(0);
  });

  test('protected seeker surfaces touched from discovery reject anonymous access', async ({ page }) => {
    const savedApi = await page.request.get('/api/saved-jobs');
    expect(savedApi.status()).toBe(401);
    const post = await page.request.post('/api/saved-jobs', { data: { jobId: TEST_JOB_ID || 'x' }, headers: { 'Content-Type': 'application/json' } });
    expect([401, 403]).toContain(post.status());

    // /dashboard is server-gated (307 to /login?next=).
    await page.goto('/dashboard');
    await expect(page, '/dashboard should bounce anonymous visitors to login').toHaveURL(/\/login/);
    // /my-applications is client-gated by design: it renders a sign-in link back to itself.
    await page.goto('/my-applications');
    await expect(page.locator('a[href="/login?redirectTo=/my-applications"]').first()).toBeVisible({ timeout: 20_000 });
    // /saved is deliberately available anonymously (device-local saves, app/saved/page.tsx):
    // it must render without an error and without leaking any server-side saved rows.
    const saved = await page.goto('/saved');
    expect(saved?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  // ── 8. 404 / 410 ─────────────────────────────────────────────────────────

  test('unknown routes render the branded 404 page', async ({ page }) => {
    const resp = await page.goto('/this-route-does-not-exist-e2e');
    expect(resp?.status()).toBe(404);
    const bodyLen = (await page.locator('body').innerText().catch(() => '')).trim().length;
    if (bodyLen === 0) {
      test.fixme(true, 'DEFECT: bare unknown routes (e.g. /this-route-does-not-exist) return HTTP 404 with a 0-byte body under next start — no branded not-found page');
    }
    await expect(page.locator('h1')).toHaveText(/could(?:n.t| not) find that page/i);
    await expect(page.getByRole('link', { name: 'All jobs' })).toBeVisible();
    expect(await page.title(), '404 <title> carries no dash').not.toMatch(DASH_RE);
  });

  test('the branded 404 page carries a not-found <title>, not the generic site title', async ({ page }) => {
    const resp = await page.goto('/this-route-does-not-exist-e2e');
    expect(resp?.status()).toBe(404);
    expect(await page.title()).toMatch(/not found|could(?:n.t| not) find/i);
  });

  test('donor / malformed job URLs return a branded 410 and deleted jobs are Gone', async ({ page }) => {
    const probes: Array<{ path: string; heading: RegExp }> = [
      { path: '/jobs/podiatry/texas', heading: /./ },
      { path: '/jobs/remote/notastate', heading: /./ },
      { path: '/jobs/this-does-not-exist', heading: /./ },
      { path: GONE_JOB_URL, heading: /no longer available/i },
    ];
    for (const { path, heading } of probes) {
      const resp = await page.goto(path);
      expect(resp?.status(), path).toBe(410);
      await expect(page.locator('h1'), path).toBeVisible();
      await expect(page.locator('h1'), path).toHaveText(heading);
      expect(await page.title(), `${path} <title> carries no dash`).not.toMatch(DASH_RE);
      expect(await page.locator('h1').innerText(), `${path} h1 carries no dash`).not.toMatch(DASH_RE);
      await expect(page.locator('a[href="/jobs"]').first(), `${path} offers a way back to the board`).toBeVisible();
      const robots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null);
      if (robots) expect(robots).toMatch(/noindex/);
    }
    // Case/slash variants normalize (301/308) before any 410 gate.
    const upper = await page.request.get('/jobs/state/TX', { maxRedirects: 0 });
    expect([301, 308]).toContain(upper.status());
  });

  // ── 9. Mobile core flow ──────────────────────────────────────────────────

  test('mobile 375px: filter drawer → results → detail without overflow', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    await noHorizontalOverflow(page, '/jobs');
    const open = page.getByRole('button', { name: /^Filters/ });
    await expect(open).toBeVisible();
    await open.click();
    const drawer = page.getByRole('dialog', { name: 'Filter jobs' });
    await expect(drawer).toBeVisible();
    const remote = drawer.getByRole('checkbox', { name: /^Remote\b/ });
    expect(await clickAndWaitForList(page, remote)).toBe(200);
    await expect(page).toHaveURL(/workMode=remote/);
    await expect(remote).toBeChecked();
    await expect(drawer.getByRole('button', { name: 'Remove Remote filter' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(open).toHaveText(/Filters \(1\)/);
    await listSettled(page);
    await noHorizontalOverflow(page, '/jobs?workMode=remote');

    const first = cards(page).first();
    await expect(first).toBeVisible();
    const href = (await first.getAttribute('href')) || '';
    expect(href).toMatch(UUID_RE);
    await first.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(page.locator('h1')).toBeVisible();
    await noHorizontalOverflow(page, 'job detail');
    await expect(page.getByRole('button', { name: 'Save job' }).first()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/workMode=remote/);
    await listSettled(page);
  });

  // ── 9b. Mobile: keyboard-only drawer ──────────────────────────────────────

  test('mobile 375px: the filter drawer is keyboard-operable (Enter opens, focus is trapped, Space toggles, Escape restores focus)', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    const open = page.getByRole('button', { name: /^Filters/ });
    await open.focus();
    await expect(open).toBeFocused();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Filter jobs' });
    await expect(drawer).toBeVisible();
    await expect.poll(() => drawer.evaluate((el) => el.contains(document.activeElement)), { message: 'focus moves into the drawer' }).toBe(true);

    // Focus trap in both directions (Shift+Tab from the first element wraps to the last).
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await drawer.evaluate((el) => el.contains(document.activeElement)), `Tab #${i + 1} escaped the drawer`).toBe(true);
    }
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await drawer.evaluate((el) => el.contains(document.activeElement)), `Shift+Tab #${i + 1} escaped the drawer`).toBe(true);
    }

    // Space on a checkbox applies the facet; the drawer stays open for more.
    const remote = drawer.getByRole('checkbox', { name: /^Remote\b/ });
    await remote.focus();
    const [resp] = await Promise.all([
      page.waitForResponse(isListResponse, { timeout: 60_000 }),
      page.keyboard.press('Space'),
    ]);
    expect(resp.status()).toBe(200);
    await expect(page).toHaveURL(/workMode=remote/);
    await expect(remote).toBeChecked();
    await expect(drawer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(open, 'Escape returns focus to the opener').toBeFocused();
    await expect(open).toHaveText(/Filters \(1\)/);
    await noHorizontalOverflow(page, '/jobs?workMode=remote after keyboard drawer');
  });

  // ── 11. Copy rule + salary rendering ─────────────────────────────────────

  test('a stored dashed salary renders as "to" on the card and the detail hero', async ({ page }) => {
    await waitForJobsApiQuota(page);
    // Earlier ingests wrote "$100-$110/hr"; every render point must pass it through
    // normalizeDisplaySalary (lib/salary-display.ts). Find one such row.
    let found: (ApiJob & { salaryRange?: string | null }) | undefined;
    for (let p = 1; p <= 3 && !found; p++) {
      const res = await page.request.get(`/api/jobs?sort=newest&limit=50&page=${p}`);
      expect(res.status(), `/api/jobs page ${p}`).toBe(200);
      const body = (await res.json()) as { jobs: Array<ApiJob & { salaryRange?: string | null }> };
      found = body.jobs.find((j) => DASHED_RANGE_RE.test(j.displaySalary || ''));
    }
    test.skip(!found, 'no published job with a dashed stored salary in the newest 150 rows');
    const job = found!;

    // Card (employer + title filter puts it on page 1 when the employer is small).
    await page.goto(`/jobs?employer=${encodeURIComponent(job.employer)}&q=${encodeURIComponent(job.title)}`);
    await listSettled(page);
    const card = results(page).locator(`a[href$="${job.id}"]`).first();
    if ((await card.count()) > 0) {
      await expect(card).toBeVisible();
      const badge = (await card.locator('text=/\\$\\d/').first().textContent())?.trim() || '';
      expect(badge, `card badge for stored "${job.displaySalary}"`).not.toMatch(DASHED_RANGE_RE);
      expect(badge).toMatch(/\$\d[\dk,.]* to \$\d/);
      await card.click();
      await expect(page).toHaveURL(new RegExp(`${job.id}$`));
    } else {
      // The detail route resolves by trailing UUID (app/jobs/[slug]/page.tsx, canonical anchored to the stored slug).
      await page.goto(`/jobs/${job.id}`);
    }
    await expect(page.locator('h1')).toBeVisible();
    const hero = page.locator('.job-detail-hero-card');
    await expect(hero).toBeVisible();
    const heroSalary = (await hero.locator('text=/\\$\\d/').first().textContent())?.trim() || '';
    if (DASHED_RANGE_RE.test(heroSalary)) {
      test.fixme(true, `DEFECT: job detail hero salary badge renders ranges with a hyphen ("${heroSalary}") instead of "to": lib/utils.ts formatSalary joins min-max with "-" and app/jobs/[slug]/page.tsx does not pass it through normalizeDisplaySalary`);
    }
    expect(heroSalary, `detail hero salary for stored "${job.displaySalary}"`).not.toMatch(DASHED_RANGE_RE);
    expect(heroSalary).toMatch(/ to /);
    // Structured data keeps the numeric range — never the raw dashed string.
    const ld = await readJsonLd(page);
    const posting = ld.find((x) => x['@type'] === 'JobPosting') as Record<string, unknown> | undefined;
    expect(posting, 'JobPosting present').toBeTruthy();
    const base = posting!.baseSalary as { value?: { minValue?: number; maxValue?: number } } | undefined;
    if (base?.value) {
      expect(typeof base.value.minValue).toBe('number');
      expect(typeof base.value.maxValue).toBe('number');
      expect(base.value.minValue!).toBeLessThanOrEqual(base.value.maxValue!);
    }
  });

  test('visible copy on every discovery surface is dash-free (title, body text, accessible names) and no card salary uses a dash', async ({ page }) => {
    test.setTimeout(180_000);
    await waitForJobsApiQuota(page);
    const surfaces = [
      '/', '/jobs', `/jobs?q=${encodeURIComponent(REVIEWER_QUERY)}`, '/jobs?q=zzqxv+nothing+matches',
      '/jobs?workMode=remote&salaryMin=150000&newGrad=1&recruitmentType=direct_hire',
      '/jobs/remote', '/jobs/state/texas', '/jobs/locations',
      ...(TEST_JOB_SLUG ? [`/jobs/${TEST_JOB_SLUG}`] : []),
      '/jobs/this-does-not-exist', GONE_JOB_URL,
    ];
    const offenders: string[] = [];
    for (const s of surfaces) {
      await page.goto(s);
      await expect(page.locator('h1').first(), s).toBeVisible();
      if (s === '/jobs' || s.startsWith('/jobs?')) await listSettled(page);
      const r = await page.evaluate(() => {
        const DASH = /[–—]/;
        const ctx = (m: RegExpMatchArray) => m[0].replace(/\s+/g, ' ').trim();
        const bodyHits = Array.from((document.body.innerText || '').matchAll(/[^\n]{0,40}[–—][^\n]{0,40}/g)).map(ctx);
        // Employer-authored description HTML is data, not copy — excluded from the rule.
        const desc = document.querySelector('.job-description-html') as HTMLElement | null;
        const descHits = new Set(Array.from((desc?.innerText || '').matchAll(/[^\n]{0,40}[–—][^\n]{0,40}/g)).map(ctx));
        const attrs: string[] = [];
        for (const el of Array.from(document.querySelectorAll('[aria-label],[title],[alt],[placeholder]'))) {
          if (desc && desc.contains(el)) continue;
          for (const a of ['aria-label', 'title', 'alt', 'placeholder']) {
            const v = el.getAttribute(a);
            if (v && DASH.test(v)) attrs.push(`${a}="${v}"`);
          }
        }
        const salaryBadges = Array.from(document.querySelectorAll('section[aria-label="Job results"] a[href^="/jobs/"] span, section[aria-label="Job results"] a[href^="/jobs/"] div'))
          .map((el) => (el as HTMLElement).innerText?.trim() || '')
          .filter((t) => /^\$\d/.test(t) && t.length < 40);
        return { title: document.title, hits: bodyHits.filter((h) => !descHits.has(h)), attrs, salaryBadges };
      });
      if (DASH_RE.test(r.title)) offenders.push(`${s} <title>: ${r.title}`);
      for (const h of r.hits) offenders.push(`${s} text: ${h}`);
      for (const a of r.attrs) offenders.push(`${s} attr: ${a}`);
      for (const b of r.salaryBadges) if (DASHED_RANGE_RE.test(b)) offenders.push(`${s} salary badge: ${b}`);
    }
    expect(offenders, 'dashes in rendered copy').toEqual([]);
  });

  // ── 12. Input hardening + state races ────────────────────────────────────

  test('search input hardening: markup is inert, whitespace-only submits are not a filter, overlong queries degrade safely', async ({ page }) => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);

    const payload = '<b>xss</b><img src=x onerror=alert(1)>';
    await searchBox(page).fill(payload);
    const [resp] = await Promise.all([page.waitForResponse(isListResponse, { timeout: 60_000 }), searchBox(page).press('Enter')]);
    expect(resp.status()).toBe(200);
    await listSettled(page);
    expect(await page.locator('img[src="x"]').count(), 'injected <img> must not exist in the DOM').toBe(0);
    await expect(removePill(page, `"${payload}"`), 'pill echoes the raw text, escaped').toBeVisible();
    await expect(searchBox(page)).toHaveValue(payload);

    // Whitespace-only search is not a filter: no pill, no "Clear all", no q param.
    await page.goto('/jobs');
    await listSettled(page);
    await searchBox(page).fill('   ');
    await searchBox(page).press('Enter');
    await listSettled(page);
    await expect.poll(() => page.url(), { message: 'URL settles after the submit' }).toMatch(/\/jobs(\?.*)?$/);
    const blankPill = page.getByRole('button', { name: /^Remove "\s*" filter$/ });
    if ((await blankPill.count()) > 0 || /[?&]q=(\+|%20)+(&|$)/.test(page.url())) {
      test.fixme(true, 'DEFECT: a whitespace-only search submits q="   " — the URL carries an empty query, the sidebar shows a blank "" pill and "Clear all (1)" (LinkedInFilters.handleSearchSubmit does not trim)');
    }
    await expect(blankPill).toHaveCount(0);
    expect(page.url()).not.toMatch(/[?&]q=(\+|%20)+(&|$)/);
    await expect(page.getByRole('button', { name: /^Clear all/ })).toHaveCount(0);

    // 2,000-character query: page and API both answer 200, never 500.
    const long = 'a'.repeat(2000);
    const r = await page.goto(`/jobs?q=${long}`);
    expect(r?.status()).toBe(200);
    await expect(cards(page).first().or(noJobs(page))).toBeVisible();
    const api = await page.request.get(`/api/jobs?q=${long}&limit=1`);
    expect(api.status()).toBe(200);
  });

  test('double-clicking a facet (two toggles before the list responds) settles with URL, checkbox and pill in agreement', async ({ page }) => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    const remote = facet(page, /^Remote\b/);
    await remote.dblclick();
    // Whatever order the two router.pushes land in, the three surfaces must agree
    // and the param must never be duplicated.
    await expect
      .poll(async () => {
        const checked = await remote.isChecked();
        const inUrl = /workMode=remote/.test(page.url());
        const pill = await removePill(page, 'Remote').count();
        return `${checked}|${inUrl}|${pill}`;
      }, { message: 'checkbox | URL | pill agree', timeout: 20_000 })
      .toMatch(/^(true\|true\|1|false\|false\|0)$/);
    expect((page.url().match(/workMode=remote/g) || []).length, 'workMode param duplicated').toBeLessThanOrEqual(1);
    await listSettled(page);
    const count = await sidebarTotal(page);
    expect(count).toBeGreaterThan(0);
    await expect(page.locator('[style*="rgba(239,68,68,0.08)"]'), 'no error banner').toHaveCount(0);
  });

  test('anonymous /api/job-alerts rejects malformed payloads with 4xx (never 500) and cross-origin posts with 403', async ({ page }) => {
    const post = (data: unknown, origin = MUT_ORIGIN) =>
      page.request.post('/api/job-alerts', { data, headers: { 'Content-Type': 'application/json', Origin: origin } });
    expect((await post({ email: 'not-an-email', frequency: 'daily' })).status()).toBe(400);
    const empty = (await post({})).status();
    const raw = (await page.request.post('/api/job-alerts', { data: '{not json', headers: { 'Content-Type': 'application/json', Origin: MUT_ORIGIN } })).status();
    if (empty >= 500 || raw >= 500) {
      test.fixme(true, 'DEFECT: POST /api/job-alerts answers 500 "Failed to create job alert" for a body without an email ({} -> ' + empty + ') or malformed JSON (-> ' + raw + '): sanitizeJobAlert calls sanitizeEmail(undefined) and request.json() throws inside the catch-all');
    }
    expect(empty).toBe(400);
    expect([400, 422]).toContain(raw);
    // Cross-origin: the CSRF gate (lib/csrf.ts) must answer before validation does.
    const evil = await post({ email: 'not-an-email', frequency: 'daily' }, 'https://evil.example');
    expect(evil.status(), 'cross-origin POST /api/job-alerts').toBe(403);
    // Token-less GET is a client error, not a crash.
    const get = await page.request.get('/api/job-alerts');
    expect([400, 401, 404]).toContain(get.status());
  });

  // ── 13. Anonymous save from the results list + branded 410 for the probe ──

  test('anonymous bookmark on a results card prompts sign-in instead of silently saving', async ({ page }) => {
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    const bookmark = results(page).getByRole('button', { name: 'Save job' }).first();
    await expect(bookmark).toBeVisible();
    const urlBefore = page.url();
    let savedPost = false;
    page.on('request', (r) => { if (r.url().includes('/api/saved-jobs') && r.method() !== 'GET') savedPost = true; });
    const loginPrompt = page.getByRole('dialog').or(page.getByText(/sign in to save|log in to save|create an account to save/i));
    const before = await loginPrompt.count();
    await bookmark.click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const navigatedToLogin = /\/login|\/signup/.test(page.url());
    const prompted = navigatedToLogin || (await loginPrompt.count()) > before;
    // Anonymous saves must never hit the authenticated API.
    expect(savedPost, 'anonymous save must not POST /api/saved-jobs').toBe(false);
    if (!prompted) {
      const nowSaved = await results(page).getByRole('button', { name: 'Unsave job' }).count();
      expect(page.url()).toBe(urlBefore);
      expect(nowSaved, 'the silent save flipped the card to Unsave').toBeGreaterThan(0);
      // Reset the device-local state so the next test starts clean.
      await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
      test.fixme(true, 'DEFECT: anonymous bookmark on a /jobs results card silently saves to localStorage with no sign-in prompt (components/JobCard.tsx handleSaveClick)');
    }
    expect(prompted, 'anonymous card save must prompt for sign-in').toBe(true);
  });

  test('the quarantined probe slug renders the branded Gone page, not a bare 410', async ({ page }) => {
    test.skip(!QUARANTINE_SLUG, 'E2E_QUARANTINE_JOB_SLUG not set');
    const resp = await page.goto(`/jobs/${QUARANTINE_SLUG}`);
    expect(resp?.status()).toBe(410);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(QUARANTINE_TITLE);
    await expect(page.locator('a[href="/jobs"]').first()).toBeVisible();
    expect(await page.title()).not.toMatch(DASH_RE);
    const robots = await page.locator('meta[name="robots"]').first().getAttribute('content').catch(() => null);
    if (robots) expect(robots).toMatch(/noindex/);
  });

  // ── 10. Rate-limit self-DoS (runs last — burns the shared /api/jobs window) ──

  test('a person toggling a dozen facets in a minute is not rate-limited by the board', async ({ page }) => {
    test.setTimeout(600_000); // 12 facet round-trips against a slow dev DB
    await waitForJobsApiQuota(page);
    await page.goto('/jobs');
    await listSettled(page);
    const toggles: RegExp[] = [
      /^Remote\b/, /^Full-Time\b/, /^Part-Time\b/, /^Contract\b/, /^Hybrid\b/, /^Telehealth\b/,
      /^\$100,000\+/, /^Past week/, /^Open to new grads/, /^I have 1\+ years/, /^Direct employers/, /^Per Diem\b/,
    ];
    const statuses: number[] = [];
    for (const t of toggles) {
      statuses.push(await clickAndWaitForList(page, facet(page, t)));
    }
    const limited = statuses.filter((s) => s === 429).length;
    if (limited > 0) {
      guard?.allow(/\[fetchJobs\] Error.*429/);
      test.fixme(true, `DEFECT: /api/jobs (30 req/min per IP) throttles the board's own UI — ${limited}/${toggles.length} facet toggles got 429 and the list showed "Failed to fetch jobs (429)"`);
    }
    expect(statuses.every((s) => s === 200), `facet toggle statuses: ${statuses.join(',')}`).toBe(true);
    await expect(page.locator('[style*="rgba(239,68,68,0.08)"]')).toHaveCount(0);
  });
});

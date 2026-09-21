/**
 * Shared plumbing for the admin-console journey (tests/e2e/journeys/admin.spec.ts):
 *
 *   - role fixtures (`adminPage`, `employerPage`, `seekerPage`) backed by a
 *     per-worker storageState cache so each role signs in once per origin;
 *   - a console/pageerror guard that fails a test on uncaught errors;
 *   - a per-request private IP so lib/rate-limit.ts never throttles the
 *     spec's own traffic;
 *   - filesystem enumeration of app/admin/** pages and app/api/admin/** routes
 *     so a newly added route can never be forgotten by the gating tests.
 *
 * ORIGIN NOTE: lib/csrf.ts accepts mutations only from `http://localhost:3000`
 * (or brand/NEXT_PUBLIC_BASE_URL / the origin Next believes it serves). Under
 * `next start` bound to 127.0.0.1, a browser at http://127.0.0.1:3000 gets 403
 * on every POST/PATCH/DELETE. Read-only checks run against PLAYWRIGHT_BASE_URL
 * as given; UI-driven mutation blocks re-target `MUTATION_BASE`.
 */
import {
    test as base,
    expect,
    type Page,
    type Browser,
    type BrowserContext,
    type APIResponse,
    type ConsoleMessage,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brand } from '../../../config/brand';
import { playwrightAuth, type Role } from './auth';

// ── Constants ───────────────────────────────────────────────────────────────

export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
export const MUTATION_BASE = BASE.replace('127.0.0.1', 'localhost');
export const AGAINST_PROD =
    !!process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_BASE_URL.includes(brand.domain);
export const USER_AGENT = 'PMHNP-E2E-Bot/1.0 (Playwright)';
export const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';
export const RENDER_ERROR = /application error|something went wrong|internal server error|unhandled runtime error/i;

// ── Rate-limit dodge ────────────────────────────────────────────────────────
// lib/rate-limit.ts keys the 20/min admin bucket on x-forwarded-for. Every
// browser context and every raw API call gets a fresh private IP so the
// spec's own traffic can never trip the limiter and mask an auth result.

let ipCounter = Math.floor(Math.random() * 20_000);

export function nextIp(): string {
    ipCounter += 1;
    return `10.77.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export function ipHeaders(): Record<string, string> {
    return { 'x-forwarded-for': nextIp() };
}

// ── Console guard ───────────────────────────────────────────────────────────

interface ConsoleGuard {
    errors: string[];
    pageErrors: string[];
}

const guards = new WeakMap<Page, ConsoleGuard>();

const THIRD_PARTY = /google|gstatic|doubleclick|vercel\.live|posthog|sentry|hotjar|clarity|stripe\.com|facebook|linkedin\.com\/px/i;

export function watchConsole(page: Page): ConsoleGuard {
    const existing = guards.get(page);
    if (existing) return existing;
    const guard: ConsoleGuard = { errors: [], pageErrors: [] };
    page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() !== 'error') return;
        const url = msg.location()?.url || '';
        const text = msg.text();
        if (THIRD_PARTY.test(url) || THIRD_PARTY.test(text)) return;
        if (/favicon|ResizeObserver loop|React DevTools/i.test(text)) return;
        guard.errors.push(`${text}${url ? ` @ ${url}` : ''}`);
    });
    page.on('pageerror', (err) => guard.pageErrors.push(String(err?.stack || err)));
    guards.set(page, guard);
    return guard;
}

/**
 * Fail on uncaught exceptions and console errors. `allow` whitelists messages
 * a test deliberately provokes (e.g. a 4xx the test itself asserted on).
 */
export function expectCleanConsole(page: Page, allow: RegExp[] = []): void {
    const guard = guards.get(page) ?? watchConsole(page);
    const errors = guard.errors.filter((e) => !allow.some((re) => re.test(e)));
    expect.soft(guard.pageErrors, 'uncaught page errors').toEqual([]);
    expect.soft(errors, 'console.error output').toEqual([]);
}

// ── Auth state cache ────────────────────────────────────────────────────────
// One real sign-in per (role, origin) per worker; subsequent tests reuse the
// saved storageState so the suite does not pay a Supabase round-trip per test.
// Cookies are host-scoped, so 127.0.0.1 and localhost get separate states.
//
// The cache lives OUTSIDE test-results/: Playwright empties that directory at
// the start of every run, and parallel journey runs would wipe each other's
// sessions mid-suite (forcing a fresh Supabase sign-in per test).

const AUTH_DIR = path.join(os.tmpdir(), 'np-hiring-e2e-auth', String(process.pid));
const stateCache = new Map<string, string>();
const authFailures = new Map<string, string>();

export async function ensureAuthState(browser: Browser, role: Role, baseURL: string): Promise<string> {
    const host = new URL(baseURL).host.replace(/[^a-z0-9.]/gi, '_');
    const key = `${role}@${host}`;
    const cached = stateCache.get(key);
    if (cached && fs.existsSync(cached)) return cached;
    // Fail fast: one broken sign-in must not cost 20s on every later test.
    const priorFailure = authFailures.get(key);
    if (priorFailure) throw new Error(priorFailure);

    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const file = path.join(AUTH_DIR, `${role}-${host}.json`);
    const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: { 'User-Agent': USER_AGENT, ...ipHeaders() } });
    const page = await ctx.newPage();
    // Record what Supabase said so a timeout names its cause (429 rate limit,
    // 400 bad credentials …) instead of just "waitForURL timed out".
    const tokenResponses: string[] = [];
    page.on('response', async (res) => {
        if (!/\/auth\/v1\/token/.test(res.url())) return;
        const body = await res.text().catch(() => '');
        tokenResponses.push(`${res.status()} ${body.slice(0, 200)}`);
    });
    try {
        await playwrightAuth(page, role);
    } catch (err) {
        const message =
            `sign-in as ${role} at ${baseURL} failed (${String(err).split('\n')[0]}); ` +
            `Supabase /auth/v1/token: ${tokenResponses.length ? tokenResponses.join(' | ') : 'never called'}; ` +
            `landed on ${page.url()}`;
        authFailures.set(key, message);
        await ctx.close();
        throw new Error(message);
    }
    await ctx.storageState({ path: file });
    await ctx.close();
    stateCache.set(key, file);
    return file;
}

export async function rolePage(browser: Browser, role: Role, baseURL: string): Promise<{ page: Page; context: BrowserContext }> {
    const storageState = await ensureAuthState(browser, role, baseURL);
    const context = await browser.newContext({
        baseURL,
        storageState,
        extraHTTPHeaders: { 'User-Agent': USER_AGENT, ...ipHeaders() },
    });
    const page = await context.newPage();
    watchConsole(page);
    return { page, context };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

type RoleFixtures = {
    adminPage: Page;
    employerPage: Page;
    seekerPage: Page;
};

export const test = base.extend<RoleFixtures>({
    // Per-test private IP for the rate limiter (see nextIp) + the repo's UA.
    extraHTTPHeaders: async ({}, provide) => {
        await provide({ 'User-Agent': USER_AGENT, ...ipHeaders() });
    },
    adminPage: async ({ browser, baseURL }, provide) => {
        const { page, context } = await rolePage(browser, 'admin', baseURL!);
        await provide(page);
        await context.close();
    },
    employerPage: async ({ browser, baseURL }, provide) => {
        const { page, context } = await rolePage(browser, 'employer', baseURL!);
        await provide(page);
        await context.close();
    },
    seekerPage: async ({ browser, baseURL }, provide) => {
        const { page, context } = await rolePage(browser, 'candidate', baseURL!);
        await provide(page);
        await context.close();
    },
});

export { expect };

// ── Filesystem enumeration of the admin surface ─────────────────────────────

export interface AdminApiRoute {
    url: string;
    methods: string[];
    file: string;
}

export interface AdminPage {
    url: string;
    file: string;
}

function walk(dir: string, match: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, match, out);
        else if (entry.name === match) out.push(full);
    }
    return out;
}

function urlFromDir(root: string, file: string, prefix: string): string {
    const rel = path.relative(root, path.dirname(file));
    const segments = rel
        .split(path.sep)
        .filter(Boolean)
        .map((seg) => (seg.startsWith('[') ? PLACEHOLDER_ID : seg));
    return [prefix, ...segments].join('/');
}

export function listAdminApiRoutes(): AdminApiRoute[] {
    const root = path.join(REPO_ROOT, 'app', 'api', 'admin');
    return walk(root, 'route.ts')
        .map((file) => {
            const src = fs.readFileSync(file, 'utf8');
            const methods = Array.from(src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)).map((m) => m[1]);
            return { url: urlFromDir(root, file, '/api/admin'), methods, file: path.relative(REPO_ROOT, file).replace(/\\/g, '/') };
        })
        .sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * app/api/cron/** handlers. Every one is manually triggerable from
 * /admin/cron (lib/auth/verify-cron-or-admin.ts accepts an admin session in
 * place of the CRON_SECRET bearer), which makes them part of the admin
 * surface: an anonymous or non-admin caller must be refused.
 */
export function listCronRoutes(): AdminApiRoute[] {
    const root = path.join(REPO_ROOT, 'app', 'api', 'cron');
    if (!fs.existsSync(root)) return [];
    return walk(root, 'route.ts')
        .map((file) => {
            const src = fs.readFileSync(file, 'utf8');
            const methods = Array.from(src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)).map((m) => m[1]);
            return { url: urlFromDir(root, file, '/api/cron'), methods, file: path.relative(REPO_ROOT, file).replace(/\\/g, '/') };
        })
        .sort((a, b) => a.url.localeCompare(b.url));
}

export function listAdminPages(): AdminPage[] {
    const root = path.join(REPO_ROOT, 'app', 'admin');
    return walk(root, 'page.tsx')
        .map((file) => ({ url: urlFromDir(root, file, '/admin') || '/admin', file: path.relative(REPO_ROOT, file).replace(/\\/g, '/') }))
        .sort((a, b) => a.url.localeCompare(b.url));
}

// ── Gate helpers ────────────────────────────────────────────────────────────

/** Body for a mutation probe — enough to get past JSON parsing to the guard. */
export function probeBody(method: string): Record<string, unknown> | undefined {
    return method === 'GET' ? undefined : { probe: true };
}

export function describeGate(res: APIResponse): string {
    return `${res.status()} ${res.headers()['location'] ?? ''}`.trim();
}

export function isUnauthGate(res: APIResponse): boolean {
    const s = res.status();
    const loc = res.headers()['location'] ?? '';
    return s === 401 || s === 403 || (s >= 300 && s < 400 && /\/login/.test(loc));
}

export function isWrongRoleGate(res: APIResponse): boolean {
    const s = res.status();
    const loc = res.headers()['location'] ?? '';
    return s === 401 || s === 403 || (s >= 300 && s < 400 && /\/(unauthorized|login)/.test(loc));
}

// ── Page helpers ────────────────────────────────────────────────────────────

export async function bodyText(page: Page): Promise<string> {
    return page.locator('body').innerText();
}

/**
 * Copy rule in force site-wide: rendered copy carries no em/en dashes.
 * Returns every VISIBLE text node containing U+2013/U+2014, tagged with its
 * parent element, so a failure names the offending string. Table cells,
 * blockquotes, code and anything marked data-employer-authored are skipped:
 * those carry employer/user-authored data (job titles, testimonials), which
 * the rule explicitly exempts.
 */
export async function visibleDashes(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const text = node.textContent || '';
            if (!/[–—]/.test(text)) continue;
            const el = node.parentElement;
            if (!el) continue;
            if (el.closest('td, script, style, noscript, code, pre, blockquote, textarea, [data-employer-authored]')) continue;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const label = el.id ? `${el.tagName.toLowerCase()}#${el.id}` : el.tagName.toLowerCase();
            out.push(`${label}: ${text.trim().replace(/\s+/g, ' ').slice(0, 140)}`);
        }
        return out;
    });
}

/** Wait for a client dashboard to have real content (no 'networkidle' on a busy server). */
export async function waitForBody(page: Page, minLength = 50): Promise<string> {
    await expect
        .poll(async () => (await bodyText(page)).length, { message: 'page body suspiciously empty' })
        .toBeGreaterThan(minLength);
    return bodyText(page);
}

/**
 * Type a query into the admin jobs search box and wait for the debounced
 * `/api/admin/jobs?search=` round-trip to land (deterministic — no sleeps —
 * and immune to a slow server: the table is only inspected after the data
 * it should contain has arrived).
 */
export async function searchAdminJobs(page: Page, query: string): Promise<void> {
    const listed = page.waitForResponse(
        // URLSearchParams encodes spaces as '+', so compare the decoded param, not a %20 substring.
        (r) => r.url().includes('/api/admin/jobs?') && new URL(r.url()).searchParams.get('search') === query
            // middleware 301s ?page=1 to the bare URL first; wait for the followed response.
            && (r.status() < 300 || r.status() >= 400),
        { timeout: 45_000 },
    );
    await page.getByPlaceholder('Search title or employer...').fill(query);
    expect((await listed).status(), `/api/admin/jobs?search=${query}`).toBe(200);
}

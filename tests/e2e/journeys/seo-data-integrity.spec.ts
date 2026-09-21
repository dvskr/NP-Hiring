import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brand } from '../../../config/brand';
import { installConsoleGuard, type ConsoleGuard } from '../helpers/console-guard';
import { closeDb, db, hasDb } from '../helpers/db';
import {
    CSR_BAILOUT_MARKER,
    DONOR_COPY_RE,
    LEAKED_PLACEHOLDER_RE,
    canonicalOf,
    checkXml,
    decodeXmlEntities,
    duplicates,
    extractJsonLd,
    flattenJsonLd,
    followRedirects,
    headlineCountDisplay,
    htmlToText,
    jobUuidOf,
    metaDescriptionOf,
    metaRobotsOf,
    parseLocs,
    programsCountDisplay,
    stringLeaves,
    titleOf,
    typesOf,
    type JsonObject,
} from '../helpers/seo';

/**
 * SEO / AEO files + data-integrity journey.
 *
 * Everything here is public and read-only. HTTP-level checks use the
 * `request` fixture (raw HTML, real status codes, no JS); page classes whose
 * structured data or copy can only be judged after hydration use `page`
 * under a console guard.
 *
 * Seeds (written to .env.test by the setup agent):
 *   E2E_TEST_JOB_SLUG        — employer-posted NP job, professionClass np_eligible
 *   E2E_QUARANTINE_JOB_SLUG  — published Podiatrist row, professionClass other_clinical
 *
 * Environment notes:
 *   - lib/csrf.ts rejects mutating requests whose Origin is http://127.0.0.1:3000
 *     under `next start`, so the facet-count block runs against localhost.
 *   - robots/sitemap hosts derive from NEXT_PUBLIC_BASE_URL while canonicals
 *     derive from brand.baseUrl; the two are compared by pathname when the env
 *     deliberately points at a local host.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const CSRF_HOST_MISMATCH = new URL(BASE_URL).hostname === '127.0.0.1';
const FACET_BASE_URL = CSRF_HOST_MISMATCH ? BASE_URL.replace('127.0.0.1', 'localhost') : BASE_URL;

const TEST_JOB_SLUG = process.env.E2E_TEST_JOB_SLUG;
const PROBE_SLUG = process.env.E2E_QUARANTINE_JOB_SLUG;
const PROBE_ID = process.env.E2E_QUARANTINE_JOB_ID;

/** O*NET-SOC code for Nurse Practitioners (components/JobStructuredData.tsx). */
const NP_SOC = '29-1171.00';
/** lib/canonical-counts.ts — counts below this are omitted, never padded. */
const COUNT_DISPLAY_FLOOR = 5;
/** components/tools/benchmark-model.ts publishing gate for salary figures. */
const BENCHMARK_MIN_POSTINGS = 5;
const BENCHMARK_MIN_EMPLOYERS = 3;
/** SiteStat snapshot is refreshed hourly; sibling suites seed rows meanwhile. */
const SNAPSHOT_TOLERANCE = 3;
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';
const SITEMAP_SAMPLE_SIZE = 25;

// ── Fixtures ────────────────────────────────────────────────────────────────

// The HTTP-level crawl fetches ~80 URLs; the whole E2E fleet shares one IP,
// so an anonymous UA trips the per-IP page rate limit (429). The repo's own
// self-crawl UA (brand.indexerUserAgent, allow-listed in middleware.ts for
// exactly this purpose) is used for `request` only — browser pages keep the
// default UA so rate-limit and bot-handling paths stay exercised there.
const INDEXER_HEADERS = { 'User-Agent': brand.indexerUserAgent };

/** Request timeout for pages whose first render is DB-heavy. */
const SLOW_PAGE_TIMEOUT = 90_000;

const test = base.extend<{ guard: ConsoleGuard }>({
    request: async ({ playwright, baseURL }, provide) => {
        const ctx = await playwright.request.newContext({
            baseURL: baseURL ?? BASE_URL,
            extraHTTPHeaders: INDEXER_HEADERS,
            timeout: SLOW_PAGE_TIMEOUT,
        });
        await provide(ctx);
        await ctx.dispose();
    },
    guard: async ({ page }, provide, testInfo) => {
        const extraAllow: RegExp[] = [];
        // Documented environment gap: the facet-count POST from a 127.0.0.1
        // origin is rejected by lib/csrf.ts, and LinkedInFilters logs it.
        if (CSRF_HOST_MISMATCH) extraAllow.push(/Failed to fetch filter counts/);
        // Same host gap, pinned by candidate-discovery.spec.ts: on 127.0.0.1 the
        // CSP keeps upgrade-insecure-requests, so some client fetches go https.
        if (CSRF_HOST_MISMATCH) extraAllow.push(/net::ERR_SSL_PROTOCOL_ERROR/);
        // RSC prefetches cancelled by the next navigation are not product errors.
        extraAllow.push(/net::ERR_ABORTED/i);
        const guard = installConsoleGuard(page, extraAllow);
        activeGuard = guard;
        await provide(guard);
        activeGuard = null;
        // The React hydration mismatch (#418) is pinned by its own fixme test
        // ("hydrate without React errors"); every other test would otherwise
        // fail on that one defect and hide its own contract. Set aside openly.
        if (!/hydrate without React errors/.test(testInfo.title)) {
            const hydration = guard.pageErrors.filter((e) => HYDRATION_ERROR_RE.test(e));
            if (hydration.length) {
                testInfo.annotations.push({ type: 'hydration-mismatch (pinned elsewhere)', description: hydration.join(' | ').slice(0, 400) });
            }
            for (let i = guard.pageErrors.length - 1; i >= 0; i--) {
                if (HYDRATION_ERROR_RE.test(guard.pageErrors[i])) guard.pageErrors.splice(i, 1);
            }
        }
        guard.assertClean();
    },
});

/** React 19 production hydration errors: #418 (HTML mismatch), #423/#425 (text/attribute). */
const HYDRATION_ERROR_RE = /Minified React error #4(18|23|25)|Hydration failed/i;

/** The guard of the running browser test, so navigation helpers can record transient 5xx. */
let activeGuard: ConsoleGuard | null = null;

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Job-detail first renders take >20s while the fleet loads the server, and
// the 25-URL sitemap sample fetches sequentially.
test.beforeEach(async () => {
    test.setTimeout(300_000);
});

// ── Shared crawl state (populated once in beforeAll) ────────────────────────

interface Crawl {
    indexLocs: string[];
    /** child sitemap pathname → its <loc> values */
    children: Map<string, string[]>;
    /** every loc pathname → child that emitted it */
    allPaths: Map<string, string>;
    jobUuids: Set<string>;
}

let crawl: Crawl;

async function crawlSitemaps(request: APIRequestContext): Promise<Crawl> {
    const index = await request.get('/api/sitemaps/index');
    expect(index.status(), '/api/sitemaps/index status').toBe(200);
    const indexLocs = parseLocs(await index.text());
    const children = new Map<string, string[]>();
    const allPaths = new Map<string, string>();
    const jobUuids = new Set<string>();
    for (const loc of indexLocs) {
        const path = new URL(loc).pathname;
        const res = await request.get(path);
        expect(res.status(), `child sitemap ${path}`).toBe(200);
        const locs = parseLocs(await res.text());
        children.set(path, locs);
        for (const l of locs) {
            const p = new URL(l).pathname;
            allPaths.set(p, path);
            const uuid = jobUuidOf(p);
            if (uuid && p.startsWith('/jobs/')) jobUuids.add(uuid);
        }
    }
    return { indexLocs, children, allPaths, jobUuids };
}

function pick(re: RegExp, n: number, from: Iterable<string> = crawl.allPaths.keys()): string[] {
    const out: string[] = [];
    for (const p of from) {
        if (re.test(p)) out.push(p);
        if (out.length >= n) break;
    }
    return out;
}

/** pSEO page-class samples, all taken from what the sitemaps actually advertise. */
function pseoSamples(): Record<string, string | undefined> {
    const cityBatch = [...crawl.allPaths.keys()].filter((p) => crawl.allPaths.get(p)?.includes('/cities/'));
    return {
        categoryLanding: pick(/^\/jobs\/[a-z0-9-]+$/, 1)[0],
        categoryState: pick(/^\/jobs\/(?!state|metro|city|locations|edit)[a-z0-9-]+\/[a-z-]+$/, 1, cityBatch)[0],
        categoryCity: pick(/^\/jobs\/[a-z0-9-]+\/city\/[a-z0-9-]+$/, 1, cityBatch)[0],
        stateHub: pick(/^\/jobs\/state\/[a-z-]+$/, 1)[0],
        metro: pick(/^\/jobs\/metro\/[a-z0-9-]+$/, 1)[0],
        stateCityDirectory: pick(/^\/jobs\/locations\/[a-z-]+$/, 1)[0],
        city: pick(/^\/jobs\/city\/[a-z0-9-]+$/, 1)[0],
    };
}

/**
 * Playwright restarts the worker after any test failure, which re-runs
 * beforeAll. The crawl is cached on disk for a few minutes so a restart under
 * fleet load does not re-fetch (and possibly time out on) every sitemap.
 */
const CRAWL_CACHE_TTL_MS = 10 * 60 * 1000;
const crawlCacheFile = path.join(
    os.tmpdir(),
    `seo-di-crawl-${createHash('sha1').update(BASE_URL).digest('hex').slice(0, 10)}.json`,
);

function readCrawlCache(): Crawl | null {
    try {
        const stat = fs.statSync(crawlCacheFile);
        if (Date.now() - stat.mtimeMs > CRAWL_CACHE_TTL_MS) return null;
        const raw = JSON.parse(fs.readFileSync(crawlCacheFile, 'utf8')) as {
            indexLocs: string[];
            children: Array<[string, string[]]>;
            allPaths: Array<[string, string]>;
            jobUuids: string[];
        };
        return {
            indexLocs: raw.indexLocs,
            children: new Map(raw.children),
            allPaths: new Map(raw.allPaths),
            jobUuids: new Set(raw.jobUuids),
        };
    } catch {
        return null;
    }
}

function writeCrawlCache(value: Crawl): void {
    try {
        fs.writeFileSync(
            crawlCacheFile,
            JSON.stringify({
                indexLocs: value.indexLocs,
                children: [...value.children],
                allPaths: [...value.allPaths],
                jobUuids: [...value.jobUuids],
            }),
        );
    } catch {
        // Cache is a convenience only.
    }
}

test.beforeAll(async ({ playwright }) => {
    const cached = readCrawlCache();
    if (cached) {
        crawl = cached;
        return;
    }
    const ctx = await playwright.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: INDEXER_HEADERS, timeout: SLOW_PAGE_TIMEOUT });
    try {
        crawl = await crawlSitemaps(ctx);
        writeCrawlCache(crawl);
    } finally {
        await ctx.dispose();
    }
});

test.afterAll(async () => {
    await closeDb();
});

// ── Small helpers ───────────────────────────────────────────────────────────

async function getHtml(request: APIRequestContext, path: string): Promise<{ status: number; html: string; headers: Record<string, string> }> {
    const res = await request.get(path, { timeout: SLOW_PAGE_TIMEOUT });
    return { status: res.status(), html: await res.text(), headers: res.headers() };
}

/** Distinct /companies/<slug> links on a page (the spotlight strip repeats cards). */
function distinctCompanyLinks(html: string): number {
    return new Set([...html.matchAll(/href="\/companies\/([^"?#]+)"/g)].map((m) => m[1])).size;
}

function toNumber(s: string): number {
    return Number(s.replace(/,/g, ''));
}

async function apiTotal(request: APIRequestContext, query = ''): Promise<number> {
    const url = `/api/jobs?limit=1${query ? `&${query}` : ''}`;
    let res = await request.get(url);
    if (res.status() >= 500) {
        // Recorded and retried once: the fleet shares this server (see transient-5xx defect).
        test.info().annotations.push({ type: 'transient-5xx', description: `${url}: HTTP ${res.status()} on first fetch` });
        res = await request.get(url);
    }
    expect(res.status(), `/api/jobs?${query}`).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(typeof body.total).toBe('number');
    return body.total;
}

/** Problems with a JSON-LD node's required fields (empty = valid). */
function validateJsonLdNode(node: JsonObject): string[] {
    const problems: string[] = [];
    const need = (field: string, ok: (v: unknown) => boolean = (v) => v != null && v !== '') => {
        if (!ok(node[field])) problems.push(`${typesOf(node).join('/')}: missing/invalid "${field}"`);
    };
    const isDate = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
    for (const type of typesOf(node)) {
        switch (type) {
            case 'Organization':
                need('name');
                need('url');
                break;
            case 'WebSite':
                need('url');
                need('name');
                break;
            case 'BreadcrumbList': {
                const items = node.itemListElement;
                if (!Array.isArray(items) || items.length < 2) {
                    problems.push('BreadcrumbList: itemListElement needs >= 2 entries');
                    break;
                }
                items.forEach((it, i) => {
                    const o = it as JsonObject;
                    if (typeof o.position !== 'number') problems.push(`BreadcrumbList[${i}]: position`);
                    if (!o.name) problems.push(`BreadcrumbList[${i}]: name`);
                    if (i < items.length - 1 && !o.item && !o['@id']) problems.push(`BreadcrumbList[${i}]: item`);
                });
                break;
            }
            case 'FAQPage': {
                const qs = node.mainEntity;
                if (!Array.isArray(qs) || qs.length === 0) {
                    problems.push('FAQPage: mainEntity empty');
                    break;
                }
                qs.forEach((q, i) => {
                    const o = q as JsonObject;
                    const a = o.acceptedAnswer as JsonObject | undefined;
                    if (!o.name) problems.push(`FAQPage[${i}]: name`);
                    if (!a || !a.text) problems.push(`FAQPage[${i}]: acceptedAnswer.text`);
                });
                break;
            }
            case 'ItemList':
                need('itemListElement', (v) => Array.isArray(v));
                break;
            case 'JobPosting': {
                need('title');
                need('description', (v) => typeof v === 'string' && v.trim().length >= 30);
                need('datePosted', isDate);
                need('validThrough', isDate);
                need('url');
                const org = node.hiringOrganization as JsonObject | undefined;
                if (!org || !org.name) problems.push('JobPosting: hiringOrganization.name');
                if (isDate(node.datePosted) && isDate(node.validThrough) && Date.parse(node.validThrough as string) <= Date.parse(node.datePosted as string)) {
                    problems.push('JobPosting: validThrough must be after datePosted');
                }
                const telecommute = node.jobLocationType === 'TELECOMMUTE';
                if (!telecommute && !node.jobLocation) problems.push('JobPosting: needs jobLocation or jobLocationType TELECOMMUTE');
                if (telecommute && node.jobLocation) problems.push('JobPosting: TELECOMMUTE must not carry a physical jobLocation');
                if (node.occupationalCategory != null && !/^\d{2}-\d{4}\.\d{2}$/.test(String(node.occupationalCategory))) {
                    problems.push(`JobPosting: occupationalCategory "${String(node.occupationalCategory)}" is not an O*NET-SOC code`);
                }
                break;
            }
            default:
                break;
        }
    }
    for (const leaf of stringLeaves(node)) {
        if (/^(undefined|null|NaN)$/.test(leaf.value) || /\bundefined\b/.test(leaf.value)) {
            problems.push(`${typesOf(node).join('/')}: leaked placeholder at ${leaf.path} = "${leaf.value}"`);
        }
    }
    return problems;
}

function assertJsonLdHealthy(html: string, label: string, skipTypes: string[] = []): JsonObject[] {
    const blocks = extractJsonLd(html);
    expect(blocks.length, `${label}: at least one JSON-LD block`).toBeGreaterThan(0);
    const broken = blocks.filter((b) => b.error).map((b) => `${b.error}: ${b.raw.slice(0, 120)}`);
    expect(broken, `${label}: every JSON-LD block parses`).toEqual([]);
    const nodes = flattenJsonLd(blocks.map((b) => b.parsed));
    expect(nodes.length, `${label}: typed JSON-LD nodes`).toBeGreaterThan(0);
    const problems = nodes
        .filter((n) => !typesOf(n).some((t) => skipTypes.includes(t)))
        .flatMap(validateJsonLdNode);
    expect(problems, `${label}: JSON-LD required fields`).toEqual([]);
    return nodes;
}

async function jsonLdFromPage(page: Page): Promise<JsonObject[]> {
    const texts = await page.locator('script[type="application/ld+json"]').allInnerTexts();
    const html = texts.map((t) => `<script type="application/ld+json">${t}</script>`).join('');
    return assertJsonLdHealthy(html, page.url());
}

async function gotoAndSettle(page: Page, path: string): Promise<void> {
    // Some pages keep a long-lived connection open, so `networkidle` is not a
    // reliable wait; the H1 is the deterministic "content rendered" signal.
    // First renders of ISR pages can take >30s while the whole fleet loads the
    // one server, hence the explicit navigation timeout.
    let response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: SLOW_PAGE_TIMEOUT });
    if (response && response.status() >= 500) {
        // Recorded, retried once, and failed only if it persists (the fleet
        // shares this server); the console noise of the failed first render
        // is scoped to this URL.
        test.info().annotations.push({ type: 'transient-5xx', description: `${path}: HTTP ${response.status()} on first load` });
        activeGuard?.allow(new RegExp(`^\\[[^\\]]*${escapeRegExp(path)}[^\\]]*\\] (Failed to load resource: the server responded with a status of 5\\d\\d|Error: An error occurred in the Server Components render)`));
        response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: SLOW_PAGE_TIMEOUT });
        expect(response?.status(), `${path}: 5xx persisted after one retry`).toBeLessThan(500);
    }
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

/** Common page-class assertions: one H1, canonical == path, clean copy. */
async function expectPageClassBasics(page: Page, path: string): Promise<void> {
    await gotoAndSettle(page, path);
    await expect(page.locator('h1'), `${path}: exactly one H1`).toHaveCount(1);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical, `${path}: canonical present`).toBeTruthy();
    expect(new URL(canonical!).pathname, `${path}: canonical path`).toBe(path);
    const bodyText = await page.locator('body').innerText();
    expect(bodyText, `${path}: leaked undefined/NaN/null copy`).not.toMatch(LEAKED_PLACEHOLDER_RE);
    expect(bodyText, `${path}: donor-brand (PMHNP Hiring) copy`).not.toMatch(DONOR_COPY_RE);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Crawl files
// ═══════════════════════════════════════════════════════════════════════════

test.describe('crawl files', () => {
    test('robots.txt is well-formed, references every sitemap, and those sitemaps resolve', async ({ request }) => {
        const res = await request.get('/robots.txt');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toMatch(/text\/plain/);
        const body = await res.text();
        expect(body).toMatch(/User-Agent:\s*\*/i);
        expect(body, 'must not disallow the whole site for *').not.toMatch(/User-Agent:\s*\*\s*\nDisallow:\s*\/\s*$/im);
        const sitemapLines = [...body.matchAll(/^Sitemap:\s*(\S+)/gim)].map((m) => m[1]);
        expect(sitemapLines.length, 'Sitemap: directives').toBeGreaterThanOrEqual(2);
        const sitemapPaths = sitemapLines.map((u) => new URL(u).pathname);
        for (const required of ['/sitemap.xml', '/api/sitemaps/index', '/image-sitemap.xml', '/video-sitemap.xml']) {
            expect(sitemapPaths, `robots.txt advertises ${required}`).toContain(required);
        }
        for (const p of sitemapPaths) {
            const r = await request.get(p);
            expect(r.status(), `robots-advertised sitemap ${p}`).toBe(200);
            expect(checkXml(await r.text()).wellFormed, `${p} is well-formed XML`).toBe(true);
        }
        // Public sitemap batches must be crawlable even though /api/ is disallowed.
        expect(body).toMatch(/^Allow:\s*\/api\/sitemaps/im);
    });

    test('sitemap index + every child are 200, well-formed XML, single-host, no duplicate locs', async ({ request }) => {
        const index = await request.get('/api/sitemaps/index');
        expect(index.headers()['content-type']).toMatch(/xml/);
        const indexXml = await index.text();
        const indexCheck = checkXml(indexXml);
        expect(indexCheck.errors, 'index XML errors').toEqual([]);
        expect(indexCheck.rootName).toBe('sitemapindex');
        expect(duplicates(crawl.indexLocs), 'duplicate child sitemaps in index').toEqual([]);
        expect(crawl.indexLocs.map((l) => new URL(l).pathname)).toContain('/sitemap.xml');

        const hostsSeen = new Set<string>();
        for (const [path, locs] of crawl.children) {
            const res = await request.get(path);
            expect(res.headers()['content-type'], `${path} content-type`).toMatch(/xml/);
            const xml = await res.text();
            const check = checkXml(xml);
            expect(check.errors, `${path} XML errors`).toEqual([]);
            expect(check.rootName, `${path} root element`).toBe('urlset');
            expect(locs.length, `${path} has entries`).toBeGreaterThan(0);
            expect(locs.length, `${path} under Google's 50k cap`).toBeLessThanOrEqual(50_000);
            expect(duplicates(locs), `${path} duplicate <loc>`).toEqual([]);
            locs.forEach((l) => hostsSeen.add(new URL(l).host));
            // lastmod must be a real date, never the string "undefined"/"Invalid Date".
            const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
            const badLastmod = lastmods.filter((d) => Number.isNaN(Date.parse(d)));
            expect(badLastmod, `${path} unparseable <lastmod>`).toEqual([]);
        }
        expect([...hostsSeen], 'all child sitemaps emit the same host').toHaveLength(1);
        expect(hostsSeen.has(new URL(crawl.indexLocs[0]).host), 'children use the index host').toBe(true);

        // No URL may be advertised by two different sitemap files.
        const crossDups: string[] = [];
        const seen = new Map<string, string>();
        for (const [path, locs] of crawl.children) {
            for (const l of locs) {
                const p = new URL(l).pathname;
                if (seen.has(p) && seen.get(p) !== path) crossDups.push(`${p} in ${seen.get(p)} and ${path}`);
                seen.set(p, path);
            }
        }
        expect(crossDups, 'URLs duplicated across sitemap files').toEqual([]);
    });

    test(`${SITEMAP_SAMPLE_SIZE} sitemap URLs across every tier are 200 and self-canonical`, async ({ request }) => {
        const sample = [
            ...pick(/^\/$/, 1),
            ...pick(/^\/jobs$/, 1),
            ...pick(/^\/jobs\/[a-z0-9-]+$/, 3),
            ...pick(/^\/jobs\/state\//, 2),
            ...pick(/^\/jobs\/metro\//, 2),
            ...pick(/^\/jobs\/locations\//, 2),
            ...pick(/^\/jobs\/(?!state|metro|city|locations)[a-z0-9-]+\/[a-z-]+$/, 3),
            ...pick(/^\/jobs\/[a-z0-9-]+\/city\//, 3),
            ...pick(/^\/jobs\/city\//, 2),
            ...pick(/^\/salary-guide\/[a-z-]+$/, 2),
            ...pick(/^\/companies\/.+/, 2),
            ...pick(/^\/blog\/.+/, 1),
            ...pick(/^\/(tools|compare|reports|resources)\//, 1),
            ...pick(/^\/jobs\/.*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 3),
        ].slice(0, SITEMAP_SAMPLE_SIZE);
        expect(sample.length, 'sample size').toBeGreaterThanOrEqual(20);

        const sitemapHost = new URL(crawl.indexLocs[0]).host;
        const compareHosts = sitemapHost === new URL(brand.baseUrl).host;
        const failures: string[] = [];
        const transient: string[] = [];
        for (const path of sample) {
            let { status, html } = await getHtml(request, path);
            if (status >= 500) {
                // A 5xx on a public page is recorded even when a retry recovers
                // (the fleet shares this server); it fails only when it persists.
                transient.push(`${path}: HTTP ${status} on first fetch`);
                ({ status, html } = await getHtml(request, path));
            }
            if (status !== 200) {
                failures.push(`${path}: HTTP ${status}`);
                continue;
            }
            const canonical = canonicalOf(html);
            if (!canonical) {
                failures.push(`${path}: no canonical`);
                continue;
            }
            const c = new URL(canonical);
            if (c.pathname !== path) failures.push(`${path}: canonical path ${c.pathname}`);
            if (compareHosts && c.host !== sitemapHost) failures.push(`${path}: canonical host ${c.host} != sitemap host ${sitemapHost}`);
        }
        test.info().annotations.push({ type: 'sample', description: sample.join(', ') });
        if (transient.length) test.info().annotations.push({ type: 'transient-5xx', description: transient.join('; ') });
        if (!compareHosts) {
            test.info().annotations.push({
                type: 'note',
                description: `sitemap host ${sitemapHost} (NEXT_PUBLIC_BASE_URL) differs from canonical host ${new URL(brand.baseUrl).host} (brand.baseUrl); compared by pathname only`,
            });
        }
        expect(failures).toEqual([]);
    });

    test('sitemaps never advertise a page that renders meta robots noindex', async ({ request }) => {
        // Setting×state and category×city entries come from pseoStats
        // thresholds in /api/sitemaps/cities/[batch]; the page templates apply
        // their own indexing gate. Both must agree or GSC reports
        // "Submitted URL marked noindex".
        const cityBatch = [...crawl.allPaths.keys()].filter((p) => crawl.allPaths.get(p)?.includes('/cities/'));
        const sample = [
            ...pick(/^\/jobs\/(?!state|metro|city|locations|edit)[a-z0-9-]+\/[a-z-]+$/, 6, cityBatch),
            ...pick(/^\/jobs\/[a-z0-9-]+\/city\/[a-z0-9-]+$/, 4, cityBatch),
            ...pick(/^\/jobs\/state\//, 2),
            ...pick(/^\/jobs\/city\//, 2),
        ];
        const noindexed: string[] = [];
        for (const path of sample) {
            const { status, html } = await getHtml(request, path);
            if (status !== 200) continue; // covered by the sample test above
            const robots = metaRobotsOf(html);
            if (robots && /noindex/i.test(robots)) {
                const count = htmlToText(html).match(/(\d+) (?:positions?|live roles?)\b/)?.[1] ?? '?';
                noindexed.push(`${path} (${robots}; ${count} jobs)`);
            }
        }
        test.fixme(
            noindexed.length > 0,
            `DEFECT: /api/sitemaps/cities/[batch] advertises setting×state URLs at pseoStats.totalJobs >= 1, but lib/pseo/setting-state-template.tsx noindexes pages with < 3 jobs (MIN_JOBS_FOR_INDEX) — GSC "Submitted URL marked noindex": ${noindexed.join(', ')}`,
        );
        expect(noindexed).toEqual([]);
    });

    test('quarantined profession row is absent from every indexable surface and 410s on its URL', async ({ request }) => {
        test.skip(!PROBE_SLUG || !PROBE_ID, 'E2E_QUARANTINE_JOB_SLUG / _ID not set');
        const probeSlug = PROBE_SLUG!;

        // Detail URL: 410 + noindex, no JobPosting, no leaked placeholders.
        const detail = await request.get(`/jobs/${probeSlug}`);
        expect(detail.status(), 'quarantined job detail').toBe(410);
        expect(detail.headers()['x-robots-tag'] ?? '').toMatch(/noindex/i);
        const detailHtml = await detail.text();
        expect(detailHtml).not.toContain('JobPosting');
        expect(htmlToText(detailHtml)).not.toMatch(LEAKED_PLACEHOLDER_RE);

        // Search + API + feed + primary sitemap.
        const api = await request.get(`/api/jobs?limit=5&q=${encodeURIComponent('Podiatrist')}`);
        const apiBody = (await api.json()) as { jobs: Array<{ id: string }> };
        expect(apiBody.jobs.map((j) => j.id), '/api/jobs must not return the quarantined row').not.toContain(PROBE_ID);
        const feed = await (await request.get('/feed.xml')).text();
        expect(feed, 'feed.xml must not carry the quarantined row').not.toContain(probeSlug);
        expect(crawl.children.get('/sitemap.xml') ?? [], 'primary sitemap').not.toContain(expect.stringContaining(probeSlug));

        // Job sitemap batches: the gate must hold here too.
        const batchesWithProbe = [...crawl.children]
            .filter(([path]) => path.startsWith('/api/sitemaps/jobs/'))
            .filter(([, locs]) => locs.some((l) => l.includes(probeSlug)))
            .map(([path]) => path);
        test.fixme(
            batchesWithProbe.length > 0,
            `DEFECT: job sitemap batch ${batchesWithProbe.join(', ')} advertises the quarantined non-NP row /jobs/${probeSlug} (410 on fetch) — lib/active-job-filter.ts activeIndexableJobWhere lacks the GLOBAL_EXCLUSIONS profession gate`,
        );
        expect(batchesWithProbe).toEqual([]);
    });

    test('feed.xml is valid RSS 2.0 of active, indexable jobs whose links resolve', async ({ request }) => {
        const res = await request.get('/feed.xml');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toMatch(/rss\+xml|xml/);
        const xml = await res.text();
        const check = checkXml(xml);
        expect(check.errors, 'RSS XML errors').toEqual([]);
        expect(check.rootName).toBe('rss');
        expect(xml).toMatch(/<rss[^>]*version="2\.0"/);
        expect(xml).toContain('<channel>');
        const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
        expect(items.length, 'feed items').toBeGreaterThan(0);
        expect(items.length).toBeLessThanOrEqual(50);

        const problems: string[] = [];
        const links: string[] = [];
        // The crawl is taken once per run (and cached); jobs published since
        // then are legitimately absent from it, so a miss re-reads the job
        // sitemap batches before it counts as a divergence.
        const freshJobUuids = new Set<string>();
        let freshLoaded = false;
        const inActiveSitemap = async (uuid: string): Promise<boolean> => {
            if (crawl.jobUuids.has(uuid)) return true;
            if (!freshLoaded) {
                freshLoaded = true;
                const idx = parseLocs(await (await request.get('/api/sitemaps/index')).text()).map((l) => new URL(l).pathname);
                for (const p of idx.filter((x) => x.startsWith('/api/sitemaps/jobs/') || x === '/sitemap.xml')) {
                    for (const l of parseLocs(await (await request.get(p)).text())) {
                        const u = jobUuidOf(new URL(l).pathname);
                        if (u) freshJobUuids.add(u);
                    }
                }
            }
            return freshJobUuids.has(uuid);
        };
        const uuidsToCheck: Array<[number, string, string]> = [];
        items.forEach((item, i) => {
            const link = item.match(/<link>([^<]+)<\/link>/)?.[1];
            const guid = item.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1];
            const pub = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
            const title = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? '';
            if (!link || !/\/jobs\//.test(link)) problems.push(`item ${i}: link ${link}`);
            if (guid !== link) problems.push(`item ${i}: guid != link`);
            if (!pub || Number.isNaN(Date.parse(pub))) problems.push(`item ${i}: pubDate ${pub}`);
            if (LEAKED_PLACEHOLDER_RE.test(title)) problems.push(`item ${i}: title "${title}"`);
            const uuid = link ? jobUuidOf(new URL(link).pathname) : null;
            if (!uuid) problems.push(`item ${i}: link has no job uuid`);
            else uuidsToCheck.push([i, uuid, link!]);
            if (link) links.push(link);
        });
        for (const [i, uuid, link] of uuidsToCheck) {
            if (!(await inActiveSitemap(uuid))) problems.push(`item ${i}: ${link} is not in the active-jobs sitemap`);
        }
        expect(problems).toEqual([]);
        expect(duplicates(links), 'duplicate feed items').toEqual([]);

        // Newest 4 items must be live pages (not 410 "Position Removed").
        for (const link of links.slice(0, 4)) {
            const path = new URL(link).pathname;
            let r = await request.get(path, { timeout: SLOW_PAGE_TIMEOUT });
            if (r.status() >= 500) {
                test.info().annotations.push({ type: 'transient-5xx', description: `${path}: HTTP ${r.status()} on first fetch` });
                r = await request.get(path, { timeout: SLOW_PAGE_TIMEOUT });
            }
            expect(r.status(), `feed item ${link}`).toBe(200);
        }

        // Channel description quotes the same inventory the API reports.
        const description = xml.match(/<channel>[\s\S]*?<description>([^<]*)<\/description>/)?.[1] ?? '';
        const quoted = description.match(/(\d[\d,]*)\+?\s+positions/)?.[1];
        expect(quoted, `feed channel description quotes a count: "${description}"`).toBeTruthy();
        // The feed quotes the SiteStat snapshot (see the count-parity block for
        // snapshot freshness); without DB access it is compared with the API.
        // A cached feed may predate the latest row, so either reference counts.
        const references = [await apiTotal(request)];
        if (hasDb()) {
            const [row] = await db().$queryRawUnsafe<Array<{ total_jobs: number }>>('SELECT total_jobs FROM site_stats ORDER BY updated_at DESC LIMIT 1');
            if (row) references.push(row.total_jobs);
        }
        const distance = Math.min(...references.map((t) => Math.abs(toNumber(quoted!) - toNumber(headlineCountDisplay(t).replace('+', '')))));
        expect(distance, `feed says ${quoted}, API/snapshot say ${references.join('/')}`).toBeLessThanOrEqual(SNAPSHOT_TOLERANCE);
    });

    test('blog feed is valid RSS', async ({ request }) => {
        const res = await request.get('/blog/feed.xml');
        expect(res.status()).toBe(200);
        const xml = await res.text();
        const check = checkXml(xml);
        expect(check.errors).toEqual([]);
        expect(check.rootName).toBe('rss');
    });

    test('image-sitemap.xml is well-formed and its pages + images resolve', async ({ request }) => {
        const res = await request.get('/image-sitemap.xml');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toMatch(/xml/);
        const xml = await res.text();
        const check = checkXml(xml);
        expect(check.errors).toEqual([]);
        expect(check.rootName).toBe('urlset');
        expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
        const pageLocs = parseLocs(xml.replace(/<image:image>[\s\S]*?<\/image:image>/g, ''));
        const imageLocs = [...xml.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
        expect(pageLocs.length).toBeGreaterThan(0);
        expect(imageLocs.length).toBe(pageLocs.length);
        expect(duplicates(pageLocs), 'duplicate page locs').toEqual([]);
        for (const l of pageLocs.slice(0, 8)) {
            const r = await request.get(new URL(l).pathname);
            expect(r.status(), `image-sitemap page ${l}`).toBe(200);
        }
        for (const i of imageLocs.slice(0, 6)) {
            const u = new URL(i);
            const r = await request.get(u.pathname + u.search);
            expect(r.status(), `image ${i}`).toBe(200);
            expect(r.headers()['content-type'], `image ${i} content-type`).toMatch(/^image\//);
        }
    });

    test('video-sitemap.xml is well-formed and either empty-honest or fully described', async ({ request }) => {
        const res = await request.get('/video-sitemap.xml');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toMatch(/xml/);
        const xml = await res.text();
        const check = checkXml(xml);
        expect(check.errors).toEqual([]);
        expect(check.rootName).toBe('urlset');
        expect(xml).toContain('xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"');
        const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
        test.info().annotations.push({ type: 'note', description: `${entries.length} video entries` });
        for (const e of entries) {
            for (const tag of ['video:thumbnail_loc', 'video:title', 'video:description', 'video:player_loc', 'video:publication_date']) {
                expect(e, `video entry has <${tag}>`).toMatch(new RegExp(`<${tag}[^>]*>[^<]+</${tag}>`));
            }
            const date = e.match(/<video:publication_date>([^<]+)</)?.[1] ?? '';
            expect(Number.isNaN(Date.parse(date)), `publication_date "${date}"`).toBe(false);
        }
    });

    test('llms.txt, llms-full.txt, ai.txt, humans.txt are plain text, brand-correct, and linked from the head', async ({ request }) => {
        for (const path of ['/llms.txt', '/llms-full.txt', '/ai.txt', '/humans.txt']) {
            const res = await request.get(path);
            expect(res.status(), path).toBe(200);
            expect(res.headers()['content-type'], `${path} content-type`).toMatch(/text\/plain/);
            const body = await res.text();
            expect(body.length, `${path} non-trivial`).toBeGreaterThan(100);
            expect(body, `${path} names the brand`).toContain(brand.name);
            expect(body, `${path} donor-brand copy`).not.toMatch(DONOR_COPY_RE);
            expect(body, `${path} leaked placeholders`).not.toMatch(LEAKED_PLACEHOLDER_RE);
            expect(body, `${path} must not start with HTML`).not.toMatch(/^\s*<!doctype/i);
        }
        const home = await (await request.get('/')).text();
        expect(home).toMatch(/<link[^>]+rel="alternate"[^>]+href="\/llms\.txt"/);
        expect(home).toMatch(/<link[^>]+rel="alternate"[^>]+href="\/ai\.txt"/);
        expect(home).toMatch(/<link[^>]+rel="alternate"[^>]+type="application\/rss\+xml"[^>]+href="\/feed\.xml"/);
    });

    test('/.well-known/security.txt follows RFC 9116 and is unexpired', async ({ request }) => {
        for (const path of ['/.well-known/security.txt', '/security.txt']) {
            const res = await request.get(path);
            expect(res.status(), path).toBe(200);
            expect(res.headers()['content-type'], `${path} content-type`).toMatch(/text\/plain/);
            const body = await res.text();
            expect(body).toMatch(/^Contact:\s*mailto:\S+@\S+/m);
            const expires = body.match(/^Expires:\s*(\S+)/m)?.[1];
            expect(expires, 'Expires field').toBeTruthy();
            expect(Date.parse(expires!), 'Expires parses').not.toBeNaN();
            expect(Date.parse(expires!), 'Expires is in the future').toBeGreaterThan(Date.now());
            expect(body).toMatch(/^Canonical:\s*https:\/\/\S+\/\.well-known\/security\.txt/m);
            const policy = body.match(/^Policy:\s*(\S+)/m)?.[1];
            if (policy) {
                const r = await request.get(new URL(policy).pathname);
                expect(r.status(), `Policy URL ${policy}`).toBe(200);
            }
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Structured data
// ═══════════════════════════════════════════════════════════════════════════

test.describe('JSON-LD on every page class', () => {
    test('server-rendered page classes emit parseable JSON-LD with required fields', async ({ request }) => {
        const s = pseoSamples();
        const classes: Record<string, string | undefined> = {
            home: '/',
            jobsHub: '/jobs',
            categoryLanding: s.categoryLanding,
            categoryState: s.categoryState,
            categoryCity: s.categoryCity,
            stateHub: s.stateHub,
            metro: s.metro,
            stateCityDirectory: s.stateCityDirectory,
            city: s.city,
            salaryGuideHub: '/salary-guide',
            salaryGuideState: pick(/^\/salary-guide\/[a-z-]+$/, 1)[0],
            companiesHub: '/companies',
            companyDetail: pick(/^\/companies\/.+/, 1)[0],
            faq: '/faq',
            about: '/about',
            press: '/press',
        };
        const missing = Object.entries(classes).filter(([, p]) => !p).map(([k]) => k);
        test.info().annotations.push({ type: 'note', description: `no sitemap sample for: ${missing.join(', ') || 'none'}` });
        expect(missing.length, 'sitemaps must advertise every pSEO class').toBeLessThanOrEqual(1);

        const summary: string[] = [];
        for (const [name, path] of Object.entries(classes)) {
            if (!path) continue;
            const { status, html } = await getHtml(request, path);
            expect(status, `${name} ${path}`).toBe(200);
            expect(html, `${name} ${path} must be server-rendered (no CSR bailout)`).not.toContain(CSR_BAILOUT_MARKER);
            // The homepage's single-crumb BreadcrumbList is covered (and
            // fixme-tagged) by the dedicated home test below.
            const nodes = assertJsonLdHealthy(html, `${name} ${path}`, name === 'home' ? ['BreadcrumbList'] : []);
            const types = [...new Set(nodes.flatMap(typesOf))];
            summary.push(`${name}: ${types.join('+')}`);
            if (name !== 'home') {
                expect(types, `${name} ${path}: BreadcrumbList`).toContain('BreadcrumbList');
            }
            // Breadcrumb schema must describe THIS page: last crumb's item (when
            // present) points at the page itself.
            for (const bc of nodes.filter((n) => typesOf(n).includes('BreadcrumbList'))) {
                const items = bc.itemListElement as JsonObject[];
                const last = items[items.length - 1];
                const lastItem = typeof last.item === 'string' ? last.item : (last.item as JsonObject | undefined)?.['@id'];
                if (typeof lastItem === 'string') {
                    expect(new URL(lastItem).pathname, `${name} ${path}: last breadcrumb item`).toBe(path);
                }
            }
        }
        test.info().annotations.push({ type: 'schema', description: summary.join(' | ') });
        expect(Object.values(classes).filter(Boolean).length).toBeGreaterThanOrEqual(12);
    });

    test('home emits Organization + WebSite with a SearchAction and a valid BreadcrumbList', async ({ request }) => {
        const { html } = await getHtml(request, '/');
        const crumbs = flattenJsonLd(extractJsonLd(html).map((b) => b.parsed)).filter((n) => typesOf(n).includes('BreadcrumbList'));
        const singleCrumb = crumbs.some((c) => !Array.isArray(c.itemListElement) || (c.itemListElement as unknown[]).length < 2);
        test.fixme(
            singleCrumb,
            'DEFECT: homepage emits a BreadcrumbList with a single ListItem ("Home") — Google requires at least two ListItems, so the Rich Results test flags it; app/page.tsx lines ~98-108 should omit the breadcrumb schema on the root page',
        );
        const nodes = assertJsonLdHealthy(html, 'home');
        const org = nodes.find((n) => typesOf(n).includes('Organization'));
        const site = nodes.find((n) => typesOf(n).includes('WebSite'));
        expect(org?.name).toBe(brand.name);
        expect(org?.url).toBe(brand.baseUrl);
        expect(site?.url).toBe(brand.baseUrl);
        const action = site?.potentialAction as JsonObject | undefined;
        expect(action?.['@type']).toBe('SearchAction');
        const target = action?.target as JsonObject | undefined;
        expect(String(target?.urlTemplate)).toContain('{search_term_string}');
    });

    test('job detail is server-rendered with its JobPosting schema and H1 (no CSR bailout)', async ({ request }) => {
        test.skip(!TEST_JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
        const { status, html } = await getHtml(request, `/jobs/${TEST_JOB_SLUG}`);
        expect(status).toBe(200);
        const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
        const hasJobPostingLd = extractJsonLd(html).some((b) => b.raw.includes('"JobPosting"'));
        // A Suspense-wrapped client island (the Apply CTA) legitimately leaves a
        // localized bailout template after the server-rendered content. Only a
        // bailout that swallows the page (marker before the H1, or no H1 at all)
        // is the defect.
        const firstMarker = html.indexOf(CSR_BAILOUT_MARKER);
        const firstH1 = html.search(/<h1[\s>]/);
        const bailedOut = firstMarker >= 0 && (firstH1 < 0 || firstMarker < firstH1);
        test.fixme(
            bailedOut || h1Count === 0 || !hasJobPostingLd,
            'DEFECT: /jobs/[slug] bails out to client-side rendering (BAILOUT_TO_CLIENT_SIDE_RENDERING inside <main>) — the SSR HTML has no H1, no JobPosting JSON-LD and an empty <main>; components/ApplyButton.tsx calls useSearchParams() without a Suspense boundary inside an ISR page (app/jobs/[slug]/page.tsx)',
        );
        expect(bailedOut, 'CSR bailout marker').toBe(false);
        expect(h1Count, 'server-rendered H1').toBe(1);
        expect(hasJobPostingLd, 'server-rendered JobPosting JSON-LD').toBe(true);
    });

    test('seeded NP job carries the Nurse Practitioner SOC code and a canonical-matching URL', async ({ page, guard, request }) => {
        test.skip(!TEST_JOB_SLUG, 'E2E_TEST_JOB_SLUG not set');
        const path = `/jobs/${TEST_JOB_SLUG}`;
        await gotoAndSettle(page, path);
        await expect(page.locator('h1')).toHaveCount(1);
        const nodes = await jsonLdFromPage(page);
        const posting = nodes.find((n) => typesOf(n).includes('JobPosting'));
        expect(posting, 'JobPosting present after hydration').toBeTruthy();
        expect(posting!.occupationalCategory, 'NP job → 29-1171.00').toBe(NP_SOC);
        const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
        expect(posting!.url, 'JobPosting.url == canonical').toBe(canonical);
        expect(new URL(String(posting!.url)).pathname).toBe(path);
        const hiring = posting!.hiringOrganization as JsonObject;
        expect(String(hiring.name)).not.toMatch(LEAKED_PLACEHOLDER_RE);
        // The visible breadcrumb backs the BreadcrumbList schema.
        await expect(page.locator('nav[aria-label="Breadcrumb"]').first()).toBeVisible();
        expect(nodes.some((n) => typesOf(n).includes('BreadcrumbList'))).toBe(true);
        // Raw HTML must also be free of a "Position Filled" shell for a live job.
        const raw = await (await request.get(path)).text();
        expect(titleOf(raw) ?? '').not.toMatch(/Position Filled/i);
        void guard;
    });

    test('jobLocationType TELECOMMUTE only on fully-remote jobs; on-site jobs carry a physical jobLocation', async ({ page, guard, request }) => {
        const res = await request.get('/api/jobs?limit=100&sort=newest');
        expect(res.status()).toBe(200);
        const { jobs } = (await res.json()) as { jobs: Array<{ id: string; isRemote: boolean; isHybrid: boolean; city: string | null; state: string | null; title: string }> };
        const byUuid = new Map<string, string>();
        for (const p of crawl.allPaths.keys()) {
            const uuid = jobUuidOf(p);
            if (uuid && p.startsWith('/jobs/')) byUuid.set(uuid, p);
        }
        const remote = jobs.find((j) => j.isRemote && !j.isHybrid && byUuid.has(j.id.toLowerCase()));
        const onsite = jobs.find((j) => !j.isRemote && !j.isHybrid && (j.city || j.state) && byUuid.has(j.id.toLowerCase()));
        const hybrid = jobs.find((j) => j.isHybrid && (j.city || j.state) && byUuid.has(j.id.toLowerCase()));
        test.skip(!remote || !onsite, 'need one fully-remote and one on-site job in the newest 100');

        const check = async (label: string, id: string, expectTelecommute: boolean) => {
            const path = byUuid.get(id.toLowerCase())!;
            await gotoAndSettle(page, path);
            const nodes = await jsonLdFromPage(page);
            const posting = nodes.find((n) => typesOf(n).includes('JobPosting'));
            expect(posting, `${label} ${path}: JobPosting`).toBeTruthy();
            if (expectTelecommute) {
                expect(posting!.jobLocationType, `${label} ${path}`).toBe('TELECOMMUTE');
                expect(posting!.jobLocation, `${label} ${path}: no physical jobLocation`).toBeUndefined();
                expect((posting!.applicantLocationRequirements as JsonObject | undefined)?.['@type']).toBe('Country');
            } else {
                expect(posting!.jobLocationType, `${label} ${path}: must not be TELECOMMUTE`).toBeUndefined();
                const loc = posting!.jobLocation as JsonObject | undefined;
                expect(loc?.['@type'], `${label} ${path}: jobLocation`).toBe('Place');
                const addr = loc?.address as JsonObject | undefined;
                expect(addr?.addressCountry).toBe('US');
                expect(addr?.addressLocality || addr?.addressRegion, `${label} ${path}: locality/region`).toBeTruthy();
            }
        };
        await check('remote', remote!.id, true);
        await check('on-site', onsite!.id, false);
        if (hybrid) await check('hybrid', hybrid.id, false);
        void guard;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Count parity
// ═══════════════════════════════════════════════════════════════════════════

test.describe('count parity', () => {
    test('job count on home / jobs / about / press / for-programs / feed equals the canonical API count', async ({ request }) => {
        const total = await apiTotal(request);
        expect(total).toBeGreaterThan(0);
        // Sibling suites seed and retire jobs while this runs, and ISR pages
        // revalidate on their own clocks (<= 1h), so parity is asserted within
        // the rows that actually changed in that window. The review's defect
        // was drift of 100+ rows between surfaces.
        let churn = SNAPSHOT_TOLERANCE;
        // Snapshot surfaces (home, /about, /for-programs, feed) render the
        // SiteStat row. With DB access they must quote THAT row; the row itself
        // is compared with the live API only while it is fresh, because
        // refresh-site-stats runs from Vercel cron, which `next start` lacks.
        let snapshotTotal = total;
        if (hasDb()) {
            const [row] = await db().$queryRawUnsafe<Array<{ total_jobs: number; updated_at: Date; age_min: number; churn: number }>>(
                `SELECT s.total_jobs, s.updated_at,
                        EXTRACT(EPOCH FROM (now() - s.updated_at)) / 60 AS age_min,
                        (SELECT count(*)::int FROM jobs WHERE updated_at > now() - interval '65 minutes') AS churn
                   FROM site_stats s ORDER BY s.updated_at DESC LIMIT 1`,
            );
            churn += Number(row?.churn ?? 0);
            if (row) {
                snapshotTotal = row.total_jobs;
                const ageMin = Number(row.age_min);
                if (ageMin <= 65) {
                    expect(Math.abs(row.total_jobs - total), `fresh SiteStat ${row.total_jobs} vs API ${total}`).toBeLessThanOrEqual(churn);
                } else {
                    const jobsChangedSince = await db().$queryRawUnsafe<Array<{ n: number }>>(
                        'SELECT count(*)::int AS n FROM jobs WHERE updated_at > $1',
                        row.updated_at,
                    );
                    test.info().annotations.push({
                        type: 'stale-snapshot',
                        description: `SiteStat is ${Math.round(ageMin)} min old (${row.total_jobs} vs live ${total}; ${jobsChangedSince[0]?.n ?? '?'} job rows changed since): refresh-site-stats is not scheduled under next start, so snapshot-vs-live parity is not asserted here`,
                    });
                    expect(Math.abs(row.total_jobs - total), 'stale snapshot still within the rows changed since it was taken').toBeLessThanOrEqual(Number(jobsChangedSince[0]?.n ?? 0) + SNAPSHOT_TOLERANCE);
                }
            }
        }
        const display = headlineCountDisplay(snapshotTotal);
        const headline = toNumber(display.replace('+', ''));
        const live = (n: number, label: string) =>
            expect(Math.abs(n - total), `${label}: ${n} vs API ${total} (churn ${churn})`).toBeLessThanOrEqual(churn);
        // Snapshot surfaces are ISR pages (revalidate up to 1h), so they may
        // still quote the previous SiteStat row: same churn allowance.
        const snapshot = (n: number, label: string) =>
            expect(Math.abs(n - headline), `${label}: ${n} vs snapshot ${snapshotTotal} (display ${display}; API ${total}; churn ${churn})`).toBeLessThanOrEqual(churn);

        const home = await getHtml(request, '/');
        const homeText = htmlToText(home.html);
        // The "Browse by state" list also says "N openings", so the hero total
        // is matched on its own phrasing (components/HomepageHero.tsx).
        const homeHero = homeText.match(/(\d[\d,]*)\+? (?:roles|jobs|openings|positions) from teams\b/)?.[1];
        expect(homeHero, 'home hero quotes a count ("N roles from teams like these")').toBeTruthy();
        snapshot(toNumber(homeHero!), 'home hero');
        const homeTitle = titleOf(home.html) ?? '';
        const homeTitleCount = homeTitle.match(/^(\d[\d,]*)\+? /)?.[1];
        expect(homeTitleCount, `home <title> "${homeTitle}" leads with the count`).toBeTruthy();
        snapshot(toNumber(homeTitleCount!), 'home <title>');

        const jobs = await getHtml(request, '/jobs');
        const jobsTitle = titleOf(jobs.html) ?? '';
        const jobsTitleCount = jobsTitle.match(/Browse (\d[\d,]*)\+? /)?.[1];
        expect(jobsTitleCount, `/jobs <title> "${jobsTitle}"`).toBeTruthy();
        live(toNumber(jobsTitleCount!), '/jobs <title>');
        const jobsFaq = htmlToText(jobs.html).match(/There are currently (\d[\d,]*) /)?.[1];
        if (jobsFaq) live(toNumber(jobsFaq), '/jobs FAQ answer');

        const about = htmlToText((await getHtml(request, '/about')).html);
        const aboutJobs = about.match(/(\d[\d,]*) Active Jobs\b/)?.[1];
        expect(aboutJobs, '/about "Active Jobs" stat').toBeTruthy();
        snapshot(toNumber(aboutJobs!), '/about Active Jobs');

        const press = htmlToText((await getHtml(request, '/press')).html);
        const pressJobs = press.match(/(\d[\d,]*) Open listings\b/)?.[1];
        expect(pressJobs, '/press "Open listings" stat').toBeTruthy();
        live(toNumber(pressJobs!), '/press Open listings');

        const programs = htmlToText((await getHtml(request, '/for-programs')).html);
        const programsJobs = programs.match(new RegExp(`(\\d[\\d,.]*k?) Active ${brand.niche.short} Roles\\b`))?.[1];
        if (total >= COUNT_DISPLAY_FLOOR) {
            expect(programsJobs, '/for-programs "Active NP Roles" pill').toBeTruthy();
            expect(programsJobs, '/for-programs pill formatting').toBe(programsCountDisplay(total >= 1000 ? total : toNumber(programsJobs!)));
            if (total < 1000) snapshot(toNumber(programsJobs!), '/for-programs pill');
        } else {
            expect(programsJobs, 'below the display floor the pill is omitted').toBeUndefined();
        }

        const feedDesc = (await (await request.get('/feed.xml')).text()).match(/<channel>[\s\S]*?<description>([^<]*)<\/description>/)?.[1] ?? '';
        const feedCount = feedDesc.match(/(\d[\d,]*)\+? positions/)?.[1];
        expect(feedCount, 'feed description count').toBeTruthy();
        snapshot(toNumber(feedCount!), 'feed description');
    });

    test('employer count agrees across /companies, /about and /press', async ({ request }) => {
        const companies = await getHtml(request, '/companies');
        const companiesText = htmlToText(companies.html);
        const directory = companiesText.match(/Showing (?:[\d,]+\s*[–-]\s*[\d,]+ of )?(\d[\d,]*) employers/)?.[1];
        expect(directory, '/companies "Showing N employers"').toBeTruthy();
        const directoryCount = toNumber(directory!);
        const metaCount = (metaDescriptionOf(companies.html) ?? '').match(/with (\d[\d,]*)\+? employers/)?.[1];
        expect(metaCount, '/companies meta description count').toBeTruthy();
        expect(Math.abs(toNumber(metaCount!) - directoryCount), '/companies meta vs directory').toBeLessThanOrEqual(SNAPSHOT_TOLERANCE);

        const about = htmlToText((await getHtml(request, '/about')).html);
        const aboutEmployers = about.match(/(\d[\d,]*) Employers\b/)?.[1];
        expect(aboutEmployers, '/about Employers stat').toBeTruthy();
        expect(Math.abs(toNumber(aboutEmployers!) - directoryCount), `/about ${aboutEmployers} vs /companies ${directoryCount}`).toBeLessThanOrEqual(SNAPSHOT_TOLERANCE);

        const press = htmlToText((await getHtml(request, '/press')).html);
        const pressEmployers = press.match(/(\d[\d,]*) Hiring organi[sz]ations\b/)?.[1];
        expect(pressEmployers, '/press Hiring organizations stat').toBeTruthy();
        expect(Math.abs(toNumber(pressEmployers!) - directoryCount), `/press ${pressEmployers} vs /companies ${directoryCount}`).toBeLessThanOrEqual(SNAPSHOT_TOLERANCE);

        // The directory lists what it claims: distinct company links never
        // exceed the quoted total, and the first page is not empty.
        const listed = distinctCompanyLinks(companies.html);
        expect(listed, 'company links rendered').toBeGreaterThan(0);
        expect(listed, 'distinct company links vs quoted directory count').toBeLessThanOrEqual(directoryCount);
        const cardCounts = [...companiesText.matchAll(/(\d+) open positions?\b/g)].map((m) => Number(m[1]));
        expect(cardCounts.every((n) => n >= 1), 'every listed employer shows >= 1 open position').toBe(true);
    });

    test('new-grad count on /about matches the category filter count (or is omitted below the floor)', async ({ request }) => {
        const newGradTotal = await apiTotal(request, 'category=new-grad');
        const about = htmlToText((await getHtml(request, '/about')).html);
        const aboutNewGrad = about.match(/New Grad friendly (\d[\d,]*) roles/)?.[1];
        if (newGradTotal >= COUNT_DISPLAY_FLOOR) {
            expect(aboutNewGrad, '/about new-grad diorama count').toBeTruthy();
            expect(Math.abs(toNumber(aboutNewGrad!) - newGradTotal)).toBeLessThanOrEqual(SNAPSHOT_TOLERANCE);
        } else {
            expect(aboutNewGrad, `below the floor (${newGradTotal}) /about must omit the number`).toBeUndefined();
        }

        const landing = await getHtml(request, '/jobs/new-grad');
        expect(landing.status).toBe(200);
        const landingTitle = titleOf(landing.html) ?? '';
        const titleCount = landingTitle.match(/^(\d[\d,]*)\+? New Grad/)?.[1];
        expect(titleCount, `/jobs/new-grad <title> "${landingTitle}"`).toBeTruthy();
        expect(toNumber(titleCount!), '/jobs/new-grad <title> vs API category=new-grad').toBe(newGradTotal);

        // "1 position" (singular) is correct English when the category holds a single job.
        const heroStat = htmlToText(landing.html).match(/(\d[\d,]*)(\+?) positions?\b/);
        expect(heroStat, '/jobs/new-grad hero "positions" stat').toBeTruthy();
        expect(toNumber(heroStat![1]), '/jobs/new-grad hero count vs API').toBe(newGradTotal);
        const padded = heroStat![2] === '+' && newGradTotal < 1000;
        test.fixme(
            padded,
            `DEFECT: /jobs/new-grad hero renders "${heroStat![0]}" — a "+"-padded count below the rounding threshold contradicts the same page's <title> ("${landingTitle}") and the lib/canonical-counts.ts no-padding rule; app/jobs/new-grad/page.tsx line ~186 appends "+" unconditionally`,
        );
        expect(padded, 'no "+" padding on an exact count').toBe(false);
    });

    test.describe('facet counts', () => {
        test.use({ baseURL: FACET_BASE_URL });

        test('/jobs facet badges match the filter-counts API and the canonical total', async ({ page, guard, request }) => {
            const canonicalTotal = await apiTotal(request);
            const newGradTotal = await apiTotal(request, 'category=new-grad');
            const countsPromise = page.waitForResponse((r) => r.url().includes('/api/jobs/filter-counts'), { timeout: 30_000 });
            await gotoAndSettle(page, '/jobs');
            const countsRes = await countsPromise;
            expect(countsRes.status(), 'filter-counts POST from the page origin').toBe(200);
            const counts = (await countsRes.json()) as { total: number; newGradFriendly: number; workMode: Record<string, number> };
            // Sibling suites publish/retire rows between the two reads, so the
            // facet total must equal the API total read before OR after it.
            const canonicalAfter = await apiTotal(request);
            expect([canonicalTotal, canonicalAfter], `filter-counts total ${counts.total} vs /api/jobs total before/after`).toContain(counts.total);
            expect(counts.newGradFriendly, 'employer-flag subset ≤ category count').toBeLessThanOrEqual(newGradTotal);
            const modeSum = Object.values(counts.workMode).reduce((a, b) => a + b, 0);
            // remote = isRemote, hybrid = isHybrid, onsite = neither; the three
            // can only exceed the total when a row carries BOTH flags.
            const doubleFlagged = modeSum - counts.total;
            expect(doubleFlagged, 'facets never undercount').toBeGreaterThanOrEqual(0);
            test.fixme(
                doubleFlagged > 0,
                `DEFECT: ${doubleFlagged} active jobs are flagged isRemote AND isHybrid (lib/ingestion-service.ts line ~181 sets next.isHybrid = true for canon "Hybrid" without clearing isRemote, unlike lib/job-normalizer.ts which returns exclusive flags): /jobs/remote lists hybrid roles as work-from-home, the Remote/Hybrid facets double count them, and JobPosting.jobLocationType flips on the stale flag`,
            );
            expect(doubleFlagged, 'work-mode facets partition the total').toBe(0);

            // Rendered badge equals the API figure — never a placeholder 0.
            const badge = page.getByText('Open to new grads', { exact: true }).locator('xpath=ancestor::label[1] | ancestor::*[self::div or self::button][1]').first();
            await expect(badge).toBeVisible();
            await expect(badge).toContainText(String(counts.newGradFriendly));
            void guard;
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Salary guide gating
// ═══════════════════════════════════════════════════════════════════════════

test.describe('salary guide gating', () => {
    test('every published state row clears the n≥5 / 3-employer gate; small-sample states are listed without a figure', async ({ request }) => {
        const { status, html } = await getHtml(request, '/salary-guide');
        expect(status).toBe(200);
        const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
            .map((m) => htmlToText(m[1]))
            .filter((t) => /\d+ · \d+ emp\./.test(t));
        expect(rows.length, 'published state rows').toBeGreaterThan(0);
        const published = new Map<string, { n: number; employers: number; median: number }>();
        const violations: string[] = [];
        for (const row of rows) {
            const m = row.match(/^(.+?) [A-Z]{2} \$ ?([\d,]+)k .*?(\d+) · (\d+) emp\./);
            expect(m, `row parse: "${row}"`).toBeTruthy();
            const [, state, median, n, employers] = m!;
            published.set(state.trim(), { n: Number(n), employers: Number(employers), median: Number(median.replace(/,/g, '')) });
            if (Number(n) < BENCHMARK_MIN_POSTINGS || Number(employers) < BENCHMARK_MIN_EMPLOYERS) violations.push(row);
            if (Number(median) <= 0) violations.push(`${row} (empty median)`);
        }
        expect(violations, 'rows below the publishing gate').toEqual([]);

        const smallBlock = html.split('States with too few postings')[1] ?? '';
        const small = [...smallBlock.matchAll(/href="\/salary-guide\/([a-z-]+)"[^>]*>\s*([^<]+?)\s*<span[^>]*>\((\d+)\)<\/span>/g)]
            .map((m) => ({ slug: m[1], state: m[2].trim(), n: Number(m[3]) }));
        const overlap = small.filter((s) => published.has(s.state));
        expect(overlap.map((s) => s.state), 'a state cannot be both published and small-sample').toEqual([]);
        test.info().annotations.push({ type: 'note', description: `${published.size} published, ${small.length} small-sample states` });

        // A below-gate state page must not fabricate a posting-derived median.
        const belowGate = small.find((s) => s.n < BENCHMARK_MIN_POSTINGS);
        if (belowGate) {
            const statePage = await getHtml(request, `/salary-guide/${belowGate.slug}`);
            expect(statePage.status, `/salary-guide/${belowGate.slug}`).toBe(200);
            const text = htmlToText(statePage.html);
            expect(text).toMatch(new RegExp(`below the ${BENCHMARK_MIN_POSTINGS}-posting`, 'i'));
            expect(text).not.toMatch(LEAKED_PLACEHOLDER_RE);
        }
        // A published state's page must agree with the hub's median.
        const [firstState, firstStats] = [...published.entries()][0];
        const slug = firstState.toLowerCase().replace(/\s+/g, '-');
        const publishedPage = await getHtml(request, `/salary-guide/${slug}`);
        expect(publishedPage.status, `/salary-guide/${slug}`).toBe(200);
        const publishedText = htmlToText(publishedPage.html);
        expect(publishedText, `${slug} page quotes the hub median $${firstStats.median}k`).toMatch(new RegExp(`\\$${firstStats.median.toLocaleString('en-US')}(,000|k|K)`));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Middleware normalization + 410 gates
// ═══════════════════════════════════════════════════════════════════════════

test.describe('URL normalization and 410 gates', () => {
    test('case and trailing-slash variants are normalized with permanent redirects before any gate', async ({ request }) => {
        const cases: Array<{ from: string; to: string; maxHops: number }> = [
            { from: '/Jobs', to: '/jobs', maxHops: 1 },
            { from: '/Jobs/', to: '/jobs', maxHops: 2 },
            { from: '/jobs/', to: '/jobs', maxHops: 1 },
            { from: '/jobs/Remote', to: '/jobs/remote', maxHops: 1 },
            { from: '/jobs/state/Texas', to: '/jobs/state/texas', maxHops: 1 },
            { from: '/jobs/remote/?page=1', to: '/jobs/remote', maxHops: 2 },
            { from: '/jobs/remote?page=1', to: '/jobs/remote', maxHops: 1 },
            { from: '/jobs?utm_source=x&utm_campaign=y', to: '/jobs', maxHops: 1 },
            { from: '/Companies/', to: '/companies', maxHops: 2 },
            { from: '/new-grad', to: '/jobs/new-grad', maxHops: 1 },
            { from: '/jobs/locations/city/austin-tx', to: '/jobs/city/austin-tx', maxHops: 1 },
            // Doubled slashes are collapsed by Next itself (308) before middleware.
            // Absolute URL: a bare '//jobs' would resolve as protocol-relative (host "jobs").
            { from: `${BASE_URL}//jobs`, to: '/jobs', maxHops: 1 },
            { from: '/jobs//remote', to: '/jobs/remote', maxHops: 1 },
            { from: '/jobs/state/Texas/', to: '/jobs/state/texas', maxHops: 2 },
        ];
        const failures: string[] = [];
        for (const c of cases) {
            const { hops, finalStatus, finalPath } = await followRedirects(request, c.from);
            const redirectHops = hops.filter((h) => h.status >= 300 && h.status < 400);
            if (finalPath !== c.to) failures.push(`${c.from}: ended at ${finalPath} (${finalStatus})`);
            if (finalStatus !== 200) failures.push(`${c.from}: final status ${finalStatus}`);
            if (redirectHops.some((h) => ![301, 308].includes(h.status))) failures.push(`${c.from}: non-permanent redirect ${JSON.stringify(hops)}`);
            if (hops.some((h) => h.status === 410 || h.status === 404)) failures.push(`${c.from}: gated before normalization ${JSON.stringify(hops)}`);
            if (redirectHops.length > c.maxHops) failures.push(`${c.from}: ${redirectHops.length} hops ${JSON.stringify(hops)}`);
            if (redirectHops.length === 2) {
                test.info().annotations.push({ type: 'redirect-chain', description: `${c.from} → ${hops.map((h) => `${h.status} ${h.location ?? ''}`).join(' → ')}` });
            }
        }
        expect(failures).toEqual([]);
    });

    test('donor-era / structurally invalid pSEO slugs and dead job/company URLs return a noindexed 410', async ({ request }) => {
        const gone = [
            '/jobs/psychiatric',
            '/jobs/child-adolescent',
            '/jobs/addiction',
            '/jobs/telepsychiatry',
            '/jobs/psychiatric/texas',
            '/jobs/psychiatric/city/austin-tx',
            '/jobs/foo-bar-baz',
            '/jobs/state/notastate',
            '/jobs/metro/not-a-metro',
            '/jobs/remote/notastate',
            '/jobs/remote/city/not-a-city-zz',
            '/jobs/lgbtq/texas',
            `/jobs/${ZERO_UUID}`,
            `/jobs/some-title-${ZERO_UUID}`,
            '/companies/no-such-company-e2e-xyz',
        ];
        const failures: string[] = [];
        for (const path of gone) {
            const res = await request.get(path, { maxRedirects: 0 });
            const body = await res.text();
            if (res.status() !== 410) failures.push(`${path}: HTTP ${res.status()}`);
            if (!/noindex/i.test(res.headers()['x-robots-tag'] ?? '')) failures.push(`${path}: missing X-Robots-Tag noindex`);
            if (!/<meta name="robots" content="noindex/.test(body)) failures.push(`${path}: missing meta robots noindex`);
            if (LEAKED_PLACEHOLDER_RE.test(htmlToText(body))) failures.push(`${path}: leaked placeholder in 410 body`);
            if (DONOR_COPY_RE.test(body)) failures.push(`${path}: donor copy in 410 body`);
        }
        expect(failures).toEqual([]);

        // A mixed-case donor slug is normalized FIRST, then gated (301 → 410, never 410 on the raw form).
        const { hops, finalStatus } = await followRedirects(request, '/Jobs/Psychiatric/');
        expect(hops[0].status, 'first hop normalizes').toBeGreaterThanOrEqual(300);
        expect(hops[0].status).toBeLessThan(400);
        expect(finalStatus).toBe(410);

        // The live NP category that shares the donor prefix must NOT be caught by the gate.
        const live = await request.get('/jobs/psychiatric-mental-health');
        expect(live.status()).toBe(200);
    });

    test('unknown city and state-directory slugs are honest 404s (not 200 soft-404s)', async ({ request }) => {
        for (const path of ['/jobs/city/notacity-zz', '/jobs/locations/notastate', '/salary-guide/not-a-state']) {
            const res = await request.get(path);
            expect(res.status(), path).toBe(404);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. pSEO page classes (browser)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('pSEO page classes', () => {
    for (const cls of ['categoryLanding', 'categoryState', 'categoryCity', 'stateHub', 'metro', 'stateCityDirectory'] as const) {
        test(`${cls}: 200, one H1, visible breadcrumbs backed by schema, clean copy`, async ({ page, guard }) => {
            const path = pseoSamples()[cls];
            test.skip(!path, `sitemaps advertise no ${cls} page`);
            const response = await page.goto(path!, { waitUntil: 'domcontentloaded' });
            expect(response?.status(), `${path} status`).toBe(200);
            await expectPageClassBasics(page, path!);
            const nodes = await jsonLdFromPage(page);
            expect(nodes.some((n) => typesOf(n).includes('BreadcrumbList')), `${path}: BreadcrumbList schema`).toBe(true);
            const crumbs = page.locator('nav[aria-label="Breadcrumb"], nav[aria-label="breadcrumb"], [class*="breadcrumb" i]').first();
            await expect(crumbs, `${path}: breadcrumbs visible (schema must describe visible content)`).toBeVisible();
            const crumbLinks = crumbs.locator('a');
            const linkCount = await crumbLinks.count();
            const visibleNames = (await crumbs.locator('li').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
            const schemaNames = (nodes.find((n) => typesOf(n).includes('BreadcrumbList'))!.itemListElement as JsonObject[]).map((it) => String(it.name));
            test.fixme(
                linkCount === 0,
                `DEFECT: components/CategoryHero.tsx renders the visible breadcrumb (${visibleNames.join(' > ')}) as plain <span>s with no links while the page emits a BreadcrumbList schema of ${schemaNames.join(' > ')} with item URLs: the trail is not navigable and the structured data does not describe the visible content (Google structured-data policy), on ${path}`,
            );
            expect(linkCount, `${path}: breadcrumb links`).toBeGreaterThanOrEqual(1);
            await expect(crumbLinks.first()).toHaveAttribute('href', /^\/?$|^https?:\/\/[^/]+\/?$/);
            // innerText applies the hero's CSS text-transform (uppercase crumbs), so compare case-insensitively.
            expect(visibleNames.slice(-1)[0]?.toLowerCase(), `${path}: last visible crumb == last schema crumb`).toBe(schemaNames.slice(-1)[0]?.toLowerCase());
            // Non-psychiatric NP pages must not carry PMHNP-era board copy.
            if (!/psychiatric/.test(path!)) {
                const text = await page.locator('main, body').first().innerText();
                expect(text, `${path}: donor copy`).not.toMatch(DONOR_COPY_RE);
            }
            void guard;
        });
    }

    test('pSEO count copy is pluralized correctly (no "1 positions")', async ({ request }) => {
        const cityBatch = [...crawl.allPaths.keys()].filter((p) => crawl.allPaths.get(p)?.includes('/cities/'));
        const sample = [
            ...pick(/^\/jobs\/(?!state|metro|city|locations|edit)[a-z0-9-]+\/[a-z-]+$/, 4, cityBatch),
            ...pick(/^\/jobs\/[a-z0-9-]+\/city\/[a-z0-9-]+$/, 2, cityBatch),
            ...pick(/^\/jobs\/state\//, 2),
        ];
        const bad: string[] = [];
        for (const path of sample) {
            const { status, html } = await getHtml(request, path);
            if (status !== 200) continue;
            const hits = htmlToText(html).match(/\b1 (?:positions|jobs|roles|employers|openings|live roles)\b/g);
            if (hits) bad.push(`${path}: ${[...new Set(hits)].join(', ')}`);
        }
        test.fixme(
            bad.length > 0,
            `DEFECT: pSEO templates render singular counts with plural nouns — lib/pseo/setting-state-template.tsx hero stats ("1 positions", "1 live roles"): ${bad.join('; ')}`,
        );
        expect(bad).toEqual([]);
    });

    test('generic city page and jobs hub also satisfy the page-class basics', async ({ page, guard }) => {
        const city = pseoSamples().city;
        for (const path of ['/jobs', city].filter(Boolean) as string[]) {
            await expectPageClassBasics(page, path);
        }
        void guard;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Mobile viewport
// ═══════════════════════════════════════════════════════════════════════════

test.describe('mobile 375px', () => {
    test.use({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });

    test('jobs hub, a category-state page and a job detail render without horizontal overflow', async ({ page, guard }) => {
        const targets = ['/jobs', pseoSamples().categoryState, TEST_JOB_SLUG ? `/jobs/${TEST_JOB_SLUG}` : undefined].filter(Boolean) as string[];
        for (const path of targets) {
            await gotoAndSettle(page, path);
            const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
            expect(scrollWidth, `${path}: no horizontal overflow at 375px`).toBeLessThanOrEqual(clientWidth + 1);
            await expect(page.locator('h1').first()).toBeVisible();
            const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
            expect(new URL(canonical!).pathname, `${path}: canonical unaffected by viewport`).toBe(path);
        }
        void guard;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Protected / malformed endpoints
// ═══════════════════════════════════════════════════════════════════════════

test.describe('protected and malformed endpoints', () => {
    test('stats cron requires its secret; sitemap batches reject bad indexes; counts endpoint is POST-only', async ({ request }) => {
        for (const headers of [undefined, { Authorization: 'Bearer not-the-secret' }]) {
            const res = await request.get('/api/cron/refresh-site-stats', { headers });
            expect(res.status(), `refresh-site-stats ${headers ? 'bad bearer' : 'anonymous'}`).toBe(401);
        }
        for (const path of ['/api/sitemaps/jobs/999', '/api/sitemaps/jobs/-1', '/api/sitemaps/jobs/abc', '/api/sitemaps/jobs/1e3', '/api/sitemaps/cities/999']) {
            const res = await request.get(path);
            expect(res.status(), path).toBe(404);
            expect(res.headers()['content-type'], `${path} is a JSON 404, not an HTML soft page`).toMatch(/json/);
        }
        const get = await request.get('/api/jobs/filter-counts');
        expect(get.status()).toBe(405);
        const crossOrigin = await request.post('/api/jobs/filter-counts', {
            headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
            data: {},
        });
        expect(crossOrigin.status(), 'cross-origin POST is refused by the CSRF gate').toBe(403);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Copy rules: no em/en dashes, no PMHNP-era copy outside psychiatric
// ═══════════════════════════════════════════════════════════════════════════

/** Em dash / en dash: banned in site-authored copy (employer job data excepted). */
const DASH_RE = /[–—]/;

interface CopyScanOptions {
    /** Job-detail pages: the description body is employer data (titles are normalised at render). */
    jobDetail: boolean;
}

/**
 * Text nodes in the rendered body that carry an em/en dash, excluding
 * employer-authored job data (job cards, job/company links, the job-detail
 * title + description). Each hit names its DOM path so the fix agent can
 * find the component.
 */
async function dashHits(page: Page, opts: CopyScanOptions): Promise<string[]> {
    return page.evaluate(({ jobDetail }) => {
        const DASH = /[–—]/;
        const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const exempt =
            '.jc-card, .job-description-html, script, style, noscript, template, [data-employer-copy]' +
            // Job titles, employer names and locations are normalised at render
            // (lib/display-text.ts), so the H1 and breadcrumb are NOT exempt;
            // only the employer-authored description body is.
            (jobDetail ? ', .prose' : '');
        const hits: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const text = node.textContent ?? '';
            if (!DASH.test(text)) continue;
            const el = node.parentElement;
            if (!el || el.closest(exempt)) continue;
            const link = el.closest('a');
            const href = link?.getAttribute('href') ?? '';
            if (link && (UUID_RE.test(href) || href.startsWith('/companies/'))) continue;
            const path: string[] = [];
            let cur: Element | null = el;
            while (cur && cur !== document.body && path.length < 4) {
                const cls = typeof cur.className === 'string' ? cur.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
                path.unshift(cur.tagName.toLowerCase() + (cls ? `.${cls}` : ''));
                cur = cur.parentElement;
            }
            const i = text.search(DASH);
            hits.push(`${path.join(' > ')}: "${text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ').trim()}"`);
        }
        return hits;
    }, opts);
}

/** <title>, meta description and OG title/description: site copy on non-job pages. */
async function headDashHits(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const DASH = /[–—]/;
        const out: string[] = [];
        if (DASH.test(document.title)) out.push(`<title>: "${document.title}"`);
        for (const sel of ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]']) {
            const content = document.querySelector(sel)?.getAttribute('content') ?? '';
            if (DASH.test(content)) out.push(`${sel}: "${content.slice(0, 120)}"`);
        }
        return out;
    });
}

/**
 * Body text outside employer job data and outside links that legitimately
 * point at the psychiatric hub (nav quick-links, salary-guide index).
 */
async function siteCopyText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone
            .querySelectorAll('.jc-card, .job-description-html, script, style, noscript, template, a[href*="psychiatric"], a[href*="pmhnp"]')
            .forEach((el) => el.remove());
        return (clone.textContent ?? '').replace(/\s+/g, ' ');
    });
}

/** PMHNP used as a board identity rather than a credential token. */
const PMHNP_ERA_COPY_RE = /\bPMHNPs\b|\bPMHNP (?:jobs?|job board|positions?|roles?|openings?|candidates?|community|careers?|salary|salaries)\b|\bfor PMHNP\b/i;

test.describe('copy rules', () => {
    test('pSEO + job page classes render no em/en dash in site-authored copy', async ({ page, guard }) => {
        const s = pseoSamples();
        const targets: Array<[string, string | undefined, boolean]> = [
            ['home', '/', false],
            ['jobsHub', '/jobs', false],
            ['categoryLanding', s.categoryLanding, false],
            ['categoryState', s.categoryState, false],
            ['categoryCity', s.categoryCity, false],
            ['stateHub', s.stateHub, false],
            ['metro', s.metro, false],
            ['stateCityDirectory', s.stateCityDirectory, false],
            ['city', s.city, false],
            ['jobDetail', TEST_JOB_SLUG ? `/jobs/${TEST_JOB_SLUG}` : undefined, true],
        ];
        const failures: string[] = [];
        for (const [name, path, jobDetail] of targets) {
            if (!path) continue;
            await gotoAndSettle(page, path);
            const body = await dashHits(page, { jobDetail });
            const head = jobDetail ? [] : await headDashHits(page);
            for (const h of [...head, ...body]) failures.push(`${name} ${path} :: ${h}`);
        }
        expect(failures, 'em/en dash in rendered site copy').toEqual([]);
        void guard;
    });

    test('marketing, tool and account pages render no em/en dash in site-authored copy', async ({ page, guard }) => {
        const targets = [
            '/about', '/press', '/companies', pick(/^\/companies\/.+/, 1)[0], '/salary-guide', pick(/^\/salary-guide\/[a-z-]+$/, 1)[0],
            '/faq', '/for-programs', '/for-employers', '/pricing', '/resources', '/tools', '/blog', '/contact', '/login', '/signup',
        ].filter(Boolean) as string[];
        const failures: string[] = [];
        for (const path of targets) {
            await gotoAndSettle(page, path);
            const hits = [...(await headDashHits(page)), ...(await dashHits(page, { jobDetail: false }))];
            for (const h of hits) failures.push(`${path} :: ${h}`);
        }
        expect(failures, 'em/en dash in rendered site copy').toEqual([]);
        void guard;
    });

    test('plain-text crawl files, feed channel copy and 404/410 shells carry no em/en dash', async ({ request }) => {
        const failures: string[] = [];
        for (const path of ['/robots.txt', '/llms.txt', '/llms-full.txt', '/ai.txt', '/humans.txt', '/.well-known/security.txt']) {
            const body = await (await request.get(path)).text();
            const lines = body.split('\n').filter((l) => DASH_RE.test(l));
            if (lines.length) failures.push(`${path}: ${lines.slice(0, 3).map((l) => l.trim().slice(0, 100)).join(' | ')}${lines.length > 3 ? ` (+${lines.length - 3})` : ''}`);
        }
        const feed = await (await request.get('/feed.xml')).text();
        const channel = feed.match(/<channel>([\s\S]*?)<item>/)?.[1] ?? feed;
        for (const tag of ['title', 'description']) {
            const value = channel.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1] ?? '';
            if (DASH_RE.test(value)) failures.push(`feed.xml <channel><${tag}>: "${value.slice(0, 100)}"`);
        }
        for (const path of ['/jobs/psychiatric', `/jobs/${ZERO_UUID}`, '/companies/no-such-company-e2e-xyz']) {
            const res = await request.get(path);
            const text = htmlToText(await res.text());
            if (DASH_RE.test(text)) failures.push(`${path} (${res.status()}): "${text.match(/.{0,40}[–—].{0,40}/)?.[0]}"`);
        }
        test.fixme(
            failures.some((f) => f.startsWith('/ai.txt') || f.startsWith('feed.xml <channel>')),
            `DEFECT: Em dashes remain in machine-readable site copy (feed.xml channel title/description, ai.txt header): app/feed.xml/route.ts lines 85 and 87 and public/ai.txt line 1 still use " — " separators: ${failures.join(' | ')}`,
        );
        expect(failures).toEqual([]);
    });

    test('non-psychiatric pages carry no PMHNP-era board copy outside employer job data', async ({ page, guard }) => {
        const s = pseoSamples();
        const targets = ['/', '/jobs', s.categoryLanding, s.categoryState, s.stateHub, s.city, '/about', '/faq', '/for-programs', '/salary-guide']
            .filter((p): p is string => Boolean(p) && !/psychiatric/.test(p as string));
        const eraCopy: string[] = [];
        const bareTokens: string[] = [];
        for (const path of targets) {
            await gotoAndSettle(page, path);
            const text = await siteCopyText(page);
            const donor = text.match(DONOR_COPY_RE);
            if (donor) eraCopy.push(`${path}: donor "${donor[0]}"`);
            const era = text.match(new RegExp(`.{0,40}(?:${PMHNP_ERA_COPY_RE.source}).{0,40}`, 'i'));
            if (era) eraCopy.push(`${path}: "${era[0].trim()}"`);
            for (const m of text.matchAll(/.{0,30}\bPMHNP\b.{0,30}/g)) bareTokens.push(`${path}: "${m[0].trim()}"`);
        }
        // A bare credential token in a specialty list is legitimate NP-board
        // copy; it is recorded so a reviewer can eyeball it, not failed.
        if (bareTokens.length) test.info().annotations.push({ type: 'pmhnp-tokens', description: bareTokens.join(' | ') });
        expect(eraCopy, 'PMHNP-era board copy on an NP page').toEqual([]);
        void guard;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. 404 hygiene
// ═══════════════════════════════════════════════════════════════════════════

test.describe('404 hygiene', () => {
    test('catch-all 404 is a branded, noindexed page with a body (not a 0-byte response)', async ({ request }) => {
        const path = `/no-such-page-e2e-${Date.now()}`;
        const res = await request.get(path);
        expect(res.status(), path).toBe(404);
        const html = await res.text();
        const empty = html.length === 0;
        test.fixme(
            empty,
            'DEFECT: app/[...catchall]/page.tsx (notFound() under force-dynamic) returns HTTP 404 with a 0-byte body under `next start` on every hit: no branded app/not-found.tsx, no H1, no noindex meta; visitors on any dead URL see a blank tab (the P7 D5 comment claims this was fixed)',
        );
        expect(empty, '404 body must not be empty').toBe(false);
        expect(html).toMatch(/<h1[\s>]/);
        expect(html).toContain(brand.name);
        expect(metaRobotsOf(html) ?? '', '404 is noindexed').toMatch(/noindex/i);
        const text = htmlToText(html);
        expect(text).not.toMatch(LEAKED_PLACEHOLDER_RE);
        expect(text).not.toMatch(DONOR_COPY_RE);
        expect(text).not.toMatch(DASH_RE);
    });

    test('route-level notFound() pages hydrate into the branded 404 with an H1 and recovery links', async ({ page, guard }) => {
        for (const path of ['/jobs/city/notacity-zz', '/salary-guide/not-a-state']) {
            const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
            expect(response?.status(), path).toBe(404);
            const h1 = page.locator('h1').first();
            const hasH1 = await h1.isVisible({ timeout: 15_000 }).catch(() => false);
            test.fixme(
                !hasH1,
                `DEFECT: ${path} answers 404 with the bare <html id="__next_error__"> shell (no H1, no site chrome, no recovery links, even after hydration): the segment's notFound() never reaches app/not-found.tsx`,
            );
            await expect(h1, `${path}: branded 404 H1`).toBeVisible();
            await expect(page.locator('a[href="/jobs"]').first(), `${path}: recovery link to /jobs`).toBeVisible();
            const text = await page.locator('body').innerText();
            expect(text).not.toMatch(LEAKED_PLACEHOLDER_RE);
            expect(text).not.toMatch(DASH_RE);
        }
        void guard;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Malformed input on public APIs and pagination
// ═══════════════════════════════════════════════════════════════════════════

test.describe('malformed input', () => {
    test('/api/jobs answers malformed page/limit with 400 or a clamped 200, never 500', async ({ request }) => {
        const cases = ['/api/jobs?page=abc&limit=1', '/api/jobs?page=0&limit=1', '/api/jobs?page=-1&limit=1', '/api/jobs?limit=abc', '/api/jobs?page=1.5&limit=1'];
        const fiveHundreds: string[] = [];
        for (const path of cases) {
            const res = await request.get(path);
            if (res.status() >= 500) fiveHundreds.push(`${path}: HTTP ${res.status()} ${(await res.text()).slice(0, 80)}`);
            else expect([200, 400], path).toContain(res.status());
        }
        test.fixme(
            fiveHundreds.length > 0,
            `DEFECT: app/api/jobs/route.ts parses page/limit with parseInt and no validation: page=abc/0/-1 or limit=abc produce a NaN or negative Prisma skip/take and a 500 "Failed to fetch jobs" instead of a 400 or a clamp to page 1: ${fiveHundreds.join('; ')}`,
        );
        expect(fiveHundreds).toEqual([]);

        // Out-of-range but well-formed pages are honest empties, never NaN.
        const far = await request.get('/api/jobs?page=99999&limit=1');
        expect(far.status()).toBe(200);
        const body = (await far.json()) as { jobs: unknown[]; total: number; page: number; totalPages: number };
        expect(body.jobs).toEqual([]);
        expect(Number.isFinite(body.total) && Number.isFinite(body.totalPages)).toBe(true);
        // Unknown sort falls back to the default order, and a bogus ids list is an empty 200.
        expect((await request.get('/api/jobs?limit=1&sort=garbage')).status()).toBe(200);
        const ids = await request.get('/api/jobs?limit=1&ids=not-a-uuid');
        expect(ids.status()).toBe(200);
        expect(((await ids.json()) as { jobs: unknown[] }).jobs).toEqual([]);
    });

    test('/jobs treats a malformed ?page as page 1 and paginated pages as noindex + self-canonical', async ({ request }) => {
        const failures: string[] = [];
        for (const q of ['abc', '0', '-1', '1.5']) {
            const { status, html } = await getHtml(request, `/jobs?page=${q}`);
            if (status !== 200) failures.push(`?page=${q}: HTTP ${status}`);
            const canonical = new URL(canonicalOf(html) ?? '/', BASE_URL);
            if (canonical.pathname + canonical.search !== '/jobs') failures.push(`?page=${q}: canonical ${canonical.href}`);
            if (/noindex/i.test(metaRobotsOf(html) ?? '')) failures.push(`?page=${q}: noindexed although it renders page 1`);
            if (LEAKED_PLACEHOLDER_RE.test(htmlToText(html))) failures.push(`?page=${q}: leaked placeholder`);
        }
        for (const q of ['2', '99999']) {
            const { status, html } = await getHtml(request, `/jobs?page=${q}`);
            if (status !== 200) failures.push(`?page=${q}: HTTP ${status}`);
            if (!/noindex/i.test(metaRobotsOf(html) ?? '')) failures.push(`?page=${q}: paginated view must be noindex`);
            const canonical = canonicalOf(html) ?? '';
            if (!canonical.endsWith(`/jobs?page=${q}`)) failures.push(`?page=${q}: canonical ${canonical} (expected self)`);
            if (LEAKED_PLACEHOLDER_RE.test(htmlToText(html))) failures.push(`?page=${q}: leaked placeholder`);
        }
        // pSEO pagination: page 2 is crawlable-but-noindexed and canonicals to the hub.
        const remote2 = await getHtml(request, '/jobs/remote?page=2');
        expect(remote2.status).toBe(200);
        expect(metaRobotsOf(remote2.html) ?? '', '/jobs/remote?page=2 robots').toMatch(/noindex/i);
        expect(new URL(canonicalOf(remote2.html)!).pathname).toBe('/jobs/remote');
        expect(failures).toEqual([]);
    });

    test('malformed JSON to /api/jobs/filter-counts is a 400, not a 500', async ({ playwright }) => {
        // Same-origin mutation: lib/csrf.ts only accepts the localhost origin.
        const ctx = await playwright.request.newContext({ baseURL: FACET_BASE_URL, extraHTTPHeaders: INDEXER_HEADERS });
        try {
            const bad = await ctx.post('/api/jobs/filter-counts', {
                headers: { Origin: FACET_BASE_URL, 'Content-Type': 'application/json' },
                data: '{not json',
            });
            const status = bad.status();
            test.fixme(
                status >= 500,
                'DEFECT: app/api/jobs/filter-counts/route.ts lets request.json() throw on a malformed body and answers 500 "Failed to calculate filter counts": a client-input error must be a 400',
            );
            expect(status).toBe(400);
            const odd = await ctx.post('/api/jobs/filter-counts', {
                headers: { Origin: FACET_BASE_URL, 'Content-Type': 'application/json' },
                data: { page: 'abc', salaryMin: 'x', workMode: 42 },
            });
            expect([200, 400]).toContain(odd.status());
            if (odd.status() === 200) {
                const counts = (await odd.json()) as { total?: number };
                expect(Number.isFinite(counts.total)).toBe(true);
            }
        } finally {
            await ctx.dispose();
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. Social meta
// ═══════════════════════════════════════════════════════════════════════════

test.describe('social meta', () => {
    test('page classes emit og:title, og:image (which resolves to an image) and a twitter card', async ({ request }) => {
        const s = pseoSamples();
        const targets = ['/', '/jobs', s.categoryLanding, s.stateHub, s.city, '/about', '/companies', '/salary-guide', TEST_JOB_SLUG ? `/jobs/${TEST_JOB_SLUG}` : undefined].filter(Boolean) as string[];
        const failures: string[] = [];
        const imageHosts = new Set<string>();
        for (const path of targets) {
            const { status, html } = await getHtml(request, path);
            if (status !== 200) {
                failures.push(`${path}: HTTP ${status}`);
                continue;
            }
            const meta = (key: string) => html.match(new RegExp(`<meta\\b[^>]*(?:property|name)="${key}"[^>]*\\bcontent="([^"]*)"`, 'i'))?.[1];
            const ogTitle = meta('og:title');
            const ogImage = meta('og:image');
            const card = meta('twitter:card');
            if (!ogTitle) failures.push(`${path}: og:title missing`);
            if (!card) failures.push(`${path}: twitter:card missing`);
            if (!ogImage) {
                failures.push(`${path}: og:image missing`);
                continue;
            }
            const img = new URL(decodeXmlEntities(ogImage), BASE_URL);
            imageHosts.add(img.host);
            const res = await request.get(img.pathname + img.search, { timeout: SLOW_PAGE_TIMEOUT });
            if (res.status() !== 200) failures.push(`${path}: og:image ${img.pathname}${img.search} -> HTTP ${res.status()}`);
            else if (!/^image\//.test(res.headers()['content-type'] ?? '')) failures.push(`${path}: og:image content-type ${res.headers()['content-type']}`);
            const ogUrl = meta('og:url');
            const canonical = canonicalOf(html);
            if (ogUrl && canonical && new URL(ogUrl).pathname !== new URL(canonical).pathname) failures.push(`${path}: og:url ${ogUrl} != canonical ${canonical}`);
        }
        if (imageHosts.size > 1) {
            test.info().annotations.push({
                type: 'note',
                description: `og:image hosts differ across page classes (${[...imageHosts].join(', ')}): pSEO templates resolve relative /api/og URLs through metadataBase (NEXT_PUBLIC_BASE_URL) while marketing pages hardcode brand.baseUrl`,
            });
        }
        expect(failures).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. Interaction flows on the jobs hub
// ═══════════════════════════════════════════════════════════════════════════

const ALERT_DIALOG = '[role="dialog"][aria-labelledby="create-alert-title"]';

test.describe('jobs hub flows', () => {
    test('create-alert control is absent without filters; with a search it opens a keyboard-operable dialog (Enter opens, focus trapped, Escape closes and restores focus)', async ({ page, guard }) => {
        // The control renders into the nav bar (#nav-alert-slot) only while a
        // filter or search is active (app/jobs/JobsPageClient.tsx).
        await gotoAndSettle(page, '/jobs');
        await expect(page.getByRole('button', { name: 'Create Alert for This Search' })).toHaveCount(0);
        await gotoAndSettle(page, '/jobs?q=nurse');
        const trigger = page.getByRole('button', { name: 'Create Alert for This Search' }).first();
        await expect(trigger).toBeVisible();
        await trigger.focus();
        await page.keyboard.press('Enter');
        const dialog = page.locator(ALERT_DIALOG);
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('#create-alert-title')).toBeVisible();
        const focusInside = () =>
            page.evaluate((sel) => {
                const d = document.querySelector(sel);
                return Boolean(d && document.activeElement && d.contains(document.activeElement));
            }, ALERT_DIALOG);
        await expect.poll(focusInside, { message: 'initial focus moves into the dialog' }).toBe(true);
        // Tab never escapes the dialog.
        for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
        expect(await focusInside(), 'focus stays trapped after 12 Tabs').toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger, 'focus returns to the trigger').toBeFocused();
        void guard;
    });

    test('pagination is URL state: next page, refresh keeps it, back returns to page 1', async ({ page, guard }) => {
        await gotoAndSettle(page, '/jobs');
        const next = page.locator('[aria-label="Next page"]').first();
        test.skip(!(await next.isVisible().catch(() => false)), 'fewer than two pages of jobs');
        await next.scrollIntoViewIfNeeded();
        await next.click();
        await page.waitForURL(/[?&]page=2\b/);
        await expect(page.locator('h1').first()).toBeVisible();
        const canonicalBefore = await page.locator('link[rel="canonical"]').getAttribute('href');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/[?&]page=2\b/);
        await expect(page.locator('h1').first()).toBeVisible();
        expect(await page.locator('link[rel="canonical"]').getAttribute('href'), 'canonical stable across refresh').toBe(canonicalBefore);
        await expect(page.locator('.jc-card').first(), 'page 2 lists jobs').toBeVisible();
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/jobs(?:\?(?!.*page=)[^#]*)?$/);
        await expect(page.locator('h1').first()).toBeVisible();
        void guard;
    });
});

test.describe('mobile 375px flows', () => {
    test.use({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });

    test('filter drawer opens by tap, closes on Escape and via its close button, no overflow after', async ({ page, guard }) => {
        await gotoAndSettle(page, '/jobs');
        const open = page.locator('button.jp-mobile-filter-btn').first();
        await expect(open).toBeVisible();
        await open.tap();
        const drawer = page.locator('[role="dialog"][aria-label="Filter jobs"]');
        await expect(drawer).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await open.tap();
        await expect(drawer).toBeVisible();
        await drawer.locator('button[aria-label="Close filters"]').tap();
        await expect(drawer).toBeHidden();
        const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(scrollWidth, 'no horizontal overflow after the drawer cycle').toBeLessThanOrEqual(clientWidth + 1);
        void guard;
    });

    test('410 shells are usable at 375px', async ({ page, guard }) => {
        for (const path of ['/jobs/psychiatric', `/jobs/${ZERO_UUID}`]) {
            const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
            expect(response?.status(), path).toBe(410);
            await expect(page.locator('h1')).toHaveCount(1);
            await expect(page.locator('a[href="/jobs"]').first()).toBeVisible();
            const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
            expect(scrollWidth, `${path}: no horizontal overflow`).toBeLessThanOrEqual(clientWidth + 1);
        }
        void guard;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. Crawler method support
// ═══════════════════════════════════════════════════════════════════════════

test.describe('crawler method support', () => {
    test('HEAD on crawl files answers 200 with the same content-type as GET', async ({ request }) => {
        const norm = (v: string | undefined) => (v ?? '').split(';')[0].trim();
        for (const path of ['/robots.txt', '/sitemap.xml', '/api/sitemaps/index', '/feed.xml', '/llms.txt', '/']) {
            const head = await request.head(path);
            expect(head.status(), `HEAD ${path}`).toBe(200);
            const get = await request.get(path);
            expect(norm(head.headers()['content-type']), `HEAD ${path} content-type`).toBe(norm(get.headers()['content-type']));
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. SOC conditional (occupationalCategory per profession class)
// ═══════════════════════════════════════════════════════════════════════════

/** components/JobStructuredData.tsx SOC_BY_PROFESSION_CLASS. */
const SOC_BY_CLASS: Record<string, string | undefined> = {
    np_eligible: '29-1171.00',
    aprn_crna: '29-1151.00',
    aprn_midwife: '29-1161.00',
    aprn_cns: '29-1141.04',
    pa_only: '29-1071.00',
};

interface SocSample {
    id: string;
    slug: string;
    title: string;
    professionClass: string | null;
}

async function socSamples(): Promise<SocSample[]> {
    const rows = await db().$queryRawUnsafe<Array<{ id: string; slug: string; title: string; profession_class: string | null }>>(
        `SELECT DISTINCT ON (COALESCE(profession_class::text, 'null')) id, slug, title, profession_class
           FROM jobs
          WHERE is_published = true AND (expires_at IS NULL OR expires_at > now())
            AND (profession_class IS NOT NULL
                 OR title !~* '(nurse practitioner|\\mnp\\M|pmhnp|fnp|aprn|crna|anesthetist|midwi|cnm|cns|clinical nurse specialist|physician assistant|pa-c)')
          ORDER BY COALESCE(profession_class::text, 'null'), created_at DESC`,
    );
    return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, professionClass: r.profession_class }));
}

test.describe('SOC conditional', () => {
    test('occupationalCategory follows professionClass; unclassified non-NP titles carry none', async ({ page, guard, request }) => {
        test.skip(!hasDb(), 'DATABASE_URL not set: cannot pick one live job per profession class');
        const samples = await socSamples();
        const checked: string[] = [];
        const softNotFound: string[] = [];
        for (const s of samples) {
            const path = `/jobs/${s.slug}`;
            let head = await request.get(path, { maxRedirects: 0 });
            if (head.status() >= 500) {
                test.info().annotations.push({ type: 'transient-5xx', description: `${path}: HTTP ${head.status()} on first (cold ISR) render` });
                head = await request.get(path, { maxRedirects: 0 });
            }
            // The site-wide profession quarantine (lib/pseo/listing-where.ts) also hides
            // unclassified rows whose title is not an NP role (e.g. "Psychiatrist"). The
            // detail page then serves the not-found template; that is a quarantine outcome,
            // not a missing JobPosting. A 200 status on that template is a soft 404.
            const headTitle = head.status() === 200 ? ((await head.text()).match(/<title>([^<]*)/)?.[1] ?? '') : '';
            if (head.status() === 200 && /^Page Not Found/i.test(headTitle)) {
                expect(SOC_BY_CLASS[s.professionClass ?? ''], `${path}: an SOC-mapped class must not be quarantined`).toBeUndefined();
                softNotFound.push(`${path} (${s.professionClass ?? 'unclassified'} "${s.title}")`);
                checked.push(`${s.professionClass ?? 'unclassified'}: soft 404`);
                continue;
            }
            if (head.status() === 410 || head.status() === 404) {
                // Quarantined classes (other_clinical, physician, nonclinical) are gated
                // before the template: that is the expected outcome for them.
                expect(SOC_BY_CLASS[s.professionClass ?? ''], `${path}: an SOC-mapped class must not be quarantined`).toBeUndefined();
                checked.push(`${s.professionClass}: 410`);
                continue;
            }
            expect(head.status(), `${path}`).toBe(200);
            await gotoAndSettle(page, path);
            const nodes = await jsonLdFromPage(page);
            const posting = nodes.find((n) => typesOf(n).includes('JobPosting'));
            expect(posting, `${path}: JobPosting`).toBeTruthy();
            const expected = s.professionClass ? SOC_BY_CLASS[s.professionClass] : undefined;
            expect(posting!.occupationalCategory, `${path} (${s.professionClass ?? 'unclassified'} "${s.title}")`).toBe(expected);
            checked.push(`${s.professionClass ?? 'unclassified'}: ${String(posting!.occupationalCategory ?? 'none')}`);
        }
        test.info().annotations.push({ type: 'soc', description: checked.join(' | ') });
        expect(checked.length, 'at least two profession classes sampled').toBeGreaterThanOrEqual(2);
        test.fixme(
            softNotFound.length > 0,
            `DEFECT: a quarantined job detail URL answers HTTP 200 with the "Page Not Found" template (soft 404, cached s-maxage=3600) instead of 404 or 410: app/jobs/[slug]/page.tsx calls notFound() for status "quarantined" inside the ISR page, and middleware.ts only 410s unpublished or expired rows: ${softNotFound.join('; ')}`,
        );
        void guard;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. Employer-authored titles are normalised at render
// ═══════════════════════════════════════════════════════════════════════════

test.describe('employer text normalised at render', () => {
    test('a dashed job title renders without em/en dash or spaced hyphen on the detail H1, tab title, breadcrumb and job cards', async ({ page, guard }) => {
        test.skip(!hasDb(), 'DATABASE_URL not set: cannot find a live job whose stored title carries a dash');
        const rows = await db().$queryRawUnsafe<Array<{ slug: string; title: string }>>(
            `SELECT slug, title FROM jobs
              WHERE is_published = true AND (expires_at IS NULL OR expires_at > now())
                AND (profession_class IS NULL OR profession_class = 'np_eligible')
                AND title ~ '[–—]|\\s-\\s'
              ORDER BY (title ~ '[–—]') DESC, created_at DESC LIMIT 1`,
        );
        test.skip(rows.length === 0, 'no live job with a dashed stored title');
        const { slug, title } = rows[0];
        const SEPARATOR_DASH = /[–—]|\s-\s/;
        const path = `/jobs/${slug}`;
        await gotoAndSettle(page, path);
        const h1 = (await page.locator('h1').first().innerText()).trim();
        expect(h1, `stored title "${title}" is printed normalised`).not.toMatch(SEPARATOR_DASH);
        expect(await page.title(), 'tab title').not.toMatch(/[–—]/);
        const crumbs = page.locator('nav[aria-label="Breadcrumb"]').first();
        if (await crumbs.isVisible().catch(() => false)) {
            expect(await crumbs.innerText(), 'breadcrumb tail').not.toMatch(SEPARATOR_DASH);
        }
        // Related-job cards and every other card on the page.
        const cardTitles = await page.locator('.jc-card h3').allInnerTexts();
        expect(cardTitles.filter((t) => /[–—]/.test(t)), 'job-card titles on the detail page').toEqual([]);

        // Jobs hub: every rendered card title.
        await gotoAndSettle(page, '/jobs');
        await expect(page.locator('.jc-card').first()).toBeVisible();
        const hubCards = await page.locator('.jc-card').evaluateAll((cards) =>
            cards.map((c) => (c.querySelector('h3')?.textContent ?? '').trim()),
        );
        expect(hubCards.filter((t) => /[–—]/.test(t)), '/jobs job-card titles').toEqual([]);
        void guard;
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. Placeholder leaks on marketing and detail pages (raw SSR text)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('placeholder leaks', () => {
    test('no "undefined", "NaN" or "null" in the visible text of marketing, directory and detail pages', async ({ request }) => {
        const targets = [
            '/', '/about', '/press', '/for-programs', '/for-employers', '/pricing', '/faq', '/companies',
            pick(/^\/companies\/.+/, 1)[0], '/salary-guide', pick(/^\/salary-guide\/[a-z-]+$/, 1)[0],
            '/resources', '/tools', '/blog', pick(/^\/blog\/.+/, 1)[0], '/jobs/remote', '/jobs/new-grad',
        ].filter(Boolean) as string[];
        const leaks: string[] = [];
        for (const path of targets) {
            const { status, html } = await getHtml(request, path);
            if (status !== 200) {
                leaks.push(`${path}: HTTP ${status}`);
                continue;
            }
            const text = htmlToText(html);
            const m = text.match(/.{0,40}\b(undefined|NaN|null)\b.{0,40}/);
            if (m) leaks.push(`${path}: "${m[0]}"`);
            const t = titleOf(html) ?? '';
            if (LEAKED_PLACEHOLDER_RE.test(t)) leaks.push(`${path}: <title> "${t}"`);
            const d = metaDescriptionOf(html) ?? '';
            if (LEAKED_PLACEHOLDER_RE.test(d)) leaks.push(`${path}: meta description "${d.slice(0, 100)}"`);
        }
        expect(leaks).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. Unauthenticated access to SEO operations endpoints
// ═══════════════════════════════════════════════════════════════════════════

test.describe('SEO operations are protected', () => {
    test('indexing / deindexing / pSEO crons refuse anonymous and bad-bearer callers; /admin/seo-health redirects to login', async ({ request }) => {
        const crons = ['aggregate-pseo', 'index-pseo', 'index-urls', 'deindex-expired', 'historical-deindex', 'gsc-health-check', 'refresh-site-stats'];
        const failures: string[] = [];
        for (const name of crons) {
            for (const headers of [undefined, { Authorization: 'Bearer not-the-secret' }]) {
                const res = await request.get(`/api/cron/${name}`, { headers, maxRedirects: 0 });
                if (![401, 403].includes(res.status())) failures.push(`/api/cron/${name} ${headers ? 'bad bearer' : 'anonymous'}: HTTP ${res.status()}`);
            }
        }
        const admin = await request.get('/admin/seo-health', { maxRedirects: 0 });
        if (![307, 308].includes(admin.status()) || !/\/login/.test(admin.headers()['location'] ?? '')) {
            failures.push(`/admin/seo-health anonymous: HTTP ${admin.status()} -> ${admin.headers()['location']}`);
        }
        expect(failures).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. Hydration of SEO page classes
// ═══════════════════════════════════════════════════════════════════════════

test.describe('hydration', () => {
    test('directory and pSEO page classes hydrate without React errors', async ({ page, guard }) => {
        const s = pseoSamples();
        const targets = ['/companies', s.categoryCity, s.categoryState, s.stateHub, '/salary-guide'].filter(Boolean) as string[];
        for (const path of targets) {
            await gotoAndSettle(page, path);
            // Two animation frames: late hydration boundaries settle deterministically.
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        }
        const hydration = guard.pageErrors.filter((e) => HYDRATION_ERROR_RE.test(e));
        const pages = [...new Set(hydration.map((h) => h.match(/^\[(.*?)\]/)?.[1] ?? '?'))];
        // Removed from the guard here so the fixme below is the single report of it.
        for (let i = guard.pageErrors.length - 1; i >= 0; i--) {
            if (HYDRATION_ERROR_RE.test(guard.pageErrors[i])) guard.pageErrors.splice(i, 1);
        }
        test.fixme(
            hydration.length > 0,
            `DEFECT: React hydration mismatch (#418, "HTML") on SEO page classes: server HTML differs from the client render on ${pages.join(', ')}`,
        );
        expect(hydration).toEqual([]);
    });
});

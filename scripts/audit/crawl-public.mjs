/**
 * Live public-page crawl: soft-404s, hydration errors, canonical/meta/H1
 * coverage, thin pages, failed subresources. See docs/AUDIT_RUNBOOK.md §B.5.
 *
 * P2 #20 — RETARGETED. This script used to hardcode the donor board's domain
 * and a hand-typed list of the donor's category, state, and metro slugs, so on
 * this board it crawled the wrong host and probed ~20 URLs that either do not
 * exist or are not the pages that matter. It now derives everything:
 *
 *   host      → AUDIT_BASE_URL, else `baseUrl` read out of config/brand.ts
 *   taxonomy  → the live sitemaps, bucketed by URL shape and sampled
 *   structure → STRUCTURAL_ROUTES below (framework routes, not niche slugs)
 *
 * Discovery seeds from SITEMAP_ENTRY_POINTS, and `/api/sitemaps/index` MUST
 * come first. `/sitemap.xml` alone is NOT sufficient: it is a flat urlset that
 * deliberately omits the two highest-volume URL families —
 *   - job details      (app/sitemap.ts: "jobPages intentionally omitted —
 *                       served by /api/sitemaps/jobs/[batch]")
 *   - category×state / category×city / setting×state
 *                      (categoryStatePages is held empty on purpose to avoid
 *                       duplicate <loc>s; served by /api/sitemaps/cities/[batch])
 * and it links no child sitemaps, so the recursion in sitemapPaths() never
 * fires. Seeding only there silently reported "0 advertised" for the pSEO
 * families and audited zero job-detail pages. The real index — the one
 * app/robots.ts advertises first — is `/api/sitemaps/index`.
 *
 * There is no hardcoded slug fallback on purpose: if sitemap discovery fails
 * the run aborts loudly rather than silently auditing a stale guess.
 *
 * USAGE
 *   node scripts/audit/crawl-public.mjs > tmp/audit/crawl.log 2>&1
 *
 * ENV
 *   AUDIT_BASE_URL         origin to crawl        (default: brand.baseUrl)
 *   AUDIT_SAMPLE_PER_GROUP pages per URL family   (default: 8)
 *   AUDIT_MAX_CHILD_SITEMAPS child sitemaps fetched per shape (default: 2)
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

// config/brand.ts is TypeScript, so a plain .mjs audit script cannot import it.
// Reading the two literals it needs keeps this script on the same single source
// of truth as the app instead of re-declaring the board's identity.
const BRAND_SRC = readFileSync(path.join(REPO_ROOT, 'config/brand.ts'), 'utf8');

function brandField(field, required) {
  const match = BRAND_SRC.match(new RegExp(`${field}:\\s*'([^']+)'`));
  if (!match && required) {
    throw new Error(`Could not read \`${field}\` from config/brand.ts — set AUDIT_BASE_URL instead.`);
  }
  return match ? match[1] : null;
}

const BASE = (process.env.AUDIT_BASE_URL || brandField('baseUrl', true)).replace(/\/$/, '');
const SAMPLE_PER_GROUP = Number(process.env.AUDIT_SAMPLE_PER_GROUP || 8);
/**
 * Sitemap discovery seeds. Order matters — the index first, because it is the
 * only entry point that reaches the job and pSEO batches (see file header).
 * `/sitemap.xml` stays as a second seed so a DB-down index (it is
 * Prisma-backed) still yields the static taxonomy instead of aborting the run.
 * Paths are deduped, so the index listing /sitemap.xml as a child is free.
 */
const SITEMAP_ENTRY_POINTS = ['/api/sitemaps/index', '/sitemap.xml'];
/**
 * Child sitemaps fetched per shape (`/api/sitemaps/cities/*`, `/api/sitemaps/jobs/*`).
 * The batches hold 10K and 25K URLs each and we only ever sample
 * SAMPLE_PER_GROUP from any family, so pulling every batch would download tens
 * of megabytes of XML to throw nearly all of it away. Two per shape keeps
 * every family represented without unbounded work.
 */
const MAX_CHILD_SITEMAPS_PER_SHAPE = Number(process.env.AUDIT_MAX_CHILD_SITEMAPS || 2);
// middleware.ts allowlists this token past rate limiting.
const INDEXER_UA = brandField('indexerUserAgent', false);
// Real Chromium UA (passes Vercel challenge mode) plus the board's own indexer
// token, so the crawl is not rate-limited and is attributable in access logs.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' +
  (INDEXER_UA ? ` ${INDEXER_UA}/1.0` : '');

/**
 * Framework/structural routes — these are app-router paths, not niche
 * taxonomy, so they are the same on every fork and safe to hardcode.
 */
const STRUCTURAL_ROUTES = [
  '/', '/jobs', '/companies', '/blog', '/salary-guide', '/about', '/contact',
  '/pricing', '/for-employers', '/for-job-seekers', '/for-programs', '/resources',
  '/post-job', '/faq', '/privacy', '/terms', '/security', '/login', '/signup',
  '/job-alerts', '/sub-processors', '/do-not-sell', '/data-request',
  '/editorial-policy', '/jobs/locations', '/jobs/city', '/jobs/state',
];

/** Deliberate negative probes — must return 404/410, never a soft 200. */
const NEGATIVE_PROBES = [
  '/jobs/this-page-does-not-exist-xyz',
  '/jobs/remote/city/not-a-real-city-zzz',
];

/**
 * URL families discovered from the sitemap. `match` runs against a path;
 * the first matching family wins, so more specific patterns come first.
 */
const URL_FAMILIES = [
  // Job details are `/jobs/{title-slug}-{uuid}` — app/jobs/[slug]/page.tsx 404s
  // any /jobs/x without a trailing UUID, so the suffix is an exact
  // discriminator. This MUST stay ahead of `category`: both are one segment
  // under /jobs, first match wins, and the jobs batches advertise up to 25K
  // URLs each — without this the category bucket fills with job details and
  // real category pages are never audited.
  { name: 'job-detail', match: (p) => /^\/jobs\/[a-z0-9-]*[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p) },
  { name: 'category-city', match: (p) => /^\/jobs\/[a-z0-9-]+\/city\/[a-z0-9-]+$/.test(p) },
  { name: 'category-state', match: (p) => /^\/jobs\/[a-z0-9-]+\/[a-z0-9-]+$/.test(p) && !/^\/jobs\/(state|metro|city|locations)\//.test(p) },
  { name: 'state', match: (p) => /^\/jobs\/state\/[a-z0-9-]+$/.test(p) },
  { name: 'metro', match: (p) => /^\/jobs\/metro\/[a-z0-9-]+$/.test(p) },
  { name: 'locations-state', match: (p) => /^\/jobs\/locations\/[a-z0-9-]+$/.test(p) },
  { name: 'city', match: (p) => /^\/jobs\/city\/[a-z0-9-]+$/.test(p) },
  { name: 'category', match: (p) => /^\/jobs\/[a-z0-9-]+$/.test(p) },
  { name: 'salary-state', match: (p) => /^\/salary-guide\/[a-z0-9-]+$/.test(p) },
  { name: 'company', match: (p) => /^\/companies\/[a-z0-9-]+$/.test(p) },
  { name: 'blog', match: (p) => /^\/blog\/[a-z0-9-]+$/.test(p) },
  { name: 'resource', match: (p) => /^\/resources\/[a-z0-9-]+$/.test(p) },
  { name: 'tool', match: (p) => /^\/tools\/[a-z0-9-]+$/.test(p) },
];

const results = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });

/** True for a path that is itself a sitemap (index child), not a page URL. */
const isSitemapPath = (p) => /sitemap|\.xml$/i.test(p);

/**
 * Group key for a child sitemap, so the per-shape cap counts
 * `/api/sitemaps/jobs/0..N` as one shape and `/api/sitemaps/cities/0..N` as
 * another. Strips a trailing numeric batch segment.
 */
const sitemapShape = (p) => p.replace(/\/\d+$/, '/*');

/**
 * Fetch a sitemap (or sitemap index) and return every <loc> path it advertises,
 * recursing one level into child sitemaps. `visited` is shared across the whole
 * discovery pass so seeding from both entry points never refetches a document
 * (the index lists /sitemap.xml as a child).
 *
 * Verified against a live Chromium: for `Content-Type: application/xml` the XML
 * viewer keeps the real element nodes, so `page.content()` still contains
 * literal `<loc>…</loc>` for both a <urlset> and a <sitemapindex>.
 */
async function sitemapPaths(page, sitemapPath, visited, depth = 0) {
  if (visited.has(sitemapPath)) return [];
  visited.add(sitemapPath);

  const body = await page
    .goto(BASE + sitemapPath, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .then(() => page.content())
    .catch(() => '');
  const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, '&').trim(),
  );

  const paths = [];
  const children = [];
  for (const loc of locs) {
    if (!loc.startsWith(BASE)) continue;
    const rest = loc.slice(BASE.length) || '/';
    // A sitemap index lists child sitemaps — recurse once.
    if (depth === 0 && isSitemapPath(rest)) children.push(rest);
    else paths.push(rest);
  }

  // Cap how many batches of each shape we pull — see MAX_CHILD_SITEMAPS_PER_SHAPE.
  const perShape = new Map();
  for (const child of children) {
    const shape = sitemapShape(child);
    const taken = perShape.get(shape) ?? 0;
    if (taken >= MAX_CHILD_SITEMAPS_PER_SHAPE) continue;
    perShape.set(shape, taken + 1);
    paths.push(...(await sitemapPaths(page, child, visited, depth + 1)));
  }
  if (children.length) {
    console.log(`[discover] ${sitemapPath}: ${children.length} child sitemap(s), fetched ${[...perShape].map(([s, n]) => `${s}×${n}`).join(' ')}`);
  }
  return paths;
}

/** Bucket discovered paths into families and take the first N of each. */
function sampleByFamily(paths) {
  const buckets = new Map(URL_FAMILIES.map((f) => [f.name, []]));
  for (const p of paths) {
    const family = URL_FAMILIES.find((f) => f.match(p));
    if (!family) continue;
    const bucket = buckets.get(family.name);
    if (!bucket.includes(p)) bucket.push(p);
  }
  const sampled = [];
  for (const [name, bucket] of buckets) {
    console.log(`[discover] ${name}: ${bucket.length} advertised, sampling ${Math.min(bucket.length, SAMPLE_PER_GROUP)}`);
    sampled.push(...bucket.slice(0, SAMPLE_PER_GROUP));
  }
  return sampled;
}

async function audit(pathname) {
  const url = pathname.startsWith('http') ? pathname : BASE + pathname;
  const page = await ctx.newPage();
  const consoleErrors = [], pageErrors = [], failedReq = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 300)));
  page.on('requestfailed', r => { const u = r.url(); if (!u.includes('analytics') && !u.includes('vitals')) failedReq.push(u.slice(0,160) + ' :: ' + (r.failure()?.errorText||'')); });
  const t0 = Date.now();
  let rec = { path: pathname, url };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    rec.status = resp ? resp.status() : null;
    rec.finalUrl = page.url();
    rec.redirected = page.url() !== url;
    rec.ms = Date.now() - t0;
    const data = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const metaDesc = q('meta[name="description"]')?.content || null;
      const canonical = q('link[rel="canonical"]')?.href || null;
      const robotsMeta = q('meta[name="robots"]')?.content || null;
      const ogTitle = q('meta[property="og:title"]')?.content || null;
      const ogImage = q('meta[property="og:image"]')?.content || null;
      const h1s = [...document.querySelectorAll('h1')].map(h => h.textContent.trim());
      let jsonLdTypes = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try { const j = JSON.parse(s.textContent); const arr = Array.isArray(j) ? j : (j['@graph'] || [j]); for (const o of arr) if (o && o['@type']) jsonLdTypes.push(o['@type']); } catch { jsonLdTypes.push('PARSE_ERROR'); }
      }
      const internalLinks = [...document.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href'));
      const imgs = [...document.querySelectorAll('img')];
      const imgsNoAlt = imgs.filter(i => !i.getAttribute('alt')).length;
      const bodyText = (document.body?.innerText || '').trim();
      const jobCards = document.querySelectorAll('[data-testid="job-card"], [class*="JobCard"], article a[href*="/jobs/"]').length;
      return { metaDesc, canonical, robotsMeta, ogTitle, ogImage, h1s, jsonLdTypes, internalLinks, imgCount: imgs.length, imgsNoAlt, bodyLen: bodyText.length, jobCards, title: document.title };
    });
    rec = { ...rec, title: data.title, metaDescLen: data.metaDesc ? data.metaDesc.length : 0, metaDesc: data.metaDesc?.slice(0,80), canonical: data.canonical, robotsMeta: data.robotsMeta, ogTitle: !!data.ogTitle, ogImage: !!data.ogImage, h1count: data.h1s.length, h1: data.h1s[0]?.slice(0,80), jsonLdTypes: [...new Set(data.jsonLdTypes)], internalLinkCount: data.internalLinks.length, imgCount: data.imgCount, imgsNoAlt: data.imgsNoAlt, bodyLen: data.bodyLen, jobCards: data.jobCards, consoleErrors, pageErrors, failedReq };
  } catch (e) {
    rec.error = String(e).slice(0, 200);
    rec.consoleErrors = consoleErrors; rec.pageErrors = pageErrors;
  }
  await page.close();
  results.push(rec);
  const flag = [];
  if (rec.status && rec.status >= 400) flag.push('HTTP' + rec.status);
  if (rec.error) flag.push('NAVERR');
  if (rec.pageErrors?.length) flag.push('PAGEERR' + rec.pageErrors.length);
  if (rec.consoleErrors?.length) flag.push('CONERR' + rec.consoleErrors.length);
  if (rec.status === 200 && !rec.canonical) flag.push('NOCANON');
  if (rec.status === 200 && !rec.metaDescLen) flag.push('NODESC');
  if (rec.status === 200 && rec.h1count !== 1) flag.push('H1=' + rec.h1count);
  if (rec.status === 200 && rec.bodyLen < 400) flag.push('THIN' + rec.bodyLen);
  console.log(`[${results.length}] ${rec.status||'ERR'} ${rec.ms||'-'}ms ${pathname}  ${flag.join(' ')}`);
}

// Phase 0: discover the live taxonomy from the board's own sitemap.
console.log(`[crawl] base=${BASE} sample=${SAMPLE_PER_GROUP}/family`);
const discoveryPage = await ctx.newPage();
const visitedSitemaps = new Set();
const advertisedSeen = new Set();
const advertised = [];
for (const entry of SITEMAP_ENTRY_POINTS) {
  const alreadyFetched = visitedSitemaps.has(entry);
  const found = await sitemapPaths(discoveryPage, entry, visitedSitemaps);
  const added = found.filter((p) => (advertisedSeen.has(p) ? false : (advertisedSeen.add(p), true)));
  advertised.push(...added);
  // The index lists /sitemap.xml as a child, so the second seed is normally a
  // no-op. Say so, rather than logging a bare "0 URLs" that reads like the
  // sitemap came back empty.
  console.log(
    alreadyFetched
      ? `[discover] ${entry}: already fetched as a child of the index — skipped`
      : `[discover] ${entry}: ${found.length} URLs (${added.length} new)`,
  );
}
await discoveryPage.close();
if (advertised.length === 0) {
  await browser.close();
  throw new Error(`No URLs discovered from ${BASE} via ${SITEMAP_ENTRY_POINTS.join(', ')} — cannot audit a taxonomy that was not advertised. Check the host or set AUDIT_BASE_URL.`);
}
console.log(`[discover] ${advertised.length} URLs advertised across ${visitedSitemaps.size} sitemap document(s)`);

// Phase 1: structural routes, then a sample of every discovered URL family,
// then the negative probes. Deduped, order preserved.
const seen = new Set();
const queue = [...STRUCTURAL_ROUTES, ...sampleByFamily(advertised), ...NEGATIVE_PROBES]
  .filter((p) => (seen.has(p) ? false : (seen.add(p), true)));

for (const p of queue) await audit(p);

mkdirSync(path.join(REPO_ROOT, 'tmp/audit'), { recursive: true });
writeFileSync(path.join(REPO_ROOT, 'tmp/audit/crawl-results.json'), JSON.stringify(results, null, 2));

// summary
const non200 = results.filter(r => !(r.status >= 200 && r.status < 400) && !r.error && !NEGATIVE_PROBES.includes(r.path));
const softNegatives = results.filter(r => NEGATIVE_PROBES.includes(r.path) && r.status === 200);
const errs = results.filter(r => r.error);
const conerr = results.filter(r => r.consoleErrors?.length);
const pageerr = results.filter(r => r.pageErrors?.length);
const noCanon = results.filter(r => r.status === 200 && !r.canonical);
const noDesc = results.filter(r => r.status === 200 && !r.metaDescLen);
const badH1 = results.filter(r => r.status === 200 && r.h1count !== 1);
const thin = results.filter(r => r.status === 200 && r.bodyLen < 600);
const failedReqs = results.filter(r => r.failedReq?.length);
console.log('\n================ CRAWL SUMMARY ================');
console.log('base:', BASE);
console.log('total pages:', results.length);
console.log('non-2xx/3xx:', non200.map(r => `${r.status} ${r.path}`).join(' | ') || 'none');
console.log('SOFT 404 (probe returned 200):', softNegatives.map(r => r.path).join(', ') || 'none');
console.log('nav errors:', errs.map(r => `${r.path} (${r.error})`).join(' | ') || 'none');
console.log('pages w/ pageerror:', pageerr.map(r => r.path).join(', ') || 'none');
console.log('pages w/ console errors:', conerr.length, conerr.slice(0,8).map(r=>r.path).join(', '));
console.log('missing canonical:', noCanon.map(r => r.path).join(', ') || 'none');
console.log('missing meta desc:', noDesc.map(r => r.path).join(', ') || 'none');
console.log('h1 != 1:', badH1.map(r => `${r.path}(${r.h1count})`).join(', ') || 'none');
console.log('thin (<600 chars):', thin.map(r => `${r.path}(${r.bodyLen})`).join(', ') || 'none');
console.log('pages w/ failed requests:', failedReqs.map(r => r.path).join(', ') || 'none');
await browser.close();
console.log('WROTE tmp/audit/crawl-results.json');

/**
 * P2 #20 + #21 (seo-ops) regression pins.
 *
 * #20a — scripts/audit/crawl-public.mjs hardcoded the DONOR board's domain and
 *        a hand-typed list of the donor's category/state/metro slugs, so on
 *        this board the "live audit" crawled the wrong host and probed URLs
 *        that do not exist here. It now reads config/brand.ts and discovers
 *        the taxonomy from the live sitemap.
 *
 * #20b — there were TWO IndexNow clients (lib/indexnow.ts and
 *        lib/search-indexing.ts) with different endpoints, different env vars,
 *        and different safety rails; which behaviour a caller got depended on
 *        which module it imported. lib/indexnow.ts is now the only
 *        implementation and search-indexing delegates to it.
 *
 * #21  — the image sitemap was a hand-maintained list. It now derives the
 *        state-diorama entries from the same helpers the state and
 *        salary-guide pages render, and the sitemap budget guard pages the
 *        team channel instead of only writing a log line nobody reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { brand } from '@/config/brand';
import { getAllPageImages, getStateDioramaImages } from '@/lib/image-seo';
import { GET as imageSitemapGET } from '@/app/image-sitemap.xml/route';
import { STATE_DIORAMA_SLUGS } from '@/components/StateImage';
import { URL_TO_STATE } from '@/lib/pseo/setting-state-config';
import { pingIndexNow as searchIndexingPingIndexNow } from '@/lib/search-indexing';

const ROOT = path.resolve(__dirname, '../..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ─── #20a — audit crawler retarget ───────────────────────────────────────────

describe('P2 #20 — crawl-public.mjs is brand- and taxonomy-driven', () => {
  const CRAWLER = src('scripts/audit/crawl-public.mjs');

  it('carries no hardcoded donor host', () => {
    expect(CRAWLER).not.toMatch(/pmhnphiring/i);
    // …and no hardcoded literal origin of any kind.
    const literalOrigins = CRAWLER.match(/'https?:\/\/[^']+'/g) ?? [];
    expect(literalOrigins, `hardcoded origin(s): ${literalOrigins.join(', ')}`).toEqual([]);
  });

  it('resolves its origin from config/brand.ts, env-overridable', () => {
    expect(CRAWLER).toContain('config/brand.ts');
    expect(CRAWLER).toContain('AUDIT_BASE_URL');
  });

  it('discovers the taxonomy from the live sitemap instead of hardcoded slugs', () => {
    expect(CRAWLER).toContain('/sitemap.xml');
    // The donor slug arrays are gone…
    expect(CRAWLER).not.toMatch(/const\s+(CATS|STATES|METROS)\s*=/);
    // …replaced by URL-shape families sampled from what the board advertises.
    expect(CRAWLER).toContain('URL_FAMILIES');
  });

  it('aborts instead of auditing a stale guess when discovery yields nothing', () => {
    expect(CRAWLER).toContain('No URLs discovered');
  });

  /**
   * The retarget first shipped seeded only from `/sitemap.xml`. That is a flat
   * <urlset>, not an index: app/sitemap.ts omits jobPages on purpose ("served
   * by /api/sitemaps/jobs/[batch]") and holds categoryStatePages empty on
   * purpose (served by /api/sitemaps/cities/[batch]), and it links no child
   * sitemaps — so the depth-0 recursion never fired. The three
   * highest-volume URL families were reported as "0 advertised" and
   * job-detail pages were audited zero times, a coverage regression against
   * the donor script it replaced.
   */
  it('seeds discovery from the real sitemap index, not just /sitemap.xml', () => {
    expect(CRAWLER).toContain('/api/sitemaps/index');
    const entryBlock = CRAWLER.match(/const SITEMAP_ENTRY_POINTS = \[([^\]]+)\]/);
    expect(entryBlock, 'SITEMAP_ENTRY_POINTS is gone').not.toBeNull();
    const entries = [...entryBlock![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(entries[0], 'the index must be the first seed — it is the only one reaching the batches').toBe(
      '/api/sitemaps/index',
    );
    expect(entries).toContain('/sitemap.xml');
  });

  it('seeds the same index app/robots.ts advertises', () => {
    const robots = src('app/robots.ts');
    expect(robots).toContain('/api/sitemaps/index');
  });

  it('the index route is what advertises the job and city batches', () => {
    // Cross-check: this is *why* /sitemap.xml alone is insufficient.
    const indexRoute = src('app/api/sitemaps/index/route.ts');
    expect(indexRoute).toContain('/api/sitemaps/jobs/');
    expect(indexRoute).toContain('/api/sitemaps/cities/');
    expect(src('app/sitemap.ts')).toContain('jobPages intentionally omitted');
  });

  it('bounds how many 10K/25K-URL batches it downloads', () => {
    expect(CRAWLER).toContain('MAX_CHILD_SITEMAPS_PER_SHAPE');
  });
});

/**
 * Behavioural pin on the family bucketing. The crawler is a top-level-await
 * script that launches Chromium on import, so the URL_FAMILIES table is lifted
 * out of the source and evaluated directly — the ordering it encodes is the
 * subtle part and a source-text assertion would not catch a reordering.
 */
describe('P2 #20 — URL families classify the real sitemap URL shapes', () => {
  const CRAWLER = src('scripts/audit/crawl-public.mjs');
  const block = CRAWLER.match(/const URL_FAMILIES = \[[\s\S]*?\n\];/);
  const families = new Function(`${block![0]}; return URL_FAMILIES;`)() as {
    name: string;
    match: (p: string) => boolean;
  }[];
  const classify = (p: string): string | undefined => families.find((f) => f.match(p))?.name;

  // Shapes taken from the routes that emit them:
  //   app/api/sitemaps/jobs/[batch]   → /jobs/{title-slug}-{uuid}
  //   app/api/sitemaps/cities/[batch] → /jobs/{cat}/city/{city}, /jobs/{cat}/{state}
  const JOB_DETAIL = '/jobs/psychiatric-nurse-practitioner-0f8c1d2e-1111-4222-8333-444455556666';

  it('lifts the table (guards the scan itself)', () => {
    expect(block, 'URL_FAMILIES block not found').not.toBeNull();
    expect(families.length).toBeGreaterThan(5);
  });

  it('classifies a job-detail URL as job-detail, not category', () => {
    // Both are one segment under /jobs and first match wins. With `category`
    // first, up to 25K job URLs per batch flood the category bucket and the
    // real category pages never get audited.
    expect(classify(JOB_DETAIL)).toBe('job-detail');
  });

  it('still classifies the pSEO and category shapes correctly', () => {
    expect(classify('/jobs/family-practice')).toBe('category');
    expect(classify('/jobs/family-practice/texas')).toBe('category-state');
    expect(classify('/jobs/family-practice/city/austin')).toBe('category-city');
    expect(classify('/jobs/state/texas')).toBe('state');
    expect(classify('/jobs/metro/dallas-fort-worth')).toBe('metro');
    expect(classify('/jobs/city/austin')).toBe('city');
  });

  it('does not mistake a plain category page for a job detail', () => {
    // The UUID suffix is the discriminator app/jobs/[slug]/page.tsx itself uses
    // — it 404s any /jobs/x without one.
    expect(classify('/jobs/acute-care')).not.toBe('job-detail');
  });
});

// ─── #20b — one IndexNow client ──────────────────────────────────────────────

describe('P2 #20 — a single IndexNow implementation', () => {
  it('only lib/indexnow.ts talks to the IndexNow endpoint', () => {
    expect(src('lib/indexnow.ts')).toContain('api.indexnow.org');
    expect(
      src('lib/search-indexing.ts'),
      'lib/search-indexing.ts still carries its own IndexNow client',
    ).not.toContain('api.indexnow.org');
  });

  it('lib/search-indexing.ts delegates to the shared client', () => {
    expect(src('lib/search-indexing.ts')).toContain("from '@/lib/indexnow'");
  });
});

describe('P2 #20 — the delegating adapter preserves the IndexResult contract', () => {
  const onHost = `${brand.baseUrl}/jobs/example-role`;
  const offHost = 'https://someone-elses-domain.example/jobs/x';
  const originalKey = process.env.INDEXNOW_KEY;
  const originalApiKey = process.env.INDEXNOW_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.INDEXNOW_KEY;
    else process.env.INDEXNOW_KEY = originalKey;
    if (originalApiKey === undefined) delete process.env.INDEXNOW_API_KEY;
    else process.env.INDEXNOW_API_KEY = originalApiKey;
  });

  it('submits only same-host URLs and reports the off-host ones as failures', async () => {
    process.env.INDEXNOW_KEY = 'a'.repeat(32);
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));

    const results = await searchIndexingPingIndexNow([onHost, offHost]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.urlList).toEqual([onHost]);
    expect(body.host).toBe(new URL(brand.baseUrl).host);

    expect(results.find((r) => r.url === onHost)?.success).toBe(true);
    // The old duplicate client claimed success for URLs the engine drops.
    expect(results.find((r) => r.url === offHost)?.success).toBe(false);
  });

  it('reports every URL as failed — without a network call — when no key is set', async () => {
    delete process.env.INDEXNOW_KEY;
    delete process.env.INDEXNOW_API_KEY;
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const results = await searchIndexingPingIndexNow(onHost);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('INDEXNOW');
  });

  it('surfaces an engine rejection as a per-URL failure', async () => {
    process.env.INDEXNOW_KEY = 'a'.repeat(32);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad key', { status: 403 }));

    const results = await searchIndexingPingIndexNow([onHost]);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('403');
  });
});

// ─── #21 — data-driven image sitemap ─────────────────────────────────────────

describe('P2 #21 — image sitemap derives state dioramas from the render source', () => {
  const routableWithArt = Object.keys(URL_TO_STATE)
    .filter((slug) => STATE_DIORAMA_SLUGS.includes(slug))
    .sort();

  it('covers every routable jurisdiction that ships artwork, on both surfaces', () => {
    expect(routableWithArt.length).toBeGreaterThanOrEqual(50);

    const derived = getStateDioramaImages();
    const urls = new Set(derived.map((e) => e.url));
    for (const slug of routableWithArt) {
      expect(urls.has(`/jobs/state/${slug}`), `missing /jobs/state/${slug}`).toBe(true);
      expect(urls.has(`/salary-guide/${slug}`), `missing /salary-guide/${slug}`).toBe(true);
    }
    expect(derived).toHaveLength(routableWithArt.length * 2);
  });

  it('never advertises art for a slug that does not route', () => {
    for (const entry of getStateDioramaImages()) {
      const slug = entry.url.replace(/^\/(jobs\/state|salary-guide)\//, '');
      expect(URL_TO_STATE[slug], `${entry.url} is not a routable state slug`).toBeTruthy();
    }
  });

  it('every local image the sitemap advertises exists on disk', () => {
    const missing = getAllPageImages()
      .filter((e) => e.image.startsWith('/images/'))
      .map((e) => e.image)
      .filter((image) => !fs.existsSync(path.join(ROOT, 'public', image)));
    expect(missing, `image sitemap advertises missing files: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps every derived entry captioned and titled', () => {
    for (const entry of getStateDioramaImages()) {
      expect(entry.alt.length).toBeGreaterThan(0);
      expect(entry.caption.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeGreaterThan(0);
      // Niche wording comes from brand tokens, not hardcoded strings.
      expect(entry.caption).toContain(brand.niche.short);
    }
  });

  it('emits the derived entries as well-formed, escaped XML', async () => {
    const xml = await imageSitemapGET().text();
    expect(xml).not.toContain('supabase');
    expect((xml.match(/&(?!(amp|lt|gt|quot|apos|#\d+);)/g) ?? []).length).toBe(0);
    expect(xml).toContain(`<image:loc>${brand.baseUrl}/images/states/california.png</image:loc>`);
    expect(xml).toContain(`<loc>${brand.baseUrl}/salary-guide/california</loc>`);
  });

  it('stays a synchronous handler (no DB/fs at ISR revalidation time)', () => {
    // A lambda revalidating this route has no `public/` on disk and the
    // existing P0 pin calls GET() synchronously — keep it that way.
    const returned = imageSitemapGET() as unknown;
    expect(returned).not.toBeInstanceOf(Promise);
    expect(src('app/image-sitemap.xml/route.ts')).not.toMatch(/\basync\b/);
  });
});

// ─── #21 — sitemap budget alerting ───────────────────────────────────────────

describe('P2 #21 — sitemap budget guard pages the team channel', () => {
  const SITEMAP = src('app/sitemap.ts');

  it('imports the existing Discord notifier', () => {
    expect(SITEMAP).toContain("from '@/lib/discord-notifier'");
    expect(SITEMAP).toContain('sendDiscordMessage');
  });

  it('alerts at BOTH the warn and the critical threshold', () => {
    expect(SITEMAP).toContain("notifySitemapBudget('warn'");
    expect(SITEMAP).toContain("notifySitemapBudget('critical'");
    expect(SITEMAP).toContain('SITEMAP_BUDGET_WARN = 40000');
    expect(SITEMAP).toContain('SITEMAP_BUDGET_CRITICAL = 48000');
  });

  it('is throttled and can never break /sitemap.xml', () => {
    expect(SITEMAP).toContain('SITEMAP_ALERT_COOLDOWN_MS');
    // Fire-and-forget with a swallowed rejection — a Discord outage must not
    // take the sitemap down with it.
    expect(SITEMAP).toMatch(/void sendDiscordMessage\([\s\S]*?\)\.catch\(/);
  });
});

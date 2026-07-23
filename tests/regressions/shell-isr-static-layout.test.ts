/**
 * Regression guards for ISR fix F5 (shell package).
 *
 * app/layout.tsx used to call `await headers()` + `await cookies()`
 * unconditionally. In Next 16 any Dynamic API in the root layout opts
 * EVERY route into dynamic rendering, silently disabling all
 * `export const revalidate` ISR (job detail, listings, companies, pSEO)
 * — the exact Googlebot-crawl-burst → DB-pool-exhaustion → 5xx scenario
 * those pages' caching comments were written to prevent. Meanwhile
 * middleware deliberately excludes job-detail URLs from its crawler
 * CDN cache "because they have ISR", so the two subsystems must agree.
 *
 * These tests read the real source files and assert the fix stays in
 * place (static-analysis style, mirroring audit-highs-static.test.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Guard on the IMPORT, not on call sites: you can't call headers()/cookies()
// without importing next/headers, and explanatory comments that merely
// mention the function names don't trip an import check (same technique as
// the H10 guard in audit-highs-static.test.ts).
const NEXT_HEADERS_IMPORT = /from\s+['"]next\/headers['"]/;

describe('F5 — root layout stays static/ISR-compatible', () => {
  it('app/layout.tsx does not import next/headers (no Dynamic APIs)', () => {
    const src = read('app/layout.tsx');
    expect(src).not.toMatch(NEXT_HEADERS_IMPORT);
  });

  it('no layout.tsx anywhere in app/ imports next/headers', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (e.name === 'layout.tsx' && NEXT_HEADERS_IMPORT.test(read(rel))) {
          offenders.push(rel);
        }
      }
    };
    walk('app');
    expect(offenders).toEqual([]);
  });

  it('consent init moved to the client boundary (mirror cookie), not cookies()', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain('AnalyticsConsentBoundary');
    expect(layout).toContain('CookieConsentBoundary');

    // Middleware maintains the non-HttpOnly mirror the boundary reads.
    const mw = read('middleware.ts');
    expect(mw).toMatch(/CONSENT_MIRROR_COOKIE/);

    // The boundary reads document.cookie via the shared consent lib.
    const hook = read('components/consent/useMirroredConsent.ts');
    expect(hook).toContain('getMirroredConsent');
  });

  it('GoogleAnalytics no longer renders nonce-requiring inline scripts', () => {
    const src = read('components/GoogleAnalytics.tsx');
    // No nonce plumbing (prop, attribute, or type) — comments may still
    // mention the word. Inline consent/config scripts were replaced by
    // bundled module code (lib/analytics initConsentDefaults/initGaBase),
    // which is what lets the layout stop reading the x-nonce header.
    expect(src).not.toMatch(/nonce\??[:=]/);
    // No inline <Script id="...">…children…</Script> blocks remain —
    // only the external src-only gtag.js loader is allowed.
    expect(src).not.toMatch(/<Script\s+id=/);
    expect(src).toContain('initConsentDefaults');
    expect(src).toContain('initGaBase');
  });

  it('middleware still excludes job-detail URLs from the crawler CDN cache (ISR covers them)', () => {
    const mw = read('middleware.ts');
    expect(mw).toMatch(/isJobDetailUrl/);
    expect(mw).toMatch(/!isJobDetailUrl/);
  });

  it('job-detail page keeps its ISR revalidate', () => {
    const src = read('app/jobs/[slug]/page.tsx');
    expect(src).toMatch(/export const revalidate\s*=\s*3600/);
  });
});

// ── F5 follow-up: window.gtag global shim ───────────────────────
// The deleted inline scripts' top-level
// `function gtag(){dataLayer.push(arguments)}` was the ONLY definition of
// window.gtag — gtag.js itself never defines the global. Direct consumers
// guard on `typeof window.gtag === 'function'` (PseoPageViewTracker's
// pseo_page_view on both live pSEO templates), so if the bundled bootstrap
// stops defining it, pSEO analytics silently die. initGaBase() must
// restore the classic-snippet shim.
describe('F5 — initGaBase restores the window.gtag global shim', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>).window;
    vi.resetModules();
  });

  // GA_ID is captured at module scope, so stub the env and fake `window`
  // BEFORE a fresh import of the module.
  async function bootAnalytics() {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-TESTSHIM1');
    (globalThis as Record<string, unknown>).window = {
      location: { pathname: '/pmhnp-jobs/psychiatric/austin', href: 'https://example.test/' },
    };
    return import('@/lib/analytics');
  }

  it('defines window.gtag as a function (nothing else ever defines it)', async () => {
    const { initGaBase } = await bootAnalytics();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = (globalThis as any).window;
    expect(typeof win.gtag).toBe('undefined'); // pre-condition: gtag.js never sets it
    initGaBase();
    expect(typeof win.gtag).toBe('function');
  });

  it('window.gtag pushes real Arguments objects onto dataLayer (GA4 ignores plain arrays)', async () => {
    const { initGaBase } = await bootAnalytics();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = (globalThis as any).window;
    initGaBase();
    const before = win.dataLayer.length;
    // Exactly the call PseoPageViewTracker makes when its guard passes.
    win.gtag('event', 'pseo_page_view', { pseo_page_type: 'category_city' });
    expect(win.dataLayer.length).toBe(before + 1);
    const entry = win.dataLayer[win.dataLayer.length - 1];
    expect(Object.prototype.toString.call(entry)).toBe('[object Arguments]');
    expect(entry[0]).toBe('event');
    expect(entry[1]).toBe('pseo_page_view');
  });

  it('does not clobber a pre-existing window.gtag and routes bootstrap through it', async () => {
    const { initGaBase } = await bootAnalytics();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = (globalThis as any).window;
    const preExisting = vi.fn();
    win.gtag = preExisting;
    initGaBase();
    expect(win.gtag).toBe(preExisting);
    expect(preExisting).toHaveBeenCalled(); // gtag('js') + gtag('config') went through it
  });

  it('PseoPageViewTracker still guards on the window.gtag global (the consumer the shim exists for)', () => {
    const src = read('components/analytics/ViewTrackers.tsx');
    expect(src).toMatch(/typeof window\.gtag === 'function'/);
    expect(src).toContain("'pseo_page_view'");
  });

  it('lib/analytics keeps the shim assignment inside initGaBase', () => {
    const src = read('lib/analytics.ts');
    expect(src).toMatch(/window\.gtag\s*=\s*function/);
    expect(src).toMatch(/dataLayer\.push\(arguments\)/);
  });
});

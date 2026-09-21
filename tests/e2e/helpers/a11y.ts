/**
 * Shared helpers for the mobile + accessibility sweep
 * (tests/e2e/journeys/mobile-a11y.spec.ts).
 *
 * Everything here is deterministic: no arbitrary sleeps. Scrolling uses
 * `behavior: 'instant'` because app/globals.css sets `scroll-behavior:
 * smooth` on <html>, which would otherwise make hit-tests race the scroll.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const MOBILE_VIEWPORT = { width: 375, height: 812 };
export const MIN_TAP_TARGET = 44;

/** Same selector lib/hooks/useFocusTrap.ts uses, so the tests agree with the app. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// ── Console / page error guard ──────────────────────────────────────────────

/**
 * Third-party / environment noise that is not a product defect. Kept short
 * on purpose — anything not listed here fails the test.
 */
const CONSOLE_NOISE: RegExp[] = [
  /googletagmanager|google-analytics|gstatic\.com|doubleclick/i,
  /vercel\.live|_vercel\/(insights|speed-insights)|vitals\.vercel/i,
  /ERR_BLOCKED_BY_CLIENT|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED/i,
  /ResizeObserver loop/i,
  /\/favicon\.ico/i,
  // Next.js RSC prefetches that get cancelled by navigation.
  /_rsc=.*ERR_ABORTED|net::ERR_ABORTED/i,
  // 4xx resource loads: lib/csrf.ts rejects POSTs whose Origin is
  // 127.0.0.1 (filter-counts, consent, track-apply) and optional endpoints
  // 404 by design. 5xx are NOT filtered — see serverErrors below.
  /the server responded with a status of 4\d\d/i,
];

export interface ErrorGuard {
  consoleErrors: string[];
  pageErrors: string[];
  /** First-party responses with status >= 500, as `STATUS METHOD URL`. */
  serverErrors: string[];
  /** Soft-asserts both lists are empty so the test keeps collecting evidence. */
  assertClean(label: string): void;
}

export function attachErrorGuard(page: Page): ErrorGuard {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_NOISE.some((re) => re.test(text))) return;
    const loc = msg.location();
    consoleErrors.push(`${text} @ ${loc.url}:${loc.lineNumber}`);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  const serverErrors: string[] = [];
  page.on('response', (res) => {
    if (res.status() < 500) return;
    const req = res.request();
    serverErrors.push(`${res.status()} ${req.method()} ${res.url()}`);
  });
  return {
    consoleErrors,
    pageErrors,
    serverErrors,
    assertClean(label: string) {
      expect.soft(pageErrors, `${label}: uncaught page errors`).toEqual([]);
      expect.soft(serverErrors, `${label}: 5xx responses`).toEqual([]);
      expect.soft(consoleErrors, `${label}: console errors`).toEqual([]);
    },
  };
}

// ── Consent cookie preset ───────────────────────────────────────────────────

/**
 * Pre-seed the HttpOnly consent cookie (format: lib/consent.ts
 * serializeConsent) so the cookie banner does not render. Used by tests
 * where the banner is NOT the subject, so fixed-overlay hit-tests measure
 * the page itself. The banner has its own dedicated tests.
 */
export async function presetConsentCookie(page: Page, baseURL: string): Promise<void> {
  const url = new URL(baseURL);
  await page.context().addCookies([
    {
      name: 'pmhnp_consent_v2',
      value: JSON.stringify({ categories: { analytics: false, marketing: false }, version: '1', ts: Date.now() }),
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

// ── Scrolling ───────────────────────────────────────────────────────────────

export async function scrollToBottomInstant(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'instant' as ScrollBehavior });
  });
  // Lazy content: wait until every <img> in the DOM has settled (or errored).
  await page
    .waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 10_000 })
    .catch(() => {
      /* images that never settle are not this sweep's concern */
    });
}

export async function scrollToTopInstant(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  });
}

// ── Horizontal overflow ─────────────────────────────────────────────────────

interface OverflowReport {
  scrollWidth: number;
  innerWidth: number;
  offenders: string[];
}

async function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const innerWidth = window.innerWidth;
    const offenders: string[] = [];
    if (se.scrollWidth > innerWidth) {
      const all = Array.from(document.querySelectorAll<HTMLElement>('body *'));
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (rect.right > innerWidth + 1) {
          const id = el.id ? `#${el.id}` : '';
          const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
          offenders.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(rect.right)}`);
          if (offenders.length >= 8) break;
        }
      }
    }
    return { scrollWidth: se.scrollWidth, innerWidth, offenders };
  });
}

/**
 * Asserts document.scrollingElement.scrollWidth <= window.innerWidth both at
 * the top of the page and after scrolling to the bottom (lazy sections).
 */
export async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  await scrollToTopInstant(page);
  const top = await measureOverflow(page);
  expect
    .soft(top.scrollWidth, `${label}: horizontal overflow at top (${top.scrollWidth} > ${top.innerWidth}) offenders=${top.offenders.join(' | ')}`)
    .toBeLessThanOrEqual(top.innerWidth);
  await scrollToBottomInstant(page);
  const bottom = await measureOverflow(page);
  expect
    .soft(bottom.scrollWidth, `${label}: horizontal overflow after scrolling to bottom (${bottom.scrollWidth} > ${bottom.innerWidth}) offenders=${bottom.offenders.join(' | ')}`)
    .toBeLessThanOrEqual(bottom.innerWidth);
  await scrollToTopInstant(page);
}

// ── Tap targets ─────────────────────────────────────────────────────────────

export async function expectTapTarget(locator: Locator, label: string, min = MIN_TAP_TARGET): Promise<void> {
  await expect(locator, `${label}: visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label}: bounding box`).not.toBeNull();
  const h = Math.round(box!.height);
  const w = Math.round(box!.width);
  expect.soft(h, `${label}: tap target height ${w}x${h}`).toBeGreaterThanOrEqual(min);
  expect.soft(w, `${label}: tap target width ${w}x${h}`).toBeGreaterThanOrEqual(min);
}

// ── Sticky / fixed overlays ─────────────────────────────────────────────────

interface StickyReport {
  ok: boolean;
  target: string;
  hit: string;
}

function describeEl(el: Element | null): string {
  if (!el) return '(none)';
  const h = el as HTMLElement;
  const id = h.id ? `#${h.id}` : '';
  const cls = typeof h.className === 'string' && h.className ? `.${h.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
  const label = h.getAttribute('aria-label') || (h.textContent || '').trim().slice(0, 30);
  return `${h.tagName.toLowerCase()}${id}${cls} "${label}"`;
}

/**
 * After an instant scroll to the bottom, the last visible link/button in the
 * page (footer first, then main) must be hit-testable — i.e. not sitting
 * under a fixed bottom bar. Uses document.elementFromPoint, which is exactly
 * what a tap resolves to.
 */
export async function assertBottomContentNotCovered(page: Page, label: string): Promise<void> {
  await scrollToBottomInstant(page);
  const report: StickyReport = await page.evaluate((describeSrc) => {
    const describe = new Function('el', `return (${describeSrc})(el)`) as (el: Element | null) => string;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const pool = Array.from(document.querySelectorAll<HTMLElement>('footer a[href], footer button, main a[href], main button')).filter(visible);
    const last = pool[pool.length - 1];
    if (!last) return { ok: true, target: '(no footer/main controls)', hit: '' };
    const r = last.getBoundingClientRect();
    const cx = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    const ok = !!hit && (last.contains(hit) || hit.contains(last));
    return { ok, target: describe(last), hit: describe(hit) };
  }, describeEl.toString());
  expect.soft(report.ok, `${label}: bottom-most control ${report.target} is covered by ${report.hit}`).toBe(true);
  await scrollToTopInstant(page);
}

/** At scroll-top the H1 must not be under a sticky header. */
export async function assertHeadingNotCovered(page: Page, label: string): Promise<void> {
  await scrollToTopInstant(page);
  const report: StickyReport = await page.evaluate((describeSrc) => {
    const describe = new Function('el', `return (${describeSrc})(el)`) as (el: Element | null) => string;
    const h1 = document.querySelector('h1');
    if (!h1) return { ok: true, target: '(no h1)', hit: '' };
    const r = h1.getBoundingClientRect();
    if (r.height === 0) return { ok: true, target: '(h1 not rendered)', hit: '' };
    const cx = r.left + Math.min(r.width / 2, 100);
    const cy = r.top + Math.min(r.height / 2, 12);
    const hit = document.elementFromPoint(cx, cy);
    const ok = !!hit && (h1.contains(hit) || hit.contains(h1));
    return { ok, target: describe(h1), hit: describe(hit) };
  }, describeEl.toString());
  expect.soft(report.ok, `${label}: H1 ${report.target} is covered by ${report.hit}`).toBe(true);
}

export interface FixedBar {
  desc: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Visible position:fixed elements anchored to the bottom edge of the viewport. */
export async function fixedBottomBars(page: Page): Promise<FixedBar[]> {
  return page.evaluate((describeSrc) => {
    const describe = new Function('el', `return (${describeSrc})(el)`) as (el: Element | null) => string;
    const out: FixedBar[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < window.innerHeight - 2) continue; // not anchored to the bottom
      if (r.height > window.innerHeight * 0.6) continue; // full-screen overlays (menus) are not bars
      out.push({ desc: describe(el), top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
    return out;
  }, describeEl.toString());
}

// ── Axe ─────────────────────────────────────────────────────────────────────

export interface AxeSummary {
  serious: string[];
  all: string[];
}

export interface RunAxeOptions {
  /** Rule ids to skip (e.g. a site-wide defect tracked by its own test). */
  disableRules?: string[];
  /** Restrict the scan to these rule ids only. */
  onlyRules?: string[];
}

export async function runAxe(page: Page, options: RunAxeOptions = {}): Promise<AxeSummary> {
  let builder = new AxeBuilder({ page });
  if (options.onlyRules?.length) builder = builder.withRules(options.onlyRules);
  else builder = builder.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);
  const results = await builder.analyze();
  const fmt = (v: (typeof results.violations)[number]) =>
    `${v.id} [${v.impact}] ${v.help} — ${v.nodes.length} node(s): ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(' '))
      .join(' | ')}`;
  return {
    serious: results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map(fmt),
    all: results.violations.map(fmt),
  };
}

// ── Focus helpers ───────────────────────────────────────────────────────────

export async function activeElementDescription(page: Page): Promise<string> {
  return page.evaluate((describeSrc) => {
    const describe = new Function('el', `return (${describeSrc})(el)`) as (el: Element | null) => string;
    return describe(document.activeElement);
  }, describeEl.toString());
}

export async function focusIsInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate((el) => el.contains(document.activeElement));
}

/** True when the focused element paints a visible focus ring (outline or box-shadow). */
export async function activeElementHasFocusRing(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const shadow = cs.boxShadow !== 'none' && cs.boxShadow !== '';
    return outline || shadow;
  });
}

/**
 * Asserts the dialog owns keyboard focus: initial focus lands inside, Tab
 * cycles without escaping (visible focusables + 2 presses), and Shift+Tab
 * from the first focusable wraps to the last.
 */
export async function assertFocusTrapped(page: Page, dialog: Locator, label: string): Promise<void> {
  await expect
    .poll(() => focusIsInside(dialog), { message: `${label}: initial focus should land inside the dialog`, timeout: 5_000 })
    .toBe(true);

  const focusables = dialog.locator(FOCUSABLE_SELECTOR);
  const total = await focusables.count();
  let visibleCount = 0;
  for (let i = 0; i < total; i++) {
    if (await focusables.nth(i).isVisible()) visibleCount++;
  }
  expect(visibleCount, `${label}: dialog has focusable controls`).toBeGreaterThan(0);

  for (let i = 0; i < visibleCount + 2; i++) {
    await page.keyboard.press('Tab');
    const inside = await focusIsInside(dialog);
    if (!inside) {
      const where = await activeElementDescription(page);
      expect(inside, `${label}: Tab press #${i + 1} escaped the dialog → focus on ${where}`).toBe(true);
    }
  }
  for (let i = 0; i < visibleCount + 2; i++) {
    await page.keyboard.press('Shift+Tab');
    const inside = await focusIsInside(dialog);
    if (!inside) {
      const where = await activeElementDescription(page);
      expect(inside, `${label}: Shift+Tab press #${i + 1} escaped the dialog → focus on ${where}`).toBe(true);
    }
  }
}

// ── Motion ──────────────────────────────────────────────────────────────────

export interface MotionSample {
  /** Elements whose inline transform moved through >= 3 distinct non-identity values (a tween in flight). */
  animatedTransforms: string[];
  /** Running Web Animations (CSS or WAAPI) that touch transform/opacity. */
  runningAnimations: string[];
  /** Elements that carried ANY non-identity inline transform during the window (SSR "hidden" state included). */
  everTransformed: number;
}

/**
 * Observes the page for `windowMs` of animation frames. An element counts as
 * "animated" when its inline transform (framer-motion drives style.transform
 * per frame) passes through >= 3 distinct non-identity values, or when a
 * running Web Animation targets transform/opacity. A reduced-motion-aware
 * implementation jumps straight to the resting state (<= 2 values) and runs
 * no such animation. Under prefers-reduced-motion both lists must be empty.
 */
export async function sampleEntranceMotion(page: Page, scope: string, windowMs: number): Promise<MotionSample> {
  return page.evaluate(
    ({ scope, windowMs }) =>
      new Promise<MotionSample>((resolve) => {
        const root = document.querySelector(scope) || document.body;
        const seen = new Map<HTMLElement, Set<string>>();
        const running = new Set<string>();
        const describe = (el: Element) => {
          const h = el as HTMLElement;
          const cls = typeof h.className === 'string' && h.className ? `.${h.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
          return `${h.tagName.toLowerCase()}${cls} "${(h.textContent || '').trim().slice(0, 25)}"`;
        };
        const isIdentity = (t: string) =>
          !t || t === 'none' || /^translate[XY]?\(\s*0(px)?\s*(,\s*0(px)?)?\s*\)$/.test(t) || t === 'scale(1)' || t === 'translateY(0px)';
        const start = performance.now();
        const tick = () => {
          for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style*="transform"]'))) {
            const t = el.style.transform;
            if (isIdentity(t)) continue;
            const set = seen.get(el) ?? new Set<string>();
            set.add(t);
            seen.set(el, set);
          }
          for (const a of document.getAnimations()) {
            if (a.playState !== 'running') continue;
            const eff = a.effect as KeyframeEffect | null;
            const target = eff?.target as Element | null;
            if (!target || !root.contains(target)) continue;
            const frames = eff?.getKeyframes?.() ?? [];
            const props = new Set<string>();
            for (const f of frames) for (const k of Object.keys(f)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
            const touched = Array.from(props).filter((p) => /transform|translate|scale|opacity/i.test(p));
            if (touched.length) running.add(`${describe(target)} animates ${touched.join(',')}`);
          }
          if (performance.now() - start < windowMs) {
            requestAnimationFrame(tick);
            return;
          }
          const animatedTransforms: string[] = [];
          for (const [el, values] of seen) {
            if (values.size >= 3) animatedTransforms.push(`${describe(el)} → ${Array.from(values).slice(0, 3).join(' → ')} … (${values.size} frames)`);
          }
          resolve({ animatedTransforms, runningAnimations: Array.from(running), everTransformed: seen.size });
        };
        requestAnimationFrame(tick);
      }),
    { scope, windowMs },
  );
}

// ── Motion recorder (init script) ───────────────────────────────────────────

export interface MotionLog {
  /** Elements whose inline transform passed through >= 3 distinct non-identity values. */
  transformTweens: string[];
  /** Web Animations (CSS or WAAPI) observed running that touch transform/opacity. */
  runningAnimations: string[];
  /** Milliseconds observed since the document started. */
  observedMs: number;
}

interface MotionLogInternal {
  start: number;
  transforms: Map<Element, Set<string>>;
  running: Set<string>;
}

/**
 * Must be called BEFORE page.goto. Installs a MutationObserver on inline
 * `style` (framer-motion writes style.transform per frame) plus a
 * requestAnimationFrame poll of document.getAnimations(). Unlike
 * sampleEntranceMotion this cannot miss the first frames of a hydration-time
 * entrance animation, because it is running before any app script.
 */
export async function installMotionRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Log = { start: number; transforms: Map<Element, Set<string>>; running: Set<string> };
    const log: Log = { start: performance.now(), transforms: new Map(), running: new Set() };
    (window as unknown as { __motionLog: Log }).__motionLog = log;
    const describe = (el: Element) => {
      const h = el as HTMLElement;
      const cls = typeof h.className === 'string' && h.className ? '.' + h.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const id = h.id ? '#' + h.id : '';
      return h.tagName.toLowerCase() + id + cls + ' "' + (h.textContent || '').trim().slice(0, 25) + '"';
    };
    const isIdentity = (t: string) =>
      !t || t === 'none' || /^translate(3d|X|Y)?\(\s*0(px)?\s*(,\s*0(px)?\s*){0,2}\)$/.test(t) || t === 'scale(1)';
    const record = (el: Element) => {
      const t = (el as HTMLElement).style?.transform;
      if (!t || isIdentity(t)) return;
      let set = log.transforms.get(el);
      if (!set) {
        set = new Set();
        log.transforms.set(el, set);
      }
      set.add(t);
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes' && m.target instanceof HTMLElement) record(m.target);
        if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (!(n instanceof HTMLElement)) return;
            record(n);
            n.querySelectorAll('[style*="transform"]').forEach(record);
          });
        }
      }
    });
    const start = () => mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    const tick = () => {
      if (typeof document.getAnimations === 'function') {
        for (const a of document.getAnimations()) {
          if (a.playState !== 'running') continue;
          const eff = a.effect as KeyframeEffect | null;
          const target = eff?.target as Element | null;
          if (!target) continue;
          const frames = eff?.getKeyframes?.() ?? [];
          const props = new Set<string>();
          for (const f of frames) for (const k of Object.keys(f)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
          const touched = Array.from(props).filter((p) => /transform|translate|scale|opacity/i.test(p));
          if (touched.length) log.running.add(describe(target) + ' animates ' + touched.join(','));
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Waits until `minObservedMs` have elapsed since the document started (an
 * observation window anchored to navigation, long enough to cover the
 * longest entrance tween in the app), then returns the log.
 */
export async function readMotionLog(page: Page, minObservedMs: number): Promise<MotionLog> {
  await page.waitForFunction(
    (min) => {
      const log = (window as unknown as { __motionLog?: { start: number } }).__motionLog;
      return !!log && performance.now() - log.start >= min;
    },
    minObservedMs,
    { timeout: minObservedMs + 15_000 },
  );
  return page.evaluate(() => {
    const log = (window as unknown as { __motionLog: MotionLogInternal }).__motionLog;
    const describe = (el: Element) => {
      const h = el as HTMLElement;
      const cls = typeof h.className === 'string' && h.className ? '.' + h.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const id = h.id ? '#' + h.id : '';
      return h.tagName.toLowerCase() + id + cls + ' "' + (h.textContent || '').trim().slice(0, 25) + '"';
    };
    const transformTweens: string[] = [];
    for (const [el, values] of log.transforms) {
      if (values.size >= 3) transformTweens.push(describe(el) + ' → ' + Array.from(values).slice(0, 3).join(' → ') + ' … (' + values.size + ' frames)');
    }
    return { transformTweens, runningAnimations: Array.from(log.running), observedMs: Math.round(performance.now() - log.start) };
  });
}

// ── Copy rule: no em/en dashes in rendered text ─────────────────────────────

/**
 * Site-wide copy rule: visible text carries no em (U+2014) or en (U+2013)
 * dashes. Walks every rendered text node (skips script/style/template,
 * display:none subtrees, and anything inside `excludeSelectors` — used to
 * carve out employer-authored job data, which the rule does not cover).
 * Returns up to 25 `tag#id.cls: "snippet"` descriptions.
 */
export async function findDashesInVisibleText(page: Page, excludeSelectors: string[] = []): Promise<string[]> {
  return page.evaluate((excludes) => {
    const DASH = /[–—]/;
    const out = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || '';
      if (!DASH.test(text)) continue;
      const el = node.parentElement;
      if (!el) continue;
      if (el.closest('script,style,noscript,template')) continue;
      if (excludes.some((s) => el.closest(s))) continue;
      if (el.getClientRects().length === 0) continue; // display:none somewhere up the tree
      if (getComputedStyle(el).visibility === 'hidden') continue;
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 90);
      out.add(`${el.tagName.toLowerCase()}${id}${cls}: "${snippet}"`);
      if (out.size >= 25) break;
    }
    return Array.from(out);
  }, excludeSelectors);
}

/**
 * P2 #14 regression pins — the homepage free-tools band, plus the nav
 * promotion for the two directories (#11 / #12).
 *
 * The homepage linked none of the board's free tools: the salary calculator,
 * the licensure checker and the practice guides were reachable only from the
 * footer or the header's "Resources" pill. The band must link routes that
 * actually exist — a dead tool link on the homepage is worse than no band.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const homeSrc = () => read('app/page.tsx');
const headerSrc = () => read('components/Header.tsx');

/** Every href in the FREE_TOOLS array, in source order. */
function toolHrefs(): string[] {
  const src = homeSrc();
  const start = src.indexOf('const FREE_TOOLS');
  expect(start, 'FREE_TOOLS array not found in app/page.tsx').toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf('function FreeToolsBand'));
  return [...block.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Route existence check for an internal app-router path. Handles both
 * `app/<path>/page.tsx` and the dynamic-segment case.
 */
function routeExists(href: string): boolean {
  const clean = href.split('#')[0].split('?')[0].replace(/^\/|\/$/g, '');
  const candidate = path.join(ROOT, 'app', clean, 'page.tsx');
  return fs.existsSync(candidate);
}

describe('P2 #14: homepage free-tools band', () => {
  it('renders a band with an accessible heading', () => {
    const src = homeSrc();
    expect(src).toContain('<FreeToolsBand />');
    expect(src).toContain('aria-labelledby="free-tools-heading"');
    expect(src).toContain('id="free-tools-heading"');
  });

  it('links the salary calculator, the licensure checker and the guides', () => {
    const hrefs = toolHrefs();
    expect(hrefs).toContain('/salary-guide');
    expect(hrefs).toContain('/tools/licensure-checker');
    expect(hrefs).toContain('/resources/fpa-guide');
    expect(hrefs).toContain('/resources/private-practice-guide');
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
  });

  it('links only routes that exist — no speculative tool URLs', () => {
    const missing = toolHrefs().filter((href) => !routeExists(href));
    expect(missing, `dead homepage tool links: ${missing.join(', ')}`).toEqual([]);
  });

  it('links the tools hub so calculators added later stay discoverable', () => {
    expect(homeSrc()).toContain('href="/tools"');
    expect(routeExists('/tools'), '/tools hub route is missing').toBe(true);
  });

  it('has no duplicate destinations', () => {
    const hrefs = toolHrefs();
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('reads the niche label from config/brand.ts instead of hardcoding it', () => {
    const src = homeSrc();
    const start = src.indexOf('const FREE_TOOLS');
    const block = src.slice(start, src.indexOf('function FreeToolsBand'));
    expect(block).toContain('brand.niche.short');
    expect(block).not.toMatch(/\bNurse Practitioners?\b/);
  });

  it('does not touch components/HomepageHero.tsx', () => {
    // Guard rail: the hero carries a pre-existing failing ratchet and is
    // explicitly out of scope for this package.
    expect(homeSrc()).toContain("import HomepageHero from '@/components/HomepageHero'");
  });

  it('respects prefers-reduced-motion on the card hover lift', () => {
    expect(homeSrc()).toContain('prefers-reduced-motion: reduce');
  });
});

describe('P2 #11/#12/#14: promotion in the header', () => {
  it('surfaces both directories and the tools hub in the public mobile menu', () => {
    const src = headerSrc();
    expect(src).toContain("href: '/companies'");
    expect(src).toContain("href: '/jobs/locations'");
    expect(src).toContain("href: '/tools'");
  });

  it('leaves the four-item desktop nav intact', () => {
    const src = headerSrc();
    const start = src.indexOf('const publicNavLinks');
    const block = src.slice(start, src.indexOf('const seekerNavLinks'));
    expect([...block.matchAll(/href:\s*'/g)]).toHaveLength(4);
  });
});

/**
 * The nav promotion above adds three rows to a `position: fixed` overlay whose
 * open-state effect locks BOTH `html.overflow` and `body.overflow`. Anything
 * taller than that fixed box paints outside it with no page scroll to chase it
 * with — which silently pushed the signed-out Login / Sign up CTAs off-screen.
 *
 * These pins hold the reachability invariant rather than the specific CSS: the
 * menu must either fit the overlay at the repo's own declared mobile e2e
 * viewport, or scroll inside it.
 *
 * Measured in Chromium at 375x812 with the signed-out menu open: the content
 * container is 834px tall inside a 712px overlay (a 122px overflow), and with
 * the page lock on, `scrollingElement.scrollTop` stays 0 through a wheel event
 * — the Login CTA sat at y=901, off a 812px screen. The estimator below is a
 * deliberately conservative lower bound on that 834px (it assumes tight line
 * boxes and a 42px auth row), so a pass here means "definitely fits", never
 * "probably fits".
 */
describe('P2 #11/#12: mobile menu stays reachable after the nav promotion', () => {
  /** tests/e2e/mobile-phase-d-verify.spec.ts:6 declares 375x812. */
  const E2E_VIEWPORT_HEIGHT = 812;

  /** Tailwind spacing scale (px) for the classes the menu chrome uses. */
  const TW: Record<number, number> = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 };

  /** The whole `<AnimatePresence>` mobile-menu block. */
  function menuBlock(): string {
    const src = headerSrc();
    const start = src.indexOf('id="mobile-nav-menu"');
    expect(start, 'mobile menu block not found').toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('{/* Floating nav hover styles */}'));
  }

  /** The overlay's `top` offset — the fixed nav footprint it sits below. */
  function overlayTopOffset(): number {
    const m = menuBlock().match(/style=\{\{\s*top:\s*(\d+)\s*\}\}/);
    expect(m, 'overlay top offset not found').toBeTruthy();
    return Number(m![1]);
  }

  /**
   * Rendered height of one link row: vertical padding + the taller of the
   * icon and the text line box + its bottom margin.
   */
  function rowHeight(rowSrc: string): number {
    const pad = rowSrc.match(/padding:\s*'(\d+)px/);
    const font = rowSrc.match(/fontSize:\s*'([\d.]+)px'/);
    const margin = rowSrc.match(/marginBottom:\s*'(\d+)px'/);
    const icon = rowSrc.match(/size=\{(\d+)\}/);
    expect(pad && font && margin && icon, 'row metrics not parseable').toBeTruthy();
    const lineBox = Math.round(Number(font![1]) * 1.2); // `line-height: normal`
    return 2 * Number(pad![1]) + Math.max(Number(icon![1]), lineBox) + Number(margin![1]);
  }

  function countEntries(constName: string): number {
    const src = headerSrc();
    const start = src.indexOf(`const ${constName} = [`);
    expect(start, `${constName} not found`).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('];', start));
    return [...block.matchAll(/href:\s*'/g)].length;
  }

  /** Content height of the signed-out public menu, in CSS px. */
  function signedOutMenuHeight(): number {
    const block = menuBlock();
    const navRow = block.slice(block.indexOf('{navLinks.map('), block.indexOf('</nav>'));
    const extraRow = block.slice(block.indexOf('{mobileExtraLinks.map('));

    const navStack = countEntries('publicNavLinks') * rowHeight(navRow);
    const extraStack = countEntries('mobileExtraLinks') * rowHeight(extraRow);
    // "More" divider: mt-3 + pt-4 + the text-xs label's line box + mb-3.
    const moreChrome = TW[3] + TW[4] + Math.round(12 * 1.33) + TW[3];
    // Auth block: mt-6 + pt-5 + a ~42px button row.
    const authChrome = TW[6] + TW[5] + 42;
    // Container padding: pt-4 + pb-8.
    const containerChrome = TW[4] + TW[8];
    return navStack + moreChrome + extraStack + authChrome + containerChrome;
  }

  /** The menu content container is capped and scrolls inside the overlay. */
  function hasScrollContainer(): boolean {
    const src = headerSrc();
    const applied = /className="relative px-6 pt-4 pb-8 mobile-menu-scroll"/.test(src);
    const rule = src.slice(src.indexOf('.mobile-menu-scroll {'), src.indexOf('`}</style>'));
    return applied && /overflow-y:\s*auto/.test(rule) && /max-height:\s*calc\(/.test(rule);
  }

  it('the signed-out menu either fits the overlay or scrolls inside it', () => {
    const available = E2E_VIEWPORT_HEIGHT - overlayTopOffset();
    const needed = signedOutMenuHeight();
    expect(
      needed <= available || hasScrollContainer(),
      `signed-out menu needs ~${needed}px inside a ${available}px unscrollable overlay ` +
        `— the Login / Sign up CTAs at the bottom are unreachable. Either trim links ` +
        `or keep the .mobile-menu-scroll cap on the menu's content container.`,
    ).toBe(true);
  });

  it('needs the scroll cap — the promoted link stack no longer fits', () => {
    // Documents why the cap is load-bearing rather than decorative. If the
    // link list is ever trimmed back under budget this flips, and the cap
    // becomes a judgement call instead of a requirement — reconsider it
    // deliberately at that point rather than deleting it silently.
    const available = E2E_VIEWPORT_HEIGHT - overlayTopOffset();
    expect(signedOutMenuHeight()).toBeGreaterThan(available);
    expect(hasScrollContainer()).toBe(true);
  });

  it('caps at the overlay height, with a vh fallback ahead of dvh', () => {
    const src = headerSrc();
    const rule = src.slice(src.indexOf('.mobile-menu-scroll {'), src.indexOf('`}</style>'));
    const caps = [...rule.matchAll(/max-height:\s*calc\(100(d?v)h\s*-\s*(\d+)px\)/g)];
    // Fallback first, dvh second — declaration order is the fallback ladder.
    expect(caps.map((m) => `${m[1]}h`)).toEqual(['vh', 'dvh']);
    // Both cap values must track the overlay's own top offset.
    const top = overlayTopOffset();
    expect(caps.map((m) => Number(m[2]))).toEqual([top, top]);
  });

  it('keeps the auth CTAs inside the scrollable container', () => {
    const block = menuBlock();
    const containerStart = block.indexOf('mobile-menu-scroll');
    const authStart = block.indexOf('<HeaderAuth onNavigate=');
    expect(containerStart, 'scroll container not found').toBeGreaterThan(-1);
    expect(authStart, 'signed-out auth block not found').toBeGreaterThan(containerStart);
  });

  it('still locks html + body scroll while the overlay is open', () => {
    // The cap only works because the page behind stays locked; if that lock
    // is ever dropped, this container becomes a nested-scroll trap instead.
    const src = headerSrc();
    expect(src).toContain("document.body.style.overflow = 'hidden'");
    expect(src).toContain("document.documentElement.style.overflow = 'hidden'");
  });
});

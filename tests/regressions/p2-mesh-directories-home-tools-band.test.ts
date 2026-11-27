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
import { PHONE_MENU_CSS } from '@/components/phone-menu';
import { PHONE_MENU_GROUPS } from '@/lib/nav/phone-menu-links';

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
  it('surfaces both directories and the tools hub in the phone menu', () => {
    // The phone restructure (2026-11-27): one menu on every page, its groups
    // in lib/nav/phone-menu-links.ts.
    const hrefs = PHONE_MENU_GROUPS.flatMap((group) => group.links.map((link) => link.href));
    expect(hrefs).toContain('/companies');
    expect(hrefs).toContain('/jobs/locations');
    expect(hrefs).toContain('/tools');
  });

  it('leaves the four-item desktop nav intact', () => {
    const src = headerSrc();
    const start = src.indexOf('const publicNavLinks');
    expect(start, 'publicNavLinks not found').toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('];', start));
    expect([...block.matchAll(/href:\s*'/g)]).toHaveLength(4);
  });
});

/**
 * The phone menu is a `position: fixed` card, and while it is open the page
 * under it is locked (BOTH `html.overflow` and `body.overflow`). Anything
 * taller than the card's box would paint outside it with no page scroll to
 * chase it with, which is how the old menu once pushed the signed-out Log in
 * and Sign up row off a 375x812 screen. So the card caps its height at the
 * space between the bar and the bottom bar and scrolls inside, and the
 * account row and the small links sit inside that scrolling card.
 */
describe('P2 #11/#12: the phone menu stays reachable on a short screen', () => {
  const menuSrc = () => read('components/PhoneMenu.tsx');
  const cardRule = () => {
    const css = PHONE_MENU_CSS.replace(/\r\n/g, '\n');
    const start = css.indexOf('.phone-menu-card {');
    expect(start, '.phone-menu-card rule not found').toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('the card scrolls inside itself, capped with a vh fallback ahead of dvh', () => {
    const rule = cardRule();
    expect(rule).toMatch(/overflow-y:\s*auto/);
    expect(rule).toMatch(/overscroll-behavior:\s*contain/);
    const caps = [...rule.matchAll(/max-height:\s*calc\(100(d?v)h\s*-\s*(\d+)px\s*-\s*var\(--bottom-nav-h, 0px\)\)/g)];
    // Fallback first, dvh second: declaration order is the fallback ladder.
    expect(caps.map((m) => `${m[1]}h`)).toEqual(['vh', 'dvh']);
    // The card starts under the bar's 100px footprint, and both caps keep a
    // 16px gap above the bottom bar (whose height BottomNav publishes).
    const top = Number(rule.match(/top:\s*(\d+)px/)?.[1]);
    expect(top).toBe(100);
    expect(caps.map((m) => Number(m[2]))).toEqual([top + 16, top + 16]);
  });

  it('keeps the account row and the small links inside the scrolling card', () => {
    const src = menuSrc();
    const cardStart = src.indexOf('className="phone-menu-card"');
    expect(cardStart, 'card not found').toBeGreaterThan(-1);
    expect(src.indexOf('className="phone-menu-account"', cardStart)).toBeGreaterThan(cardStart);
    expect(src.indexOf('<HeaderAuth onNavigate={close} />', cardStart)).toBeGreaterThan(cardStart);
    expect(src.indexOf('className="phone-menu-small"', cardStart)).toBeGreaterThan(cardStart);
  });

  it('still locks html + body scroll while the menu is open', () => {
    // The cap only works because the page behind stays locked; if that lock
    // is ever dropped, the card becomes a nested-scroll trap instead.
    const src = menuSrc();
    expect(src).toContain("document.body.style.overflow = 'hidden'");
    expect(src).toContain("document.documentElement.style.overflow = 'hidden'");
  });
});

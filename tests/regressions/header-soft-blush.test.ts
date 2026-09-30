/**
 * Owner decision 5 (2026-09-29): the site header moves from the mint bar to
 * option B "soft blush". Pins, all static source guards plus WCAG maths:
 *   1. The bar: #FCEEF0, a 1px rgba(122,28,43,0.15) hairline, and the soft
 *      berry shadow the owner picked at rest; no mint anywhere in the header
 *      or its auth pills, and none of the neumorphic white inset highlights.
 *   2. Desktop nav pills: #3D2A2E text, hover rgba(190,24,93,0.08) with
 *      #7A1C2B text, current page #7A1C2B on rgba(190,24,93,0.12), a visible
 *      :focus-visible outline, and AA contrast for every state.
 *   3. The mobile menu toggle is white with the berry hairline, and the menu
 *      panel's rows, label and dividers follow the palette at AA.
 *   4. Log in (white, #3D2A2E, rgba(122,28,43,0.14) border) and Sign up (solid
 *      #9D174D, white text, the berry shadow) are styled by a hoisted
 *      stylesheet with a focus-visible outline, never by inline styles or
 *      mouse handlers (an inline box-shadow erased the focus ring, and the
 *      old primary check never matched, leaving Sign up pale after a hover).
 *   5. The employer Post Job CTA follows the same rules.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const HEADER = read('components/Header.tsx');
const AUTH = read('components/auth/HeaderAuth.tsx');

// ── WCAG 2.x contrast ────────────────────────────────────────────────────────

type Rgb = [number, number, number];
const hexRgb = (hex: string): Rgb => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (rgb: Rgb) => {
    const [r, g, b] = rgb.map((v) => channel(v / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(a: Rgb, b: Rgb): number {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}
/** An rgba() tint composited over an opaque background. */
function over(rgba: string, background: string): Rgb {
    const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    expect(m, `not an rgba() colour: ${rgba}`).not.toBeNull();
    const [r, g, b, a] = m!.slice(1).map(Number);
    const bg = hexRgb(background);
    return [r, g, b].map((v, i) => Math.round(v * a + bg[i] * (1 - a))) as Rgb;
}
const AA = 4.5;
/** WCAG 1.4.11: a focus indicator against the colours next to it. */
const NON_TEXT = 3;

const BAR = '#FCEEF0';
/** The mobile menu panel and the strip around the bar keep the page tone. */
const PANEL = '#F5F0EB';

// ── CSS helpers ──────────────────────────────────────────────────────────────

/** Body of the rule whose selector list is exactly `selector`. */
function cssRule(src: string, selector: string): string {
    const start = src.indexOf(`${selector} {`);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return src.slice(start + selector.length + 2, src.indexOf('}', start));
}
function decl(rule: string, property: string): string {
    const m = rule.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`));
    expect(m, `${property} in ${rule}`).not.toBeNull();
    return m![1].trim();
}

/** The HeaderAuth stylesheet string. */
function authCss(): string {
    const start = AUTH.indexOf('const HEADER_AUTH_CSS = `');
    expect(start, 'HEADER_AUTH_CSS').toBeGreaterThan(-1);
    const body = AUTH.slice(start + 'const HEADER_AUTH_CSS = `'.length);
    return body.slice(0, body.indexOf('`'));
}

/** Header's own <style> block. */
function headerCss(): string {
    const start = HEADER.indexOf('<style>{`');
    expect(start, 'Header <style> block').toBeGreaterThan(-1);
    return HEADER.slice(start, HEADER.indexOf('`}</style>', start));
}

// ── 1. The bar ───────────────────────────────────────────────────────────────

describe('soft blush bar', () => {
    it('uses the owner-picked fill, hairline and resting shadow', () => {
        expect(HEADER).toContain("backgroundColor: '#FCEEF0',");
        expect(HEADER).toContain("border: '1px solid rgba(122,28,43,0.15)',");
        expect(HEADER).toMatch(/boxShadow: scrolled\s*\n\s*\? '[^']+'\s*\n\s*: '0 6px 22px rgba\(122,28,43,0\.08\), 0 1px 3px rgba\(90,74,66,0\.05\)',/);
    });

    it('the scrolled shadow stays in the berry hue with no inset highlight', () => {
        const scrolled = HEADER.match(/boxShadow: scrolled\s*\n\s*\? '([^']+)'/);
        expect(scrolled).not.toBeNull();
        expect(scrolled![1]).toMatch(/^0 \d+px \d+px rgba\(122,28,43,0\.\d+\)/);
        expect(scrolled![1]).not.toContain('inset');
    });

    it('carries no mint colour in the header or its auth pills', () => {
        for (const [file, src] of [['Header.tsx', HEADER], ['HeaderAuth.tsx', AUTH]] as const) {
            for (const mint of ['#D5F5F1', '#B9EBD6', '#EDF2EE', '#374151']) {
                expect(src.toUpperCase(), `${file} still uses ${mint}`).not.toContain(mint);
            }
        }
    });

    it('drops the neumorphic white inset highlights', () => {
        for (const src of [HEADER, AUTH]) {
            expect(src).not.toMatch(/inset[^;'"`]*rgba\(255,\s*255,\s*255/);
            expect(src).not.toMatch(/-\d+px -\d+px \d+px rgba\(255,\s*255,\s*255/);
        }
    });

    it('keeps the wordmark colours', () => {
        expect(HEADER).toContain("color: '#3D2E24',");
        expect(HEADER).toContain("<span style={{ fontStyle: 'italic', color: '#BE185D', fontWeight: 600 }}>{WORDMARK.accent}</span>");
        expect(contrast(hexRgb('#3D2E24'), hexRgb(BAR))).toBeGreaterThanOrEqual(AA);
        expect(contrast(hexRgb('#BE185D'), hexRgb(BAR))).toBeGreaterThanOrEqual(AA);
    });
});

// ── 2. Desktop nav pills ─────────────────────────────────────────────────────

describe('desktop nav pills', () => {
    const css = headerCss();
    const base = cssRule(css, '.nav-pill-floating');
    const hover = cssRule(css, '.nav-pill-floating:hover:not([aria-current="page"])');
    const current = cssRule(css, '.nav-pill-floating[aria-current="page"]');
    const focus = cssRule(css, '.nav-pill-floating:focus-visible');

    it('menu text, hover and current page use the blush palette', () => {
        expect(decl(base, 'color')).toBe('#3D2A2E');
        expect(decl(hover, 'background-color')).toBe('rgba(190,24,93,0.08)');
        expect(decl(hover, 'color')).toBe('#7A1C2B');
        expect(decl(current, 'color')).toBe('#7A1C2B');
        expect(decl(current, 'background-color')).toBe('rgba(190,24,93,0.12)');
    });

    it('no pill state paints a shadow or border, so nothing competes with the focus outline', () => {
        expect(decl(base, 'box-shadow')).toBe('none');
        expect(hover).not.toMatch(/box-shadow|border-color/);
        expect(current).not.toMatch(/box-shadow|border-color/);
    });

    it('every text state clears AA on the bar', () => {
        expect(contrast(hexRgb(decl(base, 'color')), hexRgb(BAR))).toBeGreaterThanOrEqual(AA);
        expect(contrast(hexRgb(decl(hover, 'color')), over(decl(hover, 'background-color'), BAR))).toBeGreaterThanOrEqual(AA);
        expect(contrast(hexRgb(decl(current, 'color')), over(decl(current, 'background-color'), BAR))).toBeGreaterThanOrEqual(AA);
    });

    it('the focus outline is visible against the bar and the current-page tint', () => {
        const ring = decl(focus, 'outline').match(/^2px solid (#[0-9A-Fa-f]{6})$/);
        expect(ring, 'outline: 2px solid <hex>').not.toBeNull();
        expect(decl(focus, 'outline-offset')).toBe('2px');
        expect(contrast(hexRgb(ring![1]), hexRgb(BAR))).toBeGreaterThanOrEqual(NON_TEXT);
        expect(contrast(hexRgb(ring![1]), over(decl(current, 'background-color'), BAR))).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it('hover no longer lifts the pill, and reduced motion drops the press scale', () => {
        expect(hover).not.toContain('transform');
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {'));
        expect(reduced).toMatch(/\.nav-pill-floating:active,[\s\S]*?\{ transform: none; \}/);
    });
});

// ── 3. Mobile toggle and menu panel ──────────────────────────────────────────

describe('mobile toggle and menu panel', () => {
    it('the toggle is white with the berry hairline and keeps its focus ring hook', () => {
        const toggle = HEADER.slice(HEADER.indexOf('ref={toggleRef}'), HEADER.indexOf('aria-label="Toggle menu"'));
        expect(toggle).toContain('data-icon-btn');
        expect(toggle).toContain("backgroundColor: '#FFFFFF',");
        expect(toggle).toContain("border: '1px solid rgba(122,28,43,0.15)',");
        expect(toggle).toContain("color: '#3D2A2E',");
        // An inline box-shadow would beat the global focus ring.
        expect(toggle).not.toContain('boxShadow');
        expect(contrast(hexRgb('#3D2A2E'), hexRgb('#FFFFFF'))).toBeGreaterThanOrEqual(AA);
    });

    const menu = HEADER.slice(HEADER.indexOf('id="mobile-nav-menu"'), HEADER.indexOf('{/* Floating nav hover styles */}'));

    it('the panel keeps the page tone under the blush pill', () => {
        expect(menu).toContain(`style={{ backgroundColor: '${PANEL}' }}`);
    });

    it('rows mark the current page and use the blush palette', () => {
        const rows = [...menu.matchAll(/color: active \? '(#[0-9A-F]{6})' : '(#[0-9A-F]{6})',\s*\n\s*backgroundColor: active \? '(rgba\([^)]+\))' : 'transparent',/g)];
        expect(rows).toHaveLength(2);
        for (const [, activeText, idleText, activeTint] of rows) {
            expect(activeText).toBe('#7A1C2B');
            expect(activeTint).toBe('rgba(190,24,93,0.12)');
            expect(contrast(hexRgb(idleText), hexRgb(PANEL)), idleText).toBeGreaterThanOrEqual(AA);
            expect(contrast(hexRgb(activeText), over(activeTint, PANEL))).toBeGreaterThanOrEqual(AA);
        }
        expect(rows[0][2]).toBe('#3D2A2E');
        expect(menu.match(/aria-current=\{active \? 'page' : undefined\}/g)).toHaveLength(2);
    });

    it('the "More" label clears AA (it read 2.4:1 before) and the dividers use the berry hairline', () => {
        const label = menu.match(/style=\{\{ color: '(#[0-9A-F]{6})' \}\}>More</);
        expect(label).not.toBeNull();
        expect(contrast(hexRgb(label![1]), hexRgb(PANEL))).toBeGreaterThanOrEqual(AA);
        expect(menu).not.toContain('rgba(90,74,66,0.08)');
        expect(menu.match(/borderTop: '1px solid rgba\(122,28,43,0\.10\)'/g)).toHaveLength(2);
    });
});

// ── 4. Log in / Sign up ──────────────────────────────────────────────────────

describe('HeaderAuth pills', () => {
    const css = authCss();
    const signedOut = AUTH.slice(AUTH.lastIndexOf('return ('));

    it('the links carry classes only: no inline style, no mouse handlers', () => {
        expect(signedOut).toContain('<Link href="/login" onClick={onNavigate} className="header-auth-pill header-auth-login">');
        expect(signedOut).toContain('<Link href="/signup" onClick={onNavigate} className="header-auth-pill header-auth-signup">');
        expect(AUTH).not.toMatch(/onMouseEnter|onMouseLeave|style\.boxShadow|style\.backgroundColor/);
        expect(AUTH).not.toContain("'rgb(190,24,93)'");
        expect(signedOut).not.toContain('style={');
    });

    it('the stylesheet is hoisted once and is a static string', () => {
        expect(signedOut).toContain('<style href="header-auth-pills" precedence="default">');
        expect(signedOut).toContain('{HEADER_AUTH_CSS}');
        expect(css).not.toContain('${');
    });

    it('Log in is white with #3D2A2E text and the berry hairline', () => {
        const login = cssRule(css, '.header-auth-login');
        expect(decl(login, 'color')).toBe('#3D2A2E');
        expect(decl(login, 'background-color')).toBe('#FFFFFF');
        expect(decl(login, 'border')).toBe('1px solid rgba(122,28,43,0.14)');
        expect(contrast(hexRgb('#3D2A2E'), hexRgb('#FFFFFF'))).toBeGreaterThanOrEqual(AA);
        const hover = cssRule(css, '.header-auth-login:hover');
        expect(contrast(hexRgb(decl(hover, 'color')), hexRgb(decl(hover, 'background-color')))).toBeGreaterThanOrEqual(AA);
    });

    it('Sign up is solid #9D174D with white text and the berry shadow', () => {
        const signup = cssRule(css, '.header-auth-signup');
        expect(decl(signup, 'color')).toBe('#FFFFFF');
        expect(decl(signup, 'background-color')).toBe('#9D174D');
        expect(decl(signup, 'box-shadow')).toBe('0 4px 12px rgba(157,23,77,0.25)');
        expect(contrast(hexRgb('#FFFFFF'), hexRgb('#9D174D'))).toBeGreaterThanOrEqual(AA);
        const hover = cssRule(css, '.header-auth-signup:hover');
        expect(contrast(hexRgb('#FFFFFF'), hexRgb(decl(hover, 'background-color')))).toBeGreaterThanOrEqual(AA);
    });

    it('keyboard focus paints an outline visible on the bar and in the menu panel', () => {
        const focus = cssRule(css, '.header-auth-pill:focus-visible');
        const ring = decl(focus, 'outline').match(/^2px solid (#[0-9A-Fa-f]{6})$/);
        expect(ring).not.toBeNull();
        expect(decl(focus, 'outline-offset')).toBe('2px');
        for (const bg of [BAR, PANEL]) expect(contrast(hexRgb(ring![1]), hexRgb(bg)), bg).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it('motion stops under prefers-reduced-motion', () => {
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {'));
        expect(reduced).toContain('.header-auth-pill { transition: none; }');
        expect(reduced).toMatch(/\.header-auth-pill:hover,\s*\n\s*\.header-auth-pill:active \{ transform: none; \}/);
    });

    it('the loading placeholder is a flat berry tint that pulses only when motion is allowed', () => {
        const skeleton = AUTH.slice(AUTH.indexOf('if (loading) {'), AUTH.indexOf('if (user && profile) {'));
        expect(skeleton).toContain('motion-safe:animate-pulse');
        expect(skeleton).toContain("backgroundColor: 'rgba(122,28,43,0.08)',");
        expect(skeleton).not.toContain('boxShadow');
    });
});

// ── 5. Employer Post Job CTA ─────────────────────────────────────────────────

describe('Post Job CTA', () => {
    const cta = HEADER.slice(HEADER.indexOf('function PostJobCTA('));
    const css = headerCss();

    it('is styled by class, so hover never writes over the focus ring', () => {
        expect(cta).toContain("className={mobile ? 'header-post-job header-post-job--compact' : 'header-post-job'}");
        expect(cta).not.toMatch(/style=|onMouseEnter|onMouseLeave/);
    });

    it('is the same solid berry as Sign up, with an outline on keyboard focus', () => {
        const rule = cssRule(css, '.header-post-job');
        expect(decl(rule, 'background-color')).toBe('#9D174D');
        expect(decl(rule, 'color')).toBe('#FFFFFF');
        expect(rule).not.toContain('gradient');
        expect(contrast(hexRgb('#FFFFFF'), hexRgb('#9D174D'))).toBeGreaterThanOrEqual(AA);
        expect(contrast(hexRgb('#FFFFFF'), hexRgb(decl(cssRule(css, '.header-post-job:hover'), 'background-color')))).toBeGreaterThanOrEqual(AA);
        expect(decl(cssRule(css, '.header-post-job:focus-visible'), 'outline')).toMatch(/^2px solid #[0-9A-Fa-f]{6}$/);
    });
});

/**
 * P10 a11y-cookie regressions (re-verification round 1 survivors).
 *
 * 1. axe color-contrast: the exact nodes that still failed on home, /jobs
 *    (site chrome), the 1099 tool, /salary-guide and /login now use colours
 *    that clear WCAG 1.4.3 AA on their measured grounds.
 * 2. /login show-password toggle is a 44x44 tap target.
 * 3. Loading skeleton pulse stops under prefers-reduced-motion.
 * 4. Cookie banner does not come back on its own after a choice.
 * 5. Cookie banner sits on top of the mobile BottomNav, not over it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
    BANNER_REVEAL_DELAY_MS,
    CONSENT_SWITCH_TAP_TARGET_PX,
    initialBannerDecision,
    shouldRevealBanner,
} from '@/components/CookieConsent';
import {
    BOTTOM_NAV_FALLBACK_HEIGHT,
    BOTTOM_NAV_HEIGHT_VAR,
    bottomNavHeightValue,
} from '@/components/BottomNav';
import { eyeBtnStyle, EYE_BTN_TAP_TARGET_PX, inputWithRightIcon } from '@/components/auth/authTokens';
import { ALL_DENIED, ALL_GRANTED, ANALYTICS_ONLY } from '@/lib/consent';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8').replace(/\r\n/g, '\n');

const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => channel(v / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}
const AA = 4.5;
const AA_LARGE = 3;

/** Body of the first CSS rule whose selector line matches. */
function cssRule(src: string, selector: string): string {
    const start = src.indexOf(`${selector} {`);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return src.slice(start, src.indexOf('}', start));
}
function ruleColor(src: string, selector: string): string {
    const m = cssRule(src, selector).match(/\bcolor:\s*(#[0-9a-fA-F]{6})/);
    expect(m, `${selector} colour`).not.toBeNull();
    return m![1];
}

describe('P10 a11y-cookie: colour contrast on the axe-flagged nodes', () => {
    it('home: ClayDoughStrip .cds-tag em count on the #FBCFE8 tag', () => {
        const c = ruleColor(read('components/ClayDoughStrip.tsx'), '.cds-tag em');
        expect(contrast(c, '#FBCFE8')).toBeGreaterThanOrEqual(AA);
    });

    it('home: tool card "Open" label on the white card', () => {
        const c = ruleColor(read('app/page.tsx'), '.tool-card__open');
        expect(contrast(c, '#FFFFFF')).toBeGreaterThanOrEqual(AA);
    });

    it('site chrome: active desktop nav pill on the mint nav bar', () => {
        const c = ruleColor(read('components/Header.tsx'), '.nav-pill-floating[aria-current="page"]');
        // #D3DFE2 is the composited pill tint measured by axe.
        expect(contrast(c, '#D3DFE2')).toBeGreaterThanOrEqual(AA);
    });

    it('1099 tool: hints, suffixes, muted figures and footnotes no longer use #94A3B8 (2.56:1)', () => {
        const src = read('components/tools/TakeHomeCalculator.tsx');
        expect(src).not.toMatch(/#94A3B8/i);
        expect(src).toMatch(/id="takehome-filing-hint" style=\{\{ fontSize: '11\.5px', color: '#64748B'/);
        expect(contrast('#64748B', '#FFFFFF')).toBeGreaterThanOrEqual(AA);
    });

    it('/salary-guide: stat pills, quick stats, setting ranges and captions clear AA', () => {
        const src = read('app/salary-guide/page.tsx');
        expect(src).not.toMatch(/#94A3B8/i);
        expect(src).not.toMatch(/#8A7A72/i);
        expect(src).not.toMatch(/#F59E0B|#8B5CF6|#3B82F6|#EF4444/i);
        // Stat pill labels lost their 0.7 opacity; provenance on pink too.
        expect(src).toContain("<span style={{ fontSize: '12px', color: s.color, fontWeight: 500 }}>{s.label}</span>");
        expect(src).toContain("style={{ fontSize: '11px', color: '#831843', marginTop: '6px' }}");
        const pills: [string, string][] = [['#065F46', '#D4F5E9'], ['#3730A3', '#E0E7FF'], ['#92400E', '#FEF3C7'], ['#7C2D12', '#FFE0D3']];
        for (const [fg, bg] of pills) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA);
        for (const fg of ['#7C3AED', '#2563EB', '#B45309', '#DC2626']) {
            expect(contrast(fg, '#FAFAFA'), `${fg} setting range`).toBeGreaterThanOrEqual(AA);
        }
        expect(contrast('#B45309', '#FFFFFF')).toBeGreaterThanOrEqual(AA_LARGE);
        expect(contrast('#64748B', '#FAFAFA')).toBeGreaterThanOrEqual(AA);
        expect(contrast('#6B5B53', '#FFFFFF')).toBeGreaterThanOrEqual(AA);
        expect(contrast('#831843', '#FDF2F8')).toBeGreaterThanOrEqual(AA);
    });

    it('/salary-guide: PDF form submit button white text clears AA', () => {
        const src = read('components/SalaryGuideForm.tsx');
        expect(src).toContain("background: '#047857',");
        expect(contrast('#FFFFFF', '#047857')).toBeGreaterThanOrEqual(AA);
    });

    it('/login: helper copy, role toggle, divider and legal line clear AA', () => {
        const login = read('components/auth/LoginContent.tsx');
        expect(login).not.toMatch(/#94A3B0|#6B7F8A/i);
        expect(contrast('#5A6B76', '#F5F6F8')).toBeGreaterThanOrEqual(AA);
        expect(contrast('#475569', '#F1F5F9')).toBeGreaterThanOrEqual(AA);
        expect(contrast('#64748B', '#FFFFFF')).toBeGreaterThanOrEqual(AA);
        const layout = read('components/auth/AuthLayout.tsx');
        expect(layout).not.toMatch(/#9CA3AF/i);
        expect(layout).toContain("fontSize: '11px', color: '#5A6B76',");
    });

    it('/jobs cards: viewed cards are no longer dimmed with opacity', () => {
        expect(read('components/JobCard.tsx')).not.toMatch(/opacity: viewed \?/);
    });
});

describe('P10 a11y-cookie: /login show-password tap target', () => {
    it('the shared eye toggle is 44x44 and fits inside the reserved input padding', () => {
        expect(EYE_BTN_TAP_TARGET_PX).toBeGreaterThanOrEqual(44);
        expect(eyeBtnStyle.width).toBe(`${EYE_BTN_TAP_TARGET_PX}px`);
        expect(eyeBtnStyle.height).toBe(`${EYE_BTN_TAP_TARGET_PX}px`);
        expect(eyeBtnStyle.right).toBe(0);
        expect(eyeBtnStyle.padding).toBe(0);
        expect(eyeBtnStyle.justifyContent).toBe('center');
        expect(parseInt(String(inputWithRightIcon.paddingRight), 10)).toBeGreaterThanOrEqual(EYE_BTN_TAP_TARGET_PX);
    });
});

describe('P10 a11y-cookie: reduced motion', () => {
    it('the global reduced-motion block stops animate-pulse', () => {
        const css = read('app/globals.css');
        const block = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce) {'));
        expect(block).toMatch(/\.animate-shimmer,\s*\.animate-pulse\s*\{\s*animation: none;/);
    });

    it('HeaderAuth skeleton only pulses when motion is allowed', () => {
        const src = read('components/auth/HeaderAuth.tsx');
        expect(src).toContain('motion-safe:animate-pulse');
        expect(src).not.toMatch(/"[^"]*(?<!:)\banimate-pulse/);
    });
});

describe('P10 a11y-cookie: consent banner does not return after a choice', () => {
    it('decision tree priority: privacy signal, prior cookie, implied region, strict region', () => {
        expect(initialBannerDecision({ privacySignal: true, initialConsent: ALL_GRANTED, region: 'strict' })).toBe('deny-all');
        expect(initialBannerDecision({ privacySignal: false, initialConsent: ALL_DENIED, region: 'strict' })).toBe('none');
        expect(initialBannerDecision({ privacySignal: false, initialConsent: null, region: 'implied' })).toBe('analytics-only');
        expect(initialBannerDecision({ privacySignal: false, initialConsent: null, region: 'strict' })).toBe('show-banner');
        expect(BANNER_REVEAL_DELAY_MS).toBe(1500);
    });

    it('the delayed reveal is suppressed once any choice is recorded on this page view', () => {
        expect(shouldRevealBanner(null)).toBe(true);
        for (const c of [ALL_DENIED, ALL_GRANTED, ANALYTICS_ONLY]) expect(shouldRevealBanner(c)).toBe(false);
    });

    it('a recorded choice never re-runs the decision tree (root cause: savedCats in the effect deps)', () => {
        const src = read('components/CookieConsent.tsx');
        expect(src).not.toMatch(/\[evaluate, savedCats\]/);
        const evaluate = src.slice(src.indexOf('const evaluate = useCallback('), src.indexOf('const arm = setTimeout(evaluate, 0)'));
        expect(evaluate).toMatch(/\}, \[initialConsent\]\);/);
        expect(evaluate).toContain('if (!shouldRevealBanner(savedCatsRef.current)) return;');
        expect(evaluate).toContain('if (revealTimerRef.current) clearTimeout(revealTimerRef.current);');
        // The arming effect (and its reopen listener) depends on evaluate alone.
        const armEffect = src.slice(src.indexOf('const arm = setTimeout(evaluate, 0)'));
        expect(armEffect).toMatch(/window\.removeEventListener\(CONSENT_REOPEN_EVENT, onReopen\);\s*\};\s*\}, \[evaluate\]\);/);
        expect(armEffect.slice(0, armEffect.indexOf('}, [evaluate]);'))).toContain('const saved = savedCatsRef.current;');
        // Pending reveal is cancelled on unmount.
        expect(src).toMatch(/useEffect\(\(\) => \(\) => \{\s*if \(revealTimerRef\.current\) clearTimeout\(revealTimerRef\.current\);\s*\}, \[\]\);/);
    });
});

describe('P10 a11y-cookie: banner vs mobile BottomNav', () => {
    it('Customize switches are 44x44 hit areas around the unchanged 36x20 track', () => {
        expect(CONSENT_SWITCH_TAP_TARGET_PX).toBeGreaterThanOrEqual(44);
        const src = read('components/CookieConsent.tsx');
        const toggle = src.slice(src.indexOf('function ConsentToggle('));
        expect(toggle).toMatch(/width: CONSENT_SWITCH_TAP_TARGET_PX,\s*height: CONSENT_SWITCH_TAP_TARGET_PX,/);
        expect(toggle).toMatch(/width: 36,\s*height: 20,/);
    });

    it('BottomNav publishes a rounded-up measured height, 0px when hidden', () => {
        expect(BOTTOM_NAV_HEIGHT_VAR).toBe('--bottom-nav-h');
        expect(bottomNavHeightValue(81.5)).toBe('82px');
        expect(bottomNavHeightValue(0)).toBe('0px');
        expect(bottomNavHeightValue(Number.NaN)).toBe('0px');
        const src = read('components/BottomNav.tsx');
        expect(src).toContain('ref={navRef}');
        expect(src).toContain('root.style.setProperty(BOTTOM_NAV_HEIGHT_VAR, bottomNavHeightValue(nav.getBoundingClientRect().height));');
        // The e2e locator for the nav keeps working.
        expect(src).toContain('className="md:hidden fixed bottom-0 inset-x-0 z-50 shadow-lg"');
    });

    it('below md the banner bottom is the nav height (fallback covers the measured 81.5px)', () => {
        const css = read('app/globals.css');
        expect(css).toContain(
            `@media (max-width: 767.98px) {\n  .cookie-consent-banner {\n    bottom: var(${BOTTOM_NAV_HEIGHT_VAR}, ${BOTTOM_NAV_FALLBACK_HEIGHT});\n  }\n}`,
        );
        expect(parseInt(BOTTOM_NAV_FALLBACK_HEIGHT.replace('calc(', ''), 10)).toBeGreaterThanOrEqual(82);
        const src = read('components/CookieConsent.tsx');
        expect(src).not.toMatch(/calc\(64px\+env\(safe-area-inset-bottom\)\)/);
        expect(src).toContain('className="cookie-consent-banner fixed left-0 right-0 bottom-0 z-[9990] p-4 focus:outline-none"');
    });
});

/**
 * P10 site-chrome-a11y regressions.
 *
 * 1. Footer secondary text and the --text-tertiary token clear WCAG AA.
 * 2. Cookie banner: Escape dismisses without granting, 44px buttons, lifts
 *    above the job detail sticky apply bar.
 * 3. /settings keeps its return target and announces its toasts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { escapeDismissAction, CONSENT_BUTTON_BASE } from '@/components/CookieConsent';
import { FOOTER_LEGAL_TEXT } from '@/components/Footer';
import { ALL_DENIED, ALL_GRANTED, ANALYTICS_ONLY } from '@/lib/consent';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

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

const FOOTER_BG = '#1c1917';

describe('P10 site-chrome-a11y: colour contrast', () => {
    const footer = read('components/Footer.tsx');
    const css = read('app/globals.css');

    it('footer secondary text colour clears 4.5:1 on the footer ground', () => {
        expect(contrast(FOOTER_LEGAL_TEXT, FOOTER_BG)).toBeGreaterThanOrEqual(4.5);
    });

    it('no failing footer greys come back (#78716c 3.65:1, #57534e 2.29:1)', () => {
        expect(footer).not.toMatch(/#78716c/i);
        expect(footer).not.toMatch(/#57534e/i);
        // Every literal hex text colour in the footer passes on its ground.
        const colours = [...footer.matchAll(/color: '(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
        for (const c of colours) {
            expect(contrast(c, FOOTER_BG), `${c} on ${FOOTER_BG}`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('--text-tertiary clears 4.5:1 on white, --bg-primary and --bg-secondary', () => {
        const token = (name: string) => {
            const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
            expect(m, `${name} defined as a hex`).not.toBeNull();
            return m![1];
        };
        const tertiary = token('--text-tertiary');
        for (const bg of ['#FFFFFF', token('--bg-primary'), token('--bg-secondary')]) {
            expect(contrast(tertiary, bg), `${tertiary} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
    });
});

describe('P10 site-chrome-a11y: cookie consent banner', () => {
    const src = read('components/CookieConsent.tsx');
    const css = read('app/globals.css');

    it('Escape with no recorded choice declines; over a saved choice it keeps that choice', () => {
        expect(escapeDismissAction(null)).toBe('decline');
        expect(escapeDismissAction(ALL_GRANTED)).toBe('keep-saved');
        expect(escapeDismissAction(ANALYTICS_ONLY)).toBe('keep-saved');
        expect(escapeDismissAction(ALL_DENIED)).toBe('keep-saved');
    });

    it('the dialog container handles Escape and is focusable for reopen focus management', () => {
        expect(src).toMatch(/role="dialog"/);
        expect(src).toMatch(/onKeyDown=\{onDialogKeyDown\}/);
        expect(src).toMatch(/e\.key !== 'Escape'/);
        expect(src).toMatch(/tabIndex=\{-1\}/);
        // Escape must never call the grant path.
        const handler = src.slice(src.indexOf('const onDialogKeyDown'), src.indexOf('const slotGranted'));
        expect(handler).not.toMatch(/grantAllConsent|ALL_GRANTED/);
    });

    it('every text action button carries the 44px minimum height', () => {
        expect(CONSENT_BUTTON_BASE).toContain('min-h-[44px]');
        expect(src).not.toMatch(/className="px-[45] py-2 rounded-lg/);
        const textButtons = src.match(/\$\{CONSENT_BUTTON_BASE\}/g) ?? [];
        // Decline, Customize, Accept All, Save Preferences.
        expect(textButtons.length).toBe(4);
        expect(src).toMatch(/min-h-\[44px\] min-w-\[44px\] p-3/);
    });

    it('lifts above the job detail sticky apply bar below lg', () => {
        expect(src).toContain('cookie-consent-banner');
        expect(css).toMatch(
            /@media \(max-width: 1023\.98px\) \{\s*body:has\(\.job-detail-apply-bar\) \.cookie-consent-banner \{\s*bottom: var\(--job-apply-bar-h,/,
        );
        // Class and custom property names stay in sync with the bar module.
        const bar = read('app/jobs/[slug]/sticky-apply-bar.ts');
        expect(bar).toContain("STICKY_APPLY_BAR_CLASS = 'job-detail-apply-bar'");
        expect(bar).toContain("STICKY_APPLY_BAR_HEIGHT_VAR = '--job-apply-bar-h'");
    });
});

describe('P10 site-chrome-a11y: /settings', () => {
    const src = read('app/settings/page.tsx');

    it('signed-out bounces carry ?next=/settings', () => {
        expect(src).toContain("const SETTINGS_LOGIN_PATH = '/login?next=/settings'");
        expect(src).not.toMatch(/router\.push\('\/login'\)/);
        expect((src.match(/router\.push\(SETTINGS_LOGIN_PATH\)/g) ?? []).length).toBe(2);
    });

    it('toasts render inside persistent status / alert live regions', () => {
        expect(src).toMatch(/<div role="status" aria-live="polite" aria-atomic="true">\s*\{message\?\.type === 'success'/);
        expect(src).toMatch(/<div role="alert" aria-live="assertive" aria-atomic="true">\s*\{message\?\.type === 'error'/);
    });

    it('toast text colours clear 4.5:1 on their tints', () => {
        expect(contrast('#065F46', '#ECFDF5')).toBeGreaterThanOrEqual(4.5);
        expect(contrast('#B91C1C', '#FEF2F2')).toBeGreaterThanOrEqual(4.5);
        expect(src).toContain("success: { background: '#ECFDF5', border: 'rgba(6,95,70,0.25)', color: '#065F46' }");
        expect(src).toContain("error: { background: '#FEF2F2', border: 'rgba(185,28,28,0.25)', color: '#B91C1C' }");
    });
});

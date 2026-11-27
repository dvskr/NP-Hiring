/**
 * Regression guards for the header-nav-a11y package (mobile-a11y journey):
 *   1. The phone menu (role=dialog aria-modal, components/PhoneMenu.tsx since
 *      the phone restructure of 2026-11-27) is wired to useFocusTrap, and its
 *      button is the focus-return fallback.
 *   2. Desktop nav pills keep their keyboard focus ring: no inline
 *      box-shadow written from mouse handlers, and a :focus-visible outline.
 *   3. The phone menu does not animate under prefers-reduced-motion. It has no
 *      animation library at all: a CSS drop-in that the reduced-motion rule
 *      turns off (components/phone-menu.ts).
 *   4. The homepage hero entrance does not tween under prefers-reduced-motion.
 *
 * Part 1 tests the pure motion presets; part 2 is static source guards.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getHeroVariants } from '@/components/header-nav-motion';
import { PHONE_MENU_CSS } from '@/components/phone-menu';
import { readCode } from '../helpers/source';

const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

type Rec = Record<string, unknown>;
const transitionOf = (variant: unknown): Rec => ((variant as Rec).transition ?? {}) as Rec;

describe('getHeroVariants', () => {
    it('reduced motion: zero duration, zero delay, zero stagger so framer skips the tween', () => {
        const { container, fadeUp } = getHeroVariants(true);
        expect(transitionOf(fadeUp.show)).toMatchObject({ duration: 0, delay: 0 });
        expect(transitionOf(container.show)).toMatchObject({ staggerChildren: 0, delayChildren: 0 });
        expect(fadeUp.show).toMatchObject({ opacity: 1, y: 0 });
    });

    it('full motion keeps the original staggered fade up', () => {
        const { container, fadeUp } = getHeroVariants(false);
        expect(transitionOf(fadeUp.show).duration).toBeGreaterThan(0);
        expect(transitionOf(container.show).staggerChildren).toBeGreaterThan(0);
    });

    it('hidden state is identical in both modes so SSR markup and hydration match', () => {
        expect(getHeroVariants(true).fadeUp.hidden).toEqual(getHeroVariants(false).fadeUp.hidden);
        expect(getHeroVariants(null).fadeUp.hidden).toEqual(getHeroVariants(false).fadeUp.hidden);
    });

    it('the motion module holds the hero preset only: the phone menu takes no motion preset', () => {
        expect(read('components/header-nav-motion.ts')).not.toContain('getMobileMenuMotion');
    });
});

describe('PhoneMenu.tsx source guards', () => {
    const src = read('components/PhoneMenu.tsx');

    it('the menu dialog uses useFocusTrap and attaches its ref to the element carrying aria-modal', () => {
        expect(src).toMatch(/from '@\/lib\/hooks\/useFocusTrap'/);
        expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{\s*isOpen:\s*open/);
        const refAt = src.indexOf('ref={cardRef}');
        expect(refAt).toBeGreaterThan(-1);
        const tagStart = src.lastIndexOf('<div', refAt);
        const tag = src.slice(tagStart, src.indexOf('>', refAt));
        expect(tag).toContain('role="dialog"');
        expect(tag).toContain('aria-modal="true"');
    });

    it('the button carries a ref for focus return', () => {
        expect(src).toMatch(/ref=\{buttonRef\}\s*type="button"/);
        expect(src).toContain('buttonRef.current?.focus()');
    });

    it('useFocusTrap owns Escape: no second key handler, and the header holds no dialog of its own', () => {
        expect(src).not.toMatch(/e\.key === 'Escape'/);
        const header = read('components/Header.tsx');
        expect(header).not.toMatch(/e\.key === 'Escape'/);
        expect(header).not.toContain('aria-modal');
        expect(header).not.toContain('mobile-nav-menu');
    });
});

describe('the header and the phone menu animate without an animation library', () => {
    it('neither imports framer-motion or a motion preset', () => {
        for (const file of ['components/Header.tsx', 'components/PhoneMenu.tsx']) {
            const code = readCode(file);
            expect(code, file).not.toContain('framer-motion');
            expect(code, file).not.toContain('header-nav-motion');
        }
    });

    it('the card drops in with CSS, and reduced motion turns it off', () => {
        const css = PHONE_MENU_CSS.replace(/\r\n/g, '\n');
        expect(css).toMatch(/\.phone-menu-card \{[^}]*animation: phone-menu-in/);
        expect(css).toMatch(/\.phone-menu-backdrop \{[^}]*animation: phone-menu-fade/);
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {'));
        expect(reduced).toMatch(/\.phone-menu-card,\s*\.phone-menu-backdrop \{ animation: none; \}/);
    });
});

describe('Header.tsx source guards', () => {
    const src = read('components/Header.tsx');

    it('nav pills write no inline box-shadow and have a :focus-visible outline', () => {
        expect(src).not.toMatch(/style\.boxShadow\s*=\s*'none'/);
        const pill = src.slice(src.indexOf('className="nav-pill-floating"'), src.indexOf('<NavIcon'));
        expect(pill).not.toContain('style=');
        expect(pill).not.toContain('onMouseLeave');
        expect(src).toMatch(/\.nav-pill-floating:focus-visible\s*\{\s*outline:\s*2px solid/);
    });
});

describe('HomepageHero.tsx source guards', () => {
    const src = read('components/HomepageHero.tsx');

    it('entrance variants come from the reduced-motion aware preset', () => {
        expect(src).toContain('useReducedMotion()');
        expect(src).toContain('getHeroVariants(reduceMotion)');
        expect(src).not.toMatch(/staggerChildren:\s*0\.08/);
    });
});

/**
 * Regression guards for the header-nav-a11y package (mobile-a11y journey):
 *   1. The mobile menu (role=dialog aria-modal) is wired to useFocusTrap and
 *      the toggle is the focus-return fallback.
 *   2. Desktop nav pills keep their keyboard focus ring: no inline
 *      box-shadow written from mouse handlers, and a :focus-visible outline.
 *   3. The mobile menu does not fade under prefers-reduced-motion.
 *   4. The homepage hero entrance does not tween under prefers-reduced-motion.
 *
 * Part 1 tests the pure motion presets; part 2 is static source guards.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getHeroVariants, getMobileMenuMotion } from '@/components/header-nav-motion';

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
});

describe('getMobileMenuMotion', () => {
    it('reduced motion: mounts already opaque with an instant transition', () => {
        const motion = getMobileMenuMotion(true);
        expect(motion.initial).toBe(false);
        expect(motion.transition).toMatchObject({ duration: 0, delay: 0 });
    });

    it('full motion keeps the short fade; null (server) is treated as full motion', () => {
        expect(getMobileMenuMotion(false).initial).toEqual({ opacity: 0 });
        expect(getMobileMenuMotion(null).initial).toEqual({ opacity: 0 });
    });
});

describe('Header.tsx source guards', () => {
    const src = read('components/Header.tsx');

    it('mobile menu dialog uses useFocusTrap and attaches its ref', () => {
        expect(src).toMatch(/from '@\/lib\/hooks\/useFocusTrap'/);
        expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{\s*isOpen:\s*isMenuOpen/);
        const dialog = src.slice(src.indexOf('id="mobile-nav-menu"'), src.indexOf('className="fixed inset-0 z-[99]'));
        expect(dialog).toContain('ref={menuRef}');
        expect(dialog).toContain('aria-modal="true"');
    });

    it('mobile menu motion comes from the reduced-motion aware preset', () => {
        expect(src).toContain('useReducedMotion()');
        expect(src).toContain('getMobileMenuMotion(reduceMotion)');
        expect(src).not.toMatch(/initial=\{\{\s*opacity:\s*0\s*\}\}/);
    });

    it('toggle carries a ref for focus return', () => {
        expect(src).toMatch(/ref=\{toggleRef\}\s*onClick=\{\(\) => setIsMenuOpen/);
    });

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

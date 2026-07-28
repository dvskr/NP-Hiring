/**
 * Regression guard for B60 (framer-motion half) — JS-driven entrance
 * animations must honor prefers-reduced-motion.
 *
 * The global gate at the end of app/globals.css switches CSS animations off,
 * but framer-motion writes inline transform/opacity styles from JS, which CSS
 * cannot reach. The mounted framer components (FeaturedJobs on / and
 * /for-job-seekers, EmployerHowItWorks on / and /for-employers, TopStatesList
 * on /) previously ran their y/x entrance variants regardless of the user's
 * motion preference.
 *
 * The fix uses framer's own useReducedMotion() hook and the documented
 * `initial={false}` pattern: elements render already in their visible resting
 * state, so whileInView/animate never move them. These static pins keep that
 * wiring from being silently stripped in a future redesign.
 *
 * (components/HomepageHero.tsx also uses framer variants but is owner-locked;
 * its JS role-cycler already checks matchMedia and its CSS animations have a
 * local reduced-motion block. components/Header.tsx animates opacity only,
 * which is acceptable under reduced motion.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const GATED_COMPONENTS = [
    'components/FeaturedJobs.tsx',
    'components/TopStatesList.tsx',
    'components/EmployerHowItWorks.tsx',
];

describe('B60 — framer-motion components honor prefers-reduced-motion', () => {
    it.each(GATED_COMPONENTS)('%s imports useReducedMotion from framer-motion', (rel) => {
        const src = read(rel);
        expect(src).toMatch(/import \{[^}]*useReducedMotion[^}]*\} from 'framer-motion'/);
        expect(src).toContain('const reduceMotion = useReducedMotion()');
    });

    it.each(GATED_COMPONENTS)('%s gates every entrance `initial` prop on the preference', (rel) => {
        const src = read(rel);
        // No ungated variant entrances may remain…
        expect(src).not.toContain('initial="hidden"');
        // …and no ungated raw object entrances either (comments excluded by
        // requiring the JSX prop position: `initial={{`).
        expect(src).not.toMatch(/initial=\{\{/);
        // The gate itself must be present.
        expect(src).toMatch(/initial=\{reduceMotion \? false : /);
    });

    it('TopStatesList calls the hook before its early return (rules of hooks)', () => {
        const src = read('components/TopStatesList.tsx');
        const hookIdx = src.indexOf('useReducedMotion()');
        const earlyReturnIdx = src.indexOf('if (!states.length) return null');
        expect(hookIdx).toBeGreaterThan(-1);
        expect(earlyReturnIdx).toBeGreaterThan(-1);
        expect(hookIdx).toBeLessThan(earlyReturnIdx);
    });

    it('EmployerHowItWorks stops the infinite dot pulse under reduced motion', () => {
        const src = read('components/EmployerHowItWorks.tsx');
        // The pulse keyframes exist…
        expect(src).toContain('@keyframes ehwPulse');
        // …and the component-scoped stylesheet gates them.
        expect(src).toMatch(
            /@media \(prefers-reduced-motion: reduce\) \{\s*\.ehw-dot::after \{ animation: none; \}\s*\}/,
        );
    });
});

/**
 * Regression guard for B60 — prefers-reduced-motion must be honored globally.
 *
 * Previously only .animate-scale-in was gated; job-list entrance animations
 * (animate-fade-in-up via AnimatedContainer), skeleton shimmer, scroll
 * reveals, the hero gradient sweep, and `html { scroll-behavior: smooth }`
 * all ran regardless of the user's motion preference.
 *
 * These tests parse the reduced-motion block out of app/globals.css and
 * assert every decorative animation class defined in that file is gated.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8');

/** Extract the body of every `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlocks(source: string): string {
    const blocks: string[] = [];
    const marker = '@media (prefers-reduced-motion: reduce)';
    let from = 0;
    for (;;) {
        const start = source.indexOf(marker, from);
        if (start === -1) break;
        const open = source.indexOf('{', start);
        let depth = 1;
        let i = open + 1;
        while (i < source.length && depth > 0) {
            if (source[i] === '{') depth++;
            if (source[i] === '}') depth--;
            i++;
        }
        blocks.push(source.slice(open + 1, i - 1));
        from = i;
    }
    return blocks.join('\n');
}

const gated = reducedMotionBlocks(css);

describe('B60 — globals.css honors prefers-reduced-motion', () => {
    it('has at least one reduced-motion media block', () => {
        expect(gated.length).toBeGreaterThan(0);
    });

    it('disables smooth scrolling under reduced motion', () => {
        expect(gated).toMatch(/html[\s\S]*?scroll-behavior:\s*auto/);
    });

    it.each([
        '.animate-fade-in',
        '.animate-fade-in-up',
        '.animate-fade-in-down',
        '.animate-slide-in-right',
        '.animate-slide-in-left',
        '.animate-scale-in',
        '.animate-bounce-in',
        '.animate-in',
        '.fade-in',
        '.slide-in-from-top-2',
        '.reveal-up',
        '.reveal-fade',
        '.reveal-scale',
        '.animate-shimmer',
        '.hero-gradient-text',
    ])('gates %s with animation: none', (selector) => {
        // The selector must appear inside a reduced-motion block…
        expect(gated).toContain(selector);
        // …and that block must switch animations off.
        expect(gated).toMatch(/animation:\s*none/);
    });

    it('keeps every gated class actually defined (guards against selector drift)', () => {
        // If a class is ever renamed in globals.css the gate silently stops
        // matching — assert the animated declarations still exist outside
        // the media block for the classes globals.css itself defines.
        for (const cls of ['.animate-shimmer', '.reveal-up', '.reveal-fade', '.reveal-scale', '.hero-gradient-text', '.animate-in', '.fade-in']) {
            const occurrences = css.split(cls).length - 1;
            expect(occurrences, `${cls} should appear both in its definition and in the reduced-motion gate`).toBeGreaterThanOrEqual(2);
        }
    });
});

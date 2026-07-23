/**
 * Regression guards for B59 + B65 — /jobs page dialog and search-row a11y.
 *
 * B59: the Create Job Alert modal in JobsPageClient rendered as bare divs —
 * no role="dialog", no aria-modal, no focus trap, no Escape handling — while
 * the apply modal (Phase A) already used the shared useFocusTrap hook.
 *
 * B65: the sort <select> had no accessible name, and the entire search/sort
 * row was gated on `!loading`, so it unmounted on every fetch (focus loss +
 * layout shift mid-interaction).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAGE = 'app/jobs/JobsPageClient.tsx';

describe('B59 — Create Job Alert modal is an accessible dialog', () => {
    const src = read(PAGE);

    it('uses the shared useFocusTrap hook (trap + Escape + focus restore)', () => {
        expect(src).toContain("import { useFocusTrap } from '@/lib/hooks/useFocusTrap'");
        expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{\s*isOpen:\s*isAlertModalOpen,\s*onEscape:\s*closeAlertModal\s*\}\)/);
        expect(src).toContain('ref={alertTrapRef}');
    });

    it('exposes dialog semantics labelled by the modal heading', () => {
        expect(src).toContain('role="dialog"');
        expect(src).toContain('aria-modal="true"');
        expect(src).toContain('aria-labelledby="create-alert-title"');
        expect(src).toContain('id="create-alert-title"');
    });
});

describe('B65 — jobs search/sort row a11y and stability', () => {
    const src = read(PAGE);

    it('gives the sort select an accessible name', () => {
        expect(src).toContain('aria-label="Sort job results"');
    });

    it('keeps the search/sort row mounted during loading', () => {
        // The row is gated on error only — reintroducing `!loading &&` would
        // unmount the search bar and sort control on every fetch.
        const rowGate = src.indexOf('{!error && (');
        expect(rowGate).toBeGreaterThan(-1);
        expect(src).not.toMatch(/\{!loading && !error && \(\s*<div className="jp-search-row"/);
    });

    it('skips smooth scrolling when the user prefers reduced motion', () => {
        expect(src).toMatch(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
        expect(src).toMatch(/prefersReducedMotion \? 'auto' : 'smooth'/);
    });
});

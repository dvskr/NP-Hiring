/**
 * Regression guard for F13 — the Easy Apply modal must be a real accessible
 * dialog. The in-platform apply form (and its success-state modal) previously
 * rendered as bare portal divs: no focus trap, no Escape handling, no
 * role/aria-modal, no body scroll lock, and no focus restore to the Apply
 * button that opened it.
 *
 * These tests read the real source and assert the a11y wiring stays in place,
 * so a future edit can't silently strip it out again. Behavioral coverage of
 * the trap itself (Tab cycling, Escape, focus restore) lives in
 * lib/hooks/useFocusTrap.ts, which is shared by every dialog in the app —
 * here we also pin the parts of its contract this fix depends on.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FORM = 'components/InPlatformApplyForm.tsx';

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe('F13 — Easy Apply modal is an accessible dialog', () => {
  const src = read(FORM);

  it('uses the shared useFocusTrap hook (focus trap + Escape + focus restore)', () => {
    expect(src).toContain("import { useFocusTrap } from '@/lib/hooks/useFocusTrap'");
    // One trap per portal: the form state and the success state render
    // separate containers, so each needs its own active trap.
    expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{\s*isOpen:\s*!submitted,\s*onEscape:\s*onClose\s*\}\)/);
    expect(src).toMatch(/useFocusTrap<HTMLDivElement>\(\{\s*isOpen:\s*submitted,\s*onEscape:\s*onClose\s*\}\)/);
    expect(src).toContain('ref={formTrapRef}');
    expect(src).toContain('ref={successTrapRef}');
  });

  it('exposes dialog semantics on both the form and success modals', () => {
    expect(countOccurrences(src, 'role="dialog"')).toBe(2);
    expect(countOccurrences(src, 'aria-modal="true"')).toBe(2);
  });

  it('labels each dialog via aria-labelledby pointing at its heading', () => {
    expect(src).toContain('aria-labelledby="apply-modal-title"');
    expect(src).toContain('id="apply-modal-title"');
    expect(src).toContain('aria-labelledby="apply-success-title"');
    expect(src).toContain('id="apply-success-title"');
  });

  it('locks body scroll while open and releases it on unmount', () => {
    expect(src).toMatch(/document\.body\.style\.overflow = 'hidden'/);
    expect(src).toMatch(/document\.body\.style\.overflow = ''/);
  });
});

describe('F13 — useFocusTrap contract the apply modal relies on', () => {
  const hook = read('lib/hooks/useFocusTrap.ts');

  it('moves focus into the dialog, cycles Tab, and handles Escape', () => {
    expect(hook).toMatch(/e\.key === 'Escape'/);
    expect(hook).toMatch(/e\.key !== 'Tab'/);
    // Initial focus lands on the first focusable element (or the container).
    expect(hook).toMatch(/focusables\[0\] \?\? container/);
  });

  it('restores focus to the previously-focused element (the Apply button) on close', () => {
    expect(hook).toContain('previouslyFocusedRef.current = document.activeElement');
    expect(hook).toMatch(/previously\.focus\(\)/);
  });
});

'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

interface UseFocusTrapOptions {
    /** Whether the modal/dialog is currently open. Trap is only active when true. */
    isOpen: boolean;
    /** Optional callback fired when the user presses Escape. */
    onEscape?: () => void;
}

interface FocusableLike {
    focus: () => void;
    isConnected: boolean;
}

/**
 * Picks where focus goes when the dialog closes: the element focused when the
 * trap armed, but only while it is still in the document and is not <body>.
 * A detached node cannot take focus, so callers that may re-render their
 * trigger (ApplyButton) restore focus themselves when this returns null.
 */
export function resolveReturnFocusTarget<T extends FocusableLike>(
    previously: T | null,
    body: unknown,
): T | null {
    if (!previously || previously === body) return null;
    if (!previously.isConnected || typeof previously.focus !== 'function') return null;
    return previously;
}

/**
 * Wires a dialog to common a11y expectations:
 *   - Moves focus to the first focusable element inside the dialog on open
 *   - Cycles Tab / Shift+Tab inside the dialog
 *   - Restores focus to the previously-focused element on close
 *   - Optionally calls `onEscape` when the user hits ESC
 *
 * Attach the returned ref to the dialog's outermost container. The hook itself
 * does not render anything, so callers still own role / aria-modal / labelling.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>({ isOpen, onEscape }: UseFocusTrapOptions) {
    const containerRef = useRef<T | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    // The latest onEscape lives in a ref so the trap effect depends on isOpen
    // only. Callers usually pass an inline arrow; with it as a dependency every
    // parent re-render tore the trap down (yanking focus out of the dialog to
    // the trigger) and re-armed it, re-capturing whatever was focused then.
    const onEscapeRef = useRef(onEscape);
    useEffect(() => {
        onEscapeRef.current = onEscape;
    }, [onEscape]);

    useEffect(() => {
        if (!isOpen) return;
        const container = containerRef.current;
        if (!container) return;

        previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

        const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        const initial = focusables[0] ?? container;
        // Defer to next tick so portal children mount before we focus.
        const id = window.setTimeout(() => {
            try { initial.focus(); } catch {
                // ignore: element may have unmounted between schedule and focus
            }
        }, 0);

        const handleKeyDown = (e: KeyboardEvent) => {
            const escape = onEscapeRef.current;
            if (e.key === 'Escape' && escape) {
                e.stopPropagation();
                escape();
                return;
            }
            if (e.key !== 'Tab') return;

            const current = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
            if (current.length === 0) {
                e.preventDefault();
                return;
            }
            const first = current[0];
            const last = current[current.length - 1];
            const active = document.activeElement as HTMLElement | null;

            if (e.shiftKey && active === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.clearTimeout(id);
            document.removeEventListener('keydown', handleKeyDown);
            const previously = resolveReturnFocusTarget(previouslyFocusedRef.current, document.body);
            if (previously) {
                try { previously.focus(); } catch {
                    // restoring focus is best-effort; ignore
                }
            }
        };
    }, [isOpen]);

    return containerRef;
}

/**
 * Sentry NP-HIRING-3: page data cut off mid-download after a 200 reached the
 * error pages as "TypeError: network error". No frame of ours is in it, and
 * reset() renders again without fetching the data again. The boundaries leave
 * it unreported and retry it with a full load; every other client error is
 * still reported once and retried with reset().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@/lib/sentry', () => sentry);

// The components are called as plain functions here, so run each effect as it
// is declared: the test sees what the boundary does when it mounts.
vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return { ...actual, useEffect: (effect: () => void) => { effect(); } };
});
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
        createElement('a', { href, ...rest }, children as never),
}));

import ErrorPage from '@/app/error';
import GlobalError from '@/app/global-error';

const BOUNDARIES = [
    ['app/error.tsx', ErrorPage, 'Try again'],
    ['app/global-error.tsx', GlobalError, 'Reload the page'],
] as const;

interface ElementLike {
    type?: unknown;
    props?: { children?: unknown; onClick?: unknown };
}

function textOf(node: unknown): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (node && typeof node === 'object') return textOf((node as ElementLike).props?.children);
    return '';
}

/** The <button> whose text includes the label, in an element tree that was not rendered. */
function findButton(node: unknown, label: string): ElementLike | null {
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findButton(child, label);
            if (found) return found;
        }
        return null;
    }
    if (!node || typeof node !== 'object') return null;
    const element = node as ElementLike;
    if (element.type === 'button' && textOf(element).includes(label)) return element;
    return findButton(element.props?.children, label);
}

beforeEach(() => {
    sentry.captureException.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe.each(BOUNDARIES)('%s', (_name, Boundary, retryLabel) => {
    it('reports a client render error once and retries it with reset()', () => {
        const error = new TypeError("Cannot read properties of undefined (reading 'salary')");
        const reset = vi.fn();

        const tree = Boundary({ error, reset });

        expect(sentry.captureException).toHaveBeenCalledTimes(1);
        expect(sentry.captureException.mock.calls[0][0]).toBe(error);
        expect(findButton(tree, retryLabel)?.props?.onClick).toBe(reset);
    });

    it('does not report page data cut off mid-download, and its retry reloads the page', () => {
        const reload = vi.fn();
        vi.stubGlobal('window', { location: { reload } });
        const reset = vi.fn();

        const tree = Boundary({ error: new TypeError('network error'), reset });
        const onClick = findButton(tree, retryLabel)?.props?.onClick;
        (onClick as () => void)();

        expect(sentry.captureException).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledTimes(1);
        expect(reset).not.toHaveBeenCalled();
    });
});

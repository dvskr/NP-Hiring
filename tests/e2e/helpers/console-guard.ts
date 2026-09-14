import { expect, type Page } from '@playwright/test';

/**
 * Console + pageerror guard for journey specs.
 *
 * Install once per page (or per context page) and call `assertClean()` at
 * the end of the test. Uncaught exceptions (`pageerror`) always fail.
 * `console.error` lines fail unless they match a known-noise pattern or a
 * pattern the test explicitly allowed (e.g. a test that deliberately forces
 * a 500 to check the UI's error path).
 */

// Third-party / environmental noise that is not a product defect.
const DEFAULT_IGNORE: RegExp[] = [
    /gtag|googletagmanager|google-analytics|doubleclick|googlesyndication/i,
    /sentry|inngest/i,
    /favicon/i,
    /net::ERR_(BLOCKED_BY_CLIENT|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_REFUSED)/i,
    /Download the React DevTools/i,
    /was preloaded using link preload but not used/i,
    /ResizeObserver loop/i,
    /third-party cookie/i,
    // 4xx resource loads are expected on some pages (optional endpoints
    // like profile-snapshot 404, newsletter status, gated APIs). 5xx are not.
    /Failed to load resource: the server responded with a status of 4\d\d/i,
];

export interface ConsoleGuard {
    /** console.error messages captured so far (after ignore filtering). */
    readonly errors: string[];
    /** Uncaught exceptions captured so far. */
    readonly pageErrors: string[];
    /** Allow an additional pattern for this test (expected app-side error log). */
    allow(pattern: RegExp): void;
    /** Fail the test if anything unexpected was captured. */
    assertClean(): void;
}

export function installConsoleGuard(page: Page, extraAllow: RegExp[] = []): ConsoleGuard {
    const allow = [...DEFAULT_IGNORE, ...extraAllow];
    const errors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (allow.some((re) => re.test(text))) return;
        errors.push(`[${page.url()}] ${text}`);
    });
    page.on('pageerror', (err) => {
        pageErrors.push(`[${page.url()}] ${err.message}`);
    });

    return {
        errors,
        pageErrors,
        allow(pattern: RegExp) {
            allow.push(pattern);
        },
        assertClean() {
            // Re-filter at assertion time so late `allow()` calls apply to
            // messages captured before they were registered.
            const remaining = errors.filter((e) => !allow.some((re) => re.test(e)));
            expect(pageErrors, 'uncaught page errors').toEqual([]);
            expect(remaining, 'unexpected console.error output').toEqual([]);
        },
    };
}

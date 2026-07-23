/**
 * Regression: F35 — Sentry was blind to handled API errors.
 *
 * Nearly every API route catches errors and calls logger.error, which was
 * plain console output, so handled failures (checkout, webhooks, DB outages)
 * produced zero Sentry events. logger.error now forwards to
 * Sentry.captureException when a DSN is configured, with:
 *   - clean no-op when the DSN is absent
 *   - unchanged console output
 *   - double-capture protection (same Error logged twice, logged + rethrown
 *     into onRequestError, logged + lib/sentry.captureException)
 *   - a fixed-window rate limit so error loops can't flood Sentry
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const sentryMocks = vi.hoisted(() => ({
    captureException: vi.fn(),
    captureRequestError: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
    captureException: sentryMocks.captureException,
    captureRequestError: sentryMocks.captureRequestError,
    captureMessage: vi.fn(),
    setUser: vi.fn(),
    addBreadcrumb: vi.fn(),
    init: vi.fn(),
}));

const TEST_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';

let loggerMod: typeof import('@/lib/logger') | null = null;

/**
 * Deterministically await the fire-and-forget capture chain via the
 * logger's own flush hook — timer-based flushing raced under full-suite
 * worker contention and leaked captures across tests.
 */
async function flushAsync(): Promise<void> {
    if (loggerMod) {
        await loggerMod.flushSentryForwards();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function importLogger() {
    loggerMod = await import('@/lib/logger');
    return loggerMod;
}

const originalDsn = process.env.SENTRY_DSN;
const originalPublicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    // Fresh module state per test: rate-limit counters, cached SDK promise,
    // and lib/sentry's module-level DSN snapshot.
    vi.resetModules();
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
});

afterEach(async () => {
    // Drain any in-flight forwards from THIS test's module copy so a late
    // capture cannot land inside the next test's assertions.
    if (loggerMod) {
        await loggerMod.flushSentryForwards();
        loggerMod = null;
    }
    consoleErrorSpy.mockRestore();
    if (originalDsn === undefined) {
        delete process.env.SENTRY_DSN;
    } else {
        process.env.SENTRY_DSN = originalDsn;
    }
    if (originalPublicDsn === undefined) {
        delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    } else {
        process.env.NEXT_PUBLIC_SENTRY_DSN = originalPublicDsn;
    }
});

describe('logger.error → Sentry forwarding (F35)', () => {
    test('forwards the error to Sentry.captureException when SENTRY_DSN is set', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();
        const err = new Error('stripe checkout session failed');

        logger.error('Checkout failed', err, { requestId: 'req-1', path: '/api/create-checkout' });
        await flushAsync();

        expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
        const [captured, options] = sentryMocks.captureException.mock.calls[0];
        expect(captured).toBe(err);
        expect(options.extra).toMatchObject({
            logMessage: 'Checkout failed',
            requestId: 'req-1',
            path: '/api/create-checkout',
        });
    });

    test('no-ops cleanly when no DSN is configured', async () => {
        const { logger } = await importLogger();

        logger.error('DB outage', new Error('connection refused'));
        await flushAsync();

        expect(sentryMocks.captureException).not.toHaveBeenCalled();
        // Console output still happens.
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    test('keeps console output unchanged when forwarding is active', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();

        logger.error('Webhook failed', new Error('boom'), { requestId: 'req-2' });
        await flushAsync();

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const output = String(consoleErrorSpy.mock.calls[0][0]);
        expect(output).toContain('Webhook failed');
        expect(output).toContain('boom');
    });

    test('does not double-capture the same Error instance logged twice', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();
        const err = new Error('same error, two log lines');

        logger.error('First log', err);
        logger.error('Second log', err);
        await flushAsync();

        expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    });

    test('wraps non-Error values in an Error carrying the log message', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();

        logger.error('Resume parse failed', 'malformed pdf');
        await flushAsync();

        expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
        const [captured, options] = sentryMocks.captureException.mock.calls[0];
        expect(captured).toBeInstanceOf(Error);
        expect((captured as Error).message).toBe('Resume parse failed');
        expect(options.extra).toMatchObject({ originalValue: 'malformed pdf' });
    });

    test('skips "[Sentry]"-prefixed messages emitted by lib/sentry dev logging', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();

        logger.error('[Sentry] Exception captured', new Error('already handled by wrapper'));
        await flushAsync();

        expect(sentryMocks.captureException).not.toHaveBeenCalled();
    });

    test('rate-limits forwarding to 20 events per window', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();

        for (let i = 0; i < 25; i++) {
            logger.error(`error ${i}`, new Error(`err-${i}`));
        }
        await flushAsync();

        expect(sentryMocks.captureException).toHaveBeenCalledTimes(20);
        // Console output is never rate-limited.
        expect(consoleErrorSpy).toHaveBeenCalledTimes(25);
    });
});

describe('onRequestError double-capture guard', () => {
    test('skips errors already forwarded by logger.error, still captures others', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();
        const { onRequestError } = await import('@/instrumentation');

        const requestInfo = {
            path: '/api/test',
            method: 'POST',
            headers: {},
        } as Parameters<typeof onRequestError>[1];
        const errorContext = {
            routerKind: 'App Router',
            routePath: '/api/test',
            routeType: 'route',
        } as Parameters<typeof onRequestError>[2];

        // Caught, logged, then rethrown into Next.js error handling.
        const loggedErr = new Error('logged then rethrown');
        logger.error('Handler failed', loggedErr);
        await flushAsync();
        onRequestError(loggedErr, requestInfo, errorContext);
        expect(sentryMocks.captureRequestError).not.toHaveBeenCalled();

        // Genuinely uncaught error still goes through to the SDK.
        const uncaughtErr = new Error('never logged');
        onRequestError(uncaughtErr, requestInfo, errorContext);
        expect(sentryMocks.captureRequestError).toHaveBeenCalledTimes(1);
        expect(sentryMocks.captureRequestError).toHaveBeenCalledWith(uncaughtErr, requestInfo, errorContext);
    });
});

describe('lib/sentry.captureException interplay', () => {
    test('captureException skips an error already forwarded by logger.error', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();
        // Real module (tests/setup.ts mocks @/lib/sentry globally).
        const sentryLib = await vi.importActual<typeof import('@/lib/sentry')>('@/lib/sentry');

        const err = new Error('logged first, captured second');
        logger.error('Something failed', err);
        await flushAsync();
        expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);

        sentryLib.captureException(err, { tags: { area: 'payments' } });
        await flushAsync();
        expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    });

    test('logger.error skips an error already sent via captureException', async () => {
        process.env.SENTRY_DSN = TEST_DSN;
        const { logger } = await importLogger();
        const sentryLib = await vi.importActual<typeof import('@/lib/sentry')>('@/lib/sentry');

        const err = new Error('captured first, logged second');
        sentryLib.captureException(err);
        expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);

        logger.error('Also logged for the console', err);
        await flushAsync();
        expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    });
});

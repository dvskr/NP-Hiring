
/**
 * Structured Logger for Production
 *
 * Features:
 * - Log levels (debug, info, warn, error)
 * - JSON format in production, pretty in development
 * - Request context support
 * - Timestamp and metadata
 * - error() forwards to Sentry when a DSN is configured (see
 *   forwardErrorToSentry below) so handled errors in API route catch
 *   blocks are visible without every call site importing lib/sentry.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    requestId?: string;
    userId?: string;
    path?: string;
    method?: string;
    [key: string]: unknown;
}

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    context?: LogContext;
    error?: {
        message: string;
        stack?: string;
        name?: string;
    };
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

function getMinLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
        return envLevel;
    }
    return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[getMinLogLevel()];
}

function formatError(error: unknown): LogEntry['error'] | undefined {
    if (!error) return undefined;

    if (error instanceof Error) {
        return {
            message: error.message,
            stack: error.stack,
            name: error.name,
        };
    }

    return {
        message: String(error),
    };
}

function formatLog(level: LogLevel, message: string, context?: LogContext, error?: unknown): string {
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
    };

    if (context && Object.keys(context).length > 0) {
        entry.context = context;
    }

    if (error) {
        entry.error = formatError(error);
    }

    // JSON in production, pretty in development
    if (process.env.NODE_ENV === 'production') {
        try {
            return JSON.stringify(entry);
        } catch (err) {
            // Fallback for circular references or other serialization errors
            try {
                // Simple cycle-breaking serializer
                const getCircularReplacer = () => {
                    const seen = new WeakSet();
                    return (key: string, value: unknown) => {
                        if (typeof value === "object" && value !== null) {
                            if (seen.has(value)) {
                                return "[Circular]";
                            }
                            seen.add(value);
                        }
                        return value;
                    };
                };
                return JSON.stringify(entry, getCircularReplacer());
            } catch (fallbackErr) {
                // Ultimate fallback
                return `{"timestamp":"${entry.timestamp}","level":"error","message":"Failed to serialize log entry","error":"${String(err)}"}`;
            }
        }
    }

    // Pretty format for development
    const levelColors: Record<LogLevel, string> = {
        debug: '\x1b[36m', // cyan
        info: '\x1b[32m',  // green
        warn: '\x1b[33m',  // yellow
        error: '\x1b[31m', // red
    };
    const reset = '\x1b[0m';
    const color = levelColors[level];

    let output = `${color}[${level.toUpperCase()}]${reset} ${entry.timestamp} - ${message}`;

    if (context && Object.keys(context).length > 0) {
        output += `\n  Context: ${JSON.stringify(context, null, 2)}`;
    }

    if (error) {
        const formattedError = formatError(error);
        output += `\n  Error: ${formattedError?.message}`;
        if (formattedError?.stack) {
            output += `\n  Stack: ${formattedError.stack}`;
        }
    }

    return output;
}

// --- Sentry forwarding (F35) -----------------------------------------------
// Nearly every API route catches errors and calls logger.error, which used to
// be plain console output — so handled failures never reached Sentry. When a
// DSN is configured, error-level logs are forwarded to Sentry.captureException.
// The SDK is loaded lazily via dynamic import so client bundles never pull it
// in through this module, and everything degrades to a clean no-op when the
// DSN is absent (local dev, tests).

/**
 * Marker set on Error objects that have already been sent to Sentry.
 * Uses the global symbol registry (Symbol.for) so every copy of this module
 * — and lib/sentry.ts / instrumentation.ts — agree on the same key. Prevents
 * double-capture when an error is logged AND rethrown into onRequestError,
 * or logged AND passed to lib/sentry.captureException.
 */
const SENTRY_CAPTURED_MARKER = Symbol.for('np-hiring.sentry.captured');

export function isSentryCaptured(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as Record<symbol, unknown>)[SENTRY_CAPTURED_MARKER] === true
    );
}

export function markSentryCaptured(error: unknown): void {
    if (typeof error !== 'object' || error === null) return;
    try {
        (error as Record<symbol, unknown>)[SENTRY_CAPTURED_MARKER] = true;
    } catch {
        // Frozen/sealed error object — worst case is a duplicate Sentry event.
    }
}

// Simple fixed-window rate limit so a hot error loop can't flood Sentry.
const SENTRY_FORWARD_WINDOW_MS = 60_000;
const SENTRY_FORWARD_MAX_PER_WINDOW = 20;
let sentryForwardWindowStart = 0;
let sentryForwardCount = 0;

function underSentryRateLimit(now: number): boolean {
    if (now - sentryForwardWindowStart >= SENTRY_FORWARD_WINDOW_MS) {
        sentryForwardWindowStart = now;
        sentryForwardCount = 0;
    }
    if (sentryForwardCount >= SENTRY_FORWARD_MAX_PER_WINDOW) {
        return false;
    }
    sentryForwardCount += 1;
    return true;
}

interface SentryLike {
    captureException: (error: unknown, ctx?: { extra?: Record<string, unknown> }) => unknown;
}

let sentryModulePromise: Promise<SentryLike | null> | null = null;

/**
 * In-flight fire-and-forget Sentry forwards. Lets tests (and any graceful
 * shutdown path) await pending captures deterministically instead of
 * guessing with timers; entries remove themselves on settle.
 */
const pendingSentryForwards = new Set<Promise<unknown>>();

export function flushSentryForwards(): Promise<unknown> {
    return Promise.allSettled([...pendingSentryForwards]);
}

function loadSentry(): Promise<SentryLike | null> {
    if (!sentryModulePromise) {
        sentryModulePromise = import('@sentry/nextjs')
            .then((mod) => mod as unknown as SentryLike)
            .catch(() => null); // SDK unavailable in this runtime — console output already emitted
    }
    return sentryModulePromise;
}

/**
 * Best-effort, fire-and-forget forward of an error-level log to Sentry.
 * Never throws into the caller; console output is always emitted first by
 * Logger.error regardless of what happens here.
 */
function forwardErrorToSentry(message: string, error: unknown, context?: LogContext): void {
    try {
        // No-op unless a DSN is configured (same check as lib/sentry.ts).
        if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
        // Server/edge only — browser errors are handled by instrumentation-client.ts.
        if (typeof window !== 'undefined') return;
        // lib/sentry.ts emits '[Sentry] ...' dev logs right before capturing
        // itself; forwarding those would double-capture.
        if (message.startsWith('[Sentry]')) return;
        if (isSentryCaptured(error)) return;
        if (!underSentryRateLimit(Date.now())) return;

        markSentryCaptured(error);

        const toCapture = error instanceof Error ? error : new Error(message);
        const forward = loadSentry().then((Sentry) => {
            if (!Sentry) return;
            try {
                Sentry.captureException(toCapture, {
                    extra: {
                        logMessage: message,
                        ...(context ?? {}),
                        ...(error !== undefined && !(error instanceof Error)
                            ? { originalValue: String(error) }
                            : {}),
                    },
                });
            } catch {
                // Telemetry must never break the caller.
            }
        });
        pendingSentryForwards.add(forward);
        void forward.finally(() => pendingSentryForwards.delete(forward));
    } catch {
        // Forwarding must never throw into application code.
    }
}

class Logger {
    private context: LogContext = {};

    /**
     * Create a child logger with additional context
     */
    withContext(context: LogContext): Logger {
        const child = new Logger();
        child.context = { ...this.context, ...context };
        return child;
    }

    /**
     * Create a logger with request context
     */
    withRequest(requestId: string, path?: string, method?: string): Logger {
        return this.withContext({ requestId, path, method });
    }

    debug(message: string, context?: LogContext): void {
        if (!shouldLog('debug')) return;
        const output = formatLog('debug', message, { ...this.context, ...context });
        console.log(output);
    }

    info(message: string, context?: LogContext): void {
        if (!shouldLog('info')) return;
        const output = formatLog('info', message, { ...this.context, ...context });
        console.log(output);
    }

    warn(message: string, context?: LogContext, error?: unknown): void {
        if (!shouldLog('warn')) return;
        const output = formatLog('warn', message, { ...this.context, ...context }, error);
        console.warn(output);
    }

    error(message: string, error?: unknown, context?: LogContext): void {
        if (!shouldLog('error')) return;
        const mergedContext = { ...this.context, ...context };
        const output = formatLog('error', message, mergedContext, error);
        console.error(output);
        forwardErrorToSentry(message, error, mergedContext);
    }
}

// Singleton logger instance
export const logger = new Logger();

// Helper to create request-scoped logger
export function createRequestLogger(request: Request): Logger {
    const url = new URL(request.url);
    // Use global crypto for Edge/Node compatibility
    const requestId = crypto.randomUUID().slice(0, 8);
    return logger.withRequest(requestId, url.pathname, request.method);
}

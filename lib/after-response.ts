import { after } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * Run work that must not delay the response and must not be lost.
 *
 * A promise started on the way out of a request and never awaited can die when
 * the platform freezes the function after the response is sent. Registering it
 * with Next keeps the invocation alive until the task settles (bounded by the
 * route's maxDuration), so use this for the side effects of a request: events,
 * search pings, notification emails, audit rows.
 *
 * Outside a request (a script, a test that calls a handler directly) there is
 * nothing to register with, so the task simply runs.
 *
 * The task never rejects into the caller: a failure is logged under `label`.
 * Await the work instead when the response depends on its result.
 */
export function runAfterResponse(label: string, task: () => Promise<unknown> | unknown): void {
    const run = async (): Promise<void> => {
        try {
            await task();
        } catch (error) {
            logger.error(`[after-response] ${label} failed`, error);
        }
    };

    try {
        after(run);
    } catch {
        // `after` throws when called outside a request scope.
        void run();
    }
}

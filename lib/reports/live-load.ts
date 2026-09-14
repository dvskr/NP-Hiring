/**
 * Failure policy for the live /reports aggregates.
 *
 * The report pages are ISR (revalidate = 3600). If a loader swallowed a
 * transient database error and returned null, Next would cache the degraded
 * "unavailable right now" render for a full hour while sibling pages read
 * live data. So a loader:
 *   1. retries a failed aggregation a bounded number of times, then
 *   2. THROWS at request time. A throw during background revalidation makes
 *      Next keep serving the previous good render instead of caching the
 *      degraded one; on a cold request the error boundary renders.
 *   3. Only during `next build` does it resolve to null, so an unreachable
 *      build-time database omits the live blocks instead of failing the
 *      whole build (the next revalidation replaces that render).
 */
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

export const REPORT_LOAD_ATTEMPTS = 3;
export const REPORT_RETRY_BASE_MS = 250;

export interface LiveLoadOptions {
    attempts?: number;
    baseDelayMs?: number;
    isBuildPhase?: boolean;
    sleep?: (ms: number) => Promise<void>;
    onFailure?: (attempt: number, error: unknown) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

export function isProductionBuildPhase(): boolean {
    return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
}

export async function loadLiveReportData<T>(
    load: () => Promise<T>,
    options: LiveLoadOptions = {},
): Promise<T | null> {
    const attempts = Math.max(1, options.attempts ?? REPORT_LOAD_ATTEMPTS);
    const baseDelayMs = options.baseDelayMs ?? REPORT_RETRY_BASE_MS;
    const sleep = options.sleep ?? defaultSleep;
    const isBuildPhase = options.isBuildPhase ?? isProductionBuildPhase();

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await load();
        } catch (error) {
            lastError = error;
            options.onFailure?.(attempt, error);
            if (attempt < attempts) await sleep(baseDelayMs * attempt);
        }
    }

    if (isBuildPhase) return null;
    throw lastError instanceof Error
        ? lastError
        : new Error('Live report aggregation failed');
}

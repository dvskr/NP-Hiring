/**
 * Self-chaining dispatch for the aggregate-pseo cron (F7 fix, complement).
 *
 * The persisted cursor (./cursor) is the primary coverage mechanism — it
 * guarantees forward progress across scheduled runs even when everything
 * else fails. Chaining is the accelerator: after a batch finishes with
 * cities still remaining in the current rotation, fire a follow-up request
 * to this same route (authorized with CRON_SECRET) so a single scheduled
 * run walks the whole city list. Without it, 4,135 cities at 200 per
 * 6-hourly run would take ~5 days per rotation and could never stay inside
 * the 36h sitemap staleness window.
 */
import { after } from 'next/server'
import { getBaseUrl } from '@/lib/env'

/**
 * Hard cap on chain depth. A full rotation is ceil(4135 / 200) = 21 links;
 * 25 leaves headroom for city-list growth while making runaway recursion
 * impossible even if the cursor math ever regresses.
 */
export const MAX_CHAIN_DEPTH = 25

/**
 * How long the dispatching invocation waits for the follow-up request to be
 * accepted. The client side aborts after this — the downstream serverless
 * invocation keeps running once started, and waiting for its full response
 * (~250s per batch) would blow this function's own maxDuration.
 */
const CHAIN_DISPATCH_TIMEOUT_MS = 10_000

interface ChainArgs {
    /** Where the next link should start (0 = rotation complete, no chain). */
    nextOffset: number
    /** Depth of the CURRENT invocation (0 = scheduled entry run). */
    chainDepth: number
}

function errorName(error: unknown): string {
    if (error && typeof error === 'object' && 'name' in error) {
        return String((error as { name?: unknown }).name)
    }
    return ''
}

/**
 * Dispatch the next chain link. Returns true when a follow-up request was
 * scheduled, false when chaining is not possible or not needed. Never
 * throws — a failed dispatch just means the persisted cursor resumes the
 * rotation on the next scheduled run.
 */
export function dispatchSelfChain({ nextOffset, chainDepth }: ChainArgs): boolean {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
        console.warn('[pseo-agg] CRON_SECRET not set — skipping self-chain; cursor resumes next scheduled run')
        return false
    }
    if (nextOffset <= 0) return false // rotation complete — next scheduled run restarts at 0
    if (chainDepth >= MAX_CHAIN_DEPTH) {
        console.warn(`[pseo-agg] Chain depth cap ${MAX_CHAIN_DEPTH} reached — cursor at ${nextOffset} resumes next scheduled run`)
        return false
    }

    // mode=city: chained links skip Phase 1 (setting-state already refreshed
    // by the scheduled entry run) so the full time budget goes to cities.
    const url = `${getBaseUrl()}/api/cron/aggregate-pseo?offset=${nextOffset}&mode=city&chain=${chainDepth + 1}`

    // after() keeps the invocation alive until the dispatch settles — a bare
    // fire-and-forget fetch can be frozen with the function once the response
    // is returned (same pattern as the messaging routes).
    after(
        fetch(url, {
            method: 'GET',
            headers: { authorization: `Bearer ${cronSecret}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(CHAIN_DISPATCH_TIMEOUT_MS),
        })
            .then((res) => {
                if (!res.ok) {
                    console.error(`[pseo-agg] Chain link to offset ${nextOffset} rejected: HTTP ${res.status}`)
                }
            })
            .catch((error: unknown) => {
                // TimeoutError is the expected steady state: we only wait long
                // enough for the request to reach the platform, not for the
                // downstream batch (~250s) to finish. The downstream serverless
                // invocation continues after the client-side abort.
                const name = errorName(error)
                if (name === 'TimeoutError' || name === 'AbortError') return
                console.error(`[pseo-agg] Chain link to offset ${nextOffset} failed to dispatch:`, error)
            }),
    )

    return true
}

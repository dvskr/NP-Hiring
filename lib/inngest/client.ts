/**
 * Inngest client for the job-health workflow runtime.
 *
 * Inngest provides durable, replayable function execution with built-in
 * retry, scheduling, and concurrency controls — the right primitive for
 * the FP-recovery loop (re-probe at 6h/24h/72h after a dead-flip) that
 * Vercel cron alone can't model cleanly.
 *
 * Activation: set INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY in env. Until
 * those are set, Inngest functions still register on app boot but events
 * fired via `inngest.send(...)` fail.
 *
 * B108: that failure used to be invisible — most call sites are
 * fire-and-forget with a `.catch(warn)`, so in production with unset keys
 * every event (FP-recovery, embeddings, recommendation digests) died with
 * at most a low-severity warn nobody reads. Two mitigations here:
 *   1. A one-time module-load warning when INNGEST_EVENT_KEY is missing in
 *      production (instrumentation.ts also surfaces this at startup, B107).
 *   2. send() is decorated to emit a loud logger.error (which forwards to
 *      Sentry) BEFORE rethrowing, so callers' soft `.catch(warn)` handlers
 *      can no longer bury the drop.
 */

import { Inngest } from 'inngest';
import { logger } from '@/lib/logger';

export interface JobHealthFlippedEventData {
    jobId: string;
    sourceProvider: string | null;
    externalId: string | null;
    applyLink: string | null;
    flippedAt: string;
    /** The HealthReason that triggered the original flip. */
    triggeringReason: string;
}

export interface FpRecoveryProbeEventData {
    jobId: string;
    sourceProvider: string | null;
    externalId: string | null;
    applyLink: string | null;
    attempt: 1 | 2 | 3;
    /** ISO timestamp from the original flip. */
    originallyFlippedAt: string;
}

/**
 * F23: admin email broadcasts run as a durable Inngest function instead of a
 * fire-and-forget promise in a freezing lambda. The admin route emits this
 * event; lib/inngest/functions/broadcast-send.ts consumes it (and the
 * stuck-broadcast sweep re-emits it for runs that died mid-send).
 */
export const BROADCAST_REQUESTED_EVENT = 'admin/broadcast.requested';

export interface BroadcastRequestedEventData {
    broadcastId: string;
}

/**
 * This board's Inngest app id — a DURABLE IDENTITY, not a display string.
 *
 * It must be unique per deployed board. Until 2026-08-12 this file carried
 * the donor template's app id verbatim, inherited when this board was
 * forked: two deployed apps registered under one id, so Inngest routed both
 * boards' events and cron registrations into the same app. The donor board
 * now pins its own id with a CI test; this constant plus
 * `tests/regressions/inngest-app-id.test.ts` — which names the foreign id
 * explicitly and fails on it — is the symmetric lock on our side, so a
 * future fork fails CI instead of silently rerouting production.
 *
 * Do NOT derive this from a brand/display token: renaming the board would
 * then silently change the app id and orphan every in-flight durable run.
 * Changing this value is a migration, not a rename — in-flight multi-step
 * runs (fp-recovery sleeps up to 72h) do not carry over.
 */
export const INNGEST_APP_ID = 'np-hiring';

export const inngest = new Inngest({
    id: INNGEST_APP_ID,
});

// B108 (1): unset keys in production means every send() below will fail —
// say so once at module load instead of leaving a per-event breadcrumb trail.
if (process.env.NODE_ENV === 'production' && !process.env.INNGEST_EVENT_KEY) {
    console.error(
        '[Inngest] INNGEST_EVENT_KEY is not set in production — all inngest.send() ' +
        'events (FP-recovery, embeddings, digests, reconciliation) will be dropped',
    );
}

// B108 (2): decorate send() so every failure produces a loud, Sentry-forwarded
// error log even when the call site is fire-and-forget with a soft .catch().
// The original rejection is rethrown unchanged so existing caller semantics
// (fire-and-forget must never fail the request) are preserved.
const rawSend = inngest.send.bind(inngest);
inngest.send = (async (...args: Parameters<typeof rawSend>) => {
    try {
        return await rawSend(...args);
    } catch (err) {
        const payload = args[0];
        const events = Array.isArray(payload) ? payload : [payload];
        const names = events
            .map((e) => (e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : 'unknown'))
            .join(', ');
        logger.error('[Inngest] send() failed — event(s) dropped', err, {
            events: names,
            eventKeyConfigured: Boolean(process.env.INNGEST_EVENT_KEY),
        });
        throw err;
    }
}) as typeof inngest.send;

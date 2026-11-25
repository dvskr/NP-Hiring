/**
 * Emergency stop for automated outbound messaging.
 *
 * The automated senders (job alert digests, candidate alerts, saved-job
 * reminders, the monthly employer report, push notifications, the weekly
 * recommendation digest and admin broadcasts) run by default: there is no
 * variable to set to turn them on and no per-feature switch to remember. What
 * remains is a single brake for the one case that matters, a defect found
 * while a cron is messaging real people. Setting OUTBOUND_MESSAGING_PAUSED=1
 * in the hosting environment stops every automated send from the next
 * invocation, with no code change (a host that applies variables only to new
 * deployments needs a redeploy). Unset it and sending resumes.
 *
 * '1', 'true' and 'yes' all engage it, in any case and with spaces around
 * them, because a brake pulled in a hurry must not fail on the spelling: an
 * operator who types "true" during an incident means stop. Any other value,
 * '0' and 'false' included, leaves sending on.
 *
 * Enforced in two places, and it needs both: each cron and background job
 * checks it up front so a pause costs no work, and sendAndLog
 * (lib/email-service.ts) checks it where marketing mail leaves, so a sender
 * added later cannot forget it. Job alert digests bypass sendAndLog (the
 * provider's batch API) and push notifications are not email at all, which is
 * why the checks in the crons are not redundant.
 *
 * This is deliberately not a feature flag: normal operation requires nothing
 * to be set. Transactional mail (receipts, confirmations, application
 * notifications, expiry warnings) is never paused here, and neither are the
 * two marketing emails a person asks for and waits on: the job alert
 * confirmation and the salary guide.
 */
/** The values of OUTBOUND_MESSAGING_PAUSED that engage the brake, compared trimmed and lowercased. */
const PAUSED_VALUES: ReadonlySet<string> = new Set(['1', 'true', 'yes']);

export function isOutboundPaused(): boolean {
    const value = process.env.OUTBOUND_MESSAGING_PAUSED;
    return value !== undefined && PAUSED_VALUES.has(value.trim().toLowerCase());
}

/** Human-readable reason for API responses and cron results. */
export const OUTBOUND_PAUSED_MESSAGE =
    'OUTBOUND_MESSAGING_PAUSED is set, so automated sending is paused. Unset it to resume.';

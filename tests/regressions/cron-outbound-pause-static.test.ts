/**
 * OUTBOUND_MESSAGING_PAUSED (lib/outbound-kill-switch.ts) is the one brake
 * that stops every automated sender. A brake that misses one sender is
 * decorative at the worst possible time, so each sender must read it before
 * its first real work, and the two places mail leaves (sendAndLog and the
 * broadcast engine) must read it before anything is handed over.
 *
 * Source assertions, comments blanked (tests/helpers/source.ts), for paths
 * that need a live cron trigger, an Inngest run or a database to exercise.
 * The behaviour is pinned in tests/api/cron-outbound-pause.test.ts,
 * tests/lib/broadcast-outbound-pause.test.ts, tests/lib/outbound-kill-switch.test.ts
 * and tests/api/hunt-admin-broadcast-send.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readCode } from '../helpers/source';

const PAUSE_CHECK = 'isOutboundPaused()';

/** [file, the first line of real work the brake has to come before]. */
const PAUSED_BEFORE_WORK: ReadonlyArray<readonly [string, string]> = [
    ['app/api/cron/send-alerts/route.ts', 'sendJobAlerts('],
    ['app/api/cron/candidate-alerts/route.ts', 'await loadActiveAlerts('],
    ['app/api/cron/saved-job-reminder/route.ts', 'prisma.savedJob'],
    ['app/api/cron/employer-report/route.ts', 'prisma.employerJob'],
    ['app/api/cron/push-notifications/route.ts', 'prisma.job.findMany'],
    ['app/api/admin/email/send/route.ts', 'await resolveRecipients('],
    ['app/api/admin/email/resume/route.ts', 'await resumeBroadcast('],
    ['lib/inngest/functions/recommendation-digest.ts', "'list-eligible-candidates'"],
    ['lib/inngest/functions/broadcast-send.ts', "'mark-sending'"],
];

describe('the emergency brake reaches every automated sender', () => {
    it.each(PAUSED_BEFORE_WORK)('%s checks isOutboundPaused before it does any work', (rel, workMarker) => {
        const src = readCode(rel);
        const pauseIdx = src.indexOf(PAUSE_CHECK);
        const workIdx = src.indexOf(workMarker);

        expect(pauseIdx).toBeGreaterThan(-1);
        expect(workIdx).toBeGreaterThan(-1);
        expect(pauseIdx).toBeLessThan(workIdx);
    });

    it('the broadcast engine reads it before a chunk reads anyone, and before the inline send starts', () => {
        const src = readCode('lib/broadcast-sender.ts');
        const chunk = src.slice(src.indexOf('export async function processBroadcastChunk'));
        expect(chunk.indexOf(PAUSE_CHECK)).toBeGreaterThan(-1);
        expect(chunk.indexOf(PAUSE_CHECK)).toBeLessThan(chunk.indexOf('emailBroadcast.findUnique'));

        const inline = src.slice(src.indexOf('export async function executeBroadcast'));
        expect(inline.indexOf(PAUSE_CHECK)).toBeGreaterThan(-1);
        expect(inline.indexOf(PAUSE_CHECK)).toBeLessThan(inline.indexOf('emailBroadcast.findUnique'));
    });

    it('the choke point every marketing send passes through reads it before the provider call', () => {
        const src = readCode('lib/email-service.ts');
        const sendIdx = src.indexOf('resend.emails.send(sendParams');
        const gateIdx = src.indexOf('heldByOutboundPause(emailType)');
        expect(sendIdx).toBeGreaterThan(-1);
        expect(src.indexOf(PAUSE_CHECK)).toBeGreaterThan(-1);
        expect(gateIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeLessThan(sendIdx);
    });
});

describe('the count an admin approves is the list a broadcast sends', () => {
    it('the audience count and the send both build named audiences with the one builder', () => {
        for (const rel of ['app/api/admin/email/audience/route.ts', 'app/api/admin/email/send/route.ts']) {
            const src = readCode(rel);
            expect(src, rel).toMatch(/buildSegmentRecipients\(/);
            // No private audience query left beside it.
            expect(src, rel).not.toMatch(/prisma\.(emailLead|userProfile)\.findMany/);
        }
    });
});

describe('the admin test send goes to the admin who clicked it, and stays out of History', () => {
    it('sends the signed-in admin address with isTest set', () => {
        const page = readCode('app/admin/email/page.tsx');
        const testSend = page.slice(page.indexOf('const handleTestSend'), page.indexOf('const fetchHistory'));
        expect(testSend).toMatch(/customEmails:\s*\[adminEmail\]/);
        expect(testSend).toMatch(/isTest:\s*true/);
    });
});

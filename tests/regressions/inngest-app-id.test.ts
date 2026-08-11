/**
 * Inngest app-id ownership lock (2026-08-12).
 *
 * This board was forked from the PMHNP template and inherited its Inngest
 * app id verbatim (`pmhnp-job-board`). Two deployed apps registering under
 * one id means Inngest treats them as the same app: cron registrations and
 * events cross-route between boards, in production, silently — nothing
 * fails, the wrong app just serves the work.
 *
 * The donor board pins its own id in CI. This is the symmetric lock on our
 * side: a future fork (or a copy-paste of client.ts) fails here instead of
 * quietly rerouting someone else's production traffic.
 *
 * If you are intentionally changing INNGEST_APP_ID, understand it is a
 * MIGRATION, not a rename: in-flight durable runs registered under the old
 * id are orphaned (fp-recovery chains sleep up to 72h). Update this test in
 * the same commit, and expect the new app to appear fresh in the Inngest
 * dashboard.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { INNGEST_APP_ID, inngest } from '@/lib/inngest/client';

const CLIENT_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../lib/inngest/client.ts'),
    'utf8',
);

/** Every board id this app must never claim, because another board owns it. */
const FOREIGN_APP_IDS = ['pmhnp-job-board'];

describe('Inngest app id ownership', () => {
    it('is this board’s own id', () => {
        expect(INNGEST_APP_ID).toBe('np-hiring');
    });

    it('never claims an app id owned by another board', () => {
        for (const foreign of FOREIGN_APP_IDS) {
            expect(
                INNGEST_APP_ID,
                `INNGEST_APP_ID is "${foreign}", which belongs to a different deployed board. ` +
                'Two apps under one Inngest id cross-route cron registrations and events in ' +
                'production. Pick an id unique to this board.',
            ).not.toBe(foreign);

            expect(
                CLIENT_SRC.includes(`'${foreign}'`) || CLIENT_SRC.includes(`"${foreign}"`),
                `lib/inngest/client.ts still contains the foreign app id "${foreign}" as a live ` +
                'string literal. Prose references in comments are fine; a quoted literal is not.',
            ).toBe(false);
        }
    });

    it('is actually the id the client registers with', () => {
        // Guards the split-brain case: the constant is right but the Inngest
        // constructor was passed something else.
        expect(inngest.id).toBe(INNGEST_APP_ID);
    });

    it('is a stable literal, not derived from a mutable brand/display token', () => {
        // Deriving the id from a display name means a rebrand silently changes
        // the app id and orphans every in-flight durable run.
        const declaration = CLIENT_SRC.match(/export const INNGEST_APP_ID\s*=\s*([^;]+);/);
        expect(declaration, 'INNGEST_APP_ID declaration not found').not.toBeNull();
        expect(
            declaration![1].trim(),
            'INNGEST_APP_ID must be a plain string literal — no brand tokens, no template ' +
            'interpolation, no slugify() of a display name.',
        ).toMatch(/^'[a-z0-9-]+'$/);
    });

    it('is a valid, non-empty slug', () => {
        expect(INNGEST_APP_ID).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
        expect(INNGEST_APP_ID.length).toBeGreaterThan(2);
    });
});

/**
 * lib/admin/job-hold.ts: what an admin takedown and an admin release write,
 * what the owner of a posting under a hold is told, and what the audit row
 * records about the hold.
 *
 * Pinned:
 *   - A takedown writes the hold and the manual flag (the flag every
 *     automatic republisher leaves alone), never the owner's pause fields.
 *   - A release clears the hold and any earlier pause.
 *   - The owner's message names this board and its support address, in the
 *     house style.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect } from 'vitest';
import { brand } from '@/config/brand';
import { ADMIN_HOLD_MESSAGE, adminReleaseData, adminTakedownData, holdChange } from '@/lib/admin/job-hold';

const VISIBLE_DASH = /[–—]|\s-\s/;

describe('a takedown', () => {
    it('sets the hold and the manual flag, and never the fields of an owner pause', () => {
        const since = new Date('2026-11-11T00:00:00.000Z');

        const data = adminTakedownData(since);

        expect(data).toEqual({ isPublished: false, isManuallyUnpublished: true, adminHoldAt: since });
        expect(data).not.toHaveProperty('unpublishReason');
        expect(data).not.toHaveProperty('unpublishedAt');
    });

    it('with no earlier hold, starts the hold now', () => {
        const before = Date.now();

        const { adminHoldAt } = adminTakedownData();

        expect(adminHoldAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(adminHoldAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
});

describe('a release', () => {
    it('ends the hold and any earlier pause', () => {
        expect(adminReleaseData()).toEqual({ isPublished: true, isManuallyUnpublished: false, adminHoldAt: null });
    });

    it('returns a new object each time, so one write never shares state with another', () => {
        const first = adminReleaseData();
        const second = adminReleaseData();

        expect(first).not.toBe(second);
        expect(adminTakedownData()).not.toBe(adminTakedownData());
    });
});

describe('what the owner is told', () => {
    it('names this board and its support address', () => {
        expect(ADMIN_HOLD_MESSAGE).toContain(brand.name);
        expect(ADMIN_HOLD_MESSAGE).toContain(brand.email.support);
        expect(ADMIN_HOLD_MESSAGE).toMatch(/taken down/);
    });

    it('follows the house style: no en or em dash and no spaced hyphen', () => {
        expect(ADMIN_HOLD_MESSAGE).not.toMatch(VISIBLE_DASH);
    });
});

describe('holdChange, for the audit row', () => {
    const SINCE = new Date('2026-10-01T00:00:00.000Z');

    it.each([
        ['an unpublish of a posting with no hold places one', false, null, 'placed'],
        ['an unpublish of a held posting keeps the hold', false, SINCE, 'kept'],
        ['a publish of a held posting lifts the hold', true, SINCE, 'lifted'],
        ['a publish of a posting with no hold changes none', true, null, 'none'],
        ['an unknown prior hold counts as none', true, undefined, 'none'],
    ] as const)('%s', (_case, isPublished, priorHoldAt, expected) => {
        expect(holdChange(isPublished, priorHoldAt)).toBe(expected);
    });
});

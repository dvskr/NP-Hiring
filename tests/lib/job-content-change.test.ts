/**
 * Job.contentChangedAt bookkeeping (indexing audit CS-02 / TECH-04,
 * fixSoon 5): it moves on real content edits only, never on bookkeeping.
 */
import { describe, it, expect } from 'vitest';
import { changedRenderedFields, contentChangeStamp, RENDERED_JOB_FIELDS } from '@/lib/job-content-change';

const NOW = new Date('2026-09-28T12:00:00Z');

describe('changedRenderedFields', () => {
    const prior = {
        title: 'PMHNP',
        description: 'Full description',
        city: 'Austin',
        benefits: ['Dental', 'PTO'],
        expiresAt: new Date('2026-10-30T00:00:00Z'),
        minSalary: null,
    };

    it('reports a changed rendered field', () => {
        expect(changedRenderedFields(prior, { title: 'PMHNP (Remote)' })).toEqual(['title']);
    });

    it('ignores unchanged values, undefined ("leave alone") and empty-equivalents', () => {
        expect(changedRenderedFields(prior, { title: 'PMHNP', city: undefined, minSalary: '' })).toEqual([]);
    });

    it('compares dates by instant and lists as sets', () => {
        expect(changedRenderedFields(prior, {
            expiresAt: '2026-10-30T00:00:00.000Z',
            benefits: ['PTO', 'Dental'],
        })).toEqual([]);
        expect(changedRenderedFields(prior, { expiresAt: new Date('2026-11-01T00:00:00Z') })).toEqual(['expiresAt']);
    });

    it('never counts bookkeeping columns', () => {
        const bookkeeping = {
            viewCount: 9, applyClickCount: 3, qualityScore: 70, lastLinkCheckedAt: NOW,
            lastEnrichedAt: NOW, healthLastSeenAt: NOW, healthConsecutiveMissing: 0, updatedAt: NOW,
            isFeatured: true, isPublished: true,
        };
        expect(changedRenderedFields({}, bookkeeping)).toEqual([]);
        for (const field of Object.keys(bookkeeping)) {
            expect(RENDERED_JOB_FIELDS as readonly string[]).not.toContain(field);
        }
    });
});

describe('contentChangeStamp', () => {
    it('stamps a content edit', () => {
        expect(contentChangeStamp({ title: 'A' }, { title: 'B' }, { now: NOW })).toEqual({ contentChangedAt: NOW });
    });

    it('stamps a revival even with no field change', () => {
        expect(contentChangeStamp({}, {}, { revived: true, now: NOW })).toEqual({ contentChangedAt: NOW });
    });

    it('leaves an unchanged save alone', () => {
        expect(contentChangeStamp({ title: 'A' }, { title: 'A', lastEnrichedAt: NOW })).toEqual({});
    });
});

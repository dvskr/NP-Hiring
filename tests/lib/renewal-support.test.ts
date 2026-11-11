/**
 * Two small pieces the ingest renewal stands on.
 *
 *  - The raw ids of a fetch and the external id the normalizer stores are
 *    the same string, for every source. The presence check and the renewal
 *    both look a stored id up in the raw list; if the two ever differed, no
 *    stored posting would be found in its own fetch.
 *  - A recovery re-probe knows when the job no longer carries the posting it
 *    was scheduled for.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/inngest/client', () => ({
    inngest: { createFunction: vi.fn(() => ({})), send: vi.fn() },
}));

import { collectExternalIds } from '@/lib/ingestion-service';
import { normalizeJobWithReason } from '@/lib/job-normalizer';
import { aggregators } from '@/lib/aggregators/registry';
import { carriesAnotherPosting } from '@/lib/inngest/functions/fp-recovery';

const DESCRIPTION =
    'We are hiring a Family Nurse Practitioner for our primary care clinic. ' +
    'You will see adult patients for annual exams, chronic care and follow-up visits, ' +
    'work with a team of physicians and nurses, and keep a full-time schedule Monday to Friday. ' +
    'Benefits include health insurance, paid time off and a continuing education allowance.';

function rawPosting(ids: Record<string, unknown>): Record<string, unknown> {
    return {
        title: 'Family Nurse Practitioner',
        employer: 'Example Health Group',
        company: 'Example Health Group',
        location: 'Boston, MA',
        description: DESCRIPTION,
        applyLink: 'https://careers.example.com/jobs/123',
        ...ids,
    };
}

describe('raw ids and stored ids agree', () => {
    const sources = Object.keys(aggregators);

    it.each(sources)('%s: the id the normalizer stores is the id the fetch list carries', (source) => {
        // Every field the two readers try, each with a different value: the
        // readers must agree on which one wins.
        const shapes: Array<Record<string, unknown>> = [
            { externalId: `${source}-first`, id: 'second', external_id: 'third' },
            { id: `${source}-second`, external_id: 'third' },
            { external_id: `${source}-third` },
            { externalId: `  ${source}-padded  ` },
            // An empty first field: both readers go on to the next one.
            { externalId: '', id: `${source}-after-empty` },
        ];
        for (const ids of shapes) {
            const raw = rawPosting(ids);
            const normalized = normalizeJobWithReason(raw, source);
            expect(normalized.job, `${source} rejected the fixture: ${normalized.rejectionReason}`).not.toBeNull();
            expect(collectExternalIds([raw], source)).toEqual([normalized.job?.externalId]);
        }
    });
});

describe('carriesAnotherPosting', () => {
    const flipped = { applyLink: 'https://ats.example/acme/1', externalId: 'lever-acme-1' };

    it('is false while the job still carries the posting it was flipped with', () => {
        expect(carriesAnotherPosting({ ...flipped }, flipped)).toBe(false);
    });

    it('is true once the renewal pointed the job at another posting', () => {
        expect(carriesAnotherPosting({ applyLink: 'https://ats.example/acme/2', externalId: 'lever-acme-2' }, flipped)).toBe(true);
        // The link alone, or the id alone, is enough.
        expect(carriesAnotherPosting({ applyLink: 'https://ats.example/acme/2', externalId: 'lever-acme-1' }, flipped)).toBe(true);
        expect(carriesAnotherPosting({ applyLink: flipped.applyLink, externalId: 'lever-acme-2' }, flipped)).toBe(true);
    });

    it('does not compare an id the flip never recorded', () => {
        expect(carriesAnotherPosting({ applyLink: flipped.applyLink, externalId: 'anything' }, { applyLink: flipped.applyLink, externalId: null })).toBe(false);
        expect(carriesAnotherPosting({ applyLink: flipped.applyLink, externalId: null }, { applyLink: flipped.applyLink, externalId: undefined })).toBe(false);
    });
});

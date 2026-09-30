/**
 * CQ-05 (indexing audit): a job's category tags must follow its structured
 * fields wherever those fields are written, not only at first normalization.
 *
 *   - The normalizer passes the reconciled work mode (isRemote and isHybrid)
 *     and the stored employer name (the VA rule reads it) to the tagger.
 *   - The inline LLM rescue can fill the job type, the work mode, setting and
 *     population; the tags are recomputed from the merged row.
 *   - A renewal delta that fills or repairs a tagger input re-derives the tags
 *     in the same write (renewalCategoryTags).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    CATEGORY_TAG_INPUT_FIELDS,
    categoryTagsForRow,
    mergeLlmIntoNormalized,
    renewalCategoryTags,
    touchesCategoryTagInputs,
} from '@/lib/ingestion-service';
import { normalizeJobWithReason } from '@/lib/job-normalizer';

const BODY =
    'We are seeking a nurse practitioner to provide primary care for adults in our clinic. You will ' +
    'assess and treat patients, order and interpret tests, prescribe medications and coordinate care ' +
    'with physicians and nurses. Requirements include an active NP license, board certification and ' +
    'one year of experience. The schedule is Monday to Friday with no call and a full benefits package.';

const baseRow = {
    title: 'Nurse Practitioner',
    description: BODY,
    descriptionSummary: null,
    jobType: null as string | null,
    isRemote: false,
    isHybrid: false,
    setting: null as string | null,
    population: null as string | null,
    newGradFriendly: false,
    minYearsExperience: null as number | null,
    employer: 'Acme Health',
};

describe('categoryTagsForRow', () => {
    it('tags remote only for a fully remote row, never a hybrid one', () => {
        expect(categoryTagsForRow({ ...baseRow, isRemote: true })).toContain('remote');
        expect(categoryTagsForRow({ ...baseRow, isHybrid: true, description: `${BODY} Hybrid role, 1 to 2 days remotely.` })).not.toContain('remote');
    });

    it('reads the employer for the VA rule', () => {
        expect(categoryTagsForRow({ ...baseRow, employer: 'Department of Veterans Affairs' })).toContain('va');
        expect(categoryTagsForRow(baseRow)).not.toContain('va');
    });
});

describe('the normalizer hands the tagger the reconciled mode and the employer', () => {
    it('a Department of Veterans Affairs posting is tagged va at ingest', () => {
        const result = normalizeJobWithReason(
            {
                title: 'Nurse Practitioner',
                company: 'Department of Veterans Affairs',
                location: 'Denver, CO',
                description: BODY,
                applyLink: 'https://jobs.example.com/va/1',
                externalId: 'va-1',
            },
            'greenhouse',
        );
        expect(result.job?.categoryTags).toContain('va');
    });

    it('a hybrid posting is never tagged remote at ingest', () => {
        const result = normalizeJobWithReason(
            {
                title: 'Nurse Practitioner (Hybrid)',
                company: 'Acme Health',
                location: 'Denver, CO',
                description: `${BODY} This is a hybrid role: 2 to 3 days in office, 1 to 2 days remotely.`,
                applyLink: 'https://jobs.example.com/acme/2',
                externalId: 'acme-2',
            },
            'greenhouse',
        );
        expect(result.job?.isHybrid).toBe(true);
        expect(result.job?.categoryTags).not.toContain('remote');
    });
});

describe('mergeLlmIntoNormalized recomputes the tags when the LLM fills a tagger input', () => {
    const normalized = { ...baseRow, mode: null, categoryTags: ['primary-care'] };

    it('a Remote work mode from the LLM adds the remote tag', () => {
        const next = mergeLlmIntoNormalized(normalized, { work_mode: 'Remote' });
        expect(next.isRemote).toBe(true);
        expect(next.categoryTags).toContain('remote');
        expect(next.categoryTags).toEqual(categoryTagsForRow(next));
    });

    it('a Part-Time job type from the LLM adds the part-time tag', () => {
        const next = mergeLlmIntoNormalized(normalized, { job_type: 'Part-Time' });
        expect(next.categoryTags).toContain('part-time');
    });

    it('leaves the tags alone when the LLM changes no tagger input', () => {
        const next = mergeLlmIntoNormalized(normalized, { benefits: ['401k'] });
        expect(next.categoryTags).toEqual(['primary-care']);
    });
});

describe('renewalCategoryTags', () => {
    const existing = { ...baseRow, categoryTags: categoryTagsForRow(baseRow) as string[] };

    it('re-derives the tags when the delta fills the job type', () => {
        const tags = renewalCategoryTags(existing, { jobType: 'Part-Time' });
        expect(tags).toContain('part-time');
    });

    it('re-derives the tags when the delta repairs the work-mode flags', () => {
        const remoteRow = { ...existing, isRemote: true, isHybrid: true, categoryTags: ['remote'] };
        const tags = renewalCategoryTags(remoteRow, { isRemote: false, isHybrid: true });
        expect(tags).not.toBeNull();
        expect(tags).not.toContain('remote');
    });

    it('returns null for a delta that touches no tagger input', () => {
        expect(renewalCategoryTags(existing, {})).toBeNull();
        expect(renewalCategoryTags(existing, { minSalary: 120000, benefits: ['401k'] })).toBeNull();
    });

    it('returns null when the recomputed tags equal the stored ones', () => {
        expect(renewalCategoryTags(existing, { setting: null })).toBeNull();
    });

    it('touchesCategoryTagInputs covers every tagger input, the mode included', () => {
        for (const field of CATEGORY_TAG_INPUT_FIELDS) {
            expect(touchesCategoryTagInputs({ [field]: null }), field).toBe(true);
        }
        expect(touchesCategoryTagInputs({ displaySalary: '$120k' })).toBe(false);
    });
});

describe('renewJob writes the re-derived tags in the same update', () => {
    // renewJob is a closure inside ingestJobs; pin the wiring in the source.
    const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'ingestion-service.ts'), 'utf8');
    const start = source.indexOf('const renewJob = async (');
    const renewJob = source.slice(start, source.indexOf('// Process each job', start));

    it('selects the remaining tagger inputs and the stored tags', () => {
        for (const field of ['title: true', 'employer: true', 'newGradFriendly: true', 'minYearsExperience: true', 'categoryTags: true']) {
            expect(renewJob).toContain(field);
        }
    });

    it('sets update.categoryTags from renewalCategoryTags before the write', () => {
        const tagsAt = renewJob.indexOf('renewalCategoryTags(existing, delta)');
        const writeAt = renewJob.indexOf('await prisma.job.update({ where: { id }, data: update })');
        expect(tagsAt).toBeGreaterThan(-1);
        expect(writeAt).toBeGreaterThan(tagsAt);
        expect(renewJob).toContain('if (categoryTags) update.categoryTags = categoryTags;');
    });
});

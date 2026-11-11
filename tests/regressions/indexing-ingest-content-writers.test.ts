/**
 * Indexing audit (CS-02 / GFJ-01 / GFJ-04 / GFJ-06, fixSoon 5 and 6):
 * static and behavioural pins on the job writers.
 *
 *   - contentChangedAt is set on create, on a renewal only through
 *     shouldStampContentChange, and by every rewriter of a rendered field,
 *     and only when the value really changes.
 *   - enrich-jobs no longer publishes guesses: a missing location is not
 *     remote, an unknown mode is not In-Person, an unknown type is not
 *     Full-Time, and "United States" is not a state.
 *   - enrich-thin-jds never inflates a stub into a long-form posting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { parseJobLocation } from '@/lib/location-parser';
import { renewExistingJob } from '@/lib/ingestion-service';
import { RENEWAL_NOW, SWEPT_BY_PRESENCE, installStoredJob, ownListingOf, storedJob } from '../helpers/renewal';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

describe('ingestion-service stamps contentChangedAt on create and on real renewals', () => {
    const src = read('lib/ingestion-service.ts');

    it('sets it in the create payload', () => {
        const create = src.slice(src.indexOf('const savedJob = await prisma.job.create({'));
        expect(create.slice(0, 600)).toContain('contentChangedAt: new Date(),');
    });

    // The renewal is run, not read (tests/helpers/renewal.ts).
    it('a plain "still listed" renewal writes updatedAt and leaves contentChangedAt alone', async () => {
        const job = storedJob();
        const writes = installStoredJob(job);
        await renewExistingJob(job.id, job.originalPostedAt, null, ownListingOf(job), RENEWAL_NOW);

        expect(writes).toHaveLength(1);
        expect(writes[0].updatedAt).toEqual(RENEWAL_NOW);
        expect('contentChangedAt' in writes[0]).toBe(false);
    });

    it('a renewal that improves a rendered field stamps contentChangedAt', async () => {
        const job = storedJob();
        const writes = installStoredJob(job);
        const longer = 'A much longer description of the role, the team, the schedule and the pay. '.repeat(5);
        await renewExistingJob(job.id, job.originalPostedAt, { description: longer }, ownListingOf(job), RENEWAL_NOW);

        expect(writes[0]).toMatchObject({ description: longer, contentChangedAt: RENEWAL_NOW, updatedAt: RENEWAL_NOW });
    });

    it('a job coming back from unpublished stamps contentChangedAt', async () => {
        const job = storedJob({ isPublished: false, healthConsecutiveMissing: 3 });
        const writes = installStoredJob(job, SWEPT_BY_PRESENCE);
        await renewExistingJob(job.id, job.originalPostedAt, null, ownListingOf(job), RENEWAL_NOW);

        expect(writes[0]).toMatchObject({ isPublished: true, contentChangedAt: RENEWAL_NOW, updatedAt: RENEWAL_NOW });
    });
});

describe('enrich-jobs publishes no guesses', () => {
    const src = read('app/api/cron/enrich-jobs/route.ts');

    it('does not mark a job remote because its location is missing', () => {
        expect(src).not.toMatch(/!fin\('city'\) && !fin\('state'\) && !fin\('isRemote'\) && !fin\('isHybrid'\)/);
    });

    it('does not default mode, job type or state', () => {
        expect(src).not.toMatch(/updateData\.mode = 'In-Person'/);
        expect(src).not.toMatch(/updateData\.jobType = 'Full-Time'/);
        expect(src).not.toMatch(/updateData\.jobType = 'Contract'/);
        expect(src).not.toMatch(/updateData\.state = 'United States'/);
    });

    it('derives the flags from an LLM mode as a pair', () => {
        expect(src).toContain("updateData.isRemote = canon === 'Remote';");
        expect(src).toContain("updateData.isHybrid = canon === 'Hybrid';");
    });

    it('only accepts a real US state from the LLM', () => {
        expect(src).toMatch(/extracted\.state && extractedStateCode && !job\.state/);
    });

    it('stamps contentChangedAt only through contentChangeStamp', () => {
        expect(src).toContain('Object.assign(updateData, contentChangeStamp(job, updateData));');
    });
});

describe('enrich-thin-jds never expands a stub', () => {
    const src = read('app/api/cron/enrich-thin-jds/route.ts');

    it('checks for a stub before calling the model', () => {
        const stubCheck = src.indexOf('analyzeDescriptionStub(job.description, job.title).isStub');
        const modelCall = src.indexOf('await complete<string>(');
        expect(stubCheck).toBeGreaterThan(-1);
        expect(stubCheck).toBeLessThan(modelCall);
    });

    it('stamps contentChangedAt with the rewrite', () => {
        expect(src).toContain('...contentChangeStamp({ description: job.description }, { description: aiResponse.content }),');
    });
});

describe('description-cleaner stamps only real rewrites', () => {
    it('routes both writes through contentChangeStamp', () => {
        const src = read('lib/description-cleaner.ts');
        expect(src).toContain('...contentChangeStamp(job, summaryUpdate)');
        expect(src).toContain('...contentChangeStamp(job, textUpdate)');
    });
});

describe('parseJobLocation stamps only a changed location', () => {
    beforeEach(() => {
        vi.mocked(prisma.job.update).mockReset();
        vi.mocked(prisma.job.update).mockResolvedValue({} as never);
    });

    it('stamps when the re-parse changes the stored city (the Sol "1730" row)', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValueOnce({
            id: 'j1', location: '1730 Rhode Island Ave NW, Washington, DC, 20036',
            city: '1730', state: 'Rhode Island', stateCode: 'RI', country: 'US', isRemote: false, isHybrid: false,
        } as never);
        await parseJobLocation('j1');
        const data = vi.mocked(prisma.job.update).mock.calls[0][0].data as Record<string, unknown>;
        expect(data).toMatchObject({ city: 'Washington', stateCode: 'DC' });
        expect(data.contentChangedAt).toBeInstanceOf(Date);
    });

    it('does not stamp when nothing changes', async () => {
        vi.mocked(prisma.job.findUnique).mockResolvedValueOnce({
            id: 'j2', location: 'Austin, TX',
            city: 'Austin', state: 'Texas', stateCode: 'TX', country: 'US', isRemote: false, isHybrid: false,
        } as never);
        await parseJobLocation('j2');
        const data = vi.mocked(prisma.job.update).mock.calls[0][0].data as Record<string, unknown>;
        expect(data).not.toHaveProperty('contentChangedAt');
    });
});

// fixSoon 5: the column has no default, so every writer that creates a job or
// makes it public must set contentChangedAt; a NULL hides "Last updated" on
// the job page and leaves the sitemap without an honest lastmod.
describe('employer, admin and payment writers stamp contentChangedAt', () => {
    /** The source from `anchor` up to the end of its data object. */
    const block = (rel: string, anchor: string, length = 2400): string => {
        const src = read(rel);
        const start = src.indexOf(anchor);
        expect(start, `${rel}: ${anchor}`).toBeGreaterThan(-1);
        return src.slice(start, start + length);
    };

    it('the free employer post sets it on create', () => {
        const create = block('app/api/jobs/post-free/route.ts', 'const created = await tx.job.create({');
        expect(create.slice(0, create.indexOf('\n        });'))).toContain('contentChangedAt: now,');
    });

    it('the paid checkout sets it on create', () => {
        const create = block('app/api/create-checkout/route.ts', 'const created = await tx.job.create({');
        expect(create.slice(0, create.indexOf('\n      });'))).toContain('contentChangedAt: new Date(),');
    });

    it('the admin create sets it', () => {
        const create = block('app/api/admin/jobs/route.ts', 'const job = await prisma.job.create({');
        expect(create.slice(0, create.indexOf('\n        });'))).toContain('contentChangedAt: new Date(),');
    });

    it('the first publish of a paid job stamps it', () => {
        const src = read('app/api/webhooks/stripe/activate-paid-job.ts');
        expect(src).toContain('data: { isPublished: true, isVerifiedEmployer: true, contentChangedAt: new Date() },');
    });

    it('a chargeback-won re-publish stamps it', () => {
        const src = read('app/api/webhooks/stripe/route.ts');
        expect(src).toContain('data: { isPublished: true, contentChangedAt: new Date() } });');
        expect(src).not.toContain('data: { isPublished: true } });');
    });

    it('a paid renewal stamps it with the new expiry', () => {
        const update = block('app/api/webhooks/stripe/apply-renewal.ts', 'await tx.job.update({', 900);
        expect(update).toContain('expiresAt: newExpiresAt,');
        expect(update).toContain('contentChangedAt: new Date(),');
    });
});

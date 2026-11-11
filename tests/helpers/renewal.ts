/**
 * A stored job behind the mocked Prisma client, for tests that run the ingest
 * renewal (renewExistingJob in lib/ingestion-service.ts) instead of reading
 * its source.
 *
 * The renewal reads one job row, reads the newest health row of a job that is
 * down, and writes at most one update. `installStoredJob` answers the two
 * reads from the fixture and records the write.
 *
 * All fixtures are fictional.
 */
import { vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import type { RenewalListing } from '@/lib/ingestion-service';

export const RENEWAL_NOW = new Date('2026-11-11T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
export const daysFromNow = (days: number): Date => new Date(RENEWAL_NOW.getTime() + days * DAY_MS);

export type StoredJob = Record<string, unknown> & {
    id: string;
    isPublished: boolean;
    originalPostedAt: Date;
    sourceProvider: string | null;
    externalId: string | null;
    applyLink: string | null;
    title: string;
    employer: string;
    location: string;
};

/** A published relisted job with every column the renewal reads. */
export function storedJob(over: Record<string, unknown> = {}): StoredJob {
    return {
        id: 'job-1',
        title: 'Family Nurse Practitioner',
        employer: 'Example Family Health',
        location: 'Austin, TX',
        sourceType: 'external',
        sourceProvider: 'adzuna',
        externalId: 'adzuna_1',
        applyLink: 'https://relister.example/land/ad/1',
        isPublished: true,
        isManuallyUnpublished: false,
        healthConsecutiveMissing: 0,
        originalPostedAt: daysFromNow(-5),
        expiresAt: daysFromNow(55),
        description: 'A short description.',
        descriptionSummary: null,
        minSalary: null,
        maxSalary: null,
        salaryPeriod: null,
        salaryRange: null,
        displaySalary: null,
        normalizedMinSalary: null,
        normalizedMaxSalary: null,
        city: 'Austin',
        state: 'Texas',
        stateCode: 'TX',
        jobType: null,
        mode: null,
        experienceLevel: null,
        setting: null,
        population: null,
        benefits: [],
        isRemote: false,
        isHybrid: false,
        newGradFriendly: false,
        minYearsExperience: null,
        categoryTags: [],
        ...over,
    } as StoredJob;
}

/** The newest health row of a job: what the renewal reads to tell what took a job down. */
export interface NewestHealthRow {
    checkType: string;
    alive: boolean;
}
export const SWEPT_BY_PRESENCE: NewestHealthRow = { checkType: 'source_presence', alive: false };

/**
 * Put one job behind the mocked client. Returns the writes the renewal makes,
 * in order; each is also applied to the fixture.
 */
export function installStoredJob(job: StoredJob, newestHealthRow: NewestHealthRow | null = null): Array<Record<string, unknown>> {
    const writes: Array<Record<string, unknown>> = [];
    vi.mocked(prisma.job.findUnique).mockImplementation((async (args: { where: { id: string }; select?: Record<string, unknown> }) => {
        if (args.where.id !== job.id) return null;
        if (!args.select) return { ...job };
        return Object.fromEntries(Object.keys(args.select).map((key) => [key, job[key] ?? null]));
    }) as never);
    vi.mocked(prisma.job.update).mockImplementation((async (args: { data: Record<string, unknown> }) => {
        writes.push(args.data);
        Object.assign(job, args.data);
        return {};
    }) as never);
    vi.mocked(prisma.jobHealthCheck.findFirst).mockResolvedValue(newestHealthRow as never);
    return writes;
}

/** The job's own posting, as its source lists it again. */
export function ownListingOf(job: StoredJob): RenewalListing {
    return {
        source: String(job.sourceProvider),
        externalId: job.externalId,
        applyLink: job.applyLink,
        sourceSite: null,
        title: job.title,
        employer: job.employer,
        location: job.location,
        listedThisRun: new Set(job.externalId ? [job.externalId] : []),
    };
}

/** The same job under another id of the same source, the stored id gone from the fetch. */
export function lookAlikeOf(job: StoredJob, over: Partial<RenewalListing> = {}): RenewalListing {
    return {
        ...ownListingOf(job),
        externalId: 'adzuna_2',
        applyLink: 'https://relister.example/land/ad/2',
        listedThisRun: new Set(['adzuna_2']),
        ...over,
    };
}

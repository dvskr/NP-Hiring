/**
 * The applicants view offers a Message button for the job an applicant
 * applied to only while that job is one of the employer's active postings,
 * the rule POST /api/employer/messages applies to a new thread
 * (lib/active-posting.ts). It used to follow job.isFeatured, which a new
 * post here never is, so most employers saw no Message button at all (owner,
 * 2026-11-25). GET /api/employer/applicants now sends job.isActive.
 *
 * Every fixture is fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const h = vi.hoisted(() => ({ getUser: vi.fn(), applications: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/resume-storage', () => ({
    mintResumeReadUrl: vi.fn(async () => null),
    extractRequestContext: vi.fn(() => ({ ip: null, userAgent: null })),
}));

import { GET as listApplicants } from '@/app/api/employer/applicants/route';

// The global prisma fake has no jobApplication model; the route reads it.
Object.assign(prisma, { jobApplication: { findMany: h.applications } });

const EMPLOYER = { id: 'supabase-employer-fic', email: 'hiring@clinic.example', email_confirmed_at: '2026-10-01T00:00:00Z' };
const DAY = 24 * 60 * 60 * 1000;

const JOBS = {
    live: { id: 'job-live', title: 'Family NP', isPublished: true, expiresAt: new Date(Date.now() + 20 * DAY) },
    openEnded: { id: 'job-open-ended', title: 'Acute Care NP', isPublished: true, expiresAt: null },
    ended: { id: 'job-ended', title: 'Pediatric NP', isPublished: true, expiresAt: new Date(Date.now() - DAY) },
    unpublished: { id: 'job-unpublished', title: 'Adult Gerontology NP', isPublished: false, expiresAt: new Date(Date.now() + 20 * DAY) },
};

function application(job: (typeof JOBS)[keyof typeof JOBS]) {
    return {
        id: `app-${job.id}`, status: 'applied', notes: null, coverLetter: null, coverLetterUrl: null, resumeUrl: null,
        appliedAt: new Date('2026-11-20T00:00:00Z'), statusUpdatedAt: null, aiMatchScore: null, aiMatchReasons: [],
        aiMissingItems: [], screeningAnswers: null,
        user: {
            supabaseId: 'supabase-applicant-fic', firstName: 'Ada', lastName: 'Okafic', email: 'ada@example.com', avatarUrl: null,
            headline: null, yearsExperience: 3, certifications: null, licenseStates: null, specialties: null, bio: null, skills: [],
            education: [], workExperience: [], certificationRecords: [], licenses: [],
        },
        job,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.getUser.mockResolvedValue({ data: { user: EMPLOYER }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'employer' } as never);
    vi.mocked(prisma.employerJob.findMany).mockResolvedValue(
        Object.values(JOBS).map((job) => ({ jobId: job.id, job: { id: job.id, title: job.title } })) as never,
    );
    h.applications.mockResolvedValue(Object.values(JOBS).map(application));
});

describe('GET /api/employer/applicants: the Message button follows the posting rule', () => {
    it('marks a job active while it is published and has not ended, featured or not', async () => {
        const body = await (await listApplicants(new NextRequest('http://localhost:3000/api/employer/applicants'))).json();

        expect(Object.fromEntries(body.applicants.map((a: { job: { id: string; isActive: boolean } }) => [a.job.id, a.job.isActive]))).toEqual({
            'job-live': true,
            'job-open-ended': true,
            'job-ended': false,
            'job-unpublished': false,
        });
        expect(body.applicants[0].job).not.toHaveProperty('isFeatured');
    });

    it('reads the publish state and end date, not the featured flag', async () => {
        await listApplicants(new NextRequest('http://localhost:3000/api/employer/applicants'));

        expect(h.applications.mock.calls[0][0].include.job.select).toEqual({
            id: true, title: true, isPublished: true, expiresAt: true,
        });
    });
});

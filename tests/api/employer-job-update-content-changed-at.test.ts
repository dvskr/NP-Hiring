/**
 * Employer edit (POST /api/jobs/update) and Job.contentChangedAt (indexing
 * audit fixSoon 5): a real edit moves it, re-saving the same form does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';

vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { general: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/sanitize', () => ({
    sanitizeJobPosting: vi.fn().mockImplementation((d: Record<string, unknown>) => d),
    sanitizeUrl: vi.fn().mockImplementation((u: string) => u),
    sanitizeEmail: vi.fn().mockImplementation((e: string) => e),
    sanitizeText: vi.fn().mockImplementation((t: string) => t),
    normalizeContentWhitespace: vi.fn().mockImplementation((s: string) => s),
}));
vi.mock('@/lib/description-cleaner', () => ({ summarizeForMeta: vi.fn().mockReturnValue('summary') }));

const FORM = {
    title: 'PMHNP Outpatient',
    location: 'Austin, TX',
    mode: 'In-Person',
    jobType: 'Full-Time',
    description: '<p>Outpatient psychiatric care for adults.</p>',
    applyLink: 'https://example.com/apply',
};

/** The row as the same form saved it last time (what the route would write). */
const STORED = {
    mode: 'In-Person',
    setting: null,
    population: null,
    title: FORM.title,
    location: FORM.location,
    jobType: FORM.jobType,
    description: FORM.description,
    descriptionSummary: 'summary',
    applyLink: FORM.applyLink,
    applyOnPlatform: false,
    minSalary: null,
    maxSalary: null,
    salaryPeriod: null,
    normalizedMinSalary: null,
    normalizedMaxSalary: null,
    salaryIsEstimated: false,
    displaySalary: null,
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    isRemote: false,
    isHybrid: false,
    benefits: [],
};

function request(overrides: Record<string, unknown> = {}): NextRequest {
    return new NextRequest('http://localhost:3000/api/jobs/update', {
        method: 'POST',
        body: JSON.stringify({ token: 'valid-token', jobData: { ...FORM, ...overrides } }),
    });
}

function writtenData(): Record<string, unknown> {
    return vi.mocked(prisma.job.update).mock.calls[0][0].data as Record<string, unknown>;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
        id: 'ej-1', jobId: 'job-1', contactEmail: 'employer@example.com',
        companyWebsite: null, companyLogoUrl: null, editToken: 'valid-token',
    } as never);
    vi.mocked(prisma.job.findUnique).mockResolvedValue(STORED as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1' } as never);
});

describe('employer edit and contentChangedAt', () => {
    it('stamps a changed title', async () => {
        const { POST } = await import('@/app/api/jobs/update/route');
        expect((await POST(request({ title: 'PMHNP Outpatient (Evenings)' }))).status).toBe(200);
        expect(writtenData().contentChangedAt).toBeInstanceOf(Date);
    });

    it('does not stamp a re-save of the unchanged form', async () => {
        const { POST } = await import('@/app/api/jobs/update/route');
        expect((await POST(request())).status).toBe(200);
        expect(writtenData()).not.toHaveProperty('contentChangedAt');
        // updatedAt is still the plain write timestamp.
        expect(writtenData().updatedAt).toBeInstanceOf(Date);
    });
});

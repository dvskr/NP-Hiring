/**
 * Edit-token routes accept only a string token (Prisma operator injection).
 *
 * POST /api/jobs/update and POST /api/create-renewal-checkout read the edit
 * token from the JSON body and look the post up with
 * employerJob.findFirst({ where: { editToken } }). A JSON body can carry an
 * object there, and Prisma reads an object in a non-unique where clause as a
 * filter: { "not": "" } matched every post, so anyone could rewrite any
 * employer's posting (title, description, apply link, contact email), and
 * the different answers for a matching and a non-matching filter let an edit
 * token be guessed one character at a time. Both routes now refuse a body
 * whose token or job id is not a plain string with 400, before any query.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { general: { limit: 30, windowSeconds: 60 }, postJob: { limit: 100, windowMs: 60_000 } },
}));
vi.mock('@/lib/env', () => ({
    isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting'),
    getPaidPostingStatus: vi.fn(() => ({ enabled: true, stripeConfigured: true, available: true })),
    getEnv: vi.fn(() => ({ STRIPE_WEBHOOK_SECRET: 'whsec_x' })),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));
const sessionsCreate = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        checkout: { sessions: { create: sessionsCreate, list: vi.fn(), expire: vi.fn() } },
    })),
}));

const VALID_TOKEN = 'a'.repeat(64);
const JOB_DATA = {
    title: 'PMHNP Outpatient',
    location: 'Austin, TX',
    mode: 'In-Person',
    jobType: 'Full-Time',
    description: '<p>Outpatient psychiatric care for adults.</p>',
    applyLink: 'https://example.com/apply',
};

function post(url: string, body: string): NextRequest {
    return new NextRequest(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
}

const BAD_TOKENS: Array<[string, unknown]> = [
    ['a not filter', { not: '' }],
    ['a startsWith filter', { startsWith: 'a' }],
    ['a gt filter', { gt: '' }],
    ['an array', [VALID_TOKEN]],
    ['a number', 12345],
    ['an empty string', ''],
    ['an overlong string', 'a'.repeat(201)],
];

beforeAll(async () => {
    await import('@/app/api/jobs/update/route');
    await import('@/app/api/create-renewal-checkout/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
});

describe('POST /api/jobs/update', () => {
    it.each(BAD_TOKENS)('refuses %s as the token with 400 and no query', async (_label, token) => {
        const { POST } = await import('@/app/api/jobs/update/route');
        const res = await POST(post('http://localhost:3000/api/jobs/update', JSON.stringify({ token, jobData: JOB_DATA })));
        expect(res.status).toBe(400);
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
    });

    it.each([
        ['malformed JSON', '{"token":'],
        ['a null body', 'null'],
        ['an array body', JSON.stringify([{ token: VALID_TOKEN, jobData: JOB_DATA }])],
        ['no job data', JSON.stringify({ token: VALID_TOKEN })],
        ['job data that is not an object', JSON.stringify({ token: VALID_TOKEN, jobData: 'title' })],
        ['job data that is an array', JSON.stringify({ token: VALID_TOKEN, jobData: [JOB_DATA] })],
    ])('refuses %s with 400 and no query', async (_label, body) => {
        const { POST } = await import('@/app/api/jobs/update/route');
        const res = await POST(post('http://localhost:3000/api/jobs/update', body));
        expect(res.status).toBe(400);
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('still looks a string token up by equality', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null);
        const { POST } = await import('@/app/api/jobs/update/route');
        const res = await POST(post('http://localhost:3000/api/jobs/update', JSON.stringify({ token: VALID_TOKEN, jobData: JOB_DATA })));
        expect(res.status).toBe(401);
        expect(prisma.employerJob.findFirst).toHaveBeenCalledWith({ where: { editToken: VALID_TOKEN } });
    });
});

describe('POST /api/create-renewal-checkout', () => {
    it.each(BAD_TOKENS)('refuses %s as the edit token with 400 and no query', async (_label, editToken) => {
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(post('https://test.local/api/create-renewal-checkout', JSON.stringify({ jobId: 'job-1', editToken })));
        expect(res.status).toBe(400);
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
        expect(sessionsCreate).not.toHaveBeenCalled();
    });

    it.each(BAD_TOKENS)('refuses %s as the job id with 400 and no query', async (_label, jobId) => {
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(post('https://test.local/api/create-renewal-checkout', JSON.stringify({ jobId, editToken: VALID_TOKEN })));
        expect(res.status).toBe(400);
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
    });

    it.each([
        ['malformed JSON', '{"jobId":'],
        ['a null body', 'null'],
        ['an array body', JSON.stringify([{ jobId: 'job-1', editToken: VALID_TOKEN }])],
    ])('refuses %s with 400 and no query', async (_label, body) => {
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(post('https://test.local/api/create-renewal-checkout', body));
        expect(res.status).toBe(400);
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
    });

    it('still looks a string job id and token up by equality', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null);
        const { POST } = await import('@/app/api/create-renewal-checkout/route');
        const res = await POST(post('https://test.local/api/create-renewal-checkout', JSON.stringify({ jobId: 'job-1', editToken: VALID_TOKEN })));
        expect(res.status).toBe(404);
        expect(prisma.employerJob.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { jobId: 'job-1', editToken: VALID_TOKEN } }),
        );
    });
});

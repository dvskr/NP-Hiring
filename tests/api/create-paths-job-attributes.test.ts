/**
 * The two routes that create an employer post check its attributes alike
 * (register 2.29).
 *
 *   - POST /api/create-checkout (a paid post) stored benefits, setting and
 *     population without the validators POST /api/jobs/post-free runs
 *     (app/api/jobs/post-free/_lib/job-attributes.ts): any array went into
 *     benefits, any value into setting and population. It now runs the same
 *     validators and answers the same 400 for the same input, before any row
 *     or Stripe session exists.
 *   - Both stored companyLogoUrl as sent. It now goes through sanitizeUrl
 *     (lib/sanitize.ts), as POST /api/jobs/update stored it, in one helper
 *     the edit uses too (sanitizeLogoUrl): an address sanitizeUrl refuses, an
 *     address holding a control character, a space or a backslash anywhere
 *     (browsers read "/\host" and "/<tab>/host" as "//host"), one longer than
 *     2048 characters, a value that is not text or a blank stores no logo. The
 *     edit answered 500 for a logo that was not text.
 *   - The paid checkout reads its body through lib/request-body.ts: a body
 *     that is not a JSON object is a 400 before the session is read, where
 *     malformed JSON and null used to answer 500.
 *
 * Nothing here mocks lib/sanitize.ts: the real sanitizer is under test.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { EMPLOYER_POPULATION_TAGS, EMPLOYER_SETTING_TAGS } from '@/lib/pseo/category-tagger';

const sessionsCreate = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        checkout: { sessions: { create: sessionsCreate, retrieve: vi.fn(), expire: vi.fn() } },
    })),
}));
vi.mock('@/lib/env', () => ({
    isFeatureEnabled: vi.fn((feature: string) => feature === 'paidPosting'),
    getPaidPostingStatus: vi.fn(() => ({ enabled: true, stripeConfigured: true, available: true })),
    getEnv: vi.fn(() => ({ STRIPE_WEBHOOK_SECRET: 'whsec_x' })),
    getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));
const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));

const SIGNUP_EMAIL = 'owner@clinic.example';

/** The fields both routes require, under the names both use. */
const COMMON = {
    title: 'Family Nurse Practitioner',
    location: 'Austin, TX',
    mode: 'In-Person',
    jobType: 'Full-Time',
    description: '<p>' + 'Outpatient primary care for adults and families. '.repeat(6) + '</p>',
    contactEmail: 'hiring@clinic.example',
};
const checkoutBody = (extra: Record<string, unknown> = {}) => ({ ...COMMON, companyName: 'Clinic Co', applyUrl: 'https://clinic.example/apply', ...extra });
const freeBody = (extra: Record<string, unknown> = {}) => ({ ...COMMON, employer: 'Clinic Co', applyLink: 'https://clinic.example/apply', ...extra });

function request(url: string, body: unknown): NextRequest {
    return new NextRequest(url, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });
}

async function checkout(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const { POST } = await import('@/app/api/create-checkout/route');
    const res = await POST(request('https://test.local/api/create-checkout', body));
    return { status: res.status, json: await res.json() };
}

async function postFree(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const { POST } = await import('@/app/api/jobs/post-free/route');
    const res = await POST(request('https://test.local/api/jobs/post-free', body));
    return { status: res.status, json: await res.json() };
}

async function edit(jobData: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
    const { POST } = await import('@/app/api/jobs/update/route');
    const res = await POST(request('https://test.local/api/jobs/update', { token: 'a'.repeat(64), jobData }));
    return { status: res.status, json: await res.json() };
}

/** The data each route wrote for the post and its employer row. */
const jobData = () => vi.mocked(prisma.job.create).mock.calls[0][0].data as Record<string, unknown>;
const employerJobData = () => vi.mocked(prisma.employerJob.create).mock.calls[0][0].data as Record<string, unknown>;

function expectNothingWritten(): void {
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(prisma.employerJob.create).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
}

beforeAll(async () => {
    await import('@/app/api/create-checkout/route');
    await import('@/app/api/jobs/post-free/route');
    await import('@/app/api/jobs/update/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: SIGNUP_EMAIL, email_confirmed_at: '2026-10-01T00:00:00Z' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ supabaseId: 'user-1', role: 'employer', email: SIGNUP_EMAIL } as never);
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
    vi.mocked(prisma.job.create).mockResolvedValue({ id: 'job-1' } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', slug: 'family-nurse-practitioner-job-1' } as never);
    vi.mocked(prisma.employerJob.create).mockResolvedValue({ id: 'ej-1', dashboardToken: 'dash-1' } as never);
    vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.jobDraft.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.employerPostPack.count).mockResolvedValue(0 as never);
    sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    // The paid funnel opens only once the launch promo is over; the free post
    // cases switch the promo back on.
    vi.spyOn(config, 'isPromoActive').mockReturnValue(false);
});

afterEach(() => {
    vi.mocked(config.isPromoActive).mockRestore();
});

const SETTING = Object.keys(EMPLOYER_SETTING_TAGS)[0];
const POPULATION = Object.keys(EMPLOYER_POPULATION_TAGS)[0];

const BAD_ATTRIBUTES: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['benefits sent as one string', { benefits: 'PTO' }],
    ['benefits holding a number', { benefits: ['PTO', 42] }],
    ['benefits holding an object', { benefits: [{ not: '' }] }],
    ['more than 20 benefits', { benefits: Array.from({ length: 21 }, (_, i) => `Benefit ${i}`) }],
    ['a benefit over 100 characters', { benefits: ['x'.repeat(101)] }],
    ['a setting off the list', { setting: 'Moon base' }],
    ['a setting that is a Prisma filter', { setting: { not: '' } }],
    ['a population off the list', { population: 'Everyone' }],
    ['a population that is a number', { population: 7 }],
];

describe('the paid checkout checks benefits, setting and population as the free post does', () => {
    it.each(BAD_ATTRIBUTES)('%s: the free post\'s 400, before any row or Stripe session', async (_label, extra) => {
        const free = await postFree(freeBody(extra));
        const paid = await checkout(checkoutBody(extra));

        expect(free.status).toBe(400);
        expect(paid.status).toBe(400);
        expect(paid.json).toEqual(free.json);
        expectNothingWritten();
    });

    it('stores the values the validators return: benefits cleaned and deduplicated, listed setting and population', async () => {
        const res = await checkout(checkoutBody({ benefits: [' PTO ', 'PTO', '<b>CME allowance</b>'], setting: SETTING, population: POPULATION }));

        expect(res.status).toBe(200);
        expect(jobData()).toMatchObject({ benefits: ['PTO', 'CME allowance'], setting: SETTING, population: POPULATION });
    });

    it('stores no benefits, setting or population when none is sent, as before', async () => {
        const res = await checkout(checkoutBody({ setting: '', population: null }));

        expect(res.status).toBe(200);
        expect(jobData()).toMatchObject({ benefits: [], setting: null, population: null });
    });

    it.each([
        ['malformed JSON', '{"title":'],
        ['null', 'null'],
        ['an array', JSON.stringify([checkoutBody()])],
        ['a bare string', JSON.stringify('Family Nurse Practitioner')],
    ])('refuses %s as the body with 400, before the session is read', async (_label, body) => {
        const res = await checkout(body);

        expect(res.status).toBe(400);
        expect(res.json).toEqual({ error: 'Request body must be a JSON object' });
        expect(getUserMock).not.toHaveBeenCalled();
        expectNothingWritten();
    });
});

const LOGOS: ReadonlyArray<[string, unknown, string | null]> = [
    ['an https address', 'https://cdn.example/logos/clinic.png', 'https://cdn.example/logos/clinic.png'],
    ['an address with spaces around it', '  https://cdn.example/logos/clinic.png ', 'https://cdn.example/logos/clinic.png'],
    ['a site path', '/uploads/logos/clinic.png', '/uploads/logos/clinic.png'],
    ['a javascript: address', 'javascript:alert(1)', null],
    ['a data: html address', 'data:text/html,<script>alert(1)</script>', null],
    ['a protocol relative address', '//evil.example/logo.png', null],
    ['a backslash path browsers read as protocol relative', '/\\evil.example/logo.png', null],
    // Browsers drop a tab or a newline anywhere in a URL, so each of these
    // resolves to https://evil.example (security review LOW-2, 2026-10-27).
    ['a tab between the slashes', '/\t/evil.example/logo.png', null],
    ['a newline between the slashes', '/\n/evil.example/logo.png', null],
    ['a carriage return between the slashes', '/\r/evil.example/logo.png', null],
    ['a header line after an https address', 'https://cdn.example/logo.png\r\nX-Evil: 1', null],
    ['a space inside an address', 'https://cdn.example/logo.png onerror=alert(1)', null],
    ['a backslash inside an https address', 'https://cdn.example\\logo.png', null],
    ['an address longer than 2048 characters', `https://cdn.example/${'a'.repeat(2048)}.png`, null],
    ['an ftp address', 'ftp://files.example/logo.png', null],
    ['an object', { not: '' }, null],
    ['a blank', '', null],
    ['nothing', undefined, null],
];

describe('both create paths store the logo address through sanitizeUrl', () => {
    it.each(LOGOS)('the paid checkout, %s', async (_label, logo, stored) => {
        const res = await checkout(checkoutBody({ companyLogoUrl: logo }));

        expect(res.status).toBe(200);
        expect(employerJobData().companyLogoUrl).toBe(stored);
    });

    it.each(LOGOS)('the free post, %s', async (_label, logo, stored) => {
        vi.mocked(config.isPromoActive).mockReturnValue(true);

        const res = await postFree(freeBody({ companyLogoUrl: logo }));

        expect(res.status).toBe(200);
        expect(employerJobData().companyLogoUrl).toBe(stored);
    });

    // An edit that sends no logo leaves the stored one alone, so "nothing" is not an edit case.
    it.each(LOGOS.filter(([, logo]) => logo !== undefined))('the edit, %s', async (_label, logo, stored) => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
            id: 'ej-1', jobId: 'job-1', contactEmail: COMMON.contactEmail, companyWebsite: null, companyLogoUrl: 'https://cdn.example/old.png',
            editToken: 'a'.repeat(64), job: { isPublished: true, expiresAt: new Date(Date.now() + 86_400_000) },
        } as never);
        vi.mocked(prisma.job.findUnique).mockResolvedValue({ mode: 'In-Person', setting: null, population: null } as never);
        vi.mocked(prisma.employerJob.update).mockResolvedValue({} as never);

        const res = await edit({
            title: COMMON.title, location: COMMON.location, mode: COMMON.mode, jobType: COMMON.jobType,
            description: COMMON.description, applyLink: 'https://clinic.example/apply', companyLogoUrl: logo,
        });

        expect(res.status).toBe(200);
        expect(vi.mocked(prisma.employerJob.update).mock.calls[0][0].data).toMatchObject({ companyLogoUrl: stored });
    });
});

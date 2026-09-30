/**
 * JOB-PAGE handoff 10 (employer half): an employer job page reaches Google's
 * Indexing API only when the page carries a JobPosting.
 *
 * The free post route, the paid activation and the renewal webhook used to
 * call pingAllSearchEngines, whose Google leg ('new-content' lane) checks only
 * that the URL is a job page. A job whose page emits no JobPosting (no US
 * place and no verified remote declaration, or a stub description; the rule
 * is isJobPostingEligible in app/jobs/[slug]/job-posting-facts.ts) must go to
 * Bing and IndexNow only. lib/job-page-indexing.ts holds that one rule.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const pingAllSearchEngines = vi.fn();
const pingBing = vi.fn();
const pingIndexNow = vi.fn();
vi.mock('@/lib/search-indexing', () => ({
    pingAllSearchEngines: (...args: unknown[]) => pingAllSearchEngines(...args),
    pingBing: (...args: unknown[]) => pingBing(...args),
    pingIndexNow: (...args: unknown[]) => pingIndexNow(...args),
}));

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { postJob: { limit: 100, windowMs: 60_000 } },
}));
vi.mock('@/lib/sanitize', () => ({
    sanitizeJobPosting: vi.fn().mockImplementation((d: Record<string, unknown>) => d),
    sanitizeUrl: vi.fn().mockImplementation((u: string) => u),
    sanitizeEmail: vi.fn().mockImplementation((e: string) => e),
    sanitizeText: vi.fn().mockImplementation((t: string) => t),
    normalizeContentWhitespace: vi.fn().mockImplementation((s: string) => s),
}));
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
const planSlotMock = vi.fn();
vi.mock('@/lib/employer-plan', () => ({ getPlanSlotStatus: planSlotMock }));

import { JOB_POSTING_ELIGIBILITY_SELECT, pingSearchEnginesForJobPage } from '@/lib/job-page-indexing';
import type { JobPostingFactsInput } from '@/app/jobs/[slug]/job-posting-facts';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PROSE =
    'We are hiring a nurse practitioner to see adult patients in a busy outpatient clinic. You will assess, ' +
    'diagnose and treat, order and read tests, prescribe, and coordinate care with physicians and therapists. ' +
    'The role offers a full panel, protected documentation time and a collaborative team. An active license ' +
    'and national certification are required; two years of experience are preferred.';

const ELIGIBLE: JobPostingFactsInput = {
    title: 'Nurse Practitioner',
    employer: 'Acme Health',
    description: PROSE,
    location: 'Austin, TX',
    mode: 'In-Person',
    isRemote: false,
    isHybrid: false,
    city: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    country: 'US',
};

/** No US place, no verified remote declaration: the page emits no JobPosting. */
const NO_US_PLACE: JobPostingFactsInput = {
    ...ELIGIBLE,
    location: '2 Locations',
    city: null,
    state: null,
    stateCode: null,
};

const URL_ = 'https://nphiring.com/jobs/nurse-practitioner-job-1';

beforeEach(() => {
    pingAllSearchEngines.mockReset().mockResolvedValue([{ engine: 'Google', url: URL_, success: true }]);
    pingBing.mockReset().mockResolvedValue({ engine: 'Bing', url: URL_, success: true });
    pingIndexNow.mockReset().mockResolvedValue([{ engine: 'IndexNow', url: URL_, success: true }]);
});

describe('pingSearchEnginesForJobPage', () => {
    it('pings every engine, Google included, for a page that carries a JobPosting', async () => {
        const results = await pingSearchEnginesForJobPage(URL_, ELIGIBLE);
        expect(pingAllSearchEngines).toHaveBeenCalledWith(URL_);
        expect(pingBing).not.toHaveBeenCalled();
        expect(pingIndexNow).not.toHaveBeenCalled();
        expect(results).toEqual([{ engine: 'Google', url: URL_, success: true }]);
    });

    it('pings only Bing and IndexNow for a job with no US place', async () => {
        const results = await pingSearchEnginesForJobPage(URL_, NO_US_PLACE);
        expect(pingAllSearchEngines).not.toHaveBeenCalled();
        expect(pingBing).toHaveBeenCalledWith(URL_);
        expect(pingIndexNow).toHaveBeenCalledWith(URL_);
        expect(results.map((r) => r.engine)).toEqual(['Bing', 'IndexNow']);
    });

    it('pings only Bing and IndexNow for a stub description, and for a non-US row', async () => {
        await pingSearchEnginesForJobPage(URL_, { ...ELIGIBLE, description: 'Nurse Practitioner\nEmployer: Acme Health\nLocation: Austin, TX' });
        await pingSearchEnginesForJobPage(URL_, { ...ELIGIBLE, country: 'Canada', location: 'Toronto, ON', city: 'Toronto', state: null, stateCode: null });
        expect(pingAllSearchEngines).not.toHaveBeenCalled();
        expect(pingBing).toHaveBeenCalledTimes(2);
    });

    it('never rejects because one engine failed', async () => {
        pingBing.mockRejectedValueOnce(new Error('bing down'));
        const results = await pingSearchEnginesForJobPage(URL_, NO_US_PLACE);
        expect(results.map((r) => r.engine)).toEqual(['IndexNow']);
    });

    it('selects every column the eligibility rule reads', () => {
        expect(Object.keys(JOB_POSTING_ELIGIBILITY_SELECT).sort()).toEqual(Object.keys(ELIGIBLE).sort());
    });
});

describe('POST /api/jobs/post-free sends Google only an eligible job page', () => {
    const DURING_PROMO = new Date('2026-10-01T12:00:00.000Z');
    const BODY = {
        title: 'Nurse Practitioner',
        employer: 'Clinic Co',
        location: '2 Locations',
        mode: 'In-Person',
        jobType: 'Full-Time',
        description: `<p>${PROSE}</p>`,
        applyLink: 'https://clinic.example/apply',
        contactEmail: 'hiring@clinic.example',
    };
    const savedVercelEnv = process.env.VERCEL_ENV;

    // The route's first import is slow under a loaded parallel run; load it
    // once here with its own budget so no test times out on it.
    beforeAll(async () => {
        await import('@/app/api/jobs/post-free/route');
    }, 60_000);

    async function postJob(row: JobPostingFactsInput): Promise<number> {
        vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1', slug: 'nurse-practitioner-job-1', ...row } as never);
        const { POST } = await import('@/app/api/jobs/post-free/route');
        const res = await POST(new NextRequest('https://test.local/api/jobs/post-free', {
            method: 'POST',
            body: JSON.stringify(BODY),
            headers: { 'content-type': 'application/json' },
        }));
        // The ping is fire and forget; let it settle.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return res.status;
    }

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(DURING_PROMO);
        process.env.VERCEL_ENV = 'production';
        getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'owner@clinic.example' } }, error: null });
        vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ supabaseId: 'user-1', role: 'employer', email: 'owner@clinic.example' } as never);
        planSlotMock.mockResolvedValue({ plan: null, entitled: false, slots: 0, used: 0, remaining: 0, canPost: false });
        vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never);
        vi.mocked(prisma.job.create).mockResolvedValue({ id: 'job-1' } as never);
        vi.mocked(prisma.employerJob.create).mockResolvedValue({ id: 'ej-1' } as never);
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
        vi.mocked(prisma.jobDraft.deleteMany).mockResolvedValue({ count: 0 } as never);
    });

    afterEach(() => {
        vi.useRealTimers();
        if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV;
        else process.env.VERCEL_ENV = savedVercelEnv;
    });

    it('an employer post with no US place goes to Bing and IndexNow, never Google', async () => {
        expect(await postJob(NO_US_PLACE)).toBe(200);
        expect(pingAllSearchEngines).not.toHaveBeenCalled();
        expect(pingBing).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/nurse-practitioner-job-1$/));
        expect(pingIndexNow).toHaveBeenCalledTimes(1);
    });

    it('an eligible employer post still reaches every engine', async () => {
        expect(await postJob(ELIGIBLE)).toBe(200);
        expect(pingAllSearchEngines).toHaveBeenCalledWith(expect.stringMatching(/\/jobs\/nurse-practitioner-job-1$/));
        expect(pingBing).not.toHaveBeenCalled();
    });
});

describe('every employer job ping goes through the eligibility gate', () => {
    const CALLERS = [
        'app/api/jobs/post-free/route.ts',
        'app/api/webhooks/stripe/activate-paid-job.ts',
        'app/api/webhooks/stripe/apply-renewal.ts',
    ];

    it.each(CALLERS)('%s pings through pingSearchEnginesForJobPage, not pingAllSearchEngines', (rel) => {
        const src = read(rel);
        expect(src).toContain("from '@/lib/job-page-indexing'");
        expect(src).toMatch(/pingSearchEnginesForJobPage\(/);
        expect(src).not.toMatch(/\bpingAllSearchEngines\b/);
        expect(src).not.toContain('@/components/JobStructuredData');
    });

    it('the renewal loads the columns the rule reads', () => {
        expect(read('app/api/webhooks/stripe/apply-renewal.ts')).toContain('select: { ...JOB_POSTING_ELIGIBILITY_SELECT, expiresAt: true, createdAt: true, slug: true }');
    });

    it('the gate reads the job page rule, never the structured data component', () => {
        const src = read('lib/job-page-indexing.ts');
        expect(src).toContain("import { isJobPostingEligible, type JobPostingFactsInput } from '@/app/jobs/[slug]/job-posting-facts';");
        expect(src).not.toContain('@/components/JobStructuredData');
    });
});

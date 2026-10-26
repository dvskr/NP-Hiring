/**
 * An edit token works for exactly as long on every route that takes it
 * (register 2.29).
 *
 * GET /api/jobs/edit/[token] (the edit form) honoured the token while the post
 * was published, or until 30 days after its expiresAt, but POST
 * /api/jobs/update (save) and DELETE /api/jobs/update (unpublish) accepted it
 * forever, so a confirmation email that leaked long after the post ended could
 * still rewrite or take down the posting. The rule now lives in one place,
 * lib/edit-token-window.ts, and the three routes give the same answer for the
 * same post: the 401 the edit form always gave.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rate-limit';
import { EDIT_TOKEN_GRACE_MS, EDIT_WINDOW_CLOSED_ERROR, isEditWindowClosed } from '@/lib/edit-token-window';

vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { general: { limit: 60, windowSeconds: 60 }, auth: { limit: 10, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const NOW = new Date('2026-10-27T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = 'a'.repeat(64);
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

/** The answer the edit form has given since the window was added (P5.A, 2026-06-01). */
const CLOSED_ANSWER = { error: 'Edit window has closed for this posting. See your options in your dashboard.' };

interface JobState {
    isPublished: boolean;
    expiresAt: Date | null;
}

/** [label, the post's state, whether the token still works] */
const CASES: ReadonlyArray<[string, JobState, boolean]> = [
    ['a live post', { isPublished: true, expiresAt: at(10 * DAY_MS) }, true],
    ['a live post past its expiry that the sweep has not reached', { isPublished: true, expiresAt: at(-90 * DAY_MS) }, true],
    ['a paused post before its expiry', { isPublished: false, expiresAt: at(10 * DAY_MS) }, true],
    ['an unpublished post 10 days after its expiry', { isPublished: false, expiresAt: at(-10 * DAY_MS) }, true],
    ['an unpublished post exactly 30 days after its expiry', { isPublished: false, expiresAt: at(-30 * DAY_MS) }, true],
    ['an unpublished post 30 days and a minute after its expiry', { isPublished: false, expiresAt: at(-30 * DAY_MS - 60_000) }, false],
    ['an unpublished post a year after its expiry', { isPublished: false, expiresAt: at(-365 * DAY_MS) }, false],
    ['an unpublished post with no expiry', { isPublished: false, expiresAt: null }, false],
];

const JOB_DATA = {
    title: 'Family Nurse Practitioner',
    location: 'Austin, TX',
    mode: 'In-Person',
    jobType: 'Full-Time',
    description: '<p>Outpatient primary care for adults and families.</p>',
    applyLink: 'https://clinic.example/apply',
};

/** One stored row that serves all three routes: the edit form's include, and the job state the window reads. */
function storeRow(state: JobState): void {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
        id: 'ej-1',
        jobId: 'job-1',
        employerName: 'Clinic Co',
        contactEmail: 'owner@clinic.example',
        companyWebsite: null,
        companyLogoUrl: null,
        paymentStatus: 'promo',
        pricingTier: 'pro',
        editToken: TOKEN,
        jobCharges: [],
        job: { id: 'job-1', title: JOB_DATA.title, screeningQuestions: [], ...state },
    } as never);
    vi.mocked(prisma.job.findUnique).mockResolvedValue({
        mode: 'In-Person', setting: null, population: null, title: JOB_DATA.title, location: JOB_DATA.location,
        jobType: JOB_DATA.jobType, description: JOB_DATA.description, applyLink: JOB_DATA.applyLink, benefits: [],
    } as never);
    vi.mocked(prisma.job.update).mockResolvedValue({ id: 'job-1' } as never);
}

async function getForm(): Promise<{ status: number; body: Record<string, unknown> }> {
    const { GET } = await import('@/app/api/jobs/edit/[token]/route');
    const res = await GET(new NextRequest(`https://test.local/api/jobs/edit/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) });
    return { status: res.status, body: await res.json() };
}

async function save(): Promise<{ status: number; body: Record<string, unknown> }> {
    const { POST } = await import('@/app/api/jobs/update/route');
    const res = await POST(new NextRequest('https://test.local/api/jobs/update', {
        method: 'POST',
        body: JSON.stringify({ token: TOKEN, jobData: JOB_DATA }),
        headers: { 'content-type': 'application/json' },
    }));
    return { status: res.status, body: await res.json() };
}

async function unpublish(): Promise<{ status: number; body: Record<string, unknown> }> {
    const { DELETE } = await import('@/app/api/jobs/update/route');
    const res = await DELETE(new NextRequest(`https://test.local/api/jobs/update?token=${TOKEN}`, { method: 'DELETE' }));
    return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
    await import('@/app/api/jobs/edit/[token]/route');
    await import('@/app/api/jobs/update/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('lib/edit-token-window.ts: the rule the edit form applied', () => {
    it('keeps the 30 day grace and the answer the edit form gave', () => {
        expect(EDIT_TOKEN_GRACE_MS).toBe(30 * DAY_MS);
        expect({ error: EDIT_WINDOW_CLOSED_ERROR }).toEqual(CLOSED_ANSWER);
    });

    it.each(CASES)('%s: open is %s', (_label, state, open) => {
        expect(isEditWindowClosed(state, NOW.getTime())).toBe(!open);
    });

    it('reads the clock when no time is passed, and accepts a stored date string', () => {
        expect(isEditWindowClosed({ isPublished: false, expiresAt: at(-31 * DAY_MS).toISOString() })).toBe(true);
        expect(isEditWindowClosed({ isPublished: false, expiresAt: at(-29 * DAY_MS).toISOString() })).toBe(false);
    });

    it('fails closed on an expiry that does not parse, for an unpublished post', () => {
        // Postgres stores no such value; the rule still never reads garbage as "recent".
        expect(isEditWindowClosed({ isPublished: false, expiresAt: 'not a date' }, NOW.getTime())).toBe(true);
        expect(isEditWindowClosed({ isPublished: true, expiresAt: 'not a date' }, NOW.getTime())).toBe(false);
    });
});

describe('the edit form, the save and the unpublish give the same answer', () => {
    it.each(CASES.filter(([, , open]) => !open))('%s: all three refuse with the edit form\'s 401 and nothing is written', async (_label, state) => {
        storeRow(state);

        const answers = [await getForm(), await save(), await unpublish()];

        for (const answer of answers) {
            expect(answer.status).toBe(401);
            expect(answer.body).toEqual(CLOSED_ANSWER);
        }
        expect(prisma.job.findUnique).not.toHaveBeenCalled();
        expect(prisma.job.update).not.toHaveBeenCalled();
        expect(prisma.employerJob.update).not.toHaveBeenCalled();
        expect(prisma.jobScreeningQuestion.deleteMany).not.toHaveBeenCalled();
    });

    it.each(CASES.filter(([, , open]) => open))('%s: all three still work', async (_label, state) => {
        storeRow(state);

        const form = await getForm();
        expect(form.status).toBe(200);
        expect(form.body.job).toMatchObject({ id: 'job-1' });

        const saved = await save();
        expect(saved.status).toBe(200);
        expect(saved.body).toMatchObject({ success: true });

        vi.mocked(prisma.job.update).mockClear();
        const unpublished = await unpublish();
        expect(unpublished.status).toBe(200);
        expect(prisma.job.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'job-1' },
            data: expect.objectContaining({ isPublished: false, isManuallyUnpublished: true }),
        }));
    });

    it('the unpublish is rate limited like the save, before any lookup', async () => {
        vi.mocked(rateLimit).mockResolvedValueOnce(NextResponse.json({ error: 'Too many requests' }, { status: 429 }) as never);

        const answer = await unpublish();

        expect(answer.status).toBe(429);
        expect(rateLimit).toHaveBeenCalledWith(expect.anything(), 'jobs-update', expect.anything());
        expect(prisma.employerJob.findFirst).not.toHaveBeenCalled();
    });

    it('an unknown token is still the invalid token 401 on all three, not the window answer', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);

        for (const answer of [await getForm(), await save(), await unpublish()]) {
            expect(answer.status).toBe(401);
            expect(answer.body).toEqual({ error: 'Invalid or expired edit token' });
        }
        expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('the save and the unpublish load the job state with the token, in the one lookup', async () => {
        storeRow({ isPublished: true, expiresAt: at(DAY_MS) });

        await save();
        await unpublish();

        for (const call of vi.mocked(prisma.employerJob.findFirst).mock.calls) {
            expect(call[0]).toMatchObject({
                where: { editToken: TOKEN },
                include: { job: { select: expect.objectContaining({ isPublished: true, expiresAt: true }) } },
            });
        }
    });
});

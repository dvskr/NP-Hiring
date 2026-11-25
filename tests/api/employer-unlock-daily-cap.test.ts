/**
 * The daily unlock cap counts new unlocks only (owner, 2026-11-25).
 *
 * canUnlockCandidate refuses an employer who unlocked config.dailyUnlockCap
 * candidates in the last 24 hours, counting ProfileView rows by viewedAt.
 * Re-opening a candidate unlocked earlier refreshed viewedAt, so an employer
 * reviewing yesterday's shortlist counted every re-open as a new unlock and
 * was refused the next real one. ProfileView has no createdAt, so viewedAt
 * now stays the first unlock: a re-open writes nothing, and a repeated unlock
 * write leaves the row as it is. Every reader of viewedAt wants that time:
 * this cap, getCandidateUnlocksForPosting and scripts/check-unlock-attribution.ts.
 *
 * The real route and the real cap run over a ProfileView store in memory.
 * Every fixture is fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { rowMatches, type Relations, type Row } from '../helpers/fake-row-where';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    role: { current: 'employer' },
    prisma: {
        userProfile: { findUnique: vi.fn(), findFirst: vi.fn() },
        profileView: { findUnique: vi.fn(), upsert: vi.fn(), count: vi.fn() },
        employerJob: { findFirst: vi.fn(), findMany: vi.fn() },
        jobApplication: { findMany: vi.fn() },
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { employer: { limit: 1000, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/resume-storage', () => ({
    mintResumeReadUrl: vi.fn(async () => null),
    extractRequestContext: vi.fn(() => ({ ip: null, userAgent: null })),
}));

import { GET as openCandidate } from '@/app/api/employer/candidates/[id]/route';
import { canUnlockCandidate } from '@/lib/tier-limits';
import { recordCandidateUnlock } from '@/lib/candidate-unlock';
import { config } from '@/lib/config';

const HOUR = 60 * 60 * 1000;
const DAILY_CAP = config.dailyUnlockCap;
const EMPLOYER = { id: 'supabase-employer-fic', email: 'hiring@clinic.example', email_confirmed_at: '2026-10-01T00:00:00Z' };

/** Enough live postings that only the daily cap can refuse an unlock here. */
const POSTINGS = Math.ceil((DAILY_CAP + 1) / config.limits.candidateUnlocksPerPosting) + 1;

let views: Row[] = [];
let candidates: Row[] = [];
let postings: Row[] = [];

const candidateId = (i: number): string => `supabase-cand-${i}`;

function candidate(i: number): Row {
    return {
        supabaseId: candidateId(i), role: 'job_seeker', profileVisible: true, openToOffers: true, deletedAt: null,
        firstName: 'Anna', lastName: 'Nguyenfic', avatarUrl: null, headline: null, yearsExperience: 4, specialties: null,
        preferredWorkMode: null, certifications: null, licenseStates: null, availableDate: null, desiredSalaryMin: null,
        desiredSalaryMax: null, resumeUrl: null, email: `cand-${i}@example.com`, linkedinUrl: null, bio: null,
        preferredJobType: null, createdAt: new Date('2026-01-15T00:00:00Z'),
    };
}

const relations: Relations = { job: (row) => row.job as Row };

function installStore(): void {
    const p = h.prisma;
    p.userProfile.findUnique.mockImplementation(async () => ({ role: h.role.current }));
    p.userProfile.findFirst.mockImplementation(async ({ where }: { where: Row }) => candidates.find((c) => rowMatches(c, where)) ?? null);
    p.profileView.findUnique.mockImplementation(async ({ where }: { where: { viewerId_candidateId: Row } }) =>
        views.find((v) => rowMatches(v, where.viewerId_candidateId)) ?? null);
    p.profileView.count.mockImplementation(async ({ where }: { where: Row }) => views.filter((v) => rowMatches(v, where)).length);
    p.profileView.upsert.mockImplementation(async ({ where, update, create }: { where: { viewerId_candidateId: Row }; update: Row; create: Row }) => {
        const existing = views.find((v) => rowMatches(v, where.viewerId_candidateId));
        const row = existing ? { ...existing, ...update } : { id: `view-${views.length + 1}`, viewedAt: new Date(), ...create };
        views = existing ? views.map((v) => (v === existing ? row : v)) : [...views, row];
        return row;
    });
    // getEmployerActivePostings, newest first.
    p.employerJob.findMany.mockImplementation(async ({ where }: { where: Row }) =>
        postings.filter((ej) => rowMatches(ej, where, relations)));
    p.employerJob.findFirst.mockResolvedValue(null);
    p.jobApplication.findMany.mockResolvedValue([]);
}

function signIn(role: 'employer' | 'admin'): void {
    h.role.current = role;
    h.getUser.mockResolvedValue({ data: { user: EMPLOYER }, error: null });
}

async function open(i: number): Promise<{ status: number; body: Record<string, unknown> }> {
    const id = candidateId(i);
    const res = await openCandidate(new NextRequest(`http://localhost:3000/api/employer/candidates/${id}`), {
        params: Promise.resolve({ id }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** `count` unlocks the employer made `hoursAgo` hours ago, spread over the postings. */
function unlockedEarlier(count: number, hoursAgo: number): void {
    const at = new Date(Date.now() - hoursAgo * HOUR);
    views = Array.from({ length: count }, (_, i) => ({
        id: `view-${i}`,
        viewerId: EMPLOYER.id,
        candidateId: candidateId(i),
        employerJobId: postings[i % postings.length].id,
        viewedAt: at,
    }));
}

const viewedAtOf = (i: number): number => (views.find((v) => v.candidateId === candidateId(i))?.viewedAt as Date).getTime();

beforeEach(() => {
    vi.clearAllMocks();
    candidates = Array.from({ length: DAILY_CAP + 2 }, (_, i) => candidate(i));
    postings = Array.from({ length: POSTINGS }, (_, i) => ({
        id: `ej-${i}`, userId: EMPLOYER.id, pricingTier: 'pro', createdAt: new Date(Date.now() - (i + 1) * 24 * HOUR), jobId: `job-${i}`,
        job: { id: `job-${i}`, isPublished: true, expiresAt: new Date(Date.now() + 30 * 24 * HOUR), createdAt: new Date() },
    }));
    views = [];
    installStore();
    signIn('employer');
});

describe('re-opening a candidate unlocked earlier', () => {
    it('opens in full and leaves the unlock time where it was', async () => {
        unlockedEarlier(1, 30);
        const before = viewedAtOf(0);

        const { status, body } = await open(0);

        expect(status).toBe(200);
        expect(body).toMatchObject({ hasFullAccess: true, contactEmail: 'cand-0@example.com' });
        expect(viewedAtOf(0)).toBe(before);
        expect(h.prisma.profileView.upsert).not.toHaveBeenCalled();
    });

    it("does not count against the daily cap: a full day's re-opens leave the next new unlock free", async () => {
        unlockedEarlier(DAILY_CAP, 25);

        for (let i = 0; i < DAILY_CAP; i++) {
            expect((await open(i)).status).toBe(200);
        }
        const fresh = await open(DAILY_CAP);

        expect(fresh.status).toBe(200);
        expect(fresh.body).toMatchObject({ hasFullAccess: true });
        expect(views).toHaveLength(DAILY_CAP + 1);
    });
});

describe('new unlocks still meet the cap', () => {
    it('refuses the unlock after a day of new ones, with the daily cap reason', async () => {
        unlockedEarlier(DAILY_CAP, 1);

        const refused = await open(DAILY_CAP);

        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ reason: 'daily_cap', used: DAILY_CAP, limit: DAILY_CAP });
        expect(views).toHaveLength(DAILY_CAP);
    });

    it('counts unlocks by when they were first made', async () => {
        unlockedEarlier(DAILY_CAP - 1, 2);

        expect(await canUnlockCandidate(EMPLOYER.id, 'pro')).toMatchObject({ allowed: true });
        expect((await open(DAILY_CAP - 1)).status).toBe(200);
        expect(await canUnlockCandidate(EMPLOYER.id, 'pro')).toMatchObject({ allowed: false, reason: 'daily_cap' });
    });
});

describe('the unlock write', () => {
    it('leaves a row already there as it is, so a repeated or concurrent unlock moves nothing', async () => {
        unlockedEarlier(1, 30);
        const before = viewedAtOf(0);

        expect(await recordCandidateUnlock(EMPLOYER.id, candidateId(0), postings[1].id as string)).toBe(true);

        expect(viewedAtOf(0)).toBe(before);
        expect(views).toEqual([expect.objectContaining({ employerJobId: postings[0].id })]);
    });
});

describe("an admin's opens", () => {
    beforeEach(() => signIn('admin'));

    it('records the first open as a view, charged to no posting, and writes nothing after', async () => {
        expect((await open(3)).status).toBe(200);
        expect(views).toEqual([expect.objectContaining({ viewerId: EMPLOYER.id, candidateId: candidateId(3), employerJobId: null })]);
        const first = viewedAtOf(3);

        expect((await open(3)).status).toBe(200);
        expect(h.prisma.profileView.upsert).toHaveBeenCalledTimes(1);
        expect(viewedAtOf(3)).toBe(first);
    });
});

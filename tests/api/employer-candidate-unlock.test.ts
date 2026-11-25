/**
 * An unlock delivers the profile in the same response that charges it.
 *
 * GET /api/employer/candidates/[id] spent one of a posting's unlocks on an
 * employer's first open (a ProfileView row) but granted full access only to
 * an employer with an active featured posting. A new post is never featured
 * here, so the first open charged and returned the locked view, and the
 * contact details came on the next load. The rule is now NP's own, the one
 * the page copy states: an active posting with unlocks left
 * (canUnlockCandidate). The open that records the unlock returns the full
 * profile, nothing is delivered without the row, and a written row is never
 * answered as a failure. The bulk unlock writes through the same helper.
 *
 * The ProfileView store is in memory; every fixture is fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type ViewRow = { id: string; viewerId: string; candidateId: string; employerJobId: string | null; viewedAt: Date };
type ViewKey = { viewerId_candidateId: { viewerId: string; candidateId: string } };

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    canUnlockCandidate: vi.fn(),
    prisma: {
        userProfile: { findUnique: vi.fn(), findFirst: vi.fn() },
        profileView: { findUnique: vi.fn(), upsert: vi.fn() },
        employerJob: { findFirst: vi.fn(), count: vi.fn() },
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/tier-limits', () => ({
    getEmployerTier: vi.fn(async () => 'pro'),
    canUnlockCandidate: h.canUnlockCandidate,
}));
vi.mock('@/lib/resume-storage', () => ({
    mintResumeReadUrl: vi.fn(async () => 'https://storage.example/signed-resume'),
    extractRequestContext: vi.fn(() => ({ ip: null, userAgent: null })),
}));

import { GET as openCandidate } from '@/app/api/employer/candidates/[id]/route';
import { POST as unlockBulk } from '@/app/api/employer/profiles/unlock-bulk/route';
import { recordCandidateUnlock } from '@/lib/candidate-unlock';

const EMPLOYER = { id: 'supabase-employer-fic', email: 'hiring@clinic.example', email_confirmed_at: '2026-10-01T00:00:00Z' };
const CANDIDATE_ID = 'supabase-candidate-fic';
const CANDIDATE = {
    supabaseId: CANDIDATE_ID, role: 'job_seeker', firstName: 'Anna', lastName: 'Nguyenfic', avatarUrl: null,
    headline: 'Family nurse practitioner', yearsExperience: 6, specialties: 'Family Practice (FNP)', preferredWorkMode: 'Remote',
    certifications: 'FNP-BC', licenseStates: 'TX,OK', availableDate: null, desiredSalaryMin: null, desiredSalaryMax: null,
    resumeUrl: `${CANDIDATE_ID}/resume.pdf`, email: 'anna.fic@example.com', linkedinUrl: 'https://linkedin.example/in/anna-fic',
    bio: 'Admin only.', preferredJobType: null, createdAt: new Date('2026-01-15T00:00:00Z'),
};
const ALLOWED = { allowed: true, used: 3, limit: 25, postingId: 'ej-active' };

let views: ViewRow[] = [];
/** 'none': writes work. 'lost': the write throws before storing. 'committed': it stores, then throws. */
let writeFailure: 'none' | 'lost' | 'committed' = 'none';

const keyOf = (where: ViewKey) => where.viewerId_candidateId;
const findView = (where: ViewKey) =>
    views.find((v) => v.viewerId === keyOf(where).viewerId && v.candidateId === keyOf(where).candidateId) ?? null;

function installStore(): void {
    h.prisma.profileView.findUnique.mockImplementation(async ({ where }: { where: ViewKey }) => findView(where));
    h.prisma.profileView.upsert.mockImplementation(async (args: { where: ViewKey; update: Partial<ViewRow>; create: Omit<ViewRow, 'id' | 'viewedAt'> }) => {
        if (writeFailure === 'lost') throw new Error('connection reset');
        const existing = findView(args.where);
        const row = existing
            ? { ...existing, ...args.update }
            : { id: `view-${views.length + 1}`, viewedAt: new Date(), ...args.create };
        views = existing ? views.map((v) => (v === existing ? row : v)) : [...views, row];
        if (writeFailure === 'committed') throw new Error('connection reset after commit');
        return row;
    });
}

function signIn(role: 'employer' | 'admin'): void {
    h.getUser.mockResolvedValue({ data: { user: EMPLOYER }, error: null });
    h.prisma.userProfile.findUnique.mockResolvedValue({ role });
}

async function open(query = ''): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await openCandidate(new NextRequest(`http://localhost:3000/api/employer/candidates/${CANDIDATE_ID}${query}`), {
        params: Promise.resolve({ id: CANDIDATE_ID }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
    vi.clearAllMocks();
    views = [];
    writeFailure = 'none';
    installStore();
    signIn('employer');
    h.prisma.userProfile.findFirst.mockResolvedValue(CANDIDATE);
    h.prisma.employerJob.findFirst.mockResolvedValue(null);
    h.canUnlockCandidate.mockResolvedValue(ALLOWED);
});

describe('GET /api/employer/candidates/[id]: the first open', () => {
    it('records the unlock and returns the full profile in the same response, with no featured posting', async () => {
        const { status, body } = await open();

        expect(status).toBe(200);
        expect(views).toEqual([expect.objectContaining({ viewerId: EMPLOYER.id, candidateId: CANDIDATE_ID, employerJobId: 'ej-active' })]);
        expect(body).toMatchObject({
            hasFullAccess: true,
            contactEmail: 'anna.fic@example.com',
            linkedinUrl: 'https://linkedin.example/in/anna-fic',
            resumeUrl: 'https://storage.example/signed-resume',
            licenseStates: ['TX', 'OK'],
            certifications: ['FNP-BC'],
            hasResume: true,
        });
        // The featured check is gone: no posting is counted for it.
        expect(h.prisma.employerJob.count).not.toHaveBeenCalled();
        expect(body).not.toHaveProperty('bio');
    });

    it.each([
        ['no active posting', { allowed: false, used: 0, limit: 25, reason: 'no_posting' }],
        ['no unlocks left on its postings', { allowed: false, used: 25, limit: 25 }],
        ['the daily cap', { allowed: false, used: 50, limit: 50, reason: 'daily_cap' }],
    ])('refuses an employer at %s: 403, no row, nothing delivered', async (_label, check) => {
        h.canUnlockCandidate.mockResolvedValue(check);

        const { status, body } = await open();

        expect(status).toBe(403);
        expect(views).toEqual([]);
        expect(JSON.stringify(body)).not.toContain('anna.fic@example.com');
        expect(body).not.toHaveProperty('hasFullAccess');
    });

    it('delivers nothing when the unlock was not recorded', async () => {
        writeFailure = 'lost';

        const { status, body } = await open();

        expect(status).toBe(503);
        expect(body).toEqual({ error: 'We could not unlock this profile just now. Please try again.', reason: 'unlock_failed' });
        expect(views).toEqual([]);
    });

    it('delivers the profile when the write failed after the row was stored, so no charge goes undelivered', async () => {
        writeFailure = 'committed';

        const { status, body } = await open();

        expect(status).toBe(200);
        expect(views).toHaveLength(1);
        expect(body).toMatchObject({ hasFullAccess: true, contactEmail: 'anna.fic@example.com' });
    });

    it('charges the posting the employer selected when it owns it and it is live', async () => {
        h.prisma.employerJob.findFirst.mockResolvedValue({ id: 'ej-selected' });

        await open('?postingId=ej-selected');

        expect(views).toEqual([expect.objectContaining({ employerJobId: 'ej-selected' })]);
    });
});

describe('GET /api/employer/candidates/[id]: a later open, or an admin', () => {
    it('opens an unlocked candidate in full without a second charge', async () => {
        views = [{ id: 'view-1', viewerId: EMPLOYER.id, candidateId: CANDIDATE_ID, employerJobId: 'ej-active', viewedAt: new Date('2026-11-01T00:00:00Z') }];

        const { status, body } = await open();

        expect(status).toBe(200);
        expect(body).toMatchObject({ hasFullAccess: true, contactEmail: 'anna.fic@example.com' });
        expect(h.canUnlockCandidate).not.toHaveBeenCalled();
        // Nothing is written: viewedAt stays the first unlock, which the daily
        // cap counts (tests/api/employer-unlock-daily-cap.test.ts).
        expect(views).toEqual([expect.objectContaining({ employerJobId: 'ej-active', viewedAt: new Date('2026-11-01T00:00:00Z') })]);
        expect(h.prisma.profileView.upsert).not.toHaveBeenCalled();
    });

    it("still opens for an admin when the admin's view row cannot be written", async () => {
        signIn('admin');
        writeFailure = 'lost';

        expect((await open()).body).toMatchObject({ hasFullAccess: true });
    });

    it('gives an admin full access without the unlock check', async () => {
        signIn('admin');

        const { status, body } = await open();

        expect(status).toBe(200);
        expect(body).toMatchObject({ hasFullAccess: true, bio: 'Admin only.' });
        expect(h.canUnlockCandidate).not.toHaveBeenCalled();
    });
});

describe('POST /api/employer/profiles/unlock-bulk: the same rule and the same write', () => {
    async function bulk(candidateIds: string[]) {
        const res = await unlockBulk(new NextRequest('http://localhost:3000/api/employer/profiles/unlock-bulk', {
            method: 'POST',
            body: JSON.stringify({ candidateIds }),
            headers: { 'Content-Type': 'application/json' },
        }));
        return (await res.json()) as { unlocked: Array<{ candidateId: string }>; failed: Array<{ candidateId: string; reason: string }> };
    }

    it('unlocks with an active posting that has unlocks left, featured or not', async () => {
        expect((await bulk([CANDIDATE_ID])).unlocked).toEqual([{ candidateId: CANDIDATE_ID }]);
        expect(views).toEqual([expect.objectContaining({ candidateId: CANDIDATE_ID, employerJobId: 'ej-active' })]);
    });

    it('reports a write that stored its row as unlocked, and one that did not as failed', async () => {
        writeFailure = 'committed';
        expect((await bulk([CANDIDATE_ID])).unlocked).toEqual([{ candidateId: CANDIDATE_ID }]);

        views = [];
        writeFailure = 'lost';
        expect(await bulk([CANDIDATE_ID])).toMatchObject({ unlocked: [], failed: [{ candidateId: CANDIDATE_ID, reason: 'error' }] });
    });
});

describe('recordCandidateUnlock', () => {
    it('writes one row per employer and candidate, keyed for idempotence', async () => {
        expect(await recordCandidateUnlock(EMPLOYER.id, CANDIDATE_ID, 'ej-active')).toBe(true);
        expect(await recordCandidateUnlock(EMPLOYER.id, CANDIDATE_ID, 'ej-other')).toBe(true);

        expect(views).toEqual([expect.objectContaining({ employerJobId: 'ej-active' })]);
        expect(h.prisma.profileView.upsert.mock.calls[0][0].where).toEqual({
            viewerId_candidateId: { viewerId: EMPLOYER.id, candidateId: CANDIDATE_ID },
        });
    });

    it('answers false when the row is not there after a failed write, or cannot be read back', async () => {
        writeFailure = 'lost';
        expect(await recordCandidateUnlock(EMPLOYER.id, CANDIDATE_ID, null)).toBe(false);

        h.prisma.profileView.findUnique.mockRejectedValueOnce(new Error('pool exhausted'));
        expect(await recordCandidateUnlock(EMPLOYER.id, CANDIDATE_ID, null)).toBe(false);
    });
});

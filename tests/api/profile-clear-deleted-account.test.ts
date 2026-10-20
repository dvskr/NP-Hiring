/**
 * POST /api/profile/clear never puts a deleted account back in the talent
 * pool.
 *
 * Before: the clear wrote openToOffers: true and profileVisible: true for
 * every caller and left deletedAt alone. Deleting an account switches both
 * flags off (app/api/auth/delete-account), and the pool reads only those two
 * flags and the role (GET /api/employer/candidates, the candidate profile and
 * resume routes, saved candidates, talent search). A seeker who deleted the
 * account, signed in again during the grace window without restoring it
 * (Google sign-in never calls /api/auth/restore-account), and pressed Clear
 * All on the settings page was listed to employers again while still marked
 * for purge.
 *
 * Why the clear runs instead of refusing: the settings page posts with no
 * body and shows any error the route returns, and the app has no restore
 * control (the only restore is the automatic one at password sign-in), so a
 * refusal would leave the person stuck with data they asked to wipe.
 *
 * Pinned:
 *   - A deleted account's clear wipes the profile and leaves both flags,
 *     deletedAt and purgeAt as they were, so it stays out of the pool.
 *   - A live account's clear resets both flags to the schema defaults, as
 *     before.
 *
 * The prisma fake applies the route's select and update to an in-memory row,
 * so the outcome is read from the row the route leaves behind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    prisma: {
        userProfile: { findUnique: vi.fn(), update: vi.fn() },
        candidateLicense: { deleteMany: vi.fn() },
        candidateCertification: { deleteMany: vi.fn() },
        candidateEducation: { deleteMany: vi.fn() },
        candidateWorkExperience: { deleteMany: vi.fn() },
        candidateScreeningAnswer: { deleteMany: vi.fn() },
        candidateOpenEndedResponse: { deleteMany: vi.fn() },
        candidateReference: { deleteMany: vi.fn() },
        $executeRawUnsafe: vi.fn(),
        $transaction: vi.fn(),
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => null) }));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/profile/clear/route';

type Row = Record<string, unknown>;

const SEEKER_ID = 'auth-seeker';
const DELETED_ON = new Date('2026-10-01T12:00:00.000Z');
const PURGE_ON = new Date('2026-10-31T12:00:00.000Z');

/** The filter GET /api/employer/candidates and the other pool sites apply. */
const TALENT_POOL = { profileVisible: true, openToOffers: true, role: 'job_seeker' } as const;

/** Rows the clear hard-deletes, one model per row type. */
const CHILD_MODELS = [
    'candidateLicense',
    'candidateCertification',
    'candidateEducation',
    'candidateWorkExperience',
    'candidateScreeningAnswer',
    'candidateOpenEndedResponse',
    'candidateReference',
] as const;

let profiles: Row[];

function seeker(overrides: Row = {}): Row {
    return {
        id: 'profile-seeker',
        supabaseId: SEEKER_ID,
        email: 'grace@example.com',
        role: 'job_seeker',
        firstName: 'Grace',
        lastName: 'Hopper',
        headline: 'Family NP, 8 years in primary care',
        phone: '555-0100',
        npiNumber: '1234567893',
        profileVisible: true,
        openToOffers: true,
        emailSuppressed: false,
        deletedAt: null,
        purgeAt: null,
        ...overrides,
    };
}

/** As app/api/auth/delete-account leaves it. */
function deletedSeeker(): Row {
    return seeker({
        profileVisible: false,
        openToOffers: false,
        emailSuppressed: true,
        deletedAt: DELETED_ON,
        purgeAt: PURGE_ON,
    });
}

const inTalentPool = (row: Row): boolean =>
    Object.entries(TALENT_POOL).every(([key, value]) => row[key] === value);

/** Only the selected fields, as Prisma returns them. */
function pick(row: Row, select?: Record<string, unknown>): Row {
    if (!select) return { ...row };
    return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function installFakeDatabase(): void {
    const p = h.prisma;
    p.userProfile.findUnique.mockImplementation(async (args: { where: { supabaseId: string }; select?: Record<string, unknown> }) => {
        const row = profiles.find((candidate) => candidate.supabaseId === args.where.supabaseId);
        return row ? pick(row, args.select) : null;
    });
    p.userProfile.update.mockImplementation(async (args: { where: { supabaseId: string }; data: Row }) => {
        const current = profiles.find((candidate) => candidate.supabaseId === args.where.supabaseId);
        if (!current) throw new Error(`fake prisma: no profile ${args.where.supabaseId}`);
        const updated = { ...current, ...args.data };
        profiles = profiles.map((candidate) => (candidate === current ? updated : candidate));
        return updated;
    });
    for (const model of CHILD_MODELS) {
        p[model].deleteMany.mockResolvedValue({ count: 0 });
    }
    p.$executeRawUnsafe.mockResolvedValue(0);
    // The route's interactive transaction runs against the same store.
    p.$transaction.mockImplementation(async (fn: (tx: typeof p) => Promise<unknown>) => fn(p));
}

function signIn(userId: string | null): void {
    h.getUser.mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null });
}

async function clearProfile(): Promise<{ status: number; body: Record<string, unknown> }> {
    // The settings page posts with no body.
    const res = await POST(new NextRequest('http://localhost:3000/api/profile/clear', { method: 'POST' }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const current = (): Row => {
    const row = profiles.find((candidate) => candidate.supabaseId === SEEKER_ID);
    if (!row) throw new Error('fake prisma: the seeker row is gone');
    return row;
};

beforeEach(() => {
    vi.clearAllMocks();
    installFakeDatabase();
    signIn(SEEKER_ID);
});

describe('POST /api/profile/clear on a deleted account', () => {
    beforeEach(() => {
        profiles = [deletedSeeker()];
    });

    it('keeps the account out of the talent pool', async () => {
        const res = await clearProfile();

        expect(res).toEqual({ status: 200, body: { success: true } });
        expect(current()).toMatchObject({ profileVisible: false, openToOffers: false });
        expect(inTalentPool(current())).toBe(false);
    });

    it('leaves the deletion and its purge date in place', async () => {
        await clearProfile();

        expect(current()).toMatchObject({ deletedAt: DELETED_ON, purgeAt: PURGE_ON, emailSuppressed: true });
    });

    it('still wipes the profile, its child rows and its embedding', async () => {
        await clearProfile();

        expect(current()).toMatchObject({
            firstName: 'Grace',
            lastName: null,
            headline: null,
            phone: null,
            npiNumber: null,
        });
        for (const model of CHILD_MODELS) {
            expect(h.prisma[model].deleteMany).toHaveBeenCalledWith({ where: { userId: 'profile-seeker' } });
        }
        expect(h.prisma.$executeRawUnsafe).toHaveBeenCalledWith(
            'DELETE FROM candidate_embeddings WHERE supabase_id = $1',
            SEEKER_ID,
        );
    });
});

describe('POST /api/profile/clear on a live account', () => {
    it('resets both visibility flags to the schema defaults, as before', async () => {
        profiles = [seeker({ profileVisible: false, openToOffers: false })];

        const res = await clearProfile();

        expect(res).toEqual({ status: 200, body: { success: true } });
        expect(current()).toMatchObject({ profileVisible: true, openToOffers: true, deletedAt: null, lastName: null });
    });

    it('answers 401 without a session and writes nothing', async () => {
        profiles = [seeker()];
        signIn(null);

        expect(await clearProfile()).toEqual({ status: 401, body: { error: 'Unauthorized' } });
        expect(h.prisma.$transaction).not.toHaveBeenCalled();
        expect(current()).toEqual(seeker());
    });
});

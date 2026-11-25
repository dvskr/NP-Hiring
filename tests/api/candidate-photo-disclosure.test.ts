/**
 * A candidate's photo is locked until unlock (owner, 2026-11-25).
 *
 * Every employer read of the talent pool sent each candidate's avatarUrl,
 * though an unlock pays for knowing who a candidate is. A photo now reaches
 * an employer only when the employer unlocked the candidate (a ProfileView
 * row) or the candidate applied to one of the employer's own jobs; an admin
 * sees every photo. The rule lives beside the surname rule
 * (app/api/conversations/_lib/surname-disclosure.ts), and the inbox and
 * thread cases are in tests/api/conversation-surname-disclosure.test.ts.
 * Covered here: the talent pool, the AI talent search, saved candidates and
 * a candidate's page, through the real routes; and the talent pool card,
 * which draws initials when no photo is sent.
 *
 * A photo that shows goes out as a signed link that expires, never the
 * public URL the column stores (lib/avatar-url.ts, owner 2026-11-25), and
 * only a photo the rule shows is ever signed.
 *
 * The fake prisma applies the routes' own where clauses to fixture rows, and
 * a fake store signs. Every fixture is fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rowMatches, type Row } from '../helpers/fake-row-where';

const EMPLOYER = { id: 'supabase-employer-fic', email: 'hiring@clinic.example', email_confirmed_at: '2026-10-01T00:00:00Z' };
const OWN_POSTING: Row = { userId: EMPLOYER.id, contactEmail: EMPLOYER.email };
const FOREIGN_POSTING: Row = { userId: 'supabase-other-employer-fic', contactEmail: 'talent@other.example' };

const h = vi.hoisted(() => ({
    getUser: vi.fn(),
    role: { current: 'employer' },
    canUnlockCandidate: vi.fn(),
    /** Every key the fake store was asked to sign. */
    signedKeys: [] as string[],
    db: {
        userProfile: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
        profileView: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
        jobApplication: { findMany: vi.fn() },
        employerJob: { findFirst: vi.fn(), findMany: vi.fn() },
        savedCandidate: { findMany: vi.fn() },
        aiCallLog: { count: vi.fn() },
    },
}));

vi.mock('@/lib/prisma', () => ({ prisma: h.db }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: h.getUser } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { employer: { limit: 100, windowSeconds: 60 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// The store lib/avatar-url.ts signs with: a fake that records each key.
vi.mock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
        storage: {
            from: () => ({
                createSignedUrls: async (paths: string[]) => {
                    h.signedKeys.push(...paths);
                    return { data: paths.map((path) => ({ path, signedUrl: `https://test.supabase.co/storage/v1/object/sign/avatars/${path}?token=fic`, error: null })), error: null };
                },
            }),
        },
    }),
}));
vi.mock('@/lib/tier-limits', () => ({
    getEmployerTier: vi.fn(async () => 'pro'),
    getEmployerActivePostings: vi.fn(async () => [{ id: 'ej-live' }]),
    canUnlockCandidate: h.canUnlockCandidate,
}));
vi.mock('@/lib/resume-storage', () => ({
    mintResumeReadUrl: vi.fn(async () => null),
    extractRequestContext: vi.fn(() => ({ ip: null, userAgent: null })),
}));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: vi.fn(async () => true) }));
vi.mock('@/lib/ai/gateway', () => ({
    embed: vi.fn(async () => ({ embedding: [0.1, 0.2] })),
    complete: vi.fn(async () => ({
        parsed: { ranked: [1, 2, 3, 4].map((candidateIndex) => ({ candidateIndex, reason: 'Relevant experience.' })) },
    })),
}));
vi.mock('@/lib/ai/vector-search', () => ({
    semanticCandidateSearch: vi.fn(async () =>
        ['locked', 'unlocked', 'applied', 'elsewhere'].map((key, i) => ({ supabaseId: `cand-${key}`, similarity: 0.9 - i / 10 }))),
}));
vi.mock('@/lib/ai/prompts/registry', () => ({
    loadPrompt: vi.fn(async () => ({ id: 'talent_search_rerank', version: 'v2', render: () => [] })),
}));
vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return {
        default: ({ href, children }: { href: string; children?: React.ReactNode }) => createElement('a', { href }, children),
    };
});

import { GET as talentPoolRoute } from '@/app/api/employer/candidates/route';
import { POST as talentSearchRoute } from '@/app/api/employer/talent/search/route';
import { GET as savedRoute } from '@/app/api/employer/saved-candidates/route';
import { GET as candidatePageRoute } from '@/app/api/employer/candidates/[id]/route';
import CandidateCard from '@/components/employer/CandidateCard';

/** The candidate's photo key, in their own upload folder. */
const photoKey = (key: string): string => `prod/cand-${key}/1700000000000.jpg`;
/** What the column stores: the public URL /api/upload writes. */
const storedPhoto = (key: string): string => `https://test.supabase.co/storage/v1/object/public/avatars/${photoKey(key)}`;
/** What a response may carry: a link that expires. */
const photo = (key: string): string => `https://test.supabase.co/storage/v1/object/sign/avatars/${photoKey(key)}?token=fic`;

function candidate(key: string, firstName: string): Row {
    return {
        id: `p-${key}`, supabaseId: `cand-${key}`, role: 'job_seeker', profileVisible: true, openToOffers: true, deletedAt: null,
        firstName, lastName: 'Okafic', avatarUrl: storedPhoto(key), headline: 'Nurse practitioner', yearsExperience: 5,
        specialties: 'Family Practice (FNP)', preferredWorkMode: 'Remote', certifications: null, licenseStates: 'TX',
        desiredSalaryMin: null, desiredSalaryMax: null, desiredSalaryType: null, availableDate: null, resumeUrl: null,
        bio: null, preferredJobType: null, state: null, city: null, email: `${key}@example.com`, linkedinUrl: null,
        createdAt: new Date('2026-02-01T00:00:00Z'),
    };
}

/** Locked; unlocked by this employer; applied to its own posting; applied to another employer's. */
const CANDIDATES: Row[] = [
    candidate('locked', 'Lena'),
    candidate('unlocked', 'Uma'),
    candidate('applied', 'Ada'),
    candidate('elsewhere', 'Eli'),
];
const VIEWS: Row[] = [{ id: 'view-1', viewerId: EMPLOYER.id, candidateId: 'cand-unlocked', employerJobId: 'ej-live' }];
const APPLICATIONS = [
    { userId: 'cand-applied', posting: OWN_POSTING },
    { userId: 'cand-elsewhere', posting: FOREIGN_POSTING },
];

const LOCKED_FOR_AN_EMPLOYER = {
    'cand-locked': null,
    'cand-unlocked': photo('unlocked'),
    'cand-applied': photo('applied'),
    'cand-elsewhere': null,
};

function signIn(role: 'employer' | 'admin'): void {
    h.role.current = role;
    h.getUser.mockResolvedValue({ data: { user: EMPLOYER }, error: null });
}

type ApplicationWhere = { userId: { in: string[] }; job: { employerJobs: unknown } };

function installStore(): void {
    h.db.userProfile.findUnique.mockImplementation(async () => ({ id: 'profile-employer-fic', role: h.role.current }));
    h.db.userProfile.findFirst.mockImplementation(async ({ where }: { where: Row }) => CANDIDATES.find((c) => rowMatches(c, where)) ?? null);
    h.db.userProfile.findMany.mockImplementation(async ({ where }: { where: Row }) => CANDIDATES.filter((c) => rowMatches(c, where)));
    h.db.userProfile.count.mockImplementation(async ({ where }: { where: Row }) => CANDIDATES.filter((c) => rowMatches(c, where)).length);
    h.db.profileView.findMany.mockImplementation(async ({ where }: { where: Row }) => VIEWS.filter((v) => rowMatches(v, where)));
    h.db.profileView.findUnique.mockImplementation(async ({ where }: { where: { viewerId_candidateId: Row } }) =>
        VIEWS.find((v) => rowMatches(v, where.viewerId_candidateId)) ?? null);
    h.db.profileView.upsert.mockImplementation(async ({ create }: { create: Row }) => create);
    // The route's own clause: the applicant ids, and the ownership of the posting applied to.
    h.db.jobApplication.findMany.mockImplementation(async ({ where }: { where: ApplicationWhere }) =>
        APPLICATIONS
            .filter((a) => where.userId.in.includes(a.userId) && rowMatches(a.posting, where.job.employerJobs))
            .map((a) => ({ userId: a.userId })));
    h.db.employerJob.findFirst.mockResolvedValue(null);
    h.db.employerJob.findMany.mockResolvedValue([]);
    h.db.savedCandidate.findMany.mockImplementation(async () =>
        CANDIDATES.map((c, i) => ({
            id: `saved-${i}`, note: null, tags: [], savedAt: new Date('2026-11-01T00:00:00Z'),
            employerJobId: null, employerJob: null, candidate: c,
        })));
    h.db.aiCallLog.count.mockResolvedValue(0);
    h.canUnlockCandidate.mockResolvedValue({ allowed: true, used: 1, limit: 25, postingId: 'ej-live' });
}

type Card = { id: string; avatarUrl: string | null; initials: string };
const photosOf = (cards: Card[]): Record<string, string | null> =>
    Object.fromEntries(cards.map((c) => [c.id, c.avatarUrl]));

async function talentPool(): Promise<Card[]> {
    const res = await talentPoolRoute(new NextRequest('http://localhost:3000/api/employer/candidates'));
    return (await res.json()).candidates;
}

async function talentSearch(): Promise<Card[]> {
    const res = await talentSearchRoute(new NextRequest('http://localhost:3000/api/employer/talent/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'remote family nurse practitioner', k: 4 }),
    }));
    return (await res.json()).candidates;
}

async function savedCandidates(): Promise<Card[]> {
    const res = await savedRoute(new NextRequest('http://localhost:3000/api/employer/saved-candidates'));
    return (await res.json()).savedCandidates.map((s: { candidate: Card }) => s.candidate);
}

beforeEach(() => {
    vi.clearAllMocks();
    h.signedKeys = [];
    installStore();
    signIn('employer');
});

describe.each([
    ['the talent pool', talentPool],
    ['the AI talent search', talentSearch],
    ['saved candidates', savedCandidates],
])('%s', (_surface, load) => {
    it('sends a photo only for a candidate the employer unlocked, or who applied to one of its own jobs', async () => {
        const cards = await load();

        expect(photosOf(cards)).toEqual(LOCKED_FOR_AN_EMPLOYER);
        expect(JSON.stringify(cards)).not.toContain(photoKey('locked'));
        expect(cards.find((c) => c.id === 'cand-locked')?.initials).toBe('LO');
    });

    it('sends a shown photo as a link that expires, and signs no photo the rule withholds', async () => {
        const raw = JSON.stringify(await load());

        expect(raw).not.toContain('/object/public/avatars/');
        expect([...h.signedKeys].sort()).toEqual([photoKey('applied'), photoKey('unlocked')]);
    });

    it('sends every photo to an admin, signed, with no lookup', async () => {
        signIn('admin');

        expect(Object.values(photosOf(await load()))).toEqual(['locked', 'unlocked', 'applied', 'elsewhere'].map(photo));
        expect(h.db.jobApplication.findMany).not.toHaveBeenCalled();
    });
});

describe("a candidate's page", () => {
    async function open(id: string) {
        const res = await candidatePageRoute(new NextRequest(`http://localhost:3000/api/employer/candidates/${id}`), {
            params: Promise.resolve({ id }),
        });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    }

    it('sends the photo of a candidate the employer unlocked earlier', async () => {
        expect((await open('cand-unlocked')).body).toMatchObject({ avatarUrl: photo('unlocked'), hasFullAccess: true });
    });

    it('sends the photo with the unlock the first open records', async () => {
        expect((await open('cand-locked')).body).toMatchObject({ avatarUrl: photo('locked'), hasFullAccess: true });
    });

    it('sends nothing, the photo included, when the unlock is refused, and signs nothing', async () => {
        h.canUnlockCandidate.mockResolvedValue({ allowed: false, used: 0, limit: 25, reason: 'no_posting' });

        const { status, body } = await open('cand-locked');

        expect(status).toBe(403);
        expect(JSON.stringify(body)).not.toContain(photoKey('locked'));
        expect(h.signedKeys).toEqual([]);
    });
});

describe('the talent pool card', () => {
    const card = (avatarUrl: string | null) => renderToStaticMarkup(React.createElement(CandidateCard, {
        id: 'cand-locked', displayName: 'Lena O.', initials: 'LO', avatarUrl, headline: null, yearsExperience: null,
        certifications: [], licenseStates: [], specialties: [], preferredWorkMode: null, availableDate: null, hasResume: false,
    }));

    it('draws the initials when no photo is sent, and the photo when one is', () => {
        const locked = card(null);
        expect(locked).toContain('>LO</div>');
        expect(locked).not.toContain('url(');

        expect(card(photo('unlocked'))).toContain(`url(${photo('unlocked')})`);
    });
});

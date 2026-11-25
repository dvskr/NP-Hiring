/**
 * Employer candidate search may only match and filter on what the viewer can
 * already read.
 *
 * GET /api/employer/candidates matched `q` against lastName, bio, state, city
 * and certifications for every employer, and applied the `states` and
 * `hasResume` filters without a posting, so a search confirmed locked fields
 * (q=<surname> answered "Anna N."). POST /api/employer/talent/search passed
 * `states` to the vector search the same way, and cached the rerank, whose
 * reasons quote the fields sent to the model, without the viewer's tier.
 * Both reads also keep out deleted accounts (lib/candidate-pool.ts).
 *
 * The routes' real where clauses run against fixture rows.
 * All fixtures are fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { rowMatches, type Row } from '../helpers/fake-row-where';

const { db, activePostings, semanticCandidateSearch, complete } = vi.hoisted(() => ({
    db: {
        userProfile: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
        profileView: { findMany: vi.fn() },
        // The photo rule's application lookup (conversations/_lib/surname-disclosure.ts).
        jobApplication: { findMany: vi.fn() },
        aiCallLog: { count: vi.fn() },
    },
    activePostings: { current: [] as Array<{ id: string }> },
    semanticCandidateSearch: vi.fn(),
    complete: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'supabase-employer-fic-1', email: 'hiring@clinic.example' } }, error: null }) },
    }),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => null, RATE_LIMITS: { employer: { limit: 100, windowSeconds: 60 } } }));
vi.mock('@/lib/tier-limits', () => ({
    getEmployerTier: async () => 'pro',
    getEmployerActivePostings: async () => activePostings.current,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/ai/feature-flags', () => ({ isAiFeatureEnabled: async () => true }));
vi.mock('@/lib/ai/gateway', () => ({
    embed: async () => ({ embedding: [0.1, 0.2] }),
    complete: (...a: unknown[]) => complete(...a),
}));
vi.mock('@/lib/ai/vector-search', () => ({
    semanticCandidateSearch: (...a: unknown[]) => semanticCandidateSearch(...a),
}));
vi.mock('@/lib/ai/prompts/registry', () => ({
    loadPrompt: async () => ({
        id: 'talent_search_rerank',
        version: 'v2',
        render: (vars: Record<string, string>) => [{ role: 'user', content: `${vars.jobSummary}\n${vars.candidateList}` }],
    }),
}));

import { GET as searchCandidates } from '@/app/api/employer/candidates/route';
import { POST as talentSearch } from '@/app/api/employer/talent/search/route';

const BASE: Row = {
    role: 'job_seeker', profileVisible: true, openToOffers: true, deletedAt: null,
    headline: 'Nurse practitioner', yearsExperience: 4, specialties: 'Family Practice (FNP)', preferredWorkMode: 'Remote',
    certifications: null, bio: null, state: null, city: null, avatarUrl: null,
    desiredSalaryMin: null, desiredSalaryMax: null, desiredSalaryType: null, availableDate: null, preferredJobType: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
};
const candidates: Row[] = [
    { ...BASE, id: 'p-anna', supabaseId: 'cand-anna', firstName: 'Anna', lastName: 'Nguyenfic', licenseStates: 'TX', resumeUrl: 'resumes/anna.pdf', bio: 'Former Nguyenfic Clinic lead' },
    { ...BASE, id: 'p-ben', supabaseId: 'cand-ben', firstName: 'Ben', lastName: 'Okafic', licenseStates: 'CA', resumeUrl: null },
    { ...BASE, id: 'p-cara', supabaseId: 'cand-cara', firstName: 'Cara', lastName: 'Deletedfic', licenseStates: 'TX', resumeUrl: null, deletedAt: new Date('2026-11-01T00:00:00Z') },
];

function asViewer(role: 'employer' | 'admin', hasPosting: boolean) {
    db.userProfile.findUnique.mockResolvedValue({ role });
    activePostings.current = hasPosting ? [{ id: 'ej-1' }] : [];
}

async function search(params: Record<string, string>) {
    const res = await searchCandidates(new NextRequest(`http://localhost/api/employer/candidates?${new URLSearchParams(params)}`));
    const body = await res.json();
    return { status: res.status, ids: (body.candidates as Array<{ id: string }>).map((c) => c.id), body };
}

beforeEach(() => {
    vi.clearAllMocks();
    db.userProfile.findMany.mockImplementation(async ({ where }: { where: unknown }) => candidates.filter((c) => rowMatches(c, where)));
    db.userProfile.count.mockImplementation(async ({ where }: { where: unknown }) => candidates.filter((c) => rowMatches(c, where)).length);
    db.profileView.findMany.mockResolvedValue([]);
    db.jobApplication.findMany.mockResolvedValue([]);
    db.aiCallLog.count.mockResolvedValue(0);
    semanticCandidateSearch.mockResolvedValue([
        { supabaseId: 'cand-anna', similarity: 0.9 },
        { supabaseId: 'cand-ben', similarity: 0.8 },
        { supabaseId: 'cand-cara', similarity: 0.7 },
    ]);
    complete.mockResolvedValue({ parsed: { ranked: [{ candidateIndex: 1, reason: 'Strong match.' }] } });
});

describe('GET /api/employer/candidates: q searches only readable fields', () => {
    it('a surname search confirms nothing for an employer', async () => {
        asViewer('employer', true);
        const { status, ids, body } = await search({ q: 'nguyenfic' });
        expect(status).toBe(200);
        expect(ids).toEqual([]);
        expect(JSON.stringify(body)).not.toContain('Nguyenfic');
    });

    it('an admin still finds the candidate by surname or bio', async () => {
        asViewer('admin', false);
        expect((await search({ q: 'nguyenfic' })).ids).toEqual(['cand-anna']);
    });

    it('a first-name search works for any employer', async () => {
        asViewer('employer', false);
        expect((await search({ q: 'anna' })).ids).toEqual(['cand-anna']);
    });
});

describe('GET /api/employer/candidates: filters on posting-tier fields', () => {
    it('ignores states and hasResume without a posting', async () => {
        asViewer('employer', false);
        expect((await search({ states: 'TX' })).ids).toEqual(['cand-anna', 'cand-ben']);
        expect((await search({ hasResume: 'true' })).ids).toEqual(['cand-anna', 'cand-ben']);
    });

    it('applies them with a posting', async () => {
        asViewer('employer', true);
        expect((await search({ states: 'CA' })).ids).toEqual(['cand-ben']);
        expect((await search({ hasResume: 'true' })).ids).toEqual(['cand-anna']);
        expect((await search({ hasResume: 'false' })).ids).toEqual(['cand-ben']);
    });

    it('never lists a deleted account, whatever its visibility flags say', async () => {
        asViewer('admin', false);
        const { ids, body } = await search({});
        expect(ids).not.toContain('cand-cara');
        expect(body.totalCount).toBe(2);
    });
});

async function talent(states?: string[]) {
    const res = await talentSearch(new NextRequest('http://localhost/api/employer/talent/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'outpatient family nurse practitioner', k: 3, ...(states ? { states } : {}) }),
    }));
    return { status: res.status, body: await res.json() };
}

describe('POST /api/employer/talent/search', () => {
    it('drops the license state filter without a posting', async () => {
        asViewer('employer', false);
        await talent(['TX']);
        expect(semanticCandidateSearch.mock.calls[0][1]).toMatchObject({ licenseStates: undefined });
    });

    it('passes it with a posting', async () => {
        asViewer('employer', true);
        await talent(['TX']);
        expect(semanticCandidateSearch.mock.calls[0][1]).toMatchObject({ licenseStates: ['TX'] });
    });

    it('hydrates only visible, undeleted job seekers', async () => {
        asViewer('employer', true);
        const { status, body } = await talent();
        expect(status).toBe(200);
        const where = db.userProfile.findMany.mock.calls[0][0].where;
        expect(rowMatches(candidates[2], where)).toBe(false);
        expect(JSON.stringify(body)).not.toContain('cand-cara');
    });

    it('keys the cached rerank by the viewer tier', async () => {
        const keyFor = async (role: 'employer' | 'admin', hasPosting: boolean) => {
            complete.mockClear();
            asViewer(role, hasPosting);
            await talent();
            return complete.mock.calls[0][0].cacheKey as unknown[];
        };
        const browse = await keyFor('employer', false);
        const posting = await keyFor('employer', true);
        const admin = await keyFor('admin', false);
        expect(browse).toContain('browse');
        expect(posting).toContain('posting');
        expect(admin).toContain('admin');
        expect(new Set([browse.join('|'), posting.join('|'), admin.join('|')]).size).toBe(3);
    });
});

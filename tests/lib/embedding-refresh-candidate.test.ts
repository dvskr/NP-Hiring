/**
 * The candidate embedding refresh (lib/inngest/functions/embeddings.ts) after
 * the bio left the embedding text (owner, 2026-11-25).
 *
 * The bio is admin-only in the talent pool, and the employer's AI talent
 * search ranks against this text. The worker no longer reads the bio, and a
 * profile whose text is now under the gate loses its row: a row embedded from
 * a bio would otherwise keep matching it after every re-embed skipped the
 * profile as too sparse.
 *
 * Every fixture is fictional.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    findUnique: vi.fn(),
    upsertCandidateEmbedding: vi.fn(),
    removeCandidateEmbedding: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
    inngest: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { findUnique: h.findUnique } } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/ai/vector-search', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/ai/vector-search')>()),
    upsertCandidateEmbedding: h.upsertCandidateEmbedding,
    removeCandidateEmbedding: h.removeCandidateEmbedding,
}));

import { refreshCandidateEmbedding } from '@/lib/inngest/functions/embeddings';

type Handler = (ctx: {
    event: { data: { supabaseId: string } };
    step: { run: <T>(id: string, body: () => Promise<T>) => Promise<T> };
}) => Promise<unknown>;

const SUPABASE_ID = 'supabase-candidate-fic';
const BIO = 'Led the Okafic Clinic telehealth program for six years.';

function refresh(): Promise<unknown> {
    const fn = refreshCandidateEmbedding as unknown as { handler: Handler };
    return fn.handler({ event: { data: { supabaseId: SUPABASE_ID } }, step: { run: async (_id, body) => body() } });
}

function profile(fields: Record<string, unknown>) {
    return {
        headline: null, yearsExperience: null, certifications: null, licenseStates: null, specialties: null, skills: [],
        profileVisible: true, deletedAt: null, ...fields,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.upsertCandidateEmbedding.mockResolvedValue({ updated: true });
    h.removeCandidateEmbedding.mockResolvedValue({ removed: true });
});

describe('refreshCandidateEmbedding', () => {
    it('does not read the bio', async () => {
        h.findUnique.mockResolvedValue(profile({ headline: 'Family nurse practitioner', specialties: 'Family Practice (FNP)' }));

        await refresh();

        expect(h.findUnique.mock.calls[0][0].select).not.toHaveProperty('bio');
    });

    it('embeds a profile from its other fields, never its bio', async () => {
        h.findUnique.mockResolvedValue(profile({ headline: 'Family nurse practitioner', specialties: 'Family Practice (FNP)', bio: BIO }));

        expect(await refresh()).toEqual({ supabaseId: SUPABASE_ID, updated: true });
        const [, text] = h.upsertCandidateEmbedding.mock.calls[0];
        expect(text).toContain('Family Practice (FNP)');
        expect(text).not.toContain('Okafic');
        expect(h.removeCandidateEmbedding).not.toHaveBeenCalled();
    });

    it('removes the row of a profile too sparse to embed, one a bio used to carry', async () => {
        h.findUnique.mockResolvedValue(profile({ headline: 'NP', bio: BIO }));

        expect(await refresh()).toEqual({ skipped: 'profile_too_sparse', removed: true });
        expect(h.removeCandidateEmbedding).toHaveBeenCalledWith(SUPABASE_ID);
        expect(h.upsertCandidateEmbedding).not.toHaveBeenCalled();
    });

    it('leaves a hidden profile alone, as before', async () => {
        h.findUnique.mockResolvedValue(profile({ headline: 'Family nurse practitioner', profileVisible: false }));

        expect(await refresh()).toEqual({ skipped: 'not_visible' });
        expect(h.removeCandidateEmbedding).not.toHaveBeenCalled();
        expect(h.upsertCandidateEmbedding).not.toHaveBeenCalled();
    });
});

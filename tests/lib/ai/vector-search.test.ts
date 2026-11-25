/**
 * Vector search helper tests — pure functions, and the candidate row removal
 * against the global prisma fake. The other DB-touching paths
 * (semanticJobSearch, upsertJobEmbedding) are integration-tested in the
 * Phase 1 sprint where they get wired to a real flow.
 */

import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
    buildJobEmbeddingText,
    buildCandidateEmbeddingText,
    CANDIDATE_EMBED_MIN_CHARS,
    reciprocalRankFusion,
    removeCandidateEmbedding,
    __testing,
} from '@/lib/ai/vector-search';
import { isProfileSearchable } from '@/lib/profile-searchable';

/** A profile as both the embedder and the dashboard's mirror read it, plus the bio neither may use. */
type ProfileFields = {
    headline?: string;
    yearsExperience?: number;
    certifications?: string;
    licenseStates?: string;
    specialties?: string;
    skills?: string[];
    bio?: string;
};

describe('lib/ai/vector-search', () => {
    describe('buildJobEmbeddingText', () => {
        it('produces a stable string given stable inputs', () => {
            const job = { title: 'PMHNP', description: 'Telehealth role', state: 'CA', benefits: ['health', '401k'] };
            const a = buildJobEmbeddingText(job);
            const b = buildJobEmbeddingText({ ...job });
            expect(a).toBe(b);
        });

        it('truncates massive descriptions', () => {
            const big = 'x'.repeat(10_000);
            const text = buildJobEmbeddingText({ title: 'T', description: big });
            expect(text.length).toBeLessThan(5_000);
        });

        it('handles missing optional fields without crashing', () => {
            const text = buildJobEmbeddingText({ title: 'T', description: null });
            expect(text).toContain('Title: T');
        });
    });

    describe('buildCandidateEmbeddingText', () => {
        it('omits absent fields silently', () => {
            const text = buildCandidateEmbeddingText({});
            expect(text).toBe('');
        });

        it('includes provided fields in stable order', () => {
            const text = buildCandidateEmbeddingText({
                headline: 'PMHNP',
                yearsExperience: 5,
                skills: ['Telepsych', 'CBT'],
            });
            const lines = text.split('\n');
            expect(lines[0]).toContain('Headline');
            expect(lines[1]).toContain('Years of Experience');
            expect(lines[2]).toContain('Skills');
        });

        it('leaves out the bio, which only admins read in the talent pool (owner, 2026-11-25)', () => {
            const profile: ProfileFields = {
                headline: 'Family nurse practitioner',
                specialties: 'Family Practice (FNP)',
                bio: 'Led the Okafic Clinic telehealth program for six years.',
            };
            const text = buildCandidateEmbeddingText(profile);
            expect(text).toBe('Headline: Family nurse practitioner\nSpecialties: Family Practice (FNP)');
            expect(text).not.toContain('Okafic');
        });
    });

    describe('the candidate dashboard mirror (lib/profile-searchable.ts)', () => {
        const profiles: ProfileFields[] = [
            {},
            { headline: 'NP' },
            { headline: 'Family nurse practitioner', yearsExperience: 4 },
            { specialties: 'Family Practice (FNP)', skills: ['Telehealth'] },
            { certifications: 'FNP-BC', licenseStates: 'TX,OK' },
            // Long enough on its own once, and no longer searchable now the bio is out.
            { headline: 'NP', bio: 'A long summary that clears the twenty character gate on its own.' },
        ];

        it('measures the text the embedder builds, against the same gate', () => {
            for (const profile of profiles) {
                const embedded = buildCandidateEmbeddingText(profile).trim();
                const mirror = isProfileSearchable(profile);
                expect(mirror.embedTextLength, JSON.stringify(profile)).toBe(embedded.length);
                expect(mirror.searchable, JSON.stringify(profile)).toBe(embedded.length >= CANDIDATE_EMBED_MIN_CHARS);
            }
        });

        it('never asks a candidate for a bio to be found', () => {
            expect(isProfileSearchable(null).missingHighValueFields).toEqual(['headline', 'specialties', 'yearsExperience']);
            expect(isProfileSearchable(profiles[5]).searchable).toBe(false);
        });
    });

    describe('removeCandidateEmbedding', () => {
        it('deletes the row by Supabase id and says whether one was there', async () => {
            const deleteMany = vi.mocked(prisma.candidateEmbedding.deleteMany);
            deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

            expect(await removeCandidateEmbedding('supabase-candidate-fic')).toEqual({ removed: true });
            expect(await removeCandidateEmbedding('supabase-candidate-fic')).toEqual({ removed: false });
            expect(deleteMany).toHaveBeenCalledWith({ where: { supabaseId: 'supabase-candidate-fic' } });
        });
    });

    describe('reciprocalRankFusion', () => {
        it('reranks an item that ranks highly across multiple lists higher than a single-list winner', () => {
            const vectorRanking  = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
            const keywordRanking = [{ id: 'B' }, { id: 'A' }, { id: 'D' }];

            const fused = reciprocalRankFusion([vectorRanking, keywordRanking]);
            // A and B both rank in both lists; D and C only in one each.
            expect(fused[0].id === 'A' || fused[0].id === 'B').toBe(true);
            const dRank = fused.findIndex((r) => r.id === 'D');
            const cRank = fused.findIndex((r) => r.id === 'C');
            expect(fused.findIndex((r) => r.id === 'A')).toBeLessThan(dRank);
            expect(fused.findIndex((r) => r.id === 'B')).toBeLessThan(cRank);
        });

        it('returns an empty list when all input lists are empty', () => {
            const result = reciprocalRankFusion([]);
            expect(result).toEqual([]);
        });

        it('stays deterministic given the same inputs', () => {
            const a = reciprocalRankFusion([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]]);
            const b = reciprocalRankFusion([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]]);
            expect(a).toEqual(b);
        });
    });

    describe('toVectorLiteral', () => {
        it('produces a pgvector-compatible bracketed literal', () => {
            expect(__testing.toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
        });

        it('handles an empty vector', () => {
            expect(__testing.toVectorLiteral([])).toBe('[]');
        });
    });
});

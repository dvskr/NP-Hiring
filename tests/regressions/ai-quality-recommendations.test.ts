/**
 * Regression guards — recommendation engagement loop + cron scaling.
 *
 * B14/B88: CandidateRecommendation.clickedAt / dismissedAt were read by the
 *      nightly cron (click-boost) and the dashboard reader (dismiss filter)
 *      but NOTHING ever wrote them. POST /api/recommendations/click is the
 *      write side; the dashboard "For you" cards wire click + dismiss to it.
 *
 * B97: one Inngest step per candidate meant ~5000 steps at the candidate
 *      cap — past Inngest's per-run step limit. The cron must batch
 *      candidates into chunked steps, mint a replay-stable batchId, and log
 *      loudly when the 5000 cap truncates the candidate base.
 *
 * B95: off-spec scoring output must persist as UNSCORED (null), never as a
 *      literal 0% that sinks the candidate in the employer's AI-Score sort.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeScoringResult } from '@/lib/candidate-scorer';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B14/B88 — engagement write endpoint', () => {
    const src = () => read('app/api/recommendations/click/route.ts');

    it('exists and exports POST', async () => {
        const mod = await import('@/app/api/recommendations/click/route');
        expect(typeof mod.POST).toBe('function');
    });

    it('scopes writes to the authenticated candidate own rows', () => {
        const s = src();
        // Both branches must filter on the caller's supabase id.
        const matches = s.match(/supabaseId: user\.id/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
        expect(s).toContain('dismissedAt: new Date()');
        expect(s).toContain('clickedAt: new Date()');
    });

    it('is first-engagement-wins (only stamps not-yet-stamped rows)', () => {
        const s = src();
        expect(s).toContain('clickedAt: null');
        expect(s).toContain('dismissedAt: null');
    });

    it('dashboard wires click + dismiss for AI recommendation cards', () => {
        const s = read('components/dashboard/DashboardContent.tsx');
        expect(s).toContain("'/api/recommendations/click'");
        expect(s).toContain("trackRecommendation(job.id, 'click')");
        expect(s).toContain('dismissRecommendation');
        expect(s).toContain('Not interested');
        // Click tracking only fires for AI-generated cards.
        expect(s).toContain('if (!job.recommendationTier) return');
    });

    it('the nightly cron still consumes clickedAt for the affinity boost', () => {
        const s = read('lib/inngest/functions/recommendations.ts');
        expect(s).toContain('clickedAt: { not: null }');
    });
});

describe('B97 — recommendations cron stays within Inngest step limits', () => {
    const src = () => read('lib/inngest/functions/recommendations.ts');

    it('batches candidates into chunked steps instead of one step per candidate', () => {
        const s = src();
        expect(s).toMatch(/const CHUNK_SIZE = \d+/);
        expect(s).toContain('recommend-batch-');
        // The unbounded per-candidate step naming must not come back.
        expect(s).not.toContain('`recommend-${row.supabase_id}`');
    });

    it('keeps the 5000-candidate cap but logs when it truncates', () => {
        const s = src();
        expect(s).toContain('const CANDIDATE_CAP = 5000');
        expect(s).toContain('candidate cap hit');
    });

    it('mints the batchId inside a memoized step so replays share one batch', () => {
        const s = src();
        expect(s).toMatch(/step\.run\('mint-batch-id'/);
    });

    it('worst-case step count stays under the Inngest per-run limit', () => {
        const s = src();
        const cap = Number(s.match(/const CANDIDATE_CAP = (\d+)/)?.[1]);
        const chunk = Number(s.match(/const CHUNK_SIZE = (\d+)/)?.[1]);
        expect(cap).toBeGreaterThan(0);
        expect(chunk).toBeGreaterThan(0);
        // chunks + flag check + embedding list + batch-id mint + slack
        expect(Math.ceil(cap / chunk) + 5).toBeLessThan(1000);
    });

    it('chunk retries are idempotent per candidate within the batch', () => {
        const s = src();
        expect(s).toContain('alreadyWritten');
        expect(s).toMatch(/where: \{ supabaseId: row\.supabase_id, batchId \}/);
    });
});

describe('B95 — off-spec scoring persists as unscored, not 0%', () => {
    it('missing score → null', () => {
        expect(normalizeScoringResult({}).score).toBeNull();
    });

    it('NaN / non-finite score → null', () => {
        expect(normalizeScoringResult({ score: Number.NaN }).score).toBeNull();
        expect(normalizeScoringResult({ score: Number.POSITIVE_INFINITY }).score).toBeNull();
    });

    it('in-range scores are rounded and clamped, not nulled', () => {
        expect(normalizeScoringResult({ score: 87.4 }).score).toBe(87);
        expect(normalizeScoringResult({ score: 150 }).score).toBe(100);
        expect(normalizeScoringResult({ score: -5 }).score).toBe(0);
        expect(normalizeScoringResult({ score: 0 }).score).toBe(0); // a REAL zero survives
    });

    it('reasons/missing lists are filtered to strings and capped', () => {
        const out = normalizeScoringResult({
            score: 70,
            matchReasons: ['a', 1 as unknown as string, 'b', 'c', 'd', 'e', 'f', 'g'],
            missingItems: ['m1', null as unknown as string, 'm2', 'm3', 'm4', 'm5'],
        });
        expect(out.matchReasons).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(out.missingItems).toEqual(['m1', 'm2', 'm3', 'm4']);
    });

    it('scoreCandidate leaves the application unscored on off-spec output (no 0% write)', () => {
        const s = read('lib/candidate-scorer.ts');
        expect(s).toContain('leaving application unscored');
        // The old collapse-to-zero expression must not come back.
        expect(s).not.toMatch(/typeof parsed\.score === 'number' \? parsed\.score : 0/);
    });
});

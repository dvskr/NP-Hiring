/**
 * Daily personalized job recommendations — Phase 1 Sprint 1.2.
 *
 * Per-candidate flow:
 *   1. Vector search → top-N jobs from candidate_embeddings.
 *   2. Filter out already-recommended-recently (30-day dedupe window).
 *   3. Hand off to `selectRecommendations()` (lib/ai/recommendation-selector)
 *      which applies:
 *        - Health filter   — drop likely-dead aggregator links.
 *        - License filter  — only jobs in candidate's licensed states OR remote.
 *        - Quota selection — guarantees Easy Apply + Direct Apply slots
 *                            so platform-revenue jobs always have visibility,
 *                            even when external scrapes score higher.
 *        - Diversity cap   — no employer hogs > ⌈totalSlots/3⌉ slots.
 *        - Tier-pinned ordering for display.
 *   4. Persist top-N as a new batch with tier per row.
 *
 * Selection policy is intentionally extracted so this cron and the local CLI
 * runner (scripts/run-recommendations.ts) cannot drift — both call the same
 * pure function.
 *
 * Cost: vector + DB only, no LLM calls. ~free at any scale we'll hit pre-PMF.
 */

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { semanticJobSearch, platformRevenueJobsWithSimilarity } from '@/lib/ai/vector-search';
import { selectRecommendations, type JobMeta } from '@/lib/ai/recommendation-selector';
import { isAiFeatureEnabled } from '@/lib/ai/feature-flags';
import { isoDateUtc } from '@/lib/utils/rotation';

const DEDUPE_WINDOW_DAYS = 30;
const VECTOR_OVERFETCH = 80; // headroom so quota + filters have choices
/** Hard cap on candidates per nightly run — logged loudly when hit (audit B97). */
const CANDIDATE_CAP = 5000;
/**
 * Candidates per step.run batch (audit B97). One step PER CANDIDATE meant
 * step count grew 1:1 with the candidate base — at the 5000-candidate cap
 * that's ~5000 steps, far past Inngest's ~1000-steps-per-run limit, so the
 * cron would hard-fail exactly when the board succeeds. 25 candidates per
 * step keeps the worst case at ~202 steps with per-chunk durability.
 */
const CHUNK_SIZE = 25;

function parseLicenseStates(raw: string | null): string[] {
    if (!raw) return [];
    return raw.split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{2}$/.test(s));
}

export const recommendationsDaily = inngest.createFunction(
    {
        id: 'recommendations-daily',
        name: 'Daily personalized job recommendations',
        triggers: [{ cron: 'TZ=UTC 0 9 * * *' }], // 09:00 UTC = ~1am Pacific.
        retries: 2,
        concurrency: 1,
    },
    async ({ step }) => {
        // Kill switch (audit F31): gate the COMPUTE, not just delivery. The
        // dashboard already hides recommendations behind this same flag, so
        // when it is off the nightly batch was pure wasted vector search +
        // DB writes for up to 5000 candidates — and the documented "killable
        // in <1 minute" promise didn't cover this cron at all.
        const flagEnabled = await step.run('check-feature-flag', async () =>
            isAiFeatureEnabled('ai.candidate.recommendations', { type: 'system', id: 'recommendations-daily' }),
        );
        if (!flagEnabled) {
            logger.info('recommendations.daily skipped: ai.candidate.recommendations flag disabled');
            return { batches: 0, skipped: 'feature_disabled' };
        }

        const embeddings = await step.run('list-candidate-embeddings', async () => {
            // role='job_seeker' (NOT 'candidate' — that's the architecture-doc
            // term, not the actual DB enum). license_states comes alongside
            // for the eligibility filter.
            return prisma.$queryRawUnsafe<Array<{ supabase_id: string; embedding_text: string; license_states: string | null }>>(`
                SELECT ce.supabase_id, ce.embedding::text AS embedding_text, up.license_states
                FROM candidate_embeddings ce
                JOIN user_profiles up ON up.supabase_id = ce.supabase_id
                WHERE up.profile_visible = true
                  AND up.deleted_at IS NULL
                  AND up.role = 'job_seeker'
                LIMIT ${CANDIDATE_CAP};
            `);
        });

        if (embeddings.length === 0) {
            logger.info('recommendations.daily: no eligible candidates');
            return { batches: 0 };
        }

        const capHit = embeddings.length >= CANDIDATE_CAP;
        if (capHit) {
            // Audit B97: the cap silently truncated the candidate base. Keep
            // the cap (cost guardrail) but make hitting it LOUD so growth
            // past it is a deliberate decision, not silent starvation.
            logger.warn('recommendations.daily: candidate cap hit — some eligible candidates will get no batch tonight', {
                cap: CANDIDATE_CAP,
            });
        }

        // Minted inside a step so the id is memoized: the function body
        // re-executes from the top after every step completion, and an
        // unmemoized crypto.randomUUID() would mint a DIFFERENT batchId per
        // replay, splitting one nightly run across many batch ids and
        // defeating the per-chunk idempotency guard below.
        const batchId = await step.run('mint-batch-id', async () =>
            `rec-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`,
        );
        const sinceDedupe = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        let written = 0;
        let failures = 0;
        const tierTally: Record<string, number> = { easy_apply: 0, direct_apply: 0, external: 0 };

        type EmbeddingRow = { supabase_id: string; embedding_text: string; license_states: string | null };

        /** Full per-candidate pipeline. Runs INSIDE a chunk step. */
        const recommendForCandidate = async (row: EmbeddingRow): Promise<Array<{ tier: string }>> => {
            const vec = row.embedding_text
                .replace(/^\[|\]$/g, '')
                .split(',')
                .map((n) => Number(n.trim()))
                .filter((n) => Number.isFinite(n));
            if (vec.length === 0) return [];

            // Idempotency guard: a chunk retry re-runs every candidate in
            // the chunk. Anyone already written under THIS batchId got their
            // picks on the previous attempt — skip instead of double-writing
            // (the dedupe window would otherwise hand them a second,
            // different set of jobs on the retry).
            const alreadyWritten = await prisma.candidateRecommendation.count({
                where: { supabaseId: row.supabase_id, batchId },
            });
            if (alreadyWritten > 0) return [];

            // Vector top-K UNION the full platform-revenue pool. The
            // pool guarantees the small set of employer + Easy Apply
            // jobs always reach the selector, even when vector rank
            // would otherwise bury them under aggregator scrapes.
            const [topK, platformPool] = await Promise.all([
                semanticJobSearch(vec, { k: VECTOR_OVERFETCH }),
                platformRevenueJobsWithSimilarity(vec),
            ]);
            const hitsByJobId = new Map<string, { jobId: string; similarity: number }>();
            for (const h of topK) hitsByJobId.set(h.jobId, h);
            for (const h of platformPool) hitsByJobId.set(h.jobId, h);
            const hits = [...hitsByJobId.values()];
            if (hits.length === 0) return [];

            const recentlyRecommended = await prisma.candidateRecommendation.findMany({
                where: { supabaseId: row.supabase_id, createdAt: { gte: sinceDedupe } },
                select: { jobId: true },
            });
            const exclude = new Set(recentlyRecommended.map((r) => r.jobId));

            // Click-feedback signal — employers the candidate clicked
            // through to in prior batches get a ranking boost so
            // demonstrated interest compounds. clickedAt is written by
            // POST /api/recommendations/click (audit B14/B88).
            const clicked = await prisma.candidateRecommendation.findMany({
                where: { supabaseId: row.supabase_id, clickedAt: { not: null } },
                select: { job: { select: { employer: true } } },
            });
            const clickedEmployers = new Set<string>(
                clicked.map((c) => c.job.employer).filter((e): e is string => !!e),
            );

            const jobRows = await prisma.job.findMany({
                where: { id: { in: hits.map((h) => h.jobId) } },
                select: {
                    id: true, employer: true, sourceType: true, applyOnPlatform: true,
                    applyLink: true, stateCode: true, isRemote: true,
                    healthConsecutiveMissing: true,
                    originalPostedAt: true, createdAt: true,
                },
            });
            const metaByJob = new Map<string, JobMeta>(jobRows.map((j) => [j.id, j]));

            // Per-candidate-per-day rotation seed — different seed each
            // day means a different subset of the live employer pool gets
            // pinned. Stable within the same day so a partial retry of
            // the cron lands on the same picks.
            const rotationSeed = `${row.supabase_id}-${isoDateUtc()}`;

            const picked = selectRecommendations(hits, metaByJob, {
                licensedStates: parseLicenseStates(row.license_states),
                excludeJobIds: exclude,
                clickedEmployers,
                rotationSeed,
            });
            if (picked.length === 0) return [];

            await prisma.$transaction(
                picked.map((rec, i) =>
                    prisma.candidateRecommendation.create({
                        data: {
                            supabaseId: row.supabase_id,
                            jobId: rec.jobId,
                            batchId,
                            rank: i + 1,
                            similarity: rec.similarity,
                            tier: rec.tier,
                        },
                    }),
                ),
            );
            return picked;
        };

        for (let i = 0; i < embeddings.length; i += CHUNK_SIZE) {
            const chunk = embeddings.slice(i, i + CHUNK_SIZE);
            // Chunk results are RETURNED from the step and merged outside it:
            // mutating outer accumulators inside step.run loses the updates
            // on replay (memoized steps don't re-execute).
            const chunkResult = await step.run(`recommend-batch-${i / CHUNK_SIZE}`, async () => {
                const local = {
                    written: 0,
                    failures: 0,
                    tierTally: { easy_apply: 0, direct_apply: 0, external: 0 } as Record<string, number>,
                };
                for (const row of chunk) {
                    try {
                        const picked = await recommendForCandidate(row);
                        for (const p of picked) {
                            local.tierTally[p.tier] = (local.tierTally[p.tier] ?? 0) + 1;
                        }
                        local.written += picked.length;
                    } catch (err) {
                        // One bad candidate must not fail (and retry) the
                        // whole chunk — count it and move on.
                        local.failures += 1;
                        logger.warn('recommendations.daily: candidate failed', {
                            supabaseId: row.supabase_id,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
                return local;
            });

            written += chunkResult.written;
            failures += chunkResult.failures;
            for (const [tier, count] of Object.entries(chunkResult.tierTally)) {
                tierTally[tier] = (tierTally[tier] ?? 0) + count;
            }
        }

        logger.info('recommendations.daily complete', { batchId, candidates: embeddings.length, written, failures, capHit, tierTally });
        return { batchId, candidates: embeddings.length, written, failures, capHit, tierTally };
    },
);

export const recommendationFunctions = [recommendationsDaily] as const;

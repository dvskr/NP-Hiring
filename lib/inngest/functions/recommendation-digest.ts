/**
 * Weekly recommendation digest — Sprint 1.2.3.
 *
 * Every Monday 09:00 UTC, walks every candidate who has:
 *   - At least one fresh recommendation in the latest batch (≤7 days old)
 *   - Opted in to email digests via `email_leads.newsletterOptIn`
 *   - The `ai.candidate.recommendations_email` flag enabled for them
 *
 * Sends a curated "5 new jobs match your profile" email containing the top
 * 5 recommendations (Easy Apply pinned first, same selector ordering as the
 * dashboard surface).
 *
 * Reuses `candidate_recommendations` so we never recompute — the daily recs
 * cron is the source of truth, this just emails what's already there.
 */

import { inngest } from '@/lib/inngest/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isAiFeatureEnabled } from '@/lib/ai/feature-flags';
import { sendAndLog } from '@/lib/email-service';
import { getBaseUrl } from '@/lib/env';
import {
    buildRecommendationDigestHtml,
    recommendationDigestHeadline,
    type RecommendationDigestJob,
} from '@/lib/email/recommendation-digest-template';

const DIGEST_TOP_N = 5;
const FRESH_BATCH_WINDOW_DAYS = 7;

interface CandidateForDigest {
    supabase_id: string;
    email: string;
    first_name: string | null;
    unsubscribe_token: string | null;
}

export const recommendationDigestWeekly = inngest.createFunction(
    {
        id: 'recommendation-digest-weekly',
        name: 'Weekly recommendation digest email',
        triggers: [{ cron: 'TZ=UTC 0 9 * * 1' }], // Mondays 09:00 UTC
        retries: 2,
        concurrency: 5,
    },
    async ({ step }) => {
        // Find candidates who:
        //   - have at least one rec in the past 7 days
        //   - have a known email, aren't suppressed (a bounce or complaint, and
        //     every opt-out: app/api/email/_lib/subscription.ts sets
        //     is_suppressed with is_subscribed) and aren't marked unsubscribed
        //     any other way (is_subscribed=false). sendAndLog has no opt-out
        //     gate of its own, so this query is what honours both.
        //   - have an email_leads row for the unsubscribe token
        //
        // NOTE: We deliberately do NOT require `newsletter_opt_in = true` here.
        // The AI digest is a separate opt-in (ai.candidate.recommendations_email
        // flag, toggleable from /settings) from the general newsletter. A user
        // can subscribe to the AI digest without subscribing to the newsletter,
        // and vice versa. The per-candidate flag check in the loop below is
        // the actual opt-in gate; this query just narrows to "has an email,
        // has recs, isn't suppressed."
        const candidates = await step.run('list-eligible-candidates', async () => {
            return prisma.$queryRawUnsafe<CandidateForDigest[]>(`
                SELECT DISTINCT up.supabase_id,
                       up.email,
                       up.first_name,
                       el.unsubscribe_token
                FROM user_profiles up
                JOIN candidate_recommendations cr ON cr.supabase_id = up.supabase_id
                JOIN email_leads el ON el.email = up.email
                WHERE cr.created_at >= NOW() - INTERVAL '${FRESH_BATCH_WINDOW_DAYS} days'
                  AND cr.dismissed_at IS NULL
                  AND el.is_suppressed = false
                  AND el.is_subscribed = true
                  AND up.deleted_at IS NULL
                  AND up.role = 'job_seeker'
                  AND up.email IS NOT NULL;
            `);
        });

        if (candidates.length === 0) {
            logger.info('recommendation-digest: no eligible candidates');
            return { sent: 0 };
        }

        let sent = 0;
        let skippedFlag = 0;
        let errored = 0;

        for (const cand of candidates) {
            await step.run(`digest-${cand.supabase_id}`, async () => {
                // Per-candidate flag check (admin can disable for individuals).
                const enabled = await isAiFeatureEnabled(
                    'ai.candidate.recommendations_email',
                    { type: 'candidate', id: cand.supabase_id },
                );
                if (!enabled) { skippedFlag += 1; return; }

                // Pull this candidate's latest batch — top N tier-pinned slots.
                const recs = await prisma.candidateRecommendation.findMany({
                    where: { supabaseId: cand.supabase_id, dismissedAt: null },
                    orderBy: [{ createdAt: 'desc' }, { rank: 'asc' }],
                    take: DIGEST_TOP_N,
                    include: {
                        job: {
                            select: {
                                id: true, title: true, slug: true, employer: true,
                                location: true, state: true, isRemote: true,
                                displaySalary: true,
                            },
                        },
                    },
                });
                if (recs.length === 0) return;

                const jobs: RecommendationDigestJob[] = recs.map((r) => ({
                    id: r.job.id,
                    title: r.job.title,
                    slug: r.job.slug,
                    employer: r.job.employer,
                    location: r.job.location,
                    state: r.job.state,
                    isRemote: r.job.isRemote,
                    displaySalary: r.job.displaySalary,
                    tier: r.tier as RecommendationDigestJob['tier'],
                }));

                const baseUrl = getBaseUrl();
                // The List-Unsubscribe target; the mail's own footer links
                // /unsubscribe and /email-preferences with the same token.
                const unsubscribeUrl = cand.unsubscribe_token
                    ? `${baseUrl}/email-preferences?token=${cand.unsubscribe_token}`
                    : `${baseUrl}/email-preferences`;

                const html = buildRecommendationDigestHtml({
                    firstName: cand.first_name,
                    jobs,
                    unsubscribeToken: cand.unsubscribe_token,
                    baseUrl,
                });

                try {
                    await sendAndLog(
                        {
                            from: '', // sendAndLog overrides with marketing sender
                            to: cand.email,
                            subject: recommendationDigestHeadline(jobs.length),
                            html,
                        },
                        'recommendation_digest',
                        { supabaseId: cand.supabase_id, recIds: recs.map((r) => r.id) },
                        unsubscribeUrl,
                    );
                    sent += 1;
                } catch (err) {
                    errored += 1;
                    logger.warn('recommendation-digest: send failed', { supabaseId: cand.supabase_id }, err);
                }
            });
        }

        logger.info('recommendation-digest complete', { eligible: candidates.length, sent, skippedFlag, errored });
        return { eligible: candidates.length, sent, skippedFlag, errored };
    },
);

export const recommendationDigestFunctions = [recommendationDigestWeekly] as const;

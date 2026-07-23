import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/audit-log';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { deleteFile, getPathFromUrl } from '@/lib/supabase-storage';
import { withCronTracking } from '@/lib/cron/track';
import { brand } from '@/config/brand';

export const maxDuration = 300; // 5 minutes — could be many users

/**
 * Daily cron: hard-delete UserProfile rows whose 30-day grace period
 * has lapsed (`purge_at <= now()`). Cascades through Prisma relations
 * (applications, messages, etc.), explicitly deletes the relation-less
 * orphan models (saved jobs, push subscriptions, job drafts, candidate
 * tags, email leads + job alerts), and removes the matching Supabase
 * Auth identity so the email can be re-registered.
 *
 * Bounded to 50 records per run so a backlog can't blow the function
 * timeout. Anything left over rolls into the next day's run.
 */
const BATCH_SIZE = 50;

// ─── B110: table-growth maintenance (piggybacks on this daily cron) ───

// Stripe stops retrying webhooks after ~3 days and Resend after hours;
// 90 days of processed-event ids is far more dedupe horizon than either
// will ever redeliver across. Without pruning, the table grows unbounded
// (it now also stores Resend webhook events).
const PROCESSED_EVENT_RETENTION_DAYS = 90;

/** How many months ahead job_health_checks partitions must exist. */
const PARTITION_HORIZON_MONTHS = 12;

/**
 * Prune processed_stripe_events rows past the retention window.
 * Non-fatal: a failed prune must never block the PII purge.
 */
async function pruneProcessedEvents(): Promise<number> {
    try {
        const cutoff = new Date(Date.now() - PROCESSED_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const result = await prisma.processedStripeEvent.deleteMany({
            where: { processedAt: { lt: cutoff } },
        });
        return result.count;
    } catch (err) {
        logger.error('purge-soft-deleted: failed to prune processed_stripe_events', err);
        return 0;
    }
}

/**
 * Idempotently ensure monthly job_health_checks partitions exist for the
 * next PARTITION_HORIZON_MONTHS. The 20260429 partition migration only
 * pre-created partitions through 2027-05 (extended to 2028-06 by the
 * 20260718 migration); without a rolling step, inserts would eventually
 * fall into the default catch-all partition and retention drops would
 * become impossible. CREATE TABLE IF NOT EXISTS makes re-runs no-ops.
 * Non-fatal: a failed DDL must never block the PII purge.
 */
async function ensureJobHealthCheckPartitions(): Promise<number> {
    let ensured = 0;
    const now = new Date();
    for (let offset = 0; offset <= PARTITION_HORIZON_MONTHS; offset++) {
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
        const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
        const suffix = `${from.getUTCFullYear()}_${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
        // Defense-in-depth for the raw DDL below — suffix is derived from
        // Date math only, but never interpolate anything unvalidated.
        if (!/^\d{4}_\d{2}$/.test(suffix)) continue;
        const fromLiteral = from.toISOString().slice(0, 10);
        const toLiteral = to.toISOString().slice(0, 10);
        try {
            await prisma.$executeRawUnsafe(
                `CREATE TABLE IF NOT EXISTS "job_health_checks_${suffix}" ` +
                `PARTITION OF "job_health_checks" ` +
                `FOR VALUES FROM ('${fromLiteral}') TO ('${toLiteral}')`,
            );
            ensured++;
        } catch (err) {
            logger.error('purge-soft-deleted: failed to ensure job_health_checks partition', err, { suffix });
        }
    }
    return ensured;
}

export async function GET(request: NextRequest) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    try {
        return await withCronTracking('purge-soft-deleted', async () => {
        // B110: table-growth maintenance first — cheap, idempotent, and it
        // must run even on days when no user purge is due.
        const stripeEventsPruned = await pruneProcessedEvents();
        const partitionsEnsured = await ensureJobHealthCheckPartitions();

        const due = await prisma.userProfile.findMany({
            where: {
                deletedAt: { not: null },
                purgeAt: { lte: new Date() },
            },
            // C3 fix (2026-06-01): we additionally need resumeUrl + avatarUrl
            // to wipe storage files, and supabaseId to drop the candidate
            // embedding + anonymize email_sends rows. The prior version only
            // pulled id/supabaseId/email and silently left PII on the side.
            select: { id: true, supabaseId: true, email: true, resumeUrl: true, avatarUrl: true },
            take: BATCH_SIZE,
            orderBy: { purgeAt: 'asc' },
        });

        if (due.length === 0) {
            return {
                response: NextResponse.json({
                    success: true,
                    purgedCount: 0,
                    stripeEventsPruned,
                    partitionsEnsured,
                }),
                metrics: { purgedCount: 0, failures: 0, stripeEventsPruned, partitionsEnsured },
            };
        }

        const adminSupabase = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        let purged = 0;
        const failures: Array<{ id: string; reason: string }> = [];

        for (const u of due) {
            try {
                // C3 fix (2026-06-01): full PII purge — privacy policy promises
                // erasure but the prior version left résumé files, candidate
                // embeddings, and email_sends rows behind. Now each lifecycle
                // step is loud-on-failure and survives partial damage so a
                // single missing file doesn't strand the rest of the user's PII.

                // Step 1: storage files (resume + avatar). Failures here are
                // logged but don't abort the row — better to drop the DB row
                // than to retain DB linkage to an undeletable file.
                if (u.resumeUrl) {
                    const path = getPathFromUrl(u.resumeUrl);
                    if (path) {
                        try {
                            await deleteFile(path, 'resume');
                        } catch (storageErr) {
                            logger.error('purge-soft-deleted: failed to delete resume file', storageErr, { userId: u.id, path });
                        }
                    }
                }
                if (u.avatarUrl) {
                    const path = getPathFromUrl(u.avatarUrl);
                    if (path) {
                        try {
                            await deleteFile(path, 'avatar');
                        } catch (storageErr) {
                            logger.error('purge-soft-deleted: failed to delete avatar file', storageErr, { userId: u.id, path });
                        }
                    }
                }

                // Step 2: candidate embedding (no FK to user; orphan-cleanable
                // but we should be explicit during a privacy purge).
                try {
                    await prisma.candidateEmbedding.delete({ where: { supabaseId: u.supabaseId } });
                } catch (embedErr) {
                    // P2025 = not found = nothing to delete. Anything else is loud.
                    const code = (embedErr as { code?: string } | null)?.code;
                    if (code !== 'P2025') {
                        logger.error('purge-soft-deleted: failed to delete candidate embedding', embedErr, { userId: u.id });
                    }
                }

                // Step 3: anonymize email_sends so downstream funnel queries
                // still work but the email address is gone. Bulk update —
                // these are append-only metric rows, not domain entities.
                try {
                    await prisma.emailSend.updateMany({
                        where: { to: u.email },
                        data: { to: `redacted+purged@${brand.domain.split('.')[0]}.invalid`, metadata: undefined },
                    });
                } catch (emailErr) {
                    logger.error('purge-soft-deleted: failed to anonymize email_sends', emailErr, { userId: u.id });
                }

                // Step 4 (F34 fix, 2026-07-18): explicit purge of models with
                // NO @relation/FK back to UserProfile — nothing cascades into
                // them when the profile row is dropped:
                //   - SavedJob.userId + PushSubscription.userId + JobDraft.userId
                //     hold the Supabase auth id (schema saved_jobs /
                //     push_subscriptions / job_drafts — relation-less)
                //   - CandidateTag.employerId holds UserProfile.id
                //   - EmailLead / JobAlert are keyed by the raw email address
                //     and are never touched by any cascade
                // Left behind, push subscriptions keep receiving broadcast
                // pushes after erasure, job_drafts keep contact PII in
                // formData, and email_leads/job_alerts keep the raw address.
                // One transaction with the profile delete: if any step fails
                // the profile row survives and the whole user is retried on
                // the next run instead of stranding ownerless PII forever.
                await prisma.$transaction([
                    prisma.savedJob.deleteMany({ where: { userId: u.supabaseId } }),
                    prisma.pushSubscription.deleteMany({ where: { userId: u.supabaseId } }),
                    prisma.jobDraft.deleteMany({
                        where: { OR: [{ userId: u.supabaseId }, { email: u.email }] },
                    }),
                    prisma.candidateTag.deleteMany({ where: { employerId: u.id } }),
                    // JobAlert has a required FK to EmailLead(email) with the
                    // default RESTRICT action — alerts must go before leads
                    // or the lead delete is rejected by Postgres.
                    prisma.jobAlert.deleteMany({ where: { email: u.email } }),
                    prisma.emailLead.deleteMany({ where: { email: u.email } }),
                    // Profile row last — Prisma cascades cover the remaining
                    // user-owned relations (applications, messages, etc.).
                    prisma.userProfile.delete({ where: { id: u.id } }),
                ]);

                // Step 5: drop the Supabase Auth identity so the email is reusable.
                await adminSupabase.auth.admin.deleteUser(u.supabaseId);

                await logAudit({
                    action: 'account.purge',
                    actorType: 'system',
                    targetType: 'user',
                    targetId: u.id,
                    metadata: {
                        email: u.email,
                        hadResume: u.resumeUrl != null,
                        hadAvatar: u.avatarUrl != null,
                    },
                });
                purged++;
            } catch (err) {
                failures.push({ id: u.id, reason: err instanceof Error ? err.message : 'unknown' });
                logger.error('purge-soft-deleted: failed to purge user', err, { userId: u.id });
            }
        }

        logger.info('purge-soft-deleted complete', { purged, failures: failures.length });

        return {
            response: NextResponse.json({
                success: true,
                purgedCount: purged,
                failures,
                stripeEventsPruned,
                partitionsEnsured,
                timestamp: new Date().toISOString(),
            }),
            metrics: {
                purgedCount: purged,
                failures: failures.length,
                stripeEventsPruned,
                partitionsEnsured,
            },
        };
        });
    } catch (err) {
        await sendCronFailureAlert('purge-soft-deleted', err);
        logger.error('Cron purge-soft-deleted error', err);
        return NextResponse.json({ error: 'Purge failed' }, { status: 500 });
    }
}

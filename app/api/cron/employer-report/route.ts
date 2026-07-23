import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPerformanceReportEmail, isEmailSuppressed } from '@/lib/email-service'
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';

export const maxDuration = 120 // 2 minutes — employer report emails

export async function GET(request: NextRequest) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    try {
        return await withCronTracking('employer-report', async () => {
        // Find all employers with active jobs
        const employerJobs = await prisma.employerJob.findMany({
            where: {
                job: {
                    isPublished: true,
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: new Date() } },
                    ],
                },
            },
            include: {
                job: {
                    select: {
                        title: true,
                        viewCount: true,
                        applyClickCount: true,
                    },
                },
            },
        })

        // Group by employer email
        const employerMap = new Map<string, {
            employerName: string
            dashboardToken: string
            jobs: Array<{ title: string; views: number; applyClicks: number; applications: number; dashboardToken: string }>
        }>()

        for (const ej of employerJobs) {
            const existing = employerMap.get(ej.contactEmail) || {
                employerName: ej.employerName,
                dashboardToken: ej.dashboardToken || ej.editToken,
                jobs: [],
            }

            // Count applications for this job
            const appCount = await prisma.jobApplication.count({
                where: { jobId: ej.jobId },
            }).catch(() => 0)

            existing.jobs.push({
                title: ej.job.title,
                views: ej.job.viewCount || 0,
                applyClicks: ej.job.applyClickCount || 0,
                applications: appCount,
                dashboardToken: ej.dashboardToken || ej.editToken,
            })

            employerMap.set(ej.contactEmail, existing)
        }

        let sentCount = 0
        const errors: string[] = []

        let skippedSuppressed = 0
        let skippedAlreadySent = 0

        // B68 idempotency: one report per employer per calendar month. The
        // EmailSend log (written by sendAndLog on every successful send) is
        // the marker — a rerun after a partial failure, a manual re-trigger,
        // or a duplicate cron invocation skips everyone already mailed this
        // month instead of double-sending to the entire employer base.
        // status='failed' rows don't count, so failed sends stay retryable.
        const monthStartUtc = new Date(Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            1,
        ))

        for (const [email, data] of employerMap) {
            // Only send if there's meaningful activity (at least 1 view)
            const totalViews = data.jobs.reduce((s, j) => s + j.views, 0)
            if (totalViews === 0) continue

            // The performance report goes out on the marketing sender, so the
            // suppression list applies: never mail bounced, complained, or
            // unsubscribed addresses (same E3 gate candidate alerts use).
            if (await isEmailSuppressed(email)) {
                skippedSuppressed++
                continue
            }

            try {
                const alreadySentThisMonth = await prisma.emailSend.findFirst({
                    where: {
                        to: email,
                        emailType: 'performance_report',
                        status: { not: 'failed' },
                        createdAt: { gte: monthStartUtc },
                    },
                    select: { id: true },
                })
                if (alreadySentThisMonth) {
                    skippedAlreadySent++
                    continue
                }
            } catch (dedupeErr) {
                // If the idempotency lookup itself fails, skip this employer
                // rather than risk a double-send — the next run retries.
                errors.push(`${email}: idempotency check failed: ${dedupeErr}`)
                continue
            }

            // Throttle: pause 1s before every 10th send (other than the
            // first batch). Previously the modulo check fired AFTER the
            // increment, so the first 10 sends went out without pause and
            // sends 11-20 paused twice. Net: provider rate-limit risk on
            // the first burst.
            if (sentCount > 0 && sentCount % 10 === 0) {
                await new Promise(r => setTimeout(r, 1000))
            }

            try {
                // sendPerformanceReportEmail swallows failures and returns
                // { success: false } — count and report those as errors
                // instead of treating every attempt as sent.
                const result = await sendPerformanceReportEmail(
                    email,
                    data.employerName,
                    data.jobs,
                    'Monthly'
                )
                if (result.success) {
                    sentCount++
                } else {
                    errors.push(`${email}: ${result.error ?? 'send failed'}`)
                }
            } catch (e) {
                errors.push(`${email}: ${e}`)
            }
        }

        return {
            response: NextResponse.json({
                success: true,
                employersFound: employerMap.size,
                reportsSent: sentCount,
                skippedSuppressed,
                skippedAlreadySent,
                errors,
                timestamp: new Date().toISOString(),
            }),
            metrics: {
                employersFound: employerMap.size,
                reportsSent: sentCount,
                skippedSuppressed,
                skippedAlreadySent,
                errorCount: errors.length,
            },
        };
        });
    } catch (error) {
        await sendCronFailureAlert('employer-report', error);
        console.error('Employer report cron error:', error)
        return NextResponse.json({ error: 'Employer report failed' }, { status: 500 })
    }
}

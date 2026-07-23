import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { EmployerJob, Job } from '@prisma/client'
import { sendExpiryWarningEmail, sendAndLog, getOrCreateUnsubToken, escapeHtml } from '@/lib/email-service'
import {
  emailShellV2, headerBlockV2, bodyTextV2, primaryButtonV2,
  spacerV2, closeContentV2, unsubscribeFooterV2, SANS, V2,
} from '@/lib/email-templates-v2'
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import { config } from '@/lib/config'
import { brand } from '@/config/brand'

export const maxDuration = 120 // 2 minutes — expiry warning emails

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl

// B87: how far back the post-expiry pass looks. Three days gives the daily
// cron slack for missed runs while keeping the "your listing just expired"
// email timely; the EmailSend dedup below makes re-scans idempotent.
const POST_EXPIRY_LOOKBACK_DAYS = 3

/**
 * B87 — "your listing has expired" notification. The funnel previously went
 * silent at expiry: a pre-expiry warning, then nothing — employers whose
 * warning landed in spam (or who meant to renew later) never learned their
 * listing was gone. Idempotent per job via the EmailSend metadata dedup in
 * the caller.
 */
async function sendPostExpiryEmail(
  job: Job,
  employerJob: EmployerJob,
): Promise<{ success: boolean; error?: string }> {
  try {
    const dashboardUrl = `${BASE_URL}/employer/dashboard/${employerJob.dashboardToken || employerJob.editToken}`
    const unsubToken = await getOrCreateUnsubToken(employerJob.contactEmail)
    // Only fully-paid rows can use the discounted renewal flow — free-quota
    // posts re-enter via the dashboard's own upgrade path.
    const canRenew = employerJob.paymentStatus === 'paid'
    const discountPct = Math.round((1 - config.renewalPrice / config.postingPrice) * 100)

    const html = emailShellV2(`
      ${headerBlockV2('Your Listing Has Expired', '')}
      ${spacerV2(12)}
      ${bodyTextV2(`Your posting for <strong>${escapeHtml(job.title)}</strong> has expired and is no longer visible to candidates. While it was live it collected <strong>${(job.viewCount || 0).toLocaleString()}</strong> views and <strong>${(job.applyClickCount || 0).toLocaleString()}</strong> apply clicks.`)}
      ${spacerV2(20)}
      <tr><td class="content-pad" style="padding:0 40px;">
        <div style="background:#FDF2F8;border:1px solid rgba(190,24,93,0.15);border-radius:12px;padding:16px 20px;">
          <p style="margin:0;font-family:${SANS};font-size:14px;color:${V2.textPrimary};line-height:1.6;">${
            canRenew
              ? `Renew for $${config.renewalPrice} (save ${discountPct}%) to relist it for another ${config.durationDays} days — your stats, applicants, and unlocked candidates carry over.`
              : `You can relist this role from your dashboard — your stats and applicants stay attached to the posting.`
          }</p>
        </div>
      </td></tr>
      ${spacerV2(24)}
      <tr><td class="content-pad" style="padding:0 40px;text-align:center;">
        ${primaryButtonV2(canRenew ? 'Renew Your Listing' : 'Go to Your Dashboard', dashboardUrl)}
      </td></tr>
      ${spacerV2(48)}
      ${closeContentV2()}`,
      unsubscribeFooterV2(unsubToken),
      `Your posting for ${job.title} has expired — reactivate it from your dashboard.`
    )

    await sendAndLog(
      {
        from: '', // overridden by sendAndLog (transactional sender)
        to: employerJob.contactEmail,
        subject: `Your job posting has expired — ${job.title}`,
        html,
      },
      'expiry_warning',
      // phase + jobId drive the per-job dedup query in the caller. The
      // pre-expiry warning shares this emailType but never writes these
      // keys, so the two passes can't collide.
      { phase: 'post_expiry', jobId: job.id, jobTitle: job.title },
      `${BASE_URL}/unsubscribe?token=${unsubToken}`,
    )
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send post-expiry email',
    }
  }
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authError = await verifyCronOrAdmin(request);
  if (authError) return authError;

  try {
    return await withCronTracking('expiry-warnings', async () => {
      const now = new Date()

      // Find jobs expiring within the next 5 days.
      // B87: the lower bound used to be +4 days, so a single missed cron run
      // meant a job sailed through the one-day [4d, 5d] window unwarned and
      // could never be warned again. Widening to [now, 5d] is idempotent-safe
      // — the expiryWarningSentAt dedup below guarantees at most one warning
      // per job no matter how often (or late) the sweep runs.
      const fiveDaysFromNow = new Date(now)
      fiveDaysFromNow.setDate(fiveDaysFromNow.getDate() + 5)

      const expiringJobs = await prisma.job.findMany({
        where: {
          isPublished: true,
          sourceType: 'employer',
          expiresAt: {
            gte: now,
            lte: fiveDaysFromNow,
          },
          // Only warn once per job (dedup via expiryWarningSentAt)
          employerJobs: {
            expiryWarningSentAt: null,
          },
        },
        include: {
          employerJobs: true,
        },
      })

      let sentCount = 0
      const errors: string[] = []

      for (const job of expiringJobs) {
        const employerJob = job.employerJobs
        if (employerJob?.contactEmail) {
          try {
            const result = await sendExpiryWarningEmail(
              employerJob.contactEmail,
              job.title,
              job.expiresAt!,
              job.viewCount || 0,
              job.applyClickCount || 0,
              employerJob.dashboardToken || employerJob.editToken,
              null // unsubscribeToken — sendExpiryWarningEmail will mint one if null
            )

            // sendExpiryWarningEmail swallows send failures and returns
            // { success: false } rather than throwing. Only stamp the dedup
            // marker after a real send — the selection query filters on
            // expiryWarningSentAt: null, so stamping a failed warning means it
            // is never retried and the employer never learns their paid listing
            // is expiring (killing the renewal funnel for that job).
            if (!result.success) {
              errors.push(`Job ${job.id}: ${result.error ?? 'send failed'}`)
              continue
            }
            sentCount++

            // Mark as warned (dedup)
            await prisma.employerJob.update({
              where: { id: employerJob.id },
              data: { expiryWarningSentAt: new Date() },
            })
          } catch (e) {
            errors.push(`Job ${job.id}: ${e}`)
            console.error(`Failed to send expiry warning for job ${job.id}:`, e)
          }
        }
      }

      // ── B87: post-expiry pass ─────────────────────────────────────────
      // Jobs whose expiresAt fell inside the lookback window get a one-time
      // "your listing has expired" email. Dedup is per-job via the EmailSend
      // metadata written by sendPostExpiryEmail (no schema change — the
      // EmployerJob dedup column belongs to the pre-expiry warning).
      const lookbackStart = new Date(now.getTime() - POST_EXPIRY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      const recentlyExpiredJobs = await prisma.job.findMany({
        where: {
          sourceType: 'employer',
          archivedAt: null,
          expiresAt: {
            gte: lookbackStart,
            lt: now,
          },
          employerJobs: {
            // Never-published checkouts ('pending'/'expired') have nothing
            // to mourn; refunded rows were pulled deliberately.
            paymentStatus: { in: ['free', 'free_renewed', 'free_upgraded', 'paid'] },
          },
        },
        include: {
          employerJobs: true,
        },
      })

      let postExpirySent = 0
      for (const job of recentlyExpiredJobs) {
        const employerJob = job.employerJobs
        if (!employerJob?.contactEmail) continue
        try {
          const alreadySent = await prisma.emailSend.findFirst({
            where: {
              emailType: 'expiry_warning',
              // sendAndLog also writes status='failed' rows carrying the same
              // metadata — those must NOT dedup-block the retry.
              status: { not: 'failed' },
              AND: [
                { metadata: { path: ['phase'], equals: 'post_expiry' } },
                { metadata: { path: ['jobId'], equals: job.id } },
              ],
            },
            select: { id: true },
          })
          if (alreadySent) continue

          const result = await sendPostExpiryEmail(job, employerJob)
          if (!result.success) {
            errors.push(`Post-expiry ${job.id}: ${result.error ?? 'send failed'}`)
            continue
          }
          postExpirySent++
        } catch (e) {
          errors.push(`Post-expiry ${job.id}: ${e}`)
          console.error(`Failed to send post-expiry notification for job ${job.id}:`, e)
        }
      }

      return {
        response: NextResponse.json({
          success: true,
          warningsSent: sentCount,
          postExpirySent,
          errors,
          timestamp: new Date().toISOString(),
        }),
        metrics: {
          candidates: expiringJobs.length,
          warningsSent: sentCount,
          postExpiryCandidates: recentlyExpiredJobs.length,
          postExpirySent,
          errors: errors.length,
        },
      }
    })
  } catch (error) {
      await sendCronFailureAlert('expiry-warnings', error);
    console.error('Cron expiry-warnings error:', error)
    return NextResponse.json({ error: 'Expiry warnings failed' }, { status: 500 })
  }
}

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
import { getPaidPostingStatus } from '@/lib/env'
import { logger } from '@/lib/logger'
import { getPlanSlotStatus } from '@/lib/employer-plan'
import { nextNewPostPrice, renewalSavingsLabel, resolveRenewalOffer, type RenewalOffer } from '@/lib/pricing'

export const maxDuration = 120 // 2 minutes — expiry warning emails

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl

// B87: how far back the post-expiry pass looks. Three days gives the daily
// cron slack for missed runs while keeping the "your listing just expired"
// email timely; the EmailSend dedup below makes re-scans idempotent.
const POST_EXPIRY_LOOKBACK_DAYS = 3

// Rows that can buy the per-post renewal (config.renewalPrice), and only
// while paid posting is on (see RenewalContext). 'plan' rows are
// deliberately excluded: each plan post runs config.durationDays and its
// slot frees when it ends, so the employer posts again into that slot
// instead of renewing (the renewal checkout 409s them). Legacy free-quota
// rows re-enter via the dashboard's own path (unchanged).
const RENEWABLE_STATUSES = new Set(['promo', 'paid'])

// Statuses whose expiry is worth an email at all — everything that was
// actually published. Never-published checkouts ('pending'/'expired') have
// nothing to mourn; refunded rows were pulled deliberately.
const NOTIFIABLE_STATUSES = ['free', 'free_renewed', 'free_upgraded', 'promo', 'plan', 'paid']

/**
 * What one cron run knows about selling renewals. `purchasable` is read once
 * per run from the same check behind /api/create-checkout/availability: while
 * paid posting is off the renewal checkout answers 503, so no email may offer
 * a renewal. Next-post prices are cached per (quota domain, employer) because
 * one employer often has several posts expiring together.
 */
interface RenewalContext {
  purchasable: boolean
  now: Date
  nextPostPrices: Map<string, number | null>
}

function readRenewalPurchasable(): boolean {
  try {
    return getPaidPostingStatus().available
  } catch (error) {
    // Fail closed: an unreadable flag must never put a renewal the checkout
    // may refuse into an employer's inbox.
    logger.error('expiry-warnings: paid posting status unreadable, renewal offers withheld', error)
    return false
  }
}

/**
 * The employer's own next new-post price (0 with a free plan slot), so the
 * savings claim is measured against what this reader would actually pay.
 * Null (the email then compares with the standard post price and says so)
 * when the row has no quota domain or the lookup fails.
 */
async function nextPostPriceFor(employerJob: EmployerJob, ctx: RenewalContext): Promise<number | null> {
  const key = `${employerJob.quotaDomain ?? ''}|${employerJob.userId ?? ''}`
  if (ctx.nextPostPrices.has(key)) return ctx.nextPostPrices.get(key) ?? null
  let price: number | null = null
  try {
    const hasPlanSlot = employerJob.userId
      ? (await getPlanSlotStatus(employerJob.userId, ctx.now)).canPost
      : false
    price = await nextNewPostPrice({ quotaDomain: employerJob.quotaDomain, hasPlanSlot, now: ctx.now })
  } catch (error) {
    logger.warn('expiry-warnings: next post price lookup failed, comparing with the standard post price', {
      employerJobId: employerJob.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  ctx.nextPostPrices.set(key, price)
  return price
}

/** Renewal inputs for one row: purchasable only for renewable rows while paid posting is on. */
async function renewalInputsFor(
  employerJob: EmployerJob,
  ctx: RenewalContext,
): Promise<{ purchasable: boolean; nextPostPrice: number | null }> {
  const purchasable = ctx.purchasable && RENEWABLE_STATUSES.has(employerJob.paymentStatus)
  // No saving is claimed during the promo, so the price lookup is skipped.
  if (!purchasable || config.isPromoActive(ctx.now)) return { purchasable, nextPostPrice: null }
  return { purchasable, nextPostPrice: await nextPostPriceFor(employerJob, ctx) }
}

/** The post-expiry email's offer paragraph and button, true to what the employer can do now. */
function postExpiryOffer(
  employerJob: EmployerJob,
  offer: RenewalOffer,
  dashboardUrl: string,
): { line: string; ctaLabel: string; ctaUrl: string } {
  if (offer.purchasable) {
    const saving = offer.savings ? ` (${renewalSavingsLabel(offer.savings)})` : ''
    const promoAlternative = offer.promoActive
      ? ` Or post this role again as a fresh listing, free through ${config.promoEndsLabel}.`
      : ''
    // apply-renewal.ts only moves the end date (from the renewal date for an
    // expired post, capped at config.renewalCapDays after creation).
    return {
      line: `Renew for $${offer.price}${saving} to relist it for another ${config.durationDays} days. Your stats, applicants and unlocked candidates carry over; a renewal does not add unlocks or InMails. Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.${promoAlternative}`,
      ctaLabel: 'Renew Your Listing',
      ctaUrl: dashboardUrl,
    }
  }
  if (employerJob.paymentStatus === 'plan') {
    return {
      line: `Each plan post runs ${config.durationDays} days, so this one has ended and its slot is free again. Post a job into it at no extra charge while you're subscribed. Your stats and applicants stay attached to this posting.`,
      ctaLabel: 'Go to Your Dashboard',
      ctaUrl: dashboardUrl,
    }
  }
  if (offer.promoActive) {
    return {
      line: `Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge. Your stats and applicants stay attached to the expired posting.`,
      ctaLabel: 'Post a New Job for Free',
      ctaUrl: `${BASE_URL}/post-job`,
    }
  }
  return {
    line: 'Your stats and applicants stay attached to the expired posting in your dashboard.',
    ctaLabel: 'Go to Your Dashboard',
    ctaUrl: dashboardUrl,
  }
}

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
  ctx: RenewalContext,
): Promise<{ success: boolean; error?: string }> {
  try {
    const dashboardUrl = `${BASE_URL}/employer/dashboard/${employerJob.dashboardToken || employerJob.editToken}`
    const unsubToken = await getOrCreateUnsubToken(employerJob.contactEmail)
    const inputs = await renewalInputsFor(employerJob, ctx)
    const offer = resolveRenewalOffer({ ...inputs, now: ctx.now })
    const { line: relistLine, ctaLabel, ctaUrl } = postExpiryOffer(employerJob, offer, dashboardUrl)

    const html = emailShellV2(`
      ${headerBlockV2('Your Listing Has Expired', '')}
      ${spacerV2(12)}
      ${bodyTextV2(`Your posting for <strong>${escapeHtml(job.title)}</strong> has expired and is no longer visible to candidates. While it was live it collected <strong>${(job.viewCount || 0).toLocaleString()}</strong> views and <strong>${(job.applyClickCount || 0).toLocaleString()}</strong> apply clicks.`)}
      ${spacerV2(20)}
      <tr><td class="content-pad" style="padding:0 40px;">
        <div style="background:#FDF2F8;border:1px solid rgba(190,24,93,0.15);border-radius:12px;padding:16px 20px;">
          <p style="margin:0;font-family:${SANS};font-size:14px;color:${V2.textPrimary};line-height:1.6;">${relistLine}</p>
        </div>
      </td></tr>
      ${spacerV2(24)}
      <tr><td class="content-pad" style="padding:0 40px;text-align:center;">
        ${primaryButtonV2(ctaLabel, ctaUrl)}
      </td></tr>
      ${spacerV2(48)}
      ${closeContentV2()}`,
      unsubscribeFooterV2(unsubToken),
      `Your posting for ${job.title} has expired. See what you can do next.`
    )

    await sendAndLog(
      {
        from: '', // overridden by sendAndLog (transactional sender)
        to: employerJob.contactEmail,
        subject: `Your job posting has expired: ${job.title}`,
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
      const renewalCtx: RenewalContext = {
        purchasable: readRenewalPurchasable(),
        now,
        nextPostPrices: new Map(),
      }

      for (const job of expiringJobs) {
        const employerJob = job.employerJobs
        if (employerJob?.contactEmail) {
          try {
            const renewal = await renewalInputsFor(employerJob, renewalCtx)
            const result = await sendExpiryWarningEmail(
              employerJob.contactEmail,
              job.title,
              job.expiresAt!,
              job.viewCount || 0,
              job.applyClickCount || 0,
              employerJob.dashboardToken || employerJob.editToken,
              null, // unsubscribeToken — sendExpiryWarningEmail will mint one if null
              // paymentStatus drops the renewal for 'plan' rows (each runs
              // config.durationDays, then its slot is free); the renewal is
              // offered only while it can be bought, with a saving named only
              // when it is true against this employer's next new post.
              {
                paymentStatus: employerJob.paymentStatus,
                renewalPurchasable: renewal.purchasable,
                nextPostPrice: renewal.nextPostPrice,
                now,
              },
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
            // See NOTIFIABLE_STATUSES — published rows only.
            paymentStatus: { in: NOTIFIABLE_STATUSES },
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

          const result = await sendPostExpiryEmail(job, employerJob, renewalCtx)
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

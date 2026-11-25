/**
 * /admin/social-kit
 *
 * Ready-to-paste LinkedIn, Facebook, Reddit, X and forum posts for every
 * live paid employer job, each with its own tracked short link. Built from
 * the database on every load, so it is current whenever it is opened: a new
 * paid post appears as soon as it goes live and a closed one drops out.
 * "Paid" is lib/social-kit/load.ts SOCIAL_KIT_PAYMENT_STATUSES.
 *
 * Auth: app/admin/layout.tsx's requireAdmin(), and again here, because a
 * client navigation between admin pages renders this page without
 * re-running the shared layout.
 */
import type { Metadata } from 'next'
import { brand } from '@/config/brand'
import { requireAdmin } from '@/lib/auth/protect'
import { loadSocialKitClicks, loadSocialKitJobs, loadSocialPostLogs } from '@/lib/social-kit/load'
import { buildSocialKitEntry } from '@/lib/social-kit/posts'
import SocialKitClient from './SocialKitClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Social Kit | Admin',
  robots: { index: false, follow: false },
}

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl).replace(/\/$/, '')

export default async function SocialKitPage() {
  await requireAdmin('/admin/social-kit')
  const now = new Date()
  const [jobs, clicks] = await Promise.all([loadSocialKitJobs(now), loadSocialKitClicks()])
  const tracker = await loadSocialPostLogs(jobs.map((job) => job.id))
  const entries = jobs.map((job) => buildSocialKitEntry(job, BASE_URL, now))
  return (
    <SocialKitClient
      entries={entries}
      clicks={clicks.counts}
      clicksAvailable={clicks.available}
      logs={tracker.logs}
      trackerAvailable={tracker.available}
      generatedAt={now.toISOString()}
    />
  )
}

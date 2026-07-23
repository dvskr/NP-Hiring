/**
 * Coverage staleness probe for the aggregate-pseo cron (F7 fix).
 *
 * Downstream consumers (app/api/sitemaps/cities/[batch], the sitemap index,
 * index-pseo, and the state-page link mesh) drop category-city PseoStats
 * rows whose updatedAt is older than 36h. This probe measures the oldest
 * category-city row after each scheduled run and alerts Discord when the
 * rotation is falling behind that window — i.e. the cursor/chain machinery
 * is broken and long-tail cities are dropping out of the sitemaps again.
 */
import { prisma } from '@/lib/prisma'
import { sendDiscordMessage } from '@/lib/discord-notifier'

/** Must stay in sync with PSEO_STALENESS_HOURS in the sitemap routes. */
const PSEO_STALENESS_HOURS = 36
const MS_PER_HOUR = 60 * 60 * 1000

export interface StalenessReport {
    totalRows: number
    staleRows: number
    maxStalenessHours: number
    alerted: boolean
}

/**
 * Probe category-city row staleness and alert when the oldest row exceeds
 * the 36h sitemap window. Returns the report for the cron metrics, or null
 * when the probe itself fails — it must never fail the cron.
 *
 * In healthy steady state (chain completes a full rotation per scheduled
 * run) the oldest row is ~6-8h old and no alert fires. Called only from
 * chainDepth=0 entry runs, so chain links can't spam the channel (max 4
 * alerts/day).
 */
export async function checkCategoryCityStaleness(
    cursorPosition: number,
    totalCities: number,
): Promise<StalenessReport | null> {
    try {
        const threshold = new Date(Date.now() - PSEO_STALENESS_HOURS * MS_PER_HOUR)
        const [oldest, staleRows, totalRows] = await Promise.all([
            prisma.pseoStats.aggregate({
                where: { type: 'category-city' },
                _min: { updatedAt: true },
            }),
            prisma.pseoStats.count({
                where: { type: 'category-city', updatedAt: { lt: threshold } },
            }),
            prisma.pseoStats.count({ where: { type: 'category-city' } }),
        ])

        const oldestAt = oldest._min.updatedAt
        const maxStalenessHours = oldestAt
            ? Math.round((Date.now() - oldestAt.getTime()) / MS_PER_HOUR)
            : 0

        let alerted = false
        if (oldestAt && oldestAt < threshold) {
            alerted = await sendDiscordMessage('', [
                {
                    title: `⚠️ aggregate-pseo staleness exceeds ${PSEO_STALENESS_HOURS}h window`,
                    description:
                        `${staleRows.toLocaleString()}/${totalRows.toLocaleString()} category-city rows older than ${PSEO_STALENESS_HOURS}h` +
                        ` · oldest ${maxStalenessHours}h · cursor ${cursorPosition}/${totalCities} cities`,
                    color: 0xffaa00,
                },
            ])
        }

        return { totalRows, staleRows, maxStalenessHours, alerted }
    } catch (error) {
        console.error('[pseo-agg] Staleness probe failed:', error)
        return null
    }
}

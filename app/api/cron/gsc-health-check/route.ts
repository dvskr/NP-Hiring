import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyCronOrAdmin } from '@/lib/auth/verify-cron-or-admin';
import { sendCronFailureAlert, sendDiscordMessage } from '@/lib/discord-notifier';
import { withCronTracking } from '@/lib/cron/track';
import {
    getGscConfig,
    getGscAccessToken,
    fetchSearchAnalyticsAggregate,
    fetchSearchAnalyticsByDimension,
    fetchSitemapsList,
    buildSitemapAlerts,
    GSC_DIMENSION_ROW_LIMIT,
    type GscDimensionRow,
    type GscSitemapEntry,
    type SearchAnalyticsAggregate,
} from '@/lib/gsc-client';

export const maxDuration = 60;

/**
 * P4.2 + P1 gsc-ops: daily GSC snapshot, regression alert, sitemap status.
 *
 * What it does:
 *   1. Pulls Search Analytics aggregates (yesterday vs 7 days ago) →
 *      `raw.searchAnalytics`, alerts on week-over-week regressions:
 *        - clicks drop > 20% week-over-week
 *        - impressions drop > 15% week-over-week
 *   2. Pulls the top GSC_DIMENSION_ROW_LIMIT query and page dimension rows
 *      for two 7-day windows (current: yesterday-6…yesterday; previous: the
 *      7 days before) → `raw.dimensions`. The admin dashboard computes
 *      week-over-week "top movers" from this via lib/gsc-movers.ts. Depth
 *      matters for correctness there: both windows are top-N-by-clicks, so
 *      a shallow cut makes rank churn look like traffic appearing and
 *      vanishing. See the constant's doc comment in lib/gsc-client.ts.
 *   3. Pulls per-sitemap submission status via sitemaps.list (same
 *      webmasters.readonly scope) → `raw.sitemaps`, and alerts to Discord
 *      when Google reports errors on any submitted sitemap.
 *
 * Steps 2 and 3 degrade independently: a dimension or sitemaps failure is
 * recorded in metrics but never blocks the core snapshot (step 1).
 *
 * A run that read nothing writes no row (register 2.30): no Search Analytics
 * row for either day, no query or page rows and no sitemaps. It logs once and
 * alerts Discord once per such streak (again on the next run if the alert was
 * not delivered). Before, it saved a row of zeros every day. A day Search Console answers no row for (yesterday
 * usually: its data lags about two days behind the 09:30 UTC run) is reported
 * as not read, never as zero traffic, and the drop alerts compare only two
 * days it answered for (tests/api/gsc-health-check-snapshot.test.ts).
 *
 * NOTE: the GSC coverage BREAKDOWN (crawled-not-indexed etc.) has no public
 * API — that still comes from UI bulk exports (seed-deindex-queue.ts).
 * Renderable/indexable coverage in admin/seo-health is computed from our
 * own pseoStats instead (lib/gsc-coverage.ts). So the coverage columns of
 * gsc_snapshots (indexedTotal and the rest) are never written and keep their
 * default 0 on every row; dropping them or filling them from an export is
 * decision B40.
 *
 * Auth required:
 *   GSC_SERVICE_ACCOUNT_KEY env var = JSON-stringified service account JSON
 *      (or falls back to GOOGLE_INDEXING_CREDENTIALS — same service account
 *      JSON, different OAuth scope at token-exchange time. The service
 *      account must also be added as a "Restricted" user in GSC →
 *      Settings → Users and permissions → with the property selected.)
 *   GSC_SITE_URL env var = "sc-domain:<brand.domain>" or a URL-prefix
 *                          property like "https://<brand.domain>/"
 *                          (defaults to "sc-domain:<brand.domain>" if not set)
 *
 * If env vars are missing, the cron logs and exits 200 (skipped, not failed)
 * so missing setup doesn't trigger noise.
 *
 * Schedule: 30 9 * * * (09:30 UTC, after Google's overnight index processing).
 */
export async function GET(request: NextRequest) {
    const authError = await verifyCronOrAdmin(request);
    if (authError) return authError;

    const startTime = Date.now();

    try {
        return await withCronTracking(CRON_NAME, async () => {
        // Record the skip as a real (skipped) run so cron_runs shows the cron is
        // firing — an unconfigured GSC key shouldn't make it look like it never ran.
        const config = getGscConfig();
        if (!config) {
            console.log('[CRON:gsc-health-check] Skipped — neither GSC_SERVICE_ACCOUNT_KEY nor GOOGLE_INDEXING_CREDENTIALS configured.');
            return {
                response: NextResponse.json({
                    success: true,
                    skipped: true,
                    reason: 'no service account key configured',
                    timestamp: new Date().toISOString(),
                }),
                metrics: { skipped: true },
            };
        }

        const accessToken = await getGscAccessToken(config.keyJson);
        const { siteUrl } = config;

        // ── 1. Aggregate snapshot (yesterday is the latest fully-processed day)
        const yesterday = isoDate(daysAgo(1));
        const last7DaysAgo = isoDate(daysAgo(7));

        // null: Search Console answered no row for that day (not processed
        // yet, or no impressions), which is not a day of zero traffic.
        const todayRow = await fetchSearchAnalyticsAggregate(accessToken, siteUrl, yesterday, yesterday);
        const weekAgoRow = await fetchSearchAnalyticsAggregate(accessToken, siteUrl, last7DaysAgo, last7DaysAgo);

        // ── 2. Dimension windows for week-over-week movers (best-effort).
        // current: yesterday-6 … yesterday; previous: the 7 days before that.
        const window = { startDate: isoDate(daysAgo(7)), endDate: yesterday };
        const prevWindow = { startDate: isoDate(daysAgo(14)), endDate: isoDate(daysAgo(8)) };

        let dimensions: {
            window: typeof window;
            prevWindow: typeof prevWindow;
            queries: { current: GscDimensionRow[]; previous: GscDimensionRow[] };
            pages: { current: GscDimensionRow[]; previous: GscDimensionRow[] };
        } | null = null;
        let dimensionError: string | null = null;
        try {
            // Depth is passed explicitly (not left to the client default)
            // because movers math reads absence from a window as a signal —
            // a shallow cut turns ordinary rank churn into phantom movers.
            const rowLimit = GSC_DIMENSION_ROW_LIMIT;
            const [queriesCurrent, queriesPrevious, pagesCurrent, pagesPrevious] = await Promise.all([
                fetchSearchAnalyticsByDimension(accessToken, siteUrl, { ...window, dimension: 'query', rowLimit }),
                fetchSearchAnalyticsByDimension(accessToken, siteUrl, { ...prevWindow, dimension: 'query', rowLimit }),
                fetchSearchAnalyticsByDimension(accessToken, siteUrl, { ...window, dimension: 'page', rowLimit }),
                fetchSearchAnalyticsByDimension(accessToken, siteUrl, { ...prevWindow, dimension: 'page', rowLimit }),
            ]);
            dimensions = {
                window,
                prevWindow,
                queries: { current: queriesCurrent, previous: queriesPrevious },
                pages: { current: pagesCurrent, previous: pagesPrevious },
            };
        } catch (err) {
            dimensionError = err instanceof Error ? err.message : String(err);
            console.error('[CRON:gsc-health-check] Dimension fetch failed (snapshot continues):', err);
        }

        // ── 3. Per-sitemap submission status (best-effort).
        let sitemaps: GscSitemapEntry[] | null = null;
        let sitemapError: string | null = null;
        let sitemapAlerts: string[] = [];
        try {
            sitemaps = await fetchSitemapsList(accessToken, siteUrl);
            sitemapAlerts = buildSitemapAlerts(sitemaps);
        } catch (err) {
            sitemapError = err instanceof Error ? err.message : String(err);
            console.error('[CRON:gsc-health-check] Sitemaps list failed (snapshot continues):', err);
        }

        const readErrors = {
            ...(dimensionError ? { dimensionError } : {}),
            ...(sitemapError ? { sitemapError } : {}),
        };

        // Nothing read, nothing written (register 2.30): a row here would be
        // zeros Search Console never reported.
        if (!readAnything({ todayRow, weekAgoRow, dimensions, sitemaps })) {
            const message =
                `Search Console returned no Search Analytics row for ${yesterday} or ${last7DaysAgo}, ` +
                `no query or page rows and no sitemaps, so no snapshot was written for ${yesterday}.`;
            console.warn(`[CRON:gsc-health-check] ${message}`);
            const { alertSent, streakAlerted } = await alertNoDataOnce(message, readErrors);
            return {
                response: NextResponse.json({
                    success: true,
                    skipped: true,
                    reason: NO_DATA_REASON,
                    capturedOn: yesterday,
                    message,
                    alertSent,
                    ...readErrors,
                    duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
                    timestamp: new Date().toISOString(),
                }),
                metrics: { snapshotSkipped: true, reason: NO_DATA_REASON, capturedOn: yesterday, alertSent, streakAlerted, ...readErrors },
            };
        }

        // Persist a snapshot row. Stringify+parse to coerce the typed
        // payload into Prisma's structural InputJsonValue.
        const rawPayload = JSON.parse(
            JSON.stringify({
                searchAnalytics: { today: todayRow, weekAgo: weekAgoRow },
                ...(dimensions ? { dimensions } : {}),
                ...(sitemaps ? { sitemaps } : {}),
            })
        );
        await prisma.gscSnapshot.upsert({
            where: { capturedOn: new Date(yesterday) },
            update: { raw: rawPayload },
            create: { capturedOn: new Date(yesterday), raw: rawPayload },
        });

        // Regression detection, only between two days Search Console answered
        // for: a day it has not processed yet is not a drop to zero.
        const alerts: string[] = [];
        if (todayRow && weekAgoRow) {
            const todayClicks = todayRow.clicks;
            const todayImpressions = todayRow.impressions;
            const weekAgoClicks = weekAgoRow.clicks;
            const weekAgoImpressions = weekAgoRow.impressions;
            if (weekAgoClicks > 0) {
                const clickDelta = (todayClicks - weekAgoClicks) / weekAgoClicks;
                if (clickDelta < -0.20) {
                    alerts.push(`📉 GSC clicks dropped ${(clickDelta * 100).toFixed(1)}% week-over-week (${weekAgoClicks} → ${todayClicks})`);
                }
            }
            if (weekAgoImpressions > 0) {
                const imprDelta = (todayImpressions - weekAgoImpressions) / weekAgoImpressions;
                if (imprDelta < -0.15) {
                    alerts.push(`📉 GSC impressions dropped ${(imprDelta * 100).toFixed(1)}% week-over-week (${weekAgoImpressions} → ${todayImpressions})`);
                }
            }
        }

        if (alerts.length > 0) {
            await sendDiscordMessage('', [
                {
                    title: '⚠ GSC Health Check — Regression Detected',
                    description: alerts.join('\n'),
                    color: 0xFFAA00,
                    timestamp: new Date().toISOString(),
                },
            ]);
        }

        // Sitemap errors get their own (red) embed — a broken sitemap on a
        // 165K-URL surface is an incident, not a trend.
        if (sitemapAlerts.length > 0) {
            await sendDiscordMessage('', [
                {
                    title: '🚨 GSC Health Check — Sitemap Errors',
                    description: sitemapAlerts.join('\n').slice(0, 1900),
                    color: 0xFF0000,
                    timestamp: new Date().toISOString(),
                },
            ]);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        return {
            response: NextResponse.json({
                success: true,
                // null: not read (see readAnything), never a reported zero.
                today: todayRow ? { clicks: todayRow.clicks, impressions: todayRow.impressions } : null,
                weekAgo: weekAgoRow ? { clicks: weekAgoRow.clicks, impressions: weekAgoRow.impressions } : null,
                alerts,
                sitemaps: sitemaps
                    ? {
                        count: sitemaps.length,
                        errors: sitemaps.reduce((sum, s) => sum + s.errors, 0),
                        warnings: sitemaps.reduce((sum, s) => sum + s.warnings, 0),
                        pending: sitemaps.filter((s) => s.isPending).length,
                    }
                    : null,
                sitemapAlerts,
                dimensionsCaptured: dimensions !== null,
                ...readErrors,
                duration: `${duration}s`,
                timestamp: new Date().toISOString(),
            }),
            metrics: {
                todayRead: todayRow !== null,
                weekAgoRead: weekAgoRow !== null,
                todayClicks: todayRow?.clicks ?? null,
                todayImpressions: todayRow?.impressions ?? null,
                weekAgoClicks: weekAgoRow?.clicks ?? null,
                weekAgoImpressions: weekAgoRow?.impressions ?? null,
                alertCount: alerts.length,
                sitemapCount: sitemaps?.length ?? 0,
                sitemapErrorCount: sitemaps?.reduce((sum, s) => sum + s.errors, 0) ?? 0,
                sitemapAlertCount: sitemapAlerts.length,
                queryRows: dimensions?.queries.current.length ?? 0,
                pageRows: dimensions?.pages.current.length ?? 0,
                ...readErrors,
            },
        };
        });
    } catch (error) {
        await sendCronFailureAlert(CRON_NAME, error);
        console.error('[CRON:gsc-health-check] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'GSC health check failed',
                details: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString(),
            },
            { status: 500 }
        );
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** cron_runs.name for this cron. */
const CRON_NAME = 'gsc-health-check';

/** The reason a run that read nothing records, in its answer and its metrics. */
const NO_DATA_REASON = 'no data';

interface SnapshotReads {
    todayRow: SearchAnalyticsAggregate | null;
    weekAgoRow: SearchAnalyticsAggregate | null;
    dimensions: {
        queries: { current: GscDimensionRow[]; previous: GscDimensionRow[] };
        pages: { current: GscDimensionRow[]; previous: GscDimensionRow[] };
    } | null;
    sitemaps: GscSitemapEntry[] | null;
}

/** True when Search Console answered something worth storing. */
function readAnything({ todayRow, weekAgoRow, dimensions, sitemaps }: SnapshotReads): boolean {
    if (todayRow !== null || weekAgoRow !== null) return true;
    const dimensionRows = dimensions
        ? [dimensions.queries.current, dimensions.queries.previous, dimensions.pages.current, dimensions.pages.previous]
        : [];
    if (dimensionRows.some((rows) => rows.length > 0)) return true;
    return (sitemaps?.length ?? 0) > 0;
}

/**
 * True when stored run metrics are those of a run that read nothing, in a
 * streak whose alert was delivered (by that run or an earlier one).
 */
function streakAlreadyAlerted(metrics: unknown): boolean {
    if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) return false;
    const stored = metrics as Record<string, unknown>;
    return stored.snapshotSkipped === true && stored.streakAlerted === true;
}

/**
 * Alert Discord once per no-data streak. The newest successful run before
 * this one (withCronTracking's row for this run is not marked successful yet)
 * says whether the streak's alert was already delivered; each skipped run
 * carries that forward as streakAlerted, so an alert that was not delivered is
 * tried again on the next run. A failed read alerts anyway: a second alert
 * costs less than a silent outage.
 */
async function alertNoDataOnce(
    message: string,
    readErrors: { dimensionError?: string; sitemapError?: string },
): Promise<{ alertSent: boolean; streakAlerted: boolean }> {
    try {
        const last = await prisma.cronRun.findFirst({
            where: { name: CRON_NAME, success: true },
            orderBy: { startedAt: 'desc' },
            select: { metrics: true },
        });
        if (streakAlreadyAlerted(last?.metrics)) return { alertSent: false, streakAlerted: true };
    } catch (err) {
        console.error('[CRON:gsc-health-check] Could not read the previous run, alerting anyway:', err);
    }
    const lines = [
        message,
        ...(readErrors.dimensionError ? [`Query and page rows failed: ${readErrors.dimensionError}`] : []),
        ...(readErrors.sitemapError ? [`Sitemaps failed: ${readErrors.sitemapError}`] : []),
        'Later runs log this until Search Console answers again.',
    ];
    const sent = await sendDiscordMessage('', [
        {
            title: 'GSC Health Check: no data, snapshot not written',
            description: lines.join('\n').slice(0, 1900),
            color: 0xFFAA00,
            timestamp: new Date().toISOString(),
        },
    ]);
    return { alertSent: sent, streakAlerted: sent };
}

function daysAgo(n: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d;
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

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
 * NOTE: the GSC coverage BREAKDOWN (crawled-not-indexed etc.) has no public
 * API — that still comes from UI bulk exports (seed-deindex-queue.ts).
 * Renderable/indexable coverage in admin/seo-health is computed from our
 * own pseoStats instead (lib/gsc-coverage.ts).
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
        return await withCronTracking('gsc-health-check', async () => {
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

        const todayRow = await fetchSearchAnalyticsAggregate(accessToken, siteUrl, yesterday, yesterday);
        const weekAgoRow = await fetchSearchAnalyticsAggregate(accessToken, siteUrl, last7DaysAgo, last7DaysAgo);

        const todayClicks = todayRow?.clicks ?? 0;
        const todayImpressions = todayRow?.impressions ?? 0;
        const weekAgoClicks = weekAgoRow?.clicks ?? 0;
        const weekAgoImpressions = weekAgoRow?.impressions ?? 0;

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

        // Regression detection.
        const alerts: string[] = [];
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
                today: { clicks: todayClicks, impressions: todayImpressions },
                weekAgo: { clicks: weekAgoClicks, impressions: weekAgoImpressions },
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
                ...(dimensionError ? { dimensionError } : {}),
                ...(sitemapError ? { sitemapError } : {}),
                duration: `${duration}s`,
                timestamp: new Date().toISOString(),
            }),
            metrics: {
                todayClicks,
                todayImpressions,
                weekAgoClicks,
                weekAgoImpressions,
                alertCount: alerts.length,
                sitemapCount: sitemaps?.length ?? 0,
                sitemapErrorCount: sitemaps?.reduce((sum, s) => sum + s.errors, 0) ?? 0,
                sitemapAlertCount: sitemapAlerts.length,
                queryRows: dimensions?.queries.current.length ?? 0,
                pageRows: dimensions?.pages.current.length ?? 0,
                ...(dimensionError ? { dimensionError } : {}),
                ...(sitemapError ? { sitemapError } : {}),
            },
        };
        });
    } catch (error) {
        await sendCronFailureAlert('gsc-health-check', error);
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

function daysAgo(n: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d;
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

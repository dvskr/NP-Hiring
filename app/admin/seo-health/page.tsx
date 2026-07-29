/**
 * P4 + P1 gsc-ops: SEO health dashboard.
 *
 * Single-page admin view that surfaces every monitoring signal we built
 * during the GSC indexing crisis remediation:
 *   1. GSC snapshot trail (clicks/impressions over time, regression flag)
 *   2. Per-sitemap submission status (sitemaps.list via gsc-health-check)
 *   3. Week-over-week top movers by query/page (from snapshot dimensions)
 *   4. pSEO coverage — renderable vs indexable per category (pure DB math)
 *   5. Cron runs — last execution per cron + recent run history
 *   6. Deindex queue burn-down (P2.1 progress)
 *   7. Layer 2 snippet review queue (P3.4)
 *
 * Server component — pulls everything in one round-trip via prisma.
 */
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { CITIES } from '@/lib/pseo/city-data/cities';
import { GSC_DIMENSION_ROW_LIMIT, type GscSitemapEntry } from '@/lib/gsc-client';
import { extractSnapshotDimensions, computeMovers, type Movers, type SnapshotDimensions } from '@/lib/gsc-movers';
import { computeCategoryCityCoverage, computeSettingStateCoverage } from '@/lib/gsc-coverage';
import { MIN_JOBS_FOR_CATEGORY_CITY } from '@/lib/pseo/render-gate';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

interface SearchAnalyticsRow {
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
}

function asAnalytics(value: unknown): SearchAnalyticsRow {
    if (!value || typeof value !== 'object') return {};
    return value as SearchAnalyticsRow;
}

/**
 * Stored `raw.sitemaps` was serialized from GscSitemapEntry[] by the cron —
 * re-validate the shape instead of trusting persisted JSON blindly.
 */
function asStoredSitemaps(raw: unknown): GscSitemapEntry[] {
    if (!raw || typeof raw !== 'object') return [];
    const list = (raw as { sitemaps?: unknown }).sitemaps;
    if (!Array.isArray(list)) return [];
    return list
        .filter((e): e is GscSitemapEntry => Boolean(e) && typeof e === 'object' && typeof (e as GscSitemapEntry).path === 'string')
        .map((e) => ({
            path: e.path,
            lastSubmitted: typeof e.lastSubmitted === 'string' ? e.lastSubmitted : null,
            lastDownloaded: typeof e.lastDownloaded === 'string' ? e.lastDownloaded : null,
            isPending: e.isPending === true,
            isSitemapsIndex: e.isSitemapsIndex === true,
            errors: typeof e.errors === 'number' ? e.errors : 0,
            warnings: typeof e.warnings === 'number' ? e.warnings : 0,
            submittedUrls: typeof e.submittedUrls === 'number' ? e.submittedUrls : 0,
        }));
}

/** Strip the origin from page-dimension URLs so tables stay readable. */
function stripOrigin(url: string): string {
    return url.replace(/^https?:\/\/[^/]+/, '') || '/';
}

/**
 * Movers cells. A null side means the key fell outside GSC's top-N-by-clicks
 * cut for that window, so we genuinely don't know its number — say so rather
 * than printing a 0 that reads as "this query got no traffic".
 */
function formatMoverClicks(prevClicks: number | null, clicks: number | null): string {
    const side = (v: number | null) => (v === null ? 'unranked' : v.toLocaleString('en-US'));
    return `${side(prevClicks)} → ${side(clicks)}`;
}

/**
 * Deltas measured against a truncated window are bounds, not figures: a gain
 * of at least 42 renders "≥ +42", a loss of at least 42 renders "≤ -42".
 */
function formatMoverDelta(delta: number, estimated: boolean): string {
    const signed = `${delta >= 0 ? '+' : ''}${delta.toLocaleString('en-US')}`;
    return estimated ? `${delta >= 0 ? '≥' : '≤'} ${signed}` : signed;
}

/**
 * Per-panel caveat, shown only when that panel's counterpart window was
 * actually cut short. A rising row is absent from the PRIOR window; a falling
 * row is absent from the CURRENT one — so each table cites its own floor.
 * Floor 0 means the window reached the zero-click tail and its deltas are exact.
 */
function moversFootnote(movers: Movers | null | undefined, isFalling: boolean): string | null {
    if (!movers) return null;
    const floor = isFalling ? movers.currentFloor : movers.previousFloor;
    if (floor === 0) return null;
    const which = isFalling ? 'current' : 'prior';
    return `The ${which} window cut off at ${floor.toLocaleString('en-US')} clicks — rows past that cut show as “unranked” with a bounded delta, not a zero.`;
}

function formatGscDate(value: string | null): string {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return formatRelativeTime(parsed);
}

async function getData() {
    const [
        snapshots,
        recentCronRuns,
        cronSummary,
        queueByStatus,
        queueBySource,
        queueAttempts,
        snippetCity,
        snippetCategoryCity,
        recentSnippets,
        categoryCityTotals,
        renderableCategoryCityRows,
        settingStateRows,
    ] = await Promise.all([
        prisma.gscSnapshot.findMany({
            orderBy: { capturedOn: 'desc' },
            take: 14,
        }),
        prisma.cronRun.findMany({
            orderBy: { startedAt: 'desc' },
            take: 25,
        }),
        prisma.cronRun.groupBy({
            by: ['name'],
            _count: { _all: true },
            _max: { startedAt: true },
            orderBy: { _max: { startedAt: 'desc' } },
        }),
        prisma.deindexQueue.groupBy({
            by: ['status'],
            _count: { _all: true },
        }),
        prisma.deindexQueue.groupBy({
            by: ['source'],
            _count: { _all: true },
            orderBy: { _count: { source: 'desc' } },
            take: 10,
        }),
        prisma.deindexQueue.aggregate({
            _avg: { attempt: true },
            _max: { attempt: true },
        }),
        prisma.citySnippet.groupBy({
            by: ['sourceModel'],
            _count: { _all: true },
        }),
        prisma.categoryCitySnippet.groupBy({
            by: ['sourceModel'],
            _count: { _all: true },
        }),
        prisma.citySnippet.findMany({
            orderBy: { generatedAt: 'desc' },
            take: 10,
            select: { citySlug: true, sourceModel: true, generatedAt: true, approvedAt: true },
        }),
        // Coverage panel (P1 gsc-ops): full combo count per category is a
        // cheap groupBy; the renderable subset (totalJobs ≥ render gate) is
        // fetched pre-filtered so we never load the full ~165K-row surface.
        prisma.pseoStats.groupBy({
            by: ['categorySlug'],
            where: { type: 'category-city' },
            _count: { _all: true },
        }),
        prisma.pseoStats.findMany({
            where: { type: 'category-city', totalJobs: { gte: MIN_JOBS_FOR_CATEGORY_CITY } },
            select: { categorySlug: true, locationSlug: true, totalJobs: true, updatedAt: true },
        }),
        prisma.pseoStats.findMany({
            where: { type: 'setting-state' },
            select: { totalJobs: true, updatedAt: true },
        }),
    ]);

    const pendingApproval = await prisma.citySnippet.count({ where: { approvedAt: null } })
        + await prisma.categoryCitySnippet.count({ where: { approvedAt: null } });
    const approvedTotal = await prisma.citySnippet.count({ where: { approvedAt: { not: null } } })
        + await prisma.categoryCitySnippet.count({ where: { approvedAt: { not: null } } });

    // ── Coverage (pure math over the pre-filtered rows) ──────────────────
    const categoryCityCoverage = computeCategoryCityCoverage({
        totalsByCategory: new Map(categoryCityTotals.map((r) => [r.categorySlug, r._count._all])),
        renderableRows: renderableCategoryCityRows,
        populationBySlug: new Map(CITIES.map((c) => [c.slug, c.population])),
    });
    const settingStateCoverage = computeSettingStateCoverage(settingStateRows);

    // ── Sitemap status + movers from the newest snapshot carrying them ──
    const latestSitemaps = snapshots
        .map((s) => ({ capturedOn: s.capturedOn, entries: asStoredSitemaps(s.raw) }))
        .find((s) => s.entries.length > 0) ?? null;

    let latestDimensions: { capturedOn: Date; dims: SnapshotDimensions } | null = null;
    for (const s of snapshots) {
        const dims = extractSnapshotDimensions(s.raw);
        if (dims) {
            latestDimensions = { capturedOn: s.capturedOn, dims };
            break;
        }
    }
    const queryMovers: Movers | null = latestDimensions?.dims.queries
        ? computeMovers(latestDimensions.dims.queries.current, latestDimensions.dims.queries.previous)
        : null;
    const pageMovers: Movers | null = latestDimensions?.dims.pages
        ? computeMovers(latestDimensions.dims.pages.current, latestDimensions.dims.pages.previous)
        : null;
    // Rows the row-limit cut leaves genuinely undecidable across both
    // dimensions — disclosed rather than silently dropped.
    const indeterminateMovers = (queryMovers?.indeterminate ?? 0) + (pageMovers?.indeterminate ?? 0);

    return {
        snapshots,
        recentCronRuns,
        cronSummary,
        queueByStatus,
        queueBySource,
        queueAttempts,
        snippetCity,
        snippetCategoryCity,
        recentSnippets,
        pendingApproval,
        approvedTotal,
        categoryCityCoverage,
        settingStateCoverage,
        latestSitemaps,
        latestDimensions,
        queryMovers,
        pageMovers,
        indeterminateMovers,
    };
}

function formatRelativeTime(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const days = Math.floor(hr / 24);
    return `${days}d ago`;
}

function deltaPct(today: number, weekAgo: number): { pct: number; color: string; arrow: string } {
    if (weekAgo === 0) return { pct: 0, color: '#7A6A62', arrow: '—' };
    const pct = ((today - weekAgo) / weekAgo) * 100;
    return {
        pct,
        color: pct >= 0 ? '#10B981' : pct < -15 ? '#EF4444' : '#F59E0B',
        arrow: pct >= 0 ? '▲' : '▼',
    };
}

const card: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '16px',
    border: '1px solid rgba(0,0,0,0.06)',
    padding: '20px 24px',
    boxShadow: '4px 4px 12px rgba(0,0,0,0.04)',
    marginBottom: '20px',
};

const h2: React.CSSProperties = {
    fontSize: '15px',
    fontWeight: 700,
    color: '#1A2E35',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const td: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: '1px solid rgba(0,0,0,0.05)',
    fontSize: '13px',
    color: '#1A2E35',
};

const th: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: '11px',
    fontWeight: 700,
    color: '#7A6A62',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'left',
    borderBottom: '2px solid rgba(0,0,0,0.08)',
    background: '#FAFAFA',
};

export default async function SeoHealthPage() {
    const data = await getData();

    // Compute today vs week-ago from latest 2 snapshots that have searchAnalytics
    const latest = data.snapshots[0];
    const todaySa = latest ? asAnalytics((latest.raw as { searchAnalytics?: { today?: unknown } } | null)?.searchAnalytics?.today) : {};
    const wkAgoSa = latest ? asAnalytics((latest.raw as { searchAnalytics?: { weekAgo?: unknown } } | null)?.searchAnalytics?.weekAgo) : {};
    const clicksDelta = deltaPct(todaySa.clicks ?? 0, wkAgoSa.clicks ?? 0);
    const imprDelta = deltaPct(todaySa.impressions ?? 0, wkAgoSa.impressions ?? 0);

    const queueByStatusMap = new Map(data.queueByStatus.map((r) => [r.status, r._count._all]));
    const queueTotal = Array.from(queueByStatusMap.values()).reduce((a, b) => a + b, 0);
    const queueDone = (queueByStatusMap.get('submitted') ?? 0) + (queueByStatusMap.get('live') ?? 0);
    const queuePct = queueTotal > 0 ? Math.round((queueDone / queueTotal) * 100) : 0;

    return (
        <div style={{ padding: '32px', maxWidth: '1280px', margin: '0 auto', background: '#FDFBF7', minHeight: '100vh' }}>
            <div style={{ marginBottom: '24px' }}>
                <h1 className="font-lora" style={{ fontSize: '28px', fontWeight: 700, color: '#1A2E35', marginBottom: '4px' }}>
                    SEO Health
                </h1>
                <p style={{ fontSize: '13px', color: '#7A6A62' }}>
                    Live signals from the GSC remediation crons. Refreshed every 60 seconds.
                </p>
            </div>

            {/* External link bar */}
            <div style={{ ...card, padding: '14px 20px', display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '13px' }}>
                <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" style={{ color: '#BE185D', textDecoration: 'none', fontWeight: 600 }}>
                    ↗ Google Search Console
                </a>
                <a href="https://search.google.com/search-console/removals" target="_blank" rel="noreferrer" style={{ color: '#BE185D', textDecoration: 'none', fontWeight: 600 }}>
                    ↗ GSC Removals UI
                </a>
                <Link href="/admin/cron" style={{ color: '#BE185D', textDecoration: 'none', fontWeight: 600 }}>
                    ↗ Cron Triggers
                </Link>
            </div>

            {/* ─── 1. GSC SNAPSHOTS ─────────────────────────────────────────── */}
            <div style={card}>
                <h2 style={h2}>1. Search Console — last 14 days</h2>
                {data.snapshots.length === 0 ? (
                    <p style={{ fontSize: '13px', color: '#7A6A62' }}>
                        No snapshots yet. The <code>/api/cron/gsc-health-check</code> cron runs daily at
                        09:30 UTC. If it&apos;s been &gt;24h since deploy, check the cron is firing in Vercel
                        and that <code>GOOGLE_INDEXING_CREDENTIALS</code> + the service-account email is
                        added to GSC → Settings → Users with read access.
                    </p>
                ) : (
                    <>
                        {/* KPI strip */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                            <div>
                                <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clicks (yesterday)</div>
                                <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A2E35' }}>{(todaySa.clicks ?? 0).toLocaleString('en-US')}</div>
                                <div style={{ fontSize: '12px', color: clicksDelta.color, fontWeight: 600 }}>
                                    {clicksDelta.arrow} {Math.abs(clicksDelta.pct).toFixed(1)}% vs 7d ago
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Impressions (yesterday)</div>
                                <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A2E35' }}>{(todaySa.impressions ?? 0).toLocaleString('en-US')}</div>
                                <div style={{ fontSize: '12px', color: imprDelta.color, fontWeight: 600 }}>
                                    {imprDelta.arrow} {Math.abs(imprDelta.pct).toFixed(1)}% vs 7d ago
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CTR</div>
                                <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A2E35' }}>{((todaySa.ctr ?? 0) * 100).toFixed(2)}%</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg Position</div>
                                <div style={{ fontSize: '24px', fontWeight: 700, color: '#1A2E35' }}>{(todaySa.position ?? 0).toFixed(1)}</div>
                            </div>
                        </div>

                        {/* History table */}
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th style={th}>Date</th>
                                    <th style={th}>Clicks</th>
                                    <th style={th}>Impressions</th>
                                    <th style={th}>CTR</th>
                                    <th style={th}>Position</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.snapshots.map((s) => {
                                    const sa = asAnalytics((s.raw as { searchAnalytics?: { today?: unknown } } | null)?.searchAnalytics?.today);
                                    return (
                                        <tr key={s.id}>
                                            <td style={td}>{s.capturedOn.toISOString().slice(0, 10)}</td>
                                            <td style={td}>{(sa.clicks ?? 0).toLocaleString('en-US')}</td>
                                            <td style={td}>{(sa.impressions ?? 0).toLocaleString('en-US')}</td>
                                            <td style={td}>{((sa.ctr ?? 0) * 100).toFixed(2)}%</td>
                                            <td style={td}>{(sa.position ?? 0).toFixed(1)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </>
                )}
            </div>

            {/* ─── 2. SITEMAP SUBMISSION STATUS ─────────────────────────────── */}
            <div style={card}>
                <h2 style={h2}>2. Sitemap submission status</h2>
                {!data.latestSitemaps ? (
                    <p style={{ fontSize: '13px', color: '#7A6A62' }}>
                        No sitemap status captured yet. The <code>gsc-health-check</code> cron pulls{' '}
                        <code>sitemaps.list</code> on each run (same read-only GSC credentials) and
                        alerts Discord when Google reports sitemap errors. Data appears after the
                        next run with GSC credentials configured.
                    </p>
                ) : (
                    <>
                        <div style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '8px' }}>
                            As of {data.latestSitemaps.capturedOn.toISOString().slice(0, 10)} —{' '}
                            {data.latestSitemaps.entries.length} sitemap{data.latestSitemaps.entries.length === 1 ? '' : 's'} submitted.
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th style={th}>Sitemap</th>
                                    <th style={th}>URLs submitted</th>
                                    <th style={th}>Errors</th>
                                    <th style={th}>Warnings</th>
                                    <th style={th}>Last submitted</th>
                                    <th style={th}>Last downloaded</th>
                                    <th style={th}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.latestSitemaps.entries.map((s) => (
                                    <tr key={s.path}>
                                        <td style={{ ...td, fontFamily: 'monospace', fontSize: '11px', maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {stripOrigin(s.path)}{s.isSitemapsIndex ? ' (index)' : ''}
                                        </td>
                                        <td style={td}>{s.submittedUrls.toLocaleString('en-US')}</td>
                                        <td style={{ ...td, color: s.errors > 0 ? '#EF4444' : '#10B981', fontWeight: 600 }}>{s.errors}</td>
                                        <td style={{ ...td, color: s.warnings > 0 ? '#F59E0B' : '#7A6A62' }}>{s.warnings}</td>
                                        <td style={td}>{formatGscDate(s.lastSubmitted)}</td>
                                        <td style={td}>{formatGscDate(s.lastDownloaded)}</td>
                                        <td style={{ ...td, color: s.errors > 0 ? '#EF4444' : s.isPending ? '#F59E0B' : '#10B981', fontWeight: 600 }}>
                                            {s.errors > 0 ? '✗ errors' : s.isPending ? '○ pending' : '✓ ok'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}
            </div>

            {/* ─── 3. TOP MOVERS (WoW) ──────────────────────────────────────── */}
            <div style={card}>
                <h2 style={h2}>3. Top movers — 7 days vs prior 7 days</h2>
                {!data.latestDimensions ? (
                    <p style={{ fontSize: '13px', color: '#7A6A62' }}>
                        No query/page dimension data captured yet. The <code>gsc-health-check</code>{' '}
                        cron records the top {GSC_DIMENSION_ROW_LIMIT.toLocaleString('en-US')} queries and pages
                        for two 7-day windows on each run; movers appear after its next run with GSC
                        credentials configured.
                    </p>
                ) : (
                    <>
                        <div style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '12px' }}>
                            Window: {data.latestDimensions.dims.window?.startDate ?? '—'} → {data.latestDimensions.dims.window?.endDate ?? '—'}{' '}
                            vs {data.latestDimensions.dims.prevWindow?.startDate ?? '—'} → {data.latestDimensions.dims.prevWindow?.endDate ?? '—'}.
                            Ranked by click delta. Each window is GSC&apos;s top{' '}
                            {GSC_DIMENSION_ROW_LIMIT.toLocaleString('en-US')} rows by clicks, so a key can leave one
                            window by crossing that cut rather than by losing traffic — those rows read{' '}
                            <em>unranked</em> with a bounded (≥ / ≤) delta instead of a fabricated 0.
                            {data.indeterminateMovers > 0 && (
                                <> {data.indeterminateMovers.toLocaleString('en-US')} row
                                    {data.indeterminateMovers === 1 ? ' is' : 's are'} omitted entirely because the
                                    cut leaves their direction unknowable.</>
                            )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
                            {([
                                ['Queries — rising', data.queryMovers?.gainers ?? [], false, data.queryMovers, false],
                                ['Queries — falling', data.queryMovers?.losers ?? [], false, data.queryMovers, true],
                                ['Pages — rising', data.pageMovers?.gainers ?? [], true, data.pageMovers, false],
                                ['Pages — falling', data.pageMovers?.losers ?? [], true, data.pageMovers, true],
                            ] as const).map(([label, rows, isPage, movers, isFalling]) => {
                                const footnote = moversFootnote(movers, isFalling);
                                return (
                                <div key={label}>
                                    <div style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '8px', fontWeight: 600 }}>{label}</div>
                                    {rows.length === 0 ? (
                                        <p style={{ fontSize: '12px', color: '#7A6A62' }}>No movement recorded.</p>
                                    ) : (
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                            <thead>
                                                <tr>
                                                    <th style={th}>{isPage ? 'Page' : 'Query'}</th>
                                                    <th style={th}>Clicks</th>
                                                    <th style={th}>Δ clicks</th>
                                                    <th style={th}>Δ impr.</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((r) => (
                                                    <tr key={r.key}>
                                                        <td style={{ ...td, fontFamily: isPage ? 'monospace' : undefined, fontSize: isPage ? '11px' : '13px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {isPage ? stripOrigin(r.key) : r.key}
                                                        </td>
                                                        <td style={{ ...td, fontStyle: r.estimated ? 'italic' : undefined }}>
                                                            {formatMoverClicks(r.prevClicks, r.clicks)}
                                                        </td>
                                                        <td style={{ ...td, color: r.clicksDelta >= 0 ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                                                            {formatMoverDelta(r.clicksDelta, r.estimated)}
                                                        </td>
                                                        <td style={{ ...td, color: r.impressionsDelta === null ? '#7A6A62' : r.impressionsDelta >= 0 ? '#10B981' : '#EF4444' }}>
                                                            {r.impressionsDelta === null ? '—' : formatMoverDelta(r.impressionsDelta, false)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                    {footnote && (
                                        <p style={{ fontSize: '11px', color: '#7A6A62', marginTop: '6px', lineHeight: 1.5 }}>
                                            {footnote}
                                        </p>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {/* ─── 4. pSEO COVERAGE ─────────────────────────────────────────── */}
            <div style={card}>
                <h2 style={h2}>4. pSEO coverage — renderable vs indexable</h2>
                <p style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '12px' }}>
                    Computed from <code>pseoStats</code> + the render/sitemap gates (no GSC API —
                    Google&apos;s coverage breakdown has no public API). <strong>Renderable</strong> =
                    category×city combos passing the render gate (≥{MIN_JOBS_FOR_CATEGORY_CITY} jobs, page serves 200).{' '}
                    <strong>Indexable</strong> = renderable combos the sitemap advertises (fresh stats,
                    state-eligible category, city population floor). A wide gap means we publish pages
                    the sitemap never tells Google about.
                </p>
                {data.categoryCityCoverage.categories.length === 0 && data.settingStateCoverage.total === 0 ? (
                    <p style={{ fontSize: '13px', color: '#7A6A62' }}>
                        No <code>pseoStats</code> rows yet — the <code>aggregate-pseo</code> cron
                        populates them.
                    </p>
                ) : (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                            <div style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>Category×city combos</div>
                                <div style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>{data.categoryCityCoverage.totals.total.toLocaleString('en-US')}</div>
                            </div>
                            <div style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>Renderable</div>
                                <div style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>{data.categoryCityCoverage.totals.renderable.toLocaleString('en-US')}</div>
                            </div>
                            <div style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>Indexable (in sitemap)</div>
                                <div style={{ fontSize: '20px', fontWeight: 700, color: '#10B981' }}>{data.categoryCityCoverage.totals.indexable.toLocaleString('en-US')}</div>
                            </div>
                            <div style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>Setting×state (render / index)</div>
                                <div style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>
                                    {data.settingStateCoverage.renderable.toLocaleString('en-US')} / {data.settingStateCoverage.indexable.toLocaleString('en-US')}
                                </div>
                            </div>
                        </div>

                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th style={th}>Category</th>
                                    <th style={th}>Combos</th>
                                    <th style={th}>Renderable</th>
                                    <th style={th}>Indexable</th>
                                    <th style={th}>Indexable %</th>
                                    <th style={th}>Sitemap-eligible</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.categoryCityCoverage.categories.map((c) => {
                                    const pct = c.renderable > 0 ? Math.round((c.indexable / c.renderable) * 100) : 0;
                                    return (
                                        <tr key={c.categorySlug}>
                                            <td style={td}><code>{c.categorySlug}</code></td>
                                            <td style={td}>{c.total.toLocaleString('en-US')}</td>
                                            <td style={td}>{c.renderable.toLocaleString('en-US')}</td>
                                            <td style={td}>{c.indexable.toLocaleString('en-US')}</td>
                                            <td style={{ ...td, color: !c.sitemapEligible ? '#7A6A62' : pct >= 80 ? '#10B981' : pct >= 40 ? '#F59E0B' : '#EF4444', fontWeight: 600 }}>
                                                {c.renderable > 0 ? `${pct}%` : '—'}
                                            </td>
                                            <td style={{ ...td, color: c.sitemapEligible ? '#10B981' : '#7A6A62' }}>
                                                {c.sitemapEligible ? '✓' : '— state-ineligible'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </>
                )}
            </div>

            {/* ─── 5. CRON RUNS ─────────────────────────────────────────────── */}
            <div style={card}>
                <h2 style={h2}>5. Cron run log</h2>
                {data.cronSummary.length === 0 ? (
                    <p style={{ fontSize: '13px', color: '#7A6A62' }}>
                        No cron runs tracked yet. Crons opt into tracking via{' '}
                        <code>withCronTracking()</code> in <code>lib/cron/track.ts</code>. The
                        <code> historical-deindex</code> and <code>gsc-health-check</code> crons will
                        populate this table after their next run.
                    </p>
                ) : (
                    <>
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '8px' }}>Last run per cron:</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr>
                                        <th style={th}>Cron</th>
                                        <th style={th}>Last run</th>
                                        <th style={th}>Total runs</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.cronSummary.map((r) => (
                                        <tr key={r.name}>
                                            <td style={td}><code>{r.name}</code></td>
                                            <td style={td}>{r._max.startedAt ? formatRelativeTime(r._max.startedAt) : '—'}</td>
                                            <td style={td}>{r._count._all}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '8px' }}>Last 25 invocations:</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th style={th}>Cron</th>
                                    <th style={th}>Started</th>
                                    <th style={th}>Status</th>
                                    <th style={th}>Duration</th>
                                    <th style={th}>Metrics / Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentCronRuns.map((r) => (
                                    <tr key={r.id}>
                                        <td style={td}><code>{r.name}</code></td>
                                        <td style={td}>{formatRelativeTime(r.startedAt)}</td>
                                        <td style={{ ...td, color: r.success ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                                            {r.success ? '✓ ok' : '✗ failed'}
                                        </td>
                                        <td style={td}>{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                                        <td style={{ ...td, fontFamily: 'monospace', fontSize: '11px', maxWidth: '480px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.error ? r.error : r.metrics ? JSON.stringify(r.metrics) : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}
            </div>

            {/* ─── 6. DEINDEX QUEUE ─────────────────────────────────────────── */}
            <div style={card}>
                <h2 style={h2}>6. Deindex queue burn-down</h2>
                {queueTotal === 0 ? (
                    <p style={{ fontSize: '13px', color: '#7A6A62' }}>
                        Queue is empty. After the <code>deindex_queue</code> migration deploys, run{' '}
                        <code>npx tsx scripts/seed-deindex-queue.ts</code> to seed it from the GSC
                        ISSUES exports.
                    </p>
                ) : (
                    <>
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '4px' }}>
                                {queueDone.toLocaleString('en-US')} / {queueTotal.toLocaleString('en-US')} URLs processed ({queuePct}%)
                            </div>
                            <div style={{ height: '8px', background: '#F0F0F0', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ width: `${queuePct}%`, height: '100%', background: '#10B981' }} />
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                            {data.queueByStatus.map((r) => (
                                <div key={r.status} style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                                    <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>{r.status}</div>
                                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>{r._count._all.toLocaleString('en-US')}</div>
                                </div>
                            ))}
                        </div>

                        <div style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '8px' }}>By source (top 10):</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th style={th}>Source</th>
                                    <th style={th}>Count</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.queueBySource.map((r) => (
                                    <tr key={r.source}>
                                        <td style={td}><code>{r.source}</code></td>
                                        <td style={td}>{r._count._all.toLocaleString('en-US')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ fontSize: '11px', color: '#7A6A62', marginTop: '12px' }}>
                            Avg attempt count: {(data.queueAttempts._avg.attempt ?? 0).toFixed(2)}.
                            Max: {data.queueAttempts._max.attempt ?? 0}.
                        </div>
                    </>
                )}
            </div>

            {/* ─── 7. LAYER 2 SNIPPETS ──────────────────────────────────────── */}
            <div style={card}>
                <h2 style={h2}>7. Layer 2 snippet review queue</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>Approved (live)</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#10B981' }}>{data.approvedTotal}</div>
                    </div>
                    <div style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>Pending review</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#F59E0B' }}>{data.pendingApproval}</div>
                    </div>
                    <div style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>City snippets</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>{data.snippetCity.reduce((sum, r) => sum + r._count._all, 0)}</div>
                    </div>
                    <div style={{ background: '#FAFAFA', padding: '12px', borderRadius: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#7A6A62', textTransform: 'uppercase' }}>Taxonomy×city</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35' }}>{data.snippetCategoryCity.reduce((sum, r) => sum + r._count._all, 0)}</div>
                    </div>
                </div>

                {data.recentSnippets.length > 0 && (
                    <>
                        <div style={{ fontSize: '12px', color: '#7A6A62', marginBottom: '8px' }}>Latest 10 city snippets:</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th style={th}>City</th>
                                    <th style={th}>Model</th>
                                    <th style={th}>Generated</th>
                                    <th style={th}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentSnippets.map((r) => (
                                    <tr key={r.citySlug}>
                                        <td style={td}><code>{r.citySlug}</code></td>
                                        <td style={td}>{r.sourceModel ?? '—'}</td>
                                        <td style={td}>{formatRelativeTime(r.generatedAt)}</td>
                                        <td style={{ ...td, color: r.approvedAt ? '#10B981' : '#F59E0B', fontWeight: 600 }}>
                                            {r.approvedAt ? '✓ approved' : '○ pending'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}

                <div style={{ fontSize: '11px', color: '#7A6A62', marginTop: '12px' }}>
                    Approve via CLI: <code>npx tsx scripts/approve-snippets.ts --list</code>
                </div>
            </div>
        </div>
    );
}

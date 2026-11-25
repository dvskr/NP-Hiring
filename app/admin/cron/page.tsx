'use client';

import { useState, useEffect } from 'react';
import { Activity, Play, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { formatCT } from '@/lib/format-ct';
import {
    cronNameFromPath,
    isRunStale,
    runOutcome,
    staleLabel,
    RUN_OUTCOME_LABEL,
    STALE_RUN_MS,
    type CronBatchView,
    type LatestCronRun,
    type RunOutcome,
} from './cron-run-lookup';

interface CronJobInfo {
    path: string;
    schedule: string;
}

interface TriggerEntry {
    loading: boolean;
    result?: { success: boolean; message: string };
}

interface TriggerState {
    [path: string]: TriggerEntry;
}

/** What /api/admin/cron-runs answers, indexed for the page. */
interface RunHistory {
    runs: Readonly<Record<string, LatestCronRun>>;
    batches: Readonly<Record<string, CronBatchView['targets']>>;
    staleAfterMs: Readonly<Record<string, number>>;
    /** When the history was read (ms): a run is judged stale against it, so rendering reads no clock. */
    checkedAt: number;
}

interface CronRunsPayload {
    runs?: LatestCronRun[];
    batches?: CronBatchView[];
    staleAfterMs?: Record<string, number>;
}

function indexRunHistory(data: CronRunsPayload, checkedAt: number): RunHistory {
    return {
        runs: Object.fromEntries((data.runs ?? []).map((run) => [run.name, run])),
        batches: Object.fromEntries((data.batches ?? []).map((batch) => [batch.path, batch.targets])),
        staleAfterMs: data.staleAfterMs ?? {},
        checkedAt,
    };
}

const GROUP_ORDER = [
    'Ingestion Pipelines',
    'Batched Housekeeping',
    'SEO & Optimization',
    'Engagement & Notifications',
    'Maintenance',
    'Other',
] as const;

type CronGroup = (typeof GROUP_ORDER)[number];

function groupOf(path: string): CronGroup {
    if (path.includes('/batch/')) return 'Batched Housekeeping';
    if (path.includes('ingest')) return 'Ingestion Pipelines';
    if (path.includes('deindex') || path.includes('aggregate-pseo') || path.includes('seo') || path.includes('index-urls')) return 'SEO & Optimization';
    if (/alert|report|reminder|nudge|social|instagram|push-notification/.test(path)) return 'Engagement & Notifications';
    if (/cleanup|decay|enrich-jobs|dead-links|expiry/.test(path)) return 'Maintenance';
    return 'Other';
}

function groupCrons(crons: readonly CronJobInfo[]): Array<[CronGroup, CronJobInfo[]]> {
    return GROUP_ORDER
        .map((group): [CronGroup, CronJobInfo[]] => [group, crons.filter((c) => groupOf(c.path) === group)])
        .filter(([, items]) => items.length > 0);
}

function buildSuccessMessage(parsed: unknown): string {
    if (typeof parsed === 'object' && parsed !== null) {
        const p = parsed as Record<string, unknown>;
        const audit = p.audit as { staged?: number; flushed?: number; failedFlushes?: number; lastError?: string | null } | undefined;
        if (audit) {
            const parts = [`staged=${audit.staged ?? 0}`, `flushed=${audit.flushed ?? 0}`];
            if (audit.failedFlushes && audit.failedFlushes > 0) {
                parts.push(`FAILED=${audit.failedFlushes}`);
                if (audit.lastError) parts.push(`error="${audit.lastError}"`);
            }
            return `OK · ${parts.join(' · ')}`;
        }
        if (typeof p.message === 'string') return `OK · ${p.message}`;
    }
    return 'Triggered successfully';
}

function buildErrorMessage(status: number, parsed: unknown, fallback: string): string {
    if (typeof parsed === 'object' && parsed !== null) {
        const p = parsed as Record<string, unknown>;
        const err = (p.error as string | undefined) ?? (p.message as string | undefined);
        if (err) return `HTTP ${status} · ${err}`;
    }
    return `HTTP ${status} · ${fallback.slice(0, 200)}`;
}

const OUTCOME_COLOR: Readonly<Record<RunOutcome, string>> = {
    succeeded: '#16A34A',
    failed: '#DC2626',
    running: '#6B7F8A',
    unfinished: '#DC2626',
};

function OutcomeIcon({ outcome }: { outcome: RunOutcome }) {
    if (outcome === 'succeeded') return <CheckCircle size={13} />;
    if (outcome === 'running') return <Clock size={13} />;
    return <XCircle size={13} />;
}

/** One run's outcome, start time, duration, stale flag and error. */
function LastRunLine({ run, staleAfterMs, checkedAt }: { run: LatestCronRun | undefined; staleAfterMs: number; checkedAt: number }) {
    if (!run) {
        return (
            <span style={{ color: '#94A3B8' }}>
                No run recorded. A cron appears here once it has run with tracking.
            </span>
        );
    }
    const outcome = runOutcome(run);
    return (
        <>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: OUTCOME_COLOR[outcome] }}>
                <OutcomeIcon outcome={outcome} /> {RUN_OUTCOME_LABEL[outcome]}
            </span>
            <span style={{ color: '#6B7F8A' }}>{formatCT(run.startedAt)}</span>
            {run.durationMs != null && (
                <span style={{ color: '#94A3B8' }}>{(run.durationMs / 1000).toFixed(1)}s</span>
            )}
            {isRunStale(run.startedAt, checkedAt, staleAfterMs) && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#B45309', fontWeight: 600 }}>
                    <AlertTriangle size={13} /> {staleLabel(staleAfterMs)}
                </span>
            )}
            {run.error && (
                <span style={{ color: '#DC2626', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
                    {run.error}
                </span>
            )}
        </>
    );
}

/** The last-run line for one tracked name, or why it cannot be shown yet. */
function RunStatus({ name, history, historyFailed }: { name: string; history: RunHistory | null; historyFailed: boolean }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', fontSize: '12px', flexWrap: 'wrap' }}>
            {history ? (
                <LastRunLine run={history.runs[name]} staleAfterMs={history.staleAfterMs[name] ?? STALE_RUN_MS} checkedAt={history.checkedAt} />
            ) : (
                <span style={{ color: '#94A3B8' }}>
                    {historyFailed ? 'Run history unavailable.' : 'Loading the last run...'}
                </span>
            )}
        </div>
    );
}

/** The crons a batch dispatcher runs, each with its own last run. */
function BatchTargetList({ targets, history }: { targets: CronBatchView['targets']; history: RunHistory }) {
    return (
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #E8ECF0' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7F8A', marginBottom: '8px' }}>
                Runs these crons in order. Each one keeps its own run history.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {targets.map((target) => {
                    const name = cronNameFromPath(target.path);
                    return (
                        <div key={target.path}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1A2E35' }}>
                                {name}
                                {target.gate && (
                                    <span style={{ marginLeft: '8px', fontWeight: 400, color: '#94A3B8' }}>{target.gate}</span>
                                )}
                            </div>
                            <RunStatus name={name} history={history} historyFailed={false} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function TriggerControl({ state, onTrigger }: { state: TriggerEntry | undefined; onTrigger: () => void }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', maxWidth: '60%' }}>
            {state?.result && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '12px',
                    color: state.result.success ? '#16A34A' : '#DC2626',
                    fontFamily: 'ui-monospace, monospace',
                    wordBreak: 'break-word',
                    lineHeight: 1.4,
                }}>
                    {state.result.success ? <CheckCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} /> : <XCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />}
                    <span>{state.result.message}</span>
                </div>
            )}

            <button
                onClick={onTrigger}
                disabled={state?.loading}
                style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 18px', borderRadius: '14px', cursor: state?.loading ? 'not-allowed' : 'pointer',
                    backgroundColor: state?.loading ? '#F0F3F2' : '#FAFBF9',
                    color: '#1A2E35', border: '1px solid rgba(255,255,255,0.6)',
                    fontSize: '13px', fontWeight: 600, transition: 'all 0.2s',
                    boxShadow: '4px 4px 10px rgba(0,0,0,0.04), -2px -2px 6px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.6)',
                }}>
                <Play size={14} style={{ opacity: state?.loading ? 0.5 : 1 }} />
                {state?.loading ? 'Running...' : 'Trigger Manually'}
            </button>
        </div>
    );
}

interface CronCardProps {
    cron: CronJobInfo;
    history: RunHistory | null;
    historyFailed: boolean;
    trigger: TriggerEntry | undefined;
    onTrigger: () => void;
}

function CronCard({ cron, history, historyFailed, trigger, onTrigger }: CronCardProps) {
    const query = new URLSearchParams(cron.path.split('?')[1] ?? '');
    const source = query.get('source');
    const chunk = query.get('chunk');
    const trackedName = cronNameFromPath(cron.path);
    const targets = history?.batches[cron.path];

    return (
        <div style={{
            backgroundColor: '#FAFBF9',
            border: '1px solid rgba(255,255,255,0.7)',
            borderRadius: '18px',
            padding: '18px 20px',
            boxShadow: '6px 6px 16px rgba(0,0,0,0.05), -4px -4px 12px rgba(255,255,255,0.9), inset 2px 2px 5px rgba(255,255,255,0.7), inset -1px -1px 3px rgba(0,0,0,0.02)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#1A2E35' }}>
                            {source ? `Ingest: ${source}` : trackedName}
                            {chunk && <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', backgroundColor: '#F8FAF9' }}>Chunk {chunk}</span>}
                        </h3>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '13px', color: '#94A3B8', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={14} /> Schedule: {cron.schedule}
                        </span>
                        <code>{cron.path}</code>
                    </div>
                    <RunStatus name={trackedName} history={history} historyFailed={historyFailed} />
                </div>

                <TriggerControl state={trigger} onTrigger={onTrigger} />
            </div>

            {history && targets && targets.length > 0 && (
                <BatchTargetList targets={targets} history={history} />
            )}
        </div>
    );
}

export default function CronHealthDashboard() {
    const [crons, setCrons] = useState<CronJobInfo[]>([]);
    const [history, setHistory] = useState<RunHistory | null>(null);
    const [loading, setLoading] = useState(true);
    const [triggerState, setTriggerState] = useState<TriggerState>({});
    const [error, setError] = useState<string | null>(null);
    const [runsError, setRunsError] = useState<string | null>(null);

    useEffect(() => {
        fetchCrons();
        fetchRuns();
    }, []);

    const fetchCrons = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/cron-list');
            if (!res.ok) throw new Error('Failed to fetch cron config');
            const data = await res.json();
            setCrons(data.crons || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    // The schedule list and the run history are separate reads on purpose: a
    // health page that renders nothing because cron_runs is unavailable is the
    // same failure as one that renders green because it never asked.
    const fetchRuns = async () => {
        try {
            const res = await fetch('/api/admin/cron-runs', { cache: 'no-store' });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data || data.success === false) {
                throw new Error(data?.error || `HTTP ${res.status}`);
            }
            setHistory(indexRunHistory(data as CronRunsPayload, Date.now()));
            setRunsError(null);
        } catch (err) {
            setRunsError(err instanceof Error ? err.message : 'Unknown error');
        }
    };

    const triggerCron = async (path: string) => {
        setTriggerState(prev => ({
            ...prev,
            [path]: { loading: true }
        }));

        try {
            // Vercel cron handlers are GET. Admin sessions are accepted by
            // verifyCronOrAdmin; the cron secret is not exposed to browsers.
            const res = await fetch(path, { method: 'GET' });

            const text = await res.text();
            let parsed: unknown = text;
            try { parsed = JSON.parse(text); } catch { /* not JSON, keep raw */ }

            // Surface as much detail as possible: the recorder's lastError
            // lives at audit.lastError, a generic error at .error.
            const message = res.ok
                ? buildSuccessMessage(parsed)
                : buildErrorMessage(res.status, parsed, text);

            setTriggerState(prev => ({
                ...prev,
                [path]: {
                    loading: false,
                    result: { success: res.ok, message }
                }
            }));
        } catch (err) {
            setTriggerState(prev => ({
                ...prev,
                [path]: {
                    loading: false,
                    result: { success: false, message: `Execution error: ${err instanceof Error ? err.message : 'unknown'}` }
                }
            }));
        }

        // A manual trigger writes a cron_runs row whether or not the request
        // came back cleanly, so the last run shown is stale either way.
        await fetchRuns();
    };

    if (loading) {
        return (
            <div style={{ maxWidth: '1000px', margin: '0 auto', paddingTop: '80px', paddingBottom: '32px', paddingLeft: '16px', paddingRight: '16px', textAlign: 'center' }}>
                <Activity className="animate-pulse" size={48} style={{ color: '#BE185D', margin: '0 auto' }} />
                <p style={{ marginTop: '16px', color: '#6B7F8A' }}>Loading cron configuration...</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 16px' }}>
            <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#1A2E35', marginBottom: '4px' }}>Cron Health Dashboard</h1>
                    <p style={{ color: '#6B7F8A' }}>
                        Schedules, last run and outcome, and manual triggers. Run history is keyed by cron
                        route, so the ingest chunks share one history, and each batch lists the crons it runs.
                    </p>
                </div>
            </div>

            {error && (
                <div style={{ padding: '16px', backgroundColor: '#FEF2F2', color: '#991B1B', borderRadius: '16px', marginBottom: '24px',
                    boxShadow: 'inset 2px 2px 5px rgba(255,255,255,0.5), inset -1px -1px 3px rgba(0,0,0,0.03)' }}>
                    Error loading cron jobs: {error}
                </div>
            )}

            {runsError && (
                <div role="alert" style={{ padding: '16px', backgroundColor: '#FFFBEB', color: '#92400E', borderRadius: '16px', marginBottom: '24px' }}>
                    Run history could not be loaded, so the last runs below are missing or out of date: {runsError}
                </div>
            )}

            {groupCrons(crons).map(([groupName, items]) => (
                <div key={groupName} style={{ marginBottom: '32px' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', marginBottom: '16px', paddingBottom: '8px', borderBottom: '1px solid #E8ECF0' }}>
                        {groupName} <span style={{ fontSize: '14px', color: '#94A3B8', fontWeight: 400 }}>({items.length} tasks)</span>
                    </h2>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {items.map((cron) => (
                            <CronCard
                                key={`${cron.path}@${cron.schedule}`}
                                cron={cron}
                                history={history}
                                historyFailed={runsError !== null}
                                trigger={triggerState[cron.path]}
                                onTrigger={() => triggerCron(cron.path)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

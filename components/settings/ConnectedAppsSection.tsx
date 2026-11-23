'use client';

/**
 * Settings, Account: the AI apps (Claude, ChatGPT and other MCP clients) the
 * candidate connected to their account, with a way to remove each one
 * (design 2.10). Reads and revokes through /api/oauth/connected-apps, which
 * only ever touches the caller's own grants.
 */
import React, { useEffect, useState } from 'react';
import { Plug, ShieldCheck } from 'lucide-react';

/** The shape GET /api/oauth/connected-apps answers (lib/mcp/oauth/grants.ts ConnectedApp). */
interface ConnectedApp {
    grantId: string;
    clientName: string;
    verifiedAs: string | null;
    connector: string;
    connectedAt: string;
    lastUsedAt: string | null;
}

type ListState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; apps: ConnectedApp[] };

const CONNECTED_APPS_URL = '/api/oauth/connected-apps';

// Same card as the other Settings sections (app/settings/page.tsx cardStyle, cardTitle).
const cardStyle: React.CSSProperties = {
    background: '#F7FBF8',
    border: '1px solid rgba(213, 232, 224, 0.6)',
    borderRadius: '20px',
    padding: '28px',
    marginBottom: '20px',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.05), -3px -3px 10px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.01)',
};

const cardTitle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 800,
    fontFamily: 'var(--font-lora), Georgia, serif',
    color: '#1A2E35',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
};

const rowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '14px 0',
    borderTop: '1px solid rgba(213, 232, 224, 0.8)',
};

const mutedText: React.CSSProperties = { fontSize: '13px', color: '#4B5E68', margin: 0 };

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** The apps the route answered, or null when the answer is not the expected shape. */
function readApps(body: unknown): ConnectedApp[] | null {
    if (body === null || typeof body !== 'object') return null;
    const apps = (body as { apps?: unknown }).apps;
    if (!Array.isArray(apps)) return null;
    return apps.filter((app): app is ConnectedApp => {
        if (app === null || typeof app !== 'object') return false;
        const row = app as Record<string, unknown>;
        return (
            typeof row.grantId === 'string' &&
            typeof row.clientName === 'string' &&
            (row.verifiedAs === null || typeof row.verifiedAs === 'string') &&
            typeof row.connector === 'string' &&
            typeof row.connectedAt === 'string' &&
            (row.lastUsedAt === null || typeof row.lastUsedAt === 'string')
        );
    });
}

export default function ConnectedAppsSection(): React.JSX.Element {
    const [list, setList] = useState<ListState>({ kind: 'loading' });
    const [removing, setRemoving] = useState<string | null>(null);
    const [removeFailed, setRemoveFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const response = await fetch(CONNECTED_APPS_URL, { cache: 'no-store' });
                const apps = response.ok ? readApps(await response.json()) : null;
                if (!cancelled) setList(apps ? { kind: 'ready', apps } : { kind: 'error' });
            } catch {
                if (!cancelled) setList({ kind: 'error' });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const removeAccess = async (grantId: string): Promise<void> => {
        if (removing) return;
        setRemoving(grantId);
        setRemoveFailed(false);
        try {
            const response = await fetch(CONNECTED_APPS_URL, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ grantId }),
            });
            // 404: already removed (another tab, or the app disconnected itself).
            if (!response.ok && response.status !== 404) throw new Error(`remove answered ${response.status}`);
            setList((current) => (current.kind === 'ready' ? { kind: 'ready', apps: current.apps.filter((app) => app.grantId !== grantId) } : current));
        } catch {
            setRemoveFailed(true);
        } finally {
            setRemoving(null);
        }
    };

    return (
        <section style={cardStyle} aria-labelledby="connected-apps-title" aria-busy={list.kind === 'loading'}>
            <h3 id="connected-apps-title" style={cardTitle}>
                <Plug size={20} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                Connected apps
            </h3>

            {list.kind === 'loading' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="animate-pulse" style={{ height: '48px', borderRadius: '12px', background: 'rgba(0,0,0,0.05)' }} />
                    <div className="animate-pulse" style={{ height: '48px', borderRadius: '12px', background: 'rgba(0,0,0,0.05)' }} />
                </div>
            )}

            {list.kind === 'error' && <p role="alert" style={{ ...mutedText, color: '#B91C1C' }}>Connected apps could not be loaded.</p>}

            {list.kind === 'ready' && list.apps.length === 0 && <p style={mutedText}>No apps are connected.</p>}

            {list.kind === 'ready' && list.apps.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {list.apps.map((app) => (
                        <li key={app.grantId} style={rowStyle}>
                            <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                                <p style={{ fontSize: '15px', fontWeight: 700, color: '#1A2E35', margin: '0 0 2px', overflowWrap: 'anywhere' }}>{app.clientName}</p>
                                {app.verifiedAs && (
                                    <p style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: '4px', color: '#065F46' }}>
                                        <ShieldCheck size={13} aria-hidden="true" /> Verified: {app.verifiedAs}
                                    </p>
                                )}
                                <p style={mutedText}>{app.connector}</p>
                                <p style={mutedText}>Connected {formatDate(app.connectedAt)}</p>
                                <p style={mutedText}>{app.lastUsedAt ? `Last used ${formatDate(app.lastUsedAt)}` : 'Not used yet'}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => removeAccess(app.grantId)}
                                disabled={removing !== null}
                                style={{
                                    minHeight: '44px',
                                    padding: '8px 18px',
                                    borderRadius: '10px',
                                    border: '1.5px solid rgba(239,68,68,0.3)',
                                    background: 'rgba(239,68,68,0.08)',
                                    color: '#B91C1C',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    cursor: removing !== null ? 'not-allowed' : 'pointer',
                                    opacity: removing !== null && removing !== app.grantId ? 0.6 : 1,
                                }}
                            >
                                {removing === app.grantId ? 'Removing…' : 'Remove access'}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {removeFailed && (
                <p role="alert" style={{ fontSize: '12px', color: '#B91C1C', marginTop: '8px' }}>
                    Access could not be removed. Try again.
                </p>
            )}
        </section>
    );
}

'use client';

/**
 * /admin/post-packs — the 5-post pack back office (2027 re-price, phase 3;
 * plan section 3.9). Lists every pack (GET /api/admin/post-packs) and makes
 * the three changes PATCH /api/admin/post-packs/:id allows on a paid pack:
 * revoke unused posts (all, or a count), move the use-by date later, and
 * restore one post the pack spent. Refunded and disputed packs are read
 * only here: the Stripe webhook settles them.
 *
 * The use-by date is set as the employer reads it ("Use by June 30, 2028"),
 * lib/pricing-copy.ts converts it. Built like the Employer plan page it
 * replaced (deleted with the plan code in phase 4): one client component,
 * inline admin styles, fetch, table, and a PATCH that replaces the row with
 * the pack as it now stands. Prices come from config.
 */

import { useState, useEffect } from 'react';
import { Package, CheckCircle2, Layers } from 'lucide-react';
import { config } from '@/lib/config';
import { packDateLabel, packUseByValue } from '@/lib/pricing-copy';
import { packCreditsLine, packInvoiceHref, packStatusLine, type PostPackState } from '@/lib/post-pack-view';
import type { AdminPackView, PackAdminAction } from '@/lib/post-pack-admin';

/* ─── Styles (the admin back office's inline style set) ─── */
const card: React.CSSProperties = { backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' };
const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
const th: React.CSSProperties = { padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', borderBottom: '1px solid #E8ECF0', textAlign: 'left', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', color: '#6B7F8A', borderBottom: '1px solid #E8ECF0', verticalAlign: 'top' };
const inputStyle: React.CSSProperties = { padding: '6px 10px', borderRadius: '8px', fontSize: '12px', backgroundColor: '#F8FAF9', border: '1px solid rgba(0,0,0,0.08)', color: '#1A2E35', outline: 'none' };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: '8px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: '#BE185D', color: '#fff' };
const ghostBtn: React.CSSProperties = { ...primaryBtn, background: 'rgba(190,24,93,0.1)', color: '#BE185D' };

const STATE_BADGE: Record<PostPackState, { label: string; bg: string; text: string }> = {
    active: { label: 'Active', bg: 'rgba(34,197,94,0.12)', text: '#16A34A' },
    used: { label: 'Used up', bg: 'rgba(59,130,246,0.12)', text: '#3B82F6' },
    expired: { label: 'Expired', bg: 'rgba(148,163,184,0.12)', text: '#94A3B8' },
    refunded: { label: 'Refunded', bg: 'rgba(239,68,68,0.12)', text: '#EF4444' },
    disputed: { label: 'Disputed', bg: 'rgba(245,158,11,0.12)', text: '#F59E0B' },
};

function stateBadge(state: PostPackState) {
    const { label, bg, text } = STATE_BADGE[state];
    return <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, backgroundColor: bg, color: text, whiteSpace: 'nowrap' }}>{label}</span>;
}

/** A paid pack is the only kind an admin changes; refunded and disputed ones are the webhook's. */
const isChangeable = (pack: AdminPackView): boolean => pack.state === 'active' || pack.state === 'used' || pack.state === 'expired';

export default function AdminPostPacksPage() {
    const [packs, setPacks] = useState<AdminPackView[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ text: string; isError: boolean } | null>(null);
    // Per-row drafts keyed by pack id: the use-by date input, the revoke count.
    const [useByDrafts, setUseByDrafts] = useState<Record<string, string>>({});
    const [revokeDrafts, setRevokeDrafts] = useState<Record<string, number>>({});

    useEffect(() => { void fetchPacks(); }, []);

    const fetchPacks = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch('/api/admin/post-packs');
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || `Request failed (${res.status})`);
            setPacks(data.packs);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load the packs');
        } finally {
            setLoading(false);
        }
    };

    const showMsg = (text: string, isError: boolean) => {
        setActionMsg({ text, isError });
        setTimeout(() => setActionMsg(null), 5000);
    };

    const change = async (pack: AdminPackView, body: PackAdminAction, okMsg: string) => {
        setBusyId(pack.id);
        try {
            const res = await fetch(`/api/admin/post-packs/${encodeURIComponent(pack.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({} as { error?: string; pack?: AdminPackView }));
            if (!res.ok || !data.pack) {
                showMsg(data.error || 'The change failed. Please try again.', true);
                return;
            }
            const updated = data.pack as AdminPackView;
            setPacks(prev => prev.map(p => (p.id === updated.id ? updated : p)));
            // The row's drafts start again from the pack as it now stands.
            setUseByDrafts(prev => ({ ...prev, [updated.id]: packUseByValue(new Date(updated.expiresAt)) }));
            setRevokeDrafts(prev => ({ ...prev, [updated.id]: updated.remaining }));
            showMsg(okMsg, false);
        } catch {
            showMsg('Network error. Please try again.', true);
        } finally {
            setBusyId(null);
        }
    };

    const revoke = (pack: AdminPackView) => {
        const credits = revokeDrafts[pack.id] ?? pack.remaining;
        const posts = credits === 1 ? 'post' : 'posts';
        if (!window.confirm(`Revoke ${credits} unused ${posts} from ${pack.email}? A revoked post cannot be given back.`)) return;
        void change(pack, { action: 'revoke', credits }, `${credits} unused ${posts} revoked.`);
    };

    const activeCount = packs.filter(p => p.state === 'active').length;
    const postsLeft = packs.filter(p => p.state === 'active').reduce((sum, p) => sum + p.remaining, 0);

    if (loading) {
        return (
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, border: '3px solid #E8ECF0', borderTop: '3px solid #BE185D', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ ...sub, marginTop: 16 }}>Loading packs…</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 16px' }}>
            <div style={{ marginBottom: 20 }}>
                <h1 style={{ ...heading, fontSize: 28, marginBottom: 4 }}>Post Packs</h1>
                <p style={sub}>
                    {config.packPosts} posts for {config.formatDollars(config.packPrice)}, to use within {config.packValidityMonths} months.
                </p>
            </div>

            {actionMsg && (
                <div role="status" style={{
                    marginBottom: 16, padding: '12px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    backgroundColor: actionMsg.isError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: actionMsg.isError ? '#F87171' : '#16A34A',
                }}>{actionMsg.text}</div>
            )}

            {loadError && (
                <div style={{ ...card, padding: 32, textAlign: 'center', marginBottom: 24 }}>
                    <p style={{ ...sub, marginBottom: 12 }}>{loadError}</p>
                    <button onClick={() => void fetchPacks()} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600, color: '#BE185D' }}>Try Again</button>
                </div>
            )}

            {!loadError && (
                <>
                    <div className="grid grid-cols-3 gap-4" style={{ marginBottom: 24 }}>
                        {[
                            { icon: <Package size={18} />, label: 'Total Packs', value: packs.length, color: '#BE185D' },
                            { icon: <CheckCircle2 size={18} />, label: 'Active', value: activeCount, color: '#16A34A' },
                            { icon: <Layers size={18} />, label: 'Posts Left', value: postsLeft, color: '#3B82F6' },
                        ].map(stat => (
                            <div key={stat.label} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                <div style={{ color: stat.color, marginBottom: 6 }}>{stat.icon}</div>
                                <div style={{ fontSize: 22, fontWeight: 700, color: '#1A2E35' }}>{stat.value}</div>
                                <div style={muted}>{stat.label}</div>
                            </div>
                        ))}
                    </div>

                    <div style={card}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#F8FAF9' }}>
                                        <th style={th}>Account</th>
                                        <th style={th}>Posts</th>
                                        <th style={th}>Use by</th>
                                        <th style={th}>Bought</th>
                                        <th style={th}>Changes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {packs.map(p => (
                                        <PackRow
                                            key={p.id}
                                            pack={p}
                                            busy={busyId === p.id}
                                            useByDraft={useByDrafts[p.id] ?? packUseByValue(new Date(p.expiresAt))}
                                            revokeDraft={revokeDrafts[p.id] ?? p.remaining}
                                            onUseByDraft={value => setUseByDrafts(prev => ({ ...prev, [p.id]: value }))}
                                            onRevokeDraft={value => setRevokeDrafts(prev => ({ ...prev, [p.id]: value }))}
                                            onExtend={useBy => void change(p, { action: 'extend', useBy }, 'Use by date moved.')}
                                            onRevoke={() => revoke(p)}
                                            onRestore={() => void change(p, { action: 'restore' }, 'One post given back.')}
                                        />
                                    ))}
                                    {packs.length === 0 && (
                                        <tr><td colSpan={5} style={{ ...td, textAlign: 'center', padding: 40 }}>No packs yet.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

interface PackRowProps {
    pack: AdminPackView;
    busy: boolean;
    useByDraft: string;
    revokeDraft: number;
    onUseByDraft: (value: string) => void;
    onRevokeDraft: (value: number) => void;
    onExtend: (useBy: string) => void;
    onRevoke: () => void;
    onRestore: () => void;
}

function PackRow({ pack, busy, useByDraft, revokeDraft, onUseByDraft, onRevokeDraft, onExtend, onRevoke, onRestore }: PackRowProps) {
    const changeable = isChangeable(pack);
    const status = packStatusLine(pack);
    const invoiceHref = packInvoiceHref(pack);
    const useByDirty = useByDraft !== packUseByValue(new Date(pack.expiresAt));
    return (
        <tr>
            <td style={{ ...td, minWidth: 220 }}>
                <div style={{ color: '#1A2E35', fontWeight: 600, wordBreak: 'break-all' }}>{pack.email}</div>
                <div style={{ ...muted, marginTop: 4, wordBreak: 'break-all' }}>{pack.userId ?? 'No account'}</div>
                <div style={{ ...muted, marginTop: 4 }}>{pack.source}</div>
            </td>
            <td style={{ ...td, minWidth: 150 }}>
                {stateBadge(pack.state)}
                <div style={{ color: '#1A2E35', fontWeight: 600, marginTop: 8 }}>{packCreditsLine(pack)}</div>
                {pack.revoked > 0 && <div style={{ ...muted, marginTop: 4 }}>{pack.revoked} revoked</div>}
            </td>
            <td style={{ ...td, minWidth: 200 }}>
                {status && <div style={{ color: '#1A2E35' }}>{status}</div>}
                {changeable && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <input
                            type="date"
                            aria-label={`Use by date for ${pack.email}`}
                            value={useByDraft}
                            disabled={busy}
                            onChange={e => onUseByDraft(e.target.value)}
                            style={inputStyle}
                        />
                        {useByDirty && (
                            <button onClick={() => onExtend(useByDraft)} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.4 : 1 }}>Save</button>
                        )}
                    </div>
                )}
            </td>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>
                <div style={{ color: '#1A2E35' }}>{packDateLabel(new Date(pack.purchasedAt))}</div>
                <div style={{ marginTop: 4 }}>{config.formatDollars(pack.amountCents / 100)}</div>
                {invoiceHref && (
                    <a href={invoiceHref} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 4, color: '#BE185D', fontWeight: 600 }}>
                        Invoice{pack.invoiceNumber ? ` #${pack.invoiceNumber}` : ''}
                    </a>
                )}
                {pack.stripePaymentIntentId && <div style={{ ...muted, marginTop: 4, fontFamily: 'monospace' }}>{pack.stripePaymentIntentId}</div>}
            </td>
            <td style={{ ...td, minWidth: 200 }}>
                {changeable && pack.remaining > 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                            type="number"
                            aria-label={`Unused posts to revoke from ${pack.email}`}
                            min={1}
                            max={pack.remaining}
                            value={revokeDraft}
                            disabled={busy}
                            onChange={e => onRevokeDraft(Number(e.target.value))}
                            style={{ ...inputStyle, width: 64 }}
                        />
                        <button onClick={onRevoke} disabled={busy || !Number.isInteger(revokeDraft) || revokeDraft < 1 || revokeDraft > pack.remaining} style={{ ...ghostBtn, opacity: busy ? 0.4 : 1 }}>Revoke</button>
                    </div>
                )}
                {changeable && pack.used > 0 && (
                    <button onClick={onRestore} disabled={busy} style={{ ...ghostBtn, marginTop: 8, opacity: busy ? 0.4 : 1 }}>Restore one post</button>
                )}
            </td>
        </tr>
    );
}

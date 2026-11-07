'use client';

/**
 * /admin/guides: the guides store back office (register 2.35). Finds a
 * reader's purchases by email (GET /api/admin/guides) and gives one a new
 * library link (POST /api/admin/guides/:id/rotate), which cuts off the old
 * link and every browser holding it, then emails the new one. Each row asks
 * for an inline confirmation before it replaces a link and shows the outcome
 * in place. Built like /admin/post-packs: one client component file, the
 * admin inline style set, fetch and a table. Types only from
 * lib/guides/admin.ts, which is server only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, XCircle } from 'lucide-react';
import type { AdminGuidePurchaseView, GuideAccessDelivery, GuidePurchaseStatus } from '@/lib/guides/admin';

/* Styles (the admin back office's inline style set) */
const card: React.CSSProperties = { backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' };
const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
const strong: React.CSSProperties = { color: '#1A2E35', fontWeight: 600 };
const th: React.CSSProperties = { padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', borderBottom: '1px solid #E8ECF0', textAlign: 'left', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', color: '#6B7F8A', borderBottom: '1px solid #E8ECF0', verticalAlign: 'top' };
const inputStyle: React.CSSProperties = { padding: '9px 12px', borderRadius: '8px', fontSize: '13px', backgroundColor: '#F8FAF9', border: '1px solid rgba(0,0,0,0.08)', color: '#1A2E35', outline: 'none' };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: '8px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: '#BE185D', color: '#fff' };
const ghostBtn: React.CSSProperties = { ...primaryBtn, background: 'rgba(190,24,93,0.1)', color: '#BE185D' };

const STATUS_BADGE: Record<GuidePurchaseStatus, { label: string; bg: string; text: string }> = {
    active: { label: 'Active', bg: 'rgba(34,197,94,0.12)', text: '#16A34A' },
    refunded: { label: 'Refunded', bg: 'rgba(239,68,68,0.12)', text: '#EF4444' },
    disputed: { label: 'Disputed', bg: 'rgba(245,158,11,0.12)', text: '#F59E0B' },
};

const SOURCE_LABEL: Readonly<Record<string, string>> = { stripe: 'Paid', promo: 'Free claim' };

type Tone = 'ok' | 'warn' | 'error';
const TONE_COLOR: Record<Tone, string> = { ok: '#16A34A', warn: '#B45309', error: '#DC2626' };

interface LinkOutcome {
    readonly text: string;
    readonly tone: Tone;
}

type Result<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };
type ListResult = Result<{ readonly purchases: readonly AdminGuidePurchaseView[] }>;
type RotateResult = Result<{ readonly purchase: AdminGuidePurchaseView; readonly delivery: GuideAccessDelivery }>;

function dateLabel(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function outcomeFor(delivery: GuideAccessDelivery): LinkOutcome {
    return delivery === 'sent' ? { text: 'New link sent', tone: 'ok' } : { text: 'New link set; email not sent', tone: 'warn' };
}

async function fetchPurchases(email: string): Promise<ListResult> {
    try {
        const query = email ? `?email=${encodeURIComponent(email)}` : '';
        const res = await fetch(`/api/admin/guides${query}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) return { ok: false, error: data.error || `Request failed (${res.status})` };
        return { ok: true, purchases: data.purchases };
    } catch {
        return { ok: false, error: 'Network error. Please try again.' };
    }
}

async function postNewLink(id: string): Promise<RotateResult> {
    try {
        const res = await fetch(`/api/admin/guides/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) return { ok: false, error: data.error || 'The new link failed. Please try again.' };
        return { ok: true, purchase: data.purchase, delivery: data.delivery };
    } catch {
        return { ok: false, error: 'Network error. Please try again.' };
    }
}

export default function AdminGuidesPage() {
    const [purchases, setPurchases] = useState<readonly AdminGuidePurchaseView[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [searched, setSearched] = useState('');
    // Only the newest search may fill the table.
    const latest = useRef(0);

    const apply = useCallback((seq: number, email: string, result: ListResult) => {
        if (seq !== latest.current) return;
        if (result.ok) {
            setPurchases(result.purchases);
            setSearched(email);
        } else {
            setLoadError(result.error);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        const seq = ++latest.current;
        void fetchPurchases('').then(result => apply(seq, '', result));
    }, [apply]);

    const load = (email: string) => {
        const seq = ++latest.current;
        setLoading(true);
        setLoadError(null);
        void fetchPurchases(email).then(result => apply(seq, email, result));
    };
    const showAll = () => {
        setQuery('');
        load('');
    };
    const replaceRow = (updated: AdminGuidePurchaseView) => {
        setPurchases(prev => prev.map(p => (p.id === updated.id ? updated : p)));
    };

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 16px' }}>
            <h1 style={{ ...heading, fontSize: 28, marginBottom: 20 }}>Guides</h1>
            <SearchForm value={query} busy={loading} canShowAll={searched !== ''} onChange={setQuery} onSearch={() => load(query.trim())} onShowAll={showAll} />
            {loadError && (
                <div style={{ ...card, padding: 32, textAlign: 'center', marginBottom: 24 }}>
                    <p style={{ ...sub, marginBottom: 12 }}>{loadError}</p>
                    <button type="button" onClick={() => load(searched)} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600, color: '#BE185D' }}>Try Again</button>
                </div>
            )}
            {!loadError && loading && <Spinner />}
            {!loadError && !loading && (
                <>
                    <Stats purchases={purchases} />
                    <PurchasesTable purchases={purchases} searched={searched} onRotated={replaceRow} />
                </>
            )}
        </div>
    );
}

function Spinner() {
    return (
        <div style={{ padding: '64px 16px', textAlign: 'center' }}>
            <div style={{ width: 48, height: 48, border: '3px solid #E8ECF0', borderTop: '3px solid #BE185D', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ ...sub, marginTop: 16 }}>Loading purchases…</p>
        </div>
    );
}

interface SearchFormProps {
    value: string;
    busy: boolean;
    canShowAll: boolean;
    onChange: (value: string) => void;
    onSearch: () => void;
    onShowAll: () => void;
}

function SearchForm({ value, busy, canShowAll, onChange, onSearch, onShowAll }: SearchFormProps) {
    return (
        <form
            role="search"
            onSubmit={e => { e.preventDefault(); onSearch(); }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}
        >
            <input
                type="search"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                aria-label="Reader email"
                placeholder="Reader email"
                value={value}
                onChange={e => onChange(e.target.value)}
                style={{ ...inputStyle, flex: '1 1 260px', maxWidth: 420 }}
            />
            <button type="submit" disabled={busy} style={{ ...primaryBtn, padding: '9px 16px', opacity: busy ? 0.6 : 1 }}>Search</button>
            {canShowAll && (
                <button type="button" onClick={onShowAll} disabled={busy} style={{ ...ghostBtn, padding: '9px 16px', opacity: busy ? 0.6 : 1 }}>Show all</button>
            )}
        </form>
    );
}

function Stats({ purchases }: { purchases: readonly AdminGuidePurchaseView[] }) {
    const active = purchases.filter(p => p.status === 'active').length;
    const stats = [
        { icon: <BookOpen size={18} />, label: 'Purchases', value: purchases.length, color: '#BE185D' },
        { icon: <CheckCircle2 size={18} />, label: 'Active', value: active, color: '#16A34A' },
        { icon: <XCircle size={18} />, label: 'Refunded or Disputed', value: purchases.length - active, color: '#EF4444' },
    ];
    return (
        <div className="grid grid-cols-3 gap-4" style={{ marginBottom: 24 }}>
            {stats.map(stat => (
                <div key={stat.label} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <div style={{ color: stat.color, marginBottom: 6 }}>{stat.icon}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#1A2E35' }}>{stat.value}</div>
                    <div style={muted}>{stat.label}</div>
                </div>
            ))}
        </div>
    );
}

interface PurchasesTableProps {
    purchases: readonly AdminGuidePurchaseView[];
    searched: string;
    onRotated: (updated: AdminGuidePurchaseView) => void;
}

function PurchasesTable({ purchases, searched, onRotated }: PurchasesTableProps) {
    return (
        <div style={card}>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ backgroundColor: '#F8FAF9' }}>
                            <th style={th}>Reader</th>
                            <th style={th}>Purchase</th>
                            <th style={th}>Downloads</th>
                            <th style={th}>Email sent</th>
                            <th style={th}>Bought</th>
                            <th style={th}>Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        {purchases.map(p => <PurchaseRow key={p.id} purchase={p} onRotated={onRotated} />)}
                        {purchases.length === 0 && (
                            <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 40 }}>{searched ? 'No purchases for this email.' : 'No purchases yet.'}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

interface PurchaseRowProps {
    purchase: AdminGuidePurchaseView;
    onRotated: (updated: AdminGuidePurchaseView) => void;
}

function PurchaseRow({ purchase, onRotated }: PurchaseRowProps) {
    const badge = STATUS_BADGE[purchase.status];
    const guides = `${purchase.guideCount} ${purchase.guideCount === 1 ? 'guide' : 'guides'}`;
    return (
        <tr>
            <td style={{ ...td, minWidth: 220 }}>
                <div style={{ ...strong, wordBreak: 'break-all' }}>{purchase.email ?? 'No email'}</div>
                <div style={{ ...muted, marginTop: 4 }}>{SOURCE_LABEL[purchase.source] ?? purchase.source}</div>
            </td>
            <td style={{ ...td, minWidth: 200 }}>
                <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, backgroundColor: badge.bg, color: badge.text, whiteSpace: 'nowrap' }}>{badge.label}</span>
                <div style={{ ...strong, marginTop: 8 }}>{purchase.productTitle}</div>
                <div style={{ ...muted, marginTop: 4 }}>{guides}, {purchase.amount}</div>
            </td>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>{purchase.downloadsUsed} of {purchase.downloadsAllowed}</td>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>{purchase.emailSentAt ? dateLabel(purchase.emailSentAt) : 'Not sent'}</td>
            <td style={{ ...td, whiteSpace: 'nowrap' }}>{dateLabel(purchase.createdAt)}</td>
            <td style={{ ...td, minWidth: 220 }}><NewLinkCell purchase={purchase} onRotated={onRotated} /></td>
        </tr>
    );
}

type LinkStep = 'idle' | 'confirming' | 'busy';

function NewLinkCell({ purchase, onRotated }: PurchaseRowProps) {
    const [step, setStep] = useState<LinkStep>('idle');
    const [outcome, setOutcome] = useState<LinkOutcome | null>(null);
    const newLinkRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    // Where focus goes after the next step change; never on the first render.
    const focusNext = useRef<'newLink' | 'cancel' | null>(null);

    useEffect(() => {
        const target = focusNext.current === 'cancel' ? cancelRef : focusNext.current === 'newLink' ? newLinkRef : null;
        focusNext.current = null;
        target?.current?.focus();
    }, [step]);

    const moveTo = (next: LinkStep, focus: 'newLink' | 'cancel' | null) => {
        focusNext.current = focus;
        setStep(next);
    };

    const replace = async () => {
        setStep('busy');
        const result = await postNewLink(purchase.id);
        if (result.ok) onRotated(result.purchase);
        setOutcome(result.ok ? outcomeFor(result.delivery) : { text: result.error, tone: 'error' });
        moveTo('idle', 'newLink');
    };

    return (
        <div>
            {step === 'idle' ? (
                <button ref={newLinkRef} type="button" onClick={() => { setOutcome(null); moveTo('confirming', 'cancel'); }} style={ghostBtn}>New link</button>
            ) : (
                <ConfirmReplace busy={step === 'busy'} cancelRef={cancelRef} onReplace={() => void replace()} onCancel={() => moveTo('idle', 'newLink')} />
            )}
            <div role="status" style={{ marginTop: outcome ? 8 : 0, fontSize: 12, fontWeight: 600, color: outcome ? TONE_COLOR[outcome.tone] : undefined }}>
                {outcome?.text}
            </div>
        </div>
    );
}

interface ConfirmReplaceProps {
    busy: boolean;
    cancelRef: React.RefObject<HTMLButtonElement | null>;
    onReplace: () => void;
    onCancel: () => void;
}

function ConfirmReplace({ busy, cancelRef, onReplace, onCancel }: ConfirmReplaceProps) {
    return (
        <div role="group" aria-label="Confirm new link" onKeyDown={e => { if (e.key === 'Escape' && !busy) onCancel(); }}>
            <div style={strong}>Replace the current link?</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button type="button" onClick={onReplace} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? 'Replacing…' : 'Replace'}</button>
                <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>Cancel</button>
            </div>
        </div>
    );
}

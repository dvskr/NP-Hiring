'use client';

/**
 * /admin/employer-plans — the Employer plan ($399/month) back office.
 *
 * Three jobs, in the order an admin actually needs them:
 *   1. ATTACH: the Stripe Payment Link only knows the checkout email. When
 *      it is not the employer's signup email the webhook stores the row
 *      unattached and alerts; this page is where a human finishes the match.
 *   2. GRANT: comp a plan (partner, make-good) without touching Stripe.
 *   3. EDIT: status / slots / period end for rows we own. Stripe-sourced
 *      rows can be edited too, but the next subscription webhook wins.
 *
 * Follows app/admin/company-claims/page.tsx: one client component, inline
 * admin styles, fetch → table → PATCH with optimistic row replacement.
 * Pricing values come from lib/config — never literals.
 */

import { useState, useEffect, type FormEvent } from 'react';
import { formatCT } from '@/lib/format-ct';
import { config } from '@/lib/config';
import { CreditCard, Link2, ShieldQuestion, UserX } from 'lucide-react';

/* ─── Types (mirror app/api/admin/employer-plans/plan-admin.ts) ─── */
interface EmployerPlan {
    id: string;
    userId: string | null;
    email: string;
    status: string;
    slots: number;
    priceCents: number;
    currentPeriodEnd: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    source: string;
    createdAt: string;
    updatedAt: string;
    used: number;
    entitled: boolean;
}

type PlanStatus = 'active' | 'past_due' | 'cancelled';
const STATUS_OPTIONS: PlanStatus[] = ['active', 'past_due', 'cancelled'];

/* ─── Styles (matched to admin/company-claims) ─── */
const card: React.CSSProperties = { backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' };
const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
const th: React.CSSProperties = { padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', borderBottom: '1px solid #E8ECF0', textAlign: 'left', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', color: '#6B7F8A', borderBottom: '1px solid #E8ECF0', verticalAlign: 'top' };
const inputStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', fontSize: '13px', backgroundColor: '#F8FAF9', border: '1px solid rgba(255,255,255,0.5)', color: '#1A2E35', outline: 'none' };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: '8px', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: '#BE185D', color: '#fff' };
const ghostBtn: React.CSSProperties = { ...primaryBtn, background: 'rgba(190,24,93,0.1)', color: '#BE185D' };

function badge(text: string, color: 'green' | 'gray' | 'red' | 'orange' | 'blue') {
    const colors = {
        green: { bg: 'rgba(34,197,94,0.12)', text: '#16A34A' },
        gray: { bg: 'rgba(148,163,184,0.12)', text: '#94A3B8' },
        red: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444' },
        orange: { bg: 'rgba(245,158,11,0.12)', text: '#F59E0B' },
        blue: { bg: 'rgba(59,130,246,0.12)', text: '#3B82F6' },
    };
    return <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, backgroundColor: colors[color].bg, color: colors[color].text, whiteSpace: 'nowrap' }}>{text}</span>;
}

function statusBadge(plan: EmployerPlan) {
    if (plan.status === 'cancelled') return badge('Cancelled', 'red');
    if (!plan.entitled) return badge('Lapsed', 'red');
    if (plan.status === 'past_due') return badge('Past due (grace)', 'orange');
    return badge('Active', 'green');
}

/** yyyy-mm-dd for a <input type="date"> default one month out. */
function defaultPeriodEndInput(): string {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
}

function toDateInput(iso: string): string {
    return iso.slice(0, 10);
}

interface PatchBody { status?: PlanStatus; slots?: number; currentPeriodEnd?: string; userEmail?: string }

export default function AdminEmployerPlansPage() {
    const [plans, setPlans] = useState<EmployerPlan[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ text: string; isError: boolean } | null>(null);
    const [filter, setFilter] = useState<'all' | 'unattached' | 'active' | 'lapsed'>('all');

    // Grant form
    const [grantEmail, setGrantEmail] = useState('');
    const [grantSlots, setGrantSlots] = useState(config.planSlots);
    const [grantPeriodEnd, setGrantPeriodEnd] = useState(defaultPeriodEndInput());
    const [granting, setGranting] = useState(false);

    // Per-row drafts (attach email / period end) keyed by plan id
    const [attachEmails, setAttachEmails] = useState<Record<string, string>>({});
    const [periodDrafts, setPeriodDrafts] = useState<Record<string, string>>({});

    useEffect(() => { void fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch('/api/admin/employer-plans');
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || `Request failed (${res.status})`);
            setPlans(data.plans);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load employer plans');
        } finally {
            setLoading(false);
        }
    };

    const showMsg = (text: string, isError: boolean) => {
        setActionMsg({ text, isError });
        setTimeout(() => setActionMsg(null), 5000);
    };

    const patch = async (id: string, body: PatchBody, okMsg: string) => {
        setBusyId(id);
        try {
            const res = await fetch(`/api/admin/employer-plans/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({} as { error?: string; plan?: EmployerPlan }));
            if (!res.ok || !data.plan) {
                showMsg(data.error || 'Update failed — please try again.', true);
                return;
            }
            const updated = data.plan as EmployerPlan;
            setPlans(prev => prev.map(p => (p.id === updated.id ? updated : p)));
            showMsg(okMsg, false);
        } catch {
            showMsg('Network error — please try again.', true);
        } finally {
            setBusyId(null);
        }
    };

    const grant = async (e: FormEvent) => {
        e.preventDefault();
        setGranting(true);
        try {
            const res = await fetch('/api/admin/employer-plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: grantEmail.trim(), slots: grantSlots, currentPeriodEnd: grantPeriodEnd, status: 'active' }),
            });
            const data = await res.json().catch(() => ({} as { error?: string; plan?: EmployerPlan; attached?: boolean }));
            if (!res.ok || !data.plan) {
                showMsg(data.error || 'Grant failed — please try again.', true);
                return;
            }
            const created = data.plan as EmployerPlan;
            // upsertPlan may have updated an existing row rather than created one.
            setPlans(prev => (prev.some(p => p.id === created.id)
                ? prev.map(p => (p.id === created.id ? created : p))
                : [created, ...prev]));
            setGrantEmail('');
            showMsg(
                data.attached
                    ? 'Plan granted and attached to the employer account.'
                    : 'Plan stored but no employer account has that email yet — attach it once they sign up.',
                false,
            );
        } catch {
            showMsg('Network error — please try again.', true);
        } finally {
            setGranting(false);
        }
    };

    const filtered = plans.filter(p => {
        if (filter === 'unattached') return p.userId === null;
        if (filter === 'active') return p.entitled;
        if (filter === 'lapsed') return !p.entitled;
        return true;
    });
    const unattachedCount = plans.filter(p => p.userId === null).length;
    const entitledCount = plans.filter(p => p.entitled).length;

    if (loading) {
        return (
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, border: '3px solid #E8ECF0', borderTop: '3px solid #BE185D', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ ...sub, marginTop: 16 }}>Loading employer plans…</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 16px' }}>
            <div style={{ marginBottom: 20 }}>
                <h1 style={{ ...heading, fontSize: 28, marginBottom: 4 }}>Employer Plans</h1>
                <p style={sub}>
                    ${config.planPrice}/month for {config.planSlots} active job slots. Stripe creates rows here from the
                    Payment Link; you attach the ones it could not match, and grant the ones Stripe never sees.
                </p>
            </div>

            <div style={{ ...card, padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <ShieldQuestion size={18} style={{ color: '#BE185D', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, color: '#4A5E6A', lineHeight: 1.6 }}>
                    <strong style={{ color: '#1A2E35' }}>Unattached means paid but unusable.</strong>{' '}
                    The Payment Link only knows the checkout email. If it differs from the employer&rsquo;s signup
                    email the row lands here without an account — they have paid and cannot post until you attach
                    it. Attaching re-publishes any paused plan posts within their slots.
                    <br />
                    <strong style={{ color: '#1A2E35' }}>Stripe wins on Stripe rows.</strong>{' '}
                    Status and period end you set on a <em>stripe</em>-sourced row are overwritten by the next
                    subscription webhook. Edit those in Stripe; edit <em>admin</em> rows here.
                </div>
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
                    <button onClick={() => void fetchData()} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600, color: '#BE185D' }}>Try Again</button>
                </div>
            )}

            {!loadError && (
                <>
                    <div className="grid grid-cols-3 gap-4" style={{ marginBottom: 24 }}>
                        {[
                            { icon: <CreditCard size={18} />, label: 'Total Plans', value: plans.length, color: '#BE185D' },
                            { icon: <Link2 size={18} />, label: 'Entitled Now', value: entitledCount, color: '#16A34A' },
                            { icon: <UserX size={18} />, label: 'Unattached', value: unattachedCount, color: '#F59E0B' },
                        ].map(stat => (
                            <div key={stat.label} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                <div style={{ color: stat.color, marginBottom: 6 }}>{stat.icon}</div>
                                <div style={{ fontSize: 22, fontWeight: 700, color: '#1A2E35' }}>{stat.value}</div>
                                <div style={muted}>{stat.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Grant form */}
                    <form onSubmit={grant} style={{ ...card, padding: '16px 20px', marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                        <div style={{ flex: '2 1 240px' }}>
                            <label htmlFor="grant-email" style={{ ...muted, display: 'block', marginBottom: 4 }}>Employer email (signup email attaches automatically)</label>
                            <input id="grant-email" type="email" required value={grantEmail} onChange={e => setGrantEmail(e.target.value)} placeholder="hiring@clinic.com" disabled={granting} style={{ ...inputStyle, width: '100%' }} />
                        </div>
                        <div style={{ flex: '0 1 110px' }}>
                            <label htmlFor="grant-slots" style={{ ...muted, display: 'block', marginBottom: 4 }}>Slots</label>
                            <input id="grant-slots" type="number" min={1} max={50} value={grantSlots} onChange={e => setGrantSlots(Number(e.target.value))} disabled={granting} style={{ ...inputStyle, width: '100%' }} />
                        </div>
                        <div style={{ flex: '0 1 170px' }}>
                            <label htmlFor="grant-period-end" style={{ ...muted, display: 'block', marginBottom: 4 }}>Period end</label>
                            <input id="grant-period-end" type="date" required value={grantPeriodEnd} onChange={e => setGrantPeriodEnd(e.target.value)} disabled={granting} style={{ ...inputStyle, width: '100%' }} />
                        </div>
                        <button type="submit" disabled={granting || !grantEmail.trim()} style={{ ...primaryBtn, padding: '9px 18px', opacity: granting || !grantEmail.trim() ? 0.4 : 1 }}>
                            {granting ? 'Saving…' : 'Grant plan'}
                        </button>
                    </form>

                    <div style={card}>
                        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E8ECF0', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 13, color: '#6B7F8A', fontWeight: 500 }}>Filter:</span>
                            <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="all">All ({plans.length})</option>
                                <option value="unattached">Unattached ({unattachedCount})</option>
                                <option value="active">Entitled ({entitledCount})</option>
                                <option value="lapsed">Lapsed / cancelled ({plans.length - entitledCount})</option>
                            </select>
                            <span style={{ ...muted, marginLeft: 'auto' }}>Showing {filtered.length}</span>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#F8FAF9' }}>
                                        <th style={th}>Email / account</th>
                                        <th style={th}>Status</th>
                                        <th style={th}>Slots</th>
                                        <th style={th}>Period end</th>
                                        <th style={th}>Source</th>
                                        <th style={th}>Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(p => {
                                        const busy = busyId === p.id;
                                        const periodDraft = periodDrafts[p.id] ?? toDateInput(p.currentPeriodEnd);
                                        const periodDirty = periodDraft !== toDateInput(p.currentPeriodEnd);
                                        return (
                                            <tr key={p.id}>
                                                <td style={{ ...td, minWidth: 240 }}>
                                                    <div style={{ color: '#1A2E35', fontWeight: 600, wordBreak: 'break-all' }}>{p.email}</div>
                                                    <div style={{ marginTop: 6 }}>
                                                        {p.userId ? badge('Attached', 'green') : badge('Unattached — cannot post', 'orange')}
                                                    </div>
                                                    {p.userId && <div style={{ ...muted, marginTop: 4, wordBreak: 'break-all' }}>{p.userId}</div>}
                                                    {!p.userId && (
                                                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                                            <input
                                                                type="email"
                                                                aria-label={`Employer signup email to attach ${p.email}`}
                                                                value={attachEmails[p.id] ?? ''}
                                                                onChange={e => setAttachEmails(prev => ({ ...prev, [p.id]: e.target.value }))}
                                                                placeholder="signup email"
                                                                disabled={busy}
                                                                style={{ ...inputStyle, padding: '6px 10px', fontSize: 12, flex: 1 }}
                                                            />
                                                            <button
                                                                onClick={() => void patch(p.id, { userEmail: (attachEmails[p.id] ?? p.email).trim() }, 'Attached — paused plan posts are back within their slots.')}
                                                                disabled={busy}
                                                                style={{ ...ghostBtn, opacity: busy ? 0.4 : 1 }}
                                                            >
                                                                {busy ? '…' : 'Attach'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ ...td, minWidth: 160 }}>
                                                    {statusBadge(p)}
                                                    <div style={{ marginTop: 8 }}>
                                                        <select
                                                            aria-label={`Set status for ${p.email}`}
                                                            value={p.status}
                                                            disabled={busy}
                                                            onChange={e => void patch(p.id, { status: e.target.value as PlanStatus }, `Status set to ${e.target.value}.`)}
                                                            style={{ ...inputStyle, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                                                        >
                                                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                    </div>
                                                </td>
                                                <td style={{ ...td, minWidth: 120 }}>
                                                    <div style={{ color: '#1A2E35', fontWeight: 600 }}>{p.used} of {p.slots} used</div>
                                                    <input
                                                        type="number"
                                                        aria-label={`Slots for ${p.email}`}
                                                        min={1}
                                                        max={50}
                                                        defaultValue={p.slots}
                                                        disabled={busy}
                                                        onBlur={e => {
                                                            const next = Number(e.target.value);
                                                            if (Number.isInteger(next) && next >= 1 && next !== p.slots) {
                                                                void patch(p.id, { slots: next }, `Slots set to ${next}.`);
                                                            }
                                                        }}
                                                        style={{ ...inputStyle, padding: '6px 10px', fontSize: 12, width: 80, marginTop: 8 }}
                                                    />
                                                </td>
                                                <td style={{ ...td, minWidth: 190 }}>
                                                    <div style={{ color: '#1A2E35' }}>{formatCT(p.currentPeriodEnd, 'date')}</div>
                                                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                                        <input
                                                            type="date"
                                                            aria-label={`Period end for ${p.email}`}
                                                            value={periodDraft}
                                                            disabled={busy}
                                                            onChange={e => setPeriodDrafts(prev => ({ ...prev, [p.id]: e.target.value }))}
                                                            style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                                                        />
                                                        {periodDirty && (
                                                            <button
                                                                onClick={() => void patch(p.id, { currentPeriodEnd: periodDraft }, 'Period end updated.')}
                                                                disabled={busy}
                                                                style={{ ...ghostBtn, opacity: busy ? 0.4 : 1 }}
                                                            >Save</button>
                                                        )}
                                                    </div>
                                                    <div style={{ ...muted, marginTop: 4 }}>+{config.planGraceDays}-day grace before posts pause</div>
                                                </td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                                    {p.source === 'stripe' ? badge('stripe', 'blue') : badge('admin', 'gray')}
                                                    {p.stripeSubscriptionId && (
                                                        <div style={{ ...muted, marginTop: 4, fontFamily: 'monospace' }}>{p.stripeSubscriptionId}</div>
                                                    )}
                                                </td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatCT(p.updatedAt, 'date')}</td>
                                            </tr>
                                        );
                                    })}
                                    {filtered.length === 0 && (
                                        <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 40, whiteSpace: 'normal' }}>
                                            {plans.length === 0
                                                ? 'No employer plans yet. Rows appear when someone subscribes through the Stripe Payment Link, or when you grant one above.'
                                                : 'No plans match this filter.'}
                                        </td></tr>
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

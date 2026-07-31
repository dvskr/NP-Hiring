'use client';

import { useState, useEffect } from 'react';
import { formatCT } from '@/lib/format-ct';
import { BadgeCheck, Building2, Clock, ShieldQuestion } from 'lucide-react';

/* ─── Types (mirror app/api/admin/company-claims/claim-select.ts) ─── */
interface ClaimCompany {
    name: string;
    normalizedName: string;
    website: string | null;
    isVerified: boolean;
    claimVerifiedAt: string | null;
}

interface CompanyClaim {
    id: string;
    companyId: string;
    claimantUserId: string;
    claimantEmail: string;
    claimantDomain: string;
    companyHost: string | null;
    domainMatch: boolean;
    freeEmailDomain: boolean;
    claimantRole: string | null;
    note: string | null;
    status: string;
    reviewedAt: string | null;
    reviewedBy: string | null;
    reviewNote: string | null;
    createdAt: string;
    company: ClaimCompany;
}

/* ─── Styles (matched to admin/testimonials) ─── */
const card: React.CSSProperties = { backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' };
const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
const th: React.CSSProperties = { padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', borderBottom: '1px solid #E8ECF0', textAlign: 'left', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', color: '#6B7F8A', borderBottom: '1px solid #E8ECF0', verticalAlign: 'top' };
const inputStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', fontSize: '13px', backgroundColor: '#F8FAF9', border: '1px solid rgba(255,255,255,0.5)', color: '#1A2E35', outline: 'none' };

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

/** Canonical public URL for a Company row. Legacy rows hold the space-form
 *  normalizedName ("life stance"); the profile resolver only falls back
 *  kebab→space, so emit the kebab form or the link 404s. */
function companyHref(normalizedName: string): string {
    return `/companies/${normalizedName.replace(/ /g, '-')}`;
}

export default function AdminCompanyClaimsPage() {
    const [claims, setClaims] = useState<CompanyClaim[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [actionMsg, setActionMsg] = useState<{ text: string; isError: boolean } | null>(null);

    useEffect(() => { void fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch('/api/admin/company-claims');
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || `Request failed (${res.status})`);
            }
            setClaims(data.claims);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load company claims');
        } finally {
            setLoading(false);
        }
    };

    const showMsg = (text: string, isError: boolean) => {
        setActionMsg({ text, isError });
        setTimeout(() => setActionMsg(null), 4000);
    };

    const review = async (id: string, action: 'approve' | 'reject', okMsg: string) => {
        setBusyId(id);
        try {
            const res = await fetch(`/api/admin/company-claims/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, reviewNote: notes[id]?.trim() || undefined }),
            });
            const data = await res.json().catch(() => ({} as { error?: string; claim?: CompanyClaim }));
            if (!res.ok || !data.claim) {
                showMsg(data.error || 'Update failed — please try again.', true);
                return;
            }
            const updated = data.claim as CompanyClaim;
            // The approval also changes Company.claimVerifiedAt, which every
            // other claim on the same company displays — refetch rather than
            // patching one row so the table can never show two disagreeing
            // views of the same company.
            setClaims(prev => prev.map(c => (
                c.id === updated.id
                    ? updated
                    : c.companyId === updated.companyId
                        ? { ...c, company: { ...c.company, claimVerifiedAt: updated.company.claimVerifiedAt } }
                        : c
            )));
            showMsg(okMsg, false);
        } catch {
            showMsg('Network error — please try again.', true);
        } finally {
            setBusyId(null);
        }
    };

    const filtered = claims.filter(c => (filter === 'all' ? true : c.status === filter));
    const countBy = (status: string) => claims.filter(c => c.status === status).length;
    const pendingCount = countBy('pending');
    const approvedCount = countBy('approved');

    if (loading) {
        return (
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, border: '3px solid #E8ECF0', borderTop: '3px solid #BE185D', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ ...sub, marginTop: 16 }}>Loading company claims…</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 16px' }}>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
                <h1 style={{ ...heading, fontSize: 28, marginBottom: 4 }}>Employer Profile Claims</h1>
                <p style={sub}>
                    An employer asking to be recognised as the owner of a company profile.
                    Nothing is public until you approve it here.
                </p>
            </div>

            {/* The one thing an admin must not get wrong. */}
            <div style={{ ...card, padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <ShieldQuestion size={18} style={{ color: '#BE185D', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, color: '#4A5E6A', lineHeight: 1.6 }}>
                    <strong style={{ color: '#1A2E35' }}>Two different badges, two different claims.</strong>{' '}
                    <em>Pipeline verified</em> means only that the ingest pipeline matched the scraped
                    employer name against its known-employer map — it is not evidence about the person
                    in front of you, and approving a claim never changes it.{' '}
                    <em>Claimed</em> is the badge this queue sets, and it asserts exactly one thing: an
                    employer asked for this profile and an admin agreed.
                    <br />
                    <strong style={{ color: '#1A2E35' }}>Domain match is a signal, not a decision.</strong>{' '}
                    A match can be produced by anyone who receives mail at that domain; a non-match is
                    routine for staffing agencies, multi-brand health systems, small practices on
                    consumer email, and every profile whose website we never captured. Read the claim.
                </div>
            </div>

            {/* Action message */}
            {actionMsg && (
                <div role="status" style={{
                    marginBottom: 16, padding: '12px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    backgroundColor: actionMsg.isError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: actionMsg.isError ? '#F87171' : '#16A34A',
                }}>{actionMsg.text}</div>
            )}

            {/* Load error */}
            {loadError && (
                <div style={{ ...card, padding: 32, textAlign: 'center', marginBottom: 24 }}>
                    <p style={{ ...sub, marginBottom: 12 }}>{loadError}</p>
                    <button onClick={() => void fetchData()} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600, color: '#BE185D' }}>
                        Try Again
                    </button>
                </div>
            )}

            {!loadError && (
                <>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-3 gap-4" style={{ marginBottom: 24 }}>
                        {[
                            { icon: <Building2 size={18} />, label: 'Total Claims', value: claims.length, color: '#BE185D' },
                            { icon: <Clock size={18} />, label: 'Awaiting Review', value: pendingCount, color: '#F59E0B' },
                            { icon: <BadgeCheck size={18} />, label: 'Approved', value: approvedCount, color: '#16A34A' },
                        ].map(stat => (
                            <div key={stat.label} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                                <div style={{ color: stat.color, marginBottom: 6 }}>{stat.icon}</div>
                                <div style={{ fontSize: 22, fontWeight: 700, color: '#1A2E35' }}>{stat.value}</div>
                                <div style={muted}>{stat.label}</div>
                            </div>
                        ))}
                    </div>

                    <div style={card}>
                        {/* Filter bar */}
                        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E8ECF0', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 13, color: '#6B7F8A', fontWeight: 500 }}>Filter:</span>
                            <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="pending">Pending ({pendingCount})</option>
                                <option value="approved">Approved ({approvedCount})</option>
                                <option value="rejected">Rejected ({countBy('rejected')})</option>
                                <option value="all">All ({claims.length})</option>
                            </select>
                            <span style={{ ...muted, marginLeft: 'auto' }}>Showing {filtered.length}</span>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#F8FAF9' }}>
                                        <th style={th}>Employer</th>
                                        <th style={th}>Claimant</th>
                                        <th style={th}>Domain signal</th>
                                        <th style={th}>Their note</th>
                                        <th style={th}>Submitted</th>
                                        <th style={th}>Status</th>
                                        <th style={{ ...th, textAlign: 'center' }}>Decision</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(c => {
                                        const busy = busyId === c.id;
                                        const isPending = c.status === 'pending';
                                        const claimed = c.company.claimVerifiedAt !== null;
                                        return (
                                            <tr key={c.id}>
                                                <td style={{ ...td, fontWeight: 600, color: '#1A2E35', minWidth: 180 }}>
                                                    <a
                                                        href={companyHref(c.company.normalizedName)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: '#BE185D', textDecoration: 'none' }}
                                                    >
                                                        {c.company.name}
                                                    </a>
                                                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                        {c.company.isVerified && badge('Pipeline verified', 'blue')}
                                                        {claimed && badge('Claimed', 'green')}
                                                    </div>
                                                    <div style={{ ...muted, fontWeight: 400, marginTop: 4 }}>
                                                        {c.company.website
                                                            ? c.company.website.replace(/^https?:\/\//, '')
                                                            : 'no website on file'}
                                                    </div>
                                                </td>
                                                <td style={{ ...td, minWidth: 180 }}>
                                                    <div style={{ color: '#1A2E35', fontWeight: 600, wordBreak: 'break-all' }}>{c.claimantEmail}</div>
                                                    {c.claimantRole && (
                                                        <div style={{ ...muted, marginTop: 2 }}>{c.claimantRole}</div>
                                                    )}
                                                </td>
                                                <td style={{ ...td, minWidth: 170 }}>
                                                    {c.domainMatch
                                                        ? badge('Domain match', 'green')
                                                        : badge('No domain match', 'gray')}
                                                    {c.freeEmailDomain && (
                                                        <div style={{ marginTop: 4 }}>{badge('Consumer mailbox', 'orange')}</div>
                                                    )}
                                                    <div style={{ ...muted, marginTop: 6, lineHeight: 1.5 }}>
                                                        {c.claimantDomain} vs {c.companyHost ?? '(no website)'}
                                                    </div>
                                                </td>
                                                <td style={{ ...td, minWidth: 200, maxWidth: 320, whiteSpace: 'normal', lineHeight: 1.5, color: '#4A5E6A' }}>
                                                    {c.note || <span style={muted}>—</span>}
                                                    {c.reviewNote && (
                                                        <div style={{ ...muted, marginTop: 6 }}>Review note: {c.reviewNote}</div>
                                                    )}
                                                </td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatCT(c.createdAt, 'date')}</td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                                    {c.status === 'pending' && badge('Pending', 'orange')}
                                                    {c.status === 'approved' && badge('Approved', 'green')}
                                                    {c.status === 'rejected' && badge('Rejected', 'red')}
                                                    {c.reviewedAt && (
                                                        <div style={{ ...muted, marginTop: 4 }}>{formatCT(c.reviewedAt, 'date')}</div>
                                                    )}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center', minWidth: 210 }}>
                                                    <label htmlFor={`note-${c.id}`} style={{ ...muted, display: 'block', textAlign: 'left', marginBottom: 4 }}>
                                                        Internal review note (optional)
                                                    </label>
                                                    <input
                                                        id={`note-${c.id}`}
                                                        type="text"
                                                        value={notes[c.id] ?? ''}
                                                        onChange={e => setNotes(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                        placeholder="What did you check?"
                                                        disabled={busy}
                                                        style={{ ...inputStyle, width: '100%', padding: '6px 10px', fontSize: 12, marginBottom: 8 }}
                                                    />
                                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                                                        <button
                                                            onClick={() => void review(c.id, 'approve', 'Claim approved — the Claimed badge is now live on that profile.')}
                                                            disabled={busy || c.status === 'approved'}
                                                            style={{
                                                                padding: '7px 14px', borderRadius: '8px', fontSize: 12, fontWeight: 700,
                                                                border: 'none', cursor: busy || c.status === 'approved' ? 'default' : 'pointer',
                                                                background: '#BE185D', color: '#fff',
                                                                opacity: busy || c.status === 'approved' ? 0.4 : 1,
                                                            }}
                                                        >
                                                            {busy ? 'Saving…' : 'Approve'}
                                                        </button>
                                                        <button
                                                            onClick={() => void review(
                                                                c.id,
                                                                'reject',
                                                                isPending
                                                                    ? 'Claim rejected.'
                                                                    : 'Claim rejected — the Claimed badge was pulled from that profile.',
                                                            )}
                                                            disabled={busy || c.status === 'rejected'}
                                                            style={{
                                                                padding: '7px 14px', borderRadius: '8px', fontSize: 12, fontWeight: 700,
                                                                border: 'none', cursor: busy || c.status === 'rejected' ? 'default' : 'pointer',
                                                                background: 'rgba(239,68,68,0.1)', color: '#EF4444',
                                                                opacity: busy || c.status === 'rejected' ? 0.4 : 1,
                                                            }}
                                                        >
                                                            {c.status === 'approved' ? 'Revoke' : 'Reject'}
                                                        </button>
                                                    </div>
                                                    {c.status === 'approved' && (
                                                        <div style={{ ...muted, marginTop: 6, textAlign: 'left', lineHeight: 1.5 }}>
                                                            Revoking clears the Claimed badge unless another approved
                                                            claim still stands for this employer.
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filtered.length === 0 && (
                                        <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 40, whiteSpace: 'normal' }}>
                                            {claims.length === 0
                                                ? 'No profile claims yet. Employers start one from the “Claim this profile” card on a company page.'
                                                : 'No claims match this filter.'}
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

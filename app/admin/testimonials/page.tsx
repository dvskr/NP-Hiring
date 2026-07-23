'use client';

import { useState, useEffect } from 'react';
import { formatCT } from '@/lib/format-ct';
import { Quote, Star, CheckCircle2, Clock } from 'lucide-react';

/* ─── Types ─── */
interface Testimonial {
    id: string;
    userId: string;
    employerJobId: string | null;
    employerName: string;
    content: string;
    rating: number | null;
    consent: boolean;
    displayAs: string;
    featuredAt: string | null;
    createdAt: string;
}

/* ─── Consent semantics (mirrors /api/admin/testimonials/[id]) ───
   displayAs may only be narrowed toward more privacy, never widened
   beyond what the employer consented to at submission time. */
const PRIVACY_RANK: Record<string, number> = { anonymous: 0, initial: 1, full: 2 };
const DISPLAY_OPTIONS = [
    { key: 'full', label: 'Full Name' },
    { key: 'initial', label: 'First + Last Initial' },
    { key: 'anonymous', label: 'Anonymous' },
] as const;

/** Public attribution preview — must match components/FeaturedTestimonials.tsx. */
function attributionPreview(employerName: string, displayAs: string): string {
    const name = employerName.trim();
    if (!name || name.includes('@')) return 'Verified employer';
    if (displayAs === 'anonymous') return 'Verified employer';
    if (displayAs === 'full') return name;
    const words = name.split(/\s+/);
    if (words.length === 1) return words[0];
    return `${words[0]} ${words[1][0].toUpperCase()}.`;
}

/* ─── Styles (matched to admin/users) ─── */
const card: React.CSSProperties = { backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' };
const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
const th: React.CSSProperties = { padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', borderBottom: '1px solid #E8ECF0', textAlign: 'left', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', color: '#6B7F8A', borderBottom: '1px solid #E8ECF0', verticalAlign: 'top' };
const inputStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', fontSize: '13px', backgroundColor: '#F8FAF9', border: '1px solid rgba(255,255,255,0.5)', color: '#1A2E35', outline: 'none' };

function badge(text: string, color: 'green' | 'gray' | 'red' | 'orange') {
    const colors = {
        green: { bg: 'rgba(34,197,94,0.12)', text: '#22C55E' },
        gray: { bg: 'rgba(148,163,184,0.12)', text: '#94A3B8' },
        red: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444' },
        orange: { bg: 'rgba(245,158,11,0.12)', text: '#F59E0B' },
    };
    return <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, backgroundColor: colors[color].bg, color: colors[color].text, whiteSpace: 'nowrap' }}>{text}</span>;
}

export default function AdminTestimonialsPage() {
    const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'featured' | 'unfeatured'>('all');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ text: string; isError: boolean } | null>(null);

    useEffect(() => { void fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch('/api/admin/testimonials');
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || `Request failed (${res.status})`);
            }
            setTestimonials(data.testimonials);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load testimonials');
        } finally {
            setLoading(false);
        }
    };

    const showMsg = (text: string, isError: boolean) => {
        setActionMsg({ text, isError });
        setTimeout(() => setActionMsg(null), 4000);
    };

    const patchTestimonial = async (id: string, patch: { featured?: boolean; displayAs?: string }, okMsg: string) => {
        setBusyId(id);
        try {
            const res = await fetch(`/api/admin/testimonials/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            const data = await res.json().catch(() => ({} as { error?: string; testimonial?: Testimonial }));
            if (!res.ok || !data.testimonial) {
                showMsg(data.error || 'Update failed — please try again.', true);
                return;
            }
            setTestimonials(prev => prev.map(t => (t.id === id ? { ...t, ...data.testimonial } : t)));
            showMsg(okMsg, false);
        } catch {
            showMsg('Network error — please try again.', true);
        } finally {
            setBusyId(null);
        }
    };

    const filtered = testimonials.filter(t => {
        if (filter === 'featured') return t.featuredAt !== null;
        if (filter === 'unfeatured') return t.featuredAt === null;
        return true;
    });

    const featuredCount = testimonials.filter(t => t.featuredAt !== null).length;
    const awaitingCount = testimonials.filter(t => t.featuredAt === null && t.consent).length;

    if (loading) {
        return (
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, border: '3px solid #E8ECF0', borderTop: '3px solid #BE185D', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ ...sub, marginTop: 16 }}>Loading testimonials…</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ ...heading, fontSize: 28, marginBottom: 4 }}>Employer Testimonials</h1>
                <p style={sub}>Review submissions and approve them for the public For Employers page. Attribution can only be narrowed, never widened beyond what the employer consented to.</p>
            </div>

            {/* Action message */}
            {actionMsg && (
                <div role="status" style={{
                    marginBottom: 16, padding: '12px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    backgroundColor: actionMsg.isError ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                    color: actionMsg.isError ? '#F87171' : '#22C55E',
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
                            { icon: <Quote size={18} />, label: 'Total Submissions', value: testimonials.length, color: '#BE185D' },
                            { icon: <CheckCircle2 size={18} />, label: 'Featured', value: featuredCount, color: '#22C55E' },
                            { icon: <Clock size={18} />, label: 'Awaiting Review', value: awaitingCount, color: '#F59E0B' },
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
                                <option value="all">All ({testimonials.length})</option>
                                <option value="featured">Featured ({featuredCount})</option>
                                <option value="unfeatured">Not Featured ({testimonials.length - featuredCount})</option>
                            </select>
                            <span style={{ ...muted, marginLeft: 'auto' }}>Showing {filtered.length}</span>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#F8FAF9' }}>
                                        <th style={th}>Employer</th>
                                        <th style={th}>Testimonial</th>
                                        <th style={th}>Rating</th>
                                        <th style={th}>Display As</th>
                                        <th style={th}>Consent</th>
                                        <th style={th}>Submitted</th>
                                        <th style={th}>Status</th>
                                        <th style={{ ...th, textAlign: 'center' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(t => {
                                        const isFeatured = t.featuredAt !== null;
                                        const busy = busyId === t.id;
                                        const currentRank = PRIVACY_RANK[t.displayAs] ?? PRIVACY_RANK.initial;
                                        const allowedOptions = DISPLAY_OPTIONS.filter(o => PRIVACY_RANK[o.key] <= currentRank);
                                        return (
                                            <tr key={t.id}>
                                                <td style={{ ...td, fontWeight: 600, color: '#1A2E35', whiteSpace: 'nowrap' }}>
                                                    {t.employerName}
                                                    <div style={{ ...muted, fontWeight: 400, marginTop: 2 }}>
                                                        Shows as: {attributionPreview(t.employerName, t.displayAs)}
                                                    </div>
                                                </td>
                                                <td style={{ ...td, minWidth: 260, maxWidth: 420, whiteSpace: 'normal', lineHeight: 1.5, color: '#4A5E6A' }}>
                                                    {t.content}
                                                </td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                                    {t.rating ? (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                            <Star size={13} fill="#F59E0B" style={{ color: '#F59E0B' }} />
                                                            <span style={{ fontWeight: 600, color: '#1A2E35' }}>{t.rating}/5</span>
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                                    <select
                                                        value={t.displayAs}
                                                        disabled={busy || allowedOptions.length <= 1}
                                                        onChange={e => void patchTestimonial(t.id, { displayAs: e.target.value }, 'Attribution narrowed')}
                                                        aria-label={`Attribution for testimonial from ${t.employerName}`}
                                                        style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, cursor: allowedOptions.length > 1 ? 'pointer' : 'default' }}
                                                    >
                                                        {allowedOptions.map(o => (
                                                            <option key={o.key} value={o.key}>{o.label}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td style={td}>{t.consent ? badge('Consented', 'green') : badge('No consent', 'red')}</td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatCT(t.createdAt, 'date')}</td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                                    {isFeatured
                                                        ? <>{badge('Featured', 'green')}<div style={{ ...muted, marginTop: 4 }}>{formatCT(t.featuredAt, 'date')}</div></>
                                                        : t.consent ? badge('Pending', 'orange') : badge('Internal only', 'gray')}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    {t.consent ? (
                                                        <button
                                                            onClick={() => void patchTestimonial(
                                                                t.id,
                                                                { featured: !isFeatured },
                                                                isFeatured ? 'Removed from public display' : 'Approved for public display'
                                                            )}
                                                            disabled={busy}
                                                            style={{
                                                                padding: '7px 16px', borderRadius: '8px', fontSize: 12, fontWeight: 700,
                                                                border: 'none', cursor: busy ? 'wait' : 'pointer',
                                                                background: isFeatured ? 'rgba(239,68,68,0.1)' : '#BE185D',
                                                                color: isFeatured ? '#EF4444' : '#fff',
                                                                opacity: busy ? 0.6 : 1,
                                                            }}
                                                        >
                                                            {busy ? 'Saving…' : isFeatured ? 'Unfeature' : 'Feature'}
                                                        </button>
                                                    ) : (
                                                        <span style={muted}>—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filtered.length === 0 && (
                                        <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 40, whiteSpace: 'normal' }}>
                                            {testimonials.length === 0
                                                ? 'No testimonials submitted yet. Employers share stories from their dashboard.'
                                                : 'No testimonials match this filter.'}
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

'use client';

import { useState, useEffect } from 'react';
import { Building2, Briefcase, ShieldQuestion, Tags } from 'lucide-react';

/* ─── Types (mirror app/api/admin/companies/company-select.ts) ─── */
type RecruitmentType = 'direct_hire' | 'staffing_agency';

interface AdminCompany {
    id: string;
    name: string;
    normalizedName: string;
    website: string | null;
    isVerified: boolean;
    claimVerifiedAt: string | null;
    recruitmentType: RecruitmentType | null;
    jobCount: number;
    _count: { jobs: number };
}

/* ─── Styles (matched to admin/company-claims) ─── */
const card: React.CSSProperties = { backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' };
const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
const th: React.CSSProperties = { padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', borderBottom: '1px solid #E8ECF0', textAlign: 'left', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', color: '#6B7F8A', borderBottom: '1px solid #E8ECF0', verticalAlign: 'top' };
const inputStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', fontSize: '13px', backgroundColor: '#F8FAF9', border: '1px solid rgba(255,255,255,0.5)', color: '#1A2E35', outline: 'none' };

function badge(text: string, color: 'green' | 'gray' | 'red' | 'orange' | 'blue' | 'purple') {
    const colors = {
        green: { bg: 'rgba(34,197,94,0.12)', text: '#16A34A' },
        gray: { bg: 'rgba(148,163,184,0.12)', text: '#94A3B8' },
        red: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444' },
        orange: { bg: 'rgba(245,158,11,0.12)', text: '#F59E0B' },
        blue: { bg: 'rgba(59,130,246,0.12)', text: '#3B82F6' },
        purple: { bg: 'rgba(147,51,234,0.12)', text: '#9333EA' },
    };
    return <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, backgroundColor: colors[color].bg, color: colors[color].text, whiteSpace: 'nowrap' }}>{text}</span>;
}

/** Canonical public URL for a Company row (same legacy-space-form guard as
 *  the claims queue — see admin/company-claims/page.tsx companyHref). */
function companyHref(normalizedName: string): string {
    return `/companies/${normalizedName.replace(/ /g, '-')}`;
}

type ClassFilter = 'unclassified' | 'direct_hire' | 'staffing_agency' | 'all';

export default function AdminCompaniesPage() {
    const [companies, setCompanies] = useState<AdminCompany[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [filter, setFilter] = useState<ClassFilter>('unclassified');
    const [search, setSearch] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ text: string; isError: boolean } | null>(null);

    useEffect(() => { void fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch('/api/admin/companies');
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || `Request failed (${res.status})`);
            }
            setCompanies(data.companies);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load companies');
        } finally {
            setLoading(false);
        }
    };

    const showMsg = (text: string, isError: boolean) => {
        setActionMsg({ text, isError });
        setTimeout(() => setActionMsg(null), 4000);
    };

    const classify = async (id: string, recruitmentType: RecruitmentType | null, okMsg: string) => {
        setBusyId(id);
        try {
            const res = await fetch(`/api/admin/companies/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recruitmentType }),
            });
            const data = await res.json().catch(() => ({} as { error?: string; company?: AdminCompany }));
            if (!res.ok || !data.company) {
                showMsg(data.error || 'Update failed — please try again.', true);
                return;
            }
            const updated = data.company as AdminCompany;
            setCompanies(prev => prev.map(c => (c.id === updated.id ? updated : c)));
            showMsg(okMsg, false);
        } catch {
            showMsg('Network error — please try again.', true);
        } finally {
            setBusyId(null);
        }
    };

    const searchNeedle = search.trim().toLowerCase();
    const filtered = companies.filter(c => {
        const matchesClass =
            filter === 'all' ? true
            : filter === 'unclassified' ? c.recruitmentType === null
            : c.recruitmentType === filter;
        const matchesSearch = searchNeedle === '' || c.name.toLowerCase().includes(searchNeedle);
        return matchesClass && matchesSearch;
    });
    const unclassifiedCount = companies.filter(c => c.recruitmentType === null).length;
    const directCount = companies.filter(c => c.recruitmentType === 'direct_hire').length;
    const staffingCount = companies.filter(c => c.recruitmentType === 'staffing_agency').length;

    if (loading) {
        return (
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, border: '3px solid #E8ECF0', borderTop: '3px solid #BE185D', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ ...sub, marginTop: 16 }}>Loading companies…</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 16px' }}>
            {/* Header */}
            <div style={{ marginBottom: 20 }}>
                <h1 style={{ ...heading, fontSize: 28, marginBottom: 4 }}>Companies — Employer Type</h1>
                <p style={sub}>
                    Classify each company as a direct employer or a staffing agency. The list is
                    sorted by active job count — working top-down covers the most live inventory
                    per decision. Unclassified companies show no badge anywhere.
                </p>
            </div>

            {/* The one thing an admin must not get wrong. */}
            <div style={{ ...card, padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <ShieldQuestion size={18} style={{ color: '#BE185D', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, color: '#4A5E6A', lineHeight: 1.6 }}>
                    <strong style={{ color: '#1A2E35' }}>Classify only what you have verified yourself.</strong>{' '}
                    Nothing here is inferred — check the company&apos;s own site: does it hire clinicians
                    onto its own staff (<em>direct employer</em>), or recruit and place them with client
                    organizations (<em>staffing agency</em>)? Name keywords and job-ad wording are not
                    evidence. If you are not sure, leave it unclassified — an unclassified company shows
                    no badge, which is honest; a wrong badge is a public claim about a named organization.
                    <br />
                    <strong style={{ color: '#1A2E35' }}>Neither label is a warning.</strong>{' '}
                    Agencies and direct employers both post legitimate roles; the label exists so
                    candidates can filter by preference, not so we can rank one above the other.
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
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" style={{ marginBottom: 24 }}>
                        {[
                            { icon: <Building2 size={18} />, label: 'Companies', value: companies.length, color: '#BE185D' },
                            { icon: <Tags size={18} />, label: 'Unclassified', value: unclassifiedCount, color: '#F59E0B' },
                            { icon: <Briefcase size={18} />, label: 'Direct employers', value: directCount, color: '#16A34A' },
                            { icon: <Building2 size={18} />, label: 'Staffing agencies', value: staffingCount, color: '#9333EA' },
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
                        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E8ECF0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <label htmlFor="company-class-filter" style={{ fontSize: 13, color: '#6B7F8A', fontWeight: 500 }}>Show:</label>
                            <select id="company-class-filter" value={filter} onChange={e => setFilter(e.target.value as ClassFilter)} style={{ ...inputStyle, cursor: 'pointer' }}>
                                <option value="unclassified">Unclassified ({unclassifiedCount})</option>
                                <option value="direct_hire">Direct employers ({directCount})</option>
                                <option value="staffing_agency">Staffing agencies ({staffingCount})</option>
                                <option value="all">All ({companies.length})</option>
                            </select>
                            <input
                                type="search"
                                aria-label="Search companies by name"
                                placeholder="Search by name…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{ ...inputStyle, minWidth: 200 }}
                            />
                            <span style={{ ...muted, marginLeft: 'auto' }}>Showing {filtered.length}</span>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#F8FAF9' }}>
                                        <th style={th}>Company</th>
                                        <th style={th}>Active jobs</th>
                                        <th style={th}>Lifetime jobs</th>
                                        <th style={th}>Employer type</th>
                                        <th style={{ ...th, textAlign: 'center' }}>Classify</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(c => {
                                        const busy = busyId === c.id;
                                        return (
                                            <tr key={c.id}>
                                                <td style={{ ...td, fontWeight: 600, color: '#1A2E35', minWidth: 200 }}>
                                                    <a
                                                        href={companyHref(c.normalizedName)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: '#BE185D', textDecoration: 'none' }}
                                                    >
                                                        {c.name}
                                                    </a>
                                                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                        {c.isVerified && badge('Pipeline verified', 'blue')}
                                                        {c.claimVerifiedAt !== null && badge('Claimed', 'green')}
                                                    </div>
                                                    <div style={{ ...muted, fontWeight: 400, marginTop: 4 }}>
                                                        {c.website
                                                            ? c.website.replace(/^https?:\/\//, '')
                                                            : 'no website on file'}
                                                    </div>
                                                </td>
                                                <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600, color: '#1A2E35' }}>{c._count.jobs}</td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.jobCount}</td>
                                                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                                    {c.recruitmentType === 'direct_hire' && badge('Direct employer', 'green')}
                                                    {c.recruitmentType === 'staffing_agency' && badge('Staffing agency', 'purple')}
                                                    {c.recruitmentType === null && badge('Unclassified', 'gray')}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center', minWidth: 250 }}>
                                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                                                        <button
                                                            onClick={() => void classify(c.id, 'direct_hire', `${c.name} classified as a direct employer — badge and filter placement are now live.`)}
                                                            disabled={busy || c.recruitmentType === 'direct_hire'}
                                                            style={{
                                                                padding: '7px 14px', borderRadius: '8px', fontSize: 12, fontWeight: 700,
                                                                border: 'none', cursor: busy || c.recruitmentType === 'direct_hire' ? 'default' : 'pointer',
                                                                background: '#BE185D', color: '#fff',
                                                                opacity: busy || c.recruitmentType === 'direct_hire' ? 0.4 : 1,
                                                            }}
                                                        >
                                                            {busy ? 'Saving…' : 'Direct'}
                                                        </button>
                                                        <button
                                                            onClick={() => void classify(c.id, 'staffing_agency', `${c.name} classified as a staffing agency — badge and filter placement are now live.`)}
                                                            disabled={busy || c.recruitmentType === 'staffing_agency'}
                                                            style={{
                                                                padding: '7px 14px', borderRadius: '8px', fontSize: 12, fontWeight: 700,
                                                                border: 'none', cursor: busy || c.recruitmentType === 'staffing_agency' ? 'default' : 'pointer',
                                                                background: 'rgba(147,51,234,0.12)', color: '#9333EA',
                                                                opacity: busy || c.recruitmentType === 'staffing_agency' ? 0.4 : 1,
                                                            }}
                                                        >
                                                            {busy ? 'Saving…' : 'Staffing'}
                                                        </button>
                                                        <button
                                                            onClick={() => void classify(c.id, null, `${c.name} is unclassified again — its badge is gone and it no longer matches either filter.`)}
                                                            disabled={busy || c.recruitmentType === null}
                                                            style={{
                                                                padding: '7px 14px', borderRadius: '8px', fontSize: 12, fontWeight: 700,
                                                                border: 'none', cursor: busy || c.recruitmentType === null ? 'default' : 'pointer',
                                                                background: 'rgba(148,163,184,0.15)', color: '#64748B',
                                                                opacity: busy || c.recruitmentType === null ? 0.4 : 1,
                                                            }}
                                                        >
                                                            Clear
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filtered.length === 0 && (
                                        <tr><td colSpan={5} style={{ ...td, textAlign: 'center', padding: 40, whiteSpace: 'normal' }}>
                                            {companies.length === 0
                                                ? 'No companies yet — rows appear here as the ingest pipeline links jobs to employers.'
                                                : 'No companies match this filter.'}
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

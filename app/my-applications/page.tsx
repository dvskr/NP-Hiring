'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Clock, ChevronRight, AlertCircle, Trash2, Loader2, ArrowRight, FileCheck, MapPin, RefreshCw } from 'lucide-react';
import { brand } from '@/config/brand';

interface Application {
    id: string;
    appliedAt: string;
    status: string;
    coverLetter: string | null;
    resumeUrl: string | null;
    withdrawnAt: string | null;
    job: {
        id: string;
        title: string;
        slug: string | null;
        employer: string;
        location: string;
        jobType: string | null;
        mode: string | null;
        displaySalary: string | null;
        isPublished: boolean;
    };
}

/* ═══════════════════════════════════════════
   CLAY DESIGN TOKENS
   ═══════════════════════════════════════════ */
const cardBase: React.CSSProperties = {
    background: '#F7FBF8',
    borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '8px 8px 20px rgba(0,0,0,0.07), -4px -4px 12px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.02)',
};

const cardRecessed: React.CSSProperties = {
    background: '#EDF5F0',
    borderRadius: '14px',
    border: '1px solid #D5E8E0',
    boxShadow: 'inset 2px 2px 6px rgba(0,60,50,0.06), inset -1px -1px 3px rgba(255,255,255,0.5)',
};

const clayPill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '5px 14px', borderRadius: '20px',
    fontSize: '12px', fontWeight: 600,
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '3px 3px 8px rgba(0,0,0,0.05), -2px -2px 6px rgba(255,255,255,0.8), inset 1px 1px 3px rgba(255,255,255,0.6)',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    applied: { label: 'Applied', color: '#6B7280', bg: '#EDF2EE' },
    screening: { label: 'Screening', color: '#D97706', bg: '#FEF3C7' },
    interview: { label: 'Interview', color: '#2563EB', bg: '#DBEAFE' },
    offered: { label: 'Offered', color: '#7C3AED', bg: '#EDE9FE' },
    hired: { label: 'Hired', color: '#059669', bg: '#D1FAE5' },
    rejected: { label: 'Not Selected', color: '#DC2626', bg: '#FEE2E2' },
    withdrawn: { label: 'Withdrawn', color: '#9CA3AF', bg: '#F3F4F6' },
};

const PIPELINE_STEPS = ['applied', 'screening', 'interview', 'offered', 'hired'] as const;

function formatDate(date: string) {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
    });
}

export default function MyApplicationsPage() {
    const [applications, setApplications] = useState<Application[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /**
     * B57: every load failure used to render as "Please sign in" — a 500,
     * a network drop, and a genuine 401 were indistinguishable, sending
     * already-signed-in users to the login page for no reason. 'auth' only
     * when the API actually returns 401; anything else is 'load' and gets
     * a Retry button instead of a sign-in link.
     */
    const [errorKind, setErrorKind] = useState<'auth' | 'load' | null>(null);
    const [withdrawing, setWithdrawing] = useState<string | null>(null);
    const [withdrawError, setWithdrawError] = useState<string | null>(null);

    const loadApplications = useCallback(async () => {
        setLoading(true);
        setError(null);
        setErrorKind(null);
        try {
            const res = await fetch('/api/applications');
            if (res.status === 401) {
                setErrorKind('auth');
                setError('Please sign in to view your applications.');
                return;
            }
            if (!res.ok) {
                throw new Error(`Applications request failed (${res.status})`);
            }
            const data = await res.json();
            setApplications(data);
        } catch {
            setErrorKind('load');
            setError('We couldn’t load your applications — check your connection and try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadApplications();
    }, [loadApplications]);

    const handleWithdraw = async (applicationId: string) => {
        if (!confirm('Are you sure you want to withdraw this application? Your personal data will be removed.')) return;
        setWithdrawing(applicationId);
        setWithdrawError(null);
        try {
            // The endpoint identifies the row by applicationId (it verifies
            // ownership server-side). Sending anything else 400s — which is
            // exactly how this button was silently broken before.
            const res = await fetch('/api/applications/withdraw', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationId }),
            });
            if (res.ok) {
                setApplications(prev =>
                    prev.map(a => a.id === applicationId
                        ? { ...a, status: 'withdrawn', withdrawnAt: new Date().toISOString() }
                        : a
                    )
                );
            } else {
                setWithdrawError('Couldn’t withdraw this application. Please try again.');
            }
        } catch {
            setWithdrawError('Couldn’t withdraw this application — check your connection and try again.');
        } finally {
            setWithdrawing(null);
        }
    };

    // Pipeline counts
    const pipelineCounts = PIPELINE_STEPS.reduce((acc, step) => {
        acc[step] = applications.filter(a => a.status === step).length;
        return acc;
    }, {} as Record<string, number>);

    return (
        <div style={{ minHeight: '100vh', padding: '32px 16px', background: '#F0F5F2' }}>
            <div style={{ maxWidth: '820px', margin: '0 auto' }}>

                {/* ═══ Header ═══ */}
                <div style={{ marginBottom: '28px' }}>
                    <h1 style={{
                        fontSize: '28px', fontWeight: 800,
                        fontFamily: 'var(--font-lora), Georgia, serif',
                        color: '#1A2E35', marginBottom: '6px',
                    }}>
                        My Applications
                    </h1>
                    <p style={{ fontSize: '14px', color: '#6B7F8A', margin: 0 }}>
                        Track and manage your job applications
                    </p>
                </div>

                {/* ═══ Loading — Skeleton Shimmer ═══ */}
                {loading && (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} style={{ ...cardBase, padding: '20px' }}>
                                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                                    <div className="skel-shimmer" style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#E8F0EB', flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <div className="skel-shimmer" style={{ height: '16px', width: '65%', borderRadius: '8px', background: '#E8F0EB', marginBottom: '8px' }} />
                                        <div className="skel-shimmer" style={{ height: '12px', width: '45%', borderRadius: '6px', background: '#EDF5F0', marginBottom: '10px' }} />
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <div className="skel-shimmer" style={{ height: '24px', width: '80px', borderRadius: '12px', background: '#EDF5F0' }} />
                                            <div className="skel-shimmer" style={{ height: '24px', width: '60px', borderRadius: '12px', background: '#EDF5F0' }} />
                                        </div>
                                    </div>
                                    <div className="skel-shimmer" style={{ height: '26px', width: '70px', borderRadius: '14px', background: '#E8F0EB', flexShrink: 0 }} />
                                </div>
                            </div>
                        ))}
                    </div>
                    <style>{`
                        @keyframes shimmer {
                            0% { background-position: -200% 0; }
                            100% { background-position: 200% 0; }
                        }
                        .skel-shimmer {
                            background: linear-gradient(90deg, #EDF5F0 25%, #F7FBF8 50%, #EDF5F0 75%) !important;
                            background-size: 200% 100% !important;
                            animation: shimmer 1.5s ease-in-out infinite !important;
                        }
                    `}</style>
                    </>
                )}

                {/* ═══ Error — auth (401) vs load failure (everything else) ═══ */}
                {error && (
                    <div style={{ ...cardBase, textAlign: 'center', padding: '60px 24px' }}>
                        <AlertCircle size={40} style={{ color: '#EF4444', marginBottom: '16px', marginInline: 'auto', display: 'block' }} />
                        <h2 style={{
                            fontSize: '18px', fontWeight: 700,
                            fontFamily: 'var(--font-lora), Georgia, serif',
                            color: '#1A2E35', marginBottom: '8px',
                        }}>{errorKind === 'auth' ? 'Sign in required' : 'Something went wrong'}</h2>
                        <p style={{ color: '#8A9BA6', fontSize: '14px', marginBottom: '24px', lineHeight: 1.6 }}>{error}</p>
                        {errorKind === 'auth' ? (
                            <Link href="/login?redirectTo=/my-applications" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                padding: '10px 20px', borderRadius: '12px',
                                background: 'linear-gradient(145deg, #9D174D, #BE185D)',
                                color: '#fff', fontSize: '13px', fontWeight: 600,
                                textDecoration: 'none',
                                boxShadow: '4px 4px 10px rgba(190,24,93,0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
                            }}>
                                Sign In
                                <ArrowRight size={14} />
                            </Link>
                        ) : (
                            <button
                                type="button"
                                onClick={() => { void loadApplications(); }}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                                    padding: '10px 20px', borderRadius: '12px',
                                    background: 'linear-gradient(145deg, #9D174D, #BE185D)',
                                    color: '#fff', fontSize: '13px', fontWeight: 600,
                                    border: '1px solid rgba(190,24,93,0.4)', cursor: 'pointer',
                                    boxShadow: '4px 4px 10px rgba(190,24,93,0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
                                }}
                            >
                                <RefreshCw size={14} />
                                Try Again
                            </button>
                        )}
                    </div>
                )}

                {/* ═══ Empty State ═══ */}
                {!loading && !error && applications.length === 0 && (
                    <div style={{ ...cardBase, textAlign: 'center', padding: '60px 24px' }}>
                        <img src="/illustrations/spot-applications.png" alt="" style={{ width: '120px', height: '120px', objectFit: 'contain', marginBottom: '16px', marginInline: 'auto', display: 'block' }} />
                        <h2 style={{
                            fontSize: '18px', fontWeight: 700,
                            fontFamily: 'var(--font-lora), Georgia, serif',
                            color: '#1A2E35', marginBottom: '8px',
                        }}>No applications yet</h2>
                        <p style={{
                            color: '#8A9BA6', fontSize: '14px', marginBottom: '24px',
                            maxWidth: '340px', marginInline: 'auto', lineHeight: 1.6,
                        }}>
                            Find your next {brand.niche.short} role and apply today.
                        </p>
                        <Link href="/jobs" style={{
                            display: 'inline-flex', alignItems: 'center', gap: '8px',
                            padding: '10px 20px', borderRadius: '12px',
                            background: 'linear-gradient(145deg, #9D174D, #BE185D)',
                            color: '#fff', fontSize: '13px', fontWeight: 600,
                            textDecoration: 'none',
                            boxShadow: '4px 4px 10px rgba(190,24,93,0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
                        }}>
                            Browse Jobs
                            <ArrowRight size={14} />
                        </Link>
                    </div>
                )}

                {/* ═══ Content ═══ */}
                {!loading && !error && applications.length > 0 && (
                    <>
                    {/* ─── Status Pipeline ─── */}
                    <div style={{ ...cardBase, padding: '16px 20px', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', position: 'relative' }}>
                            {/* Connecting line */}
                            <div style={{
                                position: 'absolute', top: '18px', left: '32px', right: '32px',
                                height: '2px', background: '#D5E8E0', zIndex: 0,
                            }} />
                            {PIPELINE_STEPS.map((step) => {
                                const conf = STATUS_CONFIG[step];
                                const count = pipelineCounts[step];
                                const isActive = count > 0;
                                return (
                                    <div key={step} style={{
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                                        zIndex: 1, flex: 1,
                                    }}>
                                        <div style={{
                                            width: '36px', height: '36px',
                                            borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '14px', fontWeight: 700,
                                            background: isActive ? conf.bg : '#EDF5F0',
                                            color: isActive ? conf.color : '#B0C4BC',
                                            border: `2px solid ${isActive ? conf.color : '#D5E8E0'}`,
                                            boxShadow: isActive
                                                ? '3px 3px 8px rgba(0,0,0,0.06), -2px -2px 6px rgba(255,255,255,0.8)'
                                                : 'none',
                                            transition: 'all 0.2s',
                                        }}>
                                            {count}
                                        </div>
                                        <span style={{
                                            fontSize: '10px', fontWeight: 600,
                                            color: isActive ? conf.color : '#B0C4BC',
                                            textTransform: 'uppercase', letterSpacing: '0.04em',
                                        }}>
                                            {conf.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ─── Withdraw error banner ─── */}
                    {withdrawError && (
                        <div role="alert" style={{
                            marginBottom: '12px', padding: '12px 16px', borderRadius: '10px',
                            background: '#FDECEA', border: '1px solid #F5C6C0',
                            color: '#B3261E', fontSize: '13px', fontWeight: 600,
                        }}>
                            {withdrawError}
                        </div>
                    )}

                    {/* ─── Applications List ─── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {applications.map(app => {
                            const status = STATUS_CONFIG[app.status] || STATUS_CONFIG.applied;
                            const isWithdrawn = app.status === 'withdrawn';
                            const jobUrl = app.job.slug ? `/jobs/${app.job.slug}` : `/jobs/${app.job.id}`;
                            const initials = (app.job.employer || '?')[0].toUpperCase();
                            const avatarHue = (app.job.employer || '').charCodeAt(0) * 7 % 360;

                            return (
                                <div
                                    key={app.id}
                                    className="app-card"
                                    style={{
                                        ...cardBase,
                                        padding: '18px 20px',
                                        opacity: isWithdrawn ? 0.55 : 1,
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                                        {/* Avatar */}
                                        <div style={{
                                            width: '44px', height: '44px', borderRadius: '12px',
                                            background: `hsl(${avatarHue}, 40%, 50%)`,
                                            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '17px', fontWeight: 700, flexShrink: 0,
                                        }}>
                                            {initials}
                                        </div>

                                        {/* Content */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            {/* Title */}
                                            <Link
                                                href={app.job.isPublished ? jobUrl : '#'}
                                                style={{ textDecoration: 'none' }}
                                            >
                                                <h3 className="app-title" style={{
                                                    fontSize: '16px', fontWeight: 700,
                                                    fontFamily: 'var(--font-lora), Georgia, serif',
                                                    color: '#1A2E35', margin: '0 0 3px',
                                                    lineHeight: 1.3,
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>
                                                    {app.job.title}
                                                </h3>
                                            </Link>

                                            {/* Employer + Location */}
                                            <p style={{ fontSize: '13px', color: '#6B7F8A', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                {app.job.employer}
                                                <span style={{ color: '#B0C4BC' }}>·</span>
                                                <MapPin size={12} style={{ color: '#BE185D' }} />
                                                {app.job.location}
                                            </p>

                                            {/* Meta pills */}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                                                <span style={{ ...cardRecessed, padding: '3px 10px', fontSize: '11px', fontWeight: 600, color: '#6B7F8A', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <Clock size={11} />
                                                    {formatDate(app.appliedAt)}
                                                </span>
                                                {app.job.displaySalary && (
                                                    <span style={{ ...cardRecessed, padding: '3px 10px', fontSize: '11px', fontWeight: 600, color: '#1d4ed8' }}>
                                                        {app.job.displaySalary}
                                                    </span>
                                                )}
                                                {app.job.mode && (
                                                    <span style={{ ...cardRecessed, padding: '3px 10px', fontSize: '11px', fontWeight: 600, color: '#6B7F8A' }}>
                                                        {app.job.mode}
                                                    </span>
                                                )}
                                                {app.coverLetter && (
                                                    <span style={{ ...cardRecessed, padding: '3px 10px', fontSize: '11px', fontWeight: 600, color: '#059669' }}>
                                                        Cover letter ✓
                                                    </span>
                                                )}
                                                {app.resumeUrl && (
                                                    <span style={{ ...cardRecessed, padding: '3px 10px', fontSize: '11px', fontWeight: 600, color: '#059669' }}>
                                                        Resume ✓
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right: Status + Actions */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
                                            {/* Status Badge */}
                                            <span style={{
                                                ...clayPill,
                                                background: status.bg, color: status.color,
                                            }}>
                                                {status.label}
                                            </span>

                                            {/* Actions */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {!isWithdrawn && (
                                                    <button
                                                        onClick={() => handleWithdraw(app.id)}
                                                        disabled={withdrawing === app.id}
                                                        className="app-action-btn"
                                                        title="Withdraw application"
                                                        style={{
                                                            width: '28px', height: '28px',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            borderRadius: '8px', border: '1px solid #D5E8E0',
                                                            background: '#EDF5F0', color: '#DC2626',
                                                            cursor: 'pointer',
                                                            boxShadow: '2px 2px 6px rgba(0,0,0,0.04), -1px -1px 4px rgba(255,255,255,0.7)',
                                                            transition: 'all 0.15s',
                                                        }}
                                                    >
                                                        {withdrawing === app.id ? (
                                                            <Loader2 size={12} className="animate-spin" />
                                                        ) : (
                                                            <Trash2 size={12} />
                                                        )}
                                                    </button>
                                                )}
                                                {app.job.isPublished && (
                                                    <Link
                                                        href={jobUrl}
                                                        className="app-action-btn"
                                                        title="View job"
                                                        style={{
                                                            width: '28px', height: '28px',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            borderRadius: '8px', border: '1px solid #D5E8E0',
                                                            background: '#EDF5F0', color: '#BE185D',
                                                            boxShadow: '2px 2px 6px rgba(0,0,0,0.04), -1px -1px 4px rgba(255,255,255,0.7)',
                                                            transition: 'all 0.15s',
                                                            textDecoration: 'none',
                                                        }}
                                                    >
                                                        <ChevronRight size={14} />
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* ─── Summary Footer ─── */}
                    <div style={{
                        ...cardRecessed,
                        padding: '14px 20px', marginTop: '20px',
                        display: 'flex', justifyContent: 'center', gap: '16px',
                        fontSize: '12px', fontWeight: 600, color: '#6B7F8A',
                    }}>
                        <span>{applications.length} application{applications.length !== 1 ? 's' : ''}</span>
                        <span style={{ color: '#D5E8E0' }}>·</span>
                        <span style={{ color: '#2563EB' }}>{applications.filter(a => a.status === 'interview').length} in interview</span>
                        <span style={{ color: '#D5E8E0' }}>·</span>
                        <span style={{ color: '#7C3AED' }}>{applications.filter(a => a.status === 'offered' || a.status === 'hired').length} offers</span>
                    </div>
                    </>
                )}
            </div>

            {/* ═══ Hover styles ═══ */}
            <style>{`
                .app-card:hover {
                    box-shadow: 10px 10px 24px rgba(0,0,0,0.09), -5px -5px 14px rgba(255,255,255,0.95), inset 2px 2px 4px rgba(255,255,255,0.6), inset -1px -1px 2px rgba(0,0,0,0.02) !important;
                    transform: translateY(-1px);
                }
                .app-title:hover {
                    color: #BE185D !important;
                }
                .app-action-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 3px 3px 8px rgba(0,0,0,0.06), -2px -2px 6px rgba(255,255,255,0.8) !important;
                }
            `}</style>
        </div>
    );
}

'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    Search,
    MapPin,
    Globe,
    Monitor,
    Clock,
    Clock3,
    GraduationCap,
    Briefcase,
    Map as MapIcon,
    CircleDollarSign,
    Building2,
} from 'lucide-react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import { OG_HOMEPAGE_HEADLINE } from '@/config/niche/copy';
import { STAT_SOURCES } from '@/lib/stats-sources';

/** A recent job rendered as a clay ticket in the hero's right column. */
export interface HeroJob {
    title: string;
    employer: string;
    location: string;
    salary?: string | null;
}

interface HomepageHeroProps {
    jobCountDisplay: string;
    /** Up to 3 recent roles for the ticket stack. Optional-safe: defaults to []. */
    recentJobs?: HeroJob[];
    /** e.g. "$129,210" — falls back to STAT_SOURCES.averageSalary when absent. */
    medianSalaryRange?: string;
    /** Employers currently hiring; the 4th stat chip falls back when absent. */
    employerCount?: number;
}

const quickFilters = [
    { label: 'Remote', query: 'Remote', icon: Globe },
    { label: 'Telehealth', query: 'Telehealth', icon: Monitor },
    { label: 'Full-Time', query: 'Full-Time', icon: Clock },
    { label: 'Part-Time', query: 'Part-Time', icon: Clock3 },
    { label: 'New Grad', query: 'New Grad Friendly', icon: GraduationCap },
];

const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } },
};

/* ── Clay shadow recipes (berry-tinted casts per spec §1/§3) ── */
const CLAY_CARD_SHADOW =
    '8px 8px 20px rgba(190,24,93,0.10), -4px -4px 12px rgba(255,255,255,0.85), inset 2px 2px 5px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';
const CLAY_PILL_SHADOW =
    '4px 4px 10px rgba(190,24,93,0.10), -2px -2px 6px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';
const CLAY_PILL_SHADOW_HOVER =
    '6px 6px 14px rgba(190,24,93,0.15), -3px -3px 8px rgba(255,255,255,0.9), inset 2px 2px 5px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';
const CLAY_BLOB_SHADOW =
    'inset 4px 4px 8px rgba(255,255,255,0.5), inset -3px -3px 6px rgba(0,0,0,0.06), 0 6px 18px rgba(0,0,0,0.1)';
const CLAY_BLOB_SHADOW_HOVER =
    'inset 4px 4px 8px rgba(255,255,255,0.5), inset -3px -3px 6px rgba(0,0,0,0.06), 0 12px 28px rgba(0,0,0,0.15)';

/* Ticket stack layout: subtle rotation + overlap offsets + bob stagger. */
const TICKET_LAYOUT = [
    { rotate: -3, style: { marginTop: 0, marginLeft: 0, marginRight: 28 }, delay: '0s' },
    { rotate: 2, style: { marginTop: -16, marginLeft: 36, marginRight: 0 }, delay: '1.6s' },
    { rotate: -1, style: { marginTop: -16, marginLeft: 10, marginRight: 16 }, delay: '3.2s' },
] as const;

export default function HomepageHero({
    jobCountDisplay,
    recentJobs = [],
    medianSalaryRange,
    employerCount,
}: HomepageHeroProps) {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [locationQuery, setLocationQuery] = useState('');

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        if (locationQuery.trim()) params.set('location', locationQuery.trim());
        const queryString = params.toString();
        router.push(queryString ? `/jobs?${queryString}` : '/jobs');
    };

    const medianSalary = medianSalaryRange
        ?? STAT_SOURCES.averageSalary.range
        ?? STAT_SOURCES.averageSalary.formatted;
    const tickets = recentJobs.slice(0, 3);
    const hasEmployerCount = typeof employerCount === 'number' && employerCount > 0;

    const statChips = [
        { icon: Briefcase, value: jobCountDisplay, label: 'Open roles' },
        { icon: MapIcon, value: '50', label: 'States covered' },
        { icon: CircleDollarSign, value: medianSalary, label: 'Median NP salary' },
        hasEmployerCount
            ? { icon: Building2, value: employerCount.toLocaleString('en-US'), label: 'Employers hiring' }
            : { icon: Building2, value: 'Daily', label: 'New roles added' },
    ];

    /* Larger stat-blob cluster shown when there are no tickets — never an empty column. */
    const clusterStats = [
        { value: jobCountDisplay, label: 'open roles', rotate: -2 },
        { value: '50', label: 'states covered', rotate: 1.5 },
        { value: medianSalary, label: 'median NP salary', rotate: 1 },
        hasEmployerCount
            ? { value: employerCount.toLocaleString('en-US'), label: 'employers hiring', rotate: -1.5 }
            : { value: 'Daily', label: 'new roles added', rotate: -1.5 },
    ];

    return (
        <LazyMotion features={domAnimation}>
        {/* marginTop cancels the Header's 100px spacer so the hero wash +
            blobs run up behind the floating pill nav (no dead band between
            nav and eyebrow); the inner container re-adds clearance. */}
        <section style={{ position: 'relative', margin: 0, marginTop: -100, overflow: 'hidden' }}>
            {/* ── CSS-only background: soft blurred clay blobs on the sage-ivory canvas ── */}
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <div
                    style={{
                        position: 'absolute',
                        top: '-140px',
                        left: '-160px',
                        width: '480px',
                        height: '480px',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, #BFE8DA 0%, rgba(191,232,218,0) 70%)',
                        opacity: 0.6,
                        filter: 'blur(60px)',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        top: '8%',
                        right: '-180px',
                        width: '520px',
                        height: '520px',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, #FBE0C2 0%, rgba(251,224,194,0) 70%)',
                        opacity: 0.55,
                        filter: 'blur(60px)',
                    }}
                />
                <div
                    style={{
                        position: 'absolute',
                        bottom: '-200px',
                        left: '28%',
                        width: '560px',
                        height: '560px',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle, #DBEDE5 0%, rgba(219,237,229,0) 70%)',
                        opacity: 0.5,
                        filter: 'blur(60px)',
                    }}
                />
            </div>

            <m.div
                variants={container}
                initial="hidden"
                animate="show"
                style={{
                    position: 'relative',
                    maxWidth: '1180px',
                    margin: '0 auto',
                    padding: '128px 24px 64px',
                }}
            >
                {/* ── Asymmetric split: ~60/40 at ≥1024px, stacked below ── */}
                <div className="hero-grid">
                    {/* ══ LEFT column ══ */}
                    <div className="hero-left" style={{ minWidth: 0 }}>
                        {/* ── Eyebrow ── */}
                        <m.p
                            variants={fadeUp}
                            style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.14em',
                                color: 'var(--color-primary)',
                                marginBottom: '16px',
                            }}
                        >
                            {OG_HOMEPAGE_HEADLINE}
                        </m.p>

                        {/* ── Headline ── */}
                        <m.h1
                            variants={fadeUp}
                            className="font-heading"
                            style={{
                                fontSize: 'clamp(2.5rem, 5vw, 3.75rem)',
                                fontWeight: 800,
                                lineHeight: 1.08,
                                color: '#1a2332',
                                marginBottom: '18px',
                            }}
                        >
                            Every NP specialty.{' '}
                            <span style={{ color: 'var(--color-primary)' }}>Salaries in the open.</span>
                        </m.h1>

                        {/* ── Subline ── */}
                        <m.p
                            variants={fadeUp}
                            className="hero-subline"
                            style={{
                                fontSize: '17px',
                                lineHeight: 1.6,
                                color: '#5a6577',
                                maxWidth: '480px',
                            }}
                        >
                            {jobCountDisplay} verified roles across every specialty and setting — updated daily.
                        </m.p>

                        {/* ── Search bar (two-input clay bar, teal Search) ── */}
                        <m.form
                            variants={fadeUp}
                            onSubmit={handleSubmit}
                            role="search"
                            style={{ width: '100%', maxWidth: '580px', marginBottom: '20px' }}
                        >
                            <div
                                className="hero-search-bar"
                                style={{
                                    display: 'flex',
                                    alignItems: 'stretch',
                                    borderRadius: '20px',
                                    overflow: 'hidden',
                                    background: 'rgba(255,255,255,0.95)',
                                    backdropFilter: 'blur(12px)',
                                    border: '1px solid rgba(255,255,255,0.6)',
                                    boxShadow: '8px 8px 20px rgba(190,24,93,0.08), -4px -4px 12px rgba(255,255,255,0.9), inset 2px 2px 5px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.02)',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', flex: 1, minWidth: 0 }}>
                                    <Search size={18} style={{ color: '#9ca3af', flexShrink: 0 }} aria-hidden="true" />
                                    {/* SEO Fix C2/C3: aria-label gives screen readers a name (WCAG 4.1.2);
                                        the focus-visible ring in globals.css is allowed to render (WCAG 2.4.7). */}
                                    <input
                                        aria-label="Job title or keyword"
                                        placeholder="Job title or keyword"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        autoComplete="off"
                                        className="hero-search-input"
                                        style={{ border: 'none', background: 'transparent', width: '100%', fontSize: '16px', color: '#1f2937', textAlign: 'left' }}
                                    />
                                </div>
                                <div className="hero-search-divider" style={{ width: '1px', background: '#e5e7eb', flexShrink: 0, margin: '10px 0' }} />
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', flex: 1, minWidth: 0 }}>
                                    <MapPin size={18} style={{ color: '#9ca3af', flexShrink: 0 }} aria-hidden="true" />
                                    <input
                                        aria-label="City or remote"
                                        placeholder="City or 'Remote'"
                                        value={locationQuery}
                                        onChange={(e) => setLocationQuery(e.target.value)}
                                        autoComplete="off"
                                        className="hero-search-input"
                                        style={{ border: 'none', background: 'transparent', width: '100%', fontSize: '16px', color: '#1f2937', textAlign: 'left' }}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    className="hero-search-btn"
                                    style={{
                                        background: '#BE185D',
                                        color: 'white',
                                        padding: '0 28px',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        border: 'none',
                                        cursor: 'pointer',
                                        flexShrink: 0,
                                        transition: 'all 0.2s ease',
                                        boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.2), inset -1px -1px 2px rgba(0,0,0,0.08)',
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = '#9D174D'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = '#BE185D'; e.currentTarget.style.transform = 'scale(1)'; }}
                                >
                                    Search
                                </button>
                            </div>
                        </m.form>

                        {/* ── Quick filters (mint clay pills) ── */}
                        <m.div
                            variants={fadeUp}
                            className="hero-row"
                            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '28px' }}
                        >
                            {quickFilters.map((filter) => {
                                const Icon = filter.icon;
                                return (
                                    <Link
                                        key={filter.label}
                                        href={`/jobs?q=${encodeURIComponent(filter.query)}`}
                                        className="hero-filter-badge"
                                        style={{
                                            // SEO Fix M13: padding 12px 20px keeps the pill at a
                                            // ~44px tap target (WCAG 2.5.8 + Apple/Google guidance).
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            padding: '12px 20px',
                                            borderRadius: '24px',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            background: '#D9F2EA',
                                            color: '#9D174D',
                                            textDecoration: 'none',
                                            border: '1px solid rgba(255,255,255,0.5)',
                                            boxShadow: CLAY_PILL_SHADOW,
                                            transition: 'all 0.2s ease',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = '#C7EADF';
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = CLAY_PILL_SHADOW_HOVER;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = '#D9F2EA';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = CLAY_PILL_SHADOW;
                                        }}
                                    >
                                        <Icon size={14} />
                                        {filter.label}
                                    </Link>
                                );
                            })}
                        </m.div>

                        {/* ── Apricot clay blob CTAs ── */}
                        <m.div
                            variants={fadeUp}
                            className="hero-row hero-cta-row"
                            style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}
                        >
                            <Link
                                href="/jobs"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '14px 32px',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    color: '#1a2332',
                                    textDecoration: 'none',
                                    background: 'linear-gradient(145deg, #FDBA74cc, #FDBA7488)',
                                    borderRadius: '54% 46% 62% 38% / 49% 55% 45% 51%',
                                    boxShadow: CLAY_BLOB_SHADOW,
                                    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-3px) scale(1.06)';
                                    e.currentTarget.style.boxShadow = CLAY_BLOB_SHADOW_HOVER;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                    e.currentTarget.style.boxShadow = CLAY_BLOB_SHADOW;
                                }}
                            >
                                Browse Jobs →
                            </Link>
                            <Link
                                href="/post-job"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '14px 32px',
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    color: '#1a2332',
                                    textDecoration: 'none',
                                    background: 'linear-gradient(145deg, #FDBA74cc, #FDBA7488)',
                                    borderRadius: '46% 54% 38% 62% / 55% 45% 51% 49%',
                                    boxShadow: CLAY_BLOB_SHADOW,
                                    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-3px) scale(1.06)';
                                    e.currentTarget.style.boxShadow = CLAY_BLOB_SHADOW_HOVER;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                    e.currentTarget.style.boxShadow = CLAY_BLOB_SHADOW;
                                }}
                            >
                                Post a Job →
                            </Link>
                        </m.div>
                    </div>

                    {/* ══ RIGHT column: clay job tickets (or stat-blob cluster) ══ */}
                    <m.div variants={fadeUp} style={{ minWidth: 0 }}>
                        {tickets.length > 0 ? (
                            <div
                                role="group"
                                aria-label="Recently posted roles"
                                style={{ position: 'relative', maxWidth: '420px', margin: '0 auto', padding: '28px 8px 24px' }}
                            >
                                {tickets.map((job, i) => {
                                    const layout = TICKET_LAYOUT[i] ?? TICKET_LAYOUT[0];
                                    return (
                                        <div
                                            key={`${job.employer}-${job.title}-${i}`}
                                            className="hero-ticket-bob"
                                            style={{ animationDelay: layout.delay, position: 'relative', ...layout.style }}
                                        >
                                            <div
                                                style={{
                                                    transform: `rotate(${layout.rotate}deg)`,
                                                    background: '#F7FAF6',
                                                    borderRadius: '20px',
                                                    border: '1px solid rgba(255,255,255,0.6)',
                                                    boxShadow: CLAY_CARD_SHADOW,
                                                    padding: '18px 20px',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                    <span
                                                        aria-hidden="true"
                                                        style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', flexShrink: 0 }}
                                                    />
                                                    <span
                                                        style={{
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            color: '#5a6577',
                                                            letterSpacing: '0.02em',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                        }}
                                                    >
                                                        {job.employer}
                                                    </span>
                                                </div>
                                                <p
                                                    className="font-heading"
                                                    style={{
                                                        fontSize: '16px',
                                                        fontWeight: 800,
                                                        lineHeight: 1.3,
                                                        color: '#1a2332',
                                                        marginBottom: '6px',
                                                        display: '-webkit-box',
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical',
                                                        overflow: 'hidden',
                                                    }}
                                                >
                                                    {job.title}
                                                </p>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#5a6577', minWidth: 0 }}>
                                                    <MapPin size={13} style={{ flexShrink: 0 }} aria-hidden="true" />
                                                    <span style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {job.location}
                                                    </span>
                                                </div>
                                                {job.salary && (
                                                    <p
                                                        style={{
                                                            marginTop: '8px',
                                                            fontSize: '14px',
                                                            fontWeight: 700,
                                                            color: 'var(--color-primary)',
                                                            fontVariantNumeric: 'tabular-nums',
                                                        }}
                                                    >
                                                        {job.salary}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Floating mini stat blobs */}
                                <div
                                    className="hero-stat-blob font-heading"
                                    style={{
                                        position: 'absolute',
                                        top: '-2px',
                                        right: '-6px',
                                        zIndex: 5,
                                        padding: '10px 16px',
                                        borderRadius: '999px',
                                        background: 'linear-gradient(145deg, #FFE7CC, #FBE0C2)',
                                        color: '#B45309',
                                        fontSize: '13px',
                                        fontWeight: 800,
                                        fontVariantNumeric: 'tabular-nums',
                                        border: '1px solid rgba(255,255,255,0.6)',
                                        boxShadow: CLAY_PILL_SHADOW,
                                        animationDelay: '0.8s',
                                    }}
                                >
                                    {medianSalary} median
                                </div>
                                <div
                                    className="hero-stat-blob font-heading"
                                    style={{
                                        position: 'absolute',
                                        bottom: '-4px',
                                        left: '-8px',
                                        zIndex: 5,
                                        padding: '10px 16px',
                                        borderRadius: '999px',
                                        background: '#D9F2EA',
                                        color: '#9D174D',
                                        fontSize: '13px',
                                        fontWeight: 800,
                                        border: '1px solid rgba(255,255,255,0.6)',
                                        boxShadow: CLAY_PILL_SHADOW,
                                        animationDelay: '2.4s',
                                    }}
                                >
                                    50 states
                                </div>
                            </div>
                        ) : (
                            /* Empty-state: larger stat-blob cluster — never an empty column */
                            <div
                                role="group"
                                aria-label="Board statistics"
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                    gap: '16px',
                                    maxWidth: '400px',
                                    margin: '0 auto',
                                    padding: '16px 4px',
                                }}
                            >
                                {clusterStats.map((stat, i) => (
                                    <div
                                        key={stat.label}
                                        className="hero-stat-blob"
                                        style={{ animationDelay: `${i * 1.4}s` }}
                                    >
                                        <div
                                            style={{
                                                transform: `rotate(${stat.rotate}deg)`,
                                                background: '#F7FAF6',
                                                borderRadius: '22px',
                                                border: '1px solid rgba(255,255,255,0.6)',
                                                boxShadow: CLAY_CARD_SHADOW,
                                                padding: '22px 18px',
                                                textAlign: 'center',
                                            }}
                                        >
                                            <p
                                                className="font-heading"
                                                style={{
                                                    fontSize: 'clamp(1.35rem, 2vw, 1.6rem)',
                                                    fontWeight: 800,
                                                    color: '#831843',
                                                    fontVariantNumeric: 'tabular-nums',
                                                    marginBottom: '4px',
                                                }}
                                            >
                                                {stat.value}
                                            </p>
                                            <p style={{ fontSize: '13px', color: '#5a6577' }}>{stat.label}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </m.div>
                </div>

                {/* ── 4-chip clay stat strip below both columns ── */}
                <m.div variants={fadeUp} className="hero-stat-strip" style={{ marginTop: '48px' }}>
                    {statChips.map((chip) => {
                        const Icon = chip.icon;
                        return (
                            <div
                                key={chip.label}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    padding: '14px 16px',
                                    borderRadius: '18px',
                                    background: '#F7FAF6',
                                    border: '1px solid rgba(255,255,255,0.6)',
                                    boxShadow: CLAY_PILL_SHADOW,
                                    minWidth: 0,
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '38px',
                                        height: '38px',
                                        borderRadius: '50%',
                                        background: '#D9F2EA',
                                        color: 'var(--color-primary)',
                                        flexShrink: 0,
                                    }}
                                >
                                    <Icon size={18} />
                                </span>
                                <span style={{ minWidth: 0 }}>
                                    <span
                                        className="font-heading"
                                        style={{
                                            display: 'block',
                                            fontSize: '17px',
                                            fontWeight: 800,
                                            color: '#831843',
                                            fontVariantNumeric: 'tabular-nums',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        {chip.value}
                                    </span>
                                    <span style={{ display: 'block', fontSize: '12px', color: '#5a6577' }}>{chip.label}</span>
                                </span>
                            </div>
                        );
                    })}
                </m.div>
            </m.div>

            <style jsx global>{`
                .hero-grid {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 44px;
                    align-items: center;
                }
                .hero-left {
                    text-align: center;
                }
                .hero-left .hero-row {
                    justify-content: center;
                }
                .hero-left form {
                    margin-left: auto;
                    margin-right: auto;
                }
                .hero-subline {
                    margin: 0 auto 28px;
                }
                @media (min-width: 1024px) {
                    .hero-grid {
                        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
                        gap: 56px;
                    }
                    .hero-left {
                        text-align: left;
                    }
                    .hero-left .hero-row {
                        justify-content: flex-start;
                    }
                    .hero-left form {
                        margin-left: 0;
                        margin-right: 0;
                    }
                    .hero-subline {
                        margin: 0 0 28px;
                    }
                }
                .hero-stat-strip {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 12px;
                    max-width: 980px;
                    margin-left: auto;
                    margin-right: auto;
                }
                @media (min-width: 768px) {
                    .hero-stat-strip {
                        grid-template-columns: repeat(4, minmax(0, 1fr));
                    }
                }
                /* Gentle 6s idle bob — compositor-only transform */
                @keyframes heroTicketBob {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                }
                .hero-ticket-bob {
                    animation: heroTicketBob 6s ease-in-out infinite;
                }
                .hero-stat-blob {
                    animation: heroTicketBob 6s ease-in-out infinite;
                }
                @media (prefers-reduced-motion: reduce) {
                    .hero-ticket-bob,
                    .hero-stat-blob {
                        animation: none !important;
                    }
                }
                @media (max-width: 540px) {
                    .hero-search-bar {
                        flex-direction: column !important;
                        border-radius: 16px !important;
                    }
                    .hero-search-divider {
                        width: 100% !important;
                        height: 1px !important;
                        margin: 0 18px !important;
                    }
                    .hero-search-btn {
                        padding: 14px 28px !important;
                        border-radius: 0 0 16px 16px !important;
                    }
                }
            `}</style>
        </section>
        </LazyMotion>
    );
}

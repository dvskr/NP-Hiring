'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MapPin, Clock, ArrowUpRight, Briefcase, Zap, BellRing } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import { trackJobListView, buildJobItem } from '@/lib/analytics';

interface FeaturedJob {
    id: string;
    slug: string | null;
    title: string;
    employer: string;
    location: string;
    jobType: string | null;
    displaySalary: string | null;
    createdAt: string;
    originalPostedAt?: string | null;
}

interface FeaturedJobsProps {
    jobs: FeaturedJob[];
    /** Site-wide published-job count — powers the ticket-stub aggregate copy. */
    totalJobs: number;
}

function relativeTime(s: string): string {
    const ms = Date.now() - new Date(s).getTime();
    const m = Math.floor(ms / 60000), h = Math.floor(ms / 3600000), d = Math.floor(ms / 86400000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 30) return `${d}d ago`;
    return `${Math.floor(d / 30)}mo ago`;
}

const fadeUp = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};
const stagger = {
    visible: { transition: { staggerChildren: 0.1 } },
};

const MAX_CARDS = 8;
const MIN_TICKETS = 3;

/** Deterministic per-employer clay dot — hydration-safe (pure string hash). */
const DOT_COLORS = ['#BE185D', '#D97706', '#1D4ED8', '#0D9488', '#B45309'] as const;
function employerDotColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) % 100003;
    }
    return DOT_COLORS[hash % DOT_COLORS.length];
}

interface StubCard {
    icon: LucideIcon;
    headline: string;
    sub: string;
    cta: string;
}

/** Dashed "ticket stub" placeholders shown when fewer than 3 real jobs exist. */
function buildStubs(totalJobs: number): StubCard[] {
    // Explicit locale — server and client must format identically (hydration).
    const liveCount = totalJobs.toLocaleString('en-US');
    return [
        {
            icon: Briefcase,
            headline: `${liveCount} roles live right now`,
            sub: 'Every NP specialty, all 50 states — searchable in one place with pay ranges up front.',
            cta: 'Browse all roles',
        },
        {
            icon: Zap,
            headline: 'New roles land daily',
            sub: 'Fresh openings flow in every day from 8 ATS sources and direct employer postings.',
            cta: 'See the latest',
        },
        {
            icon: BellRing,
            headline: 'Never miss a match',
            sub: `${liveCount} live roles and counting — set a free alert and new matches come to you.`,
            cta: 'Explore jobs',
        },
    ];
}

const css = `
    .fjs2-wrap {
        position: relative;
        overflow: hidden;
        padding: 76px 0 84px;
    }
    /* Soft clay blobs — CSS-only decoration, no images */
    .fjs2-wrap::before {
        content: '';
        position: absolute;
        top: -140px;
        right: -120px;
        width: 460px;
        height: 460px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(191,232,218,0.55) 0%, transparent 70%);
        filter: blur(60px);
        pointer-events: none;
    }
    .fjs2-wrap::after {
        content: '';
        position: absolute;
        bottom: -160px;
        left: -100px;
        width: 420px;
        height: 420px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(251,224,194,0.5) 0%, transparent 70%);
        filter: blur(60px);
        pointer-events: none;
    }
    .fjs2-inner {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 24px;
        position: relative;
        z-index: 1;
    }

    /* ── Header row ── */
    .fjs2-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 36px;
    }
    .fjs2-browse {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 8px 4px;
        font-size: 14px;
        font-weight: 700;
        color: var(--color-primary);
        text-decoration: none;
        transition: color 0.2s ease;
    }
    .fjs2-browse svg { transition: transform 0.2s ease; }
    .fjs2-browse:hover { color: var(--color-primary-dark); }
    .fjs2-browse:hover svg { transform: translate(2px, -2px); }

    /* ── Ticket grid: 3-up / 2-up / 1-up ── */
    .fjs2-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 22px;
    }
    @media (max-width: 1023px) {
        .fjs2-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 639px) {
        .fjs2-grid { grid-template-columns: 1fr; }
        .fjs2-wrap { padding: 52px 0 60px; }
        .fjs2-inner { padding: 0 16px; }
        .fjs2-head { margin-bottom: 28px; }
    }

    /* ── Clay job ticket (extends global .clay-card) ── */
    .fjs2-card {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 232px;
        padding: 22px;
        text-decoration: none;
    }
    .fjs2-card:hover .fjs2-title { color: var(--color-primary); }
    .fjs2-card:hover .fjs2-go {
        transform: scale(1.08);
        background: var(--color-primary);
        color: #fff;
    }

    /* ── Dashed ticket stub (empty/sparse state) ── */
    .fjs2-stub {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        flex: 1;
        min-height: 232px;
        padding: 22px;
        border-radius: 20px;
        border: 1.5px dashed rgba(190,24,93,0.25);
        background: linear-gradient(165deg, #ECF7F1 0%, #F6FBF8 100%);
        box-shadow:
            inset 1px 1px 3px rgba(255,255,255,0.85),
            4px 4px 14px rgba(190,24,93,0.05);
    }
    .fjs2-stub-cta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: auto;
        min-height: 44px;
        padding: 10px 18px;
        border-radius: 14px;
        background: #D9F2EA;
        color: #9D174D;
        font-size: 13px;
        font-weight: 700;
        text-decoration: none;
        box-shadow: 3px 3px 8px rgba(190,24,93,0.10), -2px -2px 6px rgba(255,255,255,0.9);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .fjs2-stub-cta:hover {
        transform: translateY(-2px);
        box-shadow: 5px 5px 12px rgba(190,24,93,0.16), -2px -2px 6px rgba(255,255,255,0.9);
    }
    .fjs2-stub-cta:active {
        transform: translateY(1px);
        box-shadow: inset 2px 2px 4px rgba(190,24,93,0.15);
    }

    /* ── Primary CTA (zero-jobs state) ── */
    .fjs2-cta-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 48px;
        padding: 13px 30px;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.02em;
        color: #fff;
        text-decoration: none;
        background: var(--color-primary);
        border: 1px solid rgba(255,255,255,0.25);
        border-radius: 16px;
        box-shadow:
            6px 6px 16px rgba(190,24,93,0.28),
            -3px -3px 8px rgba(255,255,255,0.7),
            inset 2px 2px 4px rgba(255,255,255,0.28),
            inset -1px -1px 2px rgba(0,0,0,0.08);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .fjs2-cta-btn:hover {
        transform: translateY(-2px);
        box-shadow:
            8px 8px 20px rgba(190,24,93,0.34),
            -4px -4px 10px rgba(255,255,255,0.7),
            inset 2px 2px 5px rgba(255,255,255,0.32),
            inset -1px -1px 2px rgba(0,0,0,0.08);
    }
    .fjs2-cta-btn:active {
        transform: translateY(1px);
        box-shadow: 2px 2px 6px rgba(190,24,93,0.2), inset 3px 3px 6px rgba(0,0,0,0.15);
    }

    .fjs2-browse:focus-visible,
    .fjs2-card:focus-visible,
    .fjs2-stub-cta:focus-visible,
    .fjs2-cta-btn:focus-visible {
        outline: 3px solid rgba(190,24,93,0.45);
        outline-offset: 3px;
    }

    @media (prefers-reduced-motion: reduce) {
        .fjs2-card, .fjs2-stub-cta, .fjs2-cta-btn, .fjs2-browse, .fjs2-browse svg, .fjs2-go {
            transition: none !important;
        }
        .fjs2-card:hover, .fjs2-stub-cta:hover, .fjs2-cta-btn:hover,
        .fjs2-stub-cta:active, .fjs2-cta-btn:active {
            transform: none !important;
        }
        .fjs2-card:hover .fjs2-go { transform: none !important; }
        .fjs2-browse:hover svg { transform: none !important; }
    }
`;

export default function FeaturedJobs({ jobs, totalJobs }: FeaturedJobsProps) {
    // Hydration guard: relativeTime() depends on Date.now(), so the ISR-cached
    // server HTML ("2m ago") differs from the client's recompute, firing React
    // hydration error #418 (same class JobCard already mount-guards). Render an
    // empty label on the server pass, swap to the live value after mount.
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    useEffect(() => {
        if (jobs.length === 0) return;
        trackJobListView(
            jobs.map(j => buildJobItem({ id: j.id, title: j.title, employer: j.employer })),
            'Homepage Featured Jobs',
        );
    }, [jobs]);

    const shown = jobs.slice(0, MAX_CARDS);
    // Sparse/empty doctrine: fewer than 3 real tickets → pad with dashed stubs
    // carrying real aggregate stats. Zero jobs never renders a void.
    const stubCount = shown.length < MIN_TICKETS ? MIN_TICKETS - shown.length : 0;
    const stubs = buildStubs(totalJobs).slice(0, stubCount);

    return (
        <LazyMotion features={domAnimation}>
        <section className="fjs2-wrap" aria-labelledby="fjs2-heading">
            <style>{css}</style>

            <div className="fjs2-inner">
                {/* ── Header row ── */}
                <m.div
                    className="fjs2-head"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-60px' }}
                    variants={stagger}
                >
                    <div>
                        <m.p
                            variants={fadeUp}
                            style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.14em', margin: '0 0 10px' }}
                        >
                            Fresh openings
                        </m.p>
                        <m.h2
                            id="fjs2-heading"
                            variants={fadeUp}
                            className="font-heading"
                            style={{ fontSize: 'clamp(1.9rem, 3.2vw, 2.6rem)', fontWeight: 800, color: '#152420', margin: 0, lineHeight: 1.12 }}
                        >
                            Latest verified roles
                        </m.h2>
                    </div>
                    <m.div variants={fadeUp}>
                        <Link href="/jobs" className="fjs2-browse">
                            Browse all roles <ArrowUpRight size={16} aria-hidden />
                        </Link>
                    </m.div>
                </m.div>

                {/* ── Ticket grid ── */}
                <m.div
                    className="fjs2-grid"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, margin: '-60px' }}
                    variants={stagger}
                >
                    {shown.map((job, i) => {
                        const href = job.slug ? `/jobs/${job.slug}` : `/jobs/${job.id}`;
                        const postedDate = job.originalPostedAt || job.createdAt;
                        // First two slots are the employer-pinned picks → "Featured";
                        // the rest of the ≤3-day window reads "New". Index-based, so
                        // server and client HTML always match (no Date.now() here).
                        const badge = i < 2 ? 'Featured' : 'New';

                        return (
                            <m.div key={job.id} variants={fadeUp} style={{ display: 'flex' }}>
                                <Link href={href} className="clay-card fjs2-card" aria-label={`${job.title} at ${job.employer}, ${job.location}`}>
                                    {/* Badge + relative time */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
                                        <span style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            padding: '4px 10px',
                                            borderRadius: '999px',
                                            background: '#FFE7CC',
                                            color: '#B45309',
                                            fontSize: '11px',
                                            fontWeight: 800,
                                            letterSpacing: '0.06em',
                                            textTransform: 'uppercase',
                                            boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.8), 1px 1px 3px rgba(180,83,9,0.12)',
                                        }}>
                                            {badge}
                                        </span>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'rgba(21,36,32,0.5)' }}>
                                            <Clock size={12} aria-hidden />
                                            {mounted ? relativeTime(postedDate) : ''}
                                        </span>
                                    </div>

                                    {/* Employer + clay dot */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                        <span aria-hidden style={{
                                            width: 8,
                                            height: 8,
                                            borderRadius: '50%',
                                            background: employerDotColor(job.employer),
                                            flexShrink: 0,
                                            boxShadow: 'inset 0.5px 0.5px 1px rgba(255,255,255,0.6)',
                                        }} />
                                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(21,36,32,0.65)', letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {job.employer}
                                        </span>
                                    </div>

                                    {/* Title */}
                                    <h3
                                        className="fjs2-title font-heading"
                                        style={{
                                            fontSize: '18px',
                                            fontWeight: 800,
                                            color: '#1B2E28',
                                            lineHeight: 1.35,
                                            margin: '10px 0 8px',
                                            transition: 'color 0.2s ease',
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical' as const,
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {job.title}
                                    </h3>

                                    {/* Location + type */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'rgba(21,36,32,0.55)', minWidth: 0 }}>
                                        <MapPin size={13} style={{ color: 'var(--color-primary)', flexShrink: 0 }} aria-hidden />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {job.location}
                                            {job.jobType ? ` · ${job.jobType}` : ''}
                                        </span>
                                    </div>

                                    {/* Salary + go affordance */}
                                    <div style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid rgba(190,24,93,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                                        {job.displaySalary ? (
                                            <span className="font-heading" style={{ fontSize: '17px', fontWeight: 800, color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>
                                                {job.displaySalary}
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(21,36,32,0.45)' }}>
                                                View details
                                            </span>
                                        )}
                                        <span
                                            className="fjs2-go"
                                            aria-hidden
                                            style={{
                                                width: 36,
                                                height: 36,
                                                borderRadius: '50%',
                                                background: '#D9F2EA',
                                                color: 'var(--color-primary)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                transition: 'transform 0.2s ease, background 0.2s ease, color 0.2s ease',
                                                boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.9), 2px 2px 6px rgba(190,24,93,0.12)',
                                            }}
                                        >
                                            <ArrowUpRight size={17} />
                                        </span>
                                    </div>
                                </Link>
                            </m.div>
                        );
                    })}

                    {/* Dashed ticket stubs — sparse/empty state */}
                    {stubs.map((stub, i) => {
                        const StubIcon = stub.icon;
                        return (
                            <m.div key={`stub-${i}`} variants={fadeUp} style={{ display: 'flex' }}>
                                <div className="fjs2-stub">
                                    <div style={{
                                        width: 44,
                                        height: 44,
                                        borderRadius: '50%',
                                        background: '#D9F2EA',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginBottom: '14px',
                                        boxShadow: 'inset 1px 1px 2px rgba(255,255,255,0.9), 2px 2px 6px rgba(190,24,93,0.12)',
                                    }}>
                                        <StubIcon size={20} style={{ color: 'var(--color-primary)' }} aria-hidden />
                                    </div>
                                    <p className="font-heading" style={{ fontSize: '17px', fontWeight: 800, color: '#1B2E28', lineHeight: 1.3, margin: '0 0 6px' }}>
                                        {stub.headline}
                                    </p>
                                    <p style={{ fontSize: '13.5px', color: 'rgba(21,36,32,0.6)', lineHeight: 1.55, margin: '0 0 18px' }}>
                                        {stub.sub}
                                    </p>
                                    <Link href="/jobs" className="fjs2-stub-cta">
                                        {stub.cta} <ArrowUpRight size={14} aria-hidden />
                                    </Link>
                                </div>
                            </m.div>
                        );
                    })}
                </m.div>

                {/* Zero-jobs primary CTA — the section never renders a void */}
                {shown.length === 0 && (
                    <m.div
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true }}
                        variants={fadeUp}
                        style={{ display: 'flex', justifyContent: 'center', marginTop: '36px' }}
                    >
                        <Link href="/jobs" className="fjs2-cta-btn">
                            Browse all roles <ArrowUpRight size={16} aria-hidden />
                        </Link>
                    </m.div>
                )}
            </div>
        </section>
        </LazyMotion>
    );
}

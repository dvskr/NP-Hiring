'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MapPin, ArrowUpRight } from 'lucide-react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import { trackJobListView, buildJobItem } from '@/lib/analytics';

/* ── "How it works + Latest openings", F1 split poster (user-approved
   mock, 2026-07-09). Cream stage with soft blurred clay blobs + a faint
   scatter of medical "+" marks instead of the grid — CSS only, no storage
   images. Steps keep their original copy; jobs keep the live engine. ── */

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
const fadeLeft = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.5 } },
};
const fadeRight = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.5 } },
};
const stagger = {
    visible: { transition: { staggerChildren: 0.12 } },
};

/* Step copy carried over verbatim from the previous design. */
const STEPS = [
    { title: 'Build Your Profile', desc: 'Upload your resume once — add license states, credentials, years of experience, and salary range. Re-use it on every application.' },
    { title: 'Search & Get Matched', desc: 'Semantic AI search understands phrases like "new grad outpatient telehealth." A weekly digest emails fresh roles matched to your experience level, location, and pay.' },
    { title: 'Apply or Message Directly', desc: 'One-click Easy Apply on employer-posted roles, or message the hiring manager in-app. No recruiters, no portals, no copy-pasting.' },
    { title: 'Start Practicing', desc: 'Save jobs, track applications, and follow up with employers — all in one dashboard. Then accept your offer and start your next clinical role.' },
];

/* Faint background "+" marks (healthcare cross motif) — position/size/tilt.
   They sit at 7–10% opacity under everything; decorative only. */
const PLUS_MARKS = [
    { top: '6%', left: '3%', size: 30, rotate: 12 },
    { top: '18%', left: '46%', size: 22, rotate: -8 },
    { top: '9%', left: '78%', size: 36, rotate: 6 },
    { top: '38%', left: '92%', size: 24, rotate: -14 },
    { top: '52%', left: '40%', size: 30, rotate: 10 },
    { top: '64%', left: '2%', size: 22, rotate: -6 },
    { top: '78%', left: '70%', size: 34, rotate: 14 },
    { top: '88%', left: '30%', size: 24, rotate: -10 },
    { top: '30%', left: '20%', size: 20, rotate: 4 },
];

/* Static CSS only — NO template interpolations in style blocks (styled-jsx
   dynamic styles deadlock Turbopack's route compile; see project memory). */
const css = `
    .fjs-wrap {
        /* solid soft-green panel — separates this band from the cream
           hero/strip above without any gradient or blob atmosphere */
        background: #E9F5EE;
        position: relative;
        overflow: hidden;
    }
    .fjs-plus {
        position: absolute;
        pointer-events: none;
        color: rgba(122, 28, 43, 0.09);
        font-weight: 800;
        line-height: 1;
        user-select: none;
    }

    /* ── Split layout ── */
    .fjs-split {
        display: flex;
        max-width: 1360px;
        margin: 0 auto;
        gap: 44px;
        padding-top: 72px;
    }
    /* The how-it-works tree lives on its own warm panel — a flat poster
       card on the green band (split-bg treatment). */
    .fjs-steps-panel {
        background: #FBF2E6;
        border: 2px solid #7A1C2B;
        box-shadow: 6px 6px 0 #7A1C2B;
        padding: 26px 26px 30px;
    }
    .fjs-steps-panel .fjs-eyebrow {
        font-size: 11px;
        font-weight: 800;
        color: #BE185D;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        margin: 0 0 8px;
    }
    .fjs-steps-panel .fjs-h2 {
        font-size: 30px;
        font-weight: 700;
        color: #7A1C2B;
        margin: 0 0 24px;
        line-height: 1.1;
        text-transform: uppercase;
    }
    .fjs-col-left {
        width: 460px;
        flex-shrink: 0;
        padding: 0 0 80px 56px;
        position: relative;
    }
    .fjs-col-right {
        flex: 1;
        min-width: 0;
        padding: 0 56px 80px 0;
    }
    @media (max-width: 1023px) {
        .fjs-split { flex-direction: column; gap: 0; }
        .fjs-col-left { width: 100%; padding: 0 24px 48px; }
        .fjs-col-right { padding: 0 24px 48px; }
    }
    @media (max-width: 520px) {
        .fjs-col-left { padding: 0 16px 32px; }
        .fjs-col-right { padding: 0 16px 32px; }
    }

    /* ── Steps: stamped numbers on a dashed spine ── */
    .fjs-spine {
        position: relative;
        padding-left: 0;
    }
    .fjs-spine::before {
        content: '';
        position: absolute;
        left: 17px;
        top: 12px;
        bottom: 12px;
        width: 0;
        border-left: 2px dashed rgba(122, 28, 43, 0.30);
    }
    .fjs-step {
        position: relative;
        display: flex;
        gap: 16px;
        padding-bottom: 30px;
    }
    .fjs-step:last-child { padding-bottom: 0; }
    .fjs-stnum {
        position: relative;
        z-index: 1;
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 700;
        border: 2px solid #7A1C2B;
        box-shadow: 3px 3px 0 #7A1C2B;
        background: #BE185D;
        color: #fff;
        transform: rotate(2deg);
    }
    .fjs-step:nth-child(odd) .fjs-stnum {
        background: #B9EBD6;
        color: #7A1C2B;
        transform: rotate(-2deg);
    }
    .fjs-sttl {
        font-size: 14px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #7A1C2B;
        margin: 0 0 4px;
    }
    .fjs-stxt {
        font-size: 13px;
        color: #6b5a5e;
        margin: 0;
        line-height: 1.55;
    }

    /* ── CTA ── */
    .fjs-join {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-top: 30px;
        padding: 13px 30px;
        font-size: 13px;
        font-weight: 800;
        color: #fff;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: #BE185D;
        border: 2px solid #7A1C2B;
        box-shadow: 4px 4px 0 #7A1C2B;
        text-decoration: none;
        transition: transform 0.15s ease, background 0.2s ease;
    }
    .fjs-join:hover { transform: translateY(-2px); background: #9D174D; }

    /* ── Job cards: flat, hard-shadowed ── */
    .fjs-job {
        display: flex;
        align-items: center;
        gap: 16px;
        background: #fff;
        border: 2px solid #7A1C2B;
        box-shadow: 4px 4px 0 #7A1C2B;
        padding: 15px 18px;
        margin-bottom: 14px;
        text-decoration: none;
        transition: transform 0.15s ease;
    }
    .fjs-job:hover { transform: translateY(-2px); }
    .fjs-job:hover .fjs-go { background: #BE185D; color: #fff; }
    .fjs-jtitle {
        font-weight: 700;
        font-size: 19px;
        line-height: 1.25;
        color: #38212B;
        margin: 3px 0 6px;
    }
    .fjs-jmeta {
        font-size: 12.5px;
        color: #8a7f83;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .fjs-jsal {
        color: #BE185D;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        font-size: 13.5px;
    }
    .fjs-go {
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #7A1C2B;
        box-shadow: 2px 2px 0 #7A1C2B;
        background: #B9EBD6;
        color: #7A1C2B;
        transition: background 0.15s ease, color 0.15s ease;
    }
    @media (max-width: 520px) {
        .fjs-jtitle { font-size: 16px; }
        .fjs-job { gap: 12px; padding: 13px 14px; }
        .fjs-steps-panel { padding: 20px 18px 24px; }
        .fjs-steps-panel .fjs-h2 { font-size: 24px; }
    }
`;

export default function FeaturedJobs({ jobs }: FeaturedJobsProps) {
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

    if (jobs.length === 0) return null;

    return (
        <LazyMotion features={domAnimation}>
        <section className="fjs-wrap">
            <style>{css}</style>

            {/* ── Background: faint plus marks on the solid panel ── */}
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {PLUS_MARKS.map((p, i) => (
                    <span key={i} className="fjs-plus" style={{ top: p.top, left: p.left, fontSize: p.size, transform: `rotate(${p.rotate}deg)` }}>+</span>
                ))}
            </div>

            {/* ── SPLIT: Steps panel left / Jobs right ── */}
            <div className="fjs-split" style={{ position: 'relative', zIndex: 1 }}>

                {/* ═══ LEFT: how-it-works tree on its own warm panel ═══ */}
                <m.div
                    className="fjs-col-left"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={stagger}
                >
                    <div className="fjs-steps-panel">
                        <m.p variants={fadeLeft} className="fjs-eyebrow">
                            A seamless path to your next role
                        </m.p>
                        <m.h2 variants={fadeLeft} className="fjs-h2 font-heading">
                            How it works
                        </m.h2>

                        <div className="fjs-spine">
                            {STEPS.map((step, i) => (
                                <m.div key={step.title} className="fjs-step" variants={fadeLeft}>
                                    <span className="fjs-stnum">{String(i + 1).padStart(2, '0')}</span>
                                    <div>
                                        <p className="fjs-sttl">{step.title}</p>
                                        <p className="fjs-stxt">{step.desc}</p>
                                    </div>
                                </m.div>
                            ))}
                        </div>

                        <m.div variants={fadeLeft}>
                            <Link href="/register" className="fjs-join">
                                Join Now <ArrowUpRight size={15} />
                            </Link>
                        </m.div>
                    </div>
                </m.div>

                {/* ═══ RIGHT: latest openings ═══ */}
                <m.div
                    className="fjs-col-right"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={stagger}
                >
                    <m.div variants={fadeRight} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 800, color: '#7A1C2B', textTransform: 'uppercase', letterSpacing: '0.15em', margin: 0 }}>
                            Latest openings
                        </p>
                        <Link
                            href="/jobs"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', fontWeight: 700, color: '#BE185D', textDecoration: 'none' }}
                        >
                            View all <ArrowUpRight size={13} />
                        </Link>
                    </m.div>

                    {jobs.slice(0, 8).map((job) => {
                        const href = job.slug ? `/jobs/${job.slug}` : `/jobs/${job.id}`;
                        const postedDate = job.originalPostedAt || job.createdAt;

                        return (
                            <m.div key={job.id} variants={fadeRight}>
                                <Link href={href} className="fjs-job">
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p className="fjs-jmeta">
                                            <span style={{ fontWeight: 700, color: '#6b5a5e' }}>{job.employer}</span>
                                            {job.jobType && <><span>·</span><span>{job.jobType}</span></>}
                                            <span>·</span>
                                            <span>{mounted ? relativeTime(postedDate) : ''}</span>
                                        </p>
                                        <h3 className="fjs-jtitle font-heading">{job.title}</h3>
                                        <p className="fjs-jmeta">
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                <MapPin size={13} style={{ color: '#BE185D' }} />
                                                {job.location}
                                            </span>
                                            {job.displaySalary && (
                                                <span className="fjs-jsal">{job.displaySalary}</span>
                                            )}
                                        </p>
                                    </div>
                                    <span className="fjs-go" aria-hidden="true">
                                        <ArrowUpRight size={17} />
                                    </span>
                                </Link>
                            </m.div>
                        );
                    })}
                </m.div>
            </div>
        </section>
        </LazyMotion>
    );
}

'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import {
    ArrowUpRight,
    BadgeDollarSign,
    ClipboardCheck,
    FilePlus2,
    Megaphone,
    Sparkles,
    UserRoundPlus,
    type LucideIcon,
} from 'lucide-react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';
import { brand } from '@/config/brand';

// Combined two-audience "How it works" — one LIGHT clay section replacing the
// old dark employer-only spine (and the seeker spine removed from FeaturedJobs).

interface Step {
    icon: LucideIcon;
    title: string;
    desc: string;
}

interface AudienceColumn {
    id: string;
    tone: 'teal' | 'apricot';
    eyebrow: string;
    heading: string;
    steps: Step[];
    cta: { label: string; href: string };
}

const COLUMNS: AudienceColumn[] = [
    {
        id: 'nps',
        tone: 'teal',
        eyebrow: 'Job seekers',
        heading: `For ${brand.niche.descriptor}s`,
        steps: [
            {
                icon: UserRoundPlus,
                title: 'Create your profile',
                desc: 'Tell us your specialty, license state, and preferred setting — it takes a couple of minutes.',
            },
            {
                icon: Sparkles,
                title: 'Get matched to roles that fit',
                desc: `Filter across every ${brand.niche.short} specialty, or let job alerts surface new matches for you.`,
            },
            {
                icon: BadgeDollarSign,
                title: 'Apply direct, salary up front',
                desc: 'Pay sits on the listing before you apply, and applications go straight to the employer.',
            },
        ],
        cta: { label: 'Browse jobs', href: '/jobs' },
    },
    {
        id: 'employers',
        tone: 'apricot',
        eyebrow: 'Hiring teams',
        heading: 'For employers',
        steps: [
            {
                icon: FilePlus2,
                title: 'Post in minutes',
                desc: 'A focused posting form gets your role live fast — your first post is free.',
            },
            {
                icon: Megaphone,
                title: `Reach every ${brand.niche.short} specialty`,
                desc: 'Your listing surfaces in search, specialty pages, and email alerts across the board.',
            },
            {
                icon: ClipboardCheck,
                title: 'Track applicants in one place',
                desc: 'Follow views and applications from your dashboard instead of a spreadsheet.',
            },
        ],
        cta: { label: 'Post a job — first post free', href: '/post-job' },
    },
];

const css = `
    .hiw-wrap {
        background: linear-gradient(180deg, #FAFBF6 0%, #EEF4EF 52%, #FAFBF6 100%);
        position: relative;
        overflow: hidden;
    }
    .hiw-wrap::before {
        content: '';
        position: absolute;
        top: -160px;
        left: -120px;
        width: 460px;
        height: 460px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(191,232,218,0.55) 0%, transparent 70%);
        filter: blur(60px);
        pointer-events: none;
    }
    .hiw-wrap::after {
        content: '';
        position: absolute;
        bottom: -140px;
        right: -100px;
        width: 420px;
        height: 420px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(251,224,194,0.5) 0%, transparent 70%);
        filter: blur(60px);
        pointer-events: none;
    }

    .hiw-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 32px;
        align-items: stretch;
    }
    @media (max-width: 900px) {
        .hiw-grid { grid-template-columns: 1fr; gap: 24px; }
    }

    .hiw-col {
        position: relative;
        overflow: hidden;
        background: #F7FAF6;
        border-radius: 24px;
        border: 1px solid rgba(255,255,255,0.6);
        box-shadow:
            8px 8px 20px rgba(0,0,0,0.08),
            -4px -4px 12px rgba(255,255,255,0.9),
            inset 2px 2px 4px rgba(255,255,255,0.6),
            inset -1px -1px 2px rgba(0,0,0,0.02);
        padding: 36px 32px;
        display: flex;
        flex-direction: column;
    }
    @media (max-width: 520px) {
        .hiw-col { padding: 28px 20px; }
    }
    /* Soft audience-tinted glow in each column's top corner */
    .hiw-col--teal::before,
    .hiw-col--apricot::before {
        content: '';
        position: absolute;
        top: -90px;
        right: -70px;
        width: 260px;
        height: 260px;
        border-radius: 50%;
        filter: blur(40px);
        pointer-events: none;
    }
    .hiw-col--teal::before {
        background: radial-gradient(circle, rgba(191,232,218,0.7) 0%, transparent 70%);
    }
    .hiw-col--apricot::before {
        background: radial-gradient(circle, rgba(253,186,116,0.35) 0%, transparent 70%);
    }

    /* Steps + dotted teal connector */
    .hiw-steps {
        list-style: none;
        margin: 0 0 28px;
        padding: 0;
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 28px;
        flex: 1;
    }
    .hiw-steps::before {
        content: '';
        position: absolute;
        left: 27px;
        top: 28px;
        bottom: 28px;
        width: 0;
        border-left: 2px dotted rgba(190,24,93,0.32);
    }
    .hiw-step {
        display: flex;
        align-items: flex-start;
        gap: 18px;
        position: relative;
    }

    /* Mint clay icon circle (solid fill so it masks the dotted line) */
    .hiw-circle {
        position: relative;
        z-index: 1;
        flex-shrink: 0;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(145deg, #E6F6EF, #CDEBDF);
        border: 1px solid rgba(255,255,255,0.7);
        box-shadow:
            4px 4px 10px rgba(190,24,93,0.14),
            -3px -3px 8px rgba(255,255,255,0.95),
            inset 2px 2px 4px rgba(255,255,255,0.7),
            inset -2px -2px 4px rgba(190,24,93,0.08);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .hiw-num {
        position: absolute;
        top: -5px;
        right: -5px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
        box-shadow: 2px 2px 5px rgba(0,0,0,0.12), inset 1px 1px 2px rgba(255,255,255,0.35);
    }
    .hiw-num--teal { background: #BE185D; color: #fff; }
    .hiw-num--apricot { background: #FDBA74; color: #7C2D12; }

    /* Clay CTAs — raised hover, pressed active */
    .hiw-cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 44px;
        padding: 12px 26px;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.5);
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        align-self: flex-start;
    }
    .hiw-cta:focus-visible {
        outline: 3px solid rgba(190,24,93,0.45);
        outline-offset: 2px;
    }
    .hiw-cta--teal {
        background: linear-gradient(135deg, #BE185D, #9D174D);
        color: #fff;
        box-shadow:
            5px 5px 14px rgba(190,24,93,0.28),
            -3px -3px 8px rgba(255,255,255,0.8),
            inset 2px 2px 4px rgba(255,255,255,0.25),
            inset -1px -1px 2px rgba(0,0,0,0.08);
    }
    .hiw-cta--teal:hover {
        transform: translateY(-2px);
        box-shadow:
            7px 7px 18px rgba(190,24,93,0.34),
            -4px -4px 10px rgba(255,255,255,0.85),
            inset 2px 2px 5px rgba(255,255,255,0.3),
            inset -1px -1px 2px rgba(0,0,0,0.08);
    }
    .hiw-cta--teal:active {
        transform: translateY(1px);
        box-shadow:
            2px 2px 6px rgba(190,24,93,0.18),
            inset 3px 3px 6px rgba(0,0,0,0.14),
            inset -2px -2px 4px rgba(255,255,255,0.2);
    }
    .hiw-cta--apricot {
        background: linear-gradient(135deg, #FDBA74, #F59E4B);
        color: #7C2D12;
        box-shadow:
            5px 5px 14px rgba(180,83,9,0.22),
            -3px -3px 8px rgba(255,255,255,0.85),
            inset 2px 2px 4px rgba(255,255,255,0.45),
            inset -1px -1px 2px rgba(0,0,0,0.06);
    }
    .hiw-cta--apricot:hover {
        transform: translateY(-2px);
        box-shadow:
            7px 7px 18px rgba(180,83,9,0.28),
            -4px -4px 10px rgba(255,255,255,0.9),
            inset 2px 2px 5px rgba(255,255,255,0.5),
            inset -1px -1px 2px rgba(0,0,0,0.06);
    }
    .hiw-cta--apricot:active {
        transform: translateY(1px);
        box-shadow:
            2px 2px 6px rgba(180,83,9,0.16),
            inset 3px 3px 6px rgba(0,0,0,0.12),
            inset -2px -2px 4px rgba(255,255,255,0.3);
    }

    @media (max-width: 768px) {
        .hiw-inner { padding: 56px 20px !important; }
    }
    @media (max-width: 520px) {
        .hiw-inner { padding: 44px 16px !important; }
    }
    @media (prefers-reduced-motion: reduce) {
        .hiw-cta, .hiw-col { transition: none !important; }
    }
`;

const EYEBROW_CHIP: Record<AudienceColumn['tone'], CSSProperties> = {
    teal: { background: '#D9F2EA', color: '#9D174D' },
    apricot: { background: '#FFE7CC', color: '#B45309' },
};

export default function EmployerHowItWorks() {
    const prefersReducedMotion = useReducedMotion();

    const fadeUp = {
        hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 24 },
        visible: { opacity: 1, y: 0, transition: { duration: prefersReducedMotion ? 0 : 0.5 } },
    };
    const stagger = {
        visible: { transition: { staggerChildren: prefersReducedMotion ? 0 : 0.12 } },
    };

    return (
        <LazyMotion features={domAnimation}>
        <section className="hiw-wrap" aria-labelledby="hiw-title">
            <style>{css}</style>

            <m.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-60px' }}
                variants={stagger}
                className="hiw-inner"
                style={{ maxWidth: '1160px', margin: '0 auto', padding: '80px 48px', position: 'relative', zIndex: 1 }}
            >
                {/* Section header */}
                <m.p
                    variants={fadeUp}
                    style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.14em', textAlign: 'center', margin: '0 0 12px' }}
                >
                    How it works
                </m.p>
                <m.h2
                    id="hiw-title"
                    variants={fadeUp}
                    className="font-heading"
                    style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, color: '#152420', textAlign: 'center', margin: '0 0 12px', lineHeight: 1.15 }}
                >
                    Three steps, whichever side you&apos;re on
                </m.h2>
                <m.p
                    variants={fadeUp}
                    style={{ fontSize: '15px', color: 'rgba(21,36,32,0.65)', textAlign: 'center', maxWidth: '540px', margin: '0 auto 48px', lineHeight: 1.6 }}
                >
                    Looking for your next {brand.niche.descriptor} role — or hiring for one? Either way, the path is short.
                </m.p>

                {/* Two audience columns */}
                <div className="hiw-grid">
                    {COLUMNS.map((col) => (
                        <m.div key={col.id} variants={fadeUp} className={`hiw-col hiw-col--${col.tone}`}>
                            <span
                                style={{
                                    ...EYEBROW_CHIP[col.tone],
                                    display: 'inline-flex',
                                    alignSelf: 'flex-start',
                                    alignItems: 'center',
                                    padding: '5px 14px',
                                    borderRadius: '999px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.1em',
                                    boxShadow: '2px 2px 6px rgba(0,0,0,0.05), inset 1px 1px 2px rgba(255,255,255,0.6)',
                                    marginBottom: '14px',
                                    position: 'relative',
                                }}
                            >
                                {col.eyebrow}
                            </span>
                            <h3
                                className="font-heading"
                                style={{ fontSize: '24px', fontWeight: 800, color: '#152420', margin: '0 0 28px', lineHeight: 1.2, position: 'relative' }}
                            >
                                {col.heading}
                            </h3>

                            <ol className="hiw-steps">
                                {col.steps.map((step, i) => {
                                    const StepIcon = step.icon;
                                    return (
                                        <li key={step.title} className="hiw-step">
                                            <div className="hiw-circle">
                                                <StepIcon size={22} color="#BE185D" strokeWidth={2} aria-hidden="true" />
                                                <span className={`hiw-num hiw-num--${col.tone} font-heading`} aria-hidden="true">
                                                    {i + 1}
                                                </span>
                                            </div>
                                            <div style={{ paddingTop: '4px' }}>
                                                <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#1E2B27', margin: '0 0 4px', lineHeight: 1.3 }}>
                                                    {step.title}
                                                </h4>
                                                <p style={{ fontSize: '13.5px', color: 'rgba(21,36,32,0.62)', margin: 0, lineHeight: 1.55, maxWidth: '340px' }}>
                                                    {step.desc}
                                                </p>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>

                            <Link href={col.cta.href} className={`hiw-cta hiw-cta--${col.tone}`}>
                                {col.cta.label} <ArrowUpRight size={15} aria-hidden="true" />
                            </Link>
                        </m.div>
                    ))}
                </div>
            </m.div>
        </section>
        </LazyMotion>
    );
}

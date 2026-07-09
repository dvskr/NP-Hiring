'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import { brand } from '@/config/brand';

const fadeUp = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};
const stagger = {
    visible: { transition: { staggerChildren: 0.15 } },
};

// Local Google-style vector line illustrations. The -v5 derivatives are
// median-denoised (the generator baked mosquito noise around the outlines),
// margin-trimmed, Lanczos-downscaled 512px WebPs with NO sharpening (it
// re-amplifies the ringing), backgrounds pixel-rewritten to EXACTLY
// #A8D8F0 (the section band) — seamless, no tiles, halos, or seams.
const STEPS = [
    { img: '/images/how-it-works/step-employer-post-v5.webp', title: 'Post Your Listing', desc: `Start from an ${brand.niche.short} template or generate the full description with AI. Set required experience and your post is live in 5 minutes — first one free.` },
    { img: '/images/how-it-works/step-employer-reach-v5.webp', title: `Reach Every ${brand.niche.short}`, desc: 'Your listing surfaces in semantic search, the weekly digest, and new-grad-friendly filters — plus its own indexed SEO page on Google.' },
    { img: '/images/how-it-works/step-employer-browse-v5.webp', title: 'Browse & Unlock in Bulk', desc: 'Search the talent pool with experience filters, then unlock multiple profiles in one click using your remaining credits.' },
    { img: '/images/how-it-works/step-employer-track-v5.webp', title: 'Track & Hire', desc: 'Per-job views, apply clicks, and CTR in the analytics dashboard. Export CSV to your ATS or hiring spreadsheet anytime.' },
];

const css = `
    .ehw-wrap {
        /* Diorama-style band: lighter sky field so the image tiles read as
           cards — same presentation pattern as the Top States dioramas. */
        background-color: #D9EBF6;
        position: relative;
        overflow: hidden;
        border-top: 1px solid rgba(0, 0, 0, 0.04);
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
    }
    .ehw-wrap::before {
        content: '';
        position: absolute;
        top: -200px;
        left: -100px;
        width: 500px;
        height: 500px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(190,24,93,0.02) 0%, transparent 70%);
        pointer-events: none;
    }
    .ehw-wrap::after {
        content: '';
        position: absolute;
        bottom: -150px;
        right: -80px;
        width: 400px;
        height: 400px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(190,24,93,0.02) 0%, transparent 70%);
        pointer-events: none;
    }

    .ehw-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 40px;
    }
    @media (max-width: 900px) {
        .ehw-grid { grid-template-columns: repeat(2, 1fr); gap: 32px; }
    }
    @media (max-width: 520px) {
        .ehw-grid { grid-template-columns: 1fr; gap: 28px; }
    }

    .ehw-step {
        position: relative;
        text-align: center;
    }

    /* Horizontal connecting line behind dots */
    .ehw-line {
        position: absolute;
        top: 302px; /* image box 280 + dot margin 16 + half dot */
        left: 12.5%;
        right: 12.5%;
        height: 2px;
        background: linear-gradient(90deg, transparent, rgba(0,0,0,0.06), rgba(0,0,0,0.06), transparent);
        z-index: 0;
    }
    @media (max-width: 900px) {
        .ehw-line { display: none; }
    }

    /* Glowing dot */
    .ehw-dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: linear-gradient(135deg, #BE185D, #9D174D);
        box-shadow: 0 0 12px rgba(190,24,93,0.25);
        margin: 16px auto;
        position: relative;
        z-index: 1;
    }
    .ehw-dot::after {
        content: '';
        position: absolute;
        left: -4px;
        top: -4px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1px solid rgba(190,24,93,0.15);
        animation: ehwPulse 2s ease-in-out infinite;
    }
    @keyframes ehwPulse {
        0%, 100% { transform: scale(1); opacity: 0.5; }
        50% { transform: scale(1.5); opacity: 0; }
    }
    @media (max-width: 768px) {
        .ehw-inner { padding: 48px 20px !important; }
        .ehw-inner h2 { font-size: 28px !important; margin-bottom: 40px !important; }
    }
    @media (max-width: 520px) {
        .ehw-inner { padding: 40px 16px !important; }
        .ehw-inner h2 { font-size: 24px !important; margin-bottom: 32px !important; }
    }
`;

export default function EmployerHowItWorks() {
    return (
        <LazyMotion features={domAnimation}>
        <section className="ehw-wrap">
            <style>{css}</style>

            <m.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-60px' }}
                variants={stagger}
                style={{ maxWidth: '1440px', margin: '0 auto', padding: '80px 48px', position: 'relative', zIndex: 1 }}
                className="ehw-inner"
            >
                {/* Header */}
                <m.p
                    variants={fadeUp}
                    style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '12px' }}
                >
                    Built for hiring managers
                </m.p>
                <m.h2
                    variants={fadeUp}
                    className="font-lora"
                    style={{ fontSize: '44px', fontWeight: 700, color: '#111827', margin: '0 0 64px', lineHeight: 1.15 }}
                >
                    How employers hire
                </m.h2>

                {/* Horizontal 4-step grid */}
                <div style={{ position: 'relative' }}>
                    <div className="ehw-line" />
                    <div className="ehw-grid">
                        {STEPS.map((step, i) => (
                            <m.div key={i} variants={fadeUp} className="ehw-step">
                                {/* Diorama-style tile — identical treatment to the
                                    Top States cards: rounded, image fills the card,
                                    drop shadow, hover lift. */}
                                <div
                                    style={{
                                        width: 280,
                                        height: 280,
                                        margin: '0 auto',
                                        borderRadius: '24px',
                                        overflow: 'hidden',
                                        backgroundColor: '#A8D4E8',
                                        boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                                        transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.transform = 'translateY(-6px) scale(1.03)';
                                        e.currentTarget.style.boxShadow = '0 14px 32px rgba(0,0,0,0.16)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.1)';
                                    }}
                                >
                                    {/* unoptimized: denoised v5 WebPs served at native res */}
                                    <Image
                                        src={step.img}
                                        alt={step.title}
                                        width={280}
                                        height={280}
                                        unoptimized
                                        style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                                        loading="lazy"
                                    />
                                </div>

                                {/* Glowing dot */}
                                <div className="ehw-dot" />

                                {/* Title */}
                                <h4 style={{ fontSize: '18px', fontWeight: 700, color: '#1F2937', margin: '0 0 8px' }}>
                                    {step.title}
                                </h4>

                                {/* Description */}
                                <p style={{ fontSize: '13px', color: '#4B5563', margin: 0, lineHeight: 1.55, maxWidth: '240px', marginLeft: 'auto', marginRight: 'auto' }}>
                                    {step.desc}
                                </p>
                            </m.div>
                        ))}
                    </div>
                </div>

                {/* CTA */}
                <m.div variants={fadeUp} style={{ textAlign: 'center', marginTop: '56px' }}>
                    <Link
                        href="/post-job"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '13px 32px',
                            fontSize: '13px',
                            fontWeight: 700,
                            color: '#fff',
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                            background: 'linear-gradient(135deg, #c05a7a, #e8788c)',
                            borderRadius: '12px',
                            boxShadow: '0 4px 20px rgba(200,90,120,0.3)',
                            textDecoration: 'none',
                            transition: 'transform 0.3s, box-shadow 0.3s',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-3px)';
                            e.currentTarget.style.boxShadow = '0 8px 32px rgba(200,90,120,0.45)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 20px rgba(200,90,120,0.3)';
                        }}
                    >
                        Post a Job — First Post Free <ArrowUpRight size={15} />
                    </Link>
                </m.div>
            </m.div>
        </section>

        </LazyMotion>
    );
}

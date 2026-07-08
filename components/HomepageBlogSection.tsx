'use client';

import Link from 'next/link';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import { ArrowRight, BarChart3, FileText, Scale, type LucideIcon } from 'lucide-react';

import { HOMEPAGE_FEATURED_POSTS } from '@/config/niche/content-map';

/*
 * Layout lineage: Wellfound "From the blog" row grid (DevTools
 * inspection), retinted to the Clay 2.0 spruce/apricot palette:
 *
 * Row: padding 40px → 56px on hover, bg → mint tint, border-radius 16px
 * Col1 (category): 140px, ml 24px, mr 48px
 * Col2 (title): flex 1, max-w 520px, mr 64px
 * Col3 (desc): flex 1, mr 80px
 * Arrow circle: 44×44px, teal (var(--color-primary)), darkens on hover
 */

const stagger = {
    visible: { transition: { staggerChildren: 0.12 } },
};
const rowAnim = {
    hidden: { opacity: 0, y: 24 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] as const },
    },
};

// Featured post data lives in config/niche/content-map.ts (per-niche
// content pack); this component only owns the layout and motion.
const FEATURED_POSTS = HOMEPAGE_FEATURED_POSTS;

/** Empty-state resource tiles — every href is a REAL live route. */
interface CareerGuide {
    href: string;
    title: string;
    description: string;
    icon: LucideIcon;
}

const CAREER_GUIDES: readonly CareerGuide[] = [
    {
        href: '/salary-guide',
        title: 'NP Salary Guide — every state, real numbers',
        description: 'Median pay, ranges, and the states that pay NPs the most.',
        icon: BarChart3,
    },
    {
        href: '/resources/fpa-guide',
        title: 'Full Practice Authority, state by state',
        description: 'Where NPs practice independently — and where the rules are changing.',
        icon: Scale,
    },
    {
        href: '/resources/1099-vs-w2',
        title: '1099 vs W-2 for NPs',
        description: 'Taxes, benefits, and the real take-home math for contract work.',
        icon: FileText,
    },
];

/**
 * Pre-launch empty state: instead of a void (or nothing at all), show a
 * light "Career guides" panel of 3 clay tiles linking to live resource
 * pages. Swaps back to the blog rows automatically once
 * HOMEPAGE_FEATURED_POSTS in config/niche/content-map.ts is populated.
 */
function CareerGuidesPanel() {
    return (
        <section className="wf-section" aria-labelledby="hbs-guides-heading" style={{ background: '#fff', paddingTop: '88px', paddingBottom: '72px' }}>
            <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '0 24px' }}>

                {/* ═══ Header ═══ */}
                <div style={{ marginBottom: '36px', maxWidth: '620px' }}>
                    <span style={{
                        display: 'inline-block',
                        fontSize: '12px', fontWeight: 800,
                        letterSpacing: '0.14em', textTransform: 'uppercase',
                        color: 'var(--color-primary)', marginBottom: '10px',
                    }}>
                        Career guides
                    </span>
                    <h2 id="hbs-guides-heading" className="font-heading" style={{
                        fontSize: 'clamp(1.75rem, 3vw, 2.375rem)', fontWeight: 800,
                        color: 'var(--text-primary)', lineHeight: 1.15,
                        margin: '0 0 10px',
                    }}>
                        Guides NPs actually use
                    </h2>
                    <p style={{ fontSize: '15px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                        Deep dives on pay, practice authority, and contracts — built from real data.
                    </p>
                </div>

                {/* ═══ Guide tiles ═══ */}
                <LazyMotion features={domAnimation}>
                    <m.div
                        className="hbs-grid"
                        initial="hidden"
                        whileInView="visible"
                        viewport={{ once: true, margin: '-50px' }}
                        variants={stagger}
                    >
                        {CAREER_GUIDES.map((guide) => {
                            const Icon = guide.icon;
                            return (
                                <m.div key={guide.href} variants={rowAnim} style={{ display: 'flex' }}>
                                    <Link href={guide.href} className="hbs-tile">
                                        <span className="hbs-tab" aria-hidden="true" />
                                        <span className="hbs-medallion" aria-hidden="true">
                                            <Icon size={22} strokeWidth={2} />
                                        </span>
                                        <h3 className="hbs-title font-heading">{guide.title}</h3>
                                        <p className="hbs-desc">{guide.description}</p>
                                        <span className="hbs-cta">
                                            Read the guide
                                            <ArrowRight size={15} aria-hidden="true" />
                                        </span>
                                    </Link>
                                </m.div>
                            );
                        })}
                    </m.div>
                </LazyMotion>

                {/* Honest pre-launch note */}
                <p style={{
                    textAlign: 'center', fontSize: '13px',
                    color: 'var(--text-muted)', margin: '28px 0 0',
                }}>
                    Fresh guides are being written — the blog opens soon.
                </p>
            </div>

            <style jsx global>{`
                .hbs-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 16px;
                }
                .hbs-tile {
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    flex: 1;
                    padding: 28px 24px 22px;
                    background: #F7FAF6;
                    border-radius: 20px;
                    border: 1px solid rgba(255,255,255,0.6);
                    box-shadow:
                        6px 6px 16px rgba(0,0,0,0.07),
                        -3px -3px 10px rgba(255,255,255,0.9),
                        inset 2px 2px 4px rgba(255,255,255,0.6),
                        inset -1px -1px 2px rgba(0,0,0,0.02);
                    text-decoration: none;
                    overflow: hidden;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }
                .hbs-tile:hover {
                    transform: translateY(-2px);
                    box-shadow:
                        9px 9px 22px rgba(190,24,93,0.12),
                        -4px -4px 12px rgba(255,255,255,0.9),
                        inset 2px 2px 5px rgba(255,255,255,0.7),
                        inset -1px -1px 2px rgba(0,0,0,0.02);
                }
                .hbs-tile:active {
                    transform: translateY(1px);
                    box-shadow:
                        2px 2px 5px rgba(0,0,0,0.06),
                        inset 3px 3px 6px rgba(0,0,0,0.07),
                        inset -2px -2px 4px rgba(255,255,255,0.4);
                }
                .hbs-tile:focus-visible {
                    outline: 3px solid var(--color-primary);
                    outline-offset: 3px;
                }
                /* Apricot corner tab — hangs from the top edge like a folder tab */
                .hbs-tab {
                    position: absolute;
                    top: 0;
                    right: 24px;
                    width: 36px;
                    height: 16px;
                    background: var(--color-accent, #FDBA74);
                    border-radius: 0 0 9px 9px;
                    box-shadow: inset 0 -2px 3px rgba(180,83,9,0.25);
                }
                .hbs-medallion {
                    width: 46px;
                    height: 46px;
                    flex-shrink: 0;
                    border-radius: 15px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #D9F2EA;
                    color: #9D174D;
                    margin-bottom: 16px;
                    box-shadow:
                        inset 2px 2px 4px rgba(255,255,255,0.8),
                        inset -2px -2px 4px rgba(190,24,93,0.12),
                        2px 2px 6px rgba(190,24,93,0.10);
                }
                .hbs-title {
                    font-size: 19px;
                    font-weight: 800;
                    line-height: 1.3;
                    color: var(--text-primary);
                    margin: 0 0 8px;
                }
                .hbs-desc {
                    font-size: 14px;
                    line-height: 1.5;
                    color: var(--text-muted);
                    margin: 0 0 20px;
                }
                .hbs-cta {
                    margin-top: auto;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 14px;
                    font-weight: 700;
                    color: var(--color-primary);
                }
                .hbs-cta svg {
                    transition: transform 0.2s ease;
                }
                .hbs-tile:hover .hbs-cta svg {
                    transform: translateX(3px);
                }
                @media (max-width: 767px) {
                    .wf-section { padding-top: 48px !important; padding-bottom: 40px !important; }
                    .hbs-grid { grid-template-columns: 1fr; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .hbs-tile,
                    .hbs-cta svg {
                        transition: none;
                    }
                    .hbs-tile:hover,
                    .hbs-tile:active {
                        transform: none;
                    }
                    .hbs-tile:hover .hbs-cta svg {
                        transform: none;
                    }
                }
            `}</style>
        </section>
    );
}

export default function HomepageBlogSection() {
    // No authored posts yet (fresh board) — render the career-guides
    // panel (live resource pages only, no dead links) instead of a
    // void. The blog rows reappear automatically once
    // HOMEPAGE_FEATURED_POSTS in config/niche/content-map.ts is
    // populated with published posts.
    if (FEATURED_POSTS.length === 0) return <CareerGuidesPanel />;

    return (
        <section className="wf-section" style={{ background: '#fff', paddingTop: '88px', paddingBottom: '72px' }}>

            {/* ═══ Header ═══ */}
            <div className="wf-header" style={{
                padding: '0 48px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '40px',
            }}>
                <h2 className="font-heading" style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                    From the blog
                </h2>
                <Link href="/blog" className="wf-more-btn">
                    More posts
                </Link>
            </div>

            {/* ═══ Blog rows ═══ */}
            <LazyMotion features={domAnimation}>
            <m.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-50px' }}
                variants={stagger}
            >
                {FEATURED_POSTS.map((post, i) => (
                    <m.div key={i} variants={rowAnim}>
                        <Link href={post.href} className="wf-link">
                            <div className="wf-row">
                                {/* Col1: Category — 140px, ml 24px, mr 48px */}
                                <div className="wf-col1">
                                    <span className="wf-category">{post.category}</span>
                                </div>
                                {/* Col2: Title — flex 1, max-w 520px, mr 64px */}
                                <div className="wf-col2">
                                    <h3 className="wf-title font-heading">{post.title}</h3>
                                </div>
                                {/* Col3: Description — flex 1, mr 80px */}
                                <div className="wf-col3">
                                    <p className="wf-desc">{post.description}</p>
                                </div>
                                {/* Arrow circle */}
                                <div className="wf-arrow-tab">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                        <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                </div>
                            </div>
                        </Link>
                    </m.div>
                ))}
            </m.div>
            </LazyMotion>

            {/* ═══ Branded CSS ═══ */}
            <style jsx global>{`
                .wf-link {
                    text-decoration: none;
                    display: block;
                    color: inherit;
                }
                .wf-row {
                    padding: 40px 48px;
                    transition: all 0.3s ease;
                    display: flex;
                    position: relative;
                    align-items: center;
                    border-top: 1px solid #E0E8E2;
                }
                .wf-link:hover .wf-row {
                    background-color: #EAF5F0;
                    border-radius: 16px;
                    padding-top: 56px;
                    padding-bottom: 56px;
                    border-top-color: transparent;
                }
                .wf-link:hover .wf-title {
                    color: var(--color-primary);
                }
                .wf-link:hover .wf-arrow-tab {
                    transform: translateX(4px) scale(1.08);
                    background-color: var(--color-primary-dark, #9D174D);
                }
                .wf-col1 {
                    width: 140px;
                    flex-shrink: 0;
                    margin-left: 24px;
                    margin-right: 48px;
                }
                .wf-col2 {
                    flex: 1 1 0%;
                    max-width: 520px;
                    margin-right: 64px;
                }
                .wf-col3 {
                    flex: 1 1 0%;
                    margin-right: 80px;
                }
                .wf-category {
                    font-size: 12px;
                    font-weight: 600;
                    line-height: 1;
                    letter-spacing: 0.04em;
                    text-transform: uppercase;
                    color: #9D174D;
                    background: #D9F2EA;
                    padding: 6px 14px;
                    border-radius: 100px;
                    display: inline-block;
                }
                .wf-title {
                    font-size: 26px;
                    font-weight: 700;
                    line-height: 34px;
                    letter-spacing: -0.3px;
                    color: var(--text-primary);
                    margin: 0 0 12px 0;
                    transition: color 0.3s ease;
                }
                .wf-desc {
                    font-size: 14px;
                    font-weight: 400;
                    line-height: 21px;
                    color: var(--text-muted);
                    margin: 0;
                }
                .wf-arrow-tab {
                    background-color: var(--color-primary);
                    color: white;
                    border-radius: 50%;
                    justify-content: center;
                    align-items: center;
                    width: 44px;
                    height: 44px;
                    display: flex;
                    flex-shrink: 0;
                    margin-left: auto;
                    transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                                background-color 0.3s ease;
                }
                .wf-more-btn {
                    padding: 8px 20px;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-primary);
                    text-decoration: none;
                    border: 1.5px solid #d6d3d1;
                    border-radius: 100px;
                    background: transparent;
                    transition: all 0.2s ease;
                }
                .wf-more-btn:hover {
                    background: var(--color-primary);
                    color: #fff;
                    border-color: var(--color-primary);
                }
                @media (max-width: 991px) {
                    .wf-title { font-size: 22px; line-height: 30px; }
                    .wf-col1 { margin-right: 24px; }
                    .wf-col2 { margin-right: 32px; }
                    .wf-col3 { margin-right: 32px; }
                }
                @media (max-width: 768px) {
                    .wf-section { padding-top: 48px !important; padding-bottom: 40px !important; }
                    .wf-header { padding: 0 20px !important; }
                    .wf-row { flex-wrap: wrap; padding: 24px 20px; }
                    .wf-col1 { width: 100%; margin: 0 0 10px 0; }
                    .wf-col2 { width: 100%; max-width: none; margin: 0 0 8px 0; }
                    .wf-col3 { display: none; }
                    .wf-arrow-tab { display: none; }
                    .wf-link:hover .wf-row { padding-top: 32px; padding-bottom: 32px; }
                }
                @media (max-width: 479px) {
                    .wf-title { font-size: 18px; line-height: 24px; }
                    .wf-row { padding: 20px 16px; }
                    .wf-header { padding: 0 16px !important; }
                    .wf-arrow-tab { display: none; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .wf-row, .wf-title, .wf-arrow-tab, .wf-more-btn { transition: none; }
                    .wf-link:hover .wf-arrow-tab { transform: none; }
                }
            `}</style>
        </section>
    );
}

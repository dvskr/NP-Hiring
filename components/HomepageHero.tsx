'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, MapPin, Globe, Monitor, Clock, Clock3, GraduationCap } from 'lucide-react';
import { LazyMotion, domAnimation, m } from 'framer-motion';

interface HomepageHeroProps {
    jobCountDisplay: string;
}

/* ── "No Sugar" palette (user-approved mock, 2026-07-09) ──
   Oxblood ink + berry accent + soft-green highlight on the site's cream.
   Flat surfaces, hard offset shadows, square corners — no clay here by
   design: this section is the loud front door; the rest of the site keeps
   its clay language. */
const OXBLOOD = '#7A1C2B';
const BERRY = '#BE185D';
const BERRY_DARK = '#9D174D';
const SOFT_GREEN = '#B9EBD6';
const CREAM = '#F5F0EB';

/* Roles stamped into the berry block. "NP" first so the server-rendered
   frame is the generic one; client cycling starts after mount, so there is
   no hydration mismatch. */
const STAMP_ROLES = ['NP', 'FNP', 'PMHNP', 'AGNP', 'WHNP', 'PEDS', 'ACNP'];
const STAMP_INTERVAL_MS = 1700;

/* Clay quick filters — the soft, touchable counterpart to the flat No Sugar
   type above them ("clay + no sugar": you READ flat blocks, you TOUCH clay). */
const quickFilters = [
    { label: 'Remote', query: 'Remote', icon: Globe },
    { label: 'Telehealth', query: 'Telehealth', icon: Monitor },
    { label: 'Full-Time', query: 'Full-Time', icon: Clock },
    { label: 'Part-Time', query: 'Part-Time', icon: Clock3 },
    { label: 'New Grad', query: 'New Grad Friendly', icon: GraduationCap },
];
const CHIP_SHADOW = '4px 4px 10px rgba(190,24,93,0.10), -2px -2px 6px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';
const CHIP_SHADOW_HOVER = '6px 6px 14px rgba(190,24,93,0.15), -3px -3px 8px rgba(255,255,255,0.9), inset 2px 2px 5px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';

/* No Sugar role stickers — flat, tilted, hard-shadowed links into real
   category pages, scattered along the hero's edges. Every href is a live
   route from the pSEO taxonomy (lib/pseo/taxonomy-registry.ts). Hidden
   below 900px where the edges get too tight. */
interface RoleSticker {
    label: string;
    href: string;
    aria: string;
    bg: string;
    fg: string;
    pos: { top: string; left?: string; right?: string };
    rotate: number;
    delay: number; // entrance stagger, seconds
}
/* No overlap with the clay quick filters under the search bar (Remote,
   Telehealth, Full-Time, Part-Time, New Grad live there) — stickers cover
   OTHER categories. Top positions cap at 72% so nothing renders under the
   hero's lower edge. */
const STICKERS: RoleSticker[] = [
    { label: 'FNP', href: '/jobs/family-practice', aria: 'Browse family practice NP jobs', bg: SOFT_GREEN, fg: OXBLOOD, pos: { top: '12%', left: '4%' }, rotate: -4, delay: 0.1 },
    { label: 'Peds NP', href: '/jobs/pediatric', aria: 'Browse pediatric NP jobs', bg: BERRY, fg: '#fff', pos: { top: '27%', left: '8%' }, rotate: 3, delay: 0.35 },
    { label: 'PMHNP', href: '/jobs/psychiatric-mental-health', aria: 'Browse psychiatric-mental health NP jobs', bg: '#FBCFE8', fg: OXBLOOD, pos: { top: '42%', left: '3%' }, rotate: -2, delay: 0.6 },
    { label: 'Private Practice', href: '/jobs/private-practice', aria: 'Browse private practice NP jobs', bg: '#FDE3C8', fg: OXBLOOD, pos: { top: '57%', left: '9%' }, rotate: 5, delay: 0.85 },
    { label: 'Per Diem', href: '/jobs/per-diem', aria: 'Browse per diem NP jobs', bg: '#D5F5F1', fg: OXBLOOD, pos: { top: '72%', left: '4%' }, rotate: -3, delay: 1.1 },
    { label: 'Salary Guide', href: '/salary-guide', aria: 'Open the NP salary guide', bg: '#FDE3C8', fg: OXBLOOD, pos: { top: '13%', right: '5%' }, rotate: 3, delay: 0.25 },
    { label: 'Acute Care', href: '/jobs/acute-care', aria: 'Browse acute care NP jobs', bg: '#D5F5F1', fg: OXBLOOD, pos: { top: '28%', right: '3%' }, rotate: -5, delay: 0.5 },
    { label: 'AGNP', href: '/jobs/adult-gerontology', aria: 'Browse adult-gerontology NP jobs', bg: SOFT_GREEN, fg: OXBLOOD, pos: { top: '44%', right: '7%' }, rotate: 2, delay: 0.75 },
    { label: 'Travel NP', href: '/jobs/travel', aria: 'Browse travel NP jobs', bg: BERRY, fg: '#fff', pos: { top: '58%', right: '4%' }, rotate: -3, delay: 1.0 },
    { label: 'WHNP', href: '/jobs/women-health', aria: "Browse women's health NP jobs", bg: '#FBCFE8', fg: OXBLOOD, pos: { top: '72%', right: '9%' }, rotate: 4, delay: 1.25 },
];
const RESTAMP_INTERVAL_MS = 4000;

const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } },
};

export default function HomepageHero({ jobCountDisplay }: HomepageHeroProps) {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [locationQuery, setLocationQuery] = useState('');
    const [roleIndex, setRoleIndex] = useState(0);
    /* {idx, n}: which sticker re-stamps, and a nonce so the same sticker can
       re-stamp twice in a row (key change forces the remount that replays
       the stamp-in animation). */
    const [restamp, setRestamp] = useState({ idx: -1, n: 0 });

    /* Cycle the stamped role. Skipped entirely under prefers-reduced-motion
       (the word stays "NP" and nothing animates). */
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const id = setInterval(
            () => setRoleIndex((i) => (i + 1) % STAMP_ROLES.length),
            STAMP_INTERVAL_MS,
        );
        return () => clearInterval(id);
    }, []);

    /* Every few seconds a random sticker re-stamps. */
    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const id = setInterval(
            () => setRestamp((r) => ({ idx: Math.floor(Math.random() * STICKERS.length), n: r.n + 1 })),
            RESTAMP_INTERVAL_MS,
        );
        return () => clearInterval(id);
    }, []);

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        if (locationQuery.trim()) params.set('location', locationQuery.trim());
        const queryString = params.toString();
        router.push(queryString ? `/jobs?${queryString}` : '/jobs');
    };

    const stampedRole = STAMP_ROLES[roleIndex];

    return (
        <LazyMotion features={domAnimation}>
        <section
            style={{
                position: 'relative',
                margin: 0,
                marginTop: -80,
                overflow: 'hidden',
                background: CREAM,
                /* content-driven height — no minHeight, so the hero ends right
                   after the filter chips and the next section tucks up close */
            }}
        >
            {/* ── Graph-paper grid, oxblood-tinted ── */}
            <div
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    backgroundImage:
                        'linear-gradient(rgba(122,28,43,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(122,28,43,0.09) 1px, transparent 1px)',
                    backgroundSize: '44px 44px',
                }}
            />

            <m.div
                variants={container}
                initial="hidden"
                animate="show"
                style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    /* just enough top clearance for the floating pill nav */
                    padding: '96px 24px 96px',
                    width: '100%',
                    maxWidth: '1100px',
                    margin: '0 auto',
                }}
            >
                {/* ── Headline: REAL <role> JOBS. / REAL NUMBERS. ── */}
                <m.h1
                    variants={fadeUp}
                    className="font-heading"
                    style={{
                        /* Lora tops out at 700 — heavier values would synthesize */
                        fontWeight: 700,
                        fontSize: 'clamp(2.4rem, 6.2vw, 5rem)',
                        lineHeight: 0.98,
                        letterSpacing: '-0.01em',
                        textTransform: 'uppercase',
                        color: OXBLOOD,
                        margin: 0,
                    }}
                >
                    Real{' '}
                    <span
                        style={{
                            background: BERRY,
                            color: '#fff',
                            padding: '0 12px',
                            display: 'inline-block',
                            transform: 'rotate(-1.2deg)',
                        }}
                    >
                        {/* key remount re-fires the stamp animation each cycle */}
                        <span key={stampedRole} className="ns-stamp">{stampedRole}</span>
                        {' '}jobs.
                    </span>
                    <br />
                    Real{' '}
                    <span
                        style={{
                            background: SOFT_GREEN,
                            color: OXBLOOD,
                            padding: '0 12px',
                            display: 'inline-block',
                            transform: 'rotate(1deg)',
                        }}
                    >
                        numbers.
                    </span>
                </m.h1>

                {/* ── Subline ── */}
                <m.p
                    variants={fadeUp}
                    style={{
                        fontSize: '16px',
                        fontWeight: 600,
                        color: OXBLOOD,
                        margin: '26px 0 32px',
                    }}
                >
                    {jobCountDisplay} openings. Every specialty. Zero &ldquo;competitive pay&rdquo; nonsense.
                </m.p>

                {/* ── Search — flat, hard-shadowed ── */}
                <m.form
                    variants={fadeUp}
                    onSubmit={handleSubmit}
                    role="search"
                    style={{ width: '100%', maxWidth: '640px' }}
                >
                    <div
                        className="ns-search-bar"
                        style={{
                            display: 'flex',
                            alignItems: 'stretch',
                            background: '#fff',
                            border: `3px solid ${OXBLOOD}`,
                            boxShadow: `8px 8px 0 ${OXBLOOD}`,
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '15px 18px', flex: 1, minWidth: 0 }}>
                            <Search size={18} style={{ color: '#9b8291', flexShrink: 0 }} aria-hidden="true" />
                            <input
                                aria-label="Job title or keyword"
                                placeholder="Role or specialty"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoComplete="off"
                                className="hero-search-input"
                                style={{ border: 'none', background: 'transparent', width: '100%', fontSize: '16px', fontWeight: 600, color: '#1f2937', textAlign: 'left' }}
                            />
                        </div>
                        <div className="ns-search-divider" style={{ width: '3px', background: OXBLOOD, flexShrink: 0 }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '15px 18px', flex: 1, minWidth: 0 }}>
                            <MapPin size={18} style={{ color: '#9b8291', flexShrink: 0 }} aria-hidden="true" />
                            <input
                                aria-label="City or remote"
                                placeholder="City or 'Remote'"
                                value={locationQuery}
                                onChange={(e) => setLocationQuery(e.target.value)}
                                autoComplete="off"
                                className="hero-search-input"
                                style={{ border: 'none', background: 'transparent', width: '100%', fontSize: '16px', fontWeight: 600, color: '#1f2937', textAlign: 'left' }}
                            />
                        </div>
                        <button
                            type="submit"
                            className="ns-search-btn"
                            style={{
                                background: BERRY,
                                color: '#fff',
                                padding: '0 26px',
                                fontSize: '14px',
                                fontWeight: 700,
                                letterSpacing: '0.02em',
                                border: 'none',
                                borderLeft: `3px solid ${OXBLOOD}`,
                                cursor: 'pointer',
                                flexShrink: 0,
                                transition: 'background 0.2s ease',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = BERRY_DARK; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = BERRY; }}
                        >
                            Search →
                        </button>
                    </div>
                </m.form>

                {/* ── Clay quick filters ── */}
                <m.div
                    variants={fadeUp}
                    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '26px' }}
                >
                    {quickFilters.map((filter) => {
                        const Icon = filter.icon;
                        return (
                            <Link
                                key={filter.label}
                                href={`/jobs?q=${encodeURIComponent(filter.query)}`}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '12px 20px',
                                    borderRadius: '24px',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    background: '#D5F5F1',
                                    color: OXBLOOD,
                                    textDecoration: 'none',
                                    border: '1px solid rgba(255,255,255,0.5)',
                                    boxShadow: CHIP_SHADOW,
                                    transition: 'all 0.2s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = '#B9EBD6';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = CHIP_SHADOW_HOVER;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = '#D5F5F1';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = CHIP_SHADOW;
                                }}
                            >
                                <Icon size={14} />
                                {filter.label}
                            </Link>
                        );
                    })}
                </m.div>
            </m.div>

            {/* ── Role stickers — clickable, edge-scattered. Rendered after the
                 content column so their hit areas sit on top; the container
                 itself is click-transparent. ── */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
                {STICKERS.map((s, i) => {
                    const isRestamping = restamp.idx === i;
                    return (
                        <Link
                            /* key change on restamp remounts → replays stamp-in */
                            key={isRestamping ? `${s.label}-${restamp.n}` : s.label}
                            href={s.href}
                            aria-label={s.aria}
                            className="ns-stk"
                            style={{
                                top: s.pos.top,
                                left: s.pos.left,
                                right: s.pos.right,
                                background: s.bg,
                                color: s.fg,
                                transform: `rotate(${s.rotate}deg)`,
                                /* stagger only applies to the page-load entrance */
                                animationDelay: isRestamping ? '0s, 0s' : `${s.delay}s, ${s.delay}s`,
                            }}
                        >
                            {s.label}
                        </Link>
                    );
                })}
            </div>

            <style jsx global>{`
                @keyframes ns-stamp-in {
                    0% { transform: scale(1.6) rotate(-4deg); opacity: 0; }
                    60% { transform: scale(0.94) rotate(1deg); opacity: 1; }
                    100% { transform: scale(1) rotate(0); }
                }
                .ns-stamp {
                    display: inline-block;
                    min-width: 4.2ch;
                    text-align: center;
                    animation: ns-stamp-in 0.3s cubic-bezier(0.2, 1.6, 0.4, 1) both;
                }
                .ns-stk {
                    position: absolute;
                    pointer-events: auto;
                    padding: 8px 14px;
                    font-weight: 800;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    white-space: nowrap;
                    text-decoration: none;
                    border: 2px solid #7A1C2B;
                    box-shadow: 4px 4px 0 #7A1C2B;
                    cursor: pointer;
                    opacity: 0;
                    animation:
                        ns-stk-in 0.45s cubic-bezier(0.2, 1.5, 0.4, 1) forwards,
                        ns-stk-drift 6s ease-in-out infinite alternate;
                    transition: transform 0.2s ease;
                }
                /* final frame sets ONLY opacity so the inline rotate(Ndeg)
                   comes back once the entrance finishes */
                @keyframes ns-stk-in {
                    0% { opacity: 0; transform: scale(1.7) rotate(-8deg); }
                    70% { opacity: 1; transform: scale(0.95); }
                    100% { opacity: 1; }
                }
                .ns-stk:hover,
                .ns-stk:focus-visible {
                    transform: scale(1.12) rotate(0deg) !important;
                    z-index: 6;
                }
                .ns-stk:focus-visible {
                    outline: 3px solid #BE185D;
                    outline-offset: 2px;
                }
                /* drift animates margin (not transform) so it never fights the
                   inline rotation or the hover scale */
                @keyframes ns-stk-drift {
                    from { margin-top: -5px; }
                    to { margin-top: 6px; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .ns-stamp { animation: none; }
                    .ns-stk { animation: none; opacity: 1; }
                }
                @media (max-width: 900px) {
                    .ns-stk { display: none; }
                }
                @media (max-width: 560px) {
                    .ns-search-bar { flex-direction: column; }
                    .ns-search-divider { width: 100% !important; height: 3px; }
                    .ns-search-btn { padding: 14px 26px !important; }
                }
            `}</style>
        </section>
        </LazyMotion>
    );
}

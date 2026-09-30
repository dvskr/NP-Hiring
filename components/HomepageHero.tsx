'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, MapPin, Globe, Monitor, Clock, Clock3, GraduationCap } from 'lucide-react';
import { LazyMotion, domAnimation, m, useReducedMotion } from 'framer-motion';
import { getHeroVariants } from '@/components/header-nav-motion';
import { brand } from '@/config/brand';

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
   type above them ("clay + no sugar": you READ flat blocks, you TOUCH clay).

   Indexing audit H-04: each chip links its category landing page, not a
   `/jobs?q=` keyword search. Every search URL answers "noindex, follow" with
   a canonical to /jobs, so the homepage's most prominent links were pointing
   Google at pages it is told to drop, while the landings they stand for (all
   in the sitemap) got no homepage link at all. The keyword search for "New
   Grad Friendly" also returned zero jobs. */
const quickFilters = [
    { label: 'Remote', href: '/jobs/remote', icon: Globe },
    { label: 'Telehealth', href: '/jobs/telehealth', icon: Monitor },
    { label: 'Full-Time', href: '/jobs/full-time', icon: Clock },
    { label: 'Part-Time', href: '/jobs/part-time', icon: Clock3 },
    { label: 'New Grad', href: '/jobs/new-grad', icon: GraduationCap },
];
const CHIP_SHADOW = '4px 4px 10px rgba(190,24,93,0.10), -2px -2px 6px rgba(255,255,255,0.8), inset 2px 2px 4px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';
const CHIP_SHADOW_HOVER = '6px 6px 14px rgba(190,24,93,0.15), -3px -3px 8px rgba(255,255,255,0.9), inset 2px 2px 5px rgba(255,255,255,0.7), inset -1px -1px 2px rgba(0,0,0,0.03)';

/* No Sugar role stickers — flat, tilted, hard-shadowed links into real
   category pages, scattered along the hero's edges. Hidden below 900px where
   the edges get too tight.

   The look (position, tilt, colour, entrance delay) belongs to the SLOT; the
   link belongs to the STICKER. That split is what lets the set follow the
   index gate (indexing audit H-04): a category sticker renders only while its
   landing page is indexable (the aggregate-pseo 'category-landing' verdict,
   read on the server in app/page.tsx), and the next candidate takes the
   freed slot, so the hero never links a landing Google is told to drop or
   one that shows zero positions. Private Practice and AGNP were both live
   "noindex, follow" with 0 jobs when the audit ran. */
interface StickerSlot {
    bg: string;
    fg: string;
    pos: { top: string; left?: string; right?: string };
    rotate: number;
    delay: number; // entrance stagger, seconds
}
interface StickerLink {
    label: string;
    href: string;
    aria: string;
}
export type PlacedSticker = StickerLink & StickerSlot;

const LANDING_PREFIX = '/jobs/';

/** The category landing slug a sticker opens (`/jobs/{slug}`), else null. */
function landingSlugOf(href: string): string | null {
    return href.startsWith(LANDING_PREFIX) ? href.slice(LANDING_PREFIX.length) : null;
}

/* Top positions cap at 72% so nothing renders under the hero's lower edge.
   Slots 0 to 4 run down the left edge, 5 to 9 down the right. */
const STICKER_SLOTS: readonly StickerSlot[] = [
    { bg: SOFT_GREEN, fg: OXBLOOD, pos: { top: '12%', left: '4%' }, rotate: -4, delay: 0.1 },
    { bg: BERRY, fg: '#fff', pos: { top: '27%', left: '8%' }, rotate: 3, delay: 0.35 },
    { bg: '#FBCFE8', fg: OXBLOOD, pos: { top: '42%', left: '3%' }, rotate: -2, delay: 0.6 },
    { bg: '#FDE3C8', fg: OXBLOOD, pos: { top: '57%', left: '9%' }, rotate: 5, delay: 0.85 },
    { bg: '#D5F5F1', fg: OXBLOOD, pos: { top: '72%', left: '4%' }, rotate: -3, delay: 1.1 },
    { bg: '#FDE3C8', fg: OXBLOOD, pos: { top: '13%', right: '5%' }, rotate: 3, delay: 0.25 },
    { bg: '#D5F5F1', fg: OXBLOOD, pos: { top: '28%', right: '3%' }, rotate: -5, delay: 0.5 },
    { bg: SOFT_GREEN, fg: OXBLOOD, pos: { top: '44%', right: '7%' }, rotate: 2, delay: 0.75 },
    { bg: BERRY, fg: '#fff', pos: { top: '58%', right: '4%' }, rotate: -3, delay: 1.0 },
    { bg: '#FBCFE8', fg: OXBLOOD, pos: { top: '72%', right: '9%' }, rotate: 4, delay: 1.25 },
];

/* The salary guide is not a listing page and has no category gate, so it
   keeps its top-right slot whatever the category set does. */
const SALARY_GUIDE_SLOT = 5;
const SALARY_GUIDE_STICKER: StickerLink = { label: 'Salary Guide', href: '/salary-guide', aria: 'Open the NP salary guide' };

/* Category candidates in priority order. No overlap with the clay quick
   filters under the search bar (Remote, Telehealth, Full-Time, Part-Time,
   New Grad live there). More candidates than slots, so a landing that drops
   out of the index is replaced rather than leaving a hole. */
const CATEGORY_STICKERS: readonly StickerLink[] = [
    { label: 'FNP', href: '/jobs/family-practice', aria: 'Browse family practice NP jobs' },
    { label: 'Peds NP', href: '/jobs/pediatric', aria: 'Browse pediatric NP jobs' },
    { label: 'PMHNP', href: '/jobs/psychiatric-mental-health', aria: 'Browse psychiatric-mental health NP jobs' },
    { label: 'Urgent Care', href: '/jobs/urgent-care', aria: 'Browse urgent care NP jobs' },
    { label: 'Per Diem', href: '/jobs/per-diem', aria: 'Browse per diem NP jobs' },
    { label: 'Acute Care', href: '/jobs/acute-care', aria: 'Browse acute care NP jobs' },
    { label: 'Travel NP', href: '/jobs/travel', aria: 'Browse travel NP jobs' },
    { label: 'WHNP', href: '/jobs/women-health', aria: "Browse women's health NP jobs" },
    { label: 'AGNP', href: '/jobs/adult-gerontology', aria: 'Browse adult-gerontology NP jobs' },
    { label: 'Private Practice', href: '/jobs/private-practice', aria: 'Browse private practice NP jobs' },
    { label: 'Primary Care', href: '/jobs/primary-care', aria: 'Browse primary care NP jobs' },
    { label: 'Emergency', href: '/jobs/emergency', aria: 'Browse emergency NP jobs' },
];

/**
 * The stickers to render, placed into slots: the salary guide in its fixed
 * slot, then every candidate whose landing is in `indexableLandingSlugs`, in
 * priority order, until the slots run out. Slots left over stay empty.
 */
export function selectHeroStickers(indexableLandingSlugs: readonly string[]): PlacedSticker[] {
    const indexable = new Set(indexableLandingSlugs);
    const queue = CATEGORY_STICKERS.filter((sticker) => {
        const slug = landingSlugOf(sticker.href);
        return slug !== null && indexable.has(slug);
    });
    let next = 0;
    const placed: PlacedSticker[] = [];
    STICKER_SLOTS.forEach((slot, index) => {
        const link = index === SALARY_GUIDE_SLOT ? SALARY_GUIDE_STICKER : queue[next++];
        if (link) placed.push({ ...link, ...slot });
    });
    return placed;
}

const RESTAMP_INTERVAL_MS = 4000;

/* The visible H1 (indexing audit L-03). The big stamped line below it is the
   brand hook, and it only ever said "NP jobs.", which is thin as the one
   heading on the page that anchors the domain. */
const HERO_HEADING = `${brand.niche.descriptor.charAt(0).toUpperCase()}${brand.niche.descriptor.slice(1)} jobs`;

interface HomepageHeroProps {
    /** Category landing slugs whose page is indexable right now (app/page.tsx). */
    indexableLandingSlugs?: readonly string[];
}

export default function HomepageHero({ indexableLandingSlugs = [] }: HomepageHeroProps) {
    const stickers = useMemo(() => selectHeroStickers(indexableLandingSlugs), [indexableLandingSlugs]);
    const stickerCount = stickers.length;
    const router = useRouter();
    const [searchQuery, setSearchQuery] = useState('');
    const [locationQuery, setLocationQuery] = useState('');
    const [roleIndex, setRoleIndex] = useState(0);
    /* {idx, n}: which sticker re-stamps, and a nonce so the same sticker can
       re-stamp twice in a row (key change forces the remount that replays
       the stamp-in animation). */
    const [restamp, setRestamp] = useState({ idx: -1, n: 0 });
    /* Entrance stagger. Under prefers-reduced-motion the variants carry a
       zero-duration, zero-delay transition, so the headline, search and chips
       snap to their resting state instead of rising and fading in. */
    const reduceMotion = useReducedMotion();
    const { container, fadeUp } = getHeroVariants(reduceMotion);

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
        if (stickerCount === 0) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const id = setInterval(
            () => setRestamp((r) => ({ idx: Math.floor(Math.random() * stickerCount), n: r.n + 1 })),
            RESTAMP_INTERVAL_MS,
        );
        return () => clearInterval(id);
    }, [stickerCount]);

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
                {/* ── H1 (indexing audit L-03) ──
                    The page's one heading names the topic in words a search
                    engine and a screen reader can use. It sits ABOVE the
                    stamp line as its eyebrow, so the owner's 2026-09-11
                    direction still holds: nothing between the stamp line
                    and the search bar. */}
                <m.h1 variants={fadeUp} className="ns-h1">
                    {HERO_HEADING}
                </m.h1>

                {/* ── Display line: <role> JOBS. ──
                    Owner direction 2026-09-11: a single line — the cycling
                    role stamp and the word "jobs." Nothing under it but the
                    search bar. Decorative restatement of the H1 above, so it
                    is hidden from assistive tech (the cycling stamp would
                    otherwise read as a stream of abbreviations). */}
                <m.p
                    variants={fadeUp}
                    aria-hidden="true"
                    className="font-heading"
                    style={{
                        /* Lora tops out at 700 — heavier values would synthesize */
                        fontWeight: 700,
                        fontSize: 'clamp(2.4rem, 6.2vw, 5rem)',
                        lineHeight: 0.98,
                        letterSpacing: '-0.01em',
                        textTransform: 'uppercase',
                        color: OXBLOOD,
                        /* headline sits straight on the search bar now — no subline */
                        margin: '0 0 36px',
                    }}
                >
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
                    </span>
                    {' '}jobs.
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
                                href={filter.href}
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

                {/* ── What the site is (indexing audit L-03) ──
                    One plain sentence under the chips, so the page that
                    anchors the domain says what it lists and where the
                    listings come from. Kept below the controls, per the
                    owner's "nothing under the headline but the search bar". */}
                <m.p variants={fadeUp} className="ns-intro">
                    {brand.name} lists {brand.niche.descriptor} and other APRN openings from
                    employers&apos; own career sites and direct employer posts, updated daily.
                    Free for job seekers.
                </m.p>
            </m.div>

            {/* ── Role stickers — clickable, edge-scattered. Rendered after the
                 content column so their hit areas sit on top; the container
                 itself is click-transparent. ── */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
                {stickers.map((s, i) => {
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
                .ns-h1 {
                    margin: 0 0 14px;
                    font-size: 13px;
                    font-weight: 800;
                    line-height: 1.3;
                    letter-spacing: 0.2em;
                    text-transform: uppercase;
                    color: #BE185D;
                }
                .ns-intro {
                    margin: 26px auto 0;
                    max-width: 560px;
                    font-size: 14px;
                    line-height: 1.6;
                    color: #5A4A42;
                }
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

import Link from 'next/link';
import {
    Activity,
    ArrowRight,
    Baby,
    Brain,
    CalendarClock,
    GraduationCap,
    Heart,
    Laptop,
    LayoutGrid,
    Plane,
    Siren,
    Stethoscope,
    Users,
    Video,
    type LucideIcon,
} from 'lucide-react';

import { CATEGORY_AXES } from '@/lib/pseo/taxonomy-registry';

/**
 * SpecialtyBrowseSection (Server Component)
 *
 * Clay bento grid of curated category tiles linking to the real
 * /jobs/<slug> landing pages from the taxonomy registry. CSS-only
 * hover (no framer-motion, no 'use client') — clay lift on hover,
 * pressed on active, honors prefers-reduced-motion.
 *
 * Tiles are built from a literal curated list, then verified against
 * Object.values(CATEGORY_AXES).flat() so a slug removed from the
 * registry silently drops out instead of shipping a dead link.
 */

interface CategoryTile {
    slug: string;
    hook: string;
    icon: LucideIcon;
    /** Double-width bento tile with apricot accent + larger type. */
    wide?: boolean;
}

/** Slugs whose display label isn't a simple title-case of the slug. */
const IRREGULAR_LABELS: Record<string, string> = {
    'women-health': "Women's Health",
    'adult-gerontology': 'Adult-Gerontology',
    'psychiatric-mental-health': 'Psychiatric-Mental Health',
    'per-diem': 'Per Diem',
    'new-grad': 'New Grad',
};

function labelForSlug(slug: string): string {
    const irregular = IRREGULAR_LABELS[slug];
    if (irregular) return irregular;
    return slug
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Curated tiles, ordered so the 4-col desktop bento tiles perfectly:
 * row 1 = remote(2) + telehealth + travel; rows 2-3 = specialties +
 * per-diem; row 4 = new-grad(2) + browse-all(2).
 */
const CURATED_TILES: readonly CategoryTile[] = [
    { slug: 'remote', hook: 'Work from anywhere in the country', icon: Laptop, wide: true },
    { slug: 'telehealth', hook: 'Virtual care, flexible hours', icon: Video },
    { slug: 'travel', hook: 'Short contracts, new cities', icon: Plane },
    { slug: 'family-practice', hook: 'Family practice roles', icon: Users },
    { slug: 'psychiatric-mental-health', hook: 'Behavioral health demand', icon: Brain },
    { slug: 'adult-gerontology', hook: 'Adult & older-adult care', icon: Stethoscope },
    { slug: 'pediatric', hook: 'Care for kids & teens', icon: Baby },
    { slug: 'women-health', hook: 'OB, GYN & beyond', icon: Heart },
    { slug: 'acute-care', hook: 'Hospital-side acuity', icon: Activity },
    { slug: 'emergency', hook: 'Fast-paced ED shifts', icon: Siren },
    { slug: 'per-diem', hook: 'Pick up shifts on your terms', icon: CalendarClock },
    { slug: 'new-grad', hook: 'Mentored first roles for new NPs', icon: GraduationCap, wide: true },
];

/** Every registered category slug — guards curated tiles against drift. */
const REGISTERED_SLUGS: ReadonlySet<string> = new Set<string>(
    (Object.values(CATEGORY_AXES) as readonly (readonly string[])[]).flat(),
);

export default function SpecialtyBrowseSection() {
    const tiles = CURATED_TILES.filter((tile) => REGISTERED_SLUGS.has(tile.slug));
    if (tiles.length === 0) return null;

    const totalCategories = REGISTERED_SLUGS.size;

    return (
        <section aria-labelledby="sbs-heading" style={{ padding: '72px 0 64px', position: 'relative' }}>
            <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '0 24px' }}>

                {/* ═══ Header ═══ */}
                <div style={{ marginBottom: '36px', maxWidth: '620px' }}>
                    <span style={{
                        display: 'inline-block',
                        fontSize: '12px', fontWeight: 800,
                        letterSpacing: '0.14em', textTransform: 'uppercase',
                        color: 'var(--color-primary)', marginBottom: '10px',
                    }}>
                        Find your lane
                    </span>
                    <h2 id="sbs-heading" className="font-heading" style={{
                        fontSize: 'clamp(1.75rem, 3vw, 2.375rem)', fontWeight: 800,
                        color: 'var(--text-primary)', lineHeight: 1.15,
                        margin: '0 0 10px',
                    }}>
                        Browse by specialty &amp; setting
                    </h2>
                    <p style={{ fontSize: '15px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                        Every NP path gets its own page — jump straight to the roles that match yours.
                    </p>
                </div>

                {/* ═══ Bento grid ═══ */}
                <div className="sbs-grid">
                    {tiles.map((tile) => {
                        const Icon = tile.icon;
                        return (
                            <Link
                                key={tile.slug}
                                href={`/jobs/${tile.slug}`}
                                className={tile.wide ? 'sbs-tile sbs-tile-wide' : 'sbs-tile'}
                            >
                                <span className="sbs-medallion" aria-hidden="true">
                                    <Icon size={22} strokeWidth={2} />
                                </span>
                                <span className="sbs-tile-text">
                                    <span className="sbs-tile-label font-heading">{labelForSlug(tile.slug)}</span>
                                    <span className="sbs-tile-hook">{tile.hook}</span>
                                </span>
                                {tile.wide && (
                                    <ArrowRight size={18} className="sbs-tile-arrow" aria-hidden="true" />
                                )}
                            </Link>
                        );
                    })}

                    {/* Browse-all tile — completes the bento row, dashed clay stub */}
                    <Link href="/jobs" className="sbs-tile sbs-tile-wide sbs-tile-all">
                        <span className="sbs-medallion sbs-medallion-all" aria-hidden="true">
                            <LayoutGrid size={22} strokeWidth={2} />
                        </span>
                        <span className="sbs-tile-text">
                            <span className="sbs-tile-label font-heading" style={{ color: 'var(--color-primary)' }}>
                                Browse all {totalCategories} categories
                            </span>
                            <span className="sbs-tile-hook">
                                Every specialty, setting &amp; schedule
                            </span>
                        </span>
                        <ArrowRight size={18} className="sbs-tile-arrow" aria-hidden="true" />
                    </Link>
                </div>
            </div>

            <style>{`
                .sbs-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 16px;
                }
                @media (min-width: 1024px) {
                    .sbs-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
                }
                .sbs-tile {
                    position: relative;
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    padding: 18px 20px;
                    min-height: 88px;
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
                    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
                }
                .sbs-tile:hover {
                    transform: translateY(-2px);
                    box-shadow:
                        9px 9px 22px rgba(190,24,93,0.12),
                        -4px -4px 12px rgba(255,255,255,0.9),
                        inset 2px 2px 5px rgba(255,255,255,0.7),
                        inset -1px -1px 2px rgba(0,0,0,0.02);
                }
                .sbs-tile:active {
                    transform: translateY(1px);
                    box-shadow:
                        2px 2px 5px rgba(0,0,0,0.06),
                        inset 3px 3px 6px rgba(0,0,0,0.07),
                        inset -2px -2px 4px rgba(255,255,255,0.4);
                }
                .sbs-tile:focus-visible {
                    outline: 3px solid var(--color-primary);
                    outline-offset: 3px;
                }
                .sbs-tile-wide {
                    grid-column: span 2;
                }
                /* Soft apricot corner glow on the two feature tiles */
                .sbs-tile-wide:not(.sbs-tile-all)::after {
                    content: '';
                    position: absolute;
                    top: -20px;
                    right: -20px;
                    width: 64px;
                    height: 64px;
                    border-radius: 50%;
                    background: rgba(253,186,116,0.4);
                    filter: blur(4px);
                    pointer-events: none;
                }
                .sbs-medallion {
                    width: 46px;
                    height: 46px;
                    flex-shrink: 0;
                    border-radius: 15px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: #D9F2EA;
                    color: #9D174D;
                    box-shadow:
                        inset 2px 2px 4px rgba(255,255,255,0.8),
                        inset -2px -2px 4px rgba(190,24,93,0.12),
                        2px 2px 6px rgba(190,24,93,0.10);
                }
                .sbs-tile-wide:not(.sbs-tile-all) .sbs-medallion {
                    background: #FFE7CC;
                    color: #B45309;
                    box-shadow:
                        inset 2px 2px 4px rgba(255,255,255,0.85),
                        inset -2px -2px 4px rgba(180,83,9,0.12),
                        2px 2px 6px rgba(180,83,9,0.10);
                }
                .sbs-medallion-all {
                    background: #FFFFFF;
                }
                .sbs-tile-text {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }
                .sbs-tile-label {
                    display: block;
                    font-size: 15.5px;
                    font-weight: 700;
                    color: var(--text-primary);
                    line-height: 1.25;
                }
                .sbs-tile-wide .sbs-tile-label {
                    font-size: 18px;
                    font-weight: 800;
                }
                .sbs-tile-hook {
                    display: block;
                    font-size: 13px;
                    color: var(--text-muted);
                    margin-top: 3px;
                    line-height: 1.35;
                }
                .sbs-tile-arrow {
                    margin-left: auto;
                    flex-shrink: 0;
                    color: var(--color-primary);
                    transition: transform 0.2s ease;
                }
                .sbs-tile:hover .sbs-tile-arrow {
                    transform: translateX(3px);
                }
                .sbs-tile-all {
                    background: rgba(217,242,234,0.45);
                    border: 1.5px dashed rgba(190,24,93,0.3);
                    box-shadow: none;
                }
                .sbs-tile-all:hover {
                    border-color: rgba(190,24,93,0.55);
                    box-shadow: 6px 6px 16px rgba(190,24,93,0.10);
                }
                @media (max-width: 479px) {
                    .sbs-grid { grid-template-columns: 1fr; }
                    .sbs-tile-wide { grid-column: auto; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .sbs-tile,
                    .sbs-tile-arrow {
                        transition: none;
                    }
                    .sbs-tile:hover,
                    .sbs-tile:active {
                        transform: none;
                    }
                    .sbs-tile:hover .sbs-tile-arrow {
                        transform: none;
                    }
                }
            `}</style>
        </section>
    );
}

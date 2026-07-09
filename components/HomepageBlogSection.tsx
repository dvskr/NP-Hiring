import Link from 'next/link';

import { HOMEPAGE_FEATURED_POSTS, type FeaturedBlogPost } from '@/config/niche/content-map';

/* ── "Reading tape" (user-approved R4 mock, 2026-07-10) ──
 * A slow horizontal conveyor of post cards on the cream + grid stage —
 * the same motion language as the employer sticker tape, so the page
 * rhymes. CSS-only marquee (no framer-motion, no client JS): pauses on
 * hover, static under prefers-reduced-motion.
 *
 * EMPTY-BLOG FALLBACK: HOMEPAGE_FEATURED_POSTS is empty until NP posts
 * are authored (see config/niche/content-map.ts). Instead of vanishing,
 * the tape carries the three live resource guides so the section always
 * has real, non-404 content.
 */

const RESOURCE_GUIDES: FeaturedBlogPost[] = [
    { category: 'Salary Guide', title: 'NP Salary Guide — every state, real numbers', description: 'Median pay, ranges, and the states that pay NPs the most.', href: '/salary-guide' },
    { category: 'Licensure', title: 'Full Practice Authority, state by state', description: 'Where NPs practice independently — and where the rules are changing.', href: '/resources/fpa-guide' },
    { category: 'Contracts', title: '1099 vs W-2 for NPs', description: 'Taxes, benefits, and the real take-home math for contract work.', href: '/resources/1099-vs-w2' },
];

/* Clay chip fills alternate; bar widths are a decorative accent only. */
const CHIP_FILLS = ['#D5F5F1', '#FBCFE8', '#FDE3C8', '#B9EBD6'];
const BAR_WIDTHS = ['38%', '64%', '22%', '50%'];

/* Static CSS only — NO template interpolations in style blocks (styled-jsx
   dynamic styles deadlock Turbopack; see project memory). */
const css = `
    .rtape-wrap {
        position: relative;
        overflow: hidden;
        background-color: #F5F0EB;
        background-image:
            linear-gradient(rgba(122,28,43,0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(122,28,43,0.07) 1px, transparent 1px);
        background-size: 44px 44px;
        padding: 72px 0 76px;
    }
    .rtape-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 16px;
        flex-wrap: wrap;
        max-width: 1360px;
        margin: 0 auto 30px;
        padding: 0 48px;
        position: relative;
        z-index: 2;
    }
    .rtape-eyeb {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: #BE185D;
        margin: 0 0 6px;
    }
    .rtape-h2 {
        font-weight: 700;
        font-size: clamp(26px, 3vw, 36px);
        margin: 0;
        color: #7A1C2B;
        text-transform: uppercase;
        letter-spacing: -0.01em;
        line-height: 1.1;
    }
    .rtape-more {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 11px 24px;
        font-size: 13px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #fff;
        background: #BE185D;
        border: 2px solid #7A1C2B;
        box-shadow: 4px 4px 0 #7A1C2B;
        text-decoration: none;
        transition: transform 0.15s ease, background 0.2s ease;
    }
    .rtape-more:hover { transform: translateY(-2px); background: #9D174D; }
    .rtape-more:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }

    .rtape-row {
        position: relative;
        overflow: hidden;
        padding: 8px 0 14px;
    }
    /* Edge fades into the cream stage */
    .rtape-row::before,
    .rtape-row::after {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        width: 90px;
        z-index: 3;
        pointer-events: none;
    }
    .rtape-row::before { left: 0; background: linear-gradient(to right, #F5F0EB, transparent); }
    .rtape-row::after { right: 0; background: linear-gradient(to left, #F5F0EB, transparent); }

    @keyframes rtape-slide {
        to { transform: translateX(-50%); }
    }
    .rtape-tape {
        display: flex;
        gap: 22px;
        width: max-content;
        padding: 0 48px;
        animation: rtape-slide 42s linear infinite;
    }
    .rtape-row:hover .rtape-tape { animation-play-state: paused; }

    .rtape-card {
        width: 300px;
        flex: none;
        display: block;
        background: #fff;
        border: 2px solid #7A1C2B;
        box-shadow: 5px 5px 0 #7A1C2B;
        padding: 20px;
        text-decoration: none;
        cursor: pointer;
        transition: transform 0.15s ease;
    }
    .rtape-card:hover { transform: translateY(-4px); }
    .rtape-card:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
    .rtape-chip {
        display: inline-block;
        padding: 5px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.5);
        box-shadow: 3px 3px 8px rgba(190,24,93,0.10), -2px -2px 5px rgba(255,255,255,0.8), inset 2px 2px 3px rgba(255,255,255,0.7);
        font-size: 10.5px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #7A1C2B;
        margin-bottom: 12px;
    }
    .rtape-title {
        font-weight: 700;
        font-size: 18px;
        line-height: 1.3;
        color: #2b1a1e;
        margin: 0 0 8px;
    }
    .rtape-desc {
        font-size: 12.5px;
        color: #7a6d70;
        line-height: 1.5;
        margin: 0 0 14px;
    }
    .rtape-bar {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .rtape-track {
        flex: 1;
        height: 4px;
        background: rgba(122,28,43,0.12);
        border-radius: 2px;
        position: relative;
        overflow: hidden;
    }
    .rtape-fill {
        position: absolute;
        top: 0; left: 0; bottom: 0;
        background: #BE185D;
        border-radius: 2px;
    }
    .rtape-read {
        font-size: 11px;
        font-weight: 800;
        color: #9b8291;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        white-space: nowrap;
    }
    @media (prefers-reduced-motion: reduce) {
        .rtape-tape { animation: none; }
    }
    @media (max-width: 768px) {
        .rtape-wrap { padding: 52px 0 56px; }
        .rtape-head { padding: 0 24px; margin-bottom: 22px; }
        .rtape-tape { padding: 0 24px; }
        .rtape-card { width: 260px; }
    }
`;

export default function HomepageBlogSection() {
    const hasPosts = HOMEPAGE_FEATURED_POSTS.length > 0;
    const items = hasPosts ? HOMEPAGE_FEATURED_POSTS : RESOURCE_GUIDES;

    /* The -50% marquee needs two identical halves, and each half must be
       wider than the viewport or the loop shows a gap. With few posts,
       repeat the set inside each half. */
    const repeatsPerHalf = Math.max(1, Math.ceil(6 / items.length));
    const half = Array.from({ length: repeatsPerHalf }, () => items).flat();
    const tape = [...half, ...half];

    return (
        <section className="rtape-wrap" aria-label="Career guides from the blog">
            <style>{css}</style>

            <div className="rtape-head">
                <div>
                    <p className="rtape-eyeb">Career guides</p>
                    <h2 className="rtape-h2 font-heading">From the blog</h2>
                </div>
                <Link href={hasPosts ? '/blog' : '/resources'} className="rtape-more">
                    {hasPosts ? 'More posts →' : 'All resources →'}
                </Link>
            </div>

            <div className="rtape-row">
                <div className="rtape-tape">
                    {tape.map((post, i) => (
                        <Link key={`${post.href}-${i}`} href={post.href} className="rtape-card"
                            /* duplicate copies are decorative for the loop —
                               hide them from the accessibility tree */
                            aria-hidden={i >= items.length ? true : undefined}
                            tabIndex={i >= items.length ? -1 : undefined}
                        >
                            <span className="rtape-chip" style={{ background: CHIP_FILLS[i % CHIP_FILLS.length] }}>
                                {post.category}
                            </span>
                            <h3 className="rtape-title font-heading">{post.title}</h3>
                            <p className="rtape-desc">{post.description}</p>
                            <span className="rtape-bar" aria-hidden="true">
                                <span className="rtape-track"><span className="rtape-fill" style={{ width: BAR_WIDTHS[i % BAR_WIDTHS.length] }} /></span>
                                <span className="rtape-read">Read →</span>
                            </span>
                        </Link>
                    ))}
                </div>
            </div>
        </section>
    );
}

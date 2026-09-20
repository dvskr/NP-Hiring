import { brand } from '@/config/brand';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { ArrowRight, BookOpen, Newspaper, PenLine, DollarSign, Search } from 'lucide-react';
import {
    getPublishedPosts,
    getPostCount,
    getAllPublishedSlugs,
    BLOG_CATEGORIES,
} from '@/lib/blog';
import { LICENSE_GUIDE_SERIES_PUBLISHED, LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { LICENSE_GUIDE_STATES, type LicenseGuideState } from '@/lib/blog-license-guides';
import { AUTHORITY_TITLE, isLicenseGuideLive } from '@/lib/pseo/practice-environment';
import type { PracticeAuthority } from '@/lib/state-practice-authority';
import { formatCount, joinWithAnd } from '@/lib/display-text';
import VideoJsonLd from '@/components/VideoJsonLd';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';

const NP = brand.niche.short;

// P0 OG sweep: edge-generated card via /api/og — the previous Supabase
// page-screenshot 400'd on every share (pattern: app/for-employers/page.tsx).
const BLOG_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${NP} Career Guides`)}&type=page`;

// ISR: blog index changes when posts publish/unpublish; 1-hour revalidate is
// well within the editorial cadence. Previously force-dynamic meant every
// Googlebot hit hit Supabase live — wasted DB and CPU on the highest-traffic
// editorial surface.
export const revalidate = 3600;

const POSTS_PER_PAGE = 12;

/**
 * Rows scanned to learn which categories have at least one live post, so the
 * filter row hides donor-era categories with nothing behind them. One merged
 * listing read (lib/blog.ts caps the merge at 1000 rows) instead of one
 * count query per category.
 */
const CATEGORY_SCAN_LIMIT = 1000;

/** Group order for the licensure section: the AANP tiers, most permissive first. */
const AUTHORITY_ORDER: readonly PracticeAuthority[] = ['full', 'reduced', 'restricted'];

const LICENSURE_HEADING_ID = 'blog-licensure-guides';

/**
 * Meta description (thin-spec-4 section 4): the live post count and the live
 * guide count, each clause omitted at zero. Counts come from
 * getAllPublishedSlugs(), the same list the sitemap advertises.
 */
function buildBlogDescription(authoredPosts: number, licenseGuides: number): string {
    const subjects = [
        authoredPosts > 0 ? formatCount(authoredPosts, `${NP} career guide`) : null,
        licenseGuides > 0 ? formatCount(licenseGuides, 'state licensure guide') : null,
    ].filter((s): s is string => s !== null);
    const lead = subjects.length > 0 ? joinWithAnd(subjects) : `${NP} career guides`;
    return `${lead} covering certification, interviews, salary negotiation and practice rules by state.`;
}

export async function generateMetadata(): Promise<Metadata> {
    const slugs = await getAllPublishedSlugs();
    const licenseGuides = slugs.filter((row) => LICENSE_GUIDE_SLUG_REGEX.test(row.slug)).length;
    const description = buildBlogDescription(slugs.length - licenseGuides, licenseGuides);
    return {
        title: `${NP} Career Guides: Licensure, Salary and Job Search`,
        description,
        openGraph: {
            images: [{
                url: BLOG_OG_IMAGE,
                width: 1200,
                height: 630,
                alt: `${NP} career guides on salary negotiation, state licensure and job search`,
            }],
        },
        twitter: { card: 'summary_large_image', images: [BLOG_OG_IMAGE] },
        alternates: {
            canonical: `${brand.baseUrl}/blog`,
        },
    };
}

/* ─── Clay Design Tokens ─── */
const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

/* ─── Category colors ─── */
const CATEGORY_COLORS: Record<string, { color: string; bg: string }> = {
    // Keyed by BlogCategory id (was 'job_seeker_tips', a key that exists in
    // no category taxonomy — Job Seeker Tips posts fell through to the
    // gray fallback style).
    job_seeker_attraction: { color: '#BE185D', bg: '#FDF2F8' },
    career_opportunities: { color: '#6366F1', bg: '#EEF2FF' },
    salary_negotiation: { color: '#F59E0B', bg: '#FFFBEB' },
    career_myths: { color: '#A855F7', bg: '#FAF5FF' },
    state_spotlight: { color: '#3B82F6', bg: '#EFF6FF' },
    employer_facing: { color: '#EF4444', bg: '#FEF2F2' },
    community_lifestyle: { color: '#EC4899', bg: '#FDF2F8' },
    industry_awareness: { color: '#8B5CF6', bg: '#F5F3FF' },
    product_lead_gen: { color: '#9D174D', bg: '#FDF2F8' }, // pink-800 for AA contrast on the pink-50 tint (DB2777 was 4.2:1)
    success_stories: { color: '#10B981', bg: '#ECFDF5' },
    mental_health_trends: { color: '#6366F1', bg: '#EEF2FF' },
    policy_industry: { color: '#64748B', bg: '#F1F5F9' },
    tech_tools: { color: '#0EA5E9', bg: '#F0F9FF' },
};

/**
 * License guides whose slug is actually published (C.0: every link to a
 * guide is gated by isLicenseGuideLive, one cached slug read per request).
 */
async function loadLiveLicenseGuides(): Promise<LicenseGuideState[]> {
    if (!LICENSE_GUIDE_SERIES_PUBLISHED) return [];
    const flags = await Promise.all(LICENSE_GUIDE_STATES.map((s) => isLicenseGuideLive(s.stateSlug)));
    return LICENSE_GUIDE_STATES.filter((_, i) => flags[i]);
}

/**
 * State licensure guides grouped by AANP tier, links gated on publication.
 * Clay, like the rest of this page (owner decision 2026-09-20: new blocks on
 * a clay page are clay): one clay card per tier, a pastel count chip, and
 * state pills styled like the category filter pills above.
 */
function LicensureGuidesBand({ guides }: { guides: readonly LicenseGuideState[] }) {
    if (guides.length === 0) return null;
    return (
        <section
            aria-labelledby={LICENSURE_HEADING_ID}
            style={{ background: 'linear-gradient(180deg, #FFF8F0 0%, #FFF3E8 50%, #FFF8F0 100%)', padding: '64px 20px' }}
        >
            <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#E86C2C', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                    State licensure guides
                </p>
                <h2 id={LICENSURE_HEADING_ID} className="font-lora" style={{ fontSize: 'clamp(24px, 3.2vw, 34px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', margin: '0 0 8px' }}>
                    {NP} license guides by state
                </h2>
                <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '600px', margin: '0 auto 40px', lineHeight: 1.6 }}>
                    One guide per jurisdiction: practice authority, Nurse Licensure Compact status, the board you apply through and the current {NP} job market there. Grouped by the AANP practice-authority classification.
                </p>
                {AUTHORITY_ORDER.map((tier) => {
                    const states = guides.filter((s) => s.authority === tier);
                    if (states.length === 0) return null;
                    return (
                        <div key={tier} style={{ ...clayCard, padding: '24px 24px 20px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0 }}>{AUTHORITY_TITLE[tier]}</h3>
                                <span style={{ padding: '3px 10px', borderRadius: '999px', background: '#FDF2F8', color: '#BE185D', fontSize: '12px', fontWeight: 700 }}>
                                    {states.length}
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {states.map((s) => (
                                    <Link
                                        key={s.slug}
                                        href={`/blog/${s.slug}`}
                                        className="blog-state-pill"
                                        style={{
                                            padding: '8px 16px', borderRadius: '40px', fontSize: '13px', fontWeight: 600,
                                            textDecoration: 'none', background: '#FDFBF7', color: '#5A4A42',
                                            border: '1px solid #EAE6DF',
                                            boxShadow: '3px 3px 8px rgba(0,0,0,0.03), -2px -2px 5px rgba(255,255,255,0.8)',
                                        }}
                                    >
                                        {s.name}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export default async function BlogIndexPage({
    searchParams,
}: {
    searchParams: Promise<{ category?: string; page?: string }>;
}) {
    const { category, page } = await searchParams;
    const parsed = parseInt(page || '1', 10);
    const currentPage = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const categoryFilter = category || undefined;

    const [posts, totalCount, categoryScan, liveGuides] = await Promise.all([
        getPublishedPosts(currentPage, POSTS_PER_PAGE, categoryFilter),
        getPostCount(categoryFilter),
        getPublishedPosts(1, CATEGORY_SCAN_LIMIT),
        loadLiveLicenseGuides(),
    ]);

    const totalPages = Math.ceil(totalCount / POSTS_PER_PAGE);

    // Donor-era categories with nothing behind them imply content that does
    // not exist, so only categories with at least one live post get a pill.
    const categoriesWithPosts = new Set(categoryScan.map((post) => post.category));
    const visibleCategories = BLOG_CATEGORIES.filter((c) => categoriesWithPosts.has(c.id));

    const categoryLabels: Record<string, string> = {};
    BLOG_CATEGORIES.forEach((c) => {
        categoryLabels[c.id] = c.label;
    });

    // Format date helper
    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    // Build pagination URL
    const buildUrl = (p: number, cat?: string) => {
        const params = new URLSearchParams();
        if (cat && cat !== 'all') params.set('category', cat);
        if (p > 1) params.set('page', p.toString());
        const qs = params.toString();
        return `/blog${qs ? `?${qs}` : ''}`;
    };

    const getCatStyle = (catId: string) => CATEGORY_COLORS[catId] || { color: '#64748B', bg: '#F1F5F9' };

    return (
        <>
            <VideoJsonLd pathname="/blog" />
            <BreadcrumbSchema items={[
                { name: 'Home', url: brand.baseUrl },
                { name: 'Blog', url: `${brand.baseUrl}/blog` },
            ]} />
            {/* SEO Fix #16: wrap the post list in a Blog @graph alongside
                ItemList. Previously only ItemList was emitted, so Google had
                no signal that this is a blog index — losing eligibility for
                blog-style rich result treatment. The Blog node carries the
                publisher / mainEntity link to Organization defined in
                app/layout.tsx, and ItemList stays as the listing payload.
                Both list exactly the posts rendered on this page. */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify({
                    '@context': 'https://schema.org',
                    '@graph': [
                        {
                            '@type': 'Blog',
                            '@id': `${brand.baseUrl}/blog#blog`,
                            name: `${NP} Career Blog`,
                            description: `Career guides, salary insights, and licensure guides for ${brand.niche.descriptor}s.`,
                            url: `${brand.baseUrl}/blog`,
                            inLanguage: 'en-US',
                            publisher: { '@id': `${brand.baseUrl}/#organization` },
                            blogPost: posts.map((post) => ({
                                '@type': 'BlogPosting',
                                headline: post.title,
                                url: `${brand.baseUrl}/blog/${post.slug}`,
                                datePublished: post.publish_date || post.created_at,
                            })),
                        },
                        {
                            '@type': 'ItemList',
                            '@id': `${brand.baseUrl}/blog#postlist`,
                            name: `${NP} Career Blog`,
                            numberOfItems: totalCount,
                            itemListElement: posts.map((post, i) => ({
                                '@type': 'ListItem',
                                position: i + 1,
                                name: post.title,
                                url: `${brand.baseUrl}/blog/${post.slug}`,
                            })),
                        },
                    ],
                }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }}
            />

            {/* ═══ HERO — Warm Cream ═══ */}
            <div style={{ background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 40%, #FFF5EE 100%)' }}>
                <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '80px 20px 48px', textAlign: 'center' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>
                        Career Insights
                    </p>
                    <h1 className="font-lora" style={{
                        fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.15,
                        color: '#1A2E35', marginBottom: '16px',
                    }}>
                        {NP} Career Guides
                    </h1>
                    <p style={{ fontSize: '17px', color: '#5A4A42', maxWidth: '600px', margin: '0 auto 32px', lineHeight: 1.6 }}>
                        Data-driven guides, salary negotiation tips, state licensure rules and career strategies
                        for {brand.niche.descriptor}s.
                    </p>

                    {/* Stat Pills */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px', marginBottom: '0' }}>
                        {[
                            { value: `${totalCount}`, label: 'Articles', bg: '#D4F5E9', color: '#065F46', icon: <Newspaper size={16} /> },
                            { value: `${visibleCategories.length}`, label: 'Categories', bg: '#E0E7FF', color: '#3730A3', icon: <BookOpen size={16} /> },
                            { value: 'Free', label: 'Always', bg: '#FFE0D3', color: '#7C2D12', icon: <PenLine size={16} /> },
                        ].map(s => (
                            <div key={s.label} className="blog-stat-pill" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '8px',
                                padding: '10px 20px 10px 16px', borderRadius: '40px',
                                background: s.bg,
                                boxShadow: '3px 3px 8px rgba(0,0,0,0.04), inset 1px 1px 2px rgba(255,255,255,0.5)',
                            }}>
                                <span style={{ color: s.color, display: 'flex' }}>{s.icon}</span>
                                <span style={{ fontSize: '18px', fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</span>
                                <span style={{ fontSize: '12px', color: s.color, opacity: 0.7, fontWeight: 500 }}>{s.label}</span>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {/* ═══ FILTER PILLS ═══ */}
            <div style={{ background: '#FDFBF7', padding: '32px 20px 0' }}>
                <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <div className="blog-filter-wrap" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', marginBottom: '36px' }}>
                        <Link
                            href="/blog"
                            className="blog-filter-pill"
                            style={{
                                padding: '8px 20px', borderRadius: '40px', fontSize: '13px', fontWeight: 600,
                                textDecoration: 'none', transition: 'all 0.2s ease',
                                ...(!categoryFilter
                                    ? { background: '#BE185D', color: '#fff', boxShadow: '0 4px 12px rgba(190,24,93,0.25)' }
                                    : {
                                        background: '#FFFFFF', color: '#5A4A42',
                                        border: '1px solid #EAE6DF',
                                        boxShadow: '3px 3px 8px rgba(0,0,0,0.03), -2px -2px 5px rgba(255,255,255,0.8)',
                                    }),
                            }}
                        >
                            All
                        </Link>
                        {visibleCategories.map((cat) => {
                            const isActive = categoryFilter === cat.id;
                            const cs = getCatStyle(cat.id);
                            return (
                                <Link
                                    key={cat.id}
                                    href={`/blog?category=${cat.id}`}
                                    className="blog-filter-pill"
                                    style={{
                                        padding: '8px 20px', borderRadius: '40px', fontSize: '13px', fontWeight: 600,
                                        textDecoration: 'none', transition: 'all 0.2s ease',
                                        ...(isActive
                                            ? { background: cs.color, color: '#fff', boxShadow: `0 4px 12px ${cs.color}40` }
                                            : {
                                                background: '#FFFFFF', color: '#5A4A42',
                                                border: '1px solid #EAE6DF',
                                                boxShadow: '3px 3px 8px rgba(0,0,0,0.03), -2px -2px 5px rgba(255,255,255,0.8)',
                                            }),
                                    }}
                                >
                                    {cat.label}
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ═══ BLOG GRID ═══ */}
            <div style={{ background: '#FDFBF7', padding: '0 20px 80px' }}>
                <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <div className="blog-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                        {posts.length > 0 ? (
                            posts.map((post) => {
                                const cs = getCatStyle(post.category);
                                return (
                                    <Link
                                        key={post.slug}
                                        href={`/blog/${post.slug}`}
                                        className="blog-card"
                                        style={{ ...clayCard, overflow: 'hidden', textDecoration: 'none', display: 'flex', flexDirection: 'column' }}
                                    >
                                        {/* Image */}
                                        <div style={{ position: 'relative', height: '180px', overflow: 'hidden' }}>
                                            {post.image_url ? (
                                                <Image
                                                    src={post.image_url}
                                                    alt={post.title}
                                                    fill
                                                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 360px"
                                                    quality={85}
                                                    className="object-cover"
                                                    style={{ transition: 'transform 0.4s ease' }}
                                                />
                                            ) : (
                                                <div style={{
                                                    position: 'absolute', inset: 0,
                                                    background: `linear-gradient(135deg, ${cs.bg}, ${cs.color}20)`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                }}>
                                                    <PenLine size={48} style={{ color: cs.color, opacity: 0.3 }} />
                                                </div>
                                            )}
                                            {/* Category badge */}
                                            <div style={{
                                                position: 'absolute', top: '14px', left: '14px',
                                                padding: '5px 12px', borderRadius: '20px',
                                                fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em',
                                                color: cs.color, background: 'rgba(255,255,255,0.92)',
                                                backdropFilter: 'blur(8px)',
                                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                            }}>
                                                {categoryLabels[post.category] || post.category}
                                            </div>
                                        </div>

                                        {/* Content */}
                                        <div style={{ padding: '20px 22px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                            {/* Date */}
                                            <p style={{ fontSize: '12px', color: '#7A6A62', fontWeight: 500, margin: '0 0 8px' }}>
                                                {formatDate(post.publish_date || post.created_at)}
                                            </p>
                                            {/* Title */}
                                            <h2 className="blog-card-title" style={{
                                                fontSize: '16px', fontWeight: 700, lineHeight: 1.4,
                                                color: '#1A2E35', margin: '0 0 10px',
                                                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                                transition: 'color 0.2s ease',
                                            }}>
                                                {post.title}
                                            </h2>
                                            {/* Excerpt */}
                                            <p style={{
                                                fontSize: '13px', color: '#5A4A42', lineHeight: 1.55,
                                                margin: '0 0 16px', flex: 1,
                                                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                            }}>
                                                {post.meta_description || ''}
                                            </p>
                                            {/* CTA */}
                                            <span className="blog-card-cta" style={{
                                                fontSize: '13px', fontWeight: 600, color: '#BE185D',
                                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                marginTop: 'auto',
                                            }}>
                                                Read article <ArrowRight size={14} className="blog-card-arrow" />
                                            </span>
                                        </div>
                                    </Link>
                                );
                            })
                        ) : (
                            <div style={{
                                gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px',
                                ...clayCard,
                            }}>
                                <PenLine size={48} style={{ color: '#7A6A62', margin: '0 auto 16px', display: 'block' }} />
                                <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#1A2E35', margin: '0 0 8px' }}>
                                    No posts found
                                </h3>
                                <p style={{ fontSize: '14px', color: '#5A4A42' }}>
                                    {/* A page number past the end must not claim nothing
                                        is published while posts exist on earlier pages. */}
                                    {totalCount > 0 ? (
                                        <>
                                            This page is past the end of the list.{' '}
                                            <Link href={buildUrl(1, categoryFilter)} style={{ color: '#BE185D', fontWeight: 600 }}>
                                                Go to the first page
                                            </Link>
                                        </>
                                    ) : categoryFilter
                                        ? 'There are no posts in this category yet.'
                                        : 'No articles are listed yet.'}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* ═══ PAGINATION ═══ */}
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '48px' }}>
                            {currentPage > 1 && (
                                <Link
                                    href={buildUrl(currentPage - 1, categoryFilter)}
                                    className="blog-page-btn"
                                    style={{
                                        padding: '10px 20px', borderRadius: '14px', fontSize: '13px', fontWeight: 600,
                                        textDecoration: 'none', color: '#1A2E35',
                                        ...clayCard,
                                    }}
                                >
                                    ← Previous
                                </Link>
                            )}

                            {Array.from({ length: totalPages }, (_, i) => i + 1)
                                .filter(
                                    (p) =>
                                        p === 1 ||
                                        p === totalPages ||
                                        Math.abs(p - currentPage) <= 2
                                )
                                .reduce<(number | string)[]>((acc, p, idx, arr) => {
                                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                                        acc.push('...');
                                    }
                                    acc.push(p);
                                    return acc;
                                }, [])
                                .map((p, idx) =>
                                    typeof p === 'string' ? (
                                        <span key={`ellipsis-${idx}`} style={{ padding: '0 4px', color: '#7A6A62', fontSize: '14px' }}>
                                            …
                                        </span>
                                    ) : (
                                        <Link
                                            key={p}
                                            href={buildUrl(p, categoryFilter)}
                                            className="blog-page-btn"
                                            style={{
                                                width: '42px', height: '42px', borderRadius: '14px',
                                                fontSize: '14px', fontWeight: 600,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                textDecoration: 'none', transition: 'all 0.2s ease',
                                                ...(p === currentPage
                                                    ? {
                                                        background: '#BE185D', color: '#fff',
                                                        boxShadow: '0 4px 14px rgba(190,24,93,0.3)',
                                                    }
                                                    : { ...clayCard, color: '#1A2E35' }),
                                            }}
                                        >
                                            {p}
                                        </Link>
                                    )
                                )}

                            {currentPage < totalPages && (
                                <Link
                                    href={buildUrl(currentPage + 1, categoryFilter)}
                                    className="blog-page-btn"
                                    style={{
                                        padding: '10px 20px', borderRadius: '14px', fontSize: '13px', fontWeight: 600,
                                        textDecoration: 'none', color: '#1A2E35',
                                        ...clayCard,
                                    }}
                                >
                                    Next →
                                </Link>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ STATE LICENSURE GUIDES (clay band; links gated on publication) ═══ */}
            <LicensureGuidesBand guides={liveGuides} />

            {/* ═══ BROWSE MORE — Clay CTA Section ═══ */}
            <section style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%)', padding: '64px 20px' }}>
                <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>
                        Explore More
                    </p>
                    <h2 className="font-lora" style={{ fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 700, color: '#1A2E35', marginBottom: '32px' }}>
                        Browse More Resources
                    </h2>
                    <div className="blog-cta-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                        {[
                            { href: '/salary-guide', IconComp: DollarSign, title: 'Salary Guide', desc: 'Median posted pay by state and specialty' },
                            // P0 #5: no inventory count or cadence claim here; counts live on the listing pages.
                            { href: '/jobs', IconComp: Search, title: 'Browse Jobs', desc: `Open ${NP} positions by state and setting` },
                            { href: '/resources', IconComp: BookOpen, title: 'Resources', desc: 'Licensure guides and tools' },
                        ].map(item => {
                            const IconC = item.IconComp;
                            return (
                                <Link key={item.href} href={item.href} className="blog-cta-card" style={{
                                    ...clayCard, padding: '28px 22px', textDecoration: 'none',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center',
                                }}>
                                    <div style={{
                                        width: '64px', height: '64px', borderRadius: '18px',
                                        background: '#D4E2D4', color: '#1E3A5F',
                                        boxShadow: 'inset 2px 2px 4px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.04), 3px 3px 8px rgba(0,0,0,0.05)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                    }}>
                                        <IconC size={28} />
                                    </div>
                                    <div>
                                        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#1A2E35', margin: '0 0 4px' }}>{item.title}</h3>
                                        <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>{item.desc}</p>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* ─── Styles ─── */}
            <style>{`
                .blog-stat-pill {
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }
                .blog-stat-pill:hover {
                    transform: translateY(-2px) scale(1.02);
                    box-shadow: 6px 6px 20px rgba(0,0,0,0.1), -3px -3px 10px rgba(255,255,255,0.9) !important;
                }
                .blog-filter-pill {
                    transition: transform 0.2s ease, box-shadow 0.2s ease !important;
                }
                .blog-filter-pill:hover {
                    transform: translateY(-2px);
                }
                .blog-card {
                    transition: transform 0.3s ease, box-shadow 0.3s ease;
                }
                .blog-card:hover {
                    transform: translateY(-6px);
                    box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important;
                }
                .blog-card:hover img {
                    transform: scale(1.05);
                }
                .blog-card:hover .blog-card-title {
                    color: #BE185D !important;
                }
                .blog-card:hover .blog-card-arrow {
                    transform: translateX(3px);
                    transition: transform 0.2s ease;
                }
                .blog-state-pill {
                    transition: transform 0.2s ease, box-shadow 0.2s ease, color 0.2s ease;
                }
                .blog-state-pill:hover {
                    transform: translateY(-2px);
                    color: #BE185D !important;
                    box-shadow: 6px 6px 16px rgba(0,0,0,0.08), -3px -3px 10px rgba(255,255,255,0.9) !important;
                }
                .blog-state-pill:focus-visible {
                    outline: 3px solid #BE185D;
                    outline-offset: 3px;
                }
                .blog-page-btn {
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                }
                .blog-page-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 6px 6px 16px rgba(0,0,0,0.08), -3px -3px 10px rgba(255,255,255,0.9) !important;
                }
                .blog-cta-card {
                    transition: transform 0.3s ease, box-shadow 0.3s ease;
                }
                .blog-cta-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important;
                }
                @media (max-width: 768px) {
                    .blog-grid { grid-template-columns: 1fr !important; }
                    .blog-cta-grid { grid-template-columns: 1fr !important; }
                }
                @media (min-width: 769px) and (max-width: 1024px) {
                    .blog-grid { grid-template-columns: repeat(2, 1fr) !important; }
                    .blog-cta-grid { grid-template-columns: repeat(2, 1fr) !important; }
                }
            `}</style>
        </>
    );
}

import { brand } from '@/config/brand';
import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight, BarChart3, Briefcase, Building2, Calculator, ClipboardCheck, Compass, DollarSign,
  FileDown, Globe, GraduationCap, MapPin, Rocket, Scale, Search, ShieldCheck, Star,
  TrendingUp, Users, type LucideIcon,
} from 'lucide-react';
// P2 tools band — paths come from the registry that renders /tools, so this
// page can never advertise a tool route the app would 404 on.
import { TOOLS, type ToolIconKey } from '@/app/tools/tools-registry';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
import VideoJsonLd from '@/components/VideoJsonLd';
import ResourceDownloadGate from '@/components/ResourceDownloadGate';
import { SALARY_GUIDE_EDITION_YEAR } from '@/app/api/salary-guide/pdf-availability';
import LicensureChecker from '@/components/LicensureChecker';
import StateImage from '@/components/StateImage';
import { prisma } from '@/lib/prisma';
import { getGatedStateBenchmarks } from '@/lib/salary-analytics';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';

export const revalidate = 86400;

// Audit F12: fallback derives from config/brand.ts (single source of truth)
// instead of the donor board's PMHNP-branded asset, which 404s on this board.
const SALARY_GUIDE_URL = process.env.SALARY_GUIDE_URL || brand.assets.salaryGuidePdf;

// P0 OG sweep: metadata card renders via the board's own /api/og edge route.
const RESOURCES_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`${brand.niche.short} Career Resources`)}&type=page`;

// Audit F12: metadata describes the ACTUAL inventory — 3 in-depth guides
// (FPA, private practice, 1099 vs W2), the interactive salary tool, and the
// licensure checker. The previous article-count and state-guide-series
// claims described content this board does not have (see
// config/niche/content-map.ts: no authored posts, license-guide series
// unwritten) — a claim-vs-reality mismatch that answer engines penalize.
export const metadata: Metadata = {
  title: `${brand.niche.short} Career Resources: Salary Tool & Licensure Checker`,
  description: `Free ${brand.niche.short} career resources: an interactive salary calculator, a state licensure checker, and guides to Full Practice Authority, private practice startup, and 1099 vs W2 pay.`,
  keywords: [
    `${brand.niche.short.toLowerCase()} resources`, `${brand.niche.descriptor} career`, `${brand.niche.short.toLowerCase()} salary guide`,
    `${brand.niche.short.toLowerCase()} licensure checker`, `${brand.niche.short.toLowerCase()} full practice authority`,
    `${brand.niche.short.toLowerCase()} private practice`, `${brand.niche.short.toLowerCase()} 1099 vs w2`,
    `${brand.niche.short.toLowerCase()} job search`,
  ],
  openGraph: {
    title: `${brand.niche.short} Career Resources: Salary Tool & Licensure Checker`,
    description: `Free career resources for ${brand.niche.descriptor}s: salary calculator, state licensure checker, and in-depth practice guides.`,
    // P0 OG sweep: edge-generated card via /api/og — the previous Supabase
    // page-screenshot 400'd on every share (pattern: app/for-employers/page.tsx).
    images: [{ url: RESOURCES_OG_IMAGE, width: 1200, height: 630, alt: `${brand.niche.short} career resources and guides` }],
  },
  twitter: { card: 'summary_large_image', images: [RESOURCES_OG_IMAGE] },
  alternates: { canonical: `${brand.baseUrl}/resources` },
};

/* ─── Sticker card system (owner direction 2026-09-10; same anatomy as the
   homepage free-tools band and blog tape): white face, 2px berry border,
   hard 5px offset shadow, clay chip, Lora title, pinned accent-bar footer.
   Chip fills and bar widths are the homepage constants. Static CSS lives in
   the page <style> block below (no interpolations). ─── */
const STICKER_CHIP_FILLS = ['#D5F5F1', '#FBCFE8', '#FDE3C8', '#B9EBD6'];
const STICKER_BAR_WIDTHS = ['38%', '64%', '22%', '50%'];

/* Same icon per registry key as the /tools hub (app/tools/page.tsx ICONS). */
const TOOL_ICONS: Record<ToolIconKey, LucideIcon> = {
  calculator: Calculator,
  scale: Scale,
  clipboard: ClipboardCheck,
  chart: BarChart3,
  compass: Compass,
  building: Building2,
  briefcase: Briefcase,
};

function StickerFooter({ index, action }: { index: number; action: string }) {
  return (
    <span className="stk-bar" aria-hidden="true">
      <span className="stk-track">
        <span className="stk-fill" style={{ width: STICKER_BAR_WIDTHS[index % STICKER_BAR_WIDTHS.length] }} />
      </span>
      <span className="stk-action">{action} →</span>
    </span>
  );
}

/* ─── Category config ─── */
const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  career_opportunities: { label: 'Career', color: '#6366F1', bg: '#EEF2FF', icon: TrendingUp },
  salary_negotiation: { label: 'Salary', color: '#BE185D', bg: '#FDF2F8', icon: DollarSign },
  job_seeker_attraction: { label: 'Job Search', color: '#3B82F6', bg: '#EFF6FF', icon: Search },
  career_myths: { label: 'Education', color: '#A855F7', bg: '#FAF5FF', icon: GraduationCap },
  community_lifestyle: { label: 'Lifestyle', color: '#F59E0B', bg: '#FFFBEB', icon: Users },
  employer_facing: { label: 'Employers', color: '#EF4444', bg: '#FEF2F2', icon: Briefcase },
  product_lead_gen: { label: 'Product', color: '#BE185D', bg: '#FDF2F8', icon: Rocket },
  industry_awareness: { label: 'Industry', color: '#8B5CF6', bg: '#F5F3FF', icon: Globe },
};

/* ─── P4 education wedge ───
   The two decision guides that sit UPSTREAM of the job search: how to
   evaluate an NP program, and how clinical placement / precepting works.
   Neither names a school, a program, an hour count, or a fee — the repo
   holds no program dataset, and inventing one is the highest-harm
   fabrication available on this board (people pick an education from it).

   Rendered from the blog rows this page ALREADY fetches, never from a
   hardcoded /blog/<slug> href: .mdx posts only resolve once
   scripts/sync-blog-to-db.ts has published them (lib/blog.ts
   getPostBySlug falls back to code for the license series ONLY), so a
   literal href here would be a live internal 404 in the window between
   deploying this file and running the sync against prod — the hazard
   config/niche/content-map.ts documents for HOMEPAGE_FEATURED_POSTS.
   Missing post → the band simply does not render. */
const EDUCATION_WEDGE_SLUGS = ['how-to-evaluate-np-programs', 'np-preceptor-guide'] as const;

/* ─── Featured guides data ─── */
const featuredGuides = [
  {
    href: '/salary-guide',
    title: 'Salary Calculator & Guide',
    desc: 'Interactive salary tool with state, experience, and setting selectors. Complete 2026 data.',
    icon: Calculator,
    badge: 'Interactive Tool',
    badgeColor: '#BE185D',
  },
  {
    href: '/resources/fpa-guide',
    title: 'Full Practice Authority Guide',
    desc: 'All 50 states classified. See which states allow independent practice and how FPA affects pay.',
    icon: ShieldCheck,
    badge: '50 States',
    badgeColor: '#6366F1',
  },
  {
    href: '/resources/private-practice-guide',
    title: 'Private Practice Startup',
    desc: 'LLC formation, credentialing, EHR, malpractice insurance, and income projections.',
    icon: Building2,
    badge: 'Step-by-Step',
    badgeColor: '#F59E0B',
  },
];

export default async function ResourcesPage() {
  const [blogPosts, benchmarkRows] = await Promise.all([
    prisma.blogPost.findMany({
      where: { status: 'published' },
      select: { slug: true, title: true, category: true, metaDescription: true, imageUrl: true, publishDate: true },
      orderBy: { publishDate: 'desc' },
    }),
    // P9 #2c/#2d: gated per-state medians for the embedded licensure
    // checker — replaces the old `_avg` mean-of-min/max over every
    // published row (psychiatrist/PA pay and estimated rows included).
    getGatedStateBenchmarks(),
  ]);

  const stateSalaries = benchmarkRows
    .map(s => ({
      state: s.scope,
      medianSalary: s.median,
      p25: s.p25,
      p75: s.p75,
      jobCount: s.postings,
    }))
    .sort((a, b) => b.medianSalary - a.medianSalary);

  // Split state_spotlight from other articles
  const stateGuides = blogPosts.filter(p => p.category === 'state_spotlight');
  const articles = blogPosts.filter(p => p.category !== 'state_spotlight');

  // P4 education wedge — resolved against the published rows above, so a
  // card can only appear for a post the sync script has actually shipped.
  const educationWedge = EDUCATION_WEDGE_SLUGS
    .map(slug => blogPosts.find(p => p.slug === slug))
    .filter((p): p is (typeof blogPosts)[number] => Boolean(p));

  // Group articles by category
  const grouped: Record<string, typeof articles> = {};
  articles.forEach(a => {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  });

  // Extract unique state names from slugs for the grid
  const stateNames = stateGuides.map(s => {
    const match = s.slug.match(LICENSE_GUIDE_SLUG_REGEX);
    if (!match) return null;
    const raw = match[1].replace(/-\d+$/, ''); // remove trailing -2 duplicates
    return {
      name: raw.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      slug: s.slug,
      title: s.title,
    };
  }).filter(Boolean);

  // Deduplicate (some states have -2 copies)
  const uniqueStates = new Map<string, typeof stateNames[0]>();
  stateNames.forEach(s => {
    if (s && !uniqueStates.has(s.name)) uniqueStates.set(s.name, s);
  });
  const sortedStates = Array.from(uniqueStates.values()).sort((a, b) => a!.name.localeCompare(b!.name));

  const currentYear = new Date().getFullYear();

  return (
    <>
      <VideoJsonLd pathname="/resources" />
      <BreadcrumbSchema items={[
        { name: 'Home', url: brand.baseUrl },
        { name: 'Resources', url: `${brand.baseUrl}/resources` },
      ]} />

      {/* CollectionPage Schema. Audit 14 M-4: previously had no `hasPart`,
          so Google couldn't resolve the hub-and-spoke relationship between
          this page and the three core resource guides. numberOfItems also
          referenced blogPosts.length (the post grid below the resource
          tiles), which was semantically wrong — the CollectionPage is the
          guide hub, not a blog index. Now lists the actual featured guide
          URLs and counts them. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${brand.niche.short} Resources & Career Guides ${currentYear}`,
        description: `Free career resources for ${brand.niche.descriptor}s.`,
        url: `${brand.baseUrl}/resources`,
        publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
        hasPart: [
          { '@type': 'Article', name: `${brand.niche.short} Full Practice Authority Guide`, url: `${brand.baseUrl}/resources/fpa-guide` },
          { '@type': 'Article', name: `1099 vs W2 for ${brand.niche.short}s: Compensation Comparison`, url: `${brand.baseUrl}/resources/1099-vs-w2` },
          { '@type': 'Article', name: `How to Start an ${brand.niche.short} Private Practice`, url: `${brand.baseUrl}/resources/private-practice-guide` },
        ],
        numberOfItems: 3,
      }) }} />

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1: HERO (warm cream bg)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="stk-stage stk-stage-grid">
        <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 20px 80px', textAlign: 'center' }}>
          <p className="stk-eyebrow">
            Free Career Resources
          </p>
          <h1 className="stk-h1 font-heading">
            {brand.niche.short} Resources & Guides
          </h1>
          <p className="stk-lede" style={{ margin: '16px auto 32px' }}>
            Everything you need for your {brand.niche.short} career, from licensure requirements to salary negotiation.
          </p>

          {/* Stat stickers: count stickers render only when the content actually
              exists (audit F12: no advertised inventory the page cannot deliver) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '16px', marginBottom: '56px' }}>
            {[
              ...(blogPosts.length > 0 ? [{ value: `${blogPosts.length}`, label: 'Articles' }] : []),
              ...(sortedStates.length > 0 ? [{ value: `${sortedStates.length}`, label: 'State Guides' }] : []),
              { value: '3', label: 'Deep Guides' },
              { value: 'Free', label: 'Always' },
            ].map((s, i) => (
              <div key={s.label} className="stk-stat" style={{ background: STICKER_CHIP_FILLS[i % STICKER_CHIP_FILLS.length] }}>
                <span className="stk-stat-value font-heading">{s.value}</span>
                <span className="stk-stat-label">{s.label}</span>
              </div>
            ))}
          </div>

          {/* ─── Section 2: Featured Guides Bento ─── */}
          <div style={{ textAlign: 'left' }}>
            <div className="res-feat-grid stk-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: '24px' }}>
              {featuredGuides.map((g, i) => (
                <Link key={g.href} href={g.href} className="stk-card">
                  <span className="stk-top">
                    <span className="stk-chip" style={{ background: STICKER_CHIP_FILLS[i % STICKER_CHIP_FILLS.length] }}>{g.badge}</span>
                    <span className="stk-icon" aria-hidden="true"><g.icon size={18} strokeWidth={2.25} /></span>
                  </span>
                  <h2 className="stk-title font-heading">{g.title}</h2>
                  <p className="stk-desc">{g.desc}</p>
                  <StickerFooter index={i} action="Read guide" />
                </Link>
              ))}
            </div>

            {/* 1099 vs W2: full-width sticker banner */}
            <Link href="/resources/1099-vs-w2" className="stk-card stk-wide">
              <span className="stk-body">
                <span className="stk-chip" style={{ background: STICKER_CHIP_FILLS[2] }}>Compensation</span>
                <h2 className="stk-title font-heading">1099 vs W2 for {brand.niche.short}s: Complete Comparison</h2>
                <p className="stk-desc">
                  Independent contractor vs employee: tax strategies, income comparison, and which model maximizes your earnings.
                </p>
                <StickerFooter index={1} action="Read guide" />
              </span>
              <span className="stk-icon stk-icon-lg" aria-hidden="true"><DollarSign size={26} strokeWidth={2.25} /></span>
            </Link>

            {/* Scope-of-practice hub: full-width sticker banner (P5 sop-hub:
                interactive 51-jurisdiction practice-authority explorer). */}
            <Link href="/scope-of-practice" className="stk-card stk-wide" style={{ marginTop: '24px' }}>
              <span className="stk-body">
                <span className="stk-chip" style={{ background: STICKER_CHIP_FILLS[3] }}>Interactive</span>
                <h2 className="stk-title font-heading">Scope of Practice by State: All 50 States + DC</h2>
                <p className="stk-desc">
                  Sortable, filterable practice-authority explorer with board of nursing links, licensure guides, salary data, and open jobs for every state.
                </p>
                <StickerFooter index={0} action="Explore" />
              </span>
              <span className="stk-icon stk-icon-lg" aria-hidden="true"><MapPin size={26} strokeWidth={2.25} /></span>
            </Link>

            {/* ─── P4: Before you apply — the education wedge ───
                Gated on the DB rows (see EDUCATION_WEDGE_SLUGS above): the
                band disappears entirely rather than linking a post the sync
                script has not published yet. */}
            {educationWedge.length > 0 && (
              <div style={{ marginTop: '28px' }}>
                <p style={{ fontSize: '11px', fontWeight: 800, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.2em', margin: '0 0 12px' }}>
                  Before you apply
                </p>
                <div className="res-tools-grid stk-grid stk-grid-2" style={{ gridTemplateColumns: `repeat(${educationWedge.length}, 1fr)` }}>
                  {educationWedge.map((post, i) => (
                    <Link key={post.slug} href={`/blog/${post.slug}`} className="stk-card">
                      <span className="stk-top">
                        <span className="stk-chip" style={{ background: STICKER_CHIP_FILLS[(i + 1) % STICKER_CHIP_FILLS.length] }}>Education</span>
                        <span className="stk-icon" aria-hidden="true"><GraduationCap size={18} strokeWidth={2.25} /></span>
                      </span>
                      <h2 className="stk-title font-heading">{post.title}</h2>
                      {post.metaDescription && (
                        <p className="stk-desc">
                          {post.metaDescription.length > 140 ? post.metaDescription.slice(0, 140) + '…' : post.metaDescription}
                        </p>
                      )}
                      <StickerFooter index={i + 2} action="Read guide" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3A: LICENSURE CHECKER TOOL (cool slate bg)
          ═══════════════════════════════════════════════════════════════ */}
      <section className="stk-stage stk-stage-mint">
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div className="stk-head">
            <p className="stk-eyebrow">
              Interactive Tool
            </p>
            <h2 className="stk-h2 font-heading">
              {brand.niche.short} Licensure Checker
            </h2>
            <p className="stk-lede">
              Select your state to instantly see requirements, practice authority, salary data, and timeline.
            </p>
          </div>

          {/* ─── Licensure Checker Tool, framed as one large sticker ─── */}
          <div className="stk-frame" style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <LicensureChecker
              stateGuides={sortedStates.filter(Boolean).map(s => ({ name: s!.name, slug: s!.slug }))}
              stateSalaries={stateSalaries}
              practiceAuthority={STATE_PRACTICE_AUTHORITY}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3B: BROWSE ALL STATE GUIDES (warm peach bg)
          Audit F12: rendered only when state guides exist — the license-guide
          series is unwritten (config/niche/content-map.ts), and a "50-State
          Coverage" header over an empty grid advertises missing content.
          ═══════════════════════════════════════════════════════════════ */}
      {sortedStates.length > 0 && (
      <section className="stk-stage stk-stage-peach">
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div className="stk-head">
            <p className="stk-eyebrow">
              50-State Coverage
            </p>
            <h2 className="stk-h2 font-heading">
              Browse All Licensure Guides
            </h2>
            <p className="stk-lede">
              Requirements, board links, salary data, and step-by-step instructions for every state.
            </p>
          </div>

          <div className="res-state-grid" style={{
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '24px',
          }}>
            {sortedStates.map(s => {
              if (!s) return null;
              const slug = s.name.toLowerCase().replace(/\s+/g, '-');
              return (
                <Link key={s.name} href={`/blog/${s.slug}`} className="stk-state">
                  <span className="stk-state-img">
                    {/* SEO Fix H15: StateImage falls back if per-state webp is missing. */}
                    <StateImage
                      slug={slug}
                      alt={`${s.name} ${brand.niche.short} licensure guide`}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
                    />
                  </span>
                  <span className="stk-state-name font-heading">{s.name}</span>
                  <span className="stk-action">Read guide →</span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4: BLOG ARTICLES BY CATEGORY (cream bg)
          Audit F12: rendered only when published articles exist — this board
          launches with an empty blog (config/niche/content-map.ts).
          ═══════════════════════════════════════════════════════════════ */}
      {articles.length > 0 && (
      <div className="stk-stage stk-stage-grid">
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div className="stk-head">
            <p className="stk-eyebrow">
              Expert Articles
            </p>
            <h2 className="stk-h2 font-heading">
              Career Guides & Insights
            </h2>
          </div>

          {Object.entries(grouped).map(([category, posts]) => {
            const cfg = CATEGORY_CONFIG[category] || { label: category, color: '#64748B', bg: '#F1F5F9', icon: Star };
            return (
              <div key={category} style={{ marginBottom: '56px' }}>
                {/* Category header */}
                <div className="stk-cat-head">
                  <span className="stk-icon" aria-hidden="true"><cfg.icon size={18} strokeWidth={2.25} /></span>
                  <h3 className="stk-cat-title font-heading">{cfg.label}</h3>
                  <span className="stk-cat-count">{posts.length}</span>
                </div>
                {/* Post grid */}
                <div className="res-article-grid stk-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  {posts.slice(0, 6).map((post, i) => (
                    <Link key={post.slug} href={`/blog/${post.slug}`} className="stk-card">
                      <span className="stk-top">
                        <span className="stk-chip" style={{ background: STICKER_CHIP_FILLS[i % STICKER_CHIP_FILLS.length] }}>{cfg.label}</span>
                      </span>
                      <h4 className="stk-title font-heading">{post.title}</h4>
                      {post.metaDescription && (
                        <p className="stk-desc">
                          {post.metaDescription.length > 120 ? post.metaDescription.slice(0, 120) + '…' : post.metaDescription}
                        </p>
                      )}
                      <StickerFooter index={i} action="Read" />
                    </Link>
                  ))}
                </div>
                {posts.length > 6 && (
                  <div style={{ textAlign: 'center', marginTop: '28px' }}>
                    <Link href="/blog" className="stk-link">
                      View all {cfg.label} articles <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5: TOOLS & DOWNLOADS (slate bg)
          ═══════════════════════════════════════════════════════════════ */}
      <section className="stk-stage stk-stage-blush">
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div className="stk-head">
            <p className="stk-eyebrow">
              Free Tools
            </p>
            <h2 className="stk-h2 font-heading">
              Tools & Downloads
            </h2>
          </div>

          {/* P2 #4/#5/#6/#17 — the four interactive tools each have their own
              route under /tools. Cards render from the TOOLS registry so this
              band can never link a tool path that does not exist. */}
          <div className="res-tools-grid stk-grid stk-grid-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: '24px' }}>
            {TOOLS.map((t, i) => {
              const ToolIcon = TOOL_ICONS[t.icon];
              return (
                <Link key={t.path} href={t.path} className="stk-card">
                  <span className="stk-top">
                    <span className="stk-chip" style={{ background: STICKER_CHIP_FILLS[i % STICKER_CHIP_FILLS.length] }}>{t.badge}</span>
                    <span className="stk-icon" aria-hidden="true"><ToolIcon size={18} strokeWidth={2.25} /></span>
                  </span>
                  <h3 className="stk-title font-heading">{t.title}</h3>
                  <p className="stk-desc">{t.blurb}</p>
                  <StickerFooter index={i} action="Open tool" />
                </Link>
              );
            })}
          </div>

          <p style={{ textAlign: 'center', margin: '8px 0 32px' }}>
            <Link href="/tools" className="stk-more">
              Browse all free tools →
            </Link>
          </p>

          <div className="stk-grid" style={{ gridTemplateColumns: '1fr' }}>
            {/* Salary Calculator: full-width sticker banner */}
            <Link href="/salary-guide" className="stk-card stk-wide">
              <span className="stk-body">
                <span className="stk-chip" style={{ background: STICKER_CHIP_FILLS[1] }}>Interactive</span>
                <h3 className="stk-title font-heading">Salary Calculator</h3>
                <p className="stk-desc">
                  Get a personalized salary estimate based on your state, experience, setting, and specialty.
                </p>
                <StickerFooter index={1} action="Use calculator" />
              </span>
              <span className="stk-icon stk-icon-lg" aria-hidden="true"><Calculator size={26} strokeWidth={2.25} /></span>
            </Link>

            {/* PDF Download: not a link (it hosts the download form), so no hover lift.
                Copy on the left, the email gate on the right. */}
            <div className="stk-card stk-wide stk-static stk-download">
              <span className="stk-body">
              <span className="stk-chip" style={{ background: STICKER_CHIP_FILLS[2] }}>Free download</span>
              <h3 className="stk-title font-heading">Free Salary Guide PDF</h3>
              {/* Edition year comes from the artifact on disk, never from the
                  clock: `currentYear` would advertise a 2027 guide on 1 Jan
                  while the funnel still delivers np-salary-guide-2026.pdf.
                  Contents mirror the PDF's own cover lede — it prints no
                  state-by-state table by design (that data lives on
                  /salary-guide and updates daily). */}
              <p className="stk-desc">
                Download the {SALARY_GUIDE_EDITION_YEAR} salary guide: national wage benchmarks, pay by experience,
                setting, and specialty, plus what to check before you negotiate.
              </p>
              </span>
              <span className="stk-download-gate">
                <ResourceDownloadGate resourceUrl={SALARY_GUIDE_URL} resourceTitle="Salary Guide PDF" />
              </span>
            </div>
          </div>

          {/* P6 completeness hole #5 (nav-mesh): the /compare cluster had no
              human-navigable inbound links anywhere on the site (orphan rule
              documented in app/sitemap.ts). The footer carries the sitewide
              link; this is the in-content mention on the resources hub. Href
              matches COMPARE_HUB_PATH in lib/compare-data.ts — pinned by
              tests/regressions/p6-nav-mesh-compare-inbound.test.ts. */}
          <p style={{ textAlign: 'center', marginTop: '36px', marginBottom: 0 }}>
            <Link href="/compare" className="stk-link">
              See how {brand.name} compares to other {brand.niche.short} job boards <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 6: CTA
          ═══════════════════════════════════════════════════════════════ */}
      <div className="stk-stage stk-stage-cream">
        <div style={{ maxWidth: '760px', margin: '0 auto' }}>
          <div className="stk-cta">
            <span className="stk-icon stk-icon-lg stk-icon-on-berry" aria-hidden="true">
              <Briefcase size={26} strokeWidth={2.25} />
            </span>
            <h2 className="stk-cta-title font-heading">Ready to Find Your Next {brand.niche.short} Role?</h2>
            <p className="stk-cta-lede">
              Browse hundreds of {brand.niche.descriptor} positions updated daily.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '16px' }}>
              <Link href="/jobs" className="stk-btn">Browse Jobs <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/job-alerts" className="stk-btn stk-btn-ghost">Set Up Job Alerts</Link>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Styles ─── */}
      <style>{`
        /* Sticker card system: same anatomy as the homepage tools band */
        .stk-grid { display: grid; gap: 24px; }
        .stk-card {
          display: flex;
          flex-direction: column;
          height: 100%;
          box-sizing: border-box;
          background: #fff;
          border: 2px solid #7A1C2B;
          box-shadow: 5px 5px 0 #7A1C2B;
          padding: 20px;
          text-decoration: none;
          color: inherit;
          text-align: left;
          transition: transform 0.15s ease;
        }
        a.stk-card { cursor: pointer; }
        a.stk-card:hover { transform: translateY(-4px); }
        a.stk-card:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
        .stk-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 12px;
        }
        .stk-chip {
          display: inline-block;
          align-self: flex-start;
          padding: 5px 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.5);
          box-shadow: 3px 3px 8px rgba(190,24,93,0.10), -2px -2px 5px rgba(255,255,255,0.8), inset 2px 2px 3px rgba(255,255,255,0.7);
          font-size: 10.5px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #7A1C2B;
        }
        .stk-icon {
          flex: none;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #FBF2E6;
          border: 2px solid #7A1C2B;
          box-shadow: 3px 3px 0 #7A1C2B;
          color: #7A1C2B;
        }
        .stk-icon-lg { width: 60px; height: 60px; box-shadow: 4px 4px 0 #7A1C2B; }
        .stk-title {
          font-weight: 700;
          font-size: 18px;
          line-height: 1.3;
          color: #2b1a1e;
          margin: 0 0 8px;
        }
        .stk-desc {
          font-size: 12.5px;
          color: #7a6d70;
          line-height: 1.5;
          margin: 0 0 14px;
        }
        .stk-bar {
          margin-top: auto;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .stk-track {
          flex: 1;
          height: 4px;
          background: rgba(122,28,43,0.12);
          border-radius: 2px;
          position: relative;
          overflow: hidden;
        }
        .stk-fill {
          position: absolute;
          top: 0; left: 0; bottom: 0;
          background: #BE185D;
          border-radius: 2px;
        }
        .stk-action {
          font-size: 11px;
          font-weight: 800;
          color: #9b8291;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }
        .stk-wide {
          flex-direction: row;
          align-items: center;
          gap: 24px;
          height: auto;
        }
        .stk-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .stk-grid-2 > .stk-card:last-child:nth-child(odd) { grid-column: 1 / -1; }
        .stk-download { align-items: flex-start; }
        .stk-download-gate { flex: 0 1 420px; min-width: 0; }
        @media (max-width: 900px) {
          .stk-download { flex-direction: column; align-items: stretch; }
          .stk-download-gate { flex-basis: auto; width: 100%; }
        }
        .stk-body .stk-chip { margin-bottom: 12px; }
        .stk-more {
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
        .stk-more:hover { transform: translateY(-2px); background: #9D174D; }
        .stk-more:focus-visible { outline: 3px solid #BE185D; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          a.stk-card:hover, .stk-more:hover { transform: none; }
        }
        @media (max-width: 560px) {
          .stk-wide { flex-direction: column; align-items: flex-start; }
          .stk-wide .stk-icon-lg { display: none; }
          .stk-download-gate { flex-basis: auto; width: 100%; }
        }
        /* Stages: each band keeps its own ground (homepage rule) */
        .stk-stage { position: relative; padding: 88px 20px; }
        .stk-stage-grid {
          background-color: #F5F0EB;
          background-image: linear-gradient(rgba(122,28,43,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(122,28,43,0.07) 1px, transparent 1px);
          background-size: 44px 44px;
        }
        .stk-stage-mint { background-color: #E9F5EE; }
        .stk-stage-peach {
          background-color: #FBF2E6;
          background-image: radial-gradient(rgba(122,28,43,0.14) 1.2px, transparent 1.4px);
          background-size: 22px 22px;
        }
        .stk-stage-blush {
          background-color: #FBE7EE;
          background-image: radial-gradient(rgba(122,28,43,0.18) 1.2px, transparent 1.4px);
          background-size: 22px 22px;
        }
        .stk-stage-cream { background-color: #FDFBF7; }

        /* Headings: pink eyebrow, uppercase berry Lora, muted lede */
        .stk-head { text-align: center; margin: 0 auto 40px; max-width: 640px; }
        .stk-eyebrow {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #BE185D;
          margin: 0 0 8px;
        }
        .stk-h1 {
          font-weight: 700;
          font-size: clamp(2.2rem, 5.2vw, 3.6rem);
          line-height: 1.02;
          letter-spacing: -0.01em;
          text-transform: uppercase;
          color: #7A1C2B;
          margin: 0;
          text-wrap: balance;
        }
        .stk-h2 {
          font-weight: 700;
          font-size: clamp(26px, 3vw, 36px);
          line-height: 1.1;
          letter-spacing: -0.01em;
          text-transform: uppercase;
          color: #7A1C2B;
          margin: 0;
          text-wrap: balance;
        }
        .stk-lede { font-size: 15px; color: #5A4A42; line-height: 1.6; max-width: 580px; margin: 12px auto 0; }

        /* Stat stickers in the hero */
        .stk-stat {
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          padding: 10px 18px;
          border: 2px solid #7A1C2B;
          box-shadow: 4px 4px 0 #7A1C2B;
        }
        .stk-stat-value { font-size: 22px; font-weight: 700; color: #7A1C2B; line-height: 1; }
        .stk-stat-label { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #7A1C2B; }

        /* Large sticker frame around an embedded tool */
        .stk-frame { background: #fff; border: 2px solid #7A1C2B; box-shadow: 6px 6px 0 #7A1C2B; overflow: hidden; }
        /* The embedded checker ships its own rounded, shadowed shell: square it off inside the frame */
        .stk-frame > * { border-radius: 0 !important; box-shadow: none !important; border: 0 !important; margin: 0 !important; }

        /* State guide tiles: image in a sticker frame, name, action word */
        .stk-state { display: flex; flex-direction: column; align-items: center; gap: 6px; text-decoration: none; transition: transform 0.15s ease; }
        .stk-state-img {
          position: relative;
          display: block;
          width: 100%;
          aspect-ratio: 1;
          overflow: hidden;
          background: #fff;
          border: 2px solid #7A1C2B;
          box-shadow: 5px 5px 0 #7A1C2B;
          margin-bottom: 8px;
        }
        .stk-state-name { font-size: 15px; font-weight: 700; color: #2b1a1e; text-align: center; line-height: 1.25; }
        .stk-state:hover { transform: translateY(-4px); }
        .stk-state:focus-visible { outline: 3px solid #BE185D; outline-offset: 4px; }

        /* Article category header */
        .stk-cat-head { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
        .stk-cat-title { font-size: 20px; font-weight: 700; color: #7A1C2B; text-transform: uppercase; letter-spacing: -0.01em; margin: 0; }
        .stk-cat-count {
          font-size: 11px;
          font-weight: 800;
          color: #7A1C2B;
          background: #FDE3C8;
          border: 2px solid #7A1C2B;
          padding: 2px 9px;
        }

        /* Inline text link */
        .stk-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #7A1C2B;
          text-decoration: none;
          border-bottom: 2px solid #BE185D;
          padding-bottom: 2px;
        }
        .stk-link:hover { color: #BE185D; }
        .stk-link:focus-visible { outline: 3px solid #BE185D; outline-offset: 3px; }

        /* Closing call to action: one berry sticker */
        .stk-cta {
          text-align: center;
          background: #BE185D;
          border: 2px solid #7A1C2B;
          box-shadow: 8px 8px 0 #7A1C2B;
          padding: 44px 32px;
          color: #fff;
        }
        .stk-icon-on-berry { margin: 0 auto 18px; background: #FBCFE8; }
        .stk-cta-title {
          font-size: clamp(22px, 2.6vw, 30px);
          font-weight: 700;
          text-transform: uppercase;
          line-height: 1.15;
          margin: 0 0 10px;
          color: #fff;
          text-wrap: balance;
        }
        .stk-cta-lede { font-size: 15px; color: #FDE7F0; margin: 0 0 28px; }
        .stk-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 13px 26px;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #7A1C2B;
          background: #fff;
          border: 2px solid #7A1C2B;
          box-shadow: 4px 4px 0 #7A1C2B;
          text-decoration: none;
          transition: transform 0.15s ease;
        }
        .stk-btn:hover { transform: translateY(-2px); }
        .stk-btn:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
        .stk-btn-ghost { background: #9D174D; color: #fff; }
        @media (prefers-reduced-motion: reduce) {
          .stk-state:hover, .stk-btn:hover { transform: none; }
        }
        @media (max-width: 768px) {
          .res-feat-grid { grid-template-columns: 1fr !important; }
          .res-state-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .res-article-grid { grid-template-columns: 1fr !important; }
          .res-tools-grid { grid-template-columns: 1fr !important; }
          .stk-stage { padding: 60px 16px; }
          .stk-cta { padding: 36px 20px; }
        }
        @media (min-width: 769px) and (max-width: 1024px) {
          .res-feat-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .res-state-grid { grid-template-columns: repeat(3, 1fr) !important; }
          .res-article-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </>
  );
}

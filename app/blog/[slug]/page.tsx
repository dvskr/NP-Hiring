import { brand } from '@/config/brand';
import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { cache, type CSSProperties } from 'react';
import { prisma } from '@/lib/prisma';
import {
    getPostBySlug,
    getRelatedPosts,
    markdownToHtml,
    autoLinkStates,
    resanitizeBlogHtml,
    extractHeadings,
    BLOG_CATEGORIES,
    type BlogPost,
} from '@/lib/blog';
import { autoLinkCategories } from '@/lib/autoLink';
import { buildLicenseGuideHowTo, getLicenseGuideState } from '@/lib/blog-license-guides';
import {
    buildLicenseGuideDescription,
    buildLicenseGuideTitle,
    getNearbyStates,
    getPracticeEnvironment,
    isLicenseGuideLive,
    type PracticeEnvironment,
} from '@/lib/pseo/practice-environment';
import { getListingFacts, type ListingFacts } from '@/lib/pseo/listing-facts';
import { getGatedLocationSalary, summarizeGatedSalary, type GatedSalary } from '@/lib/salary-analytics';
import {
    MIN_ACTIVE_JOBS_FOR_MARKET_SNAPSHOT,
    MIN_JOBS_FOR_LINK_LIST_ROW,
    pseoStatsFreshnessThreshold,
    shouldIndexSalaryGuideState,
} from '@/lib/pseo/render-gate';
import { COUNT_DISPLAY_FLOOR } from '@/lib/canonical-counts';
import { formatCount } from '@/lib/display-text';
import { LicenseGuideBands, type LicenseGuideNearbyRow } from '@/components/blog/LicenseGuideMarketSnapshot';
import { ArrowRight } from 'lucide-react';
import EditorialByline, { editorialSchemaFields } from '@/components/EditorialByline';
import EditorialTOC from '@/components/blog/EditorialTOC';
import EditorialToolbar from '@/components/blog/EditorialToolbar';
import EditorialShare from '@/components/blog/EditorialShare';
import EditorialStickyFix from '@/components/blog/EditorialStickyFix';
import VideoLightbox from '@/components/blog/VideoLightbox';
import '@/app/editorial.css';

// ISR: blog post bodies change infrequently; 1-hour revalidate is appropriate.
// Previously force-dynamic bypassed all caching, so every crawl plus every
// share-driven traffic spike re-rendered the post and re-ran markdown +
// auto-link processing. revalidate also lets Vercel serve from edge cache.
export const revalidate = 3600;

// P7 runtime fix D3: without a generateStaticParams export, `revalidate`
// is a silent no-op — Next renders the dynamic segment fully dynamically
// on every request (runtime-verified `private, no-cache, no-store`).
// Returning [] enables on-demand static generation: first hit renders +
// caches, later hits serve the cache until `revalidate` expires. Full
// rationale in app/jobs/[slug]/page.tsx; guarded by
// tests/regressions/p7-runtime-isr-static-params.test.ts.
export function generateStaticParams(): Array<{ slug: string }> {
    return [];
}

interface Props {
    params: Promise<{ slug: string }>;
}

// ─── License-guide branch (LIC-L2, LIC-L3, LIC-L4, LIC-meta) ──────────────────
//
// The static markdown of a license guide is synced into the DB, so nothing
// live can live there. Everything inventory-dependent (the bands, the linked
// state pages, the live clause of the description) is loaded here from the
// shared data layer and rendered between the article and "Read Next".

const NP = brand.niche.short;

/** Category x state pages the CTA row may link, in display order. */
const LICENSE_GUIDE_SETTINGS = [{ slug: 'remote', label: 'Remote' }, { slug: 'telehealth', label: 'Telehealth' }, { slug: 'outpatient', label: 'Outpatient' }] as const;

/** buildLicenseGuideDescription's own ceiling (it drops the board clause past it). */
const LICENSE_DESCRIPTION_MAX = 160;

interface LicenseGuideContext {
    env: PracticeEnvironment;
    facts: ListingFacts;
    /** The salary guide's own gated figure for the state (one helper, one verdict). */
    salary: GatedSalary;
    salaryGuideIndexable: boolean;
    /** Nearby jurisdictions with a live-guide flag for the sibling link. */
    nearby: readonly LicenseGuideNearbyRow[];
    /** Setting slugs whose category x state page renders and is not noindex for count. */
    settingSlugs: ReadonlySet<string>;
}

/**
 * The state hub renders at 1 or more canonical jobs (PLAN C.2), the same
 * floor as the market snapshot, so the hub link and the snapshot share it.
 */
function stateHubRenders(activeJobs: number): boolean {
    return activeJobs >= MIN_ACTIVE_JOBS_FOR_MARKET_SNAPSHOT;
}

/**
 * Category x state pages worth linking from the CTA row: fresh PseoStats
 * rows at MIN_JOBS_FOR_LINK_LIST_ROW or more (1 to 2 job pages are noindex,
 * 0 job pages 410). A failed read links nothing, never a dead page.
 */
async function loadSettingSlugs(stateSlug: string): Promise<ReadonlySet<string>> {
    try {
        const rows = await prisma.pseoStats.findMany({
            where: {
                type: 'setting-state',
                locationSlug: stateSlug,
                totalJobs: { gte: MIN_JOBS_FOR_LINK_LIST_ROW },
                categorySlug: { in: LICENSE_GUIDE_SETTINGS.map((s) => s.slug) },
                updatedAt: { gte: pseoStatsFreshnessThreshold() },
            },
            select: { categorySlug: true },
        });
        return new Set(rows.map((r) => r.categorySlug));
    } catch (error) {
        console.error(`[blog/license-guide] setting-state lookup failed for ${stateSlug}:`, error);
        return new Set();
    }
}

/** The salary guide's gate; a failed read is "below the gate", never a 5xx. */
async function loadStateSalary(stateName: string): Promise<GatedSalary> {
    try {
        return await getGatedLocationSalary({ state: stateName });
    } catch (error) {
        console.error(`[blog/license-guide] salary lookup failed for ${stateName}:`, error);
        return summarizeGatedSalary([]);
    }
}

/**
 * Everything the license branch needs, loaded once per request (React
 * cache) so generateMetadata and the page body share the queries. Null for
 * a slug that matches the pattern but names no jurisdiction (the page 404s
 * through getPostBySlug anyway).
 */
const loadLicenseGuideContext = cache(async (stateSlug: string): Promise<LicenseGuideContext | null> => {
    const state = getLicenseGuideState(stateSlug);
    const env = state ? getPracticeEnvironment(state.name) : null;
    if (!state || !env) return null;
    // Same bucket as the state hub: rows keyed by either the full name or the code.
    const bucket = { OR: [{ state: state.name }, { stateCode: state.code }] };
    const [facts, salary, settingSlugs, nearby] = await Promise.all([
        getListingFacts(`license-guide:${stateSlug}`, bucket),
        loadStateSalary(state.name),
        loadSettingSlugs(stateSlug),
        Promise.all(
            getNearbyStates(state.name).map(async (near) => ({
                env: near,
                guideLive: await isLicenseGuideLive(near.stateSlug),
            })),
        ),
    ]);
    const salaryGuideIndexable = shouldIndexSalaryGuideState({
        activeJobs: facts.total,
        salaryGatePassed: salary.gatePassed,
    });
    return { env, facts, salary, salaryGuideIndexable, nearby, settingSlugs };
});

/**
 * LIC-meta description: the dataset description plus a live count clause at
 * COUNT_DISPLAY_FLOOR or more open roles, kept only while it fits. Computed
 * here, never synced into the DB.
 */
function licenseGuideDescription(env: PracticeEnvironment, openRoles: number): string {
    const base = buildLicenseGuideDescription(env);
    if (openRoles < COUNT_DISPLAY_FLOOR) return base;
    const withLive = `${base} ${formatCount(openRoles, `open ${NP} role`)} listed.`;
    return withLive.length <= LICENSE_DESCRIPTION_MAX ? withLive : base;
}

interface CtaLink { href: string; label: string; primary?: boolean }
interface JobsCta { intro: string; links: CtaLink[] }

/** License guide CTA row: only pages that render (hub, settings) or index (salary guide). */
function licenseGuideCta(license: LicenseGuideContext): JobsCta {
    const { env, facts, settingSlugs, salaryGuideIndexable } = license;
    const links: CtaLink[] = [];
    if (stateHubRenders(facts.total)) {
        links.push({ href: `/jobs/state/${env.stateSlug}`, label: `All jobs in ${env.stateName}` });
    }
    for (const setting of LICENSE_GUIDE_SETTINGS) {
        if (settingSlugs.has(setting.slug)) {
            links.push({ href: `/jobs/${setting.slug}/${env.stateSlug}`, label: setting.label });
        }
    }
    if (salaryGuideIndexable) {
        links.push({ href: `/salary-guide/${env.stateSlug}`, label: 'Salary guide' });
    }
    if (links.length === 0) {
        return {
            intro: `Get an alert when the next ${NP} role in ${env.stateName} is posted:`,
            links: [{ href: '/job-alerts', label: 'Create a job alert', primary: true }],
        };
    }
    return { intro: `Ready to start your career? Browse ${NP} positions:`, links };
}

/** Career posts: the all-jobs link plus up to four category links matched on the copy. */
function careerPostCta(post: BlogPost): JobsCta {
    const categoryLinks = [
        { match: /remote|work.from.home/i, label: 'Remote Jobs', href: '/jobs/remote' },
        { match: /telehealth|virtual/i, label: 'Telehealth Jobs', href: '/jobs/telehealth' },
        { match: /new.grad|first.job|entry.level/i, label: 'New Grad Jobs', href: '/jobs/new-grad' },
        { match: /salary|compensation|pay/i, label: 'Salary Guide', href: '/salary-guide' },
        { match: /travel|locum/i, label: 'Travel Jobs', href: '/jobs/travel' },
        { match: /private.practice/i, label: 'Private Practice', href: '/jobs/private-practice' },
        { match: /inpatient|hospital/i, label: 'Inpatient Jobs', href: '/jobs/inpatient' },
        { match: /outpatient|clinic/i, label: 'Outpatient Jobs', href: '/jobs/outpatient' },
    ];
    const fullText = `${post.title} ${post.content.slice(0, 500)}`;
    const matched = categoryLinks.filter((l) => l.match.test(fullText)).slice(0, 4);
    return {
        intro: 'Looking for your next role?',
        links: [
            { href: '/jobs', label: `Browse All ${NP} Jobs`, primary: true },
            ...matched.map((l) => ({ href: l.href, label: l.label })),
        ],
    };
}

const CTA_LINK_STYLE: CSSProperties = { padding: '6px 14px', borderRadius: '10px', textDecoration: 'none', fontSize: '13px', fontWeight: 600 };
const CTA_PRIMARY_STYLE: CSSProperties = { ...CTA_LINK_STYLE, background: '#BE185D', color: '#fff' };
const CTA_SECONDARY_STYLE: CSSProperties = { ...CTA_LINK_STYLE, background: '#FDF2F8', border: '1px solid rgba(190,24,93,0.15)', color: '#BE185D' };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const post = await getPostBySlug(slug);

    if (!post) {
        return { title: 'Article Not Found' };
    }

    // LIC-meta: "{State} NP License Guide: {Authority}, {Compact status}" with
    // the live clause computed here; the DB copy of the guide never carries it.
    // Other posts: the description describes the post, never echoes the title
    // (audit 09 M-24), with a generic fallback when meta_description is absent.
    const licenseMatch = slug.match(LICENSE_GUIDE_SLUG_REGEX);
    const license = licenseMatch ? await loadLicenseGuideContext(licenseMatch[1]) : null;
    const title = license ? buildLicenseGuideTitle(license.env) : post.title;
    const description = license
        ? licenseGuideDescription(license.env, license.facts.total)
        : post.meta_description || `Read this ${brand.niche.short} career article on ${brand.name}: guides, salary insights, and licensure updates for ${brand.niche.descriptor}s.`;

    const ogImage = post.image_url || `${brand.baseUrl}/api/og`;
    const url = `${brand.baseUrl}/blog/${slug}`;

    return {
        // B54: no auto-appended year. Stamping the current year onto every
        // title fabricates freshness (a 2026 badge on an unrevised post,
        // silently rolling to 2027) — a YMYL trust hit. If a year belongs
        // in a title, the author writes it into post.title.
        title,
        description,
        keywords: post.target_keyword ? [post.target_keyword] : undefined,
        openGraph: {
            title,
            description,
            type: 'article',
            publishedTime: post.publish_date || post.created_at,
            modifiedTime: post.updated_at,
            url,
            images: [
                {
                    url: ogImage,
                    width: 1200,
                    height: 630,
                    alt: title,
                },
            ],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            images: [ogImage],
        },
        alternates: {
            canonical: url,
        },
    };
}

export default async function BlogPostPage({ params }: Props) {
    const { slug } = await params;
    const post = await getPostBySlug(slug);

    if (!post) {
        notFound();
    }

    const relatedPosts = await getRelatedPosts(post.category, post.slug);
    const currentUrl = `${brand.baseUrl}/blog/${slug}`;

    // License guides (slug like "<prefix>{state}", see config/niche/content-map.ts)
    // get the live branch: nearby-states table, market snapshot, HowTo schema
    // and a CTA row that links only pages which render or index.
    const licenseSlugMatch = slug.match(LICENSE_GUIDE_SLUG_REGEX);
    const license = licenseSlugMatch ? await loadLicenseGuideContext(licenseSlugMatch[1]) : null;
    const howTo = licenseSlugMatch ? buildLicenseGuideHowTo(licenseSlugMatch[1]) : null;
    const jobsCta = license ? licenseGuideCta(license) : careerPostCta(post);

    // Convert markdown to HTML and auto-link states
    let contentHtml = markdownToHtml(post.content);
    contentHtml = autoLinkStates(contentHtml);
    contentHtml = autoLinkCategories(contentHtml);
    // Re-sanitize after the regex-based auto-linkers so any false-positive
    // injection (state names appearing inside attribute values, etc.) gets
    // caught by the same sanitize-html config the markdown step already used.
    contentHtml = resanitizeBlogHtml(contentHtml);

    // Extract headings for TOC
    const headings = extractHeadings(post.content);

    // Hoist Quick Answer block to right before the first <h2>.
    //
    // Supabase posts open with `**Quick answer:** ...` (markdown bold prefix
    // followed by inline body, optionally with a `---` rule). The custom
    // markdown→HTML converter in lib/blog.ts emits this as a bare
    // `<strong>Quick answer:</strong> body` directly inside the prose
    // container — no `<p>` wrapper — so the styling never lands and the
    // text reads as plain inline content. We detect that bare form, the
    // optional `<hr>` that may follow, plus a legacy MDX `<h3>` form, then
    // strip from the source location and re-inject styled with the
    // `.ed-quick-answer` class right before the first <h2>.
    let quickAnswerHtml: string | null = null;

    // Form A (current Supabase content): bare `<strong>Quick answer:</strong>`
    // followed by inline body, terminated by either an `<hr>` or the next heading.
    // Capture group 1 = body between the closing </strong> and the terminator.
    // Optional surrounding <p> tags are tolerated for posts that wrap differently.
    const qaParaPattern = /(?:<p[^>]*>\s*)?<strong>\s*Quick\s+[Aa]nswer\s*:?\s*<\/strong>([\s\S]*?)(?:<\/p>\s*)?(?=<hr\s*\/?>|<h\d\b|<div\s+class="ed-)/i;
    const qaParaMatch = contentHtml.match(qaParaPattern);

    // Form B: `<h3>Quick Answer</h3>` + adjacent block (legacy MDX shape).
    const qaHeadingPattern = /<h3[^>]*>\s*Quick\s+Answer\s*<\/h3>\s*(<(?:div|p)[^>]*>[\s\S]*?<\/(?:div|p)>)/i;
    const qaHeadingMatch = !qaParaMatch ? contentHtml.match(qaHeadingPattern) : null;

    if (qaParaMatch) {
        const inner = qaParaMatch[1].trim();
        quickAnswerHtml = `<div class="ed-quick-answer">`
            + `<div class="ed-qa-header"><span class="ed-qa-icon">💡</span><span class="ed-qa-label">Quick Answer</span></div>`
            + `<div class="ed-qa-body"><p>${inner}</p></div>`
            + `</div>`;
        // Strip the original Quick Answer fragment AND any immediately-trailing
        // <hr> (the `---` separator that usually follows in markdown). Leaving
        // the <hr> behind would render an orphaned divider where the block was.
        const trailingHr = /^<hr\s*\/?>\s*/i;
        const after = contentHtml.slice((qaParaMatch.index ?? 0) + qaParaMatch[0].length);
        const hrMatch = after.match(trailingHr);
        const consume = qaParaMatch[0].length + (hrMatch ? hrMatch[0].length : 0);
        contentHtml = contentHtml.slice(0, qaParaMatch.index)
            + contentHtml.slice((qaParaMatch.index ?? 0) + consume);
    } else if (qaHeadingMatch) {
        const innerMatch = qaHeadingMatch[1].match(/^<(?:div|p)[^>]*>([\s\S]*)<\/(?:div|p)>$/);
        const innerBody = innerMatch ? innerMatch[1] : qaHeadingMatch[1];
        quickAnswerHtml = `<div class="ed-quick-answer">`
            + `<div class="ed-qa-header"><span class="ed-qa-icon">💡</span><span class="ed-qa-label">Quick Answer</span></div>`
            + `<div class="ed-qa-body">${innerBody}</div>`
            + `</div>`;
        contentHtml = contentHtml.replace(qaHeadingMatch[0], '');
    }

    // Inject Key Takeaways + (optionally) the hoisted Quick Answer right
    // before the first <h2>. Quick Answer goes first so the snippet-style
    // summary lands above the navigational takeaways list.
    const h2Matches = [...contentHtml.matchAll(/<h2[^>]*>/g)];
    if (h2Matches.length >= 2) {
        const firstH2Pos = h2Matches[0]?.index;
        if (firstH2Pos !== undefined) {
            const ktItems = headings
                .filter(h => h.level === 2)
                .slice(0, 5)
                .map(h => `<li><a href="#${h.id}">${h.text}</a></li>`)
                .join('');
            const ktHtml = `<div class="ed-key-takeaways">`
                + `<div class="ed-kt-header"><span class="ed-kt-icon">💡</span><span class="ed-kt-label">Key Takeaways</span></div>`
                + `<ul class="ed-kt-list">${ktItems}</ul>`
                + `</div>`;
            const injection = (quickAnswerHtml ?? '') + ktHtml;
            contentHtml = contentHtml.slice(0, firstH2Pos)
                + injection
                + contentHtml.slice(firstH2Pos);
        }
    } else if (quickAnswerHtml) {
        // Posts with fewer than 2 H2s skip the Key Takeaways list, but
        // we still want the Quick Answer hoisted to the top of the body.
        contentHtml = quickAnswerHtml + contentHtml;
    }

    // F4: Inject mid-article email signup placeholder
    // Find the ~40% point of h2 tags and inject a marker
    // (re-scan after Key Takeaways injection)
    const h2MatchesForSignup = [...contentHtml.matchAll(/<h2[^>]*>/g)];
    if (h2MatchesForSignup.length >= 3) {
        const midIdx = Math.floor(h2MatchesForSignup.length * 0.4);
        const insertPos = h2MatchesForSignup[midIdx]?.index;
        if (insertPos !== undefined) {
            contentHtml = contentHtml.slice(0, insertPos)
                + '<div id="mid-article-signup" class="mid-article-signup-slot"></div>'
                + contentHtml.slice(insertPos);
        }
    }

    // Category label lookup
    const categoryLabel =
        BLOG_CATEGORIES.find((c) => c.id === post.category)?.label || post.category;

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });
    };

    // Word count and read time for editorial TOC
    // Strip markdown syntax to get accurate word count
    const plainText = post.content
        .replace(/^#{1,6}\s+/gm, '')           // headings
        .replace(/\*\*(.+?)\*\*/g, '$1')       // bold
        .replace(/\*(.+?)\*/g, '$1')           // italic
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')  // images
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → keep text
        .replace(/https?:\/\/\S+/g, '')        // bare URLs
        .replace(/[`~>|]/g, '')                // code ticks, blockquotes
        .replace(/\s+/g, ' ')
        .trim();
    const wordCount = plainText.split(/\s+/).filter(Boolean).length;
    const readTime = `${Math.max(1, Math.ceil(wordCount / 238))} min`;

    // JSON-LD BlogPosting schema
    //
    // Authorship stays at the Organization level — posts are editorially
    // produced from cited data sources, not individually authored, and
    // fabricating clinical credentials on healthcare YMYL content is a
    // manual-action risk (SEO Fix C1). The editorialSchemaFields() spread
    // below is the sanctioned path forward: it contributes NOTHING while
    // brand.editorial.reviewer (config/brand.ts) is null, and emits the
    // review attribution as a schema.org Person derived from that same
    // config once a real credentialed reviewer is contracted — the
    // visible byline (components/EditorialByline.tsx) renders from the
    // identical object, so schema and UI can never disagree. See
    // /editorial-policy for the public-facing version of this policy.
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.meta_description || post.title,
        datePublished: post.publish_date || post.created_at,
        // Audit 14 HIGH: prefer the editorial-review timestamp when set so
        // dateModified reflects real freshness. Falls back to updated_at
        // for legacy rows that haven't had a review pass yet.
        dateModified: post.reviewed_at || post.updated_at,
        author: {
            '@type': 'Organization',
            name: brand.name,
            url: brand.baseUrl,
        },
        publisher: {
            '@type': 'Organization',
            name: brand.name,
            logo: {
                '@type': 'ImageObject',
                url: `${brand.baseUrl}/logo.png`,
            },
        },
        mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': currentUrl,
        },
        image: post.image_url || `${brand.baseUrl}/api/og`,
        keywords: post.target_keyword || undefined,
        articleSection: categoryLabel,
        url: currentUrl,
        // {} while brand.editorial.reviewer is null; the real reviewer's
        // Person record when configured. Never a fabricated name.
        ...editorialSchemaFields(),
    };

    // JSON-LD serialization guard (same chain as BreadcrumbSchema / the
    // jobs templates): escape </> so post-derived strings can never break
    // out of the <script> element.
    const toJsonLd = (obj: unknown): string =>
        JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

    // VideoObject schema when a YouTube video or Supabase video is associated
    const videoSchema = post.youtube_video_id ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: post.title,
        description: post.meta_description || post.title,
        thumbnailUrl: `https://img.youtube.com/vi/${post.youtube_video_id}/maxresdefault.jpg`,
        uploadDate: post.publish_date || post.created_at,
        contentUrl: `https://www.youtube.com/watch?v=${post.youtube_video_id}`,
        embedUrl: `https://www.youtube.com/embed/${post.youtube_video_id}`,
        publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
    } : post.video_url ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: post.title,
        description: post.meta_description || post.title,
        thumbnailUrl: post.image_url || `${brand.baseUrl}/api/og`,
        uploadDate: post.publish_date || post.created_at,
        contentUrl: post.video_url,
        publisher: { '@type': 'Organization', name: brand.name, url: brand.baseUrl },
    } : null;

    // B45: the donor board's slug-keyed FAQ and HowTo maps were removed; a
    // hardcoded FAQ map and a HowTo branch keyed to a donor slug pattern
    // could only ever emit fabricated schema. FAQ data comes ONLY from
    // post.faq_json, and the one HowTo (LIC-L4) comes from
    // buildLicenseGuideHowTo above, which derives from the same steps array
    // the visible "How to apply" list renders.
    const faqQuestions = (post.faq_json && post.faq_json.length > 0)
        ? post.faq_json
        : null;
    const faqSchema = faqQuestions ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqQuestions.map((q) => ({
            '@type': 'Question',
            name: q.name,
            acceptedAnswer: {
                '@type': 'Answer',
                text: q.text,
            },
        })),
    } : null;

    return (
        <div className="ed-page">
            <EditorialStickyFix />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: toJsonLd(jsonLd) }}
            />
            {faqSchema && (
                <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLd(faqSchema) }} />
            )}
            {howTo && (
                <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLd(howTo) }} />
            )}
            {videoSchema && (
                <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLd(videoSchema) }} />
            )}
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: toJsonLd({
                '@context': 'https://schema.org', '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: brand.baseUrl },
                    { '@type': 'ListItem', position: 2, name: 'Blog', item: `${brand.baseUrl}/blog` },
                    { '@type': 'ListItem', position: 3, name: post.title, item: currentUrl },
                ],
            }) }} />

            {/* -- HERO -- */}
            <header className="ed-hero">
                <nav className="ed-breadcrumb">
                    <Link href="/">Home</Link>
                    <span className="ed-sep">/</span>
                    <Link href="/blog">Blog</Link>
                    <span className="ed-sep">/</span>
                    <span>{categoryLabel}</span>
                </nav>
                <div className="ed-hero-grid">
                    <div className="ed-hero-main">
                        <h1 className="ed-title">{post.title}</h1>
                        {post.meta_description && (
                            <p className="ed-deck">{post.meta_description}</p>
                        )}
                        <div className="ed-hero-meta">
                            <div>
                                <label>Published</label>
                                <strong>{formatDate(post.publish_date || post.created_at)}</strong>
                            </div>
                            <div>
                                <label>Read Time</label>
                                <strong>{readTime}</strong>
                            </div>
                            {(post.reviewed_at || post.updated_at) && (
                                <div>
                                    <label>Last Reviewed</label>
                                    {/* Same date the BlogPosting.dateModified schema
                                        emits — real editorial timestamps only. */}
                                    <strong>{formatDate(post.reviewed_at || post.updated_at)}</strong>
                                </div>
                            )}
                            <div>
                                <label>Category</label>
                                <strong>{categoryLabel}</strong>
                            </div>
                        </div>
                        {/* P1 #8: visible byline. Renders for every post —
                            generic and license-guide branches alike — but
                            the license-guide series is machine-generated
                            from repo data and no human read it, so it gets
                            the generated-content byline instead of an
                            editorial-review claim (licenseSlugMatch, ~line
                            104). A named credentialed reviewer, once
                            contracted, supersedes both. */}
                        <EditorialByline variant="hero" generated={Boolean(licenseSlugMatch)} />
                    </div>
                    <div className="ed-hero-side">
                        {/* Hero is the LCP element on virtually every post page.
                            Using Next/Image with priority + fill applies image
                            optimization (AVIF/WebP transcoding, responsive
                            srcset, fetchpriority="high") and emits a preload
                            link in the <head>. Previous CSS background-image
                            approach shipped the source bytes verbatim with no
                            preload — measurably worse LCP on mobile. The
                            decorative-pattern CSS fallback (.ed-hero-photo
                            ::after gradient) still applies when image_url is
                            null because the wrapper retains the class. */}
                        <div
                            className={`ed-hero-photo${post.image_url ? ' ed-hero-photo--has-image' : ''}`}
                            style={{ position: 'relative' }}
                        >
                            {post.image_url && (
                                <Image
                                    src={post.image_url}
                                    alt={post.title}
                                    fill
                                    priority
                                    sizes="(max-width: 900px) 100vw, 45vw"
                                    style={{ objectFit: 'cover', objectPosition: 'center' }}
                                />
                            )}
                            <div className="ed-hero-photo-caption">
                                <strong>{categoryLabel}</strong>
                                <span>{formatDate(post.publish_date || post.created_at)}</span>
                            </div>
                            {post.video_url && (
                                <VideoLightbox videoUrl={post.video_url} title={post.title} />
                            )}
                        </div>


                    </div>
                </div>
            </header>


            {/* -- THREE-COLUMN LAYOUT -- */}
            <div className="ed-layout">
                {/* Left rail - Sticky TOC */}
                <aside className="ed-col-left">
                    <EditorialTOC headings={headings} readTime={readTime} wordCount={wordCount} />
                </aside>

                {/* Center - Article prose. Wrapper is a div, not <main>: the
                    site-wide <main id="main-content"> already wraps everything
                    in MainContent.tsx, and the <article> below is the semantic
                    landmark for this page's content. Nested <main> is invalid
                    HTML and confuses Google's main-content extractor. */}
                <div className="ed-col-center">
                    <article>
                        {/* Key Takeaways injected into contentHtml before first <h2> — see line ~115 */}
                        <div
                            className="editorial-prose"
                            dangerouslySetInnerHTML={{ __html: contentHtml }}
                        />
                    </article>

                    {/* Share row */}
                    <EditorialShare title={post.title} url={currentUrl} />


                    {/* SEO Fix C1 + P1 #8: the author card names the publishing
                        organization; the EditorialByline inside it renders the
                        review status straight from brand.editorial.reviewer
                        (config/brand.ts) — the editorial team + policy link
                        while that config is null, the real named credentialed
                        reviewer once contracted. Fake credentials are never
                        rendered because the byline and the schema derive from
                        the same config object. */}
                    <div className="ed-author">
                        {/* Brand initial. */}
                        <div className="ed-author-avatar" aria-hidden="true">{brand.name.charAt(0)}</div>
                        <div>
                            <div className="ed-author-role">Published by</div>
                            <h4 className="ed-author-name">{brand.name}</h4>
                            <p className="ed-author-bio">{brand.name} is a job board for {brand.niche.descriptor}s, operated by {brand.legal.entityName}. This article is editorial commentary aggregated from public sources and is not medical advice.</p>
                            <EditorialByline generated={Boolean(licenseSlugMatch)} />
                            {/* B54: the always-current "Updated {currentYear}" badge
                                fabricated freshness on every render. Show the real
                                editorial date instead (same source as the schema's
                                dateModified), or nothing when none exists. */}
                            {(post.reviewed_at || post.updated_at) && (
                                <div className="ed-author-badges">
                                    <span className="ed-author-badge">Updated {formatDate(post.reviewed_at || post.updated_at)}</span>
                                </div>
                            )}
                        </div>
                        <Link href="/editorial-policy" className="ed-author-link">
                            Editorial Policy <ArrowRight size={14} />
                        </Link>
                    </div>

                    {/* SEO Fix H13: medical disclaimer (YMYL).
                        Required because PMHNP content discusses clinical scope,
                        prescribing, and licensure. Without this, Google's quality
                        raters can flag posts as offering medical advice. */}
                    <aside
                        role="note"
                        aria-label="Editorial disclaimer"
                        style={{
                            marginTop: '32px',
                            padding: '16px 20px',
                            background: 'rgba(232,108,44,0.06)',
                            border: '1px solid rgba(232,108,44,0.18)',
                            borderLeft: '3px solid #E86C2C',
                            borderRadius: '6px',
                            fontSize: '13px',
                            lineHeight: 1.6,
                            color: '#5A4A42',
                        }}
                    >
                        <strong style={{ display: 'block', marginBottom: '4px', color: '#1A2E35' }}>Editorial note</strong>
                        This article is for informational purposes only and is not medical, clinical, legal, or financial advice. Always consult a licensed clinician, your state board of nursing, or a qualified professional for individual care, licensure, or career decisions. {brand.name} is a job board operated by {brand.legal.entityName} and is not a medical, regulatory, or licensing authority.
                    </aside>
                </div>

                {/* Right rail - Toolbar + Newsletter */}
                <aside className="ed-col-right">
                    <EditorialToolbar slug={slug} title={post.title} url={currentUrl} />
                </aside>
            </div>

            {/* -- LICENSE GUIDE: nearby states (LIC-L2) and market snapshot (LIC-L3),
                clay bands matching the host page -- */}
            {license && (
                <LicenseGuideBands
                    env={license.env}
                    nearby={license.nearby}
                    facts={license.facts}
                    salary={license.salary}
                    salaryGuideIndexable={license.salaryGuideIndexable}
                />
            )}

            {/* -- READ NEXT -- */}
            {relatedPosts.length > 0 && (
                <section className="ed-read-next">
                    <div className="ed-read-next-header">
                        <h2 className="ed-read-next-title">Read <em>Next</em></h2>
                        <Link href="/blog" className="ed-read-next-all">All Articles &rarr;</Link>
                    </div>
                    <div className="ed-read-next-grid">
                        {relatedPosts.slice(0, 3).map((relPost, idx) => {
                            const relLabel = BLOG_CATEGORIES.find((c) => c.id === relPost.category)?.label || relPost.category;
                            return (
                                <Link key={relPost.slug} href={`/blog/${relPost.slug}`} className={`ed-next-card ${idx === 0 ? 'ed-next-card-featured' : ''}`}>
                                    <div
                                        className="ed-next-card-img"
                                        style={relPost.image_url ? { backgroundImage: `url(${relPost.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                                    />
                                    <div className="ed-next-card-meta">
                                        <span className="ed-next-card-cat">{relLabel}</span>
                                    </div>
                                    <h3 className="ed-next-card-title">{relPost.title}</h3>
                                    {idx === 0 && relPost.meta_description && (
                                        <p className="ed-next-card-desc">{relPost.meta_description}</p>
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* ══ CONTEXTUAL pSEO LINKS (Phase 7.5) ══
                License guides link only pages that render or index (spec4 B2);
                career posts get category links matched on their copy. */}
            <div className="ed-jobs-cta" style={{ textAlign: 'center' }}>
                <p className="ed-jobs-cta-text" style={{ marginBottom: '12px' }}>{jobsCta.intro}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                    {jobsCta.links.map((l) => (
                        <Link key={l.href} href={l.href} className="ed-jobs-cta-link" style={l.primary ? CTA_PRIMARY_STYLE : CTA_SECONDARY_STYLE}>
                            {l.label} →
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}

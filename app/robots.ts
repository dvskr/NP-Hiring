import { brand } from '@/config/brand'
import { MetadataRoute } from 'next'

// Opt out of build-time prerender so robots.txt regenerates on every request.
// Diagnosed 2026-05-10 (issue #162): the d916ec2 Crawl-delay directives were
// silently absent from the live /robots.txt while the same code emitted them
// locally. Root cause: Next.js 16 was serving a build-time-frozen prerender
// artifact even after redeploys, because the build hash never invalidated.
// vercel.json already pins /robots.txt to s-maxage=86400, so the CDN still
// serves cached responses — this just guarantees the function runs on cache
// fills against the latest source.
export const dynamic = 'force-dynamic'

// ── Account pages stay crawlable (indexing audit TECH-05, fixSoon 9) ─────
// /signup, /login, /messages, /saved, /job-alerts/manage and /employer/login
// are NOT disallowed for search and AI crawlers. Each answers noindex (its
// metadata robots, plus the X-Robots-Tag the middleware sets on these paths),
// and a crawler can only obey a noindex it is allowed to fetch. Google says a
// robots.txt-blocked URL "can still appear in search results, for example if
// other pages link to it", and /saved and /messages are linked from every
// page (header, bottom nav, footer), so blocking them is what produced
// "Indexed, though blocked by robots.txt" for these URLs before (GSC P2.3).
// A 2026-06 change re-blocked them after a dated window (AUTH_REBLOCK_DATE);
// that re-block is removed for good. /job-alerts/manage reads its alert
// through /api/job-alerts, which stays blocked, so a crawler that fetches a
// manage link sees only the noindexed shell. Social preview bots, which do
// not read X-Robots-Tag and would only render a login shell, still skip all
// six (SOCIAL_DISALLOW). Pinned by tests/seo/sitemap-budget.test.ts.

// ── Allow lists ──────────────────────────────────────────────────────
// Public surfaces every legitimate crawler should be able to index.
// Carve-outs from FULL_DISALLOW. RFC 9309 + Google's parser apply
// "longest match wins, Allow wins ties," so listing these explicitly lets
// crawlers reach /api/sitemaps/* and /api/og/* even though /api/ is
// disallowed below. All other public surfaces (/, /jobs, /blog, /companies,
// /salary-guide, /about, /contact, /pricing, /faq, /post-job, /resources,
// /job-alerts, /for-job-seekers, /for-employers) are implicitly allowed
// because no Disallow rule matches them — no need to enumerate.
const PUBLIC_ALLOW = [
  // No trailing slash on /api/sitemaps so the rule matches both
  // /api/sitemaps/index and /api/sitemaps/cities/N — the previous trailing
  // slash form excluded the bare /api/sitemaps with some strict parsers.
  '/api/sitemaps',
  '/api/og',
]

// ── Disallow lists ───────────────────────────────────────────────────
// Full disallow list — applied to `*` AND every named AI/search crawler.
// Token-based URLs (edit, checkout, unsubscribe, password reset) must never
// be crawled or trained on. Internal Next.js data routes too. The account
// pages above are deliberately absent (TECH-05).
const FULL_DISALLOW = [
  // Block all other API routes. The /api/sitemaps/ and /api/og allows in
  // PUBLIC_ALLOW above carve out the public sub-routes; everything else
  // under /api/ is blocked here. The previous list emitted dead lines for
  // /api/cron/, /api/webhooks/, /api/admin/ — they were already covered
  // by /api/ across all 21 named-crawler rule blocks, just adding noise.
  '/api/',
  // Internal Next.js client-side navigation data (allow /_next/static/ for JS/CSS)
  '/_next/data/',
  // Token-bearing URLs — must not be indexed (these are SAFE to keep blocked
  // because they require tokens that Google has never seen)
  '/jobs/edit/',
  '/post-job/checkout',
  '/post-job/preview',
  '/job-alerts/unsubscribe',
  '/email-preferences',
  '/unsubscribe',
  '/reset-password',
  '/forgot-password',
  // Auth & user-private surfaces. Path prefixes WITHOUT trailing slashes
  // so they match both the bare URL (e.g. /dashboard, served by
  // app/dashboard/page.tsx) AND child paths (/dashboard/foo). Robots.txt
  // does prefix matching: `/dashboard/` only matches /dashboard/* — not
  // the bare /dashboard. Most of these have a real page at the bare URL
  // so dropping the trailing slash plugs a coverage gap.
  '/employer/dashboard',
  '/employer/candidates',
  '/employer/applicants',
  '/employer/analytics',
  '/employer/talent-search',
  '/employer/renewal-success',
  '/employer/settings',
  '/employer/signup',
  '/admin',
  '/dashboard',
  '/auth',
  '/onboarding',
  '/settings',
  '/my-applications',
  '/unauthorized',
  '/success',
  // Raw media assets (sitemap exposes the indexable ones)
  '/videos/',
]

// Lighter disallow for social/link-preview bots — they only fetch the
// exact URL shared, so they need access to almost everything that isn't
// pure infrastructure. Auth-gated surfaces extended (audit 01 M-2):
// when a user shares a link to a protected page the bot fetches it,
// receives a login shell, and generates a broken preview card — better
// to refuse the fetch outright. Path prefixes match the FULL_DISALLOW
// convention (no trailing slash → covers bare + child paths).
//
// Note on /login, /signup, /employer/login, /saved, /messages,
// /job-alerts/manage: crawlable for search crawlers on purpose (TECH-05,
// above) so they can read the noindex. Social bots don't honor
// X-Robots-Tag — they just render whatever HTML they fetch, which for these
// paths is a login shell. Blocking them HERE (but not for Googlebot) keeps
// preview cards useful without re-trapping Googlebot in the
// "Indexed, though blocked by robots.txt" state.
const SOCIAL_DISALLOW = [
  // Blocks infrastructure API routes — but the social-bot rule block
  // below MUST pair this with the PUBLIC_ALLOW carve-outs so /api/og
  // (every og:image on the site) out-matches this prefix. See the rule
  // block comment before it's tempted back to a bare `allow: '/'`.
  '/api/',
  '/admin',
  '/dashboard',
  '/auth',
  '/onboarding',
  '/employer/dashboard',
  '/employer/candidates',
  '/employer/applicants',
  '/employer/analytics',
  '/employer/talent-search',
  '/employer/settings',
  '/employer/login',
  '/settings',
  '/my-applications',
  '/saved',
  '/messages',
  '/login',
  '/signup',
  '/job-alerts/manage',
]

// ── Crawler rosters ──────────────────────────────────────────────────
// AI / LLM / search-AI crawlers all get the FULL disallow list.
const AI_CRAWLERS = [
  'OAI-SearchBot',     // OpenAI search index
  'GPTBot',            // OpenAI training
  'ChatGPT-User',      // ChatGPT live browsing
  'PerplexityBot',     // Perplexity index
  // ClaudeBot moved to a dedicated rule block below with explicit Allow: /
  // — Anthropic's fetcher was reading this group's bulk Disallow list and
  // treating the entire site as off-limits (no explicit Allow: / line to
  // disambiguate). 'anthropic-ai' (legacy UA) and 'Claude-Web' stay here.
  'anthropic-ai',      // Anthropic crawler (legacy UA)
  'Claude-Web',        // Claude.ai web fetcher
  'Google-Extended',   // Google AI/Gemini training
  'Bytespider',        // ByteDance / TikTok AI
  'CCBot',             // Common Crawl
  'cohere-ai',         // Cohere crawler
  'Diffbot',           // Diffbot AI
  'YouBot',            // You.com
  'Amazonbot',         // Amazon AI
  'meta-externalagent', // Meta AI
  'Applebot-Extended', // Apple Intelligence training
  // Newer 2025-2026 crawlers picked up since the original list was set —
  // each was active in production logs but had no entry, falling through
  // to the catch-all '*' rule (no crawl-delay, no per-bot throttle).
  'MistralAI-User',    // Mistral AI live browsing
  'AI2Bot',            // Allen Institute for AI
  'iaskspider',        // iAsk.AI
  'Kangaroo',          // Jina AI Reader
  'Timpibot',          // Timpi search index
  'img2dataset',       // Hugging Face dataset crawler
] as const

const SOCIAL_BOTS = [
  'Twitterbot',
  'facebookexternalhit',
  'LinkedInBot',
  'Pinterest',
  'Slackbot',
  'WhatsApp',
  'Discordbot',
  'TelegramBot',
  'redditbot',
] as const

// SEO link-graph crawlers. Allowed to crawl the public site so backlink
// data / domain authority reports stay current. The previous Crawl-Delay
// throttle (10s, ~360 pages/hr) was removed 2026-05-11 in favor of
// max-SEO posture — Vercel bandwidth headroom is fine and these crawlers
// indirectly feed third-party SEO tools the user base uses to evaluate
// the site.
const SEO_CRAWLERS = [
  'AhrefsBot',
  'SemrushBot',
  'MJ12bot',
  'DotBot',
  'PetalBot',
  'YandexBot',
] as const

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || brand.baseUrl

  return {
    rules: [
      // ── ClaudeBot — dedicated rule with EXPLICIT `Allow: /` ─────────
      // 2026-05-11: Anthropic's fetcher was reading the AI-bot group's
      // bulk Disallow list and treating the entire site as disallowed,
      // because there was no explicit `Allow: /` to disambiguate.
      // RFC 9309 specifies longest-match-wins, but real-world parsers
      // (including Anthropic's) often fall back to conservative
      // interpretation when no positive Allow rule is present.
      //
      // Fix: dedicate a rule block to ClaudeBot with an explicit Allow,
      // followed by a tight disallow list covering only the auth-private
      // surfaces. Placed FIRST in the rules array so any parser scanning
      // top-down sees it before the catch-all `*`.
      {
        userAgent: 'ClaudeBot',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/dashboard',
          '/auth',
          '/onboarding',
          '/employer/dashboard',
          '/employer/candidates',
          '/employer/applicants',
          '/employer/analytics',
          '/employer/talent-search',
          '/employer/settings',
          '/settings',
          '/my-applications',
        ],
      },
      // Catch-all rule (Googlebot, Bingbot, anyone unlisted). Implicit
      // "Allow: /" semantics — everything not matched by a Disallow is
      // crawlable. Carve-outs (/api/sitemaps, /api/og) win over the
      // /api/ Disallow because they're more specific paths.
      {
        userAgent: '*',
        allow: PUBLIC_ALLOW,
        disallow: FULL_DISALLOW,
      },
      // AI search & LLM crawlers grouped into one block. Named explicitly
      // (rather than letting them fall through to the catch-all) so the
      // signal "we welcome these crawlers" is unmistakable to AI tools
      // that scan robots.txt for per-bot rules. Same disallow list as
      // the catch-all — no throttle, full public coverage.
      //
      // Explicit `Allow: /` (2026-07-18, audit B46): the ClaudeBot
      // incident above proved that real-world AI-crawler parsers fall
      // back to a conservative "everything disallowed" reading when a
      // named rule block has Disallow lines but no positive Allow rule.
      // Every named AI bot gets the same explicit root Allow so none of
      // them can misread the bulk disallow list as a site-wide block.
      {
        userAgent: [...AI_CRAWLERS],
        allow: ['/', ...PUBLIC_ALLOW],
        disallow: FULL_DISALLOW,
      },
      // SEO link-graph crawlers grouped. Same posture: explicit allow
      // for max backlink-graph coverage so Ahrefs/Semrush/etc. can keep
      // domain authority data current. Crawl-Delay throttle removed
      // 2026-05-11 — max SEO across all bots.
      {
        userAgent: [...SEO_CRAWLERS],
        allow: PUBLIC_ALLOW,
        disallow: FULL_DISALLOW,
      },
      // Social / link-preview bots grouped — fetch a single URL on
      // demand for the preview card, so they need access to almost
      // everything public; the lighter SOCIAL_DISALLOW just keeps
      // them out of auth-gated surfaces where the preview would be
      // a login shell anyway.
      //
      // PUBLIC_ALLOW carve-out (2026-07-28, P0 #1 hardening): the bare
      // `allow: '/'` lost to SOCIAL_DISALLOW's `/api/` under RFC 9309
      // longest-match-wins, so the very crawlers that render share cards
      // (Twitterbot, LinkedInBot, Slackbot, facebookexternalhit) were
      // disallowed from fetching the /api/og images every og:image tag
      // now points at. Well-behaved preview bots honor robots.txt for
      // og:image fetches, so cards rendered without images. /api/og must
      // out-match /api/ here just like it does in the `*` rule.
      {
        userAgent: [...SOCIAL_BOTS],
        allow: ['/', ...PUBLIC_ALLOW],
        disallow: SOCIAL_DISALLOW,
      },
    ],
    // One entry point (indexing audit FB-4, CS-07, CS-08, TECH-01, TECH-11):
    // the sitemap index, which lists /sitemap.xml, the cities batches and the
    // job batches. /sitemap.xml is not listed again (the same file twice),
    // the retired /image-sitemap.xml (ungated: noindex and 404 pages) is
    // gone, and the empty /video-sitemap.xml stays unlisted until a page
    // whose main content is a video exists. Search Console counts every
    // sitemap named here as submitted.
    sitemap: [
      `${baseUrl}/api/sitemaps/index`,
    ],
  }
}

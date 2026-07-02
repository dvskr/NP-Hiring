/**
 * Niche copy pack — short, niche-flavored copy fragments rendered VERBATIM
 * on high-traffic surfaces (email chrome, OG images, social posts, the
 * brand wordmark). This file is DATA ONLY: it holds the strings that
 * config/brand.ts deliberately does not (brand.ts is identity — name,
 * domain, legal, inboxes; this file is flavor — taglines, claims,
 * hashtags, wordmark shape).
 *
 * ── FOR FORKS ─────────────────────────────────────────────────────────
 * Every export below is a per-board editorial decision. Rewrite each one
 * for the new niche — do NOT keep the PMHNP values. Each export's doc
 * comment says exactly where it renders so you can eyeball the result.
 */

/**
 * Uppercase micro-tagline rendered under the brand name in the email
 * header chrome. Renders in lib/email-templates-v2.ts — both the standard
 * peach header (headerBlockV2) and the amber warning header (amberHeaderV2).
 * Styled `text-transform: uppercase` at the render site, so write it in
 * Title Case here.
 *
 * FORK NOTE: describe the niche's career category in two or three words
 * (e.g. 'Mental Health Careers' → 'Travel Nursing Careers').
 */
export const EMAIL_HEADER_TAGLINE = 'Mental Health Careers';

/**
 * Default inbox-preview preheader — the hidden first line email clients
 * show next to the subject. Used by lib/email-templates-v2.ts
 * (emailShellV2) whenever a template doesn't pass its own preheader.
 *
 * FORK NOTE: embeds the brand name and the niche's long descriptor, and
 * makes a '#1 job board' claim — re-author the whole sentence per board.
 */
export const EMAIL_DEFAULT_PREHEADER =
    'PMHNP Hiring — The #1 job board for Psychiatric Mental Health Nurse Practitioners';

/**
 * Curated niche hashtag set appended to every Facebook/Instagram caption
 * by lib/social-post-generator.ts (joined with single spaces).
 *
 * FORK NOTE: research the new niche's active hashtag community before
 * swapping these — dead hashtags cost reach. Keep the mix: role tags,
 * specialty tags, and generic hiring tags.
 */
export const SOCIAL_HASHTAGS = [
    '#PMHNP',
    '#NursePractitioner',
    '#MentalHealth',
    '#NurseJobs',
    '#PsychiatricNursing',
    '#Hiring',
    '#HealthcareJobs',
    '#NursingJobs',
] as const;

/**
 * Marketing headline on the homepage OG image (app/api/og/route.tsx).
 * Renders twice: as the big homepage-card headline and as the small
 * bottom-bar tagline on page/category OG cards.
 *
 * FORK NOTE: this is a '#1' MARKETING CLAIM. It MUST be re-authored per
 * board — do not ship an unsubstantiated superlative for a new niche.
 */
export const OG_HOMEPAGE_HEADLINE = 'The #1 PMHNP Job Board';

/**
 * Supporting sentence under the homepage OG headline
 * (app/api/og/route.tsx). Rendered as a JSX expression, so use plain
 * characters here ('&'), not HTML entities.
 *
 * FORK NOTE: re-author per board; mention the niche's differentiator
 * (here: salary transparency + remote/in-person mix).
 */
export const OG_HOMEPAGE_SUBHEADLINE =
    'Find psychiatric nurse practitioner jobs with salary transparency. Remote & in-person positions updated daily.';

/**
 * Stats row along the bottom of the homepage OG image
 * (app/api/og/route.tsx).
 *
 * FORK NOTE: these numbers are HARDCODED MARKETING CLAIMS, not live
 * counts. They MUST be re-authored per board (a new board has 0 jobs on
 * day one) and should ideally be made data-driven later — the cached
 * counters in lib/site-stats.ts already exist for exactly this kind of
 * number.
 */
export const OG_HOMEPAGE_STATS = [
    { number: '10,000+', label: 'PMHNP Jobs' },
    { number: '3,000+', label: 'Companies' },
    { number: '50', label: 'States' },
] as const;

/**
 * Split two-tone brand wordmark: `primary` renders in the base ink color,
 * `accent` renders italic in the brand teal. Render sites:
 *   - components/Header.tsx (site-wide navbar wordmark)
 *   - app/widget/route.ts   (.pd-brand-mark — embed widget header AND its
 *     error shell)
 *
 * FORK NOTE: a fork with a different name shape (one word, three words,
 * accent-first) edits this object once; the render sites just place the
 * two parts. If the new name doesn't split naturally, put the whole name
 * in `primary` and leave `accent` as ''.
 */
export const WORDMARK = { primary: 'PMHNP', accent: 'Hiring' } as const;

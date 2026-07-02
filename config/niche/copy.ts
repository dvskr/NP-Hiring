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
 * for the new niche — do NOT keep another board's values. Each export's
 * doc comment says exactly where it renders so you can eyeball the result.
 *
 * NP HIRING (this board): values below were ported 2026-07-02 from the
 * hand-forked NP donor board (nphiring.com fork of pmhnphiring.com).
 * Where the donor's own fork was incomplete (it left PMHNP leftovers in
 * email/OG chrome), the strings were re-authored to the donor's clear
 * NP-wide editorial direction (see its about/faq/feed pages: "The #1
 * Nurse Practitioner Job Board").
 */

/**
 * Uppercase micro-tagline rendered under the brand name in the email
 * header chrome. Renders in lib/email-templates-v2.ts — both the standard
 * peach header (headerBlockV2) and the amber warning header (amberHeaderV2).
 * Styled `text-transform: uppercase` at the render site, so write it in
 * Title Case here.
 *
 * FORK NOTE: describe the niche's career category in two or three words.
 * (Donor's email header still carried the leftover 'Mental Health
 * Careers' — corrected here to the NP-wide descriptor.)
 */
export const EMAIL_HEADER_TAGLINE = 'Nurse Practitioner Careers';

/**
 * Default inbox-preview preheader — the hidden first line email clients
 * show next to the subject. Used by lib/email-templates-v2.ts
 * (emailShellV2) whenever a template doesn't pass its own preheader.
 *
 * FORK NOTE: embeds the brand name and the niche's long descriptor, and
 * makes a '#1 job board' claim — re-author the whole sentence per board.
 * (Donor shape: 'NP Hiring — The #1 job board for …'; its descriptor was
 * an unforked PMHNP leftover, corrected here to the NP cohort.)
 */
export const EMAIL_DEFAULT_PREHEADER =
    'NP Hiring — The #1 job board for Nurse Practitioners';

/**
 * Curated niche hashtag set appended to every Facebook/Instagram caption
 * by lib/social-post-generator.ts (joined with single spaces).
 *
 * FORK NOTE: research the new niche's active hashtag community before
 * swapping these — dead hashtags cost reach. Keep the mix: role tags,
 * specialty tags, and generic hiring tags. (The donor's set was still
 * PMHNP-led; this set targets the NP-wide community: role tags
 * #NursePractitioner/#APRN/#FNP, job tags #NPJobs/#NurseJobs, and
 * generic hiring tags.)
 */
export const SOCIAL_HASHTAGS = [
    '#NursePractitioner',
    '#NPJobs',
    '#APRN',
    '#FNP',
    '#NurseJobs',
    '#Hiring',
    '#HealthcareJobs',
] as const;

/**
 * Marketing headline on the homepage OG image (app/api/og/route.tsx).
 * Renders twice: as the big homepage-card headline and as the small
 * bottom-bar tagline on page/category OG cards.
 *
 * FORK NOTE: this is a '#1' MARKETING CLAIM. It MUST be re-authored per
 * board — do not ship an unsubstantiated superlative for a new niche.
 * (Wording mirrors the donor board's NP-wide title decision used across
 * its about page, FAQ, and RSS feeds.)
 */
export const OG_HOMEPAGE_HEADLINE = 'The #1 Nurse Practitioner Job Board';

/**
 * Supporting sentence under the homepage OG headline
 * (app/api/og/route.tsx). Rendered as a JSX expression, so use plain
 * characters here ('&'), not HTML entities.
 *
 * FORK NOTE: re-author per board; mention the niche's differentiator
 * (here: salary transparency + remote/in-person mix).
 */
export const OG_HOMEPAGE_SUBHEADLINE =
    'Find nurse practitioner jobs with salary transparency. Remote & in-person positions updated daily.';

/**
 * Stats row along the bottom of the homepage OG image
 * (app/api/og/route.tsx).
 *
 * FORK NOTE: these numbers are HARDCODED MARKETING CLAIMS, not live
 * counts. They MUST be honest per board.
 *
 * ⚠️ UPDATE AS INVENTORY GROWS: the values below are HONEST DAY-ONE
 * numbers for this board's launch (335 NP jobs from the initial ATS
 * smoke ingest; 8 active ATS sources — Greenhouse, Lever, Workday,
 * SmartRecruiters, Ashby, BambooHR, JazzHR, Workable). Revisit after
 * every meaningful inventory jump — a stale small number undersells,
 * an inflated one ('10,000+') is a false claim. Ideally make these
 * data-driven from the cached counters in lib/site-stats.ts.
 */
export const OG_HOMEPAGE_STATS = [
    { number: '335+', label: 'NP Jobs' },
    { number: '8', label: 'ATS Sources' },
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
export const WORDMARK = { primary: 'NP', accent: 'Hiring' } as const;

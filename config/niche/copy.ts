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
 * NP-wide editorial direction.
 *
 * RULE: no ranking or superlative claim (first place, largest, leading,
 * best). Nothing in the repo measures one, and these strings ship to
 * search results, share cards, structured data and inboxes (indexing audit
 * M-08). Describe what the board is and where its listings come from.
 */

/**
 * The board in one factual sentence. Renders as the Organization
 * `description` in the site-wide JSON-LD and the default og:description
 * (app/layout.tsx), in the /about metadata, and in the blog RSS channel
 * description (app/blog/feed.xml/route.ts). It is the sentence that replaced
 * the old first-place job board claim everywhere.
 *
 * FORK NOTE: re-author per board. Keep it verifiable: say what is listed,
 * where the listings come from, and how often they refresh.
 */
export const BOARD_DESCRIPTION =
    "A job board for nurse practitioners, with listings from employers' own career sites and direct employer posts, updated daily.";

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
 * FORK NOTE: embeds the brand name and the niche's long descriptor, so
 * re-author the whole sentence per board. The donor sentence made a
 * first-place ranking claim; it was replaced with what the board actually
 * does (see the RULE in the header).
 */
export const EMAIL_DEFAULT_PREHEADER =
    "NP Hiring: nurse practitioner jobs from employers' own career sites, updated daily";

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
 * FORK NOTE: re-author per board, and keep it a description rather than a
 * ranking. The donor headline claimed first place among nurse practitioner
 * job boards, an unsubstantiated superlative on every homepage share card
 * (indexing audit M-08).
 */
export const OG_HOMEPAGE_HEADLINE = 'Nurse Practitioner Jobs, Updated Daily';

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
 * RULE: NO inventory counts here. OG images are CDN-cached for 30 days,
 * so a hardcoded job count goes stale immediately (this file said '335+'
 * while the DB held 900+ within days of ingestion starting). Evergreen
 * claims only (price, cadence, configured sources); for live counts, wire
 * lib/site-stats.ts cached counters into the OG route instead.
 *
 * State coverage is an inventory count, not an evergreen claim: this row
 * said '50 States Covered' while the live board listed jobs in 44 states
 * (indexing audit M-08). /about and /for-programs render the measured
 * figure from lib/states-covered.ts instead.
 *
 * '8 ATS Sources' is the scheduled source count in config/cron-schedule.ts
 * (every registry source not in DISABLED_SOURCES). Change it with that file.
 */
export const OG_HOMEPAGE_STATS = [
    { number: 'Free', label: 'For Job Seekers' },
    { number: '8', label: 'ATS Sources' },
    { number: 'Daily', label: 'Job Updates' },
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

/**
 * Published platform caps the kit fits its posts to, and what the page says
 * when a description was cut to fit. Data only, so the page's client
 * components and the server-side post builder (lib/social-kit/posts.ts) read
 * the same numbers. Facebook (63,206) and forums never bind for a job post.
 */

export const LINKEDIN_POST_LIMIT = 3000
export const REDDIT_TITLE_LIMIT = 300
export const REDDIT_BODY_LIMIT = 40000
/** Counted the way X counts: every link as 23, wide characters as 2. */
export const X_POST_LIMIT = 280

const thousands = (value: number): string => value.toLocaleString('en-US')

export const LINKEDIN_LIMIT_NOTE = `LinkedIn caps posts at ${thousands(LINKEDIN_POST_LIMIT)} characters, so the description stops at a section break and the post links to the rest.`

export const REDDIT_LIMIT_NOTE = `Reddit caps posts at ${thousands(REDDIT_BODY_LIMIT)} characters, so the description stops at a section break and the post links to the rest.`

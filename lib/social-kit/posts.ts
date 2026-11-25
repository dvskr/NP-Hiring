import { brand } from '@/config/brand'
import { STATE_CODE_TO_NAME } from '@/lib/us-states'
import { jobLinkPath } from '@/lib/shortlinks/job-links'
import type { JdBlock } from '@/lib/jd-blocks'
import { buildPostFacts, factLines, type FactLine, type PostFacts } from './facts'
import {
  blocksToMarkdown,
  blocksToPlainText,
  descriptionBlocks,
  escapeMarkdown,
  fitBlocks,
  replaceDashes,
} from './jd-text'
import { LINKEDIN_POST_LIMIT, REDDIT_BODY_LIMIT, REDDIT_TITLE_LIMIT, X_POST_LIMIT } from './limits'
import { PLATFORM_LABEL, PLATFORM_LETTER } from './platforms'
import type { PostPart, SocialKitEntry, SocialKitJob, SocialPlatform, SocialPost } from './types'

export { FORUM_LABEL, PLATFORM_LABEL, PLATFORM_LETTER } from './platforms'
export { LINKEDIN_POST_LIMIT, REDDIT_BODY_LIMIT, REDDIT_TITLE_LIMIT, X_POST_LIMIT } from './limits'

/**
 * Ready-to-paste posts for one live employer job, one per platform.
 *
 * Every post carries its own short link (/r/<letter><job id prefix>), so a
 * click is logged server-side with the platform it came from. Copy speaks as
 * the board (config/brand.ts), names no person, uses no emoji, and has no
 * dashes: everything passes through replaceDashes before it is measured, so
 * the lengths shown are the lengths that get pasted.
 */

/** X counts every link as 23 characters, whatever its real length. */
const X_URL_WEIGHT = 23
const URL_IN_TEXT = /https?:\/\/\S+/g
const NEW_POST_WINDOW_MS = 48 * 60 * 60 * 1000

/** A hashtag from brand words: "Nurse Practitioner" becomes "#NursePractitioner". */
function brandTag(words: string): string {
  return `#${words.replace(/[^A-Za-z0-9]/g, '')}`
}

/** "#NursePractitioner" and "#NPJobs", from config/brand.ts. */
const ROLE_TAG = brandTag(brand.niche.long)
const JOBS_TAG = brandTag(`${brand.niche.short}Jobs`)

const LINKEDIN_TAGS: readonly string[] = Object.freeze([ROLE_TAG, JOBS_TAG, '#NowHiring', '#HealthcareJobs'])
const FACEBOOK_TAGS: readonly string[] = Object.freeze([ROLE_TAG, JOBS_TAG, '#NowHiring'])
const X_TAGS = `${JOBS_TAG} ${ROLE_TAG}`

/**
 * Said on Reddit and forum posts, where the account posting is not the
 * board's own page: the board posted it, and the employer listed with it.
 */
export const DISCLOSURE = `Posted by ${brand.name}, a job board for ${brand.niche.descriptor}s, where the employer listed this job.`

/** twitter-text weighting: Latin and common punctuation count 1, everything else 2. */
function isLightCodePoint(cp: number): boolean {
  return (
    cp <= 0x10ff ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
  )
}

export function xWeightedLength(text: string): number {
  let urls = 0
  const rest = text.replace(URL_IN_TEXT, () => {
    urls += 1
    return ''
  })
  let length = urls * X_URL_WEIGHT
  for (const ch of rest) length += isLightCodePoint(ch.codePointAt(0) ?? 0) ? 1 : 2
  return length
}

function part(label: string, text: string, limit: number | null, measure = (t: string) => t.length): PostPart {
  return Object.freeze({ label, text, limit, length: measure(text) })
}

function dashFreeBlocks(blocks: readonly JdBlock[]): JdBlock[] {
  return blocks.map((block): JdBlock =>
    block.kind === 'bullets'
      ? { kind: 'bullets', items: block.items.map(replaceDashes) }
      : { kind: block.kind, text: replaceDashes(block.text) },
  )
}

/** Shorten to `max` characters at a word boundary, with an ellipsis. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, Math.max(0, max - 1))
  const atWord = cut.replace(/\s+\S*$/, '')
  return `${(atWord.length > max / 2 ? atWord : cut).trimEnd()}…`
}

function stateHashtag(job: SocialKitJob): string | null {
  const name = job.stateCode ? STATE_CODE_TO_NAME[job.stateCode.toUpperCase()] : null
  return name ? `#${name.replace(/[^A-Za-z]/g, '')}Jobs` : null
}

function hashtags(base: readonly string[], job: SocialKitJob): string {
  const state = stateHashtag(job)
  return (state ? [...base, state] : base).join(' ')
}

interface PostContext {
  readonly job: SocialKitJob
  readonly title: string
  readonly employer: string
  readonly facts: PostFacts
  readonly lines: readonly FactLine[]
  readonly blocks: readonly JdBlock[]
  readonly linkFor: (platform: SocialPlatform) => string
}

interface BuiltPost {
  readonly parts: PostPart[]
  readonly trimmed: boolean
}

function plainFacts(lines: readonly FactLine[]): string {
  return lines.map((line) => `${line.label}: ${line.value}`).join('\n')
}

function joinSections(sections: readonly (string | null | false)[]): string {
  return sections.filter((s): s is string => !!s && s.trim().length > 0).join('\n\n')
}

function linkedInPost(ctx: PostContext): BuiltPost {
  const link = ctx.linkFor('linkedin')
  const head = joinSections([`Now hiring: ${ctx.title} at ${ctx.employer}`, plainFacts(ctx.lines)])
  const tags = hashtags(LINKEDIN_TAGS, ctx.job)
  const fullTail = joinSections([`Apply: ${link}`, tags])
  const cutTail = joinSections([`Read the full description and apply: ${link}`, tags])

  const full = joinSections([head, blocksToPlainText(ctx.blocks), fullTail])
  if (full.length <= LINKEDIN_POST_LIMIT) {
    return { parts: [part('Post', full, LINKEDIN_POST_LIMIT)], trimmed: false }
  }
  const budget = LINKEDIN_POST_LIMIT - head.length - cutTail.length - 4
  const fitted = fitBlocks(ctx.blocks, Math.max(0, budget), blocksToPlainText)
  const text = joinSections([head, blocksToPlainText(fitted.blocks), cutTail])
  return { parts: [part('Post', text, LINKEDIN_POST_LIMIT)], trimmed: true }
}

function facebookPost(ctx: PostContext): BuiltPost {
  const text = joinSections([
    `Now hiring: ${ctx.title} at ${ctx.employer}`,
    plainFacts(ctx.lines),
    blocksToPlainText(ctx.blocks),
    `Apply: ${ctx.linkFor('facebook')}`,
    hashtags(FACEBOOK_TAGS, ctx.job),
  ])
  return { parts: [part('Post', text, null)], trimmed: false }
}

function redditTitle(ctx: PostContext): string {
  const tail = [ctx.employer, ctx.facts.where, ctx.facts.pay].filter(Boolean).join(' | ')
  const roleRoom = Math.max(40, REDDIT_TITLE_LIMIT - tail.length - 13)
  return clip(`[Hiring] ${clip(ctx.title, roleRoom)} | ${tail}`, REDDIT_TITLE_LIMIT)
}

function redditPost(ctx: PostContext): BuiltPost {
  const title = redditTitle(ctx)
  const link = ctx.linkFor('reddit')
  const head = joinSections([
    `**${escapeMarkdown(ctx.employer)}** is hiring: **${escapeMarkdown(ctx.title)}**`,
    ctx.lines.map((line) => `* **${line.label}:** ${escapeMarkdown(line.value)}`).join('\n'),
  ])
  const tailBody = joinSections([`**Apply:** ${link}`, `*${DISCLOSURE}*`])

  const full = joinSections([head, blocksToMarkdown(ctx.blocks), tailBody])
  const fits = full.length <= REDDIT_BODY_LIMIT
  const fitted = fits
    ? { blocks: [...ctx.blocks], trimmed: false }
    : fitBlocks(ctx.blocks, REDDIT_BODY_LIMIT - head.length - tailBody.length - 4, blocksToMarkdown)
  const body = fits ? full : joinSections([head, blocksToMarkdown(fitted.blocks), tailBody])
  return {
    parts: [part('Title', title, REDDIT_TITLE_LIMIT), part('Body', body, REDDIT_BODY_LIMIT)],
    trimmed: fitted.trimmed,
  }
}

const X_MIN_CLIPPED = 24

/**
 * The X post, fitted to 280 as X counts it. The title gives way first, then
 * the employer name; the location, pay and link are never cut. Re-measured
 * after every cut because the ellipsis itself weighs 2.
 */
function xMainPost(ctx: PostContext, link: string): string {
  const build = (title: string, employer: string): string =>
    [
      `Now hiring: ${title}`,
      ctx.facts.where ? `${employer} · ${ctx.facts.where}` : employer,
      ctx.facts.pay,
      link,
      X_TAGS,
    ]
      .filter((line): line is string => !!line)
      .join('\n')
  const over = (title: string, employer: string): number => xWeightedLength(build(title, employer)) - X_POST_LIMIT

  let title = ctx.title
  while (over(title, ctx.employer) > 0 && title.length > X_MIN_CLIPPED) {
    title = clip(title, Math.max(X_MIN_CLIPPED, title.length - over(title, ctx.employer) - 1))
  }
  let employer = ctx.employer
  while (over(title, employer) > 0 && employer.length > X_MIN_CLIPPED) {
    employer = clip(employer, Math.max(X_MIN_CLIPPED, employer.length - over(title, employer) - 1))
  }
  return build(title, employer)
}

/**
 * The reply carries the facts the 280 characters could not: whole facts
 * only, dropped from the end until it fits.
 */
function xReply(ctx: PostContext, link: string): string {
  const replyFacts = ctx.lines.filter((line) => line.label !== 'Location' && line.label !== 'Pay')
  const replyText = (items: readonly string[]): string => joinSections([items.join('\n'), `Full description: ${link}`])
  let kept = replyFacts.map((line) => `${line.label}: ${line.value}`)
  while (kept.length > 1 && xWeightedLength(replyText(kept)) > X_POST_LIMIT) kept = kept.slice(0, -1)
  return kept.length && xWeightedLength(replyText(kept)) <= X_POST_LIMIT
    ? replyText(kept)
    : `Full description: ${link}`
}

function xPost(ctx: PostContext): BuiltPost {
  const link = ctx.linkFor('x')
  return {
    parts: [
      part('Post', xMainPost(ctx, link), X_POST_LIMIT, xWeightedLength),
      part('Reply with details', xReply(ctx, link), X_POST_LIMIT, xWeightedLength),
    ],
    trimmed: false,
  }
}

function forumPost(ctx: PostContext): BuiltPost {
  const title = ctx.facts.where ? `Hiring: ${ctx.title} (${ctx.facts.where})` : `Hiring: ${ctx.title}`
  const body = joinSections([
    `${ctx.employer} is hiring: ${ctx.title}`,
    plainFacts(ctx.lines),
    blocksToPlainText(ctx.blocks),
    `Apply here: ${ctx.linkFor('forum')}`,
    DISCLOSURE,
  ])
  return { parts: [part('Title', title, null), part('Body', body, null)], trimmed: false }
}

function post(platform: SocialPlatform, ctx: PostContext, built: BuiltPost): SocialPost {
  const link = ctx.linkFor(platform)
  return Object.freeze({
    platform,
    label: PLATFORM_LABEL[platform],
    link,
    code: link.slice(link.lastIndexOf('/') + 1),
    parts: Object.freeze(built.parts),
    trimmed: built.trimmed,
  })
}

function postContext(job: SocialKitJob, base: string): PostContext {
  const facts = buildPostFacts(job)
  const lines = factLines(facts).map((line) => ({ label: line.label, value: replaceDashes(line.value) }))
  return {
    job,
    title: replaceDashes(job.title.trim()),
    employer: replaceDashes(job.employer.trim()),
    facts: {
      ...facts,
      where: facts.where && replaceDashes(facts.where),
      pay: facts.pay && replaceDashes(facts.pay),
    },
    lines,
    blocks: dashFreeBlocks(descriptionBlocks(job.description)),
    linkFor: (platform) => `${base}${jobLinkPath(PLATFORM_LETTER[platform], job.id)}`,
  }
}

export function buildSocialKitEntry(job: SocialKitJob, baseUrl: string, now: Date = new Date()): SocialKitEntry {
  const base = baseUrl.replace(/\/$/, '')
  const ctx = postContext(job, base)

  return Object.freeze({
    id: job.id,
    title: job.title,
    employer: job.employer,
    jobUrl: `${base}/jobs/${job.slug}`,
    companyWebsite: job.companyWebsite,
    postedAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
    isNew: now.getTime() - job.createdAt.getTime() < NEW_POST_WINDOW_MS,
    facts: ctx.lines,
    descriptionText: blocksToPlainText(ctx.blocks),
    posts: Object.freeze([
      post('linkedin', ctx, linkedInPost(ctx)),
      post('facebook', ctx, facebookPost(ctx)),
      post('reddit', ctx, redditPost(ctx)),
      post('x', ctx, xPost(ctx)),
      post('forum', ctx, forumPost(ctx)),
    ]),
  })
}

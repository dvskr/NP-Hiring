import { parseJdBlocks, looksLikeHtml, type JdBlock } from '@/lib/jd-blocks'

/**
 * Job descriptions as text a social post can carry.
 *
 * Employer postings are sanitized editor HTML: headings, <p>, <strong>,
 * <ul><li>, and sometimes a "•" typed at the start of a <p>. None of that
 * survives a paste into LinkedIn, Facebook or a forum, so the structure is
 * rebuilt as text: headings on their own line, bullets as "•" lines,
 * paragraphs separated by a blank line. Reddit gets the same blocks as
 * Markdown. Plain-text descriptions (aggregator rows) go through the block
 * parser the job page uses, so both formats come out the same way.
 */

/** The two dashes, written as code point escapes so the source itself holds none. */
const EN_DASH = '\u{2013}'
const EM_DASH = '\u{2014}'
const DASHES = `${EN_DASH}${EM_DASH}`

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  middot: '·',
  bull: '•',
  ndash: EN_DASH,
  mdash: EM_DASH,
})

/** Decode HTML entities in one pass, so "&amp;lt;" becomes "&lt;", not "<". */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1]?.toLowerCase() === 'x'
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/** A dash, or a hyphen with a space on each side (a dash typed on a keyboard). */
const DASH_SEPARATOR = String.raw`(?:[ \t]*[` + DASHES + String.raw`][ \t]*|[ \t]+-[ \t]+)`
const DAY = String.raw`(?:Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun)`
/** What can end the first half of a range: "$80", "$80K", "9:00 AM", "II", "Mon", "Monday". */
const RANGE_START = String.raw`(\d[kKmM+]?|\b[AaPp]\.?[Mm]\.?|\b[IVX]+|\b${DAY}[a-z]*\.?)`
/** What can start the second half: a number or amount, a numeral, a day. */
const RANGE_END = String.raw`(?=\$?\d|[IVX]+\b|${DAY})`
const RANGE = new RegExp(`${RANGE_START}${DASH_SEPARATOR}${RANGE_END}`, 'g')
const ANY_DASH = new RegExp(`${DASH_SEPARATOR}|[${DASHES}]+`, 'g')
/** A dash between the two halves of a phone number ("555-1234"). */
const PHONE_DASH = new RegExp(String.raw`\b(\d{3})[` + DASHES + String.raw`](\d{4})\b`, 'g')
/** An en dash joining a compound ("COVID-19"). */
const COMPOUND_EN_DASH = new RegExp(String.raw`([A-Za-z0-9])` + EN_DASH + String.raw`(?=[A-Za-z0-9])`, 'g')

/**
 * Replace en and em dashes with plain punctuation.
 *
 * Posts go out under the board's own name (config/brand.ts), and house style
 * has no dashes in anything we publish. In order:
 *   - a phone number keeps a hyphen ("555-1234");
 *   - a range reads "to": "$45 to $60", "9:00 AM to 5:00 PM",
 *     "Mon to Fri", "Schedules II to V";
 *   - an en dash inside a word becomes a hyphen ("COVID-19");
 *   - any other dash is a separator or an aside and becomes a comma.
 * A hyphen with a space on each side counts as a dash; an ordinary hyphen
 * ("Part-Time") is left alone.
 */
export function replaceDashes(text: string): string {
  return text
    .replace(PHONE_DASH, '$1-$2')
    .replace(RANGE, '$1 to ')
    // Only an en dash joins a compound; an unspaced em dash is still an aside.
    .replace(COMPOUND_EN_DASH, '$1-')
    .replace(ANY_DASH, ', ')
    .replace(/(^|\n), /g, '$1')
    .replace(/, (?=[,.;:!?)]|\n|$)/g, '')
}

/** A line that starts with a bullet, a middle dot, an asterisk, a hyphen or a dash. */
const BULLET_LINE = new RegExp(String.raw`^[•·*\-` + DASHES + String.raw`]\s+`)

/**
 * Inline HTML to text. Block boundaries inside the fragment (a nested list,
 * two <p> in one <li>, loose <div>s) become line breaks so their words never
 * run together; every other tag is dropped.
 */
function inlineText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>|<(?:ul|ol|li|div|p)\b[^>]*>/gi, '\n')
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, ''))
    .split('\n')
    // Spaces, tabs and no-break spaces collapse to one space.
    .map((line) => line.replace(/[ \t\u{00A0}]+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** Split a run of text lines into paragraph and bullet blocks. */
function linesToBlocks(text: string): JdBlock[] {
  const blocks: JdBlock[] = []
  for (const line of text.split('\n').filter(Boolean)) {
    const prev = blocks[blocks.length - 1]
    if (BULLET_LINE.test(line)) {
      const item = line.replace(BULLET_LINE, '').trim()
      if (!item) continue
      if (prev?.kind === 'bullets') blocks[blocks.length - 1] = { kind: 'bullets', items: [...prev.items, item] }
      else blocks.push({ kind: 'bullets', items: [item] })
    } else if (prev?.kind === 'para') {
      blocks[blocks.length - 1] = { kind: 'para', text: `${prev.text}\n${line}` }
    } else {
      blocks.push({ kind: 'para', text: line })
    }
  }
  return blocks
}

const MAX_BOLD_HEADER = 80
const MAX_PLAIN_HEADER = 40
const MAX_PLAIN_HEADER_WORDS = 6
/** The whole paragraph is one bold run, optionally followed by a colon. */
const ALL_BOLD = /^<(strong|b)\b[^>]*>(?:(?!<\/?(?:strong|b)\b)[\s\S])*<\/\1>\s*:?$/i

/**
 * How a <p> reads: a heading when the whole paragraph is one bold run, a
 * possible heading ("soft") when it is a short title-like line such as
 * "About the Role" with no sentence punctuation, otherwise ordinary text.
 */
function paragraphRole(innerHtml: string, text: string): 'header' | 'soft' | 'text' {
  if (!text || text.includes('\n') || BULLET_LINE.test(text)) return 'text'
  if (ALL_BOLD.test(innerHtml.trim())) return text.length <= MAX_BOLD_HEADER ? 'header' : 'text'
  const titleLike =
    text.length <= MAX_PLAIN_HEADER &&
    /[A-Za-z]/.test(text) &&
    !/[.!?,;]$/.test(text) &&
    text.split(/\s+/).length <= MAX_PLAIN_HEADER_WORDS
  return titleLike ? 'soft' : 'text'
}

interface Draft {
  readonly block: JdBlock
  /** A short line that is only a heading if something follows it. */
  readonly soft: boolean
}

const BLOCK_TAG = /<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi

function draftBlock(tag: string, inner: string): Draft[] {
  const text = inlineText(inner)
  if (!text) return []
  if (tag.startsWith('h') && !text.includes('\n')) return [{ block: { kind: 'header', text }, soft: false }]
  if (tag === 'li') {
    const items = text.split('\n').map((line) => line.replace(BULLET_LINE, '').trim()).filter(Boolean)
    return items.length ? [{ block: { kind: 'bullets', items }, soft: false }] : []
  }
  const role = tag === 'p' ? paragraphRole(inner, text) : 'text'
  if (role !== 'text') return [{ block: { kind: 'header', text }, soft: role === 'soft' }]
  return linesToBlocks(text).map((block) => ({ block, soft: false }))
}

function htmlBlocks(html: string): JdBlock[] {
  const drafts: Draft[] = []
  const loose = (fragment: string): Draft[] =>
    linesToBlocks(inlineText(fragment)).map((block) => ({ block, soft: false }))

  let cursor = 0
  for (const match of html.matchAll(BLOCK_TAG)) {
    drafts.push(...loose(html.slice(cursor, match.index)))
    cursor = (match.index ?? 0) + match[0].length
    drafts.push(...draftBlock(match[1].toLowerCase(), match[2]))
  }
  drafts.push(...loose(html.slice(cursor)))

  // A soft heading with nothing under it ("Equal Opportunity Employer" as the
  // last line, or a short line followed by a real heading) is just text.
  return drafts.map(({ block, soft }, i): JdBlock => {
    const next = drafts[i + 1]?.block
    return soft && block.kind === 'header' && (!next || next.kind === 'header')
      ? { kind: 'para', text: block.text }
      : block
  })
}

/** Merge neighbouring bullet blocks and drop a heading with nothing under it. */
function tidy(blocks: readonly JdBlock[]): JdBlock[] {
  const out: JdBlock[] = []
  for (const block of blocks) {
    const prev = out[out.length - 1]
    if (block.kind === 'bullets' && prev?.kind === 'bullets') {
      out[out.length - 1] = { kind: 'bullets', items: [...prev.items, ...block.items] }
    } else {
      out.push(block)
    }
  }
  while (out.length && out[out.length - 1].kind === 'header') out.pop()
  return out
}

/** The description as structured blocks, whichever format it was stored in. */
export function descriptionBlocks(description: string): JdBlock[] {
  const source = (description || '').trim()
  if (!source) return []
  return tidy(looksLikeHtml(source) ? htmlBlocks(source) : parseJdBlocks(source))
}

/** Plain text: headings on their own line, "•" bullets, blank lines between. */
export function blocksToPlainText(blocks: readonly JdBlock[]): string {
  return blocks
    .map((block, i) => {
      // A heading sits directly on top of what it introduces; everything
      // else, a heading under a heading included, gets a blank line.
      const underHeader = blocks[i - 1]?.kind === 'header' && block.kind !== 'header'
      const gap = i === 0 ? '' : underHeader ? '\n' : '\n\n'
      if (block.kind === 'bullets') return gap + block.items.map((item) => `• ${item}`).join('\n')
      return gap + block.text
    })
    .join('')
}

/** Escape the characters Reddit's Markdown would read as formatting. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\*_`~^|[\]])/g, '\\$1')
    .replace(/^(\s*)([#>+-])/gm, '$1\\$2')
    .replace(/^(\s*\d+)\.(\s)/gm, '$1\\.$2')
}

/** Reddit Markdown: bold headings, "*" bullets, a blank line between blocks. */
export function blocksToMarkdown(blocks: readonly JdBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === 'header') return `**${escapeMarkdown(block.text.replace(/:$/, ''))}**`
      if (block.kind === 'bullets') return block.items.map((item) => `* ${escapeMarkdown(item)}`).join('\n')
      return escapeMarkdown(block.text).replace(/\n/g, '  \n')
    })
    .join('\n\n')
}

/**
 * The longest prefix of `blocks` whose rendering fits in `budget` characters.
 * Whole blocks only, except a bullet list, which may be cut between items.
 * A heading left with nothing under it is dropped.
 */
export function fitBlocks(
  blocks: readonly JdBlock[],
  budget: number,
  render: (blocks: readonly JdBlock[]) => string,
): { blocks: JdBlock[]; trimmed: boolean } {
  const kept: JdBlock[] = []
  for (const block of blocks) {
    if (render([...kept, block]).length <= budget) {
      kept.push(block)
      continue
    }
    if (block.kind === 'bullets') {
      const items: string[] = []
      for (const item of block.items) {
        if (render([...kept, { kind: 'bullets', items: [...items, item] }]).length > budget) break
        items.push(item)
      }
      if (items.length) kept.push({ kind: 'bullets', items })
    }
    return { blocks: tidy(kept), trimmed: true }
  }
  return { blocks: kept, trimmed: false }
}

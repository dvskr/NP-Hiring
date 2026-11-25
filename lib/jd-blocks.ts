/**
 * Turn a plain-text job description into structured blocks.
 *
 * Job.description holds two formats with no discriminator. Employer postings
 * are sanitized HTML from the editor. Everything ingested from an aggregator
 * is PLAIN TEXT: lib/description-cleaner.ts strips every tag at ingest and
 * leaves bullet characters and newlines. Roughly 590 of the ~600 live
 * postings with a substantial description are that second kind, so any
 * surface that wants to render a description properly has to reflow them.
 *
 * This logic was first written inside app/jobs/[slug]/page.tsx, as about 110
 * lines of inline component code. Extracted here because the full-description
 * email needs exactly the same reflow, and a second hand-copy of fiddly
 * paragraph-detection rules would drift from the first within a month. The
 * email and the social kit use parseJdBlocks; the job page does not yet: it
 * still has its own inline reflow and imports only looksLikeHtml from here,
 * so a reflow fix made here must also be made there until the page moves
 * over.
 *
 * Every rule below was a real rendering fault on a real posting; the
 * comments name what each one was for.
 */

import { expandInlineBullets, splitAtSectionMarkers } from '@/lib/utils';

export type JdBlock =
  | { kind: 'bullets'; items: string[] }
  | { kind: 'header'; text: string }
  | { kind: 'para'; text: string };

/** A line reads as a section header. */
function isHeaderLine(trimmed: string): boolean {
  const shouted = trimmed === trimmed.toUpperCase() && trimmed.length < 50 && trimmed.length > 2;
  const labelled = trimmed.endsWith(':') && trimmed.length < 60;
  return shouted || labelled;
}

export function parseJdBlocks(description: string): JdBlock[] {
  const lines = splitAtSectionMarkers(expandInlineBullets(description || ''))
    // Legacy rows can carry 3+ consecutive newlines, which render as stacked
    // empty gaps. Collapse before splitting.
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    // Drop empty-bullet lines so they do not render as a standalone marker
    // with no content.
    .filter((line) => !/^•\s*$/.test(line.trim()));

  const cleaned: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = cleaned[cleaned.length - 1];
    const next = lines[i + 1];
    // A blank line directly before a bullet: sources with <p> inside <li>
    // leave one behind at ingest, and it opens a gap between siblings.
    if (!line.trim() && next && next.trim().startsWith('•')) continue;
    // Clamp consecutive blanks. Some feeds leave runs of four or more.
    if (!line.trim() && prev !== undefined && !prev.trim()) continue;
    cleaned.push(line);
  }

  const blocks: JdBlock[] = [];
  let pending: string[] = [];
  const flush = (): void => {
    if (!pending.length) return;
    blocks.push({ kind: 'bullets', items: pending });
    pending = [];
  };

  for (const raw of cleaned) {
    const trimmed = raw.trim();
    if (!trimmed) { flush(); continue; }
    if (trimmed.startsWith('•')) {
      const content = trimmed.slice(1).trim();
      if (content) pending.push(content);
      continue;
    }
    flush();
    blocks.push(isHeaderLine(trimmed) ? { kind: 'header', text: trimmed } : { kind: 'para', text: trimmed });
  }
  flush();

  return blocks;
}

/**
 * A real tag: a letter-led name that ends, as in the HTML tokenizer, at
 * whitespace, "/" or ">", then any attributes. A "<" before a digit, a space
 * or a "$" is a comparison sign in the text. lib/description-cleaner.ts
 * strips exactly these at ingest; it lives here because that module loads
 * Prisma and this one is imported by pages, markup and email builders.
 */
export const HTML_TAG_PATTERN = '<\\/?[a-z][^\\s/<>]*(?:[\\s/][^<>]*)?>';

/**
 * Which format a stored description is in.
 *
 * HTML when it contains a tag in the cleaner's sense, so whatever the
 * cleaner left as text ("caseload <20 ... visits >45 min") is read as text.
 * The old sniff took any "<" and a letter before any later ">", and a plain
 * body with comparison signs then lost the words between them as one tag
 * (hunt 2026-11-11). Still a heuristic, which is why the HTML path sanitizes
 * rather than trusts.
 */
export function looksLikeHtml(description: string): boolean {
  return new RegExp(HTML_TAG_PATTERN, 'i').test(description || '');
}

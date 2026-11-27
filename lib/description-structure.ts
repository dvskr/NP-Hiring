/**
 * Walls of text in an ingested job description, broken into the lines the
 * job page reads as headings, paragraphs and bullets (owner, 2026-11-25: "the
 * job descriptions from aggregated posts are not structured ... please fix it
 * and back fill the structuring").
 *
 * The cleaner (lib/description-cleaner.ts) keeps whatever structure a source
 * sends: a line break per paragraph, "• " per list item. Some sources send
 * none. USAJobs gives each section of a federal announcement as one block of
 * text, so a VA posting carries a "Qualifications" paragraph of several
 * thousand characters whose own labels ("Licensure and Certification.",
 * "Education.") sit inside it, and some ATS feeds flatten their markup the
 * same way. The job page renders each line as one paragraph
 * (app/jobs/[slug]/page.tsx, lib/jd-blocks.ts), so such a body reads as a
 * wall.
 *
 * Only lines longer than LONG_LINE_CHARS are touched, and only by adding line
 * breaks, never by changing, dropping or reordering a word:
 *   - the line is split where its sentences end, into paragraphs of about
 *     PARAGRAPH_TARGET_CHARS (an abbreviation, an initial, a list number or a
 *     "U.S.C." is not a sentence end);
 *   - where the line holds two or more labels, each label (a short Title
 *     Case phrase that ends in a period and introduces the text after it)
 *     gets its own line, its period turned into the colon the page reads as
 *     a heading;
 *   - after a sentence that announces a list ("... include the following:"),
 *     the short sentences that follow become bullets until the next label.
 * A body its source already structured is left exactly as it is, and running
 * this twice changes nothing more.
 */

/** A line at least this long is a wall worth breaking up. */
export const LONG_LINE_CHARS = 600;

/** A paragraph is closed at the first sentence end past this length. */
const PARAGRAPH_TARGET_CHARS = 420;

/** A sentence after a list's introduction is a bullet only while it is this short. */
const LIST_ITEM_MAX_CHARS = 280;

/** A label is a few words: "Licensure and Certification", "Basic Requirements Education". */
const LABEL_MAX_WORDS = 7;

/** Short enough that "Label:" stays under the 60 characters the page reads as a heading. */
const LABEL_MAX_CHARS = 56;

/** Words that end in a period without ending a sentence. Lower case, without the final period. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'no', 'nos', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'dept', 'sec',
  'approx', 'est', 'min', 'max', 'hr', 'hrs', 'ft', 'mt', 'ave', 'blvd', 'rd', 'fig', 'vol', 'ext', 'tel',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

/**
 * The phrase before a colon that announces a list: "the following:", "duties
 * include:". Whole words only: without the leading \b, "Healthcare:" and
 * "Software:" ended in "are", "Analysis:" and "This:" in "is", and the prose
 * after them was turned into bullets (found 2026-11-27).
 */
const LIST_INTRO_RE = /\b(?:following|include|includes|including|as follows|such as|below|are|is|duties|responsibilities|requirements|qualifications|limited to)$/i;

/** Small words a Title Case label may hold in lower case. */
const LABEL_CONNECTORS = new Set(['and', 'or', 'of', 'for', 'to', 'the', 'in', 'with', 'a', 'an', 'on', 'at', 'by', '&']);

/** A capitalised label word, with brackets, quotes and a comma allowed around it. */
const LABEL_WORD_RE = /^[("'“]?[A-Z][A-Za-z'’/&-]*[)"'”,]?$/;

/** One sentence of a long line, as the text between two boundaries. */
interface Piece {
  readonly text: string;
  /** Ends with a colon that introduces a list. */
  readonly introducesList: boolean;
}

/** Whether the run of non-space characters before `end` (exclusive) is a word that ends in a period without ending a sentence. */
function isNonFinalPeriod(line: string, end: number): boolean {
  let start = end;
  while (start > 0 && !/\s/.test(line[start - 1])) start -= 1;
  const token = line.slice(start, end).replace(/^[("'“[]+/, '');
  if (!token) return true;
  if (/^\d+$/.test(token)) return true; // "1." of a numbered list
  if (/^[A-Za-z]$/.test(token)) return true; // an initial: "J. Smith"
  if (token.includes('.')) return true; // "U.S", "U.S.C", "e.g", "Ph.D"
  return ABBREVIATIONS.has(token.toLowerCase());
}

/** Split one line into sentences, keeping every character: joining the pieces with single spaces gives the line back (whitespace aside). */
function splitSentences(line: string): Piece[] {
  const pieces: Piece[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== ':') continue;
    // Closing quotes or brackets right after the mark stay with the sentence.
    let close = i + 1;
    while (close < line.length && /["')\]”’]/.test(line[close])) close += 1;
    if (close >= line.length || !/\s/.test(line[close])) continue;
    let next = close;
    while (next < line.length && /\s/.test(line[next])) next += 1;
    if (next >= line.length || !/[A-Z0-9("'“•]/.test(line[next])) continue;
    if (ch === '.' && isNonFinalPeriod(line, i)) continue;
    const text = line.slice(start, close).trim();
    if (ch === ':') {
      // A colon ends a piece only where it announces a list.
      if (!LIST_INTRO_RE.test(line.slice(start, i).trim())) continue;
      pieces.push({ text, introducesList: true });
    } else {
      pieces.push({ text, introducesList: false });
    }
    start = next;
    i = next - 1;
  }
  const rest = line.slice(start).trim();
  if (rest) pieces.push({ text: rest, introducesList: false });
  return pieces;
}

/** Whether a sentence is a label: a few Title Case words ending in a period, such as "Licensure and Certification.". */
export function isLabelSentence(sentence: string): boolean {
  if (!sentence.endsWith('.')) return false;
  const body = sentence.slice(0, -1).trim();
  if (!body || body.length > LABEL_MAX_CHARS - 1) return false;
  const words = body.split(/\s+/);
  if (words.length > LABEL_MAX_WORDS) return false;
  if (!LABEL_WORD_RE.test(words[0])) return false;
  let longCapitalised = 0;
  for (const word of words) {
    if (LABEL_CONNECTORS.has(word)) continue;
    if (!LABEL_WORD_RE.test(word)) return false;
    if (word.replace(/[^A-Za-z]/g, '').length >= 4) longCapitalised += 1;
  }
  return longCapitalised >= 1;
}

/** One long line, broken into the lines the page renders: labels as headings, lists as bullets, the rest in paragraphs. */
function structureLongLine(line: string): string[] {
  const pieces = splitSentences(line);
  if (pieces.length < 2) return [line];
  // A label needs another label in the same line as evidence that the source
  // inlined its headings, and text after it to introduce.
  const labelAt = pieces.map((piece, index) => index < pieces.length - 1 && isLabelSentence(piece.text));
  const labelled = labelAt.filter(Boolean).length >= 2;

  const out: string[] = [];
  let paragraph = '';
  let inList = false;
  const flush = (): void => {
    if (paragraph) out.push(paragraph);
    paragraph = '';
  };
  pieces.forEach((piece, index) => {
    if (labelled && labelAt[index]) {
      flush();
      inList = false;
      out.push(`${piece.text.slice(0, -1).trim()}:`);
      return;
    }
    if (piece.introducesList) {
      flush();
      out.push(piece.text);
      inList = true;
      return;
    }
    if (inList && piece.text.length <= LIST_ITEM_MAX_CHARS) {
      out.push(`• ${piece.text}`);
      return;
    }
    inList = false;
    paragraph = paragraph ? `${paragraph} ${piece.text}` : piece.text;
    if (paragraph.length >= PARAGRAPH_TARGET_CHARS) flush();
  });
  flush();
  return out;
}

/**
 * The description with its walls of text broken into lines (see the file
 * header). Lines shorter than LONG_LINE_CHARS and bullet lines are kept as
 * they are.
 */
export function structureDescription(description: string): string {
  if (!description || description.length < LONG_LINE_CHARS) return description;
  const lines = description.split('\n');
  if (!lines.some((line) => line.length >= LONG_LINE_CHARS)) return description;
  return lines
    .flatMap((line) => {
      const trimmed = line.trim();
      if (trimmed.length < LONG_LINE_CHARS || trimmed.startsWith('•')) return [line];
      return structureLongLine(trimmed);
    })
    .join('\n');
}

/** The words of a text in order, for checking that structuring only added line breaks and marks. */
export function wordsOf(text: string): string[] {
  return text.match(/[A-Za-z0-9]+/g) ?? [];
}

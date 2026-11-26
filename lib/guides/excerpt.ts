/**
 * The light markup a guide preview's excerpt is written in, parsed into the
 * blocks components/guides/GuideExcerpt.tsx renders as real HTML on the
 * server:
 *
 * - "## " and "### " lines are headings;
 * - "|" rows are a table whose first row is the header;
 * - "- " lines are a list and "1. " lines a numbered list. Items of the same
 *   kind stay one list across blank lines, because the guides space out
 *   their numbered steps;
 * - the lines between two "```" fences are a template, kept line for line
 *   (a note template or a script the guide sets in a box);
 * - anything else is a paragraph (consecutive lines join).
 *
 * A paragraph or a list item that opens with **bold** text keeps it as a
 * run-in lead.
 *
 * The source is a code constant (lib/guides/previews), never user input, and
 * every block renders as React text, so nothing here is ever parsed as HTML.
 */

/** Text that may open with a bold run-in lead, as the guides set "BLS first." or "Your employer.". */
export interface ExcerptRun {
    readonly lead: string | null;
    readonly text: string;
}

export type ExcerptBlock =
    | { readonly kind: 'heading'; readonly level: 2 | 3; readonly id: string; readonly text: string }
    | ({ readonly kind: 'paragraph' } & ExcerptRun)
    | { readonly kind: 'list'; readonly ordered: false; readonly items: readonly ExcerptRun[] }
    | {
          readonly kind: 'list';
          readonly ordered: true;
          /** The number the guide gives the first step. */
          readonly start: number;
          readonly items: readonly ExcerptRun[];
      }
    | { readonly kind: 'template'; readonly lines: readonly string[] }
    | {
          readonly kind: 'table';
          /** id of the heading the table sits under, which names it. */
          readonly labelledBy: string | null;
          readonly header: readonly string[];
          readonly rows: readonly (readonly string[])[];
      };

type Mode = 'paragraph' | 'bullets' | 'numbers' | 'table' | 'template';

const HEADING = /^(#{2,3})\s+(.+)$/;
const BULLET = /^-\s+(.+)$/;
const NUMBERED = /^(\d+)\.\s+(.+)$/;
const FENCE = '```';
const RUN_IN_LEAD = /^\*\*(.+?)\*\*\s*(.*)$/;

/** "Top-paying states for NPs (BLS median, May 2025)" -> "top-paying-states-for-nps-bls-median-may-2025". */
export function slugifyHeading(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function tableCells(line: string): string[] {
    return line
        .replace(/^\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((cell) => cell.trim());
}

function run(text: string): ExcerptRun {
    const lead = RUN_IN_LEAD.exec(text);
    return lead ? { lead: lead[1], text: lead[2] } : { lead: null, text };
}

/** A template keeps its inner blank lines but not the ones against its fences. */
function trimBlankEnds(lines: readonly string[]): string[] {
    const first = lines.findIndex((line) => line.trim() !== '');
    if (first < 0) return [];
    let last = lines.length - 1;
    while (lines[last].trim() === '') last -= 1;
    return lines.slice(first, last + 1);
}

export function parseExcerpt(source: string, idPrefix = 'excerpt'): ExcerptBlock[] {
    const blocks: ExcerptBlock[] = [];
    const idCounts = new Map<string, number>();
    let mode: Mode | null = null;
    let pending: string[] = [];
    let listStart = 1;
    let lastHeadingId: string | null = null;

    const flush = () => {
        if (mode === 'paragraph') blocks.push({ kind: 'paragraph', ...run(pending.join(' ')) });
        if (mode === 'bullets') blocks.push({ kind: 'list', ordered: false, items: pending.map(run) });
        if (mode === 'numbers') blocks.push({ kind: 'list', ordered: true, start: listStart, items: pending.map(run) });
        if (mode === 'template') blocks.push({ kind: 'template', lines: trimBlankEnds(pending) });
        if (mode === 'table') {
            const [header, ...rows] = pending.map(tableCells);
            blocks.push({ kind: 'table', labelledBy: lastHeadingId, header, rows });
        }
        mode = null;
        pending = [];
    };

    const add = (next: Mode, line: string) => {
        if (mode !== next) flush();
        mode = next;
        pending = [...pending, line];
    };

    for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim();
        if (line === FENCE) {
            const closing = mode === 'template';
            flush();
            if (!closing) mode = 'template';
            continue;
        }
        if (mode === 'template') {
            pending = [...pending, raw.trimEnd()];
            continue;
        }
        const heading = HEADING.exec(line);
        const bullet = BULLET.exec(line);
        const numbered = NUMBERED.exec(line);
        if (!line) {
            // A blank line ends a paragraph or a table; a list runs on to its next item.
            if (mode !== 'bullets' && mode !== 'numbers') flush();
        } else if (heading) {
            flush();
            const base = `${idPrefix}-${slugifyHeading(heading[2])}`;
            const seen = idCounts.get(base) ?? 0;
            idCounts.set(base, seen + 1);
            lastHeadingId = seen === 0 ? base : `${base}-${seen + 1}`;
            blocks.push({ kind: 'heading', level: heading[1].length === 2 ? 2 : 3, id: lastHeadingId, text: heading[2].trim() });
        } else if (line.startsWith('|')) {
            add('table', line);
        } else if (bullet) {
            add('bullets', bullet[1].trim());
        } else if (numbered) {
            if (mode !== 'numbers') listStart = Number(numbered[1]);
            add('numbers', numbered[2].trim());
        } else {
            add('paragraph', line);
        }
    }
    flush();
    return blocks;
}

function runText(item: ExcerptRun): string[] {
    return item.lead ? [item.lead, item.text] : [item.text];
}

/** Every piece of text the blocks render, in reading order. */
export function excerptText(blocks: readonly ExcerptBlock[]): string[] {
    return blocks.flatMap((block): string[] => {
        switch (block.kind) {
            case 'heading':
                return [block.text];
            case 'paragraph':
                return runText(block);
            case 'list':
                return block.items.flatMap(runText);
            case 'template':
                return block.lines.filter((line) => line.trim() !== '');
            case 'table':
                return [...block.header, ...block.rows.flat()];
        }
    });
}

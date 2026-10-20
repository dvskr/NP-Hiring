/**
 * Register 2.24: the dated re-check of np-student-loan-limits-professional-degree.
 *
 * The post tracks at least five open federal cases over the professional degree
 * loan limits and lists the next court-set deadlines. Its first named deadline was
 * 2026-10-16 (the government's cross motion in the Massachusetts case), so the
 * dockets were re-read on 2026-10-17 (RECHECK_DAY):
 *
 *   - D. Mass. 1:26-cv-12443: on 2026-10-16 the government filed ECF 72, docketed
 *     as a motion to dismiss for lack of jurisdiction, with its memorandum (ECF 73).
 *     The August 17 order leaves the plaintiffs' reply (October 30) and the
 *     government's reply (November 13).
 *   - D. Md. 1:26-cv-01957: the July 28 scheduling order (ECF 90) sets the
 *     Department's reply for November 6, 2026; the row printed no deadline.
 *   - D. Or. 3:26-cv-01599: the opinion and order (ECF 41, 2026-10-16, Judge
 *     Simon) granted the preliminary injunction: for the plaintiffs and their
 *     members the Department must treat the N.D. degree as a professional
 *     degree under 34 C.F.R. 685.102 (2026), and the stay pending appeal was
 *     denied. It was read on 2026-10-20 from GovInfo; it was filed inside the
 *     re-check, so the review date stays the re-check day.
 *   - D.D.C. 1:26-cv-01780 and 1:26-cv-02833: no change to the stay or to the
 *     AANP schedule; the AFL-CIO docket has a summary judgment filing of
 *     2026-10-16.
 *   - FSA's guidance list still shows GENERAL-26-42 as the latest professional
 *     degree announcement.
 *
 * The contract pinned here, relative to the post's own review date so the next
 * re-check only has to move the dates it re-verifies:
 *   - reviewed is on or after the re-check day; date stays the publication day;
 *   - every sentence-initial "As of <date>" and the table's "Status as of"
 *     date is the review date;
 *   - no "next deadline" in the case table has passed by the review date;
 *   - the rows and source notes carry what the dockets showed on the re-check.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SLUG = 'np-student-loan-limits-professional-degree';
const PUBLISHED = '2026-10-13';
const RECHECK_DAY = '2026-10-17';

const raw = fs.readFileSync(path.join(process.cwd(), 'content', 'blog', `${SLUG}.mdx`), 'utf8');
const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
const fm: Record<string, string> = {};
for (const line of (match?.[1] ?? '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
}
const body = match?.[2] ?? raw;
const lines = body.split(/\r?\n/).map((l) => l.trim());

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const DATE_RE = new RegExp(`\\b(${MONTHS.join('|')}) (\\d{1,2})(?:, (\\d{4}))?`, 'g');

/** "2026-10-17" to "October 17, 2026", the way the post writes dates. */
function inWords(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The later of two ISO days. */
function later(a: string, b: string): string {
    return a > b ? a : b;
}

/**
 * Every date in a table cell as an ISO day. A date written without a year
 * takes the year of the next date in the cell that has one ("November 6;
 * ... December 4, 2026"), or the fallback year.
 */
function cellDates(cell: string, fallbackYear: number): string[] {
    const found = [...cell.matchAll(DATE_RE)].map((m) => ({
        month: MONTHS.indexOf(m[1]) + 1,
        day: Number(m[2]),
        year: m[3] ? Number(m[3]) : null,
    }));
    return found.map((f, i) => {
        const year = f.year ?? found.slice(i + 1).find((n) => n.year !== null)?.year ?? fallbackYear;
        return `${year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
    });
}

const tableRows = lines
    .filter((l) => l.startsWith('|') && !/^\|\s*-{3,}/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const header = tableRows.find((r) => r[0] === 'Case') ?? [];
const caseRows = tableRows.filter((r) => r !== header && r.length === 4 && /\]\(https:\/\/www\.courtlistener\.com\/docket\//.test(r[0]));

function rowFor(name: RegExp): string[] {
    const row = caseRows.find((r) => name.test(r[0]));
    expect(row, `no case table row matching ${name}`).toBeTruthy();
    return row ?? [];
}

/** The "Next deadlines" cell without its "Under the August 17 order:" lead-in, whose date is the order's. */
function deadlines(row: string[]): string {
    return (row[3] ?? '').replace(/^Under the [A-Z][a-z]+ \d{1,2} order:\s*/, '');
}

function sourceLine(name: RegExp): string {
    const sources = body.split(/^## Sources\s*$/m)[1] ?? '';
    const line = sources.split(/\r?\n/).find((l) => name.test(l));
    expect(line, `no Sources entry matching ${name}`).toBeTruthy();
    return line ?? '';
}

const REVIEWED = fm.reviewed ?? '';
const REVIEWED_WORDS = /^\d{4}-\d{2}-\d{2}$/.test(REVIEWED) ? inWords(REVIEWED) : '';
const CUTOFF = later(REVIEWED, RECHECK_DAY);

describe('student loan post: dated docket re-check (register 2.24)', () => {
    it('reviewed moved to the re-check day; date stays the publication day', () => {
        expect(fm.date, 'date is the publication day and does not move').toBe(PUBLISHED);
        expect(REVIEWED >= RECHECK_DAY, `reviewed ${REVIEWED} predates the ${RECHECK_DAY} re-check`).toBe(true);
    });

    it('every "as of" date in the body is the review date', () => {
        // Sentence-initial "As of <date>," dates a status claim; a lower-case "as of"
        // mid-sentence is a rule's own date (enrolled "as of June 30, 2026") and stays.
        const asOf = [...body.matchAll(/\bAs of ([A-Z][a-z]+ \d{1,2}, \d{4})/g)].map((m) => m[1]);
        expect(asOf.length, 'the post dates its status claims').toBeGreaterThanOrEqual(3);
        expect([...new Set(asOf)], 'an "as of" date the review did not re-verify').toEqual([REVIEWED_WORDS]);
        expect(header[2], 'the status column is dated by the review').toBe(`Status as of ${REVIEWED_WORDS}`);
    });

    it('no deadline in the case table has passed by the review date', () => {
        expect(caseRows.length, 'three cases in the table').toBe(3);
        expect(header[3]).toBe('Next deadlines set by the court');
        const year = Number(CUTOFF.slice(0, 4));
        for (const row of caseRows) {
            const dates = cellDates(deadlines(row), year);
            for (const d of dates) {
                expect(d >= CUTOFF, `${row[0].slice(0, 40)}: deadline ${d} has passed by ${CUTOFF}`).toBe(true);
            }
        }
    });

    it('Massachusetts: the October 16 filing is recorded, and the two replies remain', () => {
        const row = rowFor(/American Nurses Association/);
        expect(row[2]).toContain('the government moved to dismiss for lack of jurisdiction on October 16, 2026');
        expect(deadlines(row)).not.toMatch(/October 16|cross motion/);
        expect(row[3]).toBe("Under the August 17 order: plaintiffs' reply due October 30; government reply November 13, 2026");
    });

    it('Maryland: the court-set reply deadline is printed', () => {
        const row = rowFor(/Maryland v\. Department of Education/);
        expect(row[2]).toContain('the Department moved to dismiss and for summary judgment on September 25, 2026');
        expect(row[2]).toMatch(/no ruling on those motions yet/i);
        expect(row[3]).toBe("Under the July 28 order: the Department's reply due November 6, 2026");
    });

    it('AANP v. McMahon: the stay and the July 20 schedule are unchanged', () => {
        const row = rowFor(/AANP v\. McMahon/);
        expect(row[2]).toBe('Stay in effect since June 24, 2026; plaintiffs filed summary judgment motions on October 1 and 2, 2026');
        expect(row[3]).toBe("Government cross motions due November 6; plaintiffs' reply November 20; government reply December 4, 2026");
    });

    it('Oregon: the October 16 order granted the injunction for naturopathic students only', () => {
        // Link text kept, targets dropped, so "v. McMahon" and URLs cannot end the sentence early.
        const paragraph = (lines.find((l) => l.includes('District of Oregon')) ?? '').replace(/\]\([^)]*\)/g, ']');
        const sentence = paragraph.match(/Naturopathic medicine groups sued in the District of Oregon[\s\S]*?(?=\s+Labor unions|$)/)?.[0] ?? '';
        expect(sentence).toContain('preliminary injunction motion on September 23, 2026');
        expect(sentence).toContain('On October 16, 2026 it granted a preliminary injunction');
        expect(sentence).toContain('naturopathic doctor (N.D.) degree as a professional degree for the plaintiff groups and their members');
        expect(sentence).toContain('denied the government\'s request for a stay pending appeal');
        // The order reaches naturopathic students only; the post must not read it as NP relief.
        expect(sentence).toContain('it does not change how nurse practitioner programs are treated');
        expect(sourceLine(/District of Oregon: Association of Accredited Naturopathic Medical Colleges v\. McMahon, Opinion and Order/)).toContain('(October 16, 2026)');
    });

    it('the case count and the FAQ count agree', () => {
        const words: Record<string, number> = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
        const open = body.match(/At least (\w+) federal cases challenging the definition are open/)?.[1] ?? '';
        const others = body.match(/at least (\w+) other cases are pending/)?.[1] ?? '';
        expect(words[open], `case count "${open}"`).toBeGreaterThanOrEqual(5);
        expect(words[others], `FAQ count "${others}" is the case count less AANP v. McMahon`).toBe(words[open] - 1);
    });

    it('source notes carry the latest docket entries read on the re-check', () => {
        expect(sourceLine(/American Nurses Association v\. Department of Education docket/)).toContain('entries through October 16, 2026');
        expect(sourceLine(/Maryland v\. Department of Education docket/)).toContain('scheduling order July 28, 2026');
        expect(sourceLine(/Association of Accredited Naturopathic Medical Colleges v\. McMahon docket/)).toContain('entries through October 16, 2026');
        expect(sourceLine(/AFL-CIO v\. Department of Education docket/)).toContain('entries through October 16, 2026');
        expect(sourceLine(/Dear Colleague Letters and Electronic Announcements/)).toContain(`checked ${REVIEWED_WORDS}`);
        const through = [...body.matchAll(/entries through ([A-Z][a-z]+ \d{1,2}, \d{4})/g)].map((m) => cellDates(m[1], 0)[0]);
        for (const d of through) expect(d <= REVIEWED, `a source note reads entries after the review: ${d}`).toBe(true);
    });
});

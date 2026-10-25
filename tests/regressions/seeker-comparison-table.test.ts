/**
 * Register D25: the job seeker comparison table on /for-job-seekers.
 *
 * The table was a local array in the page that no test read, and it said
 * things the product does not do: "Salary Transparency on Every Listing"
 * with the note "Others hide salary", "AI Match Scoring", "Zero Spam or
 * Recruiter Noise" and "100% NP-Only Jobs". It also marked Indeed and
 * LinkedIn as lacking features their own help pages document. Three audits
 * (this board's code, Indeed's pages, LinkedIn's pages) and a judge settled
 * five rows; lib/seeker-comparison.ts records the evidence for every cell.
 *
 * These guards pin:
 *   1. exactly the judged rows, marks and order, with no notes, and no
 *      removed claim comes back into the table;
 *   2. each cell in the brand column stays tied to the code it rests on, so
 *      a product change that falsifies a row fails here first;
 *   3. every label renders as English that follows the house rules (no em
 *      or en dash, no spaced hyphen, ranges say "to"), and so do the
 *      visible text, the alt text and the metadata of the whole page;
 *   4. the page renders the rows with the audited /for-employers markup: a
 *      caption that defines Limited, scoped headers, text for every icon,
 *      "Limited" in AA colours, and a footnote dated by the last competitor
 *      check, with a correction link;
 *   5. the surrounding copy the judge named stays fixed;
 *   6. the page reads the rows as data and stays off the promo clock.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
import { prisma } from '@/lib/prisma';
import { LICENSE_GUIDE_SERIES_PUBLISHED } from '@/config/niche/content-map';
import { LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';
import { NP_ELIGIBLE_PROFESSION_CLASSES } from '@/lib/profession-classifier';
import {
    SEEKER_COMPARISON_CHECKED_MONTH,
    SEEKER_COMPARISON_CHECKED_ON,
    SEEKER_COMPARISON_ROWS,
} from '@/lib/seeker-comparison';
import * as seekersPage from '@/app/for-job-seekers/page';

// The page's one async server child reads the database; the page is
// rendered around it, with the hero counts stubbed.
vi.mock('@/components/FeaturedJobsSection', () => ({ default: () => null }));
vi.mock('@/lib/site-stats', () => ({
    getSiteStats: async () => ({ totalJobs: 0, totalCompanies: 0 }),
}));

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source without comments: the comments at each fix site quote the claim
 * they removed, and that must not trip the guard keeping it removed (same
 * convention as tests/regressions/p2-trust-surfaces-point-of-sale.test.ts).
 */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = 'app/for-job-seekers/page.tsx';
const MODULE = 'lib/seeker-comparison.ts';

type Mark = true | false | 'partial';

interface MarkedRow {
    feature: string;
    us: Mark;
    indeed: Mark;
    linkedin: Mark;
}

/** The judge's final table, in order. No row carries a note. */
const JUDGED_ROWS: readonly MarkedRow[] = [
    { feature: `Focused on ${brand.niche.short} and APRN Jobs`, us: true, indeed: false, linkedin: false },
    { feature: 'Free for Job Seekers', us: true, indeed: true, linkedin: 'partial' },
    { feature: 'Licensure Guides for All 50 States and DC', us: true, indeed: 'partial', linkedin: false },
    { feature: 'Saved Jobs and Application Tracking', us: true, indeed: true, linkedin: true },
    { feature: 'Profile Filled In From Your Resume', us: true, indeed: true, linkedin: 'partial' },
];

/** [pattern, why it left the table]: no label or note may match one again. */
const REMOVED_ROW_CLAIMS: ReadonlyArray<readonly [RegExp, string]> = [
    [/100%|\bonly\b/i, 'an absolute inventory claim, withheld until the WP-1 inventory-invariant test is green'],
    [/salary transparency|every listing|hide salary/i, 'false: a posting that states no pay shows none, and both competitors show posted pay'],
    [/match scor/i, 'false: no match score reaches a job seeker'],
    [/easy apply|employer site/i, 'no difference: all three sites offer both apply paths'],
    [/state.by.state|salary data/i, 'overstated: a state shows a posted pay median only above the publishing gate'],
    [/spam|recruiter noise/i, 'false: recruiter firms are listed on purpose, and no competitor page can source it'],
    [/completely free/i, 'restated as "Free for Job Seekers"'],
    [/\bindeed\b|linkedin/i, 'a competitor named in a label or note; the Limited footnote carries that meaning'],
];

/** The removed labels and notes as the source spelled them, for the comment-stripped module. */
const REMOVED_ROW_LITERALS: readonly string[] = [
    '-Only Jobs',
    '100%',
    'Salary Transparency on Every Listing',
    'Others hide salary',
    'Completely Free for Job Seekers',
    'premium features cost extra',
    'AI Match Scoring',
    'Easy Apply or Apply on the Employer Site',
    'State-by-State Salary Data',
    'Zero Spam or Recruiter Noise',
    'AI Resume Parser',
];

/**
 * House rules for anything a visitor reads, as [pattern, what it is]. The
 * patterns are the ones tests/regressions/public-employer-copy-rule.test.ts
 * holds the employer pages to.
 */
const HOUSE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
    [/[–—]/, 'em or en dash'],
    [/(?:^|\s)-(?:\s|$)/, 'spaced hyphen'],
    [/\b\d[\d,.]*\s*-\s*\d[\d,.]*\s*(?:yrs?|years?|hours?|days?|weeks?|months?|k|%)(?![A-Za-z])/i, 'hyphen range (ranges read "to")'],
    [/\$\d[\d,.]*k?\s*-\s*\$?\d/i, 'hyphen range (ranges read "to")'],
    [/\b[A-Z]-[A-Z]\b/, 'hyphen range (ranges read "to")'],
];

const houseRuleBreaks = (text: string): string[] =>
    HOUSE_RULES.filter(([pattern]) => pattern.test(text)).map(([, what]) => `${what}: ${JSON.stringify(text)}`);

/**
 * "a" or "an" goes by sound, not spelling: an initialism takes "an" when its
 * first letter's name opens with a vowel sound (an NP, an FNP, an MSN).
 */
const VOWEL_SOUND_LETTERS = 'AEFHILMNORSX';
const startsWithVowelSound = (word: string): boolean =>
    /^[A-Z0-9]{2,}$/.test(word) ? VOWEL_SOUND_LETTERS.includes(word[0]) : /^[aeiou]/i.test(word);
const articleBreaks = (text: string): string[] =>
    [...text.matchAll(/\b(an?)\s+([A-Za-z][A-Za-z-]*)/g)]
        .filter(([, article, word]) => (article === 'an') !== startsWithVowelSound(word))
        .map(([phrase]) => `"${phrase}" in "${text}"`);

const decode = (html: string): string =>
    html
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

/** What a visitor reads in rendered HTML: the text, without scripts, styles or tags. */
const textOf = (html: string): string =>
    decode(
        html
            .replace(/<script[\s\S]*?<\/script>/g, ' ')
            .replace(/<style[\s\S]*?<\/style>/g, ' ')
            .replace(/<[^>]+>/g, ' '),
    )
        .replace(/\s+/g, ' ')
        .trim();

/** Alt text and accessible names: read aloud, so held to the same rules. */
const attributeTextOf = (html: string): string[] =>
    [...html.matchAll(/\s(?:alt|aria-label)="([^"]*)"/g)].map((m) => decode(m[1])).filter((t) => t.trim() !== '');

async function renderPage(): Promise<string> {
    vi.mocked(prisma.job.count).mockResolvedValue(0);
    vi.mocked(prisma.job.groupBy).mockResolvedValue([] as never);
    return renderToStaticMarkup(await seekersPage.default());
}

const MARK_BY_TEXT: Readonly<Record<string, Mark>> = { Included: true, 'Not offered': false, Limited: 'partial' };

interface RenderedTable {
    count: number;
    html: string;
    caption: string;
    headers: string[];
    headerHtml: string[];
    rows: MarkedRow[];
    cellHtml: string[];
    footnoteHtml: string;
}

/** The comparison table as rendered: rows read back from the cell text a screen reader hears. */
function comparisonTable(page: string): RenderedTable {
    const tables = page.match(/<table[\s\S]*?<\/table>/g) ?? [];
    const table = tables[0] ?? '';
    const headerHtml = [...table.matchAll(/<th scope="col"[^>]*>[\s\S]*?<\/th>/g)].map((m) => m[0]);
    const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
    const cellHtml: string[] = [];
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, tr]) => {
        const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
        cellHtml.push(...cells);
        const [us, indeed, linkedin] = cells.map((cell) => MARK_BY_TEXT[textOf(cell)]);
        return { feature: textOf(tr.match(/<th scope="row"[^>]*>([\s\S]*?)<\/th>/)?.[1] ?? ''), us, indeed, linkedin };
    });
    return {
        count: tables.length,
        html: table,
        caption: textOf(table.match(/<caption class="sr-only">([\s\S]*?)<\/caption>/)?.[1] ?? ''),
        headers: headerHtml.map(textOf),
        headerHtml,
        rows,
        cellHtml,
        footnoteHtml: page.match(/<\/table><\/div><p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '',
    };
}

/** Every .ts and .tsx file under a directory, as a forward-slash path from the repo root. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...sourceFiles(rel));
        else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

describe('D25: the seeker comparison rows', () => {
    it('are exactly the judged table: five rows, these marks, this order, no notes', () => {
        expect(SEEKER_COMPARISON_ROWS).toEqual(JUDGED_ROWS);
        expect(SEEKER_COMPARISON_ROWS.filter((row) => row.note !== undefined)).toEqual([]);
    });

    it('keep one row per source line, with row 1 written through the brand token', () => {
        const src = code(read(MODULE));
        const start = src.indexOf('export const SEEKER_COMPARISON_ROWS');
        expect(start).toBeGreaterThan(-1);
        const rowLines = src.slice(start, src.indexOf('];', start)).split('\n').filter((line) => line.includes('feature:'));
        expect(rowLines).toHaveLength(JUDGED_ROWS.length);
        for (const line of rowLines) {
            expect(line.trim(), line).toMatch(/^\{ feature: .+, us: .+, indeed: .+, linkedin: .+ \},$/);
        }
        // Never a hand-typed niche name (config/brand.ts), and never an article before the token.
        expect(rowLines[0]).toContain('feature: `Focused on ${brand.niche.short} and APRN Jobs`');
    });

    it('never bring a removed claim back', () => {
        const cells = SEEKER_COMPARISON_ROWS.flatMap((row) => [row.feature, ...(row.note ? [row.note] : [])]);
        const found = REMOVED_ROW_CLAIMS.flatMap(([pattern, why]) =>
            cells.filter((cell) => pattern.test(cell)).map((cell) => `"${cell}" matches ${pattern}: ${why}`));
        const moduleCode = code(read(MODULE));
        found.push(...REMOVED_ROW_LITERALS.filter((literal) => moduleCode.includes(literal)).map((literal) => `${MODULE} still says "${literal}"`));
        expect(found, found.join('\n')).toEqual([]);
    });

    it('render as English that follows the house rules', () => {
        const cells = SEEKER_COMPARISON_ROWS.flatMap((row) => [row.feature, ...(row.note ? [row.note] : [])]);
        const breaks = cells.flatMap((cell) => [
            ...(/\$\{|\bundefined\b/.test(cell) ? [`unresolved token in "${cell}"`] : []),
            ...houseRuleBreaks(cell),
            ...articleBreaks(cell),
        ]);
        expect(breaks, breaks.join('\n')).toEqual([]);
    });

    it('carry a footnote month that matches the recorded competitor check date', () => {
        expect(SEEKER_COMPARISON_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const month = new Date(`${SEEKER_COMPARISON_CHECKED_ON}T12:00:00Z`).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
        });
        expect(SEEKER_COMPARISON_CHECKED_MONTH).toBe(month);
    });
});

describe('D25: each brand cell stays tied to the code it rests on', () => {
    it('row 1: the board serves the NP class and the APRN cohort the label names', () => {
        expect(NP_ELIGIBLE_PROFESSION_CLASSES).toEqual(
            expect.arrayContaining(['np_eligible', 'aprn_midwife', 'aprn_crna', 'aprn_cns']),
        );
        expect(read('config/brand.ts')).toMatch(/plus the APRN cohort/i);
    });

    it('row 2: every Stripe Checkout session the code opens sells an employer post, a renewal or a 5-post pack', () => {
        // A new checkout fails here until someone confirms it charges an
        // employer and not a job seeker, and adds it to this list. (The
        // employer plan is a Payment Link behind /api/employer/plan/subscribe.)
        // The 5-post pack (2026-10-25): /api/create-pack-checkout sells only to
        // the signed-in employer account, 403 for any other role.
        const CALL = '.checkout.sessions.create(';
        const sellers = [...sourceFiles('app'), ...sourceFiles('lib')]
            .filter((rel) => {
                const src = read(rel);
                return src.includes(CALL) && code(src).includes(CALL);
            })
            .sort();
        expect(sellers).toEqual(['app/api/create-checkout/route.ts', 'app/api/create-pack-checkout/route.ts', 'app/api/create-renewal-checkout/route.ts']);
        // ...and the pack's checkout refuses any account that is not an employer before Stripe is asked.
        expect(code(read('app/api/create-pack-checkout/route.ts'))).toMatch(/profile\?\.role !== 'employer'\) \{\s*return NextResponse\.json\([^;]*\{ status: 403 \}\);/);
    }, 60_000);

    it('row 3: the guide series is published, one guide for each of the 50 states and DC', () => {
        expect(LICENSE_GUIDE_SERIES_PUBLISHED).toBe(true);
        expect(LICENSE_GUIDE_STATES).toHaveLength(51);
        expect(LICENSE_GUIDE_STATES.map((state) => state.name)).toContain('District of Columbia');
    });

    it('row 4: the saved jobs and application pages, and their routes, exist', () => {
        for (const rel of ['app/saved/page.tsx', 'app/my-applications/page.tsx', 'app/api/saved-jobs/route.ts', 'app/api/applications/route.ts']) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
        }
    });

    it('row 5: the resume parser is on by default and changes the profile only after a preview', () => {
        // If production turns the flag off or lacks OPENAI_API_KEY, the row
        // must go (lib/seeker-comparison.ts); that part needs a person.
        expect(read('lib/ai/feature-flags.ts')).toMatch(/'ai\.candidate\.resume_parser':\s*\{\s*default: true\b/);
        expect(code(read('app/api/resume/parse/route.ts'))).toContain("url.searchParams.get('preview') === '1'");
    });
});

describe('D25: /for-job-seekers renders the rows with the audited markup', () => {
    let html = '';
    let table: RenderedTable;

    beforeAll(async () => {
        html = await renderPage();
        table = comparisonTable(html);
    }, 60_000);

    it('renders exactly the module rows, each mark with text a screen reader reads', () => {
        expect(table.count, 'the page renders one table').toBe(1);
        expect(table.rows).toEqual(
            SEEKER_COMPARISON_ROWS.map(({ feature, us, indeed, linkedin }) => ({ feature, us, indeed, linkedin })),
        );
        expect(table.cellHtml).toHaveLength(SEEKER_COMPARISON_ROWS.length * 3);
        for (const cell of table.cellHtml) {
            if (textOf(cell) === 'Limited') {
                expect(cell).toContain('color:#B45309');
                continue;
            }
            // The icon is decorative; the meaning is in the sr-only text.
            expect(cell).toContain('aria-hidden="true"');
            expect(cell).toMatch(/<span class="sr-only">(?:Included|Not offered)<\/span>/);
        }
    });

    it('has a caption that defines Limited, scoped headers, and no colour that fails AA', () => {
        expect(table.caption).toBe(
            `Feature comparison between ${brand.name}, Indeed, and LinkedIn for ${brand.niche.descriptor} job seekers. "Limited" means the capability exists but is restricted, costs extra, or varies by plan.`,
        );
        expect(table.headers).toEqual(['Feature', brand.name, 'Indeed', 'LinkedIn']);
        for (const th of table.headerHtml.slice(2)) expect(th).toContain('color:#64748B');
        expect(table.html.match(/<th scope="row"/g) ?? []).toHaveLength(SEEKER_COMPARISON_ROWS.length);
        expect(html).toContain('<div style="overflow-x:auto"><table');
        // The old markup printed "Partial" in #F59E0B and greys in #94A3B8.
        expect(textOf(table.html)).not.toContain('Partial');
        expect(table.html).not.toMatch(/#F59E0B|#94A3B8/i);
    });

    it('qualifies and dates the competitor columns, and offers a correction link', () => {
        const footnote = textOf(table.footnoteHtml);
        expect(footnote).toMatch(/^Limited means the capability exists but is restricted, costs extra, or varies by plan\./);
        expect(footnote).toContain(`publicly documented standard offerings as of ${SEEKER_COMPARISON_CHECKED_MONTH}.`);
        expect(footnote).toMatch(/check their sites before deciding/);
        expect(table.footnoteHtml).toContain(`href="mailto:${brand.email.contact}"`);
    });

    it('holds every visible string, alt text and metadata field on the page to the house rules', () => {
        const { metadata } = seekersPage;
        const ogImages = (metadata.openGraph?.images ?? []) as Array<{ alt?: string }>;
        const metaText = [metadata.title, metadata.description, ...ogImages.map((image) => image.alt)]
            .filter((text): text is string => typeof text === 'string');
        expect(metaText.length).toBeGreaterThanOrEqual(3);
        const breaks = [textOf(html), ...attributeTextOf(html), ...metaText].flatMap(houseRuleBreaks);
        expect(breaks, breaks.join('\n')).toEqual([]);
        expect(textOf(html)).not.toMatch(/\$\{|\bundefined\b/);
    });

    it('carries none of the sentences the judge removed, in the source or the rendered page', () => {
        // [fragment, the judge's item and why]
        const REMOVED_COPY: ReadonlyArray<readonly [string, string]> = [
            ['AI Match Scoring', '(1) no match score reaches a job seeker'],
            ['match score', '(1) no match score reaches a job seeker'],
            ['bento-match', '(1) the card picture shows a match percentage'],
            ['get matched', '(2) rests on the removed match row'],
            ['never estimated', '(4) the enrich cron estimates and annualizes pay it reads from a description'],
            ['from Applied to Hired', '(5) only an employer moves a status'],
            ['profile instantly', '(6) a parse takes minutes and waits for the seeker to review it'],
            ['compare benefits', '(7) saved jobs have no comparison feature'],
            ['Save & Compare', '(7) saved jobs have no comparison feature'],
            ['salary data, and step-by-step', '(8) a guide shows state pay only in a gated snapshot'],
            ['State-by-state salary data', '(9) a state shows a median only above the publishing gate'],
            ['actually earn', '(9) the state figures are posted pay, not earnings'],
            ['Free Forever', '(10) a promise the owner has not made'],
            ['Why Switch', '(11) the table no longer argues for leaving either site'],
            ['Others hide salary', 'the removed salary row'],
        ];
        const source = code(read(PAGE)).toLowerCase();
        const rendered = decode(html).toLowerCase();
        const found = REMOVED_COPY.flatMap(([fragment, why]) => [
            ...(source.includes(fragment.toLowerCase()) ? [`${PAGE} source: "${fragment}" ${why}`] : []),
            ...(rendered.includes(fragment.toLowerCase()) ? [`rendered page: "${fragment}" ${why}`] : []),
        ]);
        expect(found, found.join('\n')).toEqual([]);
    });

    it('keeps the true half of each sentence it cut', () => {
        const text = textOf(html);
        expect(text).toContain("Pay is shown whenever the employer's posting includes it.");
        expect(text).toContain('100% free. No sign-up required to browse. Create a profile to apply.');
    });
});

describe('D25: the page reads the rows as data, off the promo clock', () => {
    it('imports the module, renders its rows and declares no local copy', () => {
        const page = code(read(PAGE));
        expect(page).toContain("from '@/lib/seeker-comparison'");
        expect(page).toContain('SEEKER_COMPARISON_ROWS.map(');
        expect(page).toContain('{SEEKER_COMPARISON_CHECKED_MONTH}');
        expect(page).not.toMatch(/const comparisonRows\b/);
    });

    it('imports only the row type from lib/employer-comparison, and reads no promo clock', () => {
        // A callable import from a promo clock module would make the page
        // follow the clock (tests/regressions/promo-clock-pages-rerender.test.ts).
        const page = code(read(PAGE));
        expect(page).not.toContain('@/lib/employer-comparison');
        expect(page).not.toMatch(/isPromoActive\(/);
        const moduleCode = code(read(MODULE));
        const imports = [...moduleCode.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'@\/lib\/employer-comparison';$/gm)];
        expect(imports).toHaveLength(1);
        expect(imports[0][1]).toBe('type ');
        expect(moduleCode).not.toMatch(/isPromoActive\(/);
    });
});

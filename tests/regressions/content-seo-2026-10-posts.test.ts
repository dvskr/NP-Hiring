/**
 * Content SEO/AEO/GEO release, October 2026: ten new posts.
 *
 *   np-student-loan-limits-professional-degree
 *   can-nurse-practitioners-prescribe-controlled-substances
 *   aprn-compact-states
 *   nurse-practitioner-job-outlook
 *   np-fellowship-residency-programs
 *   nurse-practitioner-week-2026
 *   nurse-practitioner-noncompete-laws
 *   non-clinical-nurse-practitioner-jobs
 *   what-is-an-aprn
 *   how-to-become-a-nurse-practitioner
 *
 * All ten ship through the mechanism P1 established and P2 to P5 extended:
 * .mdx in content/blog/, served from the file by lib/blog.ts with or
 * without a blog_posts row (lib/blog-mdx-posts.ts extracts the visible
 * "Frequently asked questions" section into faq_json, the only source of
 * the FAQPage JSON-LD emitted by app/blog/[slug]/page.tsx).
 *
 * WHY THIS SUITE EXISTS
 * These posts target answer engines as much as search: the Quick answer
 * paragraph and the FAQ entries are what gets lifted and quoted out of
 * context, so every figure in them has to be traceable and every canonical
 * statistic has to carry its source and vintage wherever it appears. The
 * contract pinned here:
 *
 *   - frontmatter: title of 70 characters or fewer, description of 110 to
 *     170 characters, a category /resources styles, ISO date and reviewed;
 *   - a "**Quick answer:**" paragraph opens the body;
 *   - "## Frequently asked questions" with at least 5 "### ...?" entries;
 *   - "## Sources" is the last H2 and carries at least 3 https links;
 *   - no em dash, en dash or spaced hyphen used as a dash (owner house
 *     style since 2026-09-12);
 *   - every internal link resolves to an app route, a post or a license
 *     guide;
 *   - every dollar figure and percentage is canonical (read from
 *     lib/stats-sources.ts, never retyped here) or sits in this post's
 *     allowlist below, with the primary source it was verified against;
 *   - the canonical contracts: the NP median is cited with BLS and May 2025
 *     and never called an average; the growth figure is cited with BLS and
 *     2025 to 2035; any "27 states" claim links AANP and carries the
 *     transition-to-practice caveat.
 *
 * The sitewide guard at the bottom extends the dash rule to every post in
 * content/blog, not only these ten.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LICENSE_GUIDE_SLUG_REGEX } from '@/config/niche/content-map';
import { BLOG_CATEGORIES } from '@/lib/blog-categories';
import { markdownToHtml } from '@/lib/blog';
import { STAT_SOURCES } from '@/lib/stats-sources';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'app');
const BLOG_DIR = path.join(ROOT, 'content', 'blog');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const EM_DASH = '—';
const EN_DASH = '–';

/** The AANP map every full practice count must link (STAT_SOURCES, not retyped). */
const FPA_URL = STAT_SOURCES.fullPracticeStates.sourceUrl;
const MEDIAN = STAT_SOURCES.averageSalary.formatted;
const GROWTH = STAT_SOURCES.blsGrowth2035.formatted;

/**
 * Canonical figures: the only dollar and percent values a post may print
 * without a per-post source entry, because lib/stats-sources.ts carries
 * their source and vintage.
 */
const CANONICAL_DOLLARS = new Set<string>([
    STAT_SOURCES.averageSalary.formatted,
    STAT_SOURCES.salaryPercentile10.formatted,
    STAT_SOURCES.salaryPercentile90.formatted,
]);
const CANONICAL_PERCENTS = new Set<string>([STAT_SOURCES.blsGrowth2035.formatted]);

/** A figure verified for one post, next to the primary source it was read from. */
interface AllowedFigure {
    figure: string;
    source: string;
}

const FSA_LOAN_FAQ = 'https://fsapartners.ed.gov/sites/default/files/2026-05/FrequentlyAskedQuestionsLoanLimits.pdf';
const AACN_ENROLLMENT_2025 =
    'https://www.aacnnursing.org/news-data/all-news/article/schools-of-nursing-see-enrollment-increases-across-most-program-levels-signaling-strong-interest-in-nursing-careers-1480';
const HRSA_NURSING_PROJECTIONS =
    'https://bhw.hrsa.gov/sites/default/files/bureau-health-workforce/data-research/nursing-projections-factsheet.pdf';

/**
 * Per-post allowlists, copied from the research stage's
 * <scratchpad>/posts/<slug>/allow.json. Entries that duplicate a canonical
 * figure ("41%") are left out on purpose: the canonical set above covers
 * them, and listing them here too would let a stale copy keep passing after
 * lib/stats-sources.ts moves to a new vintage.
 */
const POSTS: Record<string, readonly AllowedFigure[]> = {
    'np-student-loan-limits-professional-degree': [
        { figure: '$20,500', source: FSA_LOAN_FAQ },
        { figure: '$100,000', source: FSA_LOAN_FAQ },
        { figure: '$50,000', source: FSA_LOAN_FAQ },
        { figure: '$200,000', source: FSA_LOAN_FAQ },
        { figure: '$257,500', source: FSA_LOAN_FAQ },
        { figure: '$138,500', source: FSA_LOAN_FAQ },
        { figure: '$5,250', source: 'https://www.irs.gov/newsroom/updates-to-frequently-asked-questions-about-educational-assistance-programs' },
        { figure: '6.8%', source: AACN_ENROLLMENT_2025 },
        { figure: '5.9%', source: AACN_ENROLLMENT_2025 },
        { figure: '78%', source: 'https://www.aacnnursing.org/Portals/0/PDFs/Data/AACN-Data-Loan-Cap-Survey-Report-December-2025.pdf' },
    ],
    'can-nurse-practitioners-prescribe-controlled-substances': [
        { figure: '$888', source: 'https://www.ecfr.gov/current/title-21/section-1301.13' },
    ],
    'aprn-compact-states': [],
    'nurse-practitioner-job-outlook': [
        { figure: '41.0%', source: 'https://www.bls.gov/emp/tables/fastest-growing-occupations.htm' },
        { figure: '3.5%', source: 'https://www.bls.gov/news.release/ecopro.nr0.htm' },
        { figure: '175%', source: HRSA_NURSING_PROJECTIONS },
        { figure: '126%', source: HRSA_NURSING_PROJECTIONS },
        { figure: '6.8%', source: AACN_ENROLLMENT_2025 },
        { figure: '5.9%', source: AACN_ENROLLMENT_2025 },
    ],
    'np-fellowship-residency-programs': [
        {
            figure: '$90,532',
            source: 'https://www.va.gov/northern-california-health-care/work-with-us/internships-and-fellowships/nurse-practitioner-residency-program-npr/',
        },
    ],
    // allow.json also listed "41.0%" (BLS release USDL-26-1422), but the
    // post quotes it as "+41.0 percent", so no percent-sign figure needs it.
    'nurse-practitioner-week-2026': [],
    'nurse-practitioner-noncompete-laws': [
        { figure: '$10,000', source: 'https://lis.blob.core.windows.net/files/1225699.PDF' },
    ],
    'non-clinical-nurse-practitioner-jobs': [],
    'what-is-an-aprn': [],
    'how-to-become-a-nurse-practitioner': [
        { figure: '$20,500', source: FSA_LOAN_FAQ },
        { figure: '$100,000', source: FSA_LOAN_FAQ },
        { figure: '$50,000', source: FSA_LOAN_FAQ },
        { figure: '$200,000', source: FSA_LOAN_FAQ },
    ],
};

const SLUGS = Object.keys(POSTS);
const CATEGORY_IDS = new Set<string>(BLOG_CATEGORIES.map((c) => c.id));

interface ParsedPost {
    slug: string;
    raw: string;
    fm: Record<string, string>;
    body: string;
}

/** Same frontmatter semantics as lib/blog-mdx-posts.ts and the P3 to P5 suites. */
function parsePost(slug: string): ParsedPost {
    const raw = fs.readFileSync(path.join(BLOG_DIR, `${slug}.mdx`), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    const fm: Record<string, string> = {};
    if (m) {
        for (const line of m[1].split(/\r?\n/)) {
            const idx = line.indexOf(':');
            if (idx <= 0) continue;
            let value = line.slice(idx + 1).trim();
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))
            ) {
                value = value.slice(1, -1);
            }
            fm[line.slice(0, idx).trim()] = value;
        }
    }
    return { slug, raw, fm, body: m ? m[2] : raw };
}

const POSTS_PARSED = SLUGS.map(parsePost);

/** Removes link targets and code spans, so URLs and code cannot trip a prose rule. */
function stripLinksAndCode(text: string): string {
    return text.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']');
}

/** Paragraphs, list items and table rows: the unit a figure travels in when quoted. */
function blocks(body: string): string[] {
    return body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** H2 sections, each with its heading line, for back-references like "the 41% figure". */
function sections(body: string): string[] {
    return body.split(/^(?=## )/m);
}

/** The text of one H2 section, up to the next H2. */
function sectionAfter(body: string, heading: RegExp): string {
    const parts = body.split(heading);
    if (parts.length < 2) return '';
    return parts[1].split(/^## /m)[0];
}

const DOLLAR_RE = /\$\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|million|billion|M|B)\b)?/g;
const PERCENT_RE = /\b\d+(?:\.\d+)?\s?%/g;

describe('October 2026 posts: frontmatter', () => {
    for (const { slug, fm } of POSTS_PARSED) {
        it(`${slug}: title, description, category, dates`, () => {
            expect(fm.slug, `${slug}: slug missing or mismatched`).toBe(slug);

            expect(fm.title, `${slug}: title missing`).toBeTruthy();
            expect(fm.title.length, `${slug}: title is ${fm.title.length} characters`).toBeLessThanOrEqual(70);

            expect(fm.description, `${slug}: description missing`).toBeTruthy();
            const d = fm.description.length;
            expect(d, `${slug}: description is ${d} characters (110 to 170)`).toBeGreaterThanOrEqual(110);
            expect(d, `${slug}: description is ${d} characters (110 to 170)`).toBeLessThanOrEqual(170);

            expect(CATEGORY_IDS.has(fm.category), `${slug}: invalid category '${fm.category}'`).toBe(true);
            // state_spotlight routes into the /resources licensure grid, where a
            // non-license slug is dropped by the regex filter and appears nowhere.
            expect(fm.category).not.toBe('state_spotlight');
            expect(LICENSE_GUIDE_SLUG_REGEX.test(slug)).toBe(false);

            for (const key of ['date', 'reviewed'] as const) {
                const value = fm[key];
                expect(value, `${slug}: ${key} is not an ISO date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                const parsed = new Date(`${value}T00:00:00Z`);
                expect(Number.isNaN(parsed.getTime()), `${slug}: ${key} ${value} is not a real date`).toBe(false);
                expect(parsed.toISOString().slice(0, 10), `${slug}: ${key} ${value} rolled over`).toBe(value);
                expect(parsed.getTime(), `${slug}: ${key} ${value} is in the future`).toBeLessThanOrEqual(Date.now());
            }
            expect(fm.reviewed >= fm.date, `${slug}: reviewed precedes date`).toBe(true);
        });

        it(`${slug}: filed under a category /resources styles`, () => {
            const resources = read('app/resources/page.tsx');
            expect(
                resources,
                `app/resources/page.tsx has no CATEGORY_CONFIG entry for '${fm.category}', so the group renders under the raw id`,
            ).toContain(`${fm.category}: { label:`);
        });
    }
});

describe('October 2026 posts: answer-engine shape', () => {
    for (const { slug, body } of POSTS_PARSED) {
        it(`${slug}: opens with a Quick answer paragraph`, () => {
            const first = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
            // Hoisted into the .ed-quick-answer callout by app/blog/[slug]/page.tsx.
            expect(first, `${slug}: first paragraph is not the Quick answer`).toMatch(/^\*\*Quick answer:\*\*\s+\S/);
            const words = first.replace(/^\*\*Quick answer:\*\*/, '').trim().split(/\s+/).length;
            expect(words, `${slug}: quick answer is ${words} words`).toBeGreaterThanOrEqual(30);
        });

        it(`${slug}: FAQ section with at least 5 question entries`, () => {
            const headings = body.match(/^## Frequently asked questions\s*$/gm) ?? [];
            expect(headings.length, `${slug}: needs exactly one FAQ heading`).toBe(1);
            const faq = sectionAfter(body, /^## Frequently asked questions\s*$/m);
            const questions = faq.match(/^### .+$/gm) ?? [];
            expect(questions.length, `${slug}: ${questions.length} FAQ entries`).toBeGreaterThanOrEqual(5);
            for (const q of questions) {
                expect(q.trim(), `${slug}: FAQ heading is not a question: ${q}`).toMatch(/\?$/);
                const after = faq.slice(faq.indexOf(q) + q.length);
                const answer = after.split(/^### /m)[0].replace(/[#*`>|]/g, '').trim();
                expect(answer.length, `${slug}: FAQ "${q}" has no answer body`).toBeGreaterThan(60);
            }
        });

        it(`${slug}: Sources is the last H2 and cites at least 3 https links`, () => {
            const h2s = body.match(/^## .+$/gm) ?? [];
            expect(h2s.at(-1)?.trim(), `${slug}: last H2 is not Sources`).toBe('## Sources');
            const sources = sectionAfter(body, /^## Sources\s*$/m);
            const urls = [...sources.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
            expect(urls.length, `${slug}: Sources cites ${urls.length} links`).toBeGreaterThanOrEqual(3);
            for (const url of urls) {
                expect(url.startsWith('https://'), `${slug}: non-https source ${url}`).toBe(true);
            }
        });

        it(`${slug}: no hand-written byline (the page renders EditorialByline)`, () => {
            expect(body, `${slug}: hand-written byline in post copy`).not.toMatch(/reviewed by|written by/i);
        });

        it(`${slug}: renders through the repo converter without leaking markdown`, () => {
            const html = markdownToHtml(body);
            expect(html, `${slug}: unconverted bold markers`).not.toMatch(/\*\*/);
            const outsideTables = html.replace(/<table[\s\S]*?<\/table>/g, '');
            expect(outsideTables, `${slug}: a markdown table did not parse`).not.toMatch(/\|\s*---/);
        });
    }
});

describe('October 2026 posts: house style', () => {
    for (const { slug, raw, fm } of POSTS_PARSED) {
        it(`${slug}: no em dash, en dash or spaced hyphen used as a dash`, () => {
            const offenders: string[] = [];
            raw.split(/\r?\n/).forEach((line, i) => {
                const text = stripLinksAndCode(line);
                if (text.includes(EM_DASH) || text.includes(EN_DASH)) offenders.push(`line ${i + 1}: em or en dash`);
                const trimmed = text.trim();
                if (/^-{3,}$/.test(trimmed)) return; // frontmatter fence or horizontal rule
                const prose = trimmed.startsWith('|')
                    ? trimmed.replace(/\|\s*:?-{3,}:?\s*/g, '|') // table separator cells
                    : trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''); // list markers
                if (/\S\s-\s\S/.test(prose) || /\s--\s|\w--\w/.test(prose)) {
                    offenders.push(`line ${i + 1}: spaced or double hyphen: ${trimmed.slice(0, 80)}`);
                }
            });
            for (const key of ['title', 'description'] as const) {
                if (/\s-\s|--/.test(fm[key] ?? '')) offenders.push(`frontmatter ${key}: dash used as punctuation`);
            }
            expect(offenders, `${slug}: dash punctuation`).toEqual([]);
        });
    }
});

describe('October 2026 posts: internal links resolve', () => {
    /** True when `/a/b` is served by app/a/b/page.tsx (dynamic segments allowed). */
    function appRouteExists(pathname: string): boolean {
        const segments = pathname.split('/').filter(Boolean);
        let dir = APP_DIR;
        for (const segment of segments) {
            const literal = path.join(dir, segment);
            if (fs.existsSync(literal) && fs.statSync(literal).isDirectory()) {
                dir = literal;
                continue;
            }
            const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
            // Route groups like (marketing) are invisible in the URL.
            const group = entries.find((e) => /^\(.+\)$/.test(e.name) && fs.existsSync(path.join(dir, e.name, segment)));
            if (group) {
                dir = path.join(dir, group.name, segment);
                continue;
            }
            const dynamic = entries.find((e) => /^\[.+\]$/.test(e.name));
            if (!dynamic) return false;
            dir = path.join(dir, dynamic.name);
        }
        return ['page.tsx', 'page.ts', 'route.ts'].some((f) => fs.existsSync(path.join(dir, f)));
    }

    function resolves(href: string): boolean {
        const pathname = href.split(/[?#]/)[0].replace(/\/$/, '') || '/';
        if (pathname === '/') return fs.existsSync(path.join(APP_DIR, 'page.tsx'));
        const blog = pathname.match(/^\/blog\/([^/]+)$/);
        if (blog) {
            return fs.existsSync(path.join(BLOG_DIR, `${blog[1]}.mdx`)) || LICENSE_GUIDE_SLUG_REGEX.test(blog[1]);
        }
        return appRouteExists(pathname);
    }

    for (const { slug, body } of POSTS_PARSED) {
        it(`${slug}: every internal href reaches a real page`, () => {
            const hrefs = [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
            expect(hrefs.length, `${slug}: fewer than 5 internal links`).toBeGreaterThanOrEqual(5);
            const dead = [...new Set(hrefs)].filter((h) => !resolves(h));
            expect(dead, `${slug}: internal href(s) with no route`).toEqual([]);
        });
    }
});

describe('October 2026 posts: every figure traces to a source', () => {
    it('no allowlist entry shadows a canonical figure, and every source is https', () => {
        for (const [slug, figures] of Object.entries(POSTS)) {
            for (const { figure, source } of figures) {
                expect(CANONICAL_DOLLARS.has(figure) || CANONICAL_PERCENTS.has(figure), `${slug}: ${figure} is canonical`).toBe(false);
                expect(source.startsWith('https://'), `${slug}: ${figure} source is not https`).toBe(true);
            }
        }
    });

    for (const { slug, body, fm } of POSTS_PARSED) {
        const allowed = new Set(POSTS[slug].map((f) => f.figure));
        const text = stripLinksAndCode(`${fm.title}\n${fm.description}\n${body}`);

        it(`${slug}: every dollar figure is canonical or allowlisted`, () => {
            const stray = [...text.matchAll(DOLLAR_RE)]
                .map((m) => m[0].trim())
                .filter((f) => !CANONICAL_DOLLARS.has(f) && !allowed.has(f));
            expect(stray, `${slug}: unsourced dollar figure(s)`).toEqual([]);
        });

        it(`${slug}: every percentage is canonical or allowlisted`, () => {
            const stray = [...text.matchAll(PERCENT_RE)]
                .map((m) => m[0].replace(/\s/g, ''))
                .filter((f) => !CANONICAL_PERCENTS.has(f) && !allowed.has(f));
            expect(stray, `${slug}: unsourced percentage(s)`).toEqual([]);
        });

        it(`${slug}: every allowlisted figure is still printed (no dead entries)`, () => {
            for (const figure of allowed) {
                expect(text.includes(figure), `${slug}: allowlist entry ${figure} no longer appears; drop it`).toBe(true);
            }
        });
    }
});

describe('October 2026 posts: canonical statistic contracts', () => {
    for (const { slug, body, fm } of POSTS_PARSED) {
        it(`${slug}: the NP median carries BLS and May 2025 and is never called an average`, () => {
            const units = [fm.description, ...blocks(body)].filter((b) => b.includes(MEDIAN));
            for (const unit of units) {
                expect(unit, `${slug}: median without BLS: ${unit.slice(0, 80)}`).toMatch(/\bBLS\b|Bureau of Labor Statistics/);
                expect(unit, `${slug}: median without the May 2025 vintage: ${unit.slice(0, 80)}`).toContain('May 2025');
                for (const sentence of unit.split(/(?<=[.;])\s+/).filter((s) => s.includes(MEDIAN))) {
                    expect(
                        sentence.replace(/not an average/gi, ''),
                        `${slug}: the BLS median is called an average`,
                    ).not.toMatch(/\baverage\b/i);
                }
            }
        });

        it(`${slug}: the growth figure carries BLS and 2025 to 2035`, () => {
            const growth = /(?<![\d.])41(?:\.0)?%/;
            // The description and the quick answer are lifted out of context,
            // so each must carry the attribution itself; a body mention may
            // lean on its H2 section ("the 41% figure comes from ...").
            const standalone = [fm.description, body.split(/\r?\n/).find((l) => l.trim()) ?? ''];
            for (const unit of standalone.filter((u) => growth.test(u))) {
                expect(unit, `${slug}: growth without BLS`).toMatch(/\bBLS\b|Bureau of Labor Statistics/);
                expect(unit, `${slug}: growth without the 2025 to 2035 cycle`).toContain('2025 to 2035');
            }
            for (const section of sections(body).filter((s) => growth.test(s))) {
                expect(section, `${slug}: growth without BLS in its section`).toMatch(/\bBLS\b|Bureau of Labor Statistics/);
                expect(section, `${slug}: growth without the 2025 to 2035 cycle in its section`).toContain('2025 to 2035');
            }
            // The retired cycle never comes back.
            expect(body, `${slug}: stale projection cycle`).not.toMatch(/2024 to 2034|2022 to 2032|by 2034|by 2032/);
            expect(GROWTH).toBe(`${STAT_SOURCES.blsGrowth2035.value}%`);
        });

        it(`${slug}: any "27 states" claim links AANP and carries the transition-to-practice caveat`, () => {
            const fpa = new RegExp(`\\b${STAT_SOURCES.fullPracticeStates.value} states\\b`);
            for (const unit of blocks(body).filter((b) => fpa.test(b))) {
                expect(unit, `${slug}: FPA count without the AANP link: ${unit.slice(0, 80)}`).toContain(`](${FPA_URL})`);
            }
            for (const section of sections(body).filter((s) => fpa.test(s))) {
                expect(section, `${slug}: FPA count without the transition-to-practice caveat`).toMatch(/transition-to-practice/i);
            }
        });
    }

    it('the canonical figures are actually cited somewhere in the release', () => {
        const all = POSTS_PARSED.map((p) => p.body).join('\n');
        expect(all).toContain(MEDIAN);
        expect(all).toContain(GROWTH);
        expect(all).toContain(FPA_URL);
    });
});

/**
 * Owner house style since 2026-09-12: no em dash and no en dash in any
 * user-visible copy. Every post in content/blog is user-visible, so the
 * guard covers the whole directory, not only this release.
 */
describe('sitewide guard: content/blog', () => {
    it('no .mdx post contains an em dash or an en dash', () => {
        const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.mdx'));
        expect(files.length).toBeGreaterThan(SLUGS.length);
        const offenders = files.flatMap((file) =>
            fs
                .readFileSync(path.join(BLOG_DIR, file), 'utf8')
                .split(/\r?\n/)
                .map((line, i) => ({ line, i }))
                .filter(({ line }) => line.includes(EM_DASH) || line.includes(EN_DASH))
                .map(({ i }) => `${file}:${i + 1}`),
        );
        expect(offenders, 'em or en dash in content/blog').toEqual([]);
    });
});

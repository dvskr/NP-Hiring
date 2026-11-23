/**
 * The two definition guides shipped 2026-11-23:
 *   /resources/what-is-a-nurse-practitioner  ("what is a nurse practitioner", "np meaning", "dnp vs np")
 *   /resources/np-vs-pa                      ("np vs pa", "nurse practitioner vs physician assistant")
 *
 * Every check reads the rendered page or the data it renders, never the
 * source text's shape:
 *   1. metadata fits the SERP: title page part <= 48 (the root layout adds
 *      " | NP Hiring"), description <= 155, self canonical, the /api/og card
 *   2. the quick answer is the first thing under the H1 and runs 40 to 60 words
 *   3. the FAQPage JSON-LD is the visible FAQ, question for question
 *   4. Article and BreadcrumbList JSON-LD carry the organization and the page date
 *   5. no copy carries an em dash, an en dash, a spaced hyphen, "best" or "#1"
 *   6. every number the copy prints comes from lib/stats-sources.ts or from a
 *      figure registered with a source the page lists
 *   7. every internal link resolves to a route under app/ (a blog link to its post)
 *   8. NP figures follow lib/stats-sources.ts (a changed figure reaches the copy)
 *   9. the hand-verified figures share the stats-sources vintage and add up
 *  10. the new files add no reference-niche copy
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Metadata } from 'next';
import { brand } from '@/config/brand';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';
import { editorialSchemaFields } from '@/components/EditorialByline';
import * as whatIsRoute from '@/app/resources/what-is-a-nurse-practitioner/page';
import * as npVsPaRoute from '@/app/resources/np-vs-pa/page';
import { WHAT_IS_A_NURSE_PRACTITIONER } from '@/app/resources/what-is-a-nurse-practitioner/content';
import { NP_VS_PA } from '@/app/resources/np-vs-pa/content';
import {
    formatGuideDate,
    monthYear,
    plainText,
    serializeJsonLd,
    SITE_ORGANIZATION,
    type GuideContent,
} from '@/app/resources/what-is-a-nurse-practitioner/guide-model';
import { BLS_PROJECTIONS, PA_MEDIAN_WAGE } from '@/app/resources/what-is-a-nurse-practitioner/verified-facts';
import { scanNicheCopyDebt } from '../regressions/brand-leak-scan';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'app');
const PAGE_DATE = '2026-11-23';
const GUIDE_DIRS = ['app/resources/what-is-a-nurse-practitioner/', 'app/resources/np-vs-pa/'];

interface GuideCase {
    readonly name: string;
    readonly guide: GuideContent;
    readonly route: { default: () => React.ReactElement; metadata: Metadata; revalidate: number | false };
    readonly requiredLinks: readonly string[];
}

const CASES: readonly GuideCase[] = [
    {
        name: 'what-is-a-nurse-practitioner',
        guide: WHAT_IS_A_NURSE_PRACTITIONER,
        route: whatIsRoute,
        requiredLinks: [
            '/resources/np-vs-pa',
            '/blog/how-to-become-a-nurse-practitioner',
            '/blog/fnp-certification-aanp-vs-ancc',
            '/blog/what-is-an-aprn',
            '/scope-of-practice',
            '/resources/fpa-guide',
            '/jobs/family-practice',
            '/jobs/adult-gerontology',
            '/jobs/acute-care',
            '/jobs/pediatric',
            '/jobs/psychiatric-mental-health',
            '/jobs/women-health',
            '/jobs/neonatal',
            '/jobs/remote',
            '/jobs/telehealth',
            '/jobs/hospital',
            '/jobs/primary-care',
            '/salary-guide',
            '/jobs',
        ],
    },
    {
        name: 'np-vs-pa',
        guide: NP_VS_PA,
        route: npVsPaRoute,
        requiredLinks: ['/resources/what-is-a-nurse-practitioner', '/scope-of-practice', '/jobs'],
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const render = (route: GuideCase['route']): string => renderToStaticMarkup(React.createElement(route.default));

const decode = (html: string): string =>
    html
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');

/** The text a reader sees: scripts and styles dropped, tags to spaces, entities decoded. */
const visibleText = (html: string): string =>
    decode(
        html
            .replace(/<script[\s\S]*?<\/script>/g, ' ')
            .replace(/<style[\s\S]*?<\/style>/g, ' ')
            .replace(/<[^>]+>/g, ' '),
    )
        .replace(/\s+/g, ' ')
        .trim();

/** Inline text of a fragment, with no padding where tags meet text. */
const inlineText = (html: string): string => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const jsonLdBlocks = (html: string): Array<Record<string, unknown>> =>
    [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
        (match) => JSON.parse(match[1]) as Record<string, unknown>,
    );

const ldOfType = (html: string, type: string): Record<string, unknown> => {
    const found = jsonLdBlocks(html).filter((block) => block['@type'] === type);
    expect(found, `${type} JSON-LD blocks`).toHaveLength(1);
    return found[0];
};

/** Keys whose values are addresses or switches, not copy. */
const NON_COPY_KEYS = new Set(['href', 'url', 'sourceUrl', 'path', 'id', 'icon', 'heroTone', 'heroIcon', 'kind', 'datePublished', 'dateModified', 'figures']);

/** Every copy string in a guide's data: what the page, its metadata and its JSON-LD print. */
function copyStrings(value: unknown, key = ''): string[] {
    if (NON_COPY_KEYS.has(key)) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap((item) => copyStrings(item));
    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([childKey, child]) => copyStrings(child, childKey));
    }
    return [];
}

/** Every href in a guide's data. */
function dataHrefs(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(dataHrefs);
    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, child]) =>
            key === 'href' && typeof child === 'string' ? [child] : dataHrefs(child),
        );
    }
    return [];
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const NUMBER_WORD = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi;

const numberTokens = (text: string): string[] => (text.match(NUMBER) ?? []).map((token) => token.replace(/,/g, ''));
const numberWords = (text: string): string[] => (text.match(NUMBER_WORD) ?? []).map((word) => word.toLowerCase());

/** Numbers the copy may print: stats-sources figures and vintages, registered figures, the page date. */
function allowedNumbers(guide: GuideContent): { tokens: Set<string>; words: Set<string> } {
    const stats = Object.values(STAT_SOURCES).flatMap((stat) => [stat.formatted, stat.value, stat.source, stat.asOf, monthYear(stat.asOf)]);
    const dates = [guide.datePublished, guide.dateModified, formatGuideDate(guide.dateModified)];
    const figures = guide.figures.map((figure) => figure.text);
    return {
        tokens: new Set([...stats, ...dates, ...figures].flatMap(numberTokens)),
        words: new Set(figures.flatMap(numberWords)),
    };
}

const PAGE_FILES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js', 'page.mdx'];

/** True when an internal path resolves to a page under app/, a dynamic segment standing in for any value. */
function routeExists(pathname: string): boolean {
    const segments = pathname.split('/').filter(Boolean);
    let dir = APP_DIR;
    for (const segment of segments) {
        const literal = path.join(dir, segment);
        if (fs.existsSync(literal) && fs.statSync(literal).isDirectory()) {
            dir = literal;
            continue;
        }
        const dynamic = fs.readdirSync(dir, { withFileTypes: true }).find((entry) => entry.isDirectory() && /^\[.+\]$/.test(entry.name));
        if (!dynamic) return false;
        dir = path.join(dir, dynamic.name);
    }
    if (!PAGE_FILES.some((file) => fs.existsSync(path.join(dir, file)))) return false;
    // A blog link must also name a post the site serves from code.
    if (segments[0] === 'blog' && segments.length === 2) {
        return fs.existsSync(path.join(ROOT, 'content', 'blog', `${segments[1]}.mdx`));
    }
    return true;
}

// ─── 1. Metadata ─────────────────────────────────────────────────────────────

describe.each(CASES)('$name: metadata', ({ guide, route }) => {
    const { metadata } = route;

    it('the title page part fits in 48 characters, so the full title fits in 60', () => {
        expect(typeof metadata.title).toBe('string');
        const title = metadata.title as string;
        expect(title).toBe(guide.title);
        expect(title.length).toBeLessThanOrEqual(48);
        expect(`${title} | ${brand.name}`.length).toBeLessThanOrEqual(60);
        expect(title).not.toContain(brand.name);
    });

    it('the description fits in 155 characters', () => {
        expect(metadata.description).toBe(guide.description);
        expect((metadata.description ?? '').length).toBeLessThanOrEqual(155);
        expect((metadata.description ?? '').length).toBeGreaterThan(70);
    });

    it('the canonical is the page itself on the brand domain', () => {
        expect(metadata.alternates?.canonical).toBe(`${brand.baseUrl}${guide.path}`);
        expect(metadata.openGraph?.url).toBe(`${brand.baseUrl}${guide.path}`);
    });

    it('the share image is the board\'s own /api/og page card', () => {
        const images = metadata.openGraph?.images as Array<{ url: string; width: number; height: number }>;
        expect(images).toHaveLength(1);
        const card = new URL(images[0].url);
        expect(card.origin).toBe(brand.baseUrl);
        expect(card.pathname).toBe('/api/og');
        expect(card.searchParams.get('type')).toBe('page');
        expect(card.searchParams.get('title')).toBe(guide.ogTitle);
        expect([images[0].width, images[0].height]).toEqual([1200, 630]);
    });

    it('renders statically: a static revalidate and a page that takes no props', () => {
        expect(route.revalidate).toBe(false);
        expect(route.default.length).toBe(0);
    });
});

// ─── 2 to 4. The rendered page and its structured data ──────────────────────

describe.each(CASES)('$name: the rendered page', ({ guide, route }) => {
    const html = render(route);

    it('has one H1, and the quick answer is the first thing under it', () => {
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        const afterH1 = html.slice(html.indexOf('</h1>') + '</h1>'.length);
        expect(visibleText(afterH1).startsWith(guide.quickAnswer)).toBe(true);
    });

    it('the quick answer runs 40 to 60 words', () => {
        const words = guide.quickAnswer.trim().split(/\s+/).length;
        expect(words).toBeGreaterThanOrEqual(40);
        expect(words).toBeLessThanOrEqual(60);
    });

    it('the FAQPage JSON-LD is the visible FAQ, question for question', () => {
        const data = guide.faqs.map((faq) => ({ question: faq.question, answer: plainText(faq.answer) }));
        const faqPage = ldOfType(html, 'FAQPage');
        const marked = (faqPage.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>).map((entity) => ({
            question: entity.name,
            answer: entity.acceptedAnswer.text,
        }));
        const questions = [...html.matchAll(/<h3[^>]*data-faq-question[^>]*>([\s\S]*?)<\/h3>/g)].map((match) => inlineText(match[1]));
        const answers = [...html.matchAll(/<p[^>]*data-faq-answer[^>]*>([\s\S]*?)<\/p>/g)].map((match) => inlineText(match[1]));
        const visible = questions.map((question, index) => ({ question, answer: answers[index] }));

        expect(data.length).toBeGreaterThanOrEqual(5);
        expect(data.length).toBeLessThanOrEqual(7);
        expect(marked).toEqual(data);
        expect(visible).toEqual(data);
    });

    it('the Article JSON-LD names the organization and carries the page date', () => {
        const article = ldOfType(html, 'Article');
        const organization = {
            '@type': 'Organization',
            '@id': `${brand.baseUrl}/#organization`,
            name: brand.name,
            url: brand.baseUrl,
        };
        expect(SITE_ORGANIZATION).toEqual(organization);
        expect(article.publisher).toEqual(organization);
        // The Organization until a real author is configured (brand.editorial.author).
        expect(article.author).toEqual(editorialSchemaFields().author ?? organization);
        expect(article.headline).toBe(guide.title);
        expect(article.description).toBe(guide.description);
        expect(article.datePublished).toBe(PAGE_DATE);
        expect(article.dateModified).toBe(PAGE_DATE);
        expect(article.mainEntityOfPage).toEqual({ '@type': 'WebPage', '@id': `${brand.baseUrl}${guide.path}` });
    });

    it('shows the update date the Article JSON-LD carries', () => {
        expect(html).toMatch(/Updated <time date[Tt]ime="2026-11-23">November 23, 2026<\/time>/);
    });

    it('the BreadcrumbList ends at the page', () => {
        const crumbs = ldOfType(html, 'BreadcrumbList').itemListElement as Array<{ name: string; item: string; position: number }>;
        expect(crumbs.map((crumb) => crumb.item)).toEqual([brand.baseUrl, `${brand.baseUrl}/resources`, `${brand.baseUrl}${guide.path}`]);
        expect(crumbs.map((crumb) => crumb.position)).toEqual([1, 2, 3]);
        expect(crumbs[2].name).toBe(guide.crumb);
    });

    it('no JSON-LD block carries a raw angle bracket', () => {
        for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
            expect(match[1]).not.toMatch(/[<>]/);
        }
    });
});

describe('the JSON-LD serializer', () => {
    it('escapes < and > so a value can never close the script element', () => {
        const serialized = serializeJsonLd({ text: '</script><img src=x>' });
        expect(serialized).not.toMatch(/[<>]/);
        expect(JSON.parse(serialized)).toEqual({ text: '</script><img src=x>' });
    });
});

// ─── 5. Copy rules ───────────────────────────────────────────────────────────

const FORBIDDEN_COPY: ReadonlyArray<[RegExp, string]> = [
    [/—/, 'em dash'],
    [/–/, 'en dash'],
    [/ - /, 'spaced hyphen'],
    [/\bbest\b/i, 'the word "best"'],
    [/#1\b/, '"#1"'],
];

describe.each(CASES)('$name: copy rules', ({ guide, route }) => {
    it('no copy string carries an em dash, an en dash, a spaced hyphen, "best" or "#1"', () => {
        const texts = [...copyStrings(guide), visibleText(render(route))];
        const hits = texts.flatMap((text) =>
            FORBIDDEN_COPY.filter(([pattern]) => pattern.test(text)).map(([, rule]) => `${rule}: ${text.slice(0, 120)}`),
        );
        expect(hits).toEqual([]);
    });
});

// ─── 6. Numbers ──────────────────────────────────────────────────────────────

describe.each(CASES)('$name: every number has a source', ({ guide, route }) => {
    const sourceUrls = new Set(guide.sources.map((source) => source.url));
    const copy = copyStrings(guide);

    it('every number the copy prints comes from lib/stats-sources.ts or a registered figure', () => {
        const { tokens, words } = allowedNumbers(guide);
        const texts = [...copy, visibleText(render(route))];
        const unsourced = texts.flatMap((text) => [
            ...numberTokens(text).filter((token) => !tokens.has(token)).map((token) => `${token} in: ${text.slice(0, 100)}`),
            ...numberWords(text).filter((word) => !words.has(word)).map((word) => `"${word}" in: ${text.slice(0, 100)}`),
        ]);
        expect(unsourced).toEqual([]);
    });

    it('every registered figure cites a source the page lists, and the copy prints it', () => {
        for (const figure of guide.figures) {
            expect(sourceUrls.has(figure.sourceUrl), `${figure.text}: ${figure.sourceUrl} is not in the sources list`).toBe(true);
            expect(copy.some((text) => text.includes(figure.text)), `${figure.text} (${figure.claim}) is registered but never printed`).toBe(true);
        }
    });

    it('every stats-sources figure the page cites lists its source', () => {
        for (const stat of Object.values(STAT_SOURCES)) {
            if (copy.some((text) => text.includes(stat.formatted))) {
                expect(sourceUrls.has(stat.sourceUrl), `${stat.formatted}: ${stat.sourceUrl}`).toBe(true);
            }
        }
    });

    it('every source is an https URL, listed once', () => {
        expect(sourceUrls.size).toBe(guide.sources.length);
        for (const url of sourceUrls) expect(new URL(url).protocol).toBe('https:');
    });
});

// ─── 7. Links ────────────────────────────────────────────────────────────────

describe.each(CASES)('$name: links', ({ guide, route, requiredLinks }) => {
    const html = render(route);
    const renderedHrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => decode(match[1]));
    const internal = [...new Set([...dataHrefs(guide), ...renderedHrefs])].filter((href) => href.startsWith('/') && !href.startsWith('//'));

    it('every internal href resolves to a route under app/', () => {
        const broken = internal.filter((href) => !routeExists(href.split(/[?#]/)[0]));
        expect(broken).toEqual([]);
    });

    it('every in-page anchor points at an element on the page', () => {
        const anchors = [...new Set([...dataHrefs(guide), ...renderedHrefs].filter((href) => href.startsWith('#')))];
        for (const anchor of anchors) expect(html, anchor).toContain(`id="${anchor.slice(1)}"`);
    });

    it('links the pages and hubs it is meant to', () => {
        for (const href of requiredLinks) expect(internal, href).toContain(href);
    });
});

describe('what-is-a-nurse-practitioner: the population foci', () => {
    const html = render(whatIsRoute);

    it('derives the behavioral health track from the taxonomy registry', () => {
        expect(PSYCH_SPECIALTY_SLUG).toBe('psychiatric-mental-health');
        expect(html).toContain('>PMHNP</p>');
        expect(html).toContain('Psychiatric Mental Health Nurse Practitioner');
        expect(html).toContain('href="/jobs/psychiatric-mental-health"');
        expect(visibleText(html)).toContain('psychiatric mental health (PMHNP-BC)');
    });

    it('covers the sub-questions readers ask, each in its own H2', () => {
        const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((match) => inlineText(match[1]));
        for (const topic of [/Stand For/, /Do\?$/, /vs Physician vs Physician Assistant/, /Become/, /Certify/, /Practice Authority/, /Population Foci/, /Make\?/, /Job Outlook/, /Work\?/, /^DNP vs NP/, /Frequently Asked Questions/, /^Sources$/]) {
            expect(headings.some((heading) => topic.test(heading)), String(topic)).toBe(true);
        }
    });
});

describe('np-vs-pa: the side by side table', () => {
    it('compares the rows readers ask about', () => {
        const table = NP_VS_PA.sections.flatMap((section) => section.blocks).find((block) => block.kind === 'table');
        expect(table?.kind).toBe('table');
        const labels = table && table.kind === 'table' ? table.rows.map((row) => row.label) : [];
        for (const label of [/^Education model$/, /^Degree and program length$/, /^Clinical hours$/, /^Certifying body and exam$/, /^Recertification$/, /^Practice authority$/, /^Specialty flexibility$/, /^Median pay/, /^Projected growth/]) {
            expect(labels.some((row) => label.test(row)), String(label)).toBe(true);
        }
    });
});

// ─── 8. NP figures follow lib/stats-sources.ts ───────────────────────────────

describe('NP figures are read from lib/stats-sources.ts, never typed', () => {
    it('a changed stats-sources figure reaches both pages, and the old one is gone', async () => {
        const real = STAT_SOURCES;
        const sentinels = {
            median: '$901,001',
            p10: '$901,002',
            p90: '$901,003',
            growth: '97%',
            fullPractice: '49 states + DC',
        };
        vi.resetModules();
        vi.doMock('@/lib/stats-sources', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/lib/stats-sources')>();
            const stats = actual.STAT_SOURCES;
            return {
                ...actual,
                STAT_SOURCES: {
                    ...stats,
                    averageSalary: { ...stats.averageSalary, formatted: sentinels.median },
                    salaryPercentile10: { ...stats.salaryPercentile10, formatted: sentinels.p10 },
                    salaryPercentile90: { ...stats.salaryPercentile90, formatted: sentinels.p90 },
                    blsGrowth2035: { ...stats.blsGrowth2035, formatted: sentinels.growth },
                    fullPracticeStates: { ...stats.fullPracticeStates, formatted: sentinels.fullPractice },
                },
            };
        });
        try {
            const whatIs = (await import('@/app/resources/what-is-a-nurse-practitioner/content')).WHAT_IS_A_NURSE_PRACTITIONER;
            const vsPa = (await import('@/app/resources/np-vs-pa/content')).NP_VS_PA;
            const expectations: Array<[GuideContent, string[], string[]]> = [
                [
                    whatIs,
                    [sentinels.median, sentinels.p10, sentinels.p90, sentinels.growth, sentinels.fullPractice],
                    [real.averageSalary.formatted, real.salaryPercentile10.formatted, real.salaryPercentile90.formatted, real.blsGrowth2035.formatted, real.fullPracticeStates.formatted],
                ],
                [
                    vsPa,
                    [sentinels.median, sentinels.growth, sentinels.fullPractice],
                    [real.averageSalary.formatted, real.blsGrowth2035.formatted, real.fullPracticeStates.formatted],
                ],
            ];
            for (const [guide, present, absent] of expectations) {
                const text = copyStrings(guide).join('\n');
                for (const value of present) expect(text, `${guide.path} should print ${value}`).toContain(value);
                for (const value of absent) expect(text, `${guide.path} still prints ${value}`).not.toContain(value);
            }
        } finally {
            vi.doUnmock('@/lib/stats-sources');
            vi.resetModules();
        }
    });
});

// ─── 9. Hand-verified figures ────────────────────────────────────────────────

describe('hand-verified figures share the stats-sources vintage', () => {
    it('PA pay is from the same OEWS release as the NP median', () => {
        expect(PA_MEDIAN_WAGE.asOf).toBe(STAT_SOURCES.averageSalary.asOf);
    });

    it('employment counts are from the same projections table and cycle as the NP growth rate', () => {
        expect(BLS_PROJECTIONS.sourceUrl).toBe(STAT_SOURCES.blsGrowth2035.sourceUrl);
        expect(STAT_SOURCES.blsGrowth2035.source).toContain(`${BLS_PROJECTIONS.cycle.from} to ${BLS_PROJECTIONS.cycle.to}`);
    });

    it('the projections add up, and the NP counts reproduce the stats-sources growth rate', () => {
        const n = (value: string): number => Number(value.replace(/[^\d.]/g, ''));
        const np = BLS_PROJECTIONS.nursePractitioners;
        const pa = BLS_PROJECTIONS.physicianAssistants;
        expect(n(np.jobsProjected) - n(np.jobsBase)).toBe(n(np.change));
        expect(Math.round(((n(np.jobsProjected) - n(np.jobsBase)) / n(np.jobsBase)) * 100)).toBe(Number(STAT_SOURCES.blsGrowth2035.value));
        expect(Math.round(((n(pa.jobsProjected) - n(pa.jobsBase)) / n(pa.jobsBase)) * 100)).toBe(n(pa.growth));
    });
});

// ─── 10. Niche copy ──────────────────────────────────────────────────────────

describe('the guides add no reference-niche copy', () => {
    it('no file under either guide is in the niche-copy scan', () => {
        const flagged = Object.keys(scanNicheCopyDebt({ root: ROOT })).filter((file) => GUIDE_DIRS.some((dir) => file.startsWith(dir)));
        expect(flagged).toEqual([]);
    });
});

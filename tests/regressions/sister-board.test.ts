/**
 * Sister board routing (owner decision 2026-10-12).
 *
 * NP Hiring covers every NP specialty. Its sister board, PMHNP Hiring
 * (pmhnphiring.com, same company), lists psychiatric NP jobs only. The owner
 * asked for psych-only job seekers and psych employers to be routed there:
 *   - a homepage band (lavender stage, sticker cards), one card per audience;
 *   - a callout on the psychiatric category landing;
 *   - a hint under the post-job specialty select, shown only for the psych
 *     specialty. Employers are told to post on BOTH boards, never to leave.
 *
 * Contract pinned here:
 *   - Every sister literal (name, domain, copy) lives in config/, the one
 *     folder the niche-copy and brand-leak scanners skip. Code reads tokens.
 *   - Links carry UTM values pmhnphiring.com's middleware keeps (slugs only).
 *   - Copy follows house style: no em/en dash or spaced hyphen, no figures
 *     (prices change; the sister board is paid while this one runs a promo),
 *     no "free" claim, no ranking claim.
 *   - Every sister block carries data-sister-board, the single marker the E2E
 *     donor-copy guards exempt.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brand } from '@/config/brand';
import { sisterBoard } from '@/config/sister-board';
import { isSisterBoardSpecialty, sisterBoardUrl } from '@/lib/sister-board';
import { CATEGORY_AXES, PSYCH_SPECIALTY_SLUG } from '@/lib/pseo/taxonomy-registry';
import SisterBoardBand, { SISTER_BOARD_BAND_CSS } from '@/components/sister-board/SisterBoardBand';
import SisterBoardHubCallout from '@/components/sister-board/SisterBoardHubCallout';
import SisterBoardPostJobHint from '@/components/sister-board/SisterBoardPostJobHint';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]|\\s-\\s`);
/** pmhnphiring.com middleware drops any utm value that is not a slug like this. */
const UTM_SLUG = /^[a-z0-9._-]{1,100}$/;
const RANKING_CLAIM = /\b(best|#1|number one|top rated|leading|largest|biggest)\b/i;

function collectStrings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
    return [];
}

/** href values of every <a> in rendered markup, entity-decoded. */
function anchors(html: string): Array<{ href: string; tag: string }> {
    return [...html.matchAll(/<a\b[^>]*>/g)].map((m) => ({
        tag: m[0],
        href: (m[0].match(/href="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&'),
    }));
}

const PSYCH = PSYCH_SPECIALTY_SLUG as string;
const OTHER_SPECIALTIES = CATEGORY_AXES.specialty.filter((s) => s !== PSYCH);

describe('sister board config', () => {
    it('names an https board with no trailing slash', () => {
        expect(sisterBoard.name.length).toBeGreaterThan(0);
        expect(sisterBoard.baseUrl).toMatch(/^https:\/\/[a-z0-9.-]+$/);
        expect(new URL(sisterBoard.baseUrl).hostname).toBe('pmhnphiring.com');
    });

    it('uses utm values the sister middleware keeps, one campaign per placement', () => {
        const values = [sisterBoard.utm.source, sisterBoard.utm.medium, ...Object.values(sisterBoard.campaigns)];
        for (const v of values) expect(v, v).toMatch(UTM_SLUG);
        const campaigns = Object.values(sisterBoard.campaigns);
        expect(new Set(campaigns).size).toBe(campaigns.length);
    });

    it('copy follows house style: no dashes, no figures, no free or ranking claims', () => {
        const strings = collectStrings(sisterBoard.copy);
        expect(strings.length).toBeGreaterThan(8);
        for (const s of strings) {
            expect(s, s).not.toMatch(DASH);
            expect(s, `${s}: prices and counts go stale, keep figures off`).not.toMatch(/\d/);
            expect(s, `${s}: the sister board is paid, never call it free`).not.toMatch(/\bfree\b/i);
            expect(s, s).not.toMatch(RANKING_CLAIM);
        }
    });

    it('tells employers to post on both boards rather than leave this one', () => {
        expect(sisterBoard.copy.home.employerCard.desc).toContain(brand.name);
        expect(sisterBoard.copy.postJob.body).toContain(brand.name);
        expect(sisterBoard.copy.postJob.body).toContain(sisterBoard.name);
    });
});

describe('sister board helpers', () => {
    it('builds a tagged absolute url on the sister domain', () => {
        const url = new URL(sisterBoardUrl('jobs', 'homeSeekers'));
        expect(url.origin).toBe(sisterBoard.baseUrl);
        expect(url.pathname).toBe(sisterBoard.paths.jobs);
        expect(url.searchParams.get('utm_source')).toBe(sisterBoard.utm.source);
        expect(url.searchParams.get('utm_medium')).toBe(sisterBoard.utm.medium);
        expect(url.searchParams.get('utm_campaign')).toBe(sisterBoard.campaigns.homeSeekers);
        expect(new URL(sisterBoardUrl('employers', 'postJob')).pathname).toBe(sisterBoard.paths.employers);
    });

    it('matches the psych specialty and nothing else', () => {
        expect(PSYCH_SPECIALTY_SLUG, 'taxonomy must still define the psych specialty').toBeTruthy();
        expect(isSisterBoardSpecialty(PSYCH)).toBe(true);
        for (const slug of OTHER_SPECIALTIES) expect(isSisterBoardSpecialty(slug), slug).toBe(false);
        expect(isSisterBoardSpecialty(undefined)).toBe(false);
        expect(isSisterBoardSpecialty(null)).toBe(false);
        expect(isSisterBoardSpecialty('')).toBe(false);
    });
});

describe('homepage sister band', () => {
    const html = renderToStaticMarkup(React.createElement(SisterBoardBand));

    it('is a named landmark carrying the E2E exemption marker', () => {
        expect(html).toMatch(/<section[^>]*data-sister-board/);
        const labelledBy = html.match(/<section[^>]*aria-labelledby="([^"]+)"/)?.[1];
        expect(labelledBy).toBeTruthy();
        expect(html).toContain(`<h2 id="${labelledBy}"`);
    });

    it('renders both audience cards from config copy', () => {
        const { home } = sisterBoard.copy;
        for (const text of [home.eyebrow, home.heading, home.seekerCard.title, home.employerCard.title, home.seekerCard.action, home.employerCard.action]) {
            expect(html, text).toContain(text);
        }
    });

    it('links each card to its tagged sister url in a new tab', () => {
        const links = anchors(html);
        expect(links.map((l) => l.href)).toEqual([
            sisterBoardUrl('jobs', 'homeSeekers'),
            sisterBoardUrl('employers', 'homeEmployers'),
        ]);
        for (const l of links) {
            expect(l.tag).toContain('target="_blank"');
            expect(l.tag).toMatch(/rel="[^"]*noopener/);
        }
    });

    it('keeps the sticker anatomy on its own lavender stage with static css', () => {
        expect(SISTER_BOARD_BAND_CSS).not.toContain('${');
        expect(SISTER_BOARD_BAND_CSS).toContain('background-color: #EFE8F7');
        expect(SISTER_BOARD_BAND_CSS).toContain('border: 2px solid #7A1C2B');
        expect(SISTER_BOARD_BAND_CSS).toContain('box-shadow: 5px 5px 0 #7A1C2B');
        expect(SISTER_BOARD_BAND_CSS).toMatch(/:focus-visible\s*\{\s*outline: 3px solid #BE185D/);
        expect(SISTER_BOARD_BAND_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transform: none/);
        // Neighbours: powder-blue employer band above, cream blog tape below.
        for (const neighbour of ['#D9EBF6', '#F5F0EB']) expect(SISTER_BOARD_BAND_CSS).not.toContain(neighbour);
    });

    it('sits after the employer band and before the blog tape', () => {
        const page = read('app/page.tsx');
        const employer = page.indexOf('<EmployerHowItWorks');
        const band = page.indexOf('<SisterBoardBand');
        const blog = page.indexOf('<HomepageBlogSection');
        expect(employer).toBeGreaterThan(-1);
        expect(band).toBeGreaterThan(employer);
        expect(blog).toBeGreaterThan(band);
    });
});

describe('psych landing callout', () => {
    it('renders only on the psych category landing', () => {
        for (const slug of OTHER_SPECIALTIES) {
            expect(renderToStaticMarkup(React.createElement(SisterBoardHubCallout, { categorySlug: slug })), slug).toBe('');
        }
        const html = renderToStaticMarkup(React.createElement(SisterBoardHubCallout, { categorySlug: PSYCH }));
        expect(html).toContain('data-sister-board');
        expect(html).toContain(sisterBoard.copy.hub.heading);
        const links = anchors(html);
        expect(links.map((l) => l.href)).toEqual([sisterBoardUrl('jobs', 'hub')]);
        expect(links[0].tag).toContain('target="_blank"');
    });

    it('is wired into the listings sidebar of the category template', () => {
        const template = read('lib/pseo/category-landing-template.tsx');
        expect(template).toMatch(/import SisterBoardHubCallout from '@\/components\/sister-board\/SisterBoardHubCallout'/);
        const sidebar = template.indexOf('lg:col-span-1');
        const callout = template.indexOf('<SisterBoardHubCallout categorySlug={slug}');
        expect(sidebar).toBeGreaterThan(-1);
        expect(callout).toBeGreaterThan(sidebar);
        expect(callout).toBeLessThan(template.indexOf('LAND-L1 MARKET SNAPSHOT'));
    });
});

describe('post-job specialty hint', () => {
    it('appears only when the psych specialty is selected', () => {
        for (const value of [undefined, '', ...OTHER_SPECIALTIES]) {
            expect(renderToStaticMarkup(React.createElement(SisterBoardPostJobHint, { specialty: value })), String(value)).toBe('');
        }
        const html = renderToStaticMarkup(React.createElement(SisterBoardPostJobHint, { specialty: PSYCH }));
        expect(html).toContain('data-sister-board');
        expect(html).toContain(sisterBoard.copy.postJob.body);
        expect(anchors(html).map((l) => l.href)).toEqual([sisterBoardUrl('employers', 'postJob')]);
    });

    it('is driven by the watched specialty field under the select', () => {
        const page = read('app/post-job/page.tsx');
        expect(page).toContain("watch('specialty')");
        const select = page.indexOf('<select id="specialty"');
        const hint = page.indexOf('<SisterBoardPostJobHint specialty=');
        expect(select).toBeGreaterThan(-1);
        expect(hint).toBeGreaterThan(select);
        expect(hint).toBeLessThan(page.indexOf('<select id="setting"'));
    });
});

describe('literals stay in config', () => {
    const files = [
        'lib/sister-board.ts',
        ...fs.readdirSync(path.join(ROOT, 'components', 'sister-board')).map((f) => `components/sister-board/${f}`),
    ];

    it('no sister or niche literal in code files (scanners count comments too)', () => {
        for (const file of files) {
            expect(read(file), file).not.toMatch(/pmhnp|psychiatric|mental health|akari/i);
        }
    });
});

describe('E2E donor-copy guards exempt only the sister marker', () => {
    const helper = read('tests/e2e/helpers/seo.ts');
    const spec = read('tests/e2e/journeys/seo-data-integrity.spec.ts');
    const maxText = Number(helper.match(/export const SISTER_BOARD_MAX_TEXT = (\d+);/)?.[1]);

    it('the helper exports one selector and a size cap, and both guards use them', () => {
        expect(helper).toMatch(/export const SISTER_BOARD_SELECTOR = '\[data-sister-board\]'/);
        expect(maxText).toBeGreaterThan(0);
        const siteCopy = spec.slice(spec.indexOf('async function siteCopyText'), spec.indexOf('const PMHNP_ERA_COPY_RE'));
        expect(siteCopy).toContain('SISTER_BOARD_SELECTOR');
        const basics = spec.slice(spec.indexOf('async function expectPageClassBasics'), spec.indexOf('async function visibleTextOutsideSister'));
        expect(basics).toContain('expectSisterBlocksSmall(page, path)');
        expect(basics).toContain('visibleTextOutsideSister(page)');
        const eraLoop = spec.slice(spec.indexOf('carry no PMHNP-era board copy'));
        expect(eraLoop.slice(0, eraLoop.indexOf('siteCopyText(page)'))).toContain('expectSisterBlocksSmall(page, path)');
    });

    it('reads live rendered text, never a detached clone (its innerText would include the RSC scripts)', () => {
        const fn = spec.slice(spec.indexOf('async function visibleTextOutsideSister'), spec.indexOf('async function expectSisterBlocksSmall'));
        expect(fn).toContain('document.body.innerText');
        expect(fn).not.toContain('cloneNode');
    });

    it('every real sister block fits under the cap', () => {
        const text = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '');
        const blocks = [
            renderToStaticMarkup(React.createElement(SisterBoardBand)),
            renderToStaticMarkup(React.createElement(SisterBoardHubCallout, { categorySlug: PSYCH })),
            renderToStaticMarkup(React.createElement(SisterBoardPostJobHint, { specialty: PSYCH })),
        ];
        for (const html of blocks) expect(text(html).length).toBeLessThan(maxText);
    });
});

describe('homepage card links are named by their titles', () => {
    it('each card link points aria-labelledby at its own title and new-tab note', () => {
        const html = renderToStaticMarkup(React.createElement(SisterBoardBand));
        for (const { tag } of anchors(html)) {
            const ids = tag.match(/aria-labelledby="([^"]+)"/)?.[1].split(' ') ?? [];
            expect(ids.length, tag).toBe(2);
            const [titleId, noteId] = ids;
            expect(html).toMatch(new RegExp(`<h3[^>]*id="${titleId}"`));
            expect(html).toMatch(new RegExp(`id="${noteId}"[^>]*>[^<]*opens in a new tab`));
        }
    });
});

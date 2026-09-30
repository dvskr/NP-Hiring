/**
 * Indexing audit CQ-03 and the license-guide half of FB-2 (owner decision
 * 2026-09-28): the 51 state license guides stay live and linked, but each
 * renders "noindex, follow" and stays out of the sitemap until its state's
 * licensing facts are verified in lib/license-guide-facts.ts.
 *
 * Pins:
 *   1. The facts module keeps its contract, and every entry the research
 *      pass adds is well formed (https source, real check date, house style).
 *   2. isLicenseGuideIndexable is true only for a verified state with an
 *      initial fee, a renewal cycle and a CE requirement; the guide-level
 *      predicates (robots tag, sitemap, feed) read that one rule.
 *   3. A state with facts renders a cited facts section: every value beside
 *      its source link and check date, and the copy around it stops saying
 *      the guide never quotes them. A state without facts renders exactly as
 *      before.
 *   4. The review date moves with the facts, so lib/blog.ts retires a
 *      blog_posts mirror synced before them.
 *   5. The feed and the post page read the same predicate.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    LICENSE_GUIDE_FACTS,
    isLicenseGuideIndexable,
    type LicenseGuideFact,
    type LicenseGuideStateFacts,
} from '@/lib/license-guide-facts';
import {
    LICENSE_GUIDE_REVIEWED_AT,
    LICENSE_GUIDE_STATES,
    buildLicenseGuideFaq,
    getIndexableLicenseGuideSlugs,
    getLicenseGuideFactRows,
    getLicenseGuidePost,
    getLicenseGuideReviewedAt,
    getLicenseGuideStatesWithFacts,
    isBlogSlugIndexable,
    isLicenseGuideStateIndexable,
    isWellFormedLicenseGuideFact,
    licenseGuideFactsHeading,
    type LicenseGuideFactsTable,
} from '@/lib/blog-license-guides';
import { isSupersededLicenseGuideRow, markdownToHtml } from '@/lib/blog';
import { LICENSE_GUIDE_SERIES_PUBLISHED } from '@/config/niche/content-map';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** U+2013, U+2014 or a spaced hyphen: banned in rendered copy. */
const DASH_RULE = /[–—]| - /;

const SOURCE_URL = 'https://example.org/board/aprn';

function fact(value: string, checkedOn = '2026-10-02'): LicenseGuideFact {
    return { value, sourceUrl: SOURCE_URL, sourceName: 'Example Board of Nursing', checkedOn };
}

/** A complete, verified Texas entry (test data, not a real Texas figure). */
const TX: LicenseGuideStateFacts = {
    stateCode: 'TX',
    initialFee: fact('$150 for the initial APRN application'),
    renewalCycle: fact('Every two years, with the RN license'),
    ceRequirement: fact('20 contact hours each renewal period, 5 of them in pharmacotherapeutics', '2026-10-05'),
    processingTime: null,
    applicationRoute: fact('Online application through the board portal'),
    verified: true,
};
const SAMPLE: LicenseGuideFactsTable = { TX };

const TEXAS = LICENSE_GUIDE_STATES.find((s) => s.code === 'TX')!;
const WYOMING = LICENSE_GUIDE_STATES.find((s) => s.code === 'WY')!;
const TODAY = new Date().toISOString().slice(0, 10);
const CODES = new Set(LICENSE_GUIDE_STATES.map((s) => s.code));
const FACT_KEYS = ['initialFee', 'renewalCycle', 'ceRequirement', 'processingTime', 'applicationRoute'] as const;

describe('lib/license-guide-facts.ts: contract and data', () => {
    it('keeps the contract the research pass fills', () => {
        const src = read('lib/license-guide-facts.ts');
        for (const field of ['value: string;', 'sourceUrl: string;', 'sourceName: string;', 'checkedOn: string;', 'stateCode: string;', 'initialFee: LicenseGuideFact | null;', 'renewalCycle: LicenseGuideFact | null;', 'ceRequirement: LicenseGuideFact | null;', 'processingTime: LicenseGuideFact | null;', 'applicationRoute: LicenseGuideFact | null;', 'verified: boolean;']) {
            expect(src, field).toContain(field);
        }
        expect(src).toContain('export const LICENSE_GUIDE_FACTS: Record<string, LicenseGuideStateFacts> =');
        expect(src).toMatch(/export function isLicenseGuideIndexable\(\s*stateCode: string,/);
    });

    it('every entry is keyed by a real jurisdiction code that its stateCode repeats', () => {
        for (const [key, entry] of Object.entries(LICENSE_GUIDE_FACTS)) {
            expect(CODES.has(key), `${key}: not one of the 51 jurisdiction codes`).toBe(true);
            expect(entry.stateCode, `${key}: stateCode must repeat the key`).toBe(key);
            expect(typeof entry.verified, `${key}: verified`).toBe('boolean');
        }
    });

    it('every fact the research pass adds is well formed, already checked, and in house style', () => {
        for (const [key, entry] of Object.entries(LICENSE_GUIDE_FACTS)) {
            for (const field of FACT_KEYS) {
                const value = entry[field];
                if (value === null) continue;
                expect(isWellFormedLicenseGuideFact(value), `${key}.${field}: malformed fact`).toBe(true);
                expect(value.checkedOn <= TODAY, `${key}.${field}: checked in the future`).toBe(true);
                expect(`${value.value} ${value.sourceName}`, `${key}.${field}: dash`).not.toMatch(DASH_RULE);
                expect(value.value, `${key}.${field}: "average" as a figure word`).not.toMatch(/\baverages?\b/i);
            }
        }
    });

    it('a guide is indexable exactly when its facts are verified and complete, and its page renders them', () => {
        for (const s of LICENSE_GUIDE_STATES) {
            const entry = LICENSE_GUIDE_FACTS[s.code];
            const expected = Boolean(entry?.verified && entry.initialFee && entry.renewalCycle && entry.ceRequirement);
            expect(isLicenseGuideIndexable(s.code), s.name).toBe(expected);
            // The robots tag and the sitemap agree with the contract predicate:
            // an indexable state never hides one of its required facts.
            expect(isLicenseGuideStateIndexable(s.stateSlug), s.name).toBe(expected);
        }
        expect(getIndexableLicenseGuideSlugs()).toEqual(
            LICENSE_GUIDE_STATES.filter((s) => isLicenseGuideIndexable(s.code)).map((s) => s.slug),
        );
    });

    it('District of Columbia and North Carolina cite https sources a markdown link can carry, so both guides index', () => {
        const dc = LICENSE_GUIDE_FACTS.DC;
        // The DC renewal notice's file name holds "(2a)": percent-encoded, it
        // is the same document and the link survives markdown.
        for (const fact of [dc.renewalCycle!, dc.ceRequirement!]) {
            expect(fact.sourceUrl).toContain('OS-26-03-05%20%282a%29.pdf');
            expect(isWellFormedLicenseGuideFact(fact)).toBe(true);
        }
        // reports.oah.state.nc.us serves no https; Cornell LII renders the
        // current text of both rules.
        const nc = LICENSE_GUIDE_FACTS.NC;
        expect(nc.renewalCycle!.sourceUrl).toBe('https://www.law.cornell.edu/regulations/north-carolina/21-N-C-Admin-Code-36-0806');
        expect(nc.ceRequirement!.sourceUrl).toBe('https://www.law.cornell.edu/regulations/north-carolina/21-N-C-Admin-Code-36-0807');
        for (const fact of [nc.renewalCycle!, nc.ceRequirement!]) {
            expect(isWellFormedLicenseGuideFact(fact)).toBe(true);
            expect(fact.checkedOn).toBe('2026-09-30');
        }
        for (const slug of ['district-of-columbia', 'north-carolina']) {
            expect(isLicenseGuideStateIndexable(slug), slug).toBe(true);
            expect(getIndexableLicenseGuideSlugs(), slug).toContain(`np-license-${slug}`);
        }
        const html = markdownToHtml(getLicenseGuidePost('district-of-columbia')!.content);
        expect(html).toContain(`href="${dc.renewalCycle!.sourceUrl}"`);
    });

    it('no fact prints a capitalised tier label beside a state whose AANP tier is another', () => {
        const LABELS: ReadonlyArray<[RegExp, string]> = [
            [/Full Practice/, 'full'],
            [/Reduced Practice/, 'reduced'],
            [/Restricted Practice/, 'restricted'],
        ];
        for (const s of LICENSE_GUIDE_STATES) {
            const entry = LICENSE_GUIDE_FACTS[s.code];
            if (!entry) continue;
            for (const field of FACT_KEYS) {
                const f = entry[field];
                if (!f) continue;
                for (const [label, tier] of LABELS) {
                    if (tier === s.authority) continue;
                    expect(`${f.value} ${f.sourceName}`, `${s.code}.${field}`).not.toMatch(label);
                }
            }
        }
        expect(LICENSE_GUIDE_FACTS.IL.applicationRoute!.sourceName).toBe('IDFPR Nurses page, APRN applications');
    });

    it('while the table is empty, no guide is indexable (owner decision: all noindex today)', () => {
        if (Object.keys(LICENSE_GUIDE_FACTS).length > 0) return;
        expect(getIndexableLicenseGuideSlugs()).toEqual([]);
        for (const s of LICENSE_GUIDE_STATES) expect(isLicenseGuideStateIndexable(s.stateSlug), s.name).toBe(false);
    });

    it('the series stays published, so every guide still renders and every link to one still works', () => {
        expect(LICENSE_GUIDE_SERIES_PUBLISHED).toBe(true);
        for (const s of LICENSE_GUIDE_STATES) expect(getLicenseGuidePost(s.stateSlug), s.name).not.toBeNull();
    });
});

describe('isLicenseGuideIndexable', () => {
    it('is false for every jurisdiction with no entry', () => {
        for (const s of LICENSE_GUIDE_STATES) expect(isLicenseGuideIndexable(s.code, {}), s.name).toBe(false);
    });

    it('is true for a verified entry with the three required facts, whatever the optional two hold', () => {
        expect(isLicenseGuideIndexable('TX', SAMPLE)).toBe(true);
        expect(isLicenseGuideIndexable('TX', { TX: { ...TX, applicationRoute: null, processingTime: null } })).toBe(true);
    });

    it('reads the code case-insensitively and trims it', () => {
        expect(isLicenseGuideIndexable('tx', SAMPLE)).toBe(true);
        expect(isLicenseGuideIndexable(' TX ', SAMPLE)).toBe(true);
    });

    it('is false until a second person has verified the entry', () => {
        expect(isLicenseGuideIndexable('TX', { TX: { ...TX, verified: false } })).toBe(false);
    });

    it.each(['initialFee', 'renewalCycle', 'ceRequirement'] as const)('is false without %s', (field) => {
        expect(isLicenseGuideIndexable('TX', { TX: { ...TX, [field]: null } })).toBe(false);
    });

    it('is false for an unknown code', () => {
        expect(isLicenseGuideIndexable('ZZ', SAMPLE)).toBe(false);
    });
});

describe('guide-level predicates (robots tag, sitemap, feed)', () => {
    it('reads the state slug and the blog slug', () => {
        expect(isLicenseGuideStateIndexable('texas', SAMPLE)).toBe(true);
        expect(isLicenseGuideStateIndexable('wyoming', SAMPLE)).toBe(false);
        expect(isLicenseGuideStateIndexable('not-a-state', SAMPLE)).toBe(false);
        expect(getIndexableLicenseGuideSlugs(SAMPLE)).toEqual(['np-license-texas']);
    });

    it('never indexes a guide on a required fact its page would leave out', () => {
        const badFee = { ...TX, initialFee: { ...TX.initialFee!, sourceUrl: 'http://example.org/board' } };
        expect(isLicenseGuideIndexable('TX', { TX: badFee })).toBe(true);
        expect(isLicenseGuideStateIndexable('texas', { TX: badFee })).toBe(false);
        expect(getIndexableLicenseGuideSlugs({ TX: badFee })).toEqual([]);
    });

    it('ignores an entry filed under the wrong key', () => {
        expect(isLicenseGuideStateIndexable('texas', { TX: { ...TX, stateCode: 'CA' } })).toBe(false);
        expect(getLicenseGuideFactRows('TX', { TX: { ...TX, stateCode: 'CA' } })).toEqual([]);
    });

    it('getLicenseGuideStatesWithFacts lists the states whose guide renders a facts section', () => {
        expect(getLicenseGuideStatesWithFacts({})).toEqual([]);
        expect(getLicenseGuideStatesWithFacts(SAMPLE).map((s) => s.code)).toEqual(['TX']);
        // A verified flag is not needed to render cited facts, only to index.
        expect(getLicenseGuideStatesWithFacts({ TX: { ...TX, verified: false } }).map((s) => s.code)).toEqual(['TX']);
    });

    it('isBlogSlugIndexable is false only for a license guide that renders noindex', () => {
        expect(isBlogSlugIndexable('np-salary-guide', {})).toBe(true);
        expect(isBlogSlugIndexable('np-license-texas', {})).toBe(false);
        expect(isBlogSlugIndexable('np-license-texas', SAMPLE)).toBe(true);
        expect(isBlogSlugIndexable('np-license-wyoming', SAMPLE)).toBe(false);
        for (const s of LICENSE_GUIDE_STATES) {
            expect(isBlogSlugIndexable(s.slug), s.name).toBe(isLicenseGuideStateIndexable(s.stateSlug));
        }
    });
});

describe('isWellFormedLicenseGuideFact', () => {
    it('accepts a one-line value with an https source and a real check date', () => {
        expect(isWellFormedLicenseGuideFact(fact('$150 for the initial APRN application'))).toBe(true);
    });

    it.each<[string, Partial<LicenseGuideFact>]>([
        ['an empty value', { value: '   ' }],
        ['an en dash', { value: '10–20 hours' }],
        ['a spaced hyphen', { value: '10 - 20 hours' }],
        ['a pipe that would break the table', { value: '10 | 20' }],
        ['a markdown link in the value', { value: 'see [board](https://example.org)' }],
        ['a line break', { value: 'two\nlines' }],
        ['an empty source name', { sourceName: '' }],
        ['a plain http source', { sourceUrl: 'http://example.org/board' }],
        ['a source URL a markdown link cannot carry', { sourceUrl: 'https://example.org/a_(b)' }],
        ['a relative source', { sourceUrl: '/board' }],
        ['an impossible date', { checkedOn: '2026-02-30' }],
        ['a date without zero padding', { checkedOn: '2026-9-1' }],
    ])('rejects %s', (_label, patch) => {
        expect(isWellFormedLicenseGuideFact({ ...fact('ok value'), ...patch })).toBe(false);
    });

    it('rejects null and undefined', () => {
        expect(isWellFormedLicenseGuideFact(null)).toBe(false);
        expect(isWellFormedLicenseGuideFact(undefined)).toBe(false);
    });
});

describe('a state with facts renders a cited facts section', () => {
    const post = getLicenseGuidePost('texas', SAMPLE)!;
    const heading = `## ${licenseGuideFactsHeading(TEXAS)}`;

    it('prints every value beside its source link and check date, in display order', () => {
        expect(post.content).toContain(heading);
        expect(post.content).toContain('| Topic | What the source states | Source | Checked |');
        const rows = post.content.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Topic'));
        expect(rows.map((r) => r.split(' | ')[0].slice(2))).toEqual([
            'How to apply',
            'Initial application fee',
            'Renewal cycle',
            'Continuing education for renewal',
        ]);
        for (const row of rows) {
            expect(row).toContain(`[Example Board of Nursing](${SOURCE_URL})`);
            expect(row).toMatch(/\| (October 2, 2026|October 5, 2026) \|$/);
        }
        expect(post.content).toContain('| Initial application fee | $150 for the initial APRN application |');
        // processingTime is null: no row, no invented figure.
        expect(post.content).not.toContain('| Processing time |');
    });

    it('sits between the application steps and the renewal section', () => {
        const at = post.content.indexOf(heading);
        expect(at).toBeGreaterThan(post.content.indexOf('## How to apply for Texas APRN licensure'));
        expect(at).toBeLessThan(post.content.indexOf('## Renewing your Texas license'));
    });

    it('stops saying the guide never quotes the figures, and points at the section instead', () => {
        expect(post.content).not.toContain('We deliberately do not quote them here');
        expect(post.content).toContain('The licensing facts above name the source of each figure and the date it was checked');
        const applyFaq = buildLicenseGuideFaq(TEXAS, SAMPLE).find((f) => f.name.startsWith('What do I need to apply'))!;
        expect(applyFaq.text).toContain('The licensing facts on this page name the source of each figure');
        expect(post.faq_json).toContainEqual(applyFaq);
        // The board stays linked in both the application and renewal paths.
        expect(post.content.split(TEXAS.boardUrl).length - 1).toBeGreaterThanOrEqual(2);
    });

    it('renders as an HTML table with a working source link', () => {
        const html = markdownToHtml(post.content);
        expect(html).toContain('<table>');
        expect(html).toContain(`<a href="${SOURCE_URL}">Example Board of Nursing</a>`);
        expect(html).toContain('<td style="text-align:left">$150 for the initial APRN application</td>');
    });

    it('carries the latest check date as its review date', () => {
        expect(post.reviewed_at).toBe('2026-10-05T00:00:00.000Z');
        expect(post.updated_at).toBe('2026-10-05T00:00:00.000Z');
        expect(getLicenseGuideReviewedAt('texas', SAMPLE)).toBe('2026-10-05T00:00:00.000Z');
    });

    it('never moves the review date back for a fact checked before the series review', () => {
        const old = { TX: { ...TX, initialFee: fact('$150', '2026-01-10'), renewalCycle: null, ceRequirement: null, applicationRoute: null } };
        expect(getLicenseGuideReviewedAt('texas', old)).toBe(LICENSE_GUIDE_REVIEWED_AT);
    });

    it('leaves a malformed fact out instead of printing it without its citation', () => {
        const partial = { TX: { ...TX, renewalCycle: { ...TX.renewalCycle!, checkedOn: 'soon' } } };
        const content = getLicenseGuidePost('texas', partial)!.content;
        expect(content).not.toContain('| Renewal cycle |');
        expect(content).toContain('| Initial application fee |');
    });

    it('stays in house style', () => {
        expect(post.content).not.toMatch(DASH_RULE);
        for (const f of post.faq_json!) expect(`${f.name} ${f.text}`).not.toMatch(DASH_RULE);
    });
});

describe('a state without facts renders exactly as before', () => {
    const post = getLicenseGuidePost('wyoming', SAMPLE)!;

    it('has no facts section and keeps the board-link answer', () => {
        expect(post.content).not.toContain(licenseGuideFactsHeading(WYOMING));
        expect(post.content).toContain('We deliberately do not quote them here because boards revise them and stale numbers are worse than none.');
        expect(post.content).toContain('Fees, forms, and processing times are set by the board and change, so work directly from the board site rather than third-party summaries.');
        expect(post.reviewed_at).toBe(LICENSE_GUIDE_REVIEWED_AT);
    });

    it('matches the default render byte for byte', () => {
        expect(post.content).toBe(getLicenseGuidePost('wyoming', {})!.content);
    });
});

describe('the review date drives mirror supersession (lib/blog.ts)', () => {
    it('isSupersededLicenseGuideRow compares against the state\'s own review date', () => {
        const src = read('lib/blog.ts');
        expect(src).toContain('reviewed < Date.parse(getLicenseGuideReviewedAt(match[1]))');
        expect(src).toContain('updated_at: getLicenseGuideReviewedAt(stateSlug)');
        const slug = 'np-license-texas';
        const own = getLicenseGuideReviewedAt('texas');
        expect(isSupersededLicenseGuideRow({ slug, reviewed_at: own })).toBe(false);
        expect(isSupersededLicenseGuideRow({ slug, reviewed_at: '2026-07-29T00:00:00Z' })).toBe(true);
    });
});

describe('the post page and the feed read the same predicate', () => {
    const page = read('app/blog/[slug]/page.tsx');
    const feed = read('app/blog/feed.xml/route.ts');

    it('the post page renders noindex, follow for a guide that is not indexable, and keeps its self canonical', () => {
        expect(page).toContain('const licenseNoindex = licenseMatch !== null && !isLicenseGuideStateIndexable(licenseMatch[1]);');
        expect(page).toContain('...(licenseNoindex ? { robots: { index: false, follow: true } } : {}),');
        expect(page).toContain('canonical: url,');
    });

    it('the feed lists only posts the site offers for indexing, and makes no ranking claim', () => {
        expect(feed).toContain('.filter((post) => isBlogSlugIndexable(post.slug))');
        const xmlTemplate = feed.slice(feed.indexOf('const xml = `'), feed.indexOf('</rss>`'));
        expect(xmlTemplate.length).toBeGreaterThan(0);
        expect(xmlTemplate).not.toMatch(/#1\b/);
        expect(xmlTemplate).not.toMatch(DASH_RULE);
    });

    /**
     * A sitemap must not list a page that renders noindex. This case passes
     * once the app/sitemap.ts handoff lands (it listed all 51 guides from
     * getAllLicenseGuideSlugs()).
     */
    it('the sitemap lists only indexable guides, and never a guide through the blog rows', () => {
        const sitemap = read('app/sitemap.ts');
        expect(sitemap).toContain('const licenseGuideSlugs = getIndexableLicenseGuideSlugs()');
        expect(sitemap).toContain('const licenseGuideSlugSet = new Set(getAllLicenseGuideSlugs())');
        expect(sitemap).toContain('.filter((post) => !licenseGuideSlugSet.has(post.slug))');
        expect(sitemap).toContain('getLicenseGuideReviewedAt(');
    });
});

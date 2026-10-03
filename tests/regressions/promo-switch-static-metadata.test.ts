/**
 * Backlog 2.1, fix round 1: metadata that cannot follow the launch-promo
 * clock has to be true on both sides of config.promoEndsAt.
 *
 * A page's visible copy is chosen per render, but a module-scope `metadata`
 * export is evaluated once per server instance (and once at build for a
 * static page), so whatever it says is said in both phases. Phase-dependent
 * metadata therefore lives in generateMetadata (/pricing, /for-employers, the
 * /post-job layout), and every periphery page that kept a static `metadata`
 * may not offer free posting in it.
 *
 * One did: the template library's link preview said the skeletons are "free
 * to browse, customize, and post", which reads as free posting, and a post
 * costs money from the switch. The templates themselves stay free, so the
 * preview now says what is free in both phases.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// The benchmark widget aggregates live postings; only the page's metadata is read here.
vi.mock('@/components/tools/EmployerBenchmarkWidget', () => ({ default: () => null }));

import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { JD_TEMPLATES } from '@/lib/jd-templates';
import { metadata as hubMetadata } from '@/app/for-employers/resources/page';
import { metadata as howToHireMetadata } from '@/app/for-employers/resources/how-to-hire/page';
import { metadata as jdGuideMetadata } from '@/app/for-employers/resources/job-description-guide/page';
import { metadata as libraryMetadata } from '@/app/for-employers/resources/job-description-templates/page';
import { generateMetadata as templateMetadata } from '@/app/for-employers/resources/job-description-templates/[id]/page';
import { metadata as testimonialsMetadata } from '@/app/testimonials/page';
import { metadata as benchmarkMetadata } from '@/app/tools/salary-benchmark/page';
import { metadata as costPerHireMetadata } from '@/app/tools/cost-per-hire-calculator/page';
import { metadata as compareHubMetadata } from '@/app/compare/page';

/** The last day of the launch promo, and an hour after it ended. */
const PROMO_RUNNING = new Date('2026-12-31T12:00:00.000Z');
const LADDER_LIVE = new Date(Date.parse(config.promoEndsAt) + 60 * 60 * 1000);

/** Every string a metadata object carries: titles, descriptions, keywords, image URLs and alt text. */
function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
    return [];
}

/** The sentences of a string. A free template next to "post in minutes" in the NEXT sentence offers nothing. */
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

/**
 * A sentence that names both "free" and a post says posting is free. Not
 * "posted pay" or a "flat-fee posting": those describe data and a product,
 * not an offer.
 */
const saysPostingIsFree = (sentence: string): boolean =>
    /\bfree\b/i.test(sentence) && /\bposts?\b/i.test(sentence);

/** Nothing in `metadata` is true only while the promo runs. */
function expectTrueInBothPhases(metadata: unknown, surface: string): void {
    const all = strings(metadata);
    expect(all.length, `${surface}: metadata strings`).toBeGreaterThan(0);
    for (const text of all) {
        // Image URLs carry their title percent-encoded.
        const readable = /^https?:\/\//.test(text) ? decodeURIComponent(text) : text;
        for (const pattern of [/free through/i, /launch (?:promo|period)/i, /\$0\b/]) {
            expect(readable, `${surface}: ${pattern}`).not.toMatch(pattern);
        }
        expect(readable, `${surface}: promo end date`).not.toContain(config.promoEndsLabel);
        expect(readable, `${surface}: dated ladder`).not.toContain(config.ladderStartsLabel);
        expect(sentences(readable).filter(saysPostingIsFree), `${surface}: posting offered free`).toEqual([]);
    }
}

afterEach(() => {
    vi.useRealTimers();
});

describe('2.1: static metadata on the periphery pages is true in both phases', () => {
    it.each([
        ['/for-employers/resources', hubMetadata],
        ['/for-employers/resources/how-to-hire', howToHireMetadata],
        ['/for-employers/resources/job-description-guide', jdGuideMetadata],
        ['/for-employers/resources/job-description-templates', libraryMetadata],
        ['/testimonials', testimonialsMetadata],
        ['/tools/salary-benchmark', benchmarkMetadata],
        ['/tools/cost-per-hire-calculator', costPerHireMetadata],
        ['/compare', compareHubMetadata],
    ])('%s', (surface, metadata) => {
        expectTrueInBothPhases(metadata, surface);
    });

    it('the template library preview says what is free: the templates, not posting', () => {
        expect(libraryMetadata.openGraph?.description).toBe(
            `Setting-specific ${brand.niche.short} job description skeletons, free to browse and customize.`,
        );
        // The templates are still offered as free, in the title and the description.
        expect(String(libraryMetadata.title)).toBe(`${JD_TEMPLATES.length} Free ${brand.niche.short} Job Description Templates by Setting`);
        expect(String(libraryMetadata.description)).toMatch(/^Free /);
    });

    it('the finder tells a free template from free posting', () => {
        expect(saysPostingIsFree('Setting-specific skeletons, free to browse, customize, and post.')).toBe(true);
        expect(saysPostingIsFree('Post a job for free.')).toBe(true);
        // "Free" and "post" in neighbouring sentences: a free template, then an instruction.
        const neighbours = sentences('A free job description skeleton for this setting. Customize the prompts and post in minutes.');
        expect(neighbours).toHaveLength(2);
        expect(neighbours.filter(saysPostingIsFree)).toEqual([]);
        expect(saysPostingIsFree('Free salary benchmark: median posted pay by state, from live listings.')).toBe(false);
        expect(saysPostingIsFree('A flat-fee posting priced from our published rates.')).toBe(false);
    });

    it('every template page builds the same metadata in both phases, and it offers no free posting', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        for (const { id } of JD_TEMPLATES) {
            vi.setSystemTime(PROMO_RUNNING);
            const before = await templateMetadata({ params: Promise.resolve({ id }) });
            vi.setSystemTime(LADDER_LIVE);
            const after = await templateMetadata({ params: Promise.resolve({ id }) });
            expect(after, id).toEqual(before);
            expectTrueInBothPhases(after, `/for-employers/resources/job-description-templates/${id}`);
        }
    });
});

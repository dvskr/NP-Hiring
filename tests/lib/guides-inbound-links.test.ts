/**
 * Links into the guide preview pages from the posts that discuss their
 * topics: one sentence after the article on chosen blog posts and on every
 * state license guide (lib/guides/blog-guide.ts), rendered by the post
 * template. One link per post, on the words of the search the preview
 * answers, with no figure, price or phase copy that a new edition or the end
 * of the free period could leave stale. The topical pages' guide cards
 * (components/guides/GuidePromo.tsx) already link each guide page and are
 * pinned where they are placed.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GuideMention from '@/components/guides/GuideMention';
import { BLOG_GUIDE_MENTIONS, LICENSE_GUIDE_MENTION, guideMentionForPost } from '@/lib/guides/blog-guide';
import { OWN_GUIDE_SLUGS } from '@/lib/guides/catalog';
import { getAllLicenseGuideSlugs } from '@/lib/blog-license-guides';
import { DONOR_COPY_RE } from '../e2e/helpers/seo';
import { readCode } from '../helpers/source';

const ROOT = path.resolve(__dirname, '../../');
const DASH = /[–—]|\s-\s/;
const NAMES = /pmhnp|psychiatric|mental health|akari/i;

/** Which guide each named post links: the post's topic decides. */
const NAMED_POSTS: Record<string, string> = {
    'highest-paying-np-specialties': 'compensation-report',
    'np-salary-guide': 'compensation-report',
    'nurse-practitioner-job-outlook': 'compensation-report',
    'new-grad-np-first-job': 'first-year-playbook',
    'how-to-become-a-nurse-practitioner': 'first-year-playbook',
    'np-certification-overview': 'first-year-playbook',
    'np-fellowship-residency-programs': 'first-year-playbook',
    'np-interview-questions': 'interview-prep-pack',
    'np-resume-guide': 'interview-prep-pack',
    'np-cover-letter-guide': 'interview-prep-pack',
    'np-salary-negotiation-guide': 'negotiate-like-an-np',
    'np-1099-vs-w2': 'negotiate-like-an-np',
    'nurse-practitioner-noncompete-laws': 'negotiate-like-an-np',
    'np-malpractice-insurance-guide': 'negotiate-like-an-np',
    'remote-telehealth-np-jobs-guide': 'telehealth-playbook',
    'aprn-compact-states': 'telehealth-playbook',
    'np-credentialing-checklist': 'launch-your-practice',
    'what-is-an-aprn': 'launch-your-practice',
};

const named = Object.entries(BLOG_GUIDE_MENTIONS);
const licenseGuides = getAllLicenseGuideSlugs();
const everyMention = [...named, ['np-license-*', LICENSE_GUIDE_MENTION] as const];

describe('blog posts that link a guide preview', () => {
    it('link each guide from the posts on its topic, and the multistate licensing chapter from every state license guide', () => {
        expect(Object.keys(BLOG_GUIDE_MENTIONS)).toEqual(Object.keys(NAMED_POSTS));
        for (const [slug, guide] of Object.entries(NAMED_POSTS)) expect(guideMentionForPost(slug)?.guide, slug).toBe(guide);
        expect(licenseGuides).toHaveLength(51);
        for (const slug of licenseGuides) expect(guideMentionForPost(slug), slug).toBe(LICENSE_GUIDE_MENTION);
        expect(LICENSE_GUIDE_MENTION.guide).toBe('telehealth-playbook');
    });

    it('reach every one of this board\'s own guides', () => {
        const linked = new Set(named.map(([, mention]) => mention.guide));
        expect([...linked].sort()).toEqual([...OWN_GUIDE_SLUGS].sort());
    });

    it.each(named)('%s is a live post: it has a repo file and no redirect away', (slug) => {
        expect(fs.existsSync(path.join(ROOT, 'content/blog', `${slug}.mdx`)), slug).toBe(true);
        expect(fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8')).not.toContain(`source: '/blog/${slug}'`);
    });

    it.each(everyMention)('%s: one sentence, its phrase inside it once, in the company\'s voice, with no dash, figure, price or name', (_slug, mention) => {
        expect(mention.text.split(mention.phrase)).toHaveLength(2);
        expect(mention.text).not.toMatch(DASH);
        // "1099" and "W-2" name a kind of work, not a figure a new edition could change.
        expect(mention.text.replace(/\b1099\b|\bW-2\b/g, '')).not.toMatch(/\d|\$/);
        expect(mention.text).not.toMatch(/\bI\b|\bmy\b|!/);
        expect(mention.text).not.toMatch(/\bfree\b/i);
        expect(mention.text).not.toMatch(NAMES);
        expect(mention.text).not.toMatch(DONOR_COPY_RE);
        expect(mention.phrase.split(/\s+/).length).toBeGreaterThanOrEqual(3);
        expect(mention.text.split(/(?<=[.?])\s+(?=[A-Z])/).length).toBeLessThanOrEqual(2);
    });

    it.each(everyMention)('%s renders exactly one link, to the guide page, on its phrase', (_slug, mention) => {
        const html = renderToStaticMarkup(createElement(GuideMention, { mention }));
        const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
        expect(links).toHaveLength(1);
        expect(links[0][1]).toBe(`/guides/${mention.guide}`);
        expect(links[0][2]).toBe(mention.phrase);
        const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
        expect(text).toBe(mention.text);
    });

    it('leaves every other post alone, inherited keys included', () => {
        expect(guideMentionForPost('fnp-vs-pmhnp-vs-agacnp')).toBeNull();
        expect(guideMentionForPost('nurse-practitioner-week-2026')).toBeNull();
        expect(guideMentionForPost('np-license-')).toBeNull();
        expect(guideMentionForPost('constructor')).toBeNull();
        expect(guideMentionForPost('__proto__')).toBeNull();
    });

    it('the post template renders the sentence right after the article, before the share row', () => {
        const code = readCode('app/blog/[slug]/page.tsx');
        expect(code).toContain('const guideMention = guideMentionForPost(slug);');
        const article = code.indexOf('</article>');
        const mention = code.indexOf('{guideMention && <GuideMention mention={guideMention} />}');
        expect(article).toBeGreaterThan(-1);
        expect(mention).toBeGreaterThan(article);
        expect(mention).toBeLessThan(code.indexOf('<EditorialShare'));
    });
});

/**
 * Regression guards — citation-trust sweep B46 + B47 + B48 + B52 + B55
 * (aeo-content).
 *
 * B46: the named AI-crawler group in robots.ts had Disallow lines but no
 * explicit root Allow. The ClaudeBot incident (2026-05-11) proved that
 * real-world AI-crawler parsers fall back to "everything disallowed"
 * when no positive Allow rule is present — the group now carries an
 * explicit 'Allow: /'.
 *
 * B47: llms.txt / llms-full.txt listed placeholder social profiles that
 * were never claimed (config/brand.ts documents them as placeholders) —
 * pointing AI systems at 404s or unrelated accounts. Removed from the
 * llms files. (The Organization sameAs in app/layout.tsx is tracked
 * separately — see the audit report.)
 *
 * B48: the 51 state salary-guide pages emitted only breadcrumbs. They
 * now carry FAQPage + Article + Speakable schema driven by live page
 * data, with ONE array feeding both the JSON-LD and the visible FAQ.
 *
 * B52: the category-city pSEO template maintained two hand-copied FAQ
 * arrays (JSON-LD vs visible accordion) that had drifted apart. Both
 * now render from a single hoisted array.
 *
 * B55: .well-known/ai-plugin.json logo_url pointed at pmhnp_logo.png,
 * which does not exist — it now references a real public asset.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import robotsHandler from '@/app/robots';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('B46 — AI crawler group has an explicit root Allow', () => {
    const robots = robotsHandler();
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];

    it("the grouped AI-crawler rule allows '/'", () => {
        const aiRule = rules.find(
            (r) => Array.isArray(r.userAgent) && r.userAgent.includes('GPTBot')
        );
        expect(aiRule).toBeDefined();
        const allow = Array.isArray(aiRule!.allow) ? aiRule!.allow : [aiRule!.allow];
        expect(allow).toContain('/');
    });

    it("the dedicated ClaudeBot rule keeps its explicit 'Allow: /'", () => {
        const claudeRule = rules.find((r) => r.userAgent === 'ClaudeBot');
        expect(claudeRule).toBeDefined();
        const allow = Array.isArray(claudeRule!.allow) ? claudeRule!.allow : [claudeRule!.allow];
        expect(allow).toContain('/');
    });
});

describe('B47 — llms files list no unclaimed social profiles', () => {
    it.each(['public/llms.txt', 'public/llms-full.txt'])(
        '%s has no placeholder social links',
        (rel) => {
            const src = read(rel);
            expect(src).not.toContain('linkedin.com/company/nphiring');
            expect(src).not.toContain('facebook.com/nphiring');
            expect(src).not.toContain('x.com/nphiring');
            expect(src).not.toContain('instagram.com/nphiring');
            expect(src).not.toContain('youtube.com/@nphiring');
        }
    );
});

describe('B48 — state salary-guide pages carry answer-engine schema', () => {
    const src = read('app/salary-guide/[state]/page.tsx');

    it('emits FAQPage, Article, and Speakable schema', () => {
        expect(src).toContain("'@type': 'FAQPage'");
        expect(src).toContain("'@type': 'Article'");
        expect(src).toContain('SpeakableSpecification');
    });

    it('one stateFaqs array feeds both the JSON-LD and the visible accordion', () => {
        expect(src).toMatch(/mainEntity: stateFaqs\.map/);
        expect(src).toMatch(/\{stateFaqs\.map\(\(faq/);
        // Exactly one definition — a second copy is how B52-style drift starts.
        expect(src.match(/const stateFaqs = \[/g)).toHaveLength(1);
    });

    it('Article schema fabricates no dates and uses the real logo asset', () => {
        // No date keys at all: the page has no editorial publish date and
        // stamping render time would fabricate freshness (B54 principle).
        expect(src).not.toMatch(/datePublished:/);
        expect(src).not.toMatch(/dateModified:/);
        expect(src).toContain('/logo.png');
        expect(src).not.toContain('logo.svg');
    });

    it('speakable selectors exist in the rendered markup', () => {
        expect(src).toContain('id="state-salary-summary"');
        expect(src).toContain('className="faq-answer"');
    });
});

describe('B52 — category-city FAQ has a single source array', () => {
    const src = read('lib/pseo/category-city-template.tsx');

    it('exactly one categoryCityFaqs definition feeds schema and accordion', () => {
        expect(src.match(/const categoryCityFaqs = \[/g)).toHaveLength(1);
        expect(src).toMatch(/mainEntity: categoryCityFaqs\.map/);
        expect(src).toMatch(/\{categoryCityFaqs\.map\(\(faq/);
    });

    it('no forked inline faqs arrays remain', () => {
        expect(src).not.toMatch(/const faqs = \[/);
    });
});

describe('B55 — ai-plugin.json logo points at a real asset', () => {
    it('logo_url references an existing file in public/', () => {
        const manifest = JSON.parse(read('public/.well-known/ai-plugin.json')) as {
            logo_url: string;
        };
        expect(manifest.logo_url).not.toContain('pmhnp_logo');
        const pathname = new URL(manifest.logo_url).pathname;
        expect(fs.existsSync(path.join(ROOT, 'public', pathname))).toBe(true);
    });
});

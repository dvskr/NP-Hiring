/**
 * P0 #4 / #8 / #15 — faq-pricing-funnel package (content/SEO audit 2026-07-28).
 *
 * #4  /faq quoted stats that contradicted lib/stats-sources.ts (the "34
 *     states + DC" FPA claim vs the cited 27, a hardcoded $126K-era salary
 *     median) plus a set of invented figures (locum/negotiation/ROI dollar
 *     ranges) with no repo source. The page now derives its cited figures
 *     from STAT_SOURCES and uses evergreen phrasing where no source exists.
 *
 * #8  The /faq hero (priority LCP) and /pricing comparison CTA pointed at
 *     the dead Supabase site-assets bucket (400s). Both now serve local
 *     exact-DPR ladders (scripts/regen-image-ladders.mjs assets), and both
 *     pages' OG cards use the edge-generated /api/og endpoint instead of
 *     dead bucket URLs.
 *
 * #15 /pricing and /for-programs rendered visible FAQs with no FAQPage
 *     JSON-LD; /for-employers had neither. All three now emit FAQPage
 *     schema derived from the SAME array that renders the visible FAQ
 *     (repo pattern: app/contact/page.tsx) so schema and copy cannot
 *     diverge.
 *
 * Static-source style follows tests/regressions/aeo-content-citation-stats.test.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('P0 #4 — /faq stats derive from lib/stats-sources.ts', () => {
    const src = read('app/faq/page.tsx');

    it('imports STAT_SOURCES and cites the salary + FPA entries', () => {
        expect(src).toContain("from '@/lib/stats-sources'");
        expect(src).toContain('STAT_SOURCES.averageSalary');
        expect(src).toContain('STAT_SOURCES.fullPracticeStates');
    });

    it('no longer hardcodes the stale 126K-era salary figures', () => {
        expect(src).not.toContain('$126');
        expect(src).not.toContain('126,000');
        expect(src).not.toContain('$135,000');
    });

    it('no longer carries the wrong FPA state count', () => {
        expect(src).not.toContain('34 states');
    });

    it('invented dollar/percent figures were removed (evergreen phrasing)', () => {
        const invented = [
            '$95,000-$115,000',   // new-grad range contradicting homepage FAQ
            '$150,000-$180,000',  // experienced range (no source)
            '$150,000-$250,000',  // locum annual range (no source)
            '$85-$150',           // locum hourly range (no source)
            '20-50%',             // locum premium (no source)
            '12-15%',             // FPA premium (no source)
            '5-15%',              // negotiation premium (no source)
            '10-20%',             // specialty premium (no source)
            '$200K-$300K',        // private-practice range (no source)
            '$35,000-$80,000',    // grad-school cost (no source)
            '$5,000-$30,000',     // sign-on bonus range (no source)
            '$2,000-$5,000',      // CME allowance range (no source)
            '$315',               // cert exam fee (no source, drifts)
            '$888',               // DEA registration fee (no source, drifts)
        ];
        for (const figure of invented) {
            expect(src, `invented figure still present in app/faq/page.tsx: ${figure}`).not.toContain(figure);
        }
    });

    it('FAQPage JSON-LD derives from the same arrays the page renders', () => {
        expect(src).toMatch(
            /mainEntity: \[\.\.\.jobSeekerFaqs, \.\.\.employerFaqs, \.\.\.careerFaqs, \.\.\.salaryFaqs, \.\.\.scopeFaqs, \.\.\.generalFaqs\]\.map/
        );
    });
});

describe('P0 #8 — /faq hero and /pricing CTA serve local ladder assets', () => {
    const faqSrc = read('app/faq/page.tsx');
    const pricingSrc = read('app/pricing/page.tsx');

    it('neither page references the dead Supabase site-assets bucket', () => {
        expect(faqSrc).not.toContain('site-assets');
        expect(faqSrc).not.toContain('storageBase');
        expect(pricingSrc).not.toContain('site-assets');
        expect(pricingSrc).not.toContain('storageBase');
    });

    it('/faq hero uses the exact-DPR ladder with LCP priority', () => {
        expect(faqSrc).toContain('/images/how-it-works/step-employer-browse-');
        expect(faqSrc).toContain('sizes="280px"');
        expect(faqSrc).toContain('fetchPriority="high"');
    });

    it('every /faq hero ladder rung exists on disk', () => {
        for (const w of [280, 350, 420, 490, 560, 630, 700, 840]) {
            const rel = `public/images/how-it-works/step-employer-browse-${w}.webp`;
            expect(fs.existsSync(path.join(ROOT, rel)), `missing ladder file: ${rel}`).toBe(true);
        }
    });

    it('/pricing CTA uses the cta-illustration-v2 ladder', () => {
        expect(pricingSrc).toContain('/images/employers/cta-illustration-v2-');
        expect(pricingSrc).toContain('sizes="260px"');
    });

    it('every /pricing CTA ladder rung exists on disk', () => {
        for (const w of [260, 325, 390, 455, 520, 585, 650, 780]) {
            const rel = `public/images/employers/cta-illustration-v2-${w}.webp`;
            expect(fs.existsSync(path.join(ROOT, rel)), `missing ladder file: ${rel}`).toBe(true);
        }
    });

    it('both pages OG cards use the edge-generated /api/og endpoint', () => {
        expect(faqSrc).toContain('/api/og?title=');
        expect(pricingSrc).toContain('/api/og?title=');
    });
});

describe('P0 #15 — FAQPage JSON-LD on the employer funnel pages', () => {
    it('/pricing schema derives from the single faqs array it renders', () => {
        const src = read('app/pricing/page.tsx');
        expect(src).toContain("'@type': 'FAQPage'");
        expect(src).toMatch(/mainEntity: faqs\.map/);
        expect(src).toMatch(/\{faqs\.map\(\(\{ q, a \}\)/);
        // Exactly one definition — a second copy is how schema/copy drift starts.
        expect(src.match(/const faqs = \[/g)).toHaveLength(1);
    });

    it('/for-programs schema derives from the single programFaqs array it renders', () => {
        const src = read('app/for-programs/page.tsx');
        expect(src).toContain("'@type': 'FAQPage'");
        expect(src).toMatch(/mainEntity: programFaqs\.map/);
        expect(src).toMatch(/\{programFaqs\.map\(\(\{ q, a \}/);
        expect(src.match(/const programFaqs = \[/g)).toHaveLength(1);
    });

    it('/for-employers gained a visible FAQ section + schema from one array', () => {
        const src = read('app/for-employers/page.tsx');
        expect(src).toContain("'@type': 'FAQPage'");
        expect(src).toMatch(/mainEntity: employerFaqs\.map/);
        expect(src).toMatch(/\{employerFaqs\.map\(\(\{ q, a \}\)/);
        expect(src.match(/const employerFaqs = \[/g)).toHaveLength(1);
    });

    it('/for-employers FAQ answers quote config-derived pricing, not literals', () => {
        const src = read('app/for-employers/page.tsx');
        // The FAQ copy must interpolate lib/config values so a price change
        // can never strand a stale dollar figure in the schema.
        expect(src).toContain('$${config.postingPrice}');
        expect(src).toContain('$${config.renewalPrice}');
        expect(src).toContain('${config.durationDays}');
        expect(src).toContain('${config.limits.candidateUnlocksPerPosting}');
    });
});

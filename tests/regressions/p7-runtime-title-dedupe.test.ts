/**
 * P7 runtime fixes D6 + D7 — title templates must not duplicate tokens.
 *
 * D6 (MEDIUM): /jobs rendered <title> "Browse 851 NP & NP Jobs Near Me".
 * config/brand.ts legitimately has niche.short === niche.medium === 'NP'
 * post-fork (the NP board has no narrower credential label), so the
 * `${short} & ${medium}` TEMPLATE is what must collapse "X & X" → "X".
 * The brand data is correct; the fix lives in app/jobs/page.tsx.
 *
 * D7 (LOW): 14 routes rendered "… | NP Hiring | NP Hiring" because their
 * page metadata appended `| ${brand.name}` manually on top of the root
 * layout's `%s | ${brand.name}` title template, which wraps plain string
 * titles again. The fix removes the manual suffix from each; the template
 * supplies it exactly once.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { brand } from '@/config/brand';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('D6 — /jobs title dedupes the niche pair', () => {
    const src = read('app/jobs/page.tsx');

    it('computes nicheTitlePair with a short===medium collapse', () => {
        expect(src).toMatch(/brand\.niche\.short === brand\.niche\.medium/);
        expect(src).toMatch(/nicheTitlePair/);
    });

    it('the browse title interpolates the deduped pair, not short & medium', () => {
        const titleLine = src
            .split('\n')
            .find((l) => l.includes('Jobs Near Me') && l.includes('let title'));
        expect(titleLine).toBeDefined();
        expect(titleLine).toContain('${nicheTitlePair}');
        expect(titleLine).not.toContain('${brand.niche.medium}');
    });

    it("current brand data takes the collapse branch (short === medium === 'NP')", () => {
        // If the brand ever regains a distinct medium label, the pair renders
        // "short & medium" again by design — this pin documents today's state
        // rather than freezing it: update it alongside config/brand.ts.
        expect(brand.niche.short).toBe(brand.niche.medium);
        const pair =
            brand.niche.short === brand.niche.medium
                ? brand.niche.short
                : `${brand.niche.short} & ${brand.niche.medium}`;
        expect(pair).not.toMatch(/(\b\w+\b) & \1/);
    });
});

describe('D7 — no page re-appends the brand suffix the layout template adds', () => {
    // The 14 runtime-flagged routes.
    const FIXED_PAGES = [
        'app/tools/page.tsx',
        'app/tools/1099-vs-w2-calculator/page.tsx',
        'app/tools/cost-of-living-comparison/page.tsx',
        'app/tools/cost-per-hire-calculator/page.tsx',
        'app/tools/licensure-checker/page.tsx',
        'app/tools/private-practice-revenue-calculator/page.tsx',
        'app/tools/salary-benchmark/page.tsx',
        'app/tools/specialty-finder/page.tsx',
        'app/reports/page.tsx',
        'app/reports/pay-transparency/page.tsx',
        'app/reports/state-of-np-hiring-2026/page.tsx',
        'app/for-job-seekers/page.tsx',
        'app/login/page.tsx',
        'app/signup/page.tsx',
    ] as const;

    it('root layout still owns the single brand suffix via its title template', () => {
        const layout = read('app/layout.tsx');
        expect(layout).toMatch(/template:\s*`%s \| \$\{brand\.name\}`/);
    });

    // A `title:` whose value is a template literal interpolating brand.name
    // (comments mentioning `| ${brand.name}` don't carry a `title:` key, so
    // they can't false-positive; `absolute:` titles bypass the template and
    // are allowed).
    const MANUAL_SUFFIX = /title:\s*`[^`]*\|\s*\$\{brand\.name\}[^`]*`/;

    it.each(FIXED_PAGES)('%s has no manual `| brand.name` title suffix', (rel) => {
        expect(read(rel)).not.toMatch(MANUAL_SUFFIX);
    });
});

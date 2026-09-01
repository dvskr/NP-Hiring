/**
 * Live review 2026-08-17, items 8a–8d + item 5 (fix program WP-5 +
 * the BLS-growth swap) — promise removal and stat-vintage guards.
 *
 * WHAT THIS PINS
 *
 * 1. The falsified absolute promises stay removed from production copy:
 *      - "every job is an NP role" / "Every job on this board is …"
 *        (8a — falsified at the DB level by out-of-scope listings, review
 *        items 1a–1d; softened to the screening commitment)
 *      - "100% NP Audience" / "every visitor is a practicing … NP"
 *        (8c — audience composition is unverifiable; we claim inventory)
 *      - "No Unqualified Applicants" (8c — unenforceable guarantee)
 *      - "never inflate salaries" + "fact-check … against state nursing
 *        boards" (8b — both sentences were false: published annualization
 *        errors existed, and no nursing-board mechanism exists)
 *      - "only ever see roles you can actually accept" (8d — promised a
 *        license-to-listing eligibility mechanism that does not exist)
 *      - adjacent unsupported superlatives swept in the same pass
 *        ("The only job platform", "Unmatched", "vastly higher conversion
 *        rates", "thousands of real-time listings", "Reach thousands")
 *
 *    RESTORATION GATE: an absolute inventory claim may return ONLY when
 *    the WP-1 inventory-invariant test (classifier over the live published
 *    inventory) is green in CI. Until then, edits that reintroduce these
 *    strings fail here.
 *
 * 2. The comparison table is ONE shared audited module
 *    (lib/employer-comparison.ts) consumed by BOTH /for-employers and
 *    /pricing — the /pricing fork that resurrected the pre-audit cells
 *    (review item 8c) cannot happen again.
 *
 * 3. The BLS growth stat (review item 5): STAT_SOURCES carries the
 *    verified 2024–2034 NP-specific projection (40%, BLS Employment
 *    Projections released Sept 2025; the EP-table figure is 40.1%,
 *    rounded down, matching the entry's rounding convention). The stale
 *    2022–2032 cycle's 45% — and every hand-typed vintage string that
 *    carried it — must not resurface anywhere in production copy,
 *    including the four MDX posts that hand-type the figure.
 *
 * KNOWN DEBT OUTSIDE THIS PACKAGE'S OWNERSHIP (not asserted here so the
 * suite stays green while the owning packages land; their guards pin them):
 *    - app/post-job/layout.tsx: "Starter, Growth, and Premium" ghost tiers
 *      + "thousands of qualified" audience claim (schema-seo package).
 *    - app/about/page.tsx metadata: "#1 dedicated job board" + "thousands
 *      of companies" (counts-unification package).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { STAT_SOURCES } from '@/lib/stats-sources';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Strip block and line comments, so documentation that quotes a banned
 * claim while explaining its removal does not trip the guard keeping it
 * removed (same convention as p2-trust-surfaces-point-of-sale.test.ts).
 */
const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Recursively list production source files under a directory. */
function walk(dir: string, exts: string[]): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...walk(rel, exts));
        } else if (exts.some((e) => entry.name.endsWith(e))) {
            out.push(rel);
        }
    }
    return out;
}

/** Every production copy surface: pages, components, libs, config, MDX. */
const PRODUCTION_DIRS = ['app', 'components', 'lib', 'config', 'content'];
const productionFiles = PRODUCTION_DIRS.flatMap((d) => walk(d, ['.ts', '.tsx', '.mdx']));

/** [pattern, why it is banned] — checked against comment-stripped source. */
const BANNED_CLAIMS: [RegExp, string][] = [
    [/Every job on this board is/i, '8a: absolute inventory guarantee (gate: WP-1 invariant)'],
    [/every job (?:here )?is an? (?:NP|nurse practitioner)/i, '8a: absolute inventory guarantee'],
    [/we only list/i, '8a: absolute inventory guarantee'],
    [/only carries \$\{brand\.niche/i, '8a: absolute inventory guarantee (FAQ/JSON-LD)'],
    [/100% \$\{brand\.niche\.\w+\} Audience/i, '8c: unverifiable audience-composition claim'],
    [/100% (?:NP|PMHNP|CRNA|APRN) audience/i, '8c: unverifiable audience-composition claim'],
    [/No Unqualified Applicants/i, '8c: unenforceable guarantee'],
    [/every visitor is a practicing/i, '8c: unverifiable audience-composition claim'],
    [/never inflate/i, '8b: falsified by published annualization errors (item 2)'],
    [/fact-check(?:ed)?[^.\n]{0,60}nursing boards/i, '8b: no nursing-board mechanism exists'],
    [/only ever see roles you can actually accept/i, '8d: no license-to-listing eligibility mechanism'],
    [/The only job platform/i, 'WP-5 sweep: unverifiable superlative'],
    [/vastly higher conversion rates/i, 'WP-5 sweep: unmeasured performance promise'],
    [/thousands of real-time listings/i, 'WP-5 sweep: invented inventory count'],
    [/Unmatched Salary Transparency/i, 'WP-5 sweep: superlative over a pipeline under rebuild'],
    [/Reach thousands actively searching/i, 'WP-5 sweep: unmeasured audience-size claim'],
    [/'Others: 30 days'/, "8c: the pricing fork's unverifiable competitor cell"],
];

describe('WP-5 — falsified promises stay removed from all production copy', () => {
    it('scans a plausible surface area (walker sanity check)', () => {
        expect(productionFiles.length).toBeGreaterThan(100);
        expect(productionFiles).toContain(path.join('app', 'about', 'AboutClient.tsx'));
        expect(productionFiles).toContain(path.join('content', 'blog', 'np-salary-guide.mdx'));
    });

    it('no banned claim appears in any production file', () => {
        const failures: string[] = [];
        for (const rel of productionFiles) {
            const src = rel.endsWith('.mdx') ? read(rel) : code(read(rel));
            for (const [pattern, why] of BANNED_CLAIMS) {
                if (pattern.test(src)) failures.push(`${rel}: ${pattern} (${why})`);
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('the softened claims state the screen, not the absolute', () => {
        const employers = read('app/for-employers/page.tsx');
        expect(employers).toContain('This board is built exclusively for');
        expect(employers).toContain('screened at ingest');
        // The FAQ answer feeds FAQPage JSON-LD — it must carry the same
        // screening commitment, not "only carries".
        expect(employers).toContain(
            'listings are screened at ingest and removed when flagged out of scope',
        );

        const about = read('app/about/AboutClient.tsx');
        expect(about).toContain('screened at ingest');
        // 8d replacement: the measurable feature the product actually has.
        expect(about).toContain('Filter alerts by state, compact eligibility, and specialty');
    });
});

describe('WP-5 — one audited comparison table, consumed by both pages', () => {
    it('both /for-employers and /pricing import the shared module', () => {
        for (const rel of ['app/for-employers/page.tsx', 'app/pricing/page.tsx']) {
            const src = read(rel);
            expect(src, rel).toContain("from '@/lib/employer-comparison'");
            expect(src, rel).toContain('EMPLOYER_COMPARISON_ROWS');
            // No local row-array literal — a fork is exactly how the audit
            // was lost the first time.
            expect(code(src), rel).not.toMatch(/const comparisonRows(?::|\s*=\s*\[)/);
        }
    });

    it('the shared row set carries the screening commitment, not the absolutes', () => {
        const comparison = read('lib/employer-comparison.ts');
        expect(comparison).toContain('${brand.niche.medium}-Focused Job Inventory');
        expect(comparison).toContain('screened at ingest and removed when flagged out of scope');
        const stripped = code(comparison);
        expect(stripped).not.toContain('No Unqualified Applicants');
        expect(stripped).not.toMatch(/100%[^,\n]*Audience/i);
    });
});

describe('review item 5 — BLS growth stat carries the verified 2024–2034 cycle', () => {
    it('STAT_SOURCES holds the NP-specific 2024–2034 figure exactly as published', () => {
        expect(STAT_SOURCES.blsGrowth2034.formatted).toBe('40%');
        expect(STAT_SOURCES.blsGrowth2034.value).toBe('40');
        expect(STAT_SOURCES.blsGrowth2034.source).toContain('2024–2034');
        expect(STAT_SOURCES.blsGrowth2034.source).toContain('Nurse Practitioners');
        expect(STAT_SOURCES.blsGrowth2034.sourceUrl).toMatch(/^https:\/\/www\.bls\.gov\//);
        // The projection cycle renders alongside the number everywhere the
        // entry is consumed, so a reader can date the figure.
        expect(STAT_SOURCES.blsGrowth2034.asOf).toBe('2025-09');
    });

    it('the retired key is gone — every consumer moved with the data', () => {
        // Comment-stripped: the stats file's changelog header may name the
        // old key when documenting the rename, but no CODE may reference it.
        const codeFiles = [...productionFiles, ...walk('scripts', ['.ts'])].filter(
            (f) => !f.endsWith('.mdx'),
        );
        const stale = codeFiles.filter((rel) => code(read(rel)).includes('blsGrowth2032'));
        expect(stale, stale.join('\n')).toEqual([]);
    });

    it('no stale 2022–2032 vintage string survives anywhere in production copy', () => {
        // Catches both token-derived labels ("Projected growth 2022-2032")
        // and hand-typed prose ("from 2022 to 2032", "through 2032").
        const STALE_VINTAGE = [
            /2022[–-]2032/,
            /2022 to 2032/i,
            /through 2032/i,
            /by 2032/i,
            /(?:grow|growth|increase)[^.\n]{0,60}\b45%/i,
            /\b45%[^.\n]{0,60}(?:employment|growth|projected)/i,
        ];
        const failures: string[] = [];
        for (const rel of productionFiles) {
            // Comment-stripped for code files: the stats file's changelog
            // documents the retired cycle; rendered strings must not.
            const src = rel.endsWith('.mdx') ? read(rel) : code(read(rel));
            for (const pattern of STALE_VINTAGE) {
                if (pattern.test(src)) failures.push(`${rel}: ${pattern}`);
            }
        }
        expect(failures, failures.join('\n')).toEqual([]);
    });

    it('the four hand-typed MDX posts cite the new cycle with attribution', () => {
        const posts = [
            'content/blog/remote-telehealth-np-jobs-guide.mdx',
            'content/blog/np-salary-guide.mdx',
            'content/blog/fnp-vs-pmhnp-vs-agacnp.mdx',
            'content/blog/new-grad-np-first-job.mdx',
        ];
        for (const rel of posts) {
            const body = read(rel);
            expect(body, rel).toMatch(/about 40%/);
            expect(body, rel).toContain('from 2024 to 2034');
            expect(body, rel).toMatch(/BLS/);
        }
    });
});

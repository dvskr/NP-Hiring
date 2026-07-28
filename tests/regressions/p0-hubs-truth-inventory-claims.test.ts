/**
 * P0 hubs-truth regression guards — fabricated-inventory sweep (content
 * audit 2026-07, P0 #5 / #18 / #24).
 *
 * #5  — feed.xml, /companies, /contact, /job-alerts, and the /blog CTA all
 *       hardcoded invented inventory figures ("10,000+ positions",
 *       "3,000+ employers", "200+ new daily"). The repo's own RULE
 *       (config/niche/copy.ts) is: NO hardcoded inventory counts in
 *       evergreen surfaces — evergreen claims only, live counters from
 *       lib/site-stats.ts for numbers. These tests block re-introduction.
 *
 * #18 — /login and /signup rendered fabricated testimonials ("Sarah M.",
 *       "James R.") — the same E-E-A-T pattern deliberately purged from
 *       /about (AboutClient.tsx SEO Fix H11). Pins their absence.
 *
 * #24 — TopStatesSection carried a FALLBACK_STATES list of invented
 *       per-state job counts shown whenever live data was thin. The fix is
 *       omit-not-fabricate: no data → render nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '@/lib/prisma';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Surfaces the audit flagged for fabricated inventory numbers.
const SWEPT_SURFACES = [
    'app/feed.xml/route.ts',
    'app/companies/page.tsx',
    'app/contact/page.tsx',
    'app/job-alerts/page.tsx',
    'app/blog/page.tsx',
] as const;

// The exact fabricated literals that shipped. Comments must not repeat
// them either — the ban is on the raw source text.
const FABRICATED_LITERALS = ['10,000+', '10K+', '3,000+', '200+'] as const;

describe('P0 #5 — no fabricated inventory literals on swept surfaces', () => {
    it.each(SWEPT_SURFACES)('%s contains none of the fabricated figures', (rel) => {
        const src = read(rel);
        for (const literal of FABRICATED_LITERALS) {
            expect(src, `${rel} re-introduces fabricated figure "${literal}"`).not.toContain(literal);
        }
    });

    it('feed.xml derives its channel count from getSiteStats (live counter)', () => {
        const src = read('app/feed.xml/route.ts');
        expect(src).toMatch(/import\s*\{[^}]*\bgetSiteStats\b[^}]*\}\s*from\s*'@\/lib\/site-stats'/);
        expect(src).toContain('getSiteStats()');
        // The description string must interpolate the derived display, not
        // a hardcoded number.
        expect(src).toMatch(/\$\{jobCountDisplay\} positions/);
    });

    it('feed.xml no longer makes the "number one job board" superlative claim', () => {
        expect(read('app/feed.xml/route.ts')).not.toContain('#1');
    });

    it('/companies metadata derives its employer count from getSiteStats', () => {
        const src = read('app/companies/page.tsx');
        expect(src).toMatch(/export\s+async\s+function\s+generateMetadata/);
        expect(src).toMatch(/import\s*\{[^}]*\bgetSiteStats\b[^}]*\}\s*from\s*'@\/lib\/site-stats'/);
        expect(src).toMatch(/\$\{companyCountDisplay\} employers/);
        // The old static metadata export (which froze the count) stays dead.
        expect(src).not.toMatch(/export\s+const\s+metadata/);
    });

    it('/contact FAQ keeps schema and visible answers on one array, count-free', () => {
        const src = read('app/contact/page.tsx');
        // Repo pattern: FAQPage JSON-LD and the accordion consume the SAME
        // FAQ_ITEMS array (app/contact/page.tsx design note).
        expect(src).toMatch(/FAQ_ITEMS\.map/);
        expect(src).toMatch(/<ContactFAQ items=\{FAQ_ITEMS\}/);
    });
});

describe('P0 #18 — fabricated auth testimonials stay deleted', () => {
    it.each(['app/login/page.tsx', 'app/signup/page.tsx'])(
        '%s passes no testimonial to AuthLayout and names no invented reviewer',
        (rel) => {
            const src = read(rel);
            expect(src).not.toContain('testimonial=');
            expect(src).not.toContain('Sarah M');
            expect(src).not.toContain('James R');
            expect(src).not.toMatch(/quote:/);
        },
    );
});

describe('P0 #24 — TopStatesSection omits instead of fabricating', () => {
    const REL = 'components/TopStatesSection.tsx';

    it('the fabricated FALLBACK_STATES list is gone from source', () => {
        const src = read(REL);
        expect(src).not.toContain('FALLBACK_STATES');
        // No literal per-state count objects survive anywhere in the file.
        expect(src).not.toMatch(/count:\s*\d/);
    });

    it('renders an empty list (→ TopStatesList returns null) when the query fails', async () => {
        vi.mocked(prisma.job.groupBy).mockRejectedValue(new Error('db down') as never);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const { default: TopStatesSection } = await import('@/components/TopStatesSection');
            const element = await TopStatesSection();
            expect(element.props.states).toEqual([]);
        } finally {
            consoleSpy.mockRestore();
        }
    });

    it('renders only the real states when live data is thin — never padded with inventions', async () => {
        vi.mocked(prisma.job.groupBy).mockResolvedValue([
            { state: 'Texas', _count: { state: 7 } },
            { state: 'Ohio', _count: { state: 3 } },
        ] as never);
        const { default: TopStatesSection } = await import('@/components/TopStatesSection');
        const element = await TopStatesSection();
        expect(element.props.states).toEqual([
            { name: 'Texas', count: 7, slug: 'texas' },
            { name: 'Ohio', count: 3, slug: 'ohio' },
        ]);
    });
});

beforeEach(() => vi.clearAllMocks());

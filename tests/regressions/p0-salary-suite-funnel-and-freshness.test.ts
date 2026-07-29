/**
 * Regression guards — content/SEO audit P0 items #6, #20, #22, #23
 * (salary-suite package).
 *
 * #6  The salary-guide email funnel was donor-branded (PMHNP PDF fallback
 *     and "PMHNP Salary Guide" subject) AND its deliverable was a dead
 *     link — the PDF behind brand.assets.salaryGuidePdf has never been
 *     uploaded, so the flow captured emails for nothing. The funnel now
 *     gates on SALARY_GUIDE_PDF_AVAILABLE (defaults off) at all three
 *     surfaces: the API refuses before capturing the lead, the hub page
 *     hides the download card, and ResourceDownloadGate delivers a link
 *     to the live /salary-guide content instead of running email capture.
 *
 * #20 The /salary-guide hub never linked its own 51 state children —
 *     state names in the table now link to /salary-guide/<state>.
 *
 * #22 The "Market Trends" table (12,500→15,800 monthly postings,
 *     telehealth %, time-to-fill) was fabricated — those figures exist in
 *     no source in the repo. Deleted; only sourced claims remain. The
 *     SalaryCalculator footnote's "10,000+ job postings" boast is gone.
 *
 * #23 Fabricated freshness: /salary-guide emitted Article
 *     dateModified=new Date() (render time) and the three resource guides
 *     rendered "Last Updated: {today}" while their Article schema said
 *     LAST_REVIEWED='2026-03-19'. All now derive from literal review-date
 *     constants a human updates on real review (B54 principle — state
 *     salary pages already omit dates for exactly this reason).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { SALARY_GUIDE_PDF_AVAILABLE } from '@/app/api/salary-guide/pdf-availability';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('P0 #6 — salary-guide email funnel is honest and brand-tokenized', () => {
    const routeSrc = read('app/api/salary-guide/route.ts');

    it('PDF fallback derives from config/brand.ts, not the donor asset', () => {
        expect(routeSrc).not.toContain('PMHNP_Salary_Guide');
        expect(routeSrc).toMatch(/process\.env\.SALARY_GUIDE_URL\s*\|\|\s*brand\.assets\.salaryGuidePdf/);
    });

    it('email subject uses the brand niche token, no hardcoded PMHNP', () => {
        expect(routeSrc).not.toContain('PMHNP');
        expect(routeSrc).toContain('${brand.niche.short} Salary Guide');
    });

    it('the availability flag matches the deliverable actually existing', () => {
        // P1 #4 authored the real PDF (public/downloads via
        // scripts/generate-salary-pdf.ts), so the flag is now ON — flipped
        // in the same change that produced the file, exactly as this test
        // demanded. tests/regressions/p1-salary-pdf-deliverable.test.ts
        // asserts the file behind brand.assets.salaryGuidePdf exists while
        // the flag is true; if the PDF is ever removed, flip this back to
        // false in the same change (and update that test).
        expect(SALARY_GUIDE_PDF_AVAILABLE).toBe(true);
    });

    it('the API refuses before any lead capture when the PDF is unavailable', () => {
        expect(routeSrc).toContain("from './pdf-availability'");
        const guardIdx = routeSrc.indexOf('if (!SALARY_GUIDE_PDF_AVAILABLE)');
        const upsertIdx = routeSrc.indexOf('prisma.emailLead.upsert');
        expect(guardIdx).toBeGreaterThan(-1);
        expect(upsertIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeLessThan(upsertIdx);
    });

    it('the hub page renders the PDF card only behind the flag', () => {
        const src = read('app/salary-guide/page.tsx');
        expect(src).toContain("from '@/app/api/salary-guide/pdf-availability'");
        expect(src).toMatch(/\{SALARY_GUIDE_PDF_AVAILABLE && \(/);
    });

    it('ResourceDownloadGate delivers real content instead of capture-for-nothing', () => {
        const src = read('components/ResourceDownloadGate.tsx');
        expect(src).toContain('SALARY_GUIDE_PDF_AVAILABLE');
        expect(src).toContain('href="/salary-guide"');
        // Donor-branded localStorage key is gone.
        expect(src).not.toContain('pmhnp_resource_unlocked');
    });
});

describe('P0 #20 — the hub links its own 51 state children', () => {
    it('state names link to /salary-guide/<state>', () => {
        const src = read('app/salary-guide/page.tsx');
        expect(src).toContain('href={`/salary-guide/${state.slug}`}');
    });

    it('hub slug derivation matches the [state] route (lowercase, hyphenated)', () => {
        const hubSrc = read('app/salary-guide/page.tsx');
        const stateSrc = read('app/salary-guide/[state]/page.tsx');
        const derivation = ".toLowerCase().replace(/\\s+/g, '-')";
        expect(hubSrc).toContain(derivation);
        expect(stateSrc).toContain(derivation);
    });
});

describe('P0 #22 — no fabricated market statistics', () => {
    it('the invented Market Trends figures are gone from the hub', () => {
        const src = read('app/salary-guide/page.tsx');
        expect(src).not.toContain('12,500');
        expect(src).not.toContain('14,200');
        expect(src).not.toContain('15,800');
        expect(src).not.toContain('Time to Fill');
        // Remaining demand claims must ride the cited stats.
        expect(src).toContain('SHORTAGE_POP.formatted');
        expect(src).toContain('NP_GROWTH.formatted');
    });

    it('SalaryCalculator footnote no longer boasts "10,000+" postings', () => {
        const src = read('components/SalaryCalculator.tsx');
        expect(src).not.toContain('10,000+');
        expect(src).toContain('live job postings on {brand.name}');
    });
});

describe('P0 #23 — freshness derives from real review dates, never render time', () => {
    it('/salary-guide Article dateModified uses a literal review date', () => {
        const src = read('app/salary-guide/page.tsx');
        expect(src).not.toMatch(/dateModified":\s*new Date\(\)/);
        expect(src).toMatch(/const LAST_REVIEWED_DATE = '\d{4}-\d{2}-\d{2}'/);
        expect(src).toContain('"dateModified": `${LAST_REVIEWED_DATE}T00:00:00Z`');
    });

    const guides = [
        'app/resources/1099-vs-w2/page.tsx',
        'app/resources/fpa-guide/page.tsx',
        'app/resources/private-practice-guide/page.tsx',
    ];

    for (const guide of guides) {
        it(`${guide} renders "Last Updated" from its LAST_REVIEWED constant`, () => {
            const src = read(guide);
            // The fabricated always-today stamp must not come back.
            expect(src).not.toContain('new Date().toLocaleDateString');
            // The visible date and the Article schema share one constant.
            expect(src).toMatch(/const LAST_REVIEWED = '\d{4}-\d{2}-\d{2}'/);
            expect(src).toContain('new Date(`${LAST_REVIEWED}T00:00:00Z`)');
            expect(src).toMatch(/dateModified:\s*LAST_REVIEWED/);
        });
    }
});

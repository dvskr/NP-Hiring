/**
 * Regression guards — content/SEO audit P1 #4 follow-up (salary-pdf package).
 *
 * WHAT THIS FILE EXISTS FOR
 *
 * p1-salary-pdf-deliverable.test.ts proves the PDF is REAL. This file
 * proves every surface that DESCRIBES it is TRUE — the other half of the
 * same promise, and the half that broke when SALARY_GUIDE_PDF_AVAILABLE
 * flipped to true.
 *
 * P0 #6 gated the salary-guide funnel because the link was dead while the
 * description was appealing. Flipping the flag on un-hid four surfaces
 * whose copy had been written for a PDF nobody had built:
 *
 *   - lib/email-service.ts told every captured lead the report "includes
 *     salary ranges across all 50 states, remote versus in-person pay
 *     differentials, and negotiation strategies";
 *   - app/salary-guide/page.tsx's flag-gated table note promised
 *     "comprehensive state-by-state data including cost-of-living
 *     adjustments" in the PDF;
 *   - the same page's flag-gated download card attributed the guide to
 *     ZipRecruiter, Indeed, PayScale, Glassdoor and CompHealth;
 *   - app/resources/page.tsx promised "state-by-state data" and labeled
 *     the edition with `new Date().getFullYear()`.
 *
 * The delivered PDF has NO state wage table (by design — see the note
 * above fetchLiveInventory in the generator: the disclosed-salary pool
 * mixes annualized locum hourly rates and physician postings with W-2
 * salaries, so freezing it would overstate typical pay), no
 * cost-of-living adjustment, no remote-vs-in-person differential, and a
 * Methodology section citing only BLS OEWS, BLS Employment Projections,
 * AANP, HRSA and this board's own postings.
 *
 * That is P0 #6 inverted: the link resolves, the description does not.
 * These guards make the inverted failure fail CI.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { brand } from '@/config/brand';
import {
    SALARY_GUIDE_PDF_AVAILABLE,
    SALARY_GUIDE_EDITION_YEAR,
} from '@/app/api/salary-guide/pdf-availability';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * These guards are about COPY A USER SEES, so they scan rendered text with
 * JSX `{/* … *\/}` and block comments removed. Without this, the comments
 * explaining *why* a claim was removed (which necessarily quote the removed
 * claim) would trip the very assertion they document.
 */
const stripComments = (src: string): string =>
    src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const GENERATOR = 'scripts/generate-salary-pdf.ts';
const HUB_PAGE = 'app/salary-guide/page.tsx';
const RESOURCES_PAGE = 'app/resources/page.tsx';
const EMAIL_SERVICE = 'lib/email-service.ts';
const EMAIL_PREVIEW = 'app/api/email-preview/v2-templates.ts';

/**
 * Claims about the PDF's CONTENTS that the artifact does not support.
 * Each is a phrase that shipped on a live surface describing the guide.
 */
const UNSUPPORTED_CONTENT_CLAIMS = [
    'salary ranges across all 50 states',
    'remote versus in-person pay differentials',
    'state-by-state data including cost-of-living adjustments',
    'cost-of-living adjustments',
];

/** Commercial aggregators the PDF's Methodology section never cites. */
const UNCITED_AGGREGATORS = ['ZipRecruiter', 'PayScale', 'Glassdoor', 'CompHealth'];

describe('P1 #4 follow-up — the delivery email describes the PDF that is actually sent', () => {
    const emailSrc = read(EMAIL_SERVICE);
    // Isolate the salary-guide template so unrelated email copy elsewhere
    // in this 1k+ line module cannot mask a regression here.
    const start = emailSrc.indexOf('export function buildSalaryGuideHtml');
    const salaryEmail = emailSrc.slice(start, emailSrc.indexOf('\n}', start));

    it('the template exists and was located for scanning', () => {
        expect(start).toBeGreaterThan(-1);
        expect(salaryEmail).toContain('buildSalaryGuideHtml');
    });

    it('makes no claim the PDF does not deliver', () => {
        for (const claim of UNSUPPORTED_CONTENT_CLAIMS) {
            expect(salaryEmail).not.toContain(claim);
        }
        // The generic "all 50 states" form is the one that captured leads
        // read as a state wage table.
        expect(salaryEmail).not.toMatch(/all 50 states/i);
    });

    it('routes state-level pay to the live table instead of promising it in the PDF', () => {
        expect(salaryEmail).toMatch(/state/i);
        expect(salaryEmail).toContain('/salary-guide');
    });

    it('labels the edition from the artifact on disk, never from the clock', () => {
        expect(salaryEmail).toContain('SALARY_GUIDE_EDITION_YEAR');
        expect(salaryEmail).not.toMatch(/getFullYear/);
        // No hardcoded year that can silently disagree with the file.
        expect(salaryEmail).not.toMatch(/Your 20\d{2} Salary Guide/);
    });
});

describe('P1 #4 follow-up — the admin email preview mirrors the real template', () => {
    const previewSrc = read(EMAIL_PREVIEW);
    const start = previewSrc.indexOf("'salary-guide': {");
    const block = previewSrc.slice(start, previewSrc.indexOf('},', start));

    it('carries none of the unsupported claims', () => {
        expect(start).toBeGreaterThan(-1);
        for (const claim of UNSUPPORTED_CONTENT_CLAIMS) {
            expect(block).not.toContain(claim);
        }
    });

    it('previews the real PDF URL, not the donor board’s dead storage object', () => {
        expect(block).not.toContain('PMHNP_Salary_Guide');
        expect(block).not.toContain('storageBase');
        expect(block).toContain('brand.assets.salaryGuidePdf');
    });
});

describe('P1 #4 follow-up — the hub page’s flag-gated surfaces are truthful', () => {
    const hubSrc = stripComments(read(HUB_PAGE));

    it('never advertises the PDF as the source of state-by-state data', () => {
        // The one thing the PDF explicitly refuses to print must not be
        // the thing the page sells it on.
        expect(hubSrc).not.toContain('download our full PDF guide above');
        expect(hubSrc).not.toContain('state-by-state data including cost-of-living adjustments');
        expect(hubSrc).not.toMatch(/cost-of-living adjustments/i);
    });

    it('the state-table note no longer branches on the PDF flag', () => {
        // The flag flip is what made the false branch visible. The note
        // describes the live table, which is true regardless of the flag.
        // Anchor updated for the P9 #2c/#2d rebuild: the note now describes
        // the gated-median table (still flag-independent, still true of the
        // live table).
        const noteStart = hubSrc.indexOf('<strong>Note:</strong> Each figure is the <strong>median</strong>');
        expect(noteStart).toBeGreaterThan(-1);
        const note = hubSrc.slice(noteStart, noteStart + 800);
        expect(note).not.toContain('SALARY_GUIDE_PDF_AVAILABLE');
        expect(note).toContain('Each state name links to a detailed page');
    });

    it('the download card attributes only sources the PDF actually cites', () => {
        for (const vendor of UNCITED_AGGREGATORS) {
            expect(hubSrc).not.toContain(vendor);
        }
        expect(hubSrc).toContain('Sources: BLS OEWS, BLS Employment Projections, AANP, HRSA');
    });

    it('every attributed source appears in the generator’s Methodology list', () => {
        const generatorSrc = read(GENERATOR);
        // methodologySources renders exactly these four STAT_SOURCES entries.
        const cited = [
            'STAT_SOURCES.averageSalary',      // BLS OEWS
            'STAT_SOURCES.blsGrowth2034',      // BLS Employment Projections
            'STAT_SOURCES.fullPracticeStates', // AANP
            'STAT_SOURCES.hrsaShortagePopulation', // HRSA
        ];
        for (const entry of cited) expect(generatorSrc).toContain(entry);
        expect(generatorSrc).toContain('methodologySources');
        // …and no commercial aggregator sneaks into the artifact either.
        for (const vendor of UNCITED_AGGREGATORS) {
            expect(generatorSrc).not.toContain(vendor);
        }
    });
});

describe('P1 #4 follow-up — the /resources download card is truthful', () => {
    const resourcesSrc = stripComments(read(RESOURCES_PAGE));
    const cardStart = resourcesSrc.indexOf('Free Salary Guide PDF');
    const card = resourcesSrc.slice(cardStart, resourcesSrc.indexOf('ResourceDownloadGate', cardStart) + 200);

    it('promises no state-by-state data above the un-gated capture form', () => {
        expect(cardStart).toBeGreaterThan(-1);
        expect(card).not.toMatch(/state-by-state/);
        expect(card).not.toMatch(/all 50 states/i);
    });

    it('labels the edition from the artifact, not from new Date()', () => {
        expect(card).toContain('SALARY_GUIDE_EDITION_YEAR');
        expect(card).not.toContain('{currentYear}');
    });
});

describe('P1 #4 follow-up — the edition year is pinned to the file on disk', () => {
    it('parses from the published asset filename', () => {
        expect(SALARY_GUIDE_EDITION_YEAR).toMatch(/^20\d{2}$/);
        expect(brand.assets.salaryGuidePdf).toContain(SALARY_GUIDE_EDITION_YEAR);
    });

    it('names the PDF that actually exists in public/', () => {
        expect(SALARY_GUIDE_PDF_AVAILABLE).toBe(true);
        const pdfLocalPath = path.join(
            ROOT,
            'public',
            new URL(brand.assets.salaryGuidePdf).pathname.replace(/^\//, ''),
        );
        expect(fs.existsSync(pdfLocalPath)).toBe(true);
        expect(path.basename(pdfLocalPath)).toContain(SALARY_GUIDE_EDITION_YEAR);
    });

    it('the generator stamps the PDF cover with the same shared constant', () => {
        const generatorSrc = read(GENERATOR);
        expect(generatorSrc).toContain('SALARY_GUIDE_EDITION_YEAR');
        expect(generatorSrc).not.toMatch(/const GUIDE_YEAR = '20\d{2}'/);
        // A clock-derived edition would re-label last year's figures.
        expect(generatorSrc).not.toMatch(/GUIDE_YEAR\s*=.*getFullYear/);
    });
});

describe('P1 #4 follow-up — validation bands are not published as market measurements', () => {
    const generatorSrc = read(GENERATOR);

    it('does not reframe the donor-inherited ingestion constants as where offers land', () => {
        // config/niche/salary.ts documents `typical` as the donor board's
        // "PMHNP/AGNP mid-band (donor:43-46)" and annualMax as a CRNA
        // ceiling. Printing them as NP market distribution facts in a
        // permanent citable document is the same class of claim this
        // package refused for the state table.
        expect(generatorSrc).not.toContain('Where most full-time employed');
        expect(generatorSrc).not.toContain('top of the ${brand.niche.short} employed market');
        expect(generatorSrc).not.toMatch(/Part-time new-grad floor through/);
    });

    it('labels them as ingestion thresholds and says so explicitly', () => {
        expect(generatorSrc).toContain('ingestion thresholds');
        expect(generatorSrc).toContain('not a measurement');
        expect(generatorSrc).toContain('Accept/reject bounds');
        // The section header the deliverable test also pins.
        expect(generatorSrc).toContain('Salary-Validation Bands');
    });

    it('discloses that the ceiling is a CRNA-level limit, not an NP outcome', () => {
        // config/niche/salary.ts:52 — "CRNA in HCOL / high-volume settings".
        expect(generatorSrc).toMatch(/CRNA-level/);
        expect(generatorSrc).toContain('not the top of the');
    });

    it('still points readers to a real measured figure instead', () => {
        expect(generatorSrc).toContain('use the federal benchmark above');
    });
});

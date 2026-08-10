/**
 * P5 A7/A8 — static source guards for the /reports pages.
 *
 * These pages exist to be cited, which makes them the easiest pages on the
 * site to quietly turn into marketing. The guards pin the properties that
 * make them publishable at all:
 *
 *   1. Every live figure renders from lib/reports/* queries; DB failure
 *      omits the block (the /press pattern) — no fallback constants, and
 *      no hand-typed statistics in the page source.
 *   2. Below-threshold sections say "sample too small" instead of
 *      rendering a padded number, and the gates come from the shared
 *      model/benchmark constants rather than page-local literals.
 *   3. Competitor material on the pay-transparency page is a dated,
 *      source-linked verbatim quote — never an undated claim, never a
 *      third-party statistic we cannot recompute, and never a
 *      snippet-only source.
 *   4. JSON-LD uses the repo's escape pattern and the Dataset schema is
 *      conditional on the live data actually rendering.
 *
 * Static source assertions, matching the repo's pin pattern
 * (tests/regressions/p2-trust-surfaces-accessibility-press.test.ts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    BRAND_LEAK_PATTERNS,
    TEMPLATE_REFERENCE_NICHE_TERMS,
} from './brand-leak-scan';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const NEW_FILES = [
    'lib/reports/report-model.ts',
    'lib/reports/editions.ts',
    'lib/reports/queries.ts',
    'app/reports/page.tsx',
    'app/reports/state-of-np-hiring-2026/page.tsx',
    'app/reports/pay-transparency/page.tsx',
] as const;

const hubPage = read('app/reports/page.tsx');
const reportPage = read('app/reports/state-of-np-hiring-2026/page.tsx');
const payPage = read('app/reports/pay-transparency/page.tsx');
const queries = read('lib/reports/queries.ts');
const pressPage = read('app/press/page.tsx');

/** Strip comments so doc comments naming banned strings don't trip guards. */
const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('P5 reports — pages exist as server components and are indexable', () => {
    it('all three pages exist with no client bundle', () => {
        for (const rel of ['app/reports/page.tsx', 'app/reports/state-of-np-hiring-2026/page.tsx', 'app/reports/pay-transparency/page.tsx']) {
            expect(exists(rel), rel).toBe(true);
            expect(read(rel)).not.toContain("'use client'");
        }
    });

    it('each declares canonical + index metadata', () => {
        for (const src of [hubPage, reportPage, payPage]) {
            expect(src).toMatch(/robots:\s*\{\s*index:\s*true/);
            expect(src).toContain('alternates: { canonical:');
        }
    });

    it('escapes every JSON-LD block with the repo pattern', () => {
        for (const src of [hubPage, reportPage, payPage]) {
            expect(src).toContain("replace(/</g, '\\\\u003c')");
            expect(src).toContain("replace(/>/g, '\\\\u003e')");
        }
    });
});

describe('P5 reports — live figures derive, never hand-typed', () => {
    it('the report pages load aggregates from lib/reports/queries', () => {
        expect(reportPage).toContain("from '@/lib/reports/queries'");
        expect(reportPage).toContain('loadHiringReportSnapshot');
        expect(payPage).toContain("from '@/lib/reports/queries'");
        expect(payPage).toContain('loadDisclosureCohort');
    });

    it('queries omit on failure (return null) instead of falling back', () => {
        expect(queries).toContain('catch (error)');
        expect(queries).toContain('return null;');
        // …and the pages handle the omission honestly.
        expect(reportPage).toContain('{!snapshot && (');
        expect(payPage).toContain('unavailable right now');
    });

    it('no hardcoded salary / growth / shortage figures in page copy', () => {
        for (const src of [hubPage, reportPage, payPage]) {
            expect(src).not.toMatch(/\$1[0-9]{2},[0-9]{3}/);
            expect(src).not.toMatch(/\b\d{2}\s?million\+?/i);
            expect(src).not.toMatch(/\b27 states\b/);
            // A literal "NN% of … postings" typed into source would be a
            // second source of truth for a live-computed rate.
            expect(code(src)).not.toMatch(/\b\d+(\.\d+)?%\s+of\b/);
        }
    });

    it('national context renders from STAT_SOURCES, not retyped', () => {
        expect(reportPage).toContain("from '@/lib/stats-sources'");
        expect(reportPage).toContain('STAT_SOURCES.averageSalary');
        expect(reportPage).toContain('STAT_SOURCES.blsGrowth2032');
        expect(reportPage).toContain('STAT_SOURCES.fullPracticeStates');
    });
});

describe('P5 reports — sample gates are shared constants, honestly rendered', () => {
    it('gates come from report-model and benchmark-model, not page literals', () => {
        expect(reportPage).toContain('REPORT_MIN_SHARE_SAMPLE');
        expect(reportPage).toContain('REPORT_MIN_GROUP_COUNT');
        expect(reportPage).toContain('BENCHMARK_MIN_POSTINGS');
        expect(reportPage).toContain('BENCHMARK_MIN_EMPLOYERS');
        expect(payPage).toContain('REPORT_MIN_SHARE_SAMPLE');
        expect(payPage).toContain('TREND_MIN_MONTH_SAMPLE');
        expect(payPage).toContain('TREND_MIN_MONTHS');
        // The model file is the only place the report thresholds are defined.
        for (const page of [reportPage, payPage]) {
            expect(code(page)).not.toMatch(/REPORT_MIN_SHARE_SAMPLE\s*=/);
            expect(code(page)).not.toMatch(/BENCHMARK_MIN_POSTINGS\s*=/);
        }
    });

    it('below-threshold sections say so instead of printing a number', () => {
        expect(reportPage).toContain('Sample too small to publish');
        expect(payPage).toContain('Sample too small to publish');
        expect(payPage).toContain('Not enough history to publish a trend');
    });

    it('salary aggregation reuses the benchmark widget gates and excludes estimates', () => {
        expect(queries).toContain("from '@/components/tools/benchmark-model'");
        expect(queries).toContain('summarizeBenchmarks');
        expect(queries).toContain('salaryIsEstimated: false');
        expect(queries).toContain('activeIndexableJobWhere');
    });

    it('the trend cohort excludes the current partial month', () => {
        expect(queries).toContain("created_at < date_trunc('month', now())");
    });
});

describe('P5 reports — methodology states the basis and the limits', () => {
    it('the annual report says what it is not', () => {
        expect(reportPage).toContain('not a national census');
        expect(reportPage).toContain('Not a wage survey');
        expect(reportPage).toMatch(/as[ -]of/i);
    });

    it('the Dataset schema only exists when the live data rendered', () => {
        expect(reportPage).toContain('const datasetSchema = snapshot');
        expect(reportPage).toContain('{datasetSchema && (');
        // Its variableMeasured derives from the same array as the visible h2s.
        expect(reportPage).toContain('Object.values(LIVE_SECTION_TITLES)');
    });

    it('editions are designed for re-issue, not rewrite', () => {
        expect(read('lib/reports/editions.ts')).toContain('STATE_OF_HIRING_EDITIONS');
        expect(reportPage).toMatch(/new pages|new edition/i);
    });
});

describe('P5 reports — competitor material obeys the claims rules', () => {
    /** Parse the observations array the page renders from. */
    const observationsBlock = payPage.slice(
        payPage.indexOf('const MARKET_OBSERVATIONS'),
        payPage.indexOf('const clayCard'),
    );
    const verifiedDates = [...observationsBlock.matchAll(/verifiedOn: '(\d{4}-\d{2}-\d{2})'/g)].map(
        (m) => m[1],
    );
    const sourceUrls = [...observationsBlock.matchAll(/sourceUrl: '(https:\/\/[^']+)'/g)].map(
        (m) => m[1],
    );
    const boards = [...observationsBlock.matchAll(/board: '([^']+)'/g)].map((m) => m[1]);

    it('every observation carries a board, a source URL, and a verified date', () => {
        expect(boards.length).toBeGreaterThan(0);
        expect(sourceUrls.length).toBe(boards.length);
        expect(verifiedDates.length).toBe(boards.length);
    });

    it('every observation is rendered with its date and link (no undated claims)', () => {
        expect(payPage).toContain('as fetched {formatDay(obs.verifiedOn)}');
        expect(payPage).toContain('href={obs.sourceUrl}');
    });

    it('publishes no third-party posting statistics it cannot recompute', () => {
        // The teardown measured a competitor's "Not provided" rate, but that
        // figure could not be re-verified live at publish time — so no
        // third-party percentage may appear here. If one is ever added, it
        // must be recomputable on demand, which for another board's listings
        // it cannot be.
        expect(code(payPage)).not.toMatch(/93\.6/);
        expect(code(payPage)).not.toMatch(/\bENP\b/);
    });

    it('names no snippet-only sources', () => {
        for (const src of [hubPage, reportPage, payPage]) {
            expect(code(src)).not.toMatch(/health\s?ecareers/i);
        }
    });

    it('links the legal dimension to an authority instead of asserting it', () => {
        expect(payPage).toContain('https://www.dol.gov/agencies/whd/state/contacts');
        expect(payPage).toContain('assert none');
    });
});

describe('P5 reports — discoverability and copy hygiene', () => {
    it('/press links the reports from the shared editions array', () => {
        expect(pressPage).toContain("from '@/lib/reports/editions'");
        expect(pressPage).toContain('ALL_REPORTS.map');
        expect(pressPage).toContain('REPORTS_HUB_PATH');
    });

    it('the hub renders its cards and schema from the same editions array', () => {
        expect(hubPage).toContain("from '@/lib/reports/editions'");
        expect(hubPage).toContain('ALL_REPORTS.map');
        expect(hubPage).toContain('hasPart: ALL_REPORTS.map');
    });

    it('new files add zero brand-leak or reference-niche debt', () => {
        // Mirrors the ratchet scanners so a violation fails HERE with the
        // file named, instead of surfacing as an opaque baseline diff.
        for (const rel of NEW_FILES) {
            const content = read(rel);
            for (const { name, re } of BRAND_LEAK_PATTERNS) {
                expect(content.match(re), `${rel} leaks ${name}`).toBeNull();
            }
            for (const re of TEMPLATE_REFERENCE_NICHE_TERMS) {
                expect(content.match(re), `${rel} hardcodes reference-niche term ${re}`).toBeNull();
            }
        }
    });
});

/**
 * Three truth cleanups, pinned together because each one removed a figure
 * the site could not support.
 *
 *   1. AANP vintage. STAT_SOURCES.fullPracticeStates.asOf read '2025' after
 *      the count was re-read on 2026-09-25 from the AANP State Practice
 *      Environment map marked "Updated: 05/2026". Every citation printed
 *      "(AANP State Practice Environment, 2025)". The hand-authored posts in
 *      content/blog/ cite the vintage as a literal, so they are checked here
 *      against asOf, not only the posts a batch test happens to cover.
 *
 *   2. Licensure checker. components/LicensureChecker.tsx printed a weeks
 *      estimate keyed to the AANP tier ("from application to active
 *      license") for every state, and a fees block with national figures
 *      (exam fee range, DEA fee, renewal cycle, CE hour range) that carried
 *      no source and that per-state rules contradict. Processing time and
 *      fees are set by each board or body, not by the tier. The checker now
 *      names who sets each one, and nothing it prints is looked up by tier
 *      except the AANP tier label itself.
 *
 *   3. Homepage FAQ. components/HomepageFAQ.tsx quoted hand-typed pay bands
 *      (private practice owner, physician comparison, new graduate,
 *      experienced, remote), called the BLS median an "average", and gave a
 *      patients-per-day range, an NHSC award amount and training lengths in
 *      years (whose parts did not add up to the stated total), all unsourced.
 *      The only pay figure left is STAT_SOURCES.averageSalary, labelled median.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { STAT_SOURCES } from '@/lib/stats-sources';
import { STATE_PRACTICE_AUTHORITY } from '@/lib/state-practice-authority';
import {
    COST_OWNERS_NOTE,
    PROCESSING_TIME_NOTE,
    licensureCostOwners,
    processingTimeHeadline,
} from '@/components/LicensureChecker';
import { buildHomepageFaqs } from '@/components/HomepageFAQ';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Source with comments removed: the docblocks name the retired copy on purpose. */
const readCode = (rel: string): string =>
    read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** House style: no em dash, en dash or spaced hyphen. */
const DASH = /[—–]|\s-\s/;
/** A number range written with a hyphen or "to", e.g. "4-8" or "4 to 8". */
const NUMBER_RANGE = /\b\d+\s*(?:-|to)\s*\d+\b/;

const STATE_NAMES = Object.keys(STATE_PRACTICE_AUTHORITY);

describe('AANP practice environment vintage', () => {
    const fpa = STAT_SOURCES.fullPracticeStates;

    it('carries the year of the map revision the count was read from', () => {
        expect(fpa.asOf).toBe('2026');
        expect(fpa.vintageNote).toContain('Updated: 05/2026');
        expect(fpa.vintageNote).toContain('2026-09-25');
    });

    it('still agrees with the dataset: 27 states plus DC', () => {
        const full = Object.entries(STATE_PRACTICE_AUTHORITY).filter(([, info]) => info.authority === 'full');
        expect(full).toHaveLength(28);
        expect(full.map(([name]) => name)).toContain('District of Columbia');
        expect(String(full.length - 1)).toBe(fpa.value);
        expect(fpa.formatted).toBe(`${fpa.value} states + DC`);
    });

    it('every AANP practice environment citation in content/blog uses the current vintage', () => {
        const dir = path.join(ROOT, 'content/blog');
        // "(AANP, 2026)", "per AANP, 2026)", "by the AANP (2026)",
        // "(AANP State Practice Environment, 2026)", "(as of 2026)".
        const CITATION = /AANP(?: State Practice Environment)?(?:,\s*| \((?:as of )?)(\d{4})\)/g;
        let citations = 0;
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.mdx'))) {
            const body = fs.readFileSync(path.join(dir, file), 'utf8');
            for (const m of body.matchAll(CITATION)) {
                citations += 1;
                expect(m[1], `${file}: "${m[0]}" cites a stale AANP vintage`).toBe(fpa.asOf);
            }
        }
        // The pattern must keep finding the citations it guards.
        expect(citations).toBeGreaterThanOrEqual(10);
    });
});

describe('licensure checker: no tier-keyed or unsourced figures', () => {
    const CHECKER = 'components/LicensureChecker.tsx';

    it('the processing time card names the board and carries no estimate', () => {
        const NO_ESTIMATE = /\bweeks?\b|\bmonths?\b|\bdays?\b|\d/i;
        for (const name of STATE_NAMES) {
            const headline = processingTimeHeadline(name);
            expect(headline).toBe(`Set by the ${name} board of nursing`);
            expect(headline, name).not.toMatch(NO_ESTIMATE);
            expect(headline, name).not.toMatch(DASH);
        }
        expect(PROCESSING_TIME_NOTE).not.toMatch(NO_ESTIMATE);
        expect(PROCESSING_TIME_NOTE).not.toMatch(DASH);
        expect(PROCESSING_TIME_NOTE).toContain('tier does not predict it');
    });

    it('the processing time copy is one shape for every state, so it cannot follow the tier', () => {
        const shapes = new Set(STATE_NAMES.map((name) => processingTimeHeadline(name).replace(name, '<state>')));
        expect(shapes.size).toBe(1);
        // The note is a constant: no per-state or per-tier input reaches it.
        expect(readCode(CHECKER)).toContain('{PROCESSING_TIME_NOTE}');
    });

    it('the fees block names who sets each figure and quotes none', () => {
        for (const name of STATE_NAMES) {
            const rows = licensureCostOwners(name);
            expect(rows.map((r) => r.label)).toEqual([
                'Certification exam fee',
                'DEA registration fee',
                'License fee and renewal cycle',
                'State CE hours',
            ]);
            for (const row of rows) {
                const text = `${row.label} ${row.setBy}`;
                expect(text, name).not.toMatch(/\$|\d/);
                expect(text, name).not.toMatch(DASH);
            }
            expect(rows.filter((r) => r.setBy === `${name} board of nursing`)).toHaveLength(2);
        }
        expect(COST_OWNERS_NOTE).not.toMatch(/\$|\d/);
        expect(COST_OWNERS_NOTE).not.toMatch(DASH);
    });

    it('the source carries no timeline map, weeks band or hand-typed fee', () => {
        const code = readCode(CHECKER);
        expect(code).not.toContain('TIMELINE_MAP');
        expect(code).not.toMatch(/Estimated Timeline/i);
        expect(code).not.toMatch(/\bweeks\b/);
        expect(code).not.toMatch(/\$\d/);
        expect(code).not.toMatch(/'\d+\s*-\s*\d+[^']*'/);
    });

    it('the tier selects the badge and nothing else', () => {
        const code = readCode(CHECKER);
        // One tier-keyed record (the badge) and one lookup into it.
        expect(code.match(/Record<PracticeAuthority,/g)).toHaveLength(1);
        expect(code.match(/\[auth\.authority\]/g)).toHaveLength(1);
        expect(code).toContain('AUTHORITY_CONFIG[auth.authority]');
    });
});

describe('homepage FAQ: the only pay figure is the cited BLS median', () => {
    const faqs = buildHomepageFaqs([]);
    const median = STAT_SOURCES.averageSalary;
    const byQuestion = (cue: string) => {
        const faq = faqs.find((f) => f.question.includes(cue));
        expect(faq, cue).toBeDefined();
        return faq!.answer;
    };

    it('prints no dollar figure other than the median', () => {
        for (const { question, answer } of faqs) {
            const rest = answer.split(median.formatted).join('');
            expect(rest.match(/\$\d[\d,]*\+?/g) ?? [], question).toEqual([]);
        }
    });

    it('calls the BLS figure a median, never an average', () => {
        expect(byQuestion('make')).toContain(`median annual wage for`);
        expect(byQuestion('make')).toContain(median.formatted);
        expect(byQuestion('make')).toContain(median.source);
        for (const { question, answer } of faqs) {
            expect(answer, question).not.toMatch(/average (annual )?(salary|pay|wage|income)/i);
        }
    });

    it('private practice and physician answers keep their substance without invented pay', () => {
        const practice = byQuestion('private practice');
        expect(practice).toMatch(/patient volume, payer mix and overhead/);
        expect(practice).not.toMatch(/\$/);
        const physician = byQuestion('physician?');
        expect(physician).not.toMatch(/physicians at/);
        expect(physician.split(median.formatted).join('')).not.toMatch(/\$/);
    });

    it('the training length answers quote no unsourced year counts', () => {
        expect(byQuestion('How long')).not.toMatch(NUMBER_RANGE);
        expect(byQuestion('How long')).not.toMatch(/\b\d+ years?\b/);
        // The sourced median's citation carries the BLS occupation code
        // (29-1171), which is an identifier, not a range; strip it first.
        expect(byQuestion('physician?').split(median.source).join('')).not.toMatch(NUMBER_RANGE);
    });

    it('drops the unsourced patient volume, remote pay and NHSC award figures', () => {
        expect(byQuestion('typical workday')).not.toMatch(NUMBER_RANGE);
        expect(byQuestion('remote')).not.toMatch(/\$|growing/i);
        const loans = byQuestion('loan forgiveness');
        expect(loans).not.toMatch(/\$/);
        expect(loans).toContain('nhsc.hrsa.gov');
    });

    it('carries no dashes in any answer', () => {
        for (const { question, answer } of faqs) {
            expect(`${question} ${answer}`, question).not.toMatch(DASH);
        }
    });
});

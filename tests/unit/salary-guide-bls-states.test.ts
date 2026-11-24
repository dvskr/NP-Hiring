/**
 * The BLS OEWS state wage module (lib/salary-guide-bls-states.ts over the
 * generated lib/salary-guide-bls-states.data.ts). Invariants, not source
 * shape: 51 rows, every number read back from the cell BLS printed, a
 * footnoted cell is null and never 0, the percentiles are ordered, and the
 * national rows equal the figures the rest of the site already cites.
 */
import { describe, it, expect } from 'vitest';
import { CODE_TO_STATE } from '@/lib/pseo/setting-state-config';
import { STAT_SOURCES } from '@/lib/stats-sources';
import { PA_MEDIAN_WAGE } from '@/app/resources/what-is-a-nurse-practitioner/verified-facts';
import {
    BLS_FOOTNOTE_LABEL,
    BLS_NATIONAL,
    BLS_OEWS_AS_OF,
    BLS_OEWS_VINTAGE,
    BLS_PA_STATE_WAGES,
    BLS_RN_STATE_WAGES,
    BLS_STATE_SOURCE_URL,
    BLS_STATE_WAGES,
    blsStatesByMedianDesc,
    bottomStatesByMedian,
    compareWithNationalMedian,
    formatBlsDollars,
    formatBlsHourly,
    hasBlsStateMedian,
    parseBlsCell,
    topStatesByMedian,
    type BlsFigure,
} from '@/lib/salary-guide-bls-states';

const JURISDICTIONS = Object.values(CODE_TO_STATE).sort();

function figuresOf(row: object): BlsFigure[] {
    return Object.values(row).filter(
        (v): v is BlsFigure => typeof v === 'object' && v !== null && 'raw' in v && 'footnote' in v,
    );
}

describe('BLS state wages: coverage', () => {
    it('has exactly the 50 states and DC for every occupation', () => {
        expect(JURISDICTIONS).toHaveLength(51);
        expect(Object.keys(BLS_STATE_WAGES).sort()).toEqual(JURISDICTIONS);
        expect(Object.keys(BLS_PA_STATE_WAGES).sort()).toEqual(JURISDICTIONS);
        expect(Object.keys(BLS_RN_STATE_WAGES).sort()).toEqual(JURISDICTIONS);
    });

    it('keys each row by its own state name, code and route slug', () => {
        for (const [code, name] of Object.entries(CODE_TO_STATE)) {
            const row = BLS_STATE_WAGES[name];
            expect(row.state).toBe(name);
            expect(row.stateCode).toBe(code);
            expect(row.slug).toBe(name.toLowerCase().replace(/\s+/g, '-'));
        }
    });
});

describe('BLS state wages: no invented values', () => {
    const allRows = [
        ...Object.values(BLS_STATE_WAGES),
        ...Object.values(BLS_PA_STATE_WAGES),
        ...Object.values(BLS_RN_STATE_WAGES),
        ...Object.values(BLS_NATIONAL),
    ];

    it('every number is the cell BLS printed, and only a footnote marker is null', () => {
        for (const row of allRows) {
            for (const figure of figuresOf(row)) {
                if (figure.value === null) {
                    expect(['#', '*', '**']).toContain(figure.raw);
                    expect(figure.footnote).not.toBeNull();
                } else {
                    expect(figure.footnote).toBeNull();
                    expect(figure.value).toBe(Number(figure.raw));
                    expect(figure.value).toBeGreaterThan(0);
                }
            }
        }
    });

    it('orders the percentiles and ties the annual median to the hourly median', () => {
        for (const row of [...Object.values(BLS_STATE_WAGES), BLS_NATIONAL.np]) {
            const ordered = [row.annualP10, row.annualP25, row.annualMedian, row.annualP75, row.annualP90]
                .map((f) => f.value)
                .filter((v): v is number => v !== null);
            expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
            if (row.annualMedian.value !== null && row.hourlyMedian.value !== null) {
                expect(Math.abs(row.hourlyMedian.value * 2080 - row.annualMedian.value)).toBeLessThanOrEqual(20);
            }
        }
    });

    it('parses a footnote marker to null with its reason, and refuses a zero or a blank', () => {
        expect(parseBlsCell('#')).toEqual({ value: null, raw: '#', footnote: 'top-coded' });
        expect(parseBlsCell('*')).toEqual({ value: null, raw: '*', footnote: 'not-published' });
        expect(parseBlsCell('**').footnote).toBe('not-published');
        expect(() => parseBlsCell('0')).toThrow();
        expect(() => parseBlsCell('')).toThrow();
        expect(() => parseBlsCell('n/a')).toThrow();
    });

    it('prints a footnoted cell as its label, never as a dollar figure or 0', () => {
        const topCoded = parseBlsCell('#');
        expect(formatBlsDollars(topCoded)).toBe(BLS_FOOTNOTE_LABEL['top-coded']);
        expect(formatBlsHourly(parseBlsCell('*'))).toBe(BLS_FOOTNOTE_LABEL['not-published']);
        expect(formatBlsDollars(topCoded)).not.toMatch(/\$|\b0\b/);
    });
});

describe('BLS state wages: agree with the figures already cited', () => {
    it('national 29-1171 equals STAT_SOURCES (median and both percentiles)', () => {
        expect(String(BLS_NATIONAL.np.annualMedian.value)).toBe(STAT_SOURCES.averageSalary.value);
        expect(String(BLS_NATIONAL.np.annualP10.value)).toBe(STAT_SOURCES.salaryPercentile10.value);
        expect(String(BLS_NATIONAL.np.annualP90.value)).toBe(STAT_SOURCES.salaryPercentile90.value);
        expect(BLS_OEWS_AS_OF).toBe(STAT_SOURCES.averageSalary.asOf);
    });

    it('national 29-1071 equals the PA median the definition guides cite', () => {
        expect(String(BLS_NATIONAL.pa.annualMedian.value)).toBe(PA_MEDIAN_WAGE.value);
        expect(PA_MEDIAN_WAGE.asOf).toBe(BLS_OEWS_AS_OF);
    });

    it('builds each state median as a cited StatSource with the vintage', () => {
        for (const row of Object.values(BLS_STATE_WAGES)) {
            if (row.annualMedian.value === null) {
                expect(row.medianSource).toBeNull();
                continue;
            }
            expect(row.medianSource?.value).toBe(row.annualMedian.raw);
            expect(row.medianSource?.source).toContain(row.state);
            expect(row.medianSource?.source).toContain('29-1171');
            expect(row.medianSource?.source).toContain('May 2025');
            expect(row.medianSource?.asOf).toBe('2025-05');
            expect(row.medianSource?.sourceUrl).toBe(BLS_STATE_SOURCE_URL);
        }
        expect(BLS_STATE_SOURCE_URL).toMatch(/^https:\/\/www\.bls\.gov\/oes\/special-requests\/oesm25st\.zip$/);
        expect(BLS_OEWS_VINTAGE).toBe('May 2025 OEWS, U.S. Bureau of Labor Statistics');
    });
});

describe('BLS state wages: ranking helpers', () => {
    it('ranks by median, highest first, and the bottom list is the same ranking reversed', () => {
        const ranked = blsStatesByMedianDesc();
        const medians = ranked.map((row) => row.annualMedian.value as number);
        expect([...medians].sort((a, b) => b - a)).toEqual(medians);
        expect(topStatesByMedian(5)).toEqual(ranked.slice(0, 5));
        expect(bottomStatesByMedian(5)).toEqual([...ranked].reverse().slice(0, 5));
        expect(topStatesByMedian(0)).toEqual([]);
    });

    it('states every comparison against its named national base', () => {
        for (const row of Object.values(BLS_STATE_WAGES)) {
            expect(hasBlsStateMedian(row.state)).toBe(row.annualMedian.value !== null);
            const clause = compareWithNationalMedian(row);
            if (clause) expect(clause).toMatch(/(above|below) the national median of \$132,300$|^in line with/);
        }
        expect(hasBlsStateMedian('Guam')).toBe(false);
    });
});

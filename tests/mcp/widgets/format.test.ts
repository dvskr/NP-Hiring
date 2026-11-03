import { describe, expect, it } from 'vitest';
import {
    appliedStatusLine,
    applicationsCount,
    counterLabel,
    employerLine,
    experienceLabel,
    jobsCount,
    payLabel,
    postedLabel,
    postedValue,
    summaryChipLabel,
    withdrawWarning,
} from '@/lib/mcp/widgets/src/copy';
import {
    daysAgo,
    formatCount,
    formatFullDate,
    formatMonthDay,
    initials,
    safeTimeZone,
    toParagraphs,
} from '@/lib/mcp/widgets/src/format';

const CHICAGO = 'America/Chicago';
// 3 pm in Chicago (CDT, UTC-5) on Wednesday 2026-10-28.
const NOW = new Date('2026-10-28T20:00:00Z');

describe('formatCount', () => {
    it('groups thousands and clamps bad input to whole, non-negative numbers', () => {
        expect(formatCount(1234)).toBe('1,234');
        expect(formatCount(0)).toBe('0');
        expect(formatCount(-3)).toBe('0');
        expect(formatCount(7.9)).toBe('7');
        expect(formatCount(Number.NaN)).toBe('0');
    });
});

describe('daysAgo', () => {
    it('counts calendar days in the viewer time zone, not 24 hour blocks', () => {
        // 10 pm Chicago the day before: yesterday, although only 17 hours ago.
        expect(daysAgo('2026-10-28T03:00:00Z', NOW, CHICAGO)).toBe(1);
        // 6 am UTC on the 28th is 1 am on the 28th in Chicago: today.
        expect(daysAgo('2026-10-28T06:00:00Z', NOW, CHICAGO)).toBe(0);
    });

    it('treats a future date as today and an unparseable one as unknown', () => {
        expect(daysAgo('2026-10-30T12:00:00Z', NOW, CHICAGO)).toBe(0);
        expect(daysAgo('not a date', NOW, CHICAGO)).toBeNull();
    });
});

describe('postedLabel and postedValue', () => {
    it.each([
        ['2026-10-28T15:00:00Z', 'Posted today', 'Today'],
        ['2026-10-27T15:00:00Z', 'Posted yesterday', 'Yesterday'],
        ['2026-10-25T15:00:00Z', 'Posted 3 days ago', '3 days ago'],
        ['2026-09-28T15:00:00Z', 'Posted 30 days ago', '30 days ago'],
        ['2026-09-12T15:00:00Z', 'Posted Sep 12', 'Sep 12'],
    ])('%s reads "%s"', (iso, label, value) => {
        expect(postedLabel(iso, NOW, CHICAGO)).toBe(label);
        expect(postedValue(iso, NOW, CHICAGO)).toBe(value);
    });

    it('is omitted when the date cannot be read', () => {
        expect(postedLabel('', NOW, CHICAGO)).toBeNull();
        expect(postedValue('garbage', NOW, CHICAGO)).toBeNull();
    });
});

describe('dates', () => {
    it('formats month and day, and the full date, in the viewer time zone', () => {
        expect(formatMonthDay('2026-10-05T12:00:00Z', CHICAGO)).toBe('Oct 5');
        expect(formatFullDate('2026-10-05T12:00:00Z', CHICAGO)).toBe('Oct 5, 2026');
        // Just after midnight UTC on Oct 6 is still Oct 5 in Chicago.
        expect(formatFullDate('2026-10-06T02:00:00Z', CHICAGO)).toBe('Oct 5, 2026');
        expect(formatMonthDay('nope', CHICAGO)).toBeNull();
    });

    it('accepts only time zones the runtime knows', () => {
        expect(safeTimeZone(CHICAGO)).toBe(CHICAGO);
        expect(safeTimeZone('Mars/Olympus_Mons')).toBeUndefined();
        expect(safeTimeZone(undefined)).toBeUndefined();
    });
});

describe('initials', () => {
    it.each([
        ['Acme Behavioral Health', 'AB'],
        ['Talkiatry', 'TA'],
        ['The University of Texas Medical Branch', 'UT'],
        ['Baylor Scott & White Health', 'BS'],
        ['LifeStance Health, Inc.', 'LH'],
        ['  ', ''],
    ])('%s gives "%s"', (name, expected) => {
        expect(initials(name)).toBe(expected);
    });
});

describe('toParagraphs', () => {
    it('makes one paragraph per non-empty line and normalises line endings', () => {
        expect(toParagraphs('First line.\r\n\r\n  Second line.  \nThird\r')).toEqual(['First line.', 'Second line.', 'Third']);
        expect(toParagraphs('   \n\n')).toEqual([]);
    });
});

describe('copy helpers', () => {
    it('counts jobs and applications in words', () => {
        expect(jobsCount(1)).toBe('1 job');
        expect(jobsCount(0)).toBe('0 jobs');
        expect(jobsCount(1280)).toBe('1,280 jobs');
        expect(applicationsCount(1)).toBe('1 application');
        expect(applicationsCount(12)).toBe('12 applications');
    });

    it('marks estimated pay with a tilde and picks the experience chip', () => {
        expect(payLabel('$140k to $160k/yr', true)).toBe('~$140k to $160k/yr');
        expect(payLabel('$95/hr', false)).toBe('$95/hr');
        expect(payLabel(null, true)).toBeNull();
        expect(experienceLabel(true, '3+ years')).toBe('New grad welcome');
        expect(experienceLabel(false, '3+ years')).toBe('3+ years');
        expect(experienceLabel(false, null)).toBeNull();
    });

    it('builds the apply and applications sentences', () => {
        expect(employerLine('Talkiatry', 'Remote (Texas)')).toBe('Talkiatry · Remote (Texas)');
        expect(employerLine('Talkiatry', '')).toBe('Talkiatry');
        expect(appliedStatusLine('Oct 18, 2026', 'Screening')).toBe('You applied on Oct 18, 2026. Status: Screening.');
        expect(counterLabel(1234, 5000)).toBe('1,234 of 5,000');
        expect(summaryChipLabel('Not Selected', 3)).toBe('Not Selected 3');
        expect(withdrawWarning('PMHNP, Outpatient')).toContain('your application for PMHNP, Outpatient, marked Withdrawn');
    });
});

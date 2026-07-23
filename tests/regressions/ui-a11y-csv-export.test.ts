/**
 * Regression guard for B63 — applicants CSV export must survive embedded
 * quotes (RFC 4180) and must not be exploitable via spreadsheet formula
 * injection.
 *
 * The old export wrapped cells as `"${value}"` with no escaping: a candidate
 * named `Bob "The" Builder` corrupted every following column, and a cover
 * letter starting with `=HYPERLINK(...)` executed as a formula when the
 * employer opened the export in Excel/Sheets.
 *
 * Behavioral tests import the real csvCell helper; a static pin keeps
 * handleExportCsv actually using it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { csvCell } from '@/components/employer/ApplicantsTab';

describe('B63 — csvCell RFC 4180 escaping', () => {
    it('doubles embedded quotes so cells cannot break the row', () => {
        expect(csvCell('Bob "The" Builder')).toBe('"Bob ""The"" Builder"');
    });

    it('wraps commas and newlines safely inside a quoted cell', () => {
        expect(csvCell('Smith, Jane')).toBe('"Smith, Jane"');
        expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
    });

    it('leaves ordinary values readable', () => {
        expect(csvCell('Jane Smith')).toBe('"Jane Smith"');
        expect(csvCell('')).toBe('""');
    });
});

describe('B63 — csvCell formula-injection guard', () => {
    it.each([
        ['=HYPERLINK("http://evil.test","click")', '"\'=HYPERLINK(""http://evil.test"",""click"")"'],
        ['+1234567', '"\'+1234567"'],
        ['-2+3+cmd', '"\'-2+3+cmd"'],
        ['@SUM(A1:A9)', '"\'@SUM(A1:A9)"'],
    ])('prefixes %s with a quote so spreadsheets treat it as text', (input, expected) => {
        expect(csvCell(input)).toBe(expected);
    });

    it('guards tab and carriage-return openers too', () => {
        expect(csvCell('\t=1+1')).toBe('"\'\t=1+1"');
        expect(csvCell('\r=1+1')).toBe('"\'\r=1+1"');
    });

    it('does not mangle values merely containing (not starting with) formula chars', () => {
        expect(csvCell('R2-D2 unit')).toBe('"R2-D2 unit"');
        expect(csvCell('jane@example.com note')).toBe('"jane@example.com note"');
    });
});

describe('B63 — handleExportCsv uses the safe encoder', () => {
    const src = fs.readFileSync(
        path.join(process.cwd(), 'components/employer/ApplicantsTab.tsx'),
        'utf8',
    );

    it('encodes every header and cell through csvCell', () => {
        expect(src).toContain("headers.map(csvCell).join(',')");
        expect(src).toMatch(/headers\.map\(h => csvCell\(/);
        // The unescaped template-wrap pattern must not come back.
        expect(src).not.toMatch(/`"\$\{\(r as Record<string, string>\)\[h\]/);
    });
});

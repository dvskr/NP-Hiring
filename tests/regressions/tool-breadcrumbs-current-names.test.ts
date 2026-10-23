/**
 * Register 2.25: three tool breadcrumbs kept the tool names the content
 * release (2026-10-13) retired, under the new page titles: "Specialty
 * Finder" under the specialty quiz, "Private Practice Revenue" under the
 * private practice income calculator, and "Cost Per Hire" under the cost to
 * hire calculator. Each last crumb now names the tool the way its title does.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TOOLS = [
    { file: 'app/tools/specialty-finder/page.tsx', crumb: 'Specialty Quiz', retired: 'Specialty Finder', title: /Specialty Is Right for Me\? \$\{QUIZ_QUESTION_COUNT\}-Question Quiz/ },
    { file: 'app/tools/private-practice-revenue-calculator/page.tsx', crumb: 'Private Practice Income', retired: 'Private Practice Revenue', title: /Private Practice Income Calculator/ },
    { file: 'app/tools/cost-per-hire-calculator/page.tsx', crumb: 'Cost to Hire', retired: 'Cost Per Hire', title: /Cost to Hire a \$\{brand\.niche\.long\} Calculator/ },
];

describe('tool breadcrumbs name the tool as its title does', () => {
    it.each(TOOLS)('$file', ({ file, crumb, retired, title }) => {
        const src = read(file);
        expect(src).toMatch(title);
        expect(src).toContain(`{ label: '${crumb}' }`);
        expect(src).not.toContain(`'${retired}'`);
    });
});

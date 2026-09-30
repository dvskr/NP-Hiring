/**
 * The apply command a dry run suggests (scripts/indexing-fixes/lib/runtime.ts).
 * It used to drop every filter, so copying it after a dry run narrowed with
 * --employer="Sol Mental Health" would have written to every matching row in
 * the PRODUCTION database instead of the reviewed subset.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyCommand, parseCli, printFooter, printRow, RUN_ORDER, runOrderNote } from '../../scripts/indexing-fixes/lib/runtime';
import type { JobRow } from '../../scripts/indexing-fixes/lib/planners';

const SCRIPT = 'scripts/indexing-fixes/correct-location-and-pay.ts';
const PREFIX = 'node_modules/.bin/ts-node --transpile-only -r tsconfig-paths/register --project scripts/tsconfig.json';

describe('applyCommand', () => {
    it('keeps --employer, --ids, --only and --limit, and adds --apply once', () => {
        const argv = ['--employer=Sol Mental Health', '--ids=a1,b2', '--only=location,pay', '--limit=5'];
        expect(applyCommand(SCRIPT, argv)).toBe(
            `${PREFIX} ${SCRIPT} --employer="Sol Mental Health" --ids=a1,b2 --only=location,pay --limit=5 --apply`,
        );
    });

    it('keeps flags without a value and never repeats --apply', () => {
        expect(applyCommand(SCRIPT, ['--fetch-workday', '--apply'])).toBe(`${PREFIX} ${SCRIPT} --fetch-workday --apply`);
    });

    it('is the bare script plus --apply when the dry run had no filters', () => {
        expect(applyCommand(SCRIPT, [])).toBe(`${PREFIX} ${SCRIPT} --apply`);
    });

    it('quotes a value a shell would expand with POSIX single quotes', () => {
        expect(applyCommand(SCRIPT, ['--employer=Acme $HOME "Health"'])).toBe(
            `${PREFIX} ${SCRIPT} --employer='Acme $HOME "Health"' --apply`,
        );
    });

    it('round-trips through a shell and parseCli to the same filters', () => {
        const argv = ['--employer=Sol Mental Health', '--ids=a1,b2', '--only=location', '--limit=5'];
        const words = shellSplit(applyCommand(SCRIPT, argv));
        const scriptArgs = words.slice(words.indexOf(SCRIPT) + 1);
        expect(scriptArgs).toEqual([...argv, '--apply']);
        expect(parseCli(scriptArgs)).toMatchObject({
            apply: true,
            employer: 'Sol Mental Health',
            ids: ['a1', 'b2'],
            only: ['location'],
            limit: 5,
        });
    });
});

/** Split a command line into words the way a POSIX shell does for plain quoting. */
function shellSplit(command: string): string[] {
    const words: string[] = [];
    let current = '';
    let started = false;
    let quote: string | null = null;
    for (const ch of command) {
        if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            started = true;
        } else if (/\s/.test(ch)) {
            if (started) words.push(current);
            current = '';
            started = false;
        } else {
            current += ch;
            started = true;
        }
    }
    if (started) words.push(current);
    return words;
}

describe('printFooter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prints the filtered apply command after a filtered dry run', () => {
        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.join(' '));
        });
        const argv = ['--employer=Sol Mental Health', '--limit=3'];
        printFooter(parseCli(argv), 3, SCRIPT, argv);
        expect(lines.join('\n')).toContain(`${SCRIPT} --employer="Sol Mental Health" --limit=3 --apply`);
    });

    it('prints no apply command after an apply run', () => {
        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.join(' '));
        });
        printFooter(parseCli(['--apply']), 2, SCRIPT, ['--apply']);
        expect(lines.join('\n')).toContain('Applied 2 change(s).');
        expect(lines.join('\n')).not.toContain('--apply');
    });
});

describe('printRow', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const row = {
        id: 'job-1',
        slug: 'nurse-practitioner-job-1',
        title: 'Nurse Practitioner',
        employer: 'Example Health',
        location: 'Toronto, ON',
        isPublished: true,
    } as JobRow;

    it('prints every column the write sets, the timestamps included', () => {
        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.join(' '));
        });
        printRow(row, 'UNPUBLISH', { isPublished: { from: true, to: false } }, ['evidence location'], {
            unpublishedAt: 'now',
            contentChangedAt: null,
        });
        const out = lines.join('\n');
        expect(out).toContain('isPublished: true -> false');
        expect(out).toContain('unpublishedAt: set to the time of --apply');
        expect(out).toContain('contentChangedAt: set to null');
    });

    it('prints no timestamp line when the write sets none', () => {
        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.join(' '));
        });
        printRow(row, 'HOLD', { isPublished: { from: true, to: false } });
        expect(lines.join('\n')).not.toContain('set to');
    });
});

describe('the run order of the job-row fixes', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fills and corrects locations before duplicates are collapsed, and re-tags last', () => {
        const step = (name: string) => RUN_ORDER.indexOf(`scripts/indexing-fixes/${name}.ts`);
        expect(step('unpublish-misrepresented-jobs')).toBe(0);
        expect(step('backfill-job-locations')).toBeLessThan(step('collapse-duplicate-jobs'));
        expect(step('correct-location-and-pay')).toBeLessThan(step('collapse-duplicate-jobs'));
        expect(step('retag-category-tags')).toBe(RUN_ORDER.length - 1);
    });

    it('every script in the order exists and its header names its step', () => {
        RUN_ORDER.forEach((script, i) => {
            const source = fs.readFileSync(path.join(process.cwd(), script), 'utf8');
            expect(source).toContain(`RUN ORDER: step ${i + 1} of ${RUN_ORDER.length} of the job-row fixes`);
        });
    });

    it('a dry run names the next step; a script outside the order names none', () => {
        expect(runOrderNote('scripts/indexing-fixes/backfill-job-locations.ts'))
            .toBe('Run order: step 4 of 8; next: scripts/indexing-fixes/correct-location-and-pay.ts.');
        expect(runOrderNote('scripts/indexing-fixes/retag-category-tags.ts')).toBe('Run order: step 8 of 8; this is the last step.');
        expect(runOrderNote('scripts/indexing-fixes/populate-company-website-logo.ts')).toBeNull();

        const lines: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.join(' '));
        });
        printFooter(parseCli([]), 1, 'scripts/indexing-fixes/unpublish-non-us-jobs.ts', []);
        expect(lines.join('\n')).toContain('next: scripts/indexing-fixes/hold-stub-description-jobs.ts');
    });
});

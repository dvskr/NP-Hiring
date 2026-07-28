/**
 * Regression guards for B7 remainders the initial rebrand pass missed:
 * donor-niche content that survived inside the extension after the
 * domain/manifest/UI-string rebrand (see extension-rebrand.test.ts).
 *
 * 1. Fallback message / cover-letter copy described every applicant as a
 *    "Psychiatric-Mental Health Nurse Practitioner (PMHNP)" — donor-role
 *    copy injected into real job applications on behalf of general NP
 *    users. The string was inlined identically at three call sites:
 *    matcher.ts message + cover_letter mappers and the SmartRecruiters
 *    handler's message fixup. Now single-sourced in shared/constants.ts.
 *
 * 2. The popup header rendered public/logo.png — the donor board's
 *    psych-brand artwork (head-with-brain motif). The popup now uses the
 *    brand-neutral icon set the manifest already ships.
 *
 * Internal identifiers (`pmhnp_*` storage keys, `[PMHNP]` log prefixes,
 * alarm names) remain deliberately allowed — same policy as
 * extension-rebrand.test.ts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const EXT_SRC = path.join(ROOT, 'pmhnp-autofill-extension', 'src');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir: string, exts: string[]): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full, exts));
        } else if (exts.some((ext) => entry.name.endsWith(ext))) {
            out.push(full);
        }
    }
    return out;
}

describe('B7 remainder — donor-niche fallback cover letter rebranded', () => {
    it('no extension source file carries donor-role copy ("Psychiatric")', () => {
        const files = walk(EXT_SRC, ['.ts', '.tsx', '.html', '.css', '.json']);
        expect(files.length).toBeGreaterThan(20);
        const offenders = files.filter((f) =>
            /Psychiatric/i.test(fs.readFileSync(f, 'utf8'))
        );
        expect(offenders, 'donor psych role copy still present').toEqual([]);
    });

    it('fallback letter has a single source whose role mirrors config/brand.ts', () => {
        const constants = read('pmhnp-autofill-extension/src/shared/constants.ts');
        expect(constants).toContain('export function buildFallbackCoverLetter');

        const roleMatch = constants.match(/BOARD_ROLE_NAME = '([^']+)'/);
        expect(roleMatch, 'constants.ts must export BOARD_ROLE_NAME').not.toBeNull();

        const brand = read('config/brand.ts');
        const longMatch = brand.match(/long: '([^']+)'/);
        expect(longMatch).not.toBeNull();
        // e.g. 'Nurse Practitioner (NP)' must start with brand.niche.long.
        expect(roleMatch![1].startsWith(longMatch![1])).toBe(true);
    });

    it('all fill sites consume the shared builder — no inlined letter copies', () => {
        const matcher = read('pmhnp-autofill-extension/src/content/matcher.ts');
        const matcherUses = matcher.match(/buildFallbackCoverLetter\(/g) ?? [];
        expect(matcherUses.length, 'message + cover_letter mappers').toBeGreaterThanOrEqual(2);

        const smartrecruiters = read('pmhnp-autofill-extension/src/content/ats/smartrecruiters.ts');
        expect(smartrecruiters).toContain('buildFallbackCoverLetter(');

        // The letter body must exist exactly once, inside the builder.
        const files = walk(EXT_SRC, ['.ts', '.tsx']);
        const carriers = files.filter((f) =>
            fs.readFileSync(f, 'utf8').includes('I am writing to express my strong interest')
        );
        expect(
            carriers.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
        ).toEqual(['pmhnp-autofill-extension/src/shared/constants.ts']);
    });
});

describe('B7 remainder — donor logo artwork retired from the popup', () => {
    it('popup header renders the neutral icon set, not the donor /logo.png', () => {
        const app = read('pmhnp-autofill-extension/src/popup/App.tsx');
        expect(app).toContain('/icons/icon-128.png');
        expect(app).not.toContain('/logo.png');
    });

    it('no other extension source references the donor logo asset', () => {
        const files = walk(EXT_SRC, ['.ts', '.tsx', '.html', '.css', '.json']);
        const offenders = files.filter((f) =>
            fs.readFileSync(f, 'utf8').includes('logo.png')
        );
        expect(offenders.map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))).toEqual([]);
    });
});

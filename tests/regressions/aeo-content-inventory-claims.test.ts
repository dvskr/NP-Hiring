/**
 * Regression guards — citation-trust sweep B5 + B10 (aeo-content).
 *
 * B5: the job-detail "Career Pulse" card hardcoded a day-one inventory
 * count ('335+ openings on this board') that silently drifted from real
 * inventory — the DB held 900+ jobs within days of the snapshot. The
 * repo's own RULE (config/niche/copy.ts) is: NO hardcoded inventory
 * counts in evergreen surfaces; evergreen claims only, live counters
 * (lib/site-stats.ts) for numbers. The pebble now makes an evergreen
 * cadence claim, and this drift test blocks re-introducing a hardcoded
 * count anywhere in source. The launch-anchored figures in
 * public/llms.txt / llms-full.txt are exempt — they are explicitly
 * dated "at launch (July 2026)", so they cannot silently go stale.
 *
 * B10: the unmounted donor marketing sections (WhyUs, Comparison,
 * Testimonial) that carried the same stale count plus unverified
 * competitor claims were deleted along with their data packs in
 * config/niche/stats.ts. This pins their absence.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { CAREER_PULSE_STATS } from '@/config/niche/stats';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Recursively collect .ts/.tsx files under a repo-relative directory. */
function collectSourceFiles(relDir: string): string[] {
    const abs = path.join(ROOT, relDir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(relDir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.next') continue;
            out.push(...collectSourceFiles(rel));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
            out.push(rel);
        }
    }
    return out;
}

describe('B5 — no hardcoded inventory counts in evergreen source', () => {
    it("the day-one '335+' count appears nowhere in app/, components/, lib/, or config/ source", () => {
        // config/niche/copy.ts documents the historical incident in a
        // comment (it IS the rule that bans these counts) — exempt.
        const exempt = new Set([path.join('config', 'niche', 'copy.ts')]);
        const offenders: string[] = [];
        for (const dir of ['app', 'components', 'lib', 'config']) {
            for (const file of collectSourceFiles(dir)) {
                if (exempt.has(file)) continue;
                if (read(file).includes('335+')) offenders.push(file);
            }
        }
        expect(offenders, `hardcoded '335+' inventory claim found in: ${offenders.join(', ')}`).toEqual([]);
    });

    it('no career-pulse pebble pairs a numeric count with an inventory label', () => {
        for (const s of CAREER_PULSE_STATS) {
            const claimsInventory = /opening|listing|job(s)? on/i.test(s.label);
            const hasNumericValue = /\d/.test(s.value);
            expect(
                claimsInventory && hasNumericValue,
                `career-pulse pebble re-hardcodes an inventory count: ${JSON.stringify(s)}`
            ).toBe(false);
        }
    });
});

describe('B10 — unmounted donor marketing sections stay deleted', () => {
    it.each([
        'components/WhyUs.tsx',
        'components/Comparison.tsx',
        'components/Testimonial.tsx',
    ])('%s does not exist', (rel) => {
        expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
    });

    it('nothing imports the deleted components', () => {
        const importPattern = /components\/(WhyUs|Comparison|Testimonial)['"]/;
        const offenders: string[] = [];
        for (const dir of ['app', 'components', 'lib']) {
            for (const file of collectSourceFiles(dir)) {
                if (importPattern.test(read(file))) offenders.push(file);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('config/niche/stats.ts no longer exports the deleted data packs', () => {
        const src = read('config/niche/stats.ts');
        expect(src).not.toContain('WHY_US_FEATURES');
        expect(src).not.toContain('COMPARISON_PLATFORMS');
        expect(src).not.toContain('COMPARISON_FEATURE_LABELS');
        expect(src).not.toMatch(/export const TESTIMONIALS/);
    });
});

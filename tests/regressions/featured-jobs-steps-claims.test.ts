/**
 * The "how it works" steps on the home page and /for-job-seekers
 * (components/FeaturedJobs.tsx, STEPS) promised what the board does not do:
 * semantic AI search (the ai.search.semantic flag is off by default), a
 * digest "matched to your experience level, location, and pay", and "No
 * recruiters, no portals" while recruiter postings are ingested and most
 * listings apply on the employer's own site. Found by the job seeker
 * comparison audit (register D25). The steps now say what the board does.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/FeaturedJobs.tsx'), 'utf8');
const steps = src.slice(src.indexOf('const STEPS'), src.indexOf('];', src.indexOf('const STEPS')));

describe('FeaturedJobs steps say what the board does', () => {
    it('make none of the removed promises', () => {
        for (const claim of [/semantic/i, /\bAI\b/, /matched to your/i, /no recruiters/i, /no portals/i, /one-click/i]) {
            expect(steps, String(claim)).not.toMatch(claim);
        }
    });

    it('describe alerts, Easy Apply where offered, and the employer site', () => {
        expect(steps).toContain('Search and Set Alerts');
        expect(steps).toMatch(/daily or weekly/);
        expect(steps).toMatch(/Easy Apply where the employer offers it/);
        expect(steps).toMatch(/employer's own application/);
    });

    it('follow the house rules: no dashes, no ampersand titles', () => {
        expect(steps).not.toMatch(/[–—]/);
        expect(steps).not.toMatch(/ - /);
        expect(steps).not.toMatch(/title: '[^']*&/);
    });
});

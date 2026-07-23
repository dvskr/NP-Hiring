/**
 * Regression pin for the B6 niche-copy rewrite of the indexed pSEO
 * template/config files (2026-07 all-NP editorial pass).
 *
 * After the rewrite, the only reference-niche occurrences (PMHNP /
 * psychiatric / mental health — see TEMPLATE_REFERENCE_NICHE_TERMS in
 * tests/regressions/brand-leak-scan.ts) left in these files are the
 * INTENTIONAL psychiatric-mental-health specialty entries — psych is one
 * of the board's 42 categories, so its own config (slug / label /
 * fullLabel / heroSubtitle / keywords) legitimately names the specialty.
 *
 * This pin is independent of niche-copy-debt-baseline.json: even if that
 * baseline is regenerated from a dirtier tree, these ceilings still stop
 * psych-specific editorial copy from creeping back into the category ×
 * city / state / landing templates that ship on indexed pSEO pages.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { scanNicheCopyDebt } from './brand-leak-scan';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Per-file occurrence ceilings = the intentional psych-specialty mentions
 * remaining after the 2026-07 rewrite. Lower is always fine; raising a
 * ceiling requires deriving the new copy from brand.niche tokens
 * (config/brand.ts) or an intentional psych-specialty mention.
 */
const PSEO_TEMPLATE_CEILINGS: Record<string, number> = {
    // psychiatric-mental-health entries in NP_CATEGORY_CONFIGS.
    'lib/pseo/category-city-template.tsx': 11,
    // psychiatric-mental-health entries in NP_SPECIALTY_STATE_CONFIGS.
    'lib/pseo/setting-state-config.ts': 11,
    // psych specialty card in NEW_CATEGORY_COPY + donor-history QUERY NOTE.
    'lib/pseo/category-landing-template.tsx': 7,
};

describe('niche-copy: indexed pSEO templates stay NP-generic', () => {
    it('psych-specific copy does not creep back into the pSEO template configs', () => {
        const counts = scanNicheCopyDebt({ root: ROOT });

        const regressions: string[] = [];
        for (const [file, ceiling] of Object.entries(PSEO_TEMPLATE_CEILINGS)) {
            const current = counts[file] ?? 0;
            if (current > ceiling) {
                regressions.push(`${file} (${current} > ceiling ${ceiling})`);
            }
        }

        expect(
            regressions,
            'Reference-niche copy grew in indexed pSEO template files — derive niche identity ' +
            'from the brand.niche tokens in config/brand.ts instead of hardcoding ' +
            `PMHNP/psychiatric/mental-health copy:\n  ${regressions.join('\n  ')}`,
        ).toEqual([]);
    });
});

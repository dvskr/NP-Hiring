/**
 * Regression pin for the B6 niche-copy verification of the pSEO SUPPORT
 * files (2026-07 backlog pass) — the tagger, taxonomy, asset-registry,
 * edge-segment, and FAQ-data files that feed the indexed category × city /
 * state pSEO pages.
 *
 * Complements tests/regressions/niche-copy-pseo-templates.test.ts (which
 * pins the three template/config files). After the all-NP editorial
 * rewrite, every reference-niche occurrence (PMHNP / psychiatric / mental
 * health — see TEMPLATE_REFERENCE_NICHE_TERMS in
 * tests/regressions/brand-leak-scan.ts) left in these files is either:
 *
 *   - an INTENTIONAL psychiatric-mental-health specialty mention — psych
 *     is one of the board's 42 categories, so its slug, nav card, and
 *     tagger keyword rules legitimately name the specialty; or
 *   - a dated migration note documenting the donor→NP taxonomy change.
 *
 * This pin is independent of niche-copy-debt-baseline.json: even if that
 * baseline is regenerated from a dirtier tree, these ceilings still stop
 * psych-specific editorial copy from creeping back into the pSEO data
 * layer that ships on indexed pages.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { scanNicheCopyDebt } from './brand-leak-scan';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Per-file occurrence ceilings = the intentional psych-specialty mentions
 * (plus migration-note comments) remaining after the 2026-07 pass. Lower
 * is always fine; raising a ceiling requires deriving the new copy from
 * brand.niche tokens (config/brand.ts) or an intentional psych-specialty
 * mention.
 */
const PSEO_SUPPORT_FILE_CEILINGS: Record<string, number> = {
    // psychiatric-mental-health keyword/exclusion rules in CATEGORY_RULES —
    // the tagger needs psych terms to route psych jobs to the psych category.
    'lib/pseo/category-tagger.ts': 16,
    // psych category nav card (href/label/sub) + donor-migration note.
    'lib/pseo/category-asset-registry.ts': 4,
    // psychiatric-mental-health slug in the category slug lists.
    'lib/pseo/taxonomy-registry.ts': 3,
    // psychiatric-mental-health slug in the edge segment allowlist.
    'lib/pseo/jobs-segments-edge.ts': 1,
    // dated NP-taxonomy-migration note about removed PMHNP-only FAQ entries.
    'lib/pseo/category-faq-data.ts': 1,
};

describe('niche-copy: pSEO support files stay NP-generic', () => {
    it('psych-specific copy does not creep back into the pSEO data layer', () => {
        const counts = scanNicheCopyDebt({ root: ROOT });

        const regressions: string[] = [];
        for (const [file, ceiling] of Object.entries(PSEO_SUPPORT_FILE_CEILINGS)) {
            const current = counts[file] ?? 0;
            if (current > ceiling) {
                regressions.push(`${file} (${current} > ceiling ${ceiling})`);
            }
        }

        expect(
            regressions,
            'Reference-niche copy grew in pSEO support files — derive niche identity ' +
            'from the brand.niche tokens in config/brand.ts instead of hardcoding ' +
            `PMHNP/psychiatric/mental-health copy:\n  ${regressions.join('\n  ')}`,
        ).toEqual([]);
    });
});

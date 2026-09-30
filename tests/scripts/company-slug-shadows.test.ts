/**
 * Shadow checks behind scripts/indexing-fixes/report-company-slug-changes.ts
 * (indexing audit L-01). A shadow is a row whose old profile slug is a live
 * company's new display-name slug. The dormant kind made the middleware
 * answer 410 on a live profile's canonical URL, so the report lists them.
 */
import { describe, it, expect } from 'vitest';
import {
    findDormantShadows,
    findLiveShadows,
    shadowLookupKeys,
    type LiveSlugCompany,
} from '../../scripts/indexing-fixes/lib/company-slug-shadows';

const DAVITA: LiveSlugCompany = { name: 'DaVita', normalizedName: 'da-vita', activeJobs: 12 };
const ONE_MEDICAL: LiveSlugCompany = { name: 'One Medical', normalizedName: 'one', activeJobs: 62 };
const MEDELITE: LiveSlugCompany = { name: 'MedElite', normalizedName: 'med elite', activeJobs: 7 };

describe('shadowLookupKeys: the only normalizedName values that can shadow a live slug', () => {
    it('lists each display-name slug in kebab and space form, sorted and unique', () => {
        expect(shadowLookupKeys([DAVITA, ONE_MEDICAL, MEDELITE])).toEqual([
            'davita',
            'medelite',
            'one medical',
            'one-medical',
        ]);
    });

    it('reads nothing when nothing is live', () => {
        expect(shadowLookupKeys([])).toEqual([]);
    });
});

describe('findDormantShadows: rows with no live jobs that hold a live profile URL', () => {
    it('finds the CamelCase variant whose dedup key is the live display slug', () => {
        const variant = { name: 'Davita', normalizedName: 'davita' };
        expect(findDormantShadows([DAVITA], [variant])).toEqual([
            { company: DAVITA, other: variant, slug: 'davita' },
        ]);
    });

    it('finds space-form rows too, and every row that maps to the same slug', () => {
        const spaceForm = { name: 'One  Medical', normalizedName: 'one medical' };
        const kebabForm = { name: 'One-Medical', normalizedName: 'one-medical' };
        const shadows = findDormantShadows([ONE_MEDICAL], [spaceForm, kebabForm]);
        expect(shadows.map((shadow) => shadow.other)).toEqual([spaceForm, kebabForm]);
        expect(new Set(shadows.map((shadow) => shadow.slug))).toEqual(new Set(['one-medical']));
    });

    it('ignores rows whose old slug is not a live display slug', () => {
        const unrelated = { name: 'Da Vita Dental', normalizedName: 'da vita dental' };
        const oldDaVitaKey = { name: 'Da Vita', normalizedName: 'da vita' };
        expect(findDormantShadows([DAVITA], [unrelated, oldDaVitaKey])).toEqual([]);
    });

    it('never reports a live row against itself or another live row', () => {
        const selfSlug: LiveSlugCompany = { name: 'Ochsner', normalizedName: 'ochsner', activeJobs: 3 };
        expect(findDormantShadows([selfSlug, DAVITA], [selfSlug, DAVITA])).toEqual([]);
    });
});

describe('findLiveShadows: a live company whose new slug was another live company\'s old slug', () => {
    it('pairs the new owner with the previous one', () => {
        const oldOwner: LiveSlugCompany = { name: 'Next', normalizedName: 'one-medical', activeJobs: 2 };
        expect(findLiveShadows([ONE_MEDICAL, oldOwner])).toEqual([
            { company: ONE_MEDICAL, other: oldOwner, slug: 'one-medical' },
        ]);
    });

    it('does not count a company whose slug did not change', () => {
        const unchanged: LiveSlugCompany = { name: 'Ochsner', normalizedName: 'ochsner', activeJobs: 3 };
        expect(findLiveShadows([unchanged, DAVITA, MEDELITE])).toEqual([]);
    });
});

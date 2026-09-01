/**
 * Regression guards — P1 #5 (FAQ coverage), #6 template half (CategoryHero
 * via the asset-registry contract), #16 hub side (DB-gated state mesh), and
 * #17 (/jobs hub editorial + citable FAQ). Category-editorial package,
 * 2026-07-29.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    getCategoryFaqs,
    isCategoryFaqSlug,
    CATEGORY_LABELS,
    type CategorySlug,
} from '@/lib/pseo/category-faq-data';
import { STAT_SOURCES } from '@/lib/stats-sources';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** A count that cannot collide with any cited figure in the copy. */
const SENTINEL_TOTAL = 4321;

/** Landing slugs that gained FAQ builders in this pass. */
const NEW_LANDING_FAQ_KEYS: CategorySlug[] = [
    'urgent-care', 'home-health', 'neonatal', 'oncology', 'cardiology',
    'primary-care', 'hospitalist', 'dermatology', 'orthopedic',
    'clinical-nurse-specialist',
    // P1 #15 specialty verticals sharing the same landing template.
    'aesthetics', 'pain-management', 'palliative-hospice',
];

function joinedAnswers(category: CategorySlug): string {
    return getCategoryFaqs({ category, totalJobs: SENTINEL_TOTAL })
        .map((f) => `${f.question}\n${f.answer}`)
        .join('\n');
}

describe('P1 #5 — FAQ builders for the landing slugs', () => {
    it.each(NEW_LANDING_FAQ_KEYS)('%s returns 4-6 populated Q&As', (key) => {
        const faqs = getCategoryFaqs({ category: key, totalJobs: SENTINEL_TOTAL });
        expect(faqs.length).toBeGreaterThanOrEqual(4);
        expect(faqs.length).toBeLessThanOrEqual(6);
        for (const faq of faqs) {
            expect(faq.question.trim().length).toBeGreaterThan(10);
            expect(faq.answer.trim().length).toBeGreaterThan(40);
        }
    });

    it.each(NEW_LANDING_FAQ_KEYS)('%s interpolates the live job count', (key) => {
        expect(joinedAnswers(key)).toContain(String(SENTINEL_TOTAL));
    });

    it('every landing slug except the psych specialty resolves FAQ data', () => {
        const uncovered = [
            'acute-care', 'adult-gerontology', 'anesthesia', 'cardiology',
            'clinical-nurse-specialist', 'dermatology', 'emergency',
            'family-practice', 'home-health', 'hospitalist', 'midwifery',
            'neonatal', 'oncology', 'orthopedic', 'pediatric', 'primary-care',
            'urgent-care', 'women-health',
        ].filter((slug) => !isCategoryFaqSlug(slug)
            || getCategoryFaqs({ category: slug as CategorySlug, totalJobs: SENTINEL_TOTAL }).length === 0);
        expect(uncovered).toEqual([]);
        // Documented gap: the psych specialty slug stays unmapped until the
        // niche-copy ceiling for category-faq-data.ts is raised.
        expect(isCategoryFaqSlug('psychiatric-mental-health')).toBe(false);
    });

    it('labels exist for every new key', () => {
        for (const key of NEW_LANDING_FAQ_KEYS) {
            expect(CATEGORY_LABELS[key], key).toBeTruthy();
        }
    });

    describe('certification bodies are correct in the new builders', () => {
        it('neonatal cites NCC (NNP-BC)', () => {
            const text = joinedAnswers('neonatal');
            expect(text).toContain('National Certification Corporation');
            expect(text).toContain('NNP-BC');
        });

        it('oncology cites ONCC for the optional AOCNP credential', () => {
            const text = joinedAnswers('oncology');
            expect(text).toContain('AOCNP');
            expect(text).toContain('Oncology Nursing Certification Corporation');
        });

        it('dermatology cites the Dermatology Nursing Certification Board (DCNP)', () => {
            const text = joinedAnswers('dermatology');
            expect(text).toContain('DCNP');
            expect(text).toContain('Dermatology Nursing Certification Board');
        });

        it('orthopedic cites ONCB (ONP-C)', () => {
            const text = joinedAnswers('orthopedic');
            expect(text).toContain('ONP-C');
            expect(text).toContain('Orthopaedic Nurses Certification Board');
        });

        it('hospitalist prefers the ANCC/AACN acute-care credentials', () => {
            const text = joinedAnswers('hospitalist');
            expect(text).toContain('AGACNP-BC');
            expect(text).toContain('AACN');
        });

        it('primary-care names all three primary care tracks and certifiers', () => {
            const text = joinedAnswers('primary-care');
            expect(text).toContain('AANP');
            expect(text).toContain('ANCC');
            expect(text).toContain('PNCB');
        });

        it('the P1 #15 verticals cite the right bodies and defer licensure specifics', () => {
            expect(joinedAnswers('aesthetics')).toContain('Plastic Surgical Nursing Certification Board');
            expect(joinedAnswers('palliative-hospice')).toContain('Hospice and Palliative Credentialing Center');
            // Prescribing limits and PDMP rules are not repo data — the copy
            // must send readers to the state board, never assert specifics.
            const pain = joinedAnswers('pain-management');
            expect(pain).toContain('state board');
            expect(pain).not.toMatch(/\d+\s*(?:day|days|mg|MME)\b/i);
            // Same rule for aesthetics ownership/delegation rules.
            expect(joinedAnswers('aesthetics')).toContain('state board');
        });
    });

    describe('truth rule — figures derive from stats-sources', () => {
        it('the only dollar figure in the new builders (no live avg) is the cited BLS median', () => {
            for (const key of NEW_LANDING_FAQ_KEYS) {
                const dollars = joinedAnswers(key).match(/\$[\d,]+/g) ?? [];
                for (const d of dollars) {
                    expect(d, `${key}: unexpected dollar literal ${d}`).toBe(
                        STAT_SOURCES.averageSalary.formatted,
                    );
                }
            }
        });

        it('CNS answers never cite the NP-specific BLS median (different occupation)', () => {
            expect(joinedAnswers('clinical-nurse-specialist')).not.toContain(
                STAT_SOURCES.averageSalary.formatted,
            );
        });

        it('new builders introduce no reference-niche copy', () => {
            for (const key of NEW_LANDING_FAQ_KEYS) {
                expect(joinedAnswers(key)).not.toMatch(/pmhnp|psychiatric|mental health/i);
            }
        });
    });

    it('the pediatric builder does not offer the retired ANCC PPCNP-BC exam', () => {
        // ANCC retired its pediatric primary care NP certification; PNCB's
        // CPNP-PC / CPNP-AC are the routes open to new candidates. Keeping
        // PPCNP-BC listed as an alternative sent readers at a closed door.
        const text = joinedAnswers('pediatric');
        expect(text).toContain('PNCB');
        expect(text).not.toMatch(/or\s+through\s+ANCC\s*\(PPCNP-BC\)/i);
        if (text.includes('PPCNP-BC')) {
            expect(text, 'PPCNP-BC named without retirement context').toMatch(/retired/i);
        }
    });
});

describe('P1 #6 (template half) — CategoryHero adopts the asset-registry contract', () => {
    const src = read('lib/pseo/category-landing-template.tsx');

    it('hero art comes from CATEGORY_ASSET_REGISTRY, with a clean no-image fallback', () => {
        expect(src).toContain("import { CATEGORY_ASSET_REGISTRY } from '@/lib/pseo/category-asset-registry'");
        expect(src).toContain('CATEGORY_ASSET_REGISTRY[slug]');
        expect(src).toContain('CategoryHero');
        // The no-image variant must survive: registry entries are optional.
        expect(src).toMatch(/heroArt \? \(/);
    });

    it('the template hardcodes no asset paths or storage hosts', () => {
        expect(src).not.toContain('STORAGE_BASE');
        expect(src).not.toContain('storage/v1');
        expect(src).not.toContain('site-assets');
        expect(src.toLowerCase()).not.toContain('supabase');
    });

    it('every JSON-LD block in the template is escaped with the repo pattern', () => {
        const src = read('lib/pseo/category-landing-template.tsx');
        const blocks = src.match(/application\/ld\+json/g) ?? [];
        const escapes = src.match(/\.replace\(\/<\/g, '\\\\u003c'\)/g) ?? [];
        expect(blocks.length).toBeGreaterThan(0);
        expect(escapes.length, 'each JSON-LD block needs the \\u003c escape chain').toBe(blocks.length);
    });

    it('the template renders the editorial + FAQ surfaces', () => {
        expect(src).toContain('getCategoryLandingContent');
        expect(src).toContain('isCategoryFaqSlug(slug)');
        expect(src).toContain('<CategoryFAQ');
    });
});

describe('P1 #16 (hub side) — DB-gated browse-by-state mesh on category landings', () => {
    const src = read('lib/pseo/category-landing-template.tsx');

    it('state links are gated on state eligibility + live inventory', () => {
        expect(src).toContain('getStateSpokeLinks');
        expect(src).toContain('STATE_ELIGIBLE_CATEGORY_SLUGS.includes(slug)');
        expect(src).toMatch(/groupBy\(\{\s*by: \['state'\]/);
        expect(src).toContain('stateLinks.length > 0 &&');
    });

    it('spoke hrefs target /jobs/<category>/<state> and dedupe against CategoryLocationsExplore', () => {
        expect(src).toContain('href: `/jobs/${slug}/${stateToSlug(name)}`');
        expect(src).toContain('stateLimit={coversStates ? 0 : undefined}');
    });
});

describe('P1 #17 — /jobs hub editorial + citable FAQ', () => {
    const src = read('app/jobs/page.tsx');

    it('renders a FAQPage schema derived from the same array as the visible FAQ', () => {
        expect(src).toContain("'@type': 'FAQPage'");
        expect(src).toContain('mainEntity: hubFaqs.map');
        expect(src).toContain('{hubFaqs.map((faq, index) => (');
    });

    it('schema JSON-LD is escaped with the repo pattern', () => {
        expect(src).toContain("JSON.stringify(hubFaqSchema).replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e')");
    });

    it('every figure derives from stats-sources or the live DB count', () => {
        expect(src).toContain('STAT_SOURCES.averageSalary.formatted');
        expect(src).toContain('STAT_SOURCES.blsGrowth2034');
        expect(src).toContain('STAT_SOURCES.fullPracticeStates');
        expect(src).toContain('totalJobs.toLocaleString()');
        // Fabricated-inventory claims stay dead (P0 #5 regression surface).
        expect(src).not.toMatch(/10,000\+|3,000\+|200\+ new/);
    });

    it('editorial renders only on the canonical unfiltered first page', () => {
        expect(src).toContain('userFilterKeys.length === 0 && page === 1 && total > 0');
        expect(src).toContain('showHubEditorial &&');
    });

    it('editorial block links the category, salary, and location hubs', () => {
        for (const href of ['/jobs/family-practice', '/jobs/acute-care', '/jobs/anesthesia', '/salary-guide', '/jobs/locations', '/job-alerts']) {
            expect(src, `missing hub link ${href}`).toContain(`href="${href}"`);
        }
    });
});

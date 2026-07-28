/**
 * Regression guards — P0 content/SEO items #10, #13, #16, #19
 * (pseo-faq-content package, 2026-07-28).
 *
 * #10: FAQ builders for the previously-unmapped setting-state category keys
 *      (employment types + NP specialties) so ~700 setting-state pages render
 *      a real FAQ block + FAQPage schema. TRUTH RULE: every figure in the new
 *      builders derives from lib/stats-sources.ts (or the live avgSalary
 *      input); certification bodies must be correct per specialty (NBCRNA for
 *      CRNA, AMCB for CNM, NCC for WHNP, PNCB for PNP, AANP/ANCC for FNP).
 *      NOTE: 'psychiatric-mental-health' is intentionally still unmapped —
 *      its copy requires a niche-copy ratchet ceiling raise in
 *      niche-copy-pseo-support-files.test.ts first.
 *
 * #13: the state-hub FAQPage JSON-LD emitted hand-copied truncated stubs
 *      that mismatched the visible answers. ONE stateFaqs array now feeds
 *      both surfaces (B48/B52 single-source-array convention).
 *
 * #16: buildCategoryLandingMetadata had no openGraph block, so all template
 *      category landings shipped without OG cards. It now emits /api/og
 *      images (the app/jobs/va/page.tsx pattern) — never a storage bucket.
 *
 * #19: metro pages were orphans and their metadata carried donor-niche
 *      keywords. They are now linked from /jobs/locations and from their
 *      parent state hubs, and metro keywords derive from brand.niche tokens.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { getCategoryFaqs, type CategorySlug } from '@/lib/pseo/category-faq-data';
import { SETTING_CONFIGS } from '@/lib/pseo/setting-state-config';
import { STAT_SOURCES } from '@/lib/stats-sources';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** A count that cannot collide with any cited figure in the copy. */
const SENTINEL_TOTAL = 4321;

const NEW_EMPLOYMENT_KEYS: CategorySlug[] = [
    'full-time', 'part-time', 'contract', '1099', 'locum-tenens',
];
const NEW_SPECIALTY_KEYS: CategorySlug[] = [
    'family-practice', 'adult-gerontology', 'pediatric', 'women-health',
    'acute-care', 'emergency', 'anesthesia', 'midwifery',
];
const NEW_KEYS: CategorySlug[] = [...NEW_EMPLOYMENT_KEYS, ...NEW_SPECIALTY_KEYS];

function faqsFor(category: CategorySlug, avgSalary?: number) {
    return getCategoryFaqs({ category, totalJobs: SENTINEL_TOTAL, avgSalary });
}

function joinedAnswers(category: CategorySlug): string {
    return faqsFor(category).map((f) => `${f.question}\n${f.answer}`).join('\n');
}

describe('P0 #10 — FAQ builders for previously-unmapped category keys', () => {
    it.each(NEW_KEYS)('%s returns 4-6 populated Q&As', (key) => {
        const faqs = faqsFor(key);
        expect(faqs.length).toBeGreaterThanOrEqual(4);
        expect(faqs.length).toBeLessThanOrEqual(6);
        for (const faq of faqs) {
            expect(faq.question.trim().length).toBeGreaterThan(10);
            expect(faq.answer.trim().length).toBeGreaterThan(40);
        }
    });

    it.each(NEW_KEYS)('%s interpolates the live job count', (key) => {
        expect(joinedAnswers(key)).toContain(String(SENTINEL_TOTAL));
    });

    it('every setting-state config except the psych slug now renders FAQs', () => {
        const unmapped = Object.values(SETTING_CONFIGS)
            .filter((c) => c.faqCategory !== 'psychiatric-mental-health')
            .filter((c) => getCategoryFaqs({
                category: c.faqCategory as CategorySlug,
                totalJobs: SENTINEL_TOTAL,
            }).length === 0)
            .map((c) => c.slug);
        expect(unmapped).toEqual([]);
    });

    describe('certification bodies are correct per specialty', () => {
        it('CRNA (anesthesia) cites NBCRNA and COA — never ANCC/AANP', () => {
            const text = joinedAnswers('anesthesia');
            expect(text).toContain('NBCRNA');
            expect(text).toContain('Council on Accreditation');
            expect(text).not.toMatch(/\bANCC\b/);
            expect(text).not.toMatch(/\bAANP\b/);
        });

        it('CNM (midwifery) cites AMCB and ACME — never ANCC/AANP/NBCRNA', () => {
            const text = joinedAnswers('midwifery');
            expect(text).toContain('American Midwifery Certification Board');
            expect(text).toContain('AMCB');
            expect(text).toContain('ACME');
            expect(text).not.toMatch(/\bANCC\b/);
            expect(text).not.toMatch(/\bAANP\b/);
            expect(text).not.toContain('NBCRNA');
        });

        it('FNP (family-practice) cites AANP and ANCC', () => {
            const text = joinedAnswers('family-practice');
            expect(text).toContain('AANP');
            expect(text).toContain('ANCC');
        });

        it("WHNP (women-health) cites the National Certification Corporation", () => {
            expect(joinedAnswers('women-health')).toContain('National Certification Corporation');
        });

        it('PNP (pediatric) cites PNCB', () => {
            expect(joinedAnswers('pediatric')).toContain('PNCB');
        });
    });

    describe('truth rule — figures derive from stats-sources', () => {
        it('the only dollar figure in the new builders (no live avg) is the cited BLS median', () => {
            for (const key of NEW_KEYS) {
                const dollars = joinedAnswers(key).match(/\$[\d,]+/g) ?? [];
                for (const d of dollars) {
                    expect(d, `${key}: unexpected dollar literal ${d}`).toBe(
                        STAT_SOURCES.averageSalary.formatted,
                    );
                }
            }
        });

        it('NP-specialty practice-authority answers carry the cited AANP FPA stat', () => {
            const fpaKeys: CategorySlug[] = [
                'family-practice', 'adult-gerontology', 'pediatric',
                'women-health', 'acute-care', 'emergency', '1099',
            ];
            for (const key of fpaKeys) {
                expect(joinedAnswers(key), `${key} missing FPA stat`).toContain(
                    STAT_SOURCES.fullPracticeStates.formatted,
                );
            }
        });

        it('the NP FPA stat is NOT applied to CRNA or CNM (different frameworks)', () => {
            for (const key of ['anesthesia', 'midwifery'] as CategorySlug[]) {
                expect(joinedAnswers(key)).not.toContain(
                    STAT_SOURCES.fullPracticeStates.formatted,
                );
            }
        });

        it('live avgSalary is surfaced when provided', () => {
            const withAvg = getCategoryFaqs({
                category: 'family-practice', totalJobs: SENTINEL_TOTAL, avgSalary: 123456,
            });
            expect(withAvg.map((f) => f.answer).join('\n')).toContain('$123,456');
        });
    });

    it('new builders introduce no reference-niche copy (niche-copy ratchet)', () => {
        for (const key of NEW_KEYS) {
            expect(joinedAnswers(key)).not.toMatch(/pmhnp|psychiatric|mental health/i);
        }
    });
});

describe('P0 #13 — state-hub FAQ JSON-LD matches the visible answers', () => {
    const src = read('app/jobs/state/[state]/page.tsx');

    it('exactly one stateFaqs array feeds both the JSON-LD and the accordion', () => {
        expect(src.match(/const stateFaqs = \[/g)).toHaveLength(1);
        expect(src).toMatch(/mainEntity: stateFaqs\.map/);
        expect(src).toMatch(/\{stateFaqs\.map\(\(faq/);
    });

    it('the truncated JSON-LD stub answers are gone', () => {
        // Old schema-only stubs that mismatched the visible copy.
        expect(src).not.toContain('$130K-$200K+');
        expect(src).not.toContain('Yes, many telehealth positions are available.');
        expect(src).not.toContain("'Multiple cities'");
    });
});

describe('P0 #16 — category-landing metadata emits OG cards via /api/og', () => {
    const src = read('lib/pseo/category-landing-template.tsx');
    const start = src.indexOf('export async function buildCategoryLandingMetadata');
    const end = src.indexOf('Page component', start);
    const metadataFn = src.slice(start, end === -1 ? undefined : end);

    it('buildCategoryLandingMetadata carries an openGraph block', () => {
        expect(start).toBeGreaterThan(-1);
        expect(metadataFn).toContain('openGraph:');
        expect(metadataFn).toContain('/api/og?type=page');
        expect(metadataFn).toContain('width: 1200');
        expect(metadataFn).toContain('height: 630');
    });

    it('OG image never routes through a remote storage bucket', () => {
        expect(metadataFn.toLowerCase()).not.toContain('supabase');
        expect(metadataFn).not.toContain('storageBase');
        expect(metadataFn).not.toContain('STORAGE_BASE');
    });
});

describe('P0 #19 — metro pages are linked and de-donored', () => {
    it('metro metadata keywords derive from brand tokens, not donor terms', () => {
        const src = read('app/jobs/metro/[slug]/page.tsx');
        expect(src).not.toMatch(/pmhnp|psychiatric|mental health/i);
        expect(src).toContain('brand.niche.short.toLowerCase()');
        expect(src).toContain('brand.niche.descriptor');
    });

    it('/jobs/locations links the metro guides', () => {
        const src = read('app/jobs/locations/page.tsx');
        expect(src).toContain("import { METRO_CITIES } from '@/lib/metro-data'");
        expect(src).toContain('/jobs/metro/${metro.slug}');
    });

    it('state hubs link their in-state metro guides', () => {
        const src = read('app/jobs/state/[state]/page.tsx');
        expect(src).toContain("import { METRO_CITIES } from '@/lib/metro-data'");
        expect(src).toContain('/jobs/metro/${m.slug}');
        // Links only render for states that actually have a metro guide.
        expect(src).toMatch(/METRO_CITIES\.filter\(\(m\) => m\.state === stateName\)/);
    });
});

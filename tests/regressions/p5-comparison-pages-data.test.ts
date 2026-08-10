/**
 * P5 A2 — vs-competitor comparison pages: claims-data integrity.
 *
 * lib/compare-data.ts is the single source for all /compare pages. These
 * tests enforce the truth rules the pages were built under:
 *
 *   1. One shared review date, ISO-formatted — every competitor claim is a
 *      dated snapshot from a single live-verification pass.
 *   2. Every competitor claim carries a source URL on that competitor's own
 *      domain (nominative, verifiable sourcing — no third-party hearsay).
 *   3. Numeric competitor facts in the capability table are either sourced
 *      or explicitly scoped as "not found in our review".
 *   4. Our-side numbers DERIVE from the registries that render the live
 *      product (tools registry, taxonomy registry, pricing config, licensure
 *      series) — the comparison pages cannot overstate what we ship.
 *   5. No reference-niche terms (protects the niche-copy debt ratchet) and
 *      no claims about dormant, flag-gated features.
 *   6. Credibility floor: each page must credit the competitor with real
 *      strengths and give honest "use them when" guidance.
 */
import { describe, it, expect } from 'vitest';
import {
    COMPARE_HUB_PATH,
    COMPARE_PAGE_PATHS,
    COMPARE_PUBLISHED_AT,
    COMPARE_REVIEW_DATE,
    COMPARE_REVIEW_DATE_LABEL,
    COMPETITOR_PROFILES,
    NOT_FOUND_IN_REVIEW,
    OUR_FACTS,
    getCompetitorProfile,
} from '@/lib/compare-data';
import { config } from '@/lib/config';
import { TOOLS } from '@/app/tools/tools-registry';
import { CATEGORY_AXES, ALL_CATEGORY_SLUGS } from '@/lib/pseo/taxonomy-registry';
import { SALARY_SPECIALTY_SLUGS } from '@/app/salary-guide/specialty/specialty-config';
import { LICENSE_GUIDE_STATES } from '@/lib/blog-license-guides';

/** Allowed source-URL hosts per profile slug — a claim about a competitor
 *  must be sourced to that competitor's own web properties. */
const ALLOWED_SOURCE_HOSTS: Record<string, string[]> = {
    'np-hiring-vs-indeed': ['www.indeed.com', 'indeed.com', 'www.hiringlab.org', 'hiringlab.org'],
    'np-hiring-vs-aanp-jobcenter': ['jobcenter.aanp.org'],
    'np-hiring-vs-enp-network': ['www.enpnetwork.com', 'enpnetwork.com'],
};

const hostOf = (url: string): string => new URL(url).hostname;

describe('compare-data: review date + structure', () => {
    it('has one ISO review date shared by the series', () => {
        expect(COMPARE_REVIEW_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(COMPARE_PUBLISHED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // The human-readable label must render the same date (guards against
        // someone bumping one constant and not the other).
        const [year] = COMPARE_REVIEW_DATE.split('-');
        expect(COMPARE_REVIEW_DATE_LABEL).toContain(year);
    });

    it('exposes exactly the three planned comparison pages, all under the hub', () => {
        expect(COMPETITOR_PROFILES).toHaveLength(3);
        expect(COMPARE_PAGE_PATHS).toHaveLength(3);
        expect(new Set(COMPARE_PAGE_PATHS).size).toBe(3);
        for (const p of COMPARE_PAGE_PATHS) {
            expect(p.startsWith(`${COMPARE_HUB_PATH}/`)).toBe(true);
        }
        // Lookup round-trips.
        for (const profile of COMPETITOR_PROFILES) {
            expect(getCompetitorProfile(profile.slug)).toBe(profile);
        }
        expect(getCompetitorProfile('nonexistent')).toBeUndefined();
    });

    it('every profile has the sections the shared renderer requires', () => {
        for (const profile of COMPETITOR_PROFILES) {
            expect(profile.slug).toMatch(/^[a-z0-9-]+$/);
            expect(profile.intro.length).toBeGreaterThanOrEqual(1);
            expect(profile.table.length).toBeGreaterThanOrEqual(5);
            expect(profile.pagesReviewed.length).toBeGreaterThanOrEqual(3);
            expect(profile.metaDescription.length).toBeLessThanOrEqual(220);
        }
    });
});

describe('compare-data: competitor claims are sourced to the competitor', () => {
    it('every strength claim links to the competitor own domain', () => {
        for (const profile of COMPETITOR_PROFILES) {
            const allowed = ALLOWED_SOURCE_HOSTS[profile.slug];
            expect(allowed, `no host allowlist for ${profile.slug}`).toBeDefined();
            for (const claim of profile.strengths) {
                expect(claim.text.trim().length).toBeGreaterThan(20);
                expect(claim.sourceUrl).toMatch(/^https:\/\//);
                expect(
                    allowed.includes(hostOf(claim.sourceUrl)),
                    `${profile.slug}: strength sourced off-domain: ${claim.sourceUrl}`,
                ).toBe(true);
            }
        }
    });

    it('every pagesReviewed entry is an https URL on the competitor domain', () => {
        for (const profile of COMPETITOR_PROFILES) {
            const allowed = ALLOWED_SOURCE_HOSTS[profile.slug];
            for (const page of profile.pagesReviewed) {
                expect(page.url).toMatch(/^https:\/\//);
                expect(
                    allowed.includes(hostOf(page.url)),
                    `${profile.slug}: reviewed page off-domain: ${page.url}`,
                ).toBe(true);
            }
        }
    });

    it('numeric competitor cells in the table are sourced or review-scoped', () => {
        for (const profile of COMPETITOR_PROFILES) {
            for (const row of profile.table) {
                // Remove the dated-snapshot label before checking for digits —
                // the date itself is not a competitor statistic.
                const remainder = row.them.split(COMPARE_REVIEW_DATE_LABEL).join('');
                const hasNumber = /\d/.test(remainder);
                const isScoped = row.them.includes(NOT_FOUND_IN_REVIEW);
                if (hasNumber && !isScoped) {
                    expect(
                        row.themSourceUrl,
                        `${profile.slug} / "${row.dimension}": numeric competitor cell without a source URL`,
                    ).toBeDefined();
                    expect(
                        ALLOWED_SOURCE_HOSTS[profile.slug].includes(hostOf(row.themSourceUrl as string)),
                        `${profile.slug} / "${row.dimension}": table source off-domain`,
                    ).toBe(true);
                }
            }
        }
    });
});

describe('compare-data: our side derives from the live product registries', () => {
    it('OUR_FACTS match the registries that render the product', () => {
        expect(OUR_FACTS.postingPriceUsd).toBe(config.postingPrice);
        expect(OUR_FACTS.postingDurationDays).toBe(config.durationDays);
        expect(OUR_FACTS.toolCount).toBe(TOOLS.length);
        expect(OUR_FACTS.npSpecialtyCategoryCount).toBe(CATEGORY_AXES.specialty.length);
        expect(OUR_FACTS.aprnCategoryCount).toBe(CATEGORY_AXES.aprn.length);
        expect(OUR_FACTS.categoryPageCount).toBe(ALL_CATEGORY_SLUGS.length);
        expect(OUR_FACTS.licensureGuideCount).toBe(LICENSE_GUIDE_STATES.length);
        expect(OUR_FACTS.salarySpecialtyPageCount).toBe(SALARY_SPECIALTY_SLUGS.length);
    });

    it('licensure series claim only stands while the series is 51 jurisdictions', () => {
        // 50 states + DC. If the series shrinks, the comparison claim must be
        // revisited — fail loudly rather than publish a stale number.
        expect(OUR_FACTS.licensureGuideCount).toBe(51);
    });
});

describe('compare-data: copy hygiene + truth posture', () => {
    const fullText = JSON.stringify(COMPETITOR_PROFILES);

    it('contains no reference-niche terms (niche-copy debt ratchet posture)', () => {
        expect(fullText).not.toMatch(/pmhnp/i);
        expect(fullText).not.toMatch(/psychiatric/i);
        expect(fullText).not.toMatch(/mental health/i);
    });

    it('claims none of the dormant, flag-gated features', () => {
        // Semantic search, AI recommendations, and the named clinical
        // reviewer are built but gated off — the comparison pages must not
        // advertise them (teardown truth rule: mark dormant or omit).
        expect(fullText).not.toMatch(/semantic search/i);
        expect(fullText).not.toMatch(/AI[- ](?:powered[- ])?(?:recommendations|matching)/i);
        expect(fullText).not.toMatch(/clinician[- ]reviewed/i);
    });

    it('does not claim required pay on listings or employer reviews for us', () => {
        // We do not require salary on postings and deliberately host no
        // employer reviews; the pages must not imply otherwise.
        for (const profile of COMPETITOR_PROFILES) {
            for (const row of profile.table) {
                expect(row.us).not.toMatch(/required pay|pay required|reviews? of employers we host/i);
            }
        }
    });

    it('every page credits competitor strengths and honest "use them" guidance', () => {
        for (const profile of COMPETITOR_PROFILES) {
            expect(
                profile.strengths.length,
                `${profile.slug}: a credible comparison needs >= 3 competitor strengths`,
            ).toBeGreaterThanOrEqual(3);
            expect(
                profile.guidance.useThem.length,
                `${profile.slug}: needs >= 2 honest reasons to choose the competitor`,
            ).toBeGreaterThanOrEqual(2);
            expect(profile.guidance.useUs.length).toBeGreaterThanOrEqual(2);
        }
    });
});

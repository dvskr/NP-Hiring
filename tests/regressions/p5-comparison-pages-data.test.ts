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
 *   7. Our price statements follow the launch-promo clock (backlog 2.1):
 *      while the promo runs they are the sentences the pages printed before;
 *      from config.promoEndsAt they state the ladder as the current price,
 *      never "free" or a dated "From January 1, 2027", while the competitor
 *      claims and their review date do not move.
 *   8. In both phases the review date dates only the competitor's price
 *      ("both public, as of <review date>" dated OUR promo and ladder, which
 *      went public on 2026-09-12, to a review five weeks earlier), and the
 *      credential takes its spoken article ("an NP", never "a NP").
 *
 * The profiles are built per render, so every invariant is checked on the
 * profiles of BOTH phases.
 */
import { describe, it, expect } from 'vitest';
import {
    COMPARE_HUB_PATH,
    COMPARE_PAGE_PATHS,
    COMPARE_PUBLISHED_AT,
    COMPARE_REVIEW_DATE,
    COMPARE_REVIEW_DATE_LABEL,
    COMPETITOR_SLUGS,
    NOT_FOUND_IN_REVIEW,
    OUR_FACTS,
    competitorProfiles,
    getCompetitorProfile,
    isCompetitorSlug,
    type CompetitorProfile,
    type CompetitorSlug,
} from '@/lib/compare-data';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { indefiniteArticle } from '@/lib/display-text';
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

/** The last day of the launch promo, and the instant it ends. */
const PROMO_RUNNING = new Date('2026-12-31T12:00:00Z');
const LADDER_LIVE = new Date(config.promoEndsAt);
const PHASES = [
    ['promo', PROMO_RUNNING],
    ['ladder', LADDER_LIVE],
] as const;

/** Every profile in both phases: the content invariants hold in each. */
const ALL_PROFILES: readonly CompetitorProfile[] = PHASES.flatMap(([, now]) => [...competitorProfiles(now)]);

/** One profile's pricing-row cell and the bodies of its /pricing differences. */
const pricingCell = (profile: CompetitorProfile): string =>
    profile.table.find((row) => row.dimension === 'Employer pricing')?.us ?? '';
const pricingBody = (profile: CompetitorProfile): string =>
    profile.differences.find((item) => item.href === '/pricing')?.body ?? '';
const profileFor = (slug: CompetitorSlug, now: Date): CompetitorProfile => getCompetitorProfile(slug, now);

describe('compare-data: review date + structure', () => {
    it('has one ISO review date shared by the series', () => {
        expect(COMPARE_REVIEW_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(COMPARE_PUBLISHED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // The human-readable label must render the same date (guards against
        // someone bumping one constant and not the other).
        const [year] = COMPARE_REVIEW_DATE.split('-');
        expect(COMPARE_REVIEW_DATE_LABEL).toContain(year);
    });

    it('exposes exactly the three planned comparison pages, all under the hub, in both phases', () => {
        expect(COMPETITOR_SLUGS).toHaveLength(3);
        expect(COMPARE_PAGE_PATHS).toHaveLength(3);
        expect(new Set(COMPARE_PAGE_PATHS).size).toBe(3);
        for (const p of COMPARE_PAGE_PATHS) {
            expect(p.startsWith(`${COMPARE_HUB_PATH}/`)).toBe(true);
        }
        expect(COMPARE_PAGE_PATHS).toEqual(COMPETITOR_SLUGS.map((slug) => `${COMPARE_HUB_PATH}/${slug}`));
        for (const [, now] of PHASES) {
            const profiles = competitorProfiles(now);
            // One profile per slug, in route order, and the lookup round-trips.
            expect(profiles.map((p) => p.slug)).toEqual([...COMPETITOR_SLUGS]);
            for (const profile of profiles) {
                expect(getCompetitorProfile(profile.slug, now)).toEqual(profile);
            }
        }
        for (const slug of COMPETITOR_SLUGS) expect(isCompetitorSlug(slug)).toBe(true);
        expect(isCompetitorSlug('nonexistent')).toBe(false);
    });

    it('every profile has the sections the shared renderer requires', () => {
        for (const profile of ALL_PROFILES) {
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
        for (const profile of ALL_PROFILES) {
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
        for (const profile of ALL_PROFILES) {
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
        for (const profile of ALL_PROFILES) {
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
    const fullText = JSON.stringify(ALL_PROFILES);

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
        for (const profile of ALL_PROFILES) {
            for (const row of profile.table) {
                expect(row.us).not.toMatch(/required pay|pay required|reviews? of employers we host/i);
            }
        }
    });

    it('every page credits competitor strengths and honest "use them" guidance', () => {
        for (const profile of ALL_PROFILES) {
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

describe('compare-data: our price statements follow the launch-promo clock (backlog 2.1)', () => {
    it('while the promo runs, every price statement is the sentence the pages printed before, with the review date and the article put right', () => {
        const cell = `Free through ${config.promoEndsLabel}. From ${config.ladderStartsLabel}: $${config.introPrice} first post, $${config.postingPrice} after, or $${config.planPrice}/month for ${config.planSlots} active jobs. Every post runs ${config.durationDays} days. All of it is published on /pricing`;
        for (const profile of competitorProfiles(PROMO_RUNNING)) {
            expect(pricingCell(profile), profile.slug).toBe(cell);
        }
        const indeed = profileFor('np-hiring-vs-indeed', PROMO_RUNNING);
        expect(pricingBody(indeed)).toBe(
            `Our pricing is a short public page: every post is free through ${config.promoEndsLabel}; from ${config.ladderStartsLabel} your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs, each a ${config.durationDays}-day listing. Indeed's model is different by design: its pricing page states there is no flat upfront fee and sponsorship is results-based (per click or per started application, with budgets), alongside a monthly free-post allowance. Neither model is wrong; ours is simpler to budget for a single ${brand.niche.short} hire.`,
        );
        const aanp = profileFor('np-hiring-vs-aanp-jobcenter', PROMO_RUNNING);
        expect(pricingBody(aanp)).toBe(
            `Free through ${config.promoEndsLabel} here, then from ${config.ladderStartsLabel} $${config.introPrice} for your first post and $${config.postingPrice} after (or $${config.planPrice}/month for ${config.planSlots} active jobs), every post ${config.durationDays} days, versus $399 for a single 30-day posting there (their published price on the review date). Both prices are public, so you can compare them directly for your hiring volume.`,
        );
        // The review date dates their price only: ours went public on 2026-09-12.
        expect(aanp.guidance.useUs[1]).toBe(
            `You are an employer comparing published prices: free through ${config.promoEndsLabel}, then $${config.introPrice} first post / $${config.postingPrice} after for ${config.durationDays} days here, versus $399 for 30 days there (theirs as published on ${COMPARE_REVIEW_DATE_LABEL}).`,
        );
        const enp = profileFor('np-hiring-vs-enp-network', PROMO_RUNNING);
        expect(pricingBody(enp)).toBe(
            `Both boards publish employer pricing openly, and credit is due for that. The numbers differ: free through ${config.promoEndsLabel} here, then $${config.introPrice} for your first post and $${config.postingPrice} after (or $${config.planPrice}/month for ${config.planSlots} active jobs), each ${config.durationDays} days, versus postings starting at $389 there (their published price on the review date).`,
        );
        // The article is computed from the credential: "an NP".
        expect(enp.guidance.useUs[2]).toBe(
            `You are an employer hiring ${indefiniteArticle(brand.niche.short)} ${brand.niche.short} and comparing published prices: free through ${config.promoEndsLabel}, then $${config.introPrice} first post and $${config.postingPrice} after, every post ${config.durationDays} days.`,
        );
    });

    it('once the promo has ended, nothing offers it or dates the ladder, and every page states the ladder', () => {
        const ladderProfiles = competitorProfiles(LADDER_LIVE);
        for (const profile of ladderProfiles) {
            const text = JSON.stringify(profile);
            // Neither promo date survives the switch anywhere on the page.
            expect(text, profile.slug).not.toContain(config.promoEndsLabel);
            expect(text, profile.slug).not.toContain(config.ladderStartsLabel);
            expect(text, profile.slug).not.toMatch(/free through|launch (?:promo|period)|\$0\b/i);
            // The pricing row states all three current prices, in the present tense.
            const cell = pricingCell(profile);
            expect(cell, profile.slug).toBe(
                `$${config.introPrice} first post, $${config.postingPrice} after, or $${config.planPrice}/month for ${config.planSlots} active jobs. Every post runs ${config.durationDays} days. All of it is published on /pricing`,
            );
            expect(pricingBody(profile), profile.slug).toContain(`$${config.introPrice}`);
            expect(pricingBody(profile), profile.slug).toContain(`$${config.planPrice}/month for ${config.planSlots} active jobs`);
        }
        expect(pricingBody(profileFor('np-hiring-vs-indeed', LADDER_LIVE))).toContain(
            `Our pricing is a short public page: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs, each a ${config.durationDays}-day listing.`,
        );
        // A new sentence, so the article is computed: "an NP", never "a NP".
        expect(profileFor('np-hiring-vs-enp-network', LADDER_LIVE).guidance.useUs[2]).not.toMatch(/\ba NP\b/);
    });

    it('our prices are current after the switch, while competitor prices stay dated to the review', () => {
        const aanp = profileFor('np-hiring-vs-aanp-jobcenter', LADDER_LIVE);
        expect(pricingBody(aanp)).toContain('versus $399 for a single 30-day posting there (their published price on the review date)');
        expect(aanp.guidance.useUs[1]).toContain(`versus $399 for 30 days there (theirs as published on ${COMPARE_REVIEW_DATE_LABEL}).`);
        // "both public, as of <review date>" would date OUR current price to the review.
        expect(aanp.guidance.useUs[1]).not.toContain('both public, as of');
        expect(pricingBody(profileFor('np-hiring-vs-enp-network', LADDER_LIVE))).toContain(
            'versus postings starting at $389 there (their published price on the review date)',
        );
    });

    it.each(PHASES)('%s phase: the review date dates only their price, and the credential takes its spoken article', (_phase, now) => {
        const aanp = profileFor('np-hiring-vs-aanp-jobcenter', now);
        expect(aanp.guidance.useUs[1]).toContain(`versus $399 for 30 days there (theirs as published on ${COMPARE_REVIEW_DATE_LABEL}).`);
        // An initialism takes the article of its first spoken letter ("an NP"),
        // so the other article in front of the credential is always a slip.
        const article = indefiniteArticle(brand.niche.short);
        const wrongArticle = new RegExp(`\\b${article === 'an' ? 'a' : 'an'} ${brand.niche.short}\\b`, 'i');
        for (const profile of competitorProfiles(now)) {
            const text = JSON.stringify(profile);
            // Our promo and ladder went public on 2026-09-12, after the review.
            expect(text, profile.slug).not.toContain('both public, as of');
            expect(text, profile.slug).not.toMatch(wrongArticle);
        }
        expect(profileFor('np-hiring-vs-enp-network', now).guidance.useUs[2].startsWith(
            `You are an employer hiring ${article} ${brand.niche.short} and comparing published prices: `,
        )).toBe(true);
        expect(profileFor('np-hiring-vs-aanp-jobcenter', now).differences.find((item) => item.href === '/salary-guide')?.body.startsWith(
            `We publish ${article} ${brand.niche.short} salary guide `,
        )).toBe(true);
    });

    it('only our price statements change at the switch; competitor claims and page identity do not', () => {
        for (const slug of COMPETITOR_SLUGS) {
            const before = profileFor(slug, PROMO_RUNNING);
            const after = profileFor(slug, LADDER_LIVE);
            // Identity and metadata: phase-neutral, so the routes keep them static-safe.
            for (const key of ['slug', 'competitorName', 'competitorUrl', 'title', 'metaTitle', 'metaDescription'] as const) {
                expect(after[key], `${slug}.${key}`).toBe(before[key]);
            }
            expect(after.intro).toEqual(before.intro);
            expect(after.strengths).toEqual(before.strengths);
            expect(after.pagesReviewed).toEqual(before.pagesReviewed);
            expect(after.guidance.useThem).toEqual(before.guidance.useThem);
            expect(after.table.map(({ dimension, them, themSourceUrl }) => ({ dimension, them, themSourceUrl })))
                .toEqual(before.table.map(({ dimension, them, themSourceUrl }) => ({ dimension, them, themSourceUrl })));
            expect(after.differences.map(({ title, href }) => ({ title, href })))
                .toEqual(before.differences.map(({ title, href }) => ({ title, href })));
            // What does change is exactly the pricing row, the /pricing
            // difference and a "use us" line that quoted the promo.
            expect(pricingCell(after)).not.toBe(pricingCell(before));
            expect(pricingBody(after)).not.toBe(pricingBody(before));
            const notPricingRow = (row: { dimension: string }): boolean => row.dimension !== 'Employer pricing';
            expect(after.table.filter(notPricingRow)).toEqual(before.table.filter(notPricingRow));
            const notPricingDifference = (item: { href?: string }): boolean => item.href !== '/pricing';
            expect(after.differences.filter(notPricingDifference)).toEqual(before.differences.filter(notPricingDifference));
            before.guidance.useUs.forEach((line, i) => {
                if (line.includes(config.promoEndsLabel)) expect(after.guidance.useUs[i], `${slug} useUs[${i}]`).not.toBe(line);
                else expect(after.guidance.useUs[i], `${slug} useUs[${i}]`).toBe(line);
            });
        }
    });

    it('switches at config.promoEndsAt exactly, not a millisecond earlier', () => {
        const lastPromoMs = new Date(Date.parse(config.promoEndsAt) - 1);
        expect(pricingCell(profileFor('np-hiring-vs-indeed', lastPromoMs))).toContain(`Free through ${config.promoEndsLabel}`);
        expect(pricingCell(profileFor('np-hiring-vs-indeed', LADDER_LIVE))).not.toContain('Free through');
    });
});

/**
 * Backlog 2.1, package M2: the employer surfaces around /pricing (the
 * resources hub, the hiring guide, the job description guide, the template
 * library and template pages, /testimonials, the salary benchmark, the
 * cost-per-hire calculator, the comparison pages and /post-job's metadata)
 * switch from the launch promo to the paid ladder at config.promoEndsAt, with
 * no deploy.
 *
 * Every page is imported ONCE, at module load, under the real clock, and
 * rendered with the clock pinned on each side of the switch. A page that
 * decided the phase in a module-scope constant would keep printing the promo
 * after the switch, which is exactly the defect this item removes, so these
 * renders fail on it. Pinned:
 *   - promo phase: the sentences the pages printed before, unchanged;
 *   - ladder phase: the ladder as the current price (lib/pricing-copy.ts), and
 *     no "free through", no "Post a Job: Free", no launch promo or launch
 *     period, no "$0", no promo end date and no dated "From January 1, 2027"
 *     (a post made during the promo may still be mentioned as history);
 *   - JSON-LD (the cost-per-hire FAQPage) follows the same phase as the copy;
 *   - every such page re-renders hourly (revalidate 3600).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The benchmark widget is an async server component that aggregates live
// postings; the salary benchmark page's own copy is what is under test here.
vi.mock('@/components/tools/EmployerBenchmarkWidget', () => ({ default: () => null }));

import { prisma } from '@/lib/prisma';
import { brand } from '@/config/brand';
import { config } from '@/lib/config';
import { FULL_PACKAGE, LADDER_PRICES } from '@/lib/pricing-copy';
import { JD_TEMPLATES } from '@/lib/jd-templates';
import { FREE_POST_SCOPE_NOTE, type PricingPhase } from '@/components/tools/cost-per-hire-model';
import { competitorProfiles } from '@/lib/compare-data';
import { costPerHireAssumptions, costPerHireFaqs, postRoleBlurb } from '@/app/tools/cost-per-hire-calculator/cost-per-hire-copy';
import { postJobCta } from '@/app/for-employers/resources/post-job-cta';
import EmployerResourcesHubPage, { revalidate as hubRevalidate } from '@/app/for-employers/resources/page';
import HowToHireGuidePage, { revalidate as howToHireRevalidate } from '@/app/for-employers/resources/how-to-hire/page';
import JobDescriptionGuidePage, { metadata as jdGuideMetadata, revalidate as jdGuideRevalidate } from '@/app/for-employers/resources/job-description-guide/page';
import JdTemplateLibraryPage, { revalidate as libraryRevalidate } from '@/app/for-employers/resources/job-description-templates/page';
import JdTemplateDetailPage, { revalidate as detailRevalidate } from '@/app/for-employers/resources/job-description-templates/[id]/page';
import TestimonialsPage, { revalidate as testimonialsRevalidate } from '@/app/testimonials/page';
import SalaryBenchmarkPage, { revalidate as benchmarkRevalidate } from '@/app/tools/salary-benchmark/page';
import CostPerHireCalculatorPage, { revalidate as costPerHireRevalidate } from '@/app/tools/cost-per-hire-calculator/page';
import NpHiringVsIndeedPage, { revalidate as indeedRevalidate, generateMetadata as indeedMetadata } from '@/app/compare/np-hiring-vs-indeed/page';
import NpHiringVsAanpJobcenterPage, { revalidate as aanpRevalidate } from '@/app/compare/np-hiring-vs-aanp-jobcenter/page';
import NpHiringVsEnpNetworkPage, { revalidate as enpRevalidate } from '@/app/compare/np-hiring-vs-enp-network/page';
import { generateMetadata as postJobMetadata, revalidate as postJobRevalidate } from '@/app/post-job/layout';

/** The global Prisma mock predates the testimonial table; /testimonials reads it. */
const prismaMock = prisma as unknown as Record<string, unknown> & {
    employerTestimonial: { findMany: ReturnType<typeof vi.fn> };
};
prismaMock.employerTestimonial = { findMany: vi.fn() };

/** The last day of the launch promo, and an hour after it ended. */
const PROMO_RUNNING = new Date('2026-12-31T12:00:00.000Z');
const LADDER_LIVE = new Date(Date.parse(config.promoEndsAt) + 60 * 60 * 1000);

/** A post made free during the promo keeps the intro price unspent: history, allowed after it. */
const PROMO_HISTORY = /Posts made free during the launch promo do not use (?:it|the intro price) up\./g;

/** Server-rendered HTML, rendered under the pinned clock. */
const html = (element: React.ReactElement): string => renderToStaticMarkup(element);

/** The visible text of rendered HTML: no scripts or styles, tags dropped, entities decoded. */
function visibleText(markup: string): string {
    return markup
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ');
}

/** The JSON-LD blocks of rendered HTML, parsed. */
function jsonLdBlocks(markup: string): Array<Record<string, unknown>> {
    return [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
        (match) => JSON.parse(match[1]) as Record<string, unknown>,
    );
}

/** No current offer of the promo and no dated ladder, after the history sentence is set aside. */
function expectLadderOnly(text: string, surface: string): void {
    const offer = text.replace(PROMO_HISTORY, '');
    for (const pattern of [/free through/i, /a job: free/i, /launch promo/i, /launch period/i, /\$0\b/]) {
        expect(offer, `${surface}: ${pattern}`).not.toMatch(pattern);
    }
    expect(offer, `${surface}: promo end date`).not.toContain(config.promoEndsLabel);
    expect(offer, `${surface}: dated ladder`).not.toContain(config.ladderStartsLabel);
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PROMO_RUNNING);
    prismaMock.employerTestimonial.findMany.mockResolvedValue([
        {
            id: 't1',
            employerName: 'Clinic Co',
            content: 'We filled the role quickly.',
            rating: 5,
            displayAs: 'verified',
            featuredAt: new Date('2026-09-01T00:00:00.000Z'),
        },
    ]);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('2.1 M2: every surface that follows the promo clock re-renders at least hourly', () => {
    it.each([
        ['/for-employers/resources', hubRevalidate],
        ['/for-employers/resources/how-to-hire', howToHireRevalidate],
        ['/for-employers/resources/job-description-guide', jdGuideRevalidate],
        ['/for-employers/resources/job-description-templates', libraryRevalidate],
        ['/for-employers/resources/job-description-templates/[id]', detailRevalidate],
        ['/testimonials', testimonialsRevalidate],
        ['/tools/salary-benchmark', benchmarkRevalidate],
        ['/tools/cost-per-hire-calculator', costPerHireRevalidate],
        ['/compare/np-hiring-vs-indeed', indeedRevalidate],
        ['/compare/np-hiring-vs-aanp-jobcenter', aanpRevalidate],
        ['/compare/np-hiring-vs-enp-network', enpRevalidate],
        ['/post-job (layout)', postJobRevalidate],
    ])('%s', (_surface, revalidate) => {
        expect(revalidate).toBe(3600);
    });
});

describe('2.1 M2: the employer resources CTA', () => {
    it('is the promo sentence and button while the promo runs, to its last millisecond', () => {
        for (const now of [PROMO_RUNNING, new Date(Date.parse(config.promoEndsAt) - 1)]) {
            expect(postJobCta(now)).toEqual({
                offer: `Every post is free through ${config.promoEndsLabel}, with every feature included.`,
                price: `Every post is free through ${config.promoEndsLabel}.`,
                button: 'Post a Job: Free',
            });
        }
    });

    it('states the ladder from config.promoEndsAt, and the button drops "Free"', () => {
        expect(postJobCta(new Date(config.promoEndsAt))).toEqual({
            offer: `${LADDER_PRICES} ${FULL_PACKAGE}`,
            price: LADDER_PRICES,
            button: 'Post a Job',
        });
    });

    it('the hub', () => {
        const before = visibleText(html(React.createElement(EmployerResourcesHubPage)));
        expect(before).toContain(`Every post is free through ${config.promoEndsLabel}, with every feature included. The same ${JD_TEMPLATES.length} templates are available inside the description editor.`);
        expect(before).toContain('Post a Job: Free');

        vi.setSystemTime(LADDER_LIVE);
        const after = visibleText(html(React.createElement(EmployerResourcesHubPage)));
        expect(after).toContain(`${LADDER_PRICES} ${FULL_PACKAGE} The same ${JD_TEMPLATES.length} templates are available inside the description editor.`);
        expect(after).toContain('Post a Job');
        expectLadderOnly(after, '/for-employers/resources');
    });

    it('the template library', () => {
        const before = visibleText(html(React.createElement(JdTemplateLibraryPage)));
        expect(before).toContain(`fill in automatically. Every post is free through ${config.promoEndsLabel}.`);
        expect(before).toContain('Post a Job: Free');

        vi.setSystemTime(LADDER_LIVE);
        const after = visibleText(html(React.createElement(JdTemplateLibraryPage)));
        expect(after).toContain(`fill in automatically. ${LADDER_PRICES}`);
        expectLadderOnly(after, '/for-employers/resources/job-description-templates');
    });

    it('every template page', async () => {
        const render = async (id: string): Promise<string> =>
            visibleText(html(await JdTemplateDetailPage({ params: Promise.resolve({ id }) })));
        for (const { id } of JD_TEMPLATES) {
            vi.setSystemTime(PROMO_RUNNING);
            const before = await render(id);
            expect(before, id).toContain(`template starters. Every post is free through ${config.promoEndsLabel}, with every feature included.`);
            expect(before, id).toContain('Post a Job: Free');

            vi.setSystemTime(LADDER_LIVE);
            const after = await render(id);
            expect(after, id).toContain(`template starters. ${LADDER_PRICES} ${FULL_PACKAGE}`);
            expectLadderOnly(after, `/for-employers/resources/job-description-templates/${id}`);
        }
    });

    it('the hiring guide card', () => {
        const before = visibleText(html(React.createElement(HowToHireGuidePage)));
        expect(before).toContain(`Post Your Role Free through ${config.promoEndsLabel}, with every feature included.`);

        vi.setSystemTime(LADDER_LIVE);
        const after = visibleText(html(React.createElement(HowToHireGuidePage)));
        expect(after).toContain(`Post Your Role ${LADDER_PRICES}`);
        expectLadderOnly(after, '/for-employers/resources/how-to-hire');
    });

    it('the job description guide: its post-a-job button is the builder\'s, and nothing else on it names a price', () => {
        // The guide was the one resources page no package owned: it printed a
        // hard-coded "Post a Job: Free" and was fully static, so it would have
        // offered a free post until someone deployed.
        const postJobButtons = (markup: string): string[] =>
            [...markup.matchAll(/<a\b[^>]*href="\/post-job"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => visibleText(match[1]).trim());

        const before = html(React.createElement(JobDescriptionGuidePage));
        expect(postJobButtons(before)).toEqual(['Post a Job: Free']);

        vi.setSystemTime(LADDER_LIVE);
        const after = html(React.createElement(JobDescriptionGuidePage));
        expect(postJobButtons(after)).toEqual(['Post a Job']);
        // The whole document, JSON-LD included: the Article and FAQPage blocks state no price.
        expectLadderOnly(after, '/for-employers/resources/job-description-guide');
        // Nor does the metadata, which is why it can stay a static export.
        expectLadderOnly(JSON.stringify(jdGuideMetadata), '/for-employers/resources/job-description-guide metadata');
    });
});

describe('2.1 M2: /testimonials and the salary benchmark', () => {
    it('/testimonials: the button offers the promo only while it runs; afterwards the line states the ladder', async () => {
        const before = visibleText(html(await TestimonialsPage()));
        expect(before).toContain(`Post a job: free through ${config.promoEndsLabel}`);
        expect(before).toContain(`Every post runs ${config.durationDays} days with every feature.`);
        expect(before).not.toContain(LADDER_PRICES);

        vi.setSystemTime(LADDER_LIVE);
        const after = visibleText(html(await TestimonialsPage()));
        expect(after).toContain(`Post a job ${LADDER_PRICES} Every post runs ${config.durationDays} days with every feature.`);
        expectLadderOnly(after, '/testimonials');
    });

    it('/tools/salary-benchmark: the post-a-role card', () => {
        const before = visibleText(html(React.createElement(SalaryBenchmarkPage)));
        expect(before).toContain(`Post a role Free through ${config.promoEndsLabel}, all features included.`);

        vi.setSystemTime(LADDER_LIVE);
        const after = visibleText(html(React.createElement(SalaryBenchmarkPage)));
        expect(after).toContain(`Post a role ${LADDER_PRICES}`);
        expectLadderOnly(after, '/tools/salary-benchmark');
    });
});

describe('2.1 M2: /tools/cost-per-hire-calculator', () => {
    const faqAnswers = (markup: string): string[] => {
        const faq = jsonLdBlocks(markup).find((block) => block['@type'] === 'FAQPage') as
            | { mainEntity: Array<{ acceptedAnswer: { text: string } }> }
            | undefined;
        expect(faq, 'FAQPage JSON-LD').toBeDefined();
        return faq!.mainEntity.map((entry) => entry.acceptedAnswer.text);
    };

    it('while the promo runs: the promo is offered, selected and explained, exactly as before', () => {
        const markup = html(React.createElement(CostPerHireCalculatorPage));
        expect(markup).toContain('<option value="promo" selected="">');
        expect(markup.match(/<option /g)).toHaveLength(3);
        const text = visibleText(markup);
        expect(text).toContain(`Launch promo: free through ${config.promoEndsLabel}`);
        expect(text).toContain(`During our launch promo ${FREE_POST_SCOPE_NOTE}. From ${config.ladderStartsLabel}: your first post is $${config.introPrice}`);
        expect(text).toContain('That is the launch promo doing the work');
        expect(text).toContain(`Post a role Free through ${config.promoEndsLabel}, every feature included.`);
        expect(faqAnswers(markup).join('\n')).toContain(`During the launch promo ${FREE_POST_SCOPE_NOTE}.`);
    });

    it('after the promo: no promo mode, the per-post ladder opens, and the copy and FAQ JSON-LD state the ladder', () => {
        vi.setSystemTime(LADDER_LIVE);
        const markup = html(React.createElement(CostPerHireCalculatorPage));
        expect(markup).not.toContain('value="promo"');
        expect(markup).toContain('<option value="per-post" selected="">Per post</option>');
        expect(markup.match(/<option /g)).toHaveLength(2);
        const text = visibleText(markup);
        expect(text).toContain(`Your first post is $${config.introPrice}, every post after that is $${config.postingPrice} for ${config.durationDays} days`);
        // The default per-post plan prices one intro post: a real price, not $0.
        expect(text).toContain(`1 intro post at $${config.introPrice}`);
        expect(text).toContain(`Post a role ${LADDER_PRICES}`);
        expectLadderOnly(text, '/tools/cost-per-hire-calculator');
        const answers = faqAnswers(markup).join('\n');
        expect(answers).toContain(LADDER_PRICES);
        expectLadderOnly(answers, '/tools/cost-per-hire-calculator FAQPage JSON-LD');
    });
});

describe('2.1 M2: the comparison pages', () => {
    const PAGES = [
        ['np-hiring-vs-indeed', NpHiringVsIndeedPage],
        ['np-hiring-vs-aanp-jobcenter', NpHiringVsAanpJobcenterPage],
        ['np-hiring-vs-enp-network', NpHiringVsEnpNetworkPage],
    ] as const;

    it.each(PAGES)('%s states the promo while it runs and the ladder after, read per render', (_slug, Page) => {
        const before = visibleText(html(React.createElement(Page)));
        expect(before).toContain(`Free through ${config.promoEndsLabel}. From ${config.ladderStartsLabel}: $${config.introPrice} first post`);

        vi.setSystemTime(LADDER_LIVE);
        const after = visibleText(html(React.createElement(Page)));
        expect(after).toContain(`$${config.introPrice} first post, $${config.postingPrice} after, or $${config.planPrice}/month for ${config.planSlots} active jobs. Every post runs ${config.durationDays} days.`);
        expectLadderOnly(after, _slug);
    });

    it('metadata is phase-neutral, so it reads the same on both sides of the switch', async () => {
        const before = await indeedMetadata();
        vi.setSystemTime(LADDER_LIVE);
        expect(await indeedMetadata()).toEqual(before);
    });
});

describe('2.1 M2: the phase copy follows the house style in both phases', () => {
    it('no em or en dash, no spaced hyphen, no hyphen range', async () => {
        const phases: Array<[PricingPhase, Date]> = [['promo', PROMO_RUNNING], ['ladder', LADDER_LIVE]];
        const lines: string[] = [];
        for (const [phase, now] of phases) {
            vi.setSystemTime(now);
            lines.push(...Object.values(postJobCta(now)));
            lines.push(...costPerHireAssumptions(phase), ...costPerHireFaqs(phase).flatMap(({ q, a }) => [q, a]), postRoleBlurb(phase));
            for (const profile of competitorProfiles(now)) {
                lines.push(...profile.table.filter((row) => row.dimension === 'Employer pricing').map((row) => row.us));
                lines.push(...profile.differences.filter((item) => item.href === '/pricing').map((item) => item.body));
                lines.push(...profile.guidance.useUs);
            }
            lines.push(String((await postJobMetadata()).description));
        }
        for (const line of lines) {
            expect(line).not.toMatch(/[–—]/);
            expect(line).not.toMatch(/(?:^|\s)-(?:\s|$)/);
            // The range patterns of tests/regressions/public-employer-copy-rule.test.ts
            // (an SOC code such as 29-1171 is not a range).
            expect(line).not.toMatch(/\b\d[\d,.]*\s*-\s*\d[\d,.]*\s*(?:yrs?|years?|hours?|days?|weeks?|months?|k|%)(?![A-Za-z])/i);
            expect(line).not.toMatch(/\$\d[\d,.]*k?\s*-\s*\$?\d/i);
        }
    });
});

describe('2.1 M2: /post-job metadata', () => {
    it('offers the promo while it runs, exactly as the static metadata did', async () => {
        const metadata = await postJobMetadata();
        expect(metadata.description).toBe(
            `Post your ${brand.niche.short} job opening for free through ${config.promoEndsLabel}, with every feature included. From ${config.ladderStartsLabel}: $${config.introPrice} for your first post, $${config.postingPrice} for every post after that, or $${config.planPrice}/month for ${config.planSlots} active jobs. Every listing includes email alerts to subscribed candidates.`,
        );
    });

    it('states the ladder once the promo has ended, and keeps the robots gate and canonical in both phases', async () => {
        const before = await postJobMetadata();
        vi.setSystemTime(LADDER_LIVE);
        const after = await postJobMetadata();
        expect(after.description).toBe(
            `Post your ${brand.niche.short} job opening, with every feature included. ${LADDER_PRICES} Every listing includes email alerts to subscribed candidates.`,
        );
        expectLadderOnly(String(after.description), '/post-job description');
        for (const metadata of [before, after]) {
            expect(metadata.title).toBe('Post a Job');
            expect(metadata.robots).toEqual({ index: false, follow: true });
            expect(metadata.alternates).toEqual({ canonical: `${brand.baseUrl}/post-job` });
        }
    });
});

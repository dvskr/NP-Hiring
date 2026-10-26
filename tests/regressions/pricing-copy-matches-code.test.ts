/**
 * Pricing copy says what the code does (pricing-copy package, 2026-09-27).
 *
 * Two claims had shipped on /pricing, /faq, /for-employers, /terms and the
 * cost-per-hire calculator that the code never backed:
 *
 *   1. "Employer plan: 5 active job slots, live while you're subscribed" and
 *      "plan posts stay live while your plan is active, so they don't need
 *      renewing". In the code every post, plan included, gets the same fixed
 *      expiresAt = now + config.durationDays (POST /api/jobs/post-free),
 *      nothing extends a plan post, the renewal checkout answers 409 for one,
 *      and pausePlanPosts takes plan posts down when the plan lapses.
 *   2. "Renewing ... refreshes its 25 unlocks and 25 InMails". No renewal
 *      path resets either counter: lib/tier-limits.ts counts unlocks by
 *      ProfileView.employerJobId and InMails by conversations since the
 *      posting was created, and apply-renewal.ts only moves the end date.
 *
 * 2027 re-price (owner decision 2026-10-24): the Employer plan is retired.
 * No surface offers it any more, and its code was deleted in phase 4
 * (2026-10-27); its own block now pins what that leaves: a legacy plan row
 * is still refused a renewal and a republish, and no page links a plan
 * route. A renewal now has two prices (lib/renewal-price.ts), which
 * lib/pricing-copy.ts#RENEWAL_LINE names on every surface that states both.
 *
 * The first block pins the code facts, so a behaviour change fails here and
 * forces the copy to be re-checked. The rest pins the copy: the banned claims
 * stay gone from every surface's VISIBLE text (comments may explain them),
 * no surface types a price config holds, and the renewal answers, which also
 * feed the FAQPage JSON-LD, render the real lifecycle with the real config
 * values.
 *
 * Since backlog 2.1 the promo-clock copy of /pricing, /for-employers and /faq
 * is built per render by a sibling module of each page, so the copy pins
 * call those builders on both sides of config.promoEndsAt.
 * tests/regressions/pricing-pages-phase-switch.test.ts covers the switch.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { config } from '@/lib/config';
import { RENEWAL_LINE } from '@/lib/pricing-copy';
import { renewalRungFor } from '@/lib/renewal-price';
import {
    RENEWAL_CAP_LINE,
    RENEWAL_EFFECT_LINE,
    pricingPageCopy,
} from '@/app/pricing/pricing-page-copy';
import { forEmployersCopy } from '@/app/for-employers/for-employers-copy';
import { employerPricingFaqs } from '@/app/faq/faq-employer-copy';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The text of `src` from the first `start` to the next `end` after it. */
function between(src: string, start: string, end: string): string {
    const from = src.indexOf(start);
    expect(from, start).toBeGreaterThan(-1);
    const to = src.indexOf(end, from);
    expect(to, end).toBeGreaterThan(from);
    return src.slice(from, to);
}

/** The last promo day and the switch instant: every copy pin runs in both phases. */
const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const PHASES = [['promo', DURING_PROMO], ['ladder', LADDER_START]] as const;

/** Every string a visitor can see in a TS or TSX source: JSX text, string literals, template pieces. */
function visibleText(rel: string): string {
    const src = read(rel);
    const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind);
    const out: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
        if (ts.isJsxText(node)) {
            out.push(node.text.replace(/\s+/g, ' '));
        } else if (
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
        ) {
            out.push(node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out.join('\n');
}

const PRICING = 'app/pricing/page.tsx';
const FAQ = 'app/faq/page.tsx';
const EMPLOYERS = 'app/for-employers/page.tsx';
const TERMS = 'app/terms/page.tsx';
const SURFACES = [
    PRICING,
    'app/pricing/pricing-page-copy.ts',
    FAQ,
    'app/faq/faq-employer-copy.ts',
    EMPLOYERS,
    'app/for-employers/for-employers-copy.ts',
    TERMS,
    'lib/pricing-copy.ts',
    'app/tools/cost-per-hire-calculator/page.tsx',
    'app/tools/cost-per-hire-calculator/cost-per-hire-copy.ts',
    'components/tools/EmployerCostPerHireCalculator.tsx',
    'components/tools/cost-per-hire-model.ts',
] as const;

/**
 * The other sources that state our prices: the comparison table, the
 * comparison pages, the /post-job metadata and the checkout trust rail.
 */
const OTHER_PRICE_SURFACES = [
    'lib/employer-comparison.ts',
    'lib/compare-data.ts',
    'app/post-job/layout.tsx',
    'app/post-job/checkout/layout.tsx',
] as const;

describe('the code facts the pricing copy rests on', () => {
    it('gives every post the same fixed config.durationDays expiry', () => {
        const postFree = read('app/api/jobs/post-free/route.ts');
        expect(postFree).toContain('const expiresAt = expiresFromNow(config.durationDays, now);');
        // One expiry for every mode: nothing branches it on the posting mode.
        expect(postFree.match(/expiresFromNow\(/g)).toHaveLength(1);
        // Line-ending agnostic: a Windows checkout reads CRLF.
        expect(postFree).toMatch(/^\s*expiresAt,\s*$/m);
    });

    it('renews by moving the end date only, never by resetting unlocks or InMails', () => {
        const apply = read('app/api/webhooks/stripe/apply-renewal.ts');
        expect(apply).toContain('expiresAt: newExpiresAt,');
        // Neither counter's source is touched, and the posting keeps its createdAt.
        expect(apply).not.toMatch(/profileView|conversation\./);
        expect(apply).not.toMatch(/createdAt:\s*(new Date|now\b)/);
        const limits = read('lib/tier-limits.ts');
        // Unlocks: per posting row. InMails: per job since the posting row was created.
        expect(limits).toMatch(/profileView\.count\(\{\s*where: \{ employerJobId \}/);
        expect(limits).toMatch(/createdAt: \{ gte: postingCreatedAt \}/);
    });

    it('prices a renewal by rung: the dearer price only for a post bought at the posting price', () => {
        // RENEWAL_LINE's two figures, and which post pays which.
        expect(renewalRungFor({ pricingTier: 'pro', hasNewPostCharge: true })).toBe('pro');
        for (const row of [
            { pricingTier: 'pro', hasNewPostCharge: false }, // a promo post, renewed or not
            { pricingTier: 'intro', hasNewPostCharge: true },
            { pricingTier: 'pro', hasNewPostCharge: false }, // a legacy paid row with no charge
        ]) {
            expect(renewalRungFor(row), JSON.stringify(row)).toBe('base');
        }
        expect(config.renewalPriceDollarsFor('pro')).toBe(config.proRenewalPrice);
        expect(config.renewalPriceDollarsFor('base')).toBe(config.renewalPrice);
        expect(config.proRenewalPrice).toBeGreaterThan(config.renewalPrice);
        // The checkout charges the rung's price, not one flat amount.
        expect(read('app/api/create-renewal-checkout/route.ts')).toContain('unit_amount: config.renewalPriceCentsFor(renewalRung),');
    });
});

/**
 * The retired Employer plan's code was deleted in phase 4 of the 2027
 * re-price. No copy describes it; these pin what is left for a legacy plan
 * row, and that nothing links the deleted routes.
 */
describe('the retired Employer plan: what deleting its code leaves', () => {
    it('refuses to renew a legacy plan post', () => {
        const renewal = read('app/api/create-renewal-checkout/route.ts');
        expect(renewal).toMatch(/paymentStatus === 'plan'\)\s*\{\s*return NextResponse\.json\([\s\S]*?status: 409/);
    });

    it('refuses to republish one: toggle-publish answers 402 to every status it does not list', () => {
        const toggle = read('app/api/employer/jobs/[jobId]/toggle-publish/route.ts');
        const statuses = /DIRECTLY_REPUBLISHABLE_STATUSES: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/.exec(toggle);
        expect(statuses, 'the republishable status set').not.toBeNull();
        expect(statuses![1]).not.toContain("'plan'");
        expect(toggle).toMatch(/willPublish && !DIRECTLY_REPUBLISHABLE_STATUSES\.has\(ps\)[\s\S]*?status: 402/);
    });

    it('the plan, subscribe and Customer Portal routes are gone, and no page links them', () => {
        for (const rel of ['app/api/employer/plan/route.ts', 'app/api/employer/plan/subscribe/route.ts', 'app/api/employer/billing-portal/route.ts', 'lib/employer-plan.ts', 'lib/employer-plan-link.ts']) {
            expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(false);
        }
        for (const rel of [PRICING, 'components/employer/UsageWidget.tsx', 'components/employer/EmployerDashboardClient.tsx']) {
            expect(read(rel), rel).not.toMatch(/\/api\/employer\/(?:billing-portal|plan)\b/);
        }
    });
});

describe('no pricing surface repeats a claim the code does not back', () => {
    const BANNED: readonly [RegExp, string][] = [
        [/Employer plan/i, 'the Employer plan is retired (owner decision 2026-10-24): no surface offers it'],
        [/\/month\b|per month|billed month/i, 'nothing is sold by the month'],
        [/\bslots?\b/i, 'there are no plan slots to sell'],
        [/live while (you're|you are) subscribed/i, 'a plan post runs config.durationDays, not the whole subscription'],
        [/(stay|stays|remain|remains) (live|up|visible) while (the|your) (Employer )?plan/i, 'a plan post runs config.durationDays, not the whole plan'],
        [/\bruns? (its|their) full\b/i, 'a plan post comes down early when its plan lapses (pausePlanPosts)'],
        [/need(s)? renewing|do not need a renewal/i, 'plan posts are reposted into a slot, not exempt from ending'],
        [/back into (its|a|the|their) (free |freed )?slot/i, 'nothing reposts a plan post: the employer posts the role again into the freed slot'],
        [/renew(ing)? any post/i, 'plan posts cannot be renewed'],
        [/refresh(es)? its|new bucket of/i, 'a renewal does not add unlocks or InMails'],
        [/back to the top/i, 'the renewal sort effect is one isFeatured flag, not a return to the top'],
        [/\bforever\b|\bindefinitely\b/i, 'unlocked profiles stay available only while the candidate keeps them visible'],
        [/#1\b/, 'unmeasured ranking'],
    ];

    it.each(SURFACES)('%s', (rel) => {
        const text = visibleText(rel);
        const found = BANNED.filter(([pattern]) => pattern.test(text)).map(([pattern, why]) => `${pattern}: ${why}`);
        expect(found, found.join('\n')).toEqual([]);
    });

    it('scans every sibling module a scanned page builds its copy in', () => {
        // A Next.js page may export only Next's own names, so since backlog 2.1
        // a page's copy builder sits in a sibling module, and the scan has to
        // follow the copy there. The cost-per-hire page's method notes and FAQ
        // (which also feed its FAQPage JSON-LD) moved into
        // ./cost-per-hire-copy.ts while this list still named only the page.
        const scanned = new Set<string>(SURFACES);
        const pages = SURFACES.filter((rel) => rel.endsWith('/page.tsx'));
        expect(pages.length).toBeGreaterThanOrEqual(5);
        for (const page of pages) {
            const dir = path.posix.dirname(page);
            const siblings = [...read(page).matchAll(/from '\.\/([^']+)'/g)].map((match) => `${dir}/${match[1]}`);
            for (const sibling of siblings) {
                const file = [`${sibling}.ts`, `${sibling}.tsx`].find((candidate) => fs.existsSync(path.join(ROOT, candidate)));
                expect(file, `${page} imports ${sibling}, which is not a source file`).toBeDefined();
                expect(scanned.has(file as string), `${page} builds copy in ${file}, which the banned-claims scan does not read`).toBe(true);
            }
        }
    });

    it('the banned list catches the plan claims and the reworded ones the listing cards used to carry', () => {
        const retired = [
            'The Employer plan is $399/month.',
            '5 active job slots while you\'re subscribed.',
            'Every slot is a full Featured post',
            'Plan posts stay up while your plan is active.',
            'plan posts stay up while your plan is active.',
            'Plan posts remain visible while the Employer plan is active.',
            'Every post runs its full 60 days with no daily budget and no bidding.',
            'plan posts are never renewed, because each runs 60 days and the role then goes back into its slot at no extra charge',
        ];
        for (const line of retired) {
            expect(BANNED.some(([pattern]) => pattern.test(line)), line).toBe(true);
        }
    });
});

/**
 * A price on a pricing surface is a config token, never a typed figure: a
 * literal goes stale the day config changes, as the $179 renewal and the $199
 * and $299 posts did in the 2027 re-price. Built from config, so the guard
 * follows the prices it protects.
 */
describe('no pricing surface types a price that config holds', () => {
    // The two post prices, the two renewal prices, the 5-post pack and the
    // pack's one comparison figure (five posts at the posting price).
    const PRICES = [...new Set([
        config.introPrice, config.postingPrice, config.renewalPrice, config.proRenewalPrice,
        config.packPrice, config.postingPrice * config.packPosts,
    ])];
    // Each figure as digits and as copy prints it ($1,245), never followed by
    // more digits ($349,000 is a salary, not the posting price).
    const SPELLINGS = [...new Set(PRICES.flatMap((price) => [String(price), config.formatDollars(price).slice(1)]))];
    const PRICE_LITERAL = new RegExp(`\\$(?:${SPELLINGS.join('|')})(?!\\d|,\\d)`);

    it('the guard is built from the current config prices, and catches each of them', () => {
        expect(PRICES).toEqual(expect.arrayContaining([config.introPrice, config.postingPrice, config.renewalPrice, config.proRenewalPrice, config.packPrice]));
        for (const price of PRICES) {
            expect(PRICE_LITERAL.test(`for $${price}.`), String(price)).toBe(true);
            expect(PRICE_LITERAL.test(`for ${config.formatDollars(price)}, then`), config.formatDollars(price)).toBe(true);
        }
        // A larger figure that happens to start with a price is not one.
        expect(PRICE_LITERAL.test(`$${config.postingPrice},000`)).toBe(false);
    });

    it.each([...SURFACES, ...OTHER_PRICE_SURFACES])('%s', (rel) => {
        const match = PRICE_LITERAL.exec(visibleText(rel));
        expect(match?.[0], `${rel} types a price: print the config token instead`).toBeUndefined();
    });
});

describe('the listing cards state the run every post gets', () => {
    it.each(PHASES)('/pricing (%s): every post runs durationDays, and nothing names a plan post', (_phase, now) => {
        const run = pricingPageCopy(now).listingRun;
        expect(run.startsWith(`Every post runs ${config.durationDays} days with no daily budget and no bidding`)).toBe(true);
        expect(run).not.toMatch(/\bplan\b/i);
        // The listing card prints the builder's sentence for the render clock.
        expect(read(PRICING)).toContain('{copy.listingRun}');
    });

    it.each(PHASES)('/for-employers (%s): the same run for every job', (_phase, now) => {
        const run = forEmployersCopy(now).listingRun;
        expect(run.startsWith(`Every job runs ${config.durationDays} days with no daily budget and no bidding.`)).toBe(true);
        expect(run).not.toMatch(/\bplan\b/i);
        expect(read(EMPLOYERS)).toContain('{copy.listingRun}');
    });

    it('names promo posts in the run only while the promo runs', () => {
        expect(pricingPageCopy(DURING_PROMO).listingRun).toBe(
            `Every post runs ${config.durationDays} days with no daily budget and no bidding, promo posts included.`,
        );
        expect(forEmployersCopy(DURING_PROMO).listingRun).toBe(
            `Every job runs ${config.durationDays} days with no daily budget and no bidding. Promo posts get the same run and the same features.`,
        );
        expect(pricingPageCopy(LADDER_START).listingRun).not.toMatch(/promo/i);
        expect(forEmployersCopy(LADDER_START).listingRun).not.toMatch(/promo/i);
    });
});

describe('the pricing FAQs (they also feed the FAQPage JSON-LD) answer no plan question, in both phases', () => {
    it.each(PHASES)('/pricing (%s)', (_phase, now) => {
        const questions = pricingPageCopy(now).pricingFaqs.map((f) => f.q);
        expect(questions).not.toContain('How does the Employer plan work?');
        const src = read(PRICING);
        // JSON-LD republishes the same array the accordion renders.
        expect(src).toMatch(/mainEntity: faqs\.map/);
        expect(src).toContain('const faqs = [...copy.pricingFaqs, ...EVERGREEN_FAQS];');
        // The volume question no longer counts plan slots.
        expect(src).not.toContain('config.planSlots');
    });

    it.each(PHASES)('/faq (%s)', (_phase, now) => {
        expect(employerPricingFaqs(now).map((f) => f.question)).not.toContain('How does the Employer plan work?');
        expect(read(FAQ)).toMatch(/mainEntity: \[\.\.\.jobSeekerFaqs, \.\.\.employerFaqs/);
        expect(read(FAQ)).toContain('...employerPricingFaqs(new Date()),');
    });

    it.each(PHASES)('/for-employers (%s)', (_phase, now) => {
        expect(forEmployersCopy(now).pricingFaqs.map((f) => f.q)).not.toContain('How does the Employer plan work?');
        expect(read(EMPLOYERS)).toMatch(/mainEntity: employerFaqs\.map/);
        expect(read(EMPLOYERS)).toContain('const employerFaqs = [...copy.pricingFaqs, ...EVERGREEN_FAQS];');
        expect(read(EMPLOYERS)).not.toContain('config.planSlots');
    });
});

describe('the renewal answers say what a renewal does, and nothing more', () => {
    it('one shared sentence names both renewal prices, each by the post it renews', () => {
        expect(RENEWAL_LINE).toBe(
            `Renewals add ${config.durationDays} days: $${config.renewalPrice} for a promo, intro or pack post, $${config.proRenewalPrice} for a $${config.postingPrice} post.`,
        );
        // The pages that state both prices print it, never a copy of their own.
        const importsShared = /import \{[^}]*\bRENEWAL_LINE\b[^}]*\} from '@\/lib\/pricing-copy'/;
        for (const rel of [PRICING, 'app/pricing/pricing-page-copy.ts', FAQ, EMPLOYERS, 'app/for-employers/for-employers-copy.ts']) {
            expect(read(rel), rel).toMatch(importsShared);
            expect(read(rel), rel).not.toContain('$${config.renewalPrice}');
            expect(read(rel), rel).not.toContain('${config.renewalPrice}');
        }
    });

    it('/pricing: +durationDays, no new unlocks or InMails, the cap stated', () => {
        expect(RENEWAL_EFFECT_LINE).toContain(`A renewal adds ${config.durationDays} days to the post`);
        expect(RENEWAL_EFFECT_LINE).toContain('It does not add unlocks or InMails');
        expect(RENEWAL_CAP_LINE).toBe(
            `Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.`,
        );
        const src = read(PRICING);
        const answer = src.match(/q: 'What does renewal cost\?', a: `([^`]*)`/);
        expect(answer).not.toBeNull();
        const template = (answer as RegExpMatchArray)[1];
        expect(template).toBe('${RENEWAL_LINE} ${RENEWAL_EFFECT_LINE}');
    });

    it('/faq: renewal gives more days, not more unlocks, and states the cap', () => {
        const src = read(FAQ);
        expect(src).toContain('Every posting is active for ${config.durationDays} days. ${RENEWAL_LINE} Renew from the employer dashboard. A renewal does not add unlocks or InMails.');
        expect(src).toContain('Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.');
    });

    it('/for-employers: the pricing card prints the shared sentence', () => {
        expect(read(EMPLOYERS)).toContain('{RENEWAL_LINE} No hidden fees.');
    });
});

describe('/terms states the same rules as the marketing pages', () => {
    const terms = read(TERMS);

    it('names no Employer plan anywhere a visitor can read it', () => {
        expect(visibleText(TERMS)).not.toMatch(/Employer plan|plan slots?|monthly billing|month-to-month|\/month/i);
        expect(terms).not.toContain('config.planPrice');
        expect(terms).not.toContain('config.planSlots');
    });

    it('states both renewal prices from config, each by the posting it renews, pack postings at the base price', () => {
        expect(terms).toContain(
            'Renewals are ${config.renewalPrice} USD for promotional, intro and pack postings and ${config.proRenewalPrice} USD for postings purchased at ${config.postingPrice}, one-time, and add {config.durationDays} days as described in §6',
        );
    });

    it('§6 and §7 state the 5-post pack as the code sells and spends it, from config', () => {
        const pricingSection = between(terms, 'id="pricing-and-payments"', 'id="refund-policy"');
        // §6: a pack posting runs and renews like any other.
        expect(terms).toContain('All job postings, whether promotional, paid or published with a 5-post pack credit, are active for {config.durationDays} days');
        expect(terms).toContain('Employers may renew promotional, paid and pack postings through the employer dashboard.');
        // §7: price, credits, 12 months, the buying account, the intro price, the sale window.
        expect(terms).toContain('A 5-post pack is {config.formatDollars(config.packPrice)} USD, one-time, for {config.packPosts} posting credits');
        expect(terms).toContain('Pack credits may be used within {config.packValidityMonths} months of purchase');
        expect(terms).toContain('belong to the employer account that bought the pack');
        expect(terms).toContain('A pack bought through checkout counts as your organization&apos;s first paid purchase');
        expect(terms).toContain('Packs are sold from {config.ladderStartsLabel}');
        // The pack's terms name no saving.
        expect(pricingSection).not.toMatch(/\bsav(?:e|es|ing|ings)\b|\$500/i);
    });

    it('§8: all sales are final, with only the two exceptions the owner kept (2026-10-25)', () => {
        const refundSection = between(terms, 'id="refund-policy"', 'id="candidate-data"');
        // The rule, with the removed-posting line folded into it.
        expect(refundSection).toContain('All sales are final. Fees for job postings, renewals and 5-post packs are non-refundable');
        expect(refundSection).toContain('including pack credits left unused when the pack expires');
        expect(refundSection).toContain('If we remove a posting for violation of these Terms, no refund will be issued.');
        expect(refundSection).toContain('Promotional postings have no associated payment and are therefore not refundable');
        // The two exceptions: a refund the law requires, and a billing error corrected.
        expect(refundSection).toContain('where applicable law requires one');
        expect(refundSection).toContain('a billing error, such as being charged twice for the same posting');
        // Gone: the 7-day case-by-case requests, the discretion line and the "if granted" line.
        expect(refundSection).not.toMatch(/7 days|case-by-case|case by case|sole discretion|generally non-refundable|if granted/i);
    });

    it('renewal adds days only, from the right base, within the cap', () => {
        expect(terms).toContain('or to the renewal date if the posting has already expired');
        expect(terms).toContain('Renewals cannot extend a posting beyond {config.renewalCapDays} days after it was first published.');
        expect(terms).toContain('it does not add candidate unlocks or InMails');
        expect(terms).not.toMatch(/whether promotional, paid, renewed, or posted from a plan slot/);
    });

    it('unlocked candidate access is conditioned on the candidate staying visible', () => {
        expect(terms).toContain('for as long as the candidate keeps their profile visible and open to opportunities');
    });

    it('the metadata makes no ranking claim', () => {
        const description = terms.match(/description: `([^`]*)`/);
        expect(description).not.toBeNull();
        expect((description as RegExpMatchArray)[1]).not.toMatch(/#1|number one|leading/i);
    });
});

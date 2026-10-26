/**
 * docs/pricing-system.md says what the pricing code does, and the owner acts
 * on it: which env vars to set and in what order, what an alert means, what
 * to tell a buyer whose plan did not attach. A review of the 2026-10-01
 * release found it wrong in places the code had moved past (backlog fix
 * round 1, area DOCS):
 *   - it said plan sales stay closed until the Stripe key is set, although
 *     isPlanSaleOpen never reads the key, so the flag and the Payment Link
 *     alone sell a plan the webhook cannot record;
 *   - it documented the plan checkout as matching the buyer by email, which
 *     the webhook refuses to do: only the account reference attaches a plan;
 *   - it told the operator to refund $100 after two intro checkouts, when
 *     the domain had paid $100 less, not more;
 *   - it listed as missing the test suites that cover the money paths;
 *   - it named a function, an env var, a file and a link that do not exist,
 *     and schema blocks, a status map and a response shape that had drifted.
 *
 * Nothing fails when a document goes stale, so every check here reads the
 * code first (a set, a map, a response shape, a function name, a source
 * order) and then looks for that fact in the document. Where a statement
 * has no code form (how a cached page is served), the sentence is pinned.
 *
 * When a check fails after a code change, the document is what to fix, in
 * the same change. The plan-sale check is a ratchet in both directions: it
 * also fails when the code starts reading the key and the warning stays.
 *
 * 2027 re-price, Phase 1 (owner decision 2026-10-24): $249 first post, $349
 * after, a renewal priced by the post it renews ($199, or $249 for a post
 * bought at $349), and the Employer plan retired from every surface.
 *
 * Phase 3 (owner decisions 2026-10-25): the 5-post pack's pages and copy,
 * and all sales final. Section 1c quotes the pack sentences and the refund
 * answer with their config tokens, and the money-path list names the pack's
 * purchase, credit and admin suites.
 *
 * Phase 4 (2026-10-27): the plan's dormant code is deleted. Sections 2e, 2f
 * and the section 12 diagram are short history notes; 2e describes the guard
 * the webhook keeps (a subscription-mode session alerted for a refund), 9b
 * the 7 events and the key permissions that are left, and 11 the deprecated
 * table that stays.
 */
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { config } from '@/lib/config';
import { PROMO_SWITCH_PATHS } from '@/app/api/sitemaps/lastmod';
import { pricingPageCopy } from '@/app/pricing/pricing-page-copy';
import { forEmployersCopy } from '@/app/for-employers/for-employers-copy';
import { LADDER_PRICES, PACK_COMPARISON, PACK_OFFER, REFUND_ANSWER, RENEWAL_LINE, packPriceLine } from '@/lib/pricing-copy';
import { between, existsInRepo, isSource, lineWith, readRepo, repoPathsNamed, walk, withoutComments } from '../support/docs-vs-code';

const DOC = 'docs/pricing-system.md';
const doc = readRepo(DOC);
const pending = readRepo('docs/PENDING_WORK.md');

const section1b = between(doc, '### 1b. Ladder', '### 1c. Helpers');
const section1c = between(doc, '### 1c. Helpers', '### 1d. What happens');
const section1d = between(doc, '### 1d. What happens', '## 2. End-to-end flows');
const section2a = between(doc, '### 2a. Promo post', '### 2b. Plan post');
const section2c = between(doc, '### 2c. Intro / Featured checkout', '### 2d. Renewal');
const section2d = between(doc, '### 2d. Renewal', '### 2e. Employer plan');
const section2e = between(doc, '### 2e. Employer plan', '### 2f. Plan-lapse job');
const section2f = between(doc, '### 2f. Plan-lapse job', '### 2g. Expiry');
const section2g = between(doc, '### 2g. Expiry', '### 2h. 5-post pack');
const section3a = between(doc, '### 3a. Source-of-truth files', '### 3b. API routes');
const section3b = between(doc, '### 3b. API routes', '### 3c. UI surfaces');
const section3c = between(doc, '### 3c. UI surfaces', '## 4. Database schema');
const section4 = between(doc, '## 4. Database schema', '## 5. Feature inventory');
const section8 = between(doc, '## 8. Known open loopholes', '### Loopholes considered');
const section9a = between(doc, '### 9a. Production migrations', '### 9b. Production Stripe checklist');
const section9b = between(doc, '### 9b. Production Stripe checklist', '### 9c. Things to monitor');
const section9c = between(doc, '### 9c. Things to monitor', '### 9d. Operational rules');
const section10 = between(doc, '## 10. Test coverage', '## 11. Future-state items');
const section11 = between(doc, '## 11. Future-state items', '## 12. Quick-reference flow diagrams');
const planDiagram = between(doc, '### Employer plan\n', '## Appendix: glossary');
const glossary = between(doc, '## Appendix: glossary');

const PROMO_RUNNING = new Date('2026-12-01T12:00:00.000Z');
const LADDER_LIVE = new Date(Date.parse(config.promoEndsAt) + 60 * 60 * 1000);

describe('docs/pricing-system.md: every link, path and name it gives exists', () => {
    it('every relative link points at a file in the repo', () => {
        const targets = [...doc.matchAll(/\]\((\.{1,2}\/[^)\s#]+)(?:#[^)]*)?\)/g)].map((match) => match[1]);
        expect(targets.length).toBeGreaterThan(20);
        const broken = targets.filter((target) => !existsInRepo(path.posix.join('docs', decodeURIComponent(target))));
        expect(broken, 'links that resolve to no file').toEqual([]);
    });

    it('names no repo file that does not exist', () => {
        const named = repoPathsNamed(doc);
        expect(named.length).toBeGreaterThan(40);
        expect(named.filter((file) => !existsInRepo(file)), 'paths named in the document that are not in the repo').toEqual([]);
    });

    it('every Stripe key, secret and link variable it names is one lib/env.ts declares', () => {
        const declared = new Set([...readRepo('lib/env.ts').matchAll(/^\s+([A-Z][A-Z0-9_]+): z\./gm)].map((match) => match[1]));
        expect(declared.has('STRIPE_SECRET_KEY')).toBe(true);
        const named = [...new Set([...doc.matchAll(/\b((?:NEXT_PUBLIC_)?STRIPE_[A-Z_]*(?:KEY|SECRET|LINK))\b/g)].map((match) => match[1]))];
        // The secret key, the webhook secret and the publishable key (the plan's
        // Payment Link variable went with the plan code, 2026-10-27).
        expect(named.length).toBeGreaterThanOrEqual(3);
        expect(named.filter((name) => !declared.has(name)), 'variables nothing reads').toEqual([]);
    });
});

/**
 * A sentence as the document writes it, with its config tokens, evaluated
 * against config: the document quotes the template, the page prints the
 * result, and the two must be the same sentence.
 */
const TOKENS = {
    config,
    durationDays: config.durationDays,
    introPrice: config.introPrice,
    postingPrice: config.postingPrice,
    renewalPrice: config.renewalPrice,
    proRenewalPrice: config.proRenewalPrice,
    packPosts: config.packPosts,
    packPrice: config.packPrice,
    formatDollars: config.formatDollars,
};
const evaluated = (template: string): string =>
    new Function(...Object.keys(TOKENS), `return \`${template}\`;`)(...Object.values(TOKENS)) as string;

describe('section 1: the copy and the switch at config.promoEndsAt', () => {
    it('1b prices the ladder and both renewals from config, and marks the Employer plan retired', () => {
        expect(lineWith(section1b, '| Intro post |')).toContain(`$${config.introPrice} (\`config.introPrice\` / \`stripeIntroPriceInCents\` ${config.stripeIntroPriceInCents})`);
        expect(lineWith(section1b, '| Featured post |')).toContain(`$${config.postingPrice} (\`config.postingPrice\` / \`stripePriceInCents\` ${config.stripePriceInCents})`);
        const renewal = lineWith(section1b, '| Renewal |');
        expect(renewal).toContain(`$${config.renewalPrice} (\`config.renewalPrice\` / \`stripeRenewalPriceInCents\` ${config.stripeRenewalPriceInCents})`);
        expect(renewal).toContain(`$${config.proRenewalPrice} (\`config.proRenewalPrice\` / \`stripeProRenewalPriceInCents\` ${config.stripeProRenewalPriceInCents})`);
        expect(renewal).toContain('lib/renewal-price.ts');
        // The plan has no row on sale: it is recorded as retired.
        expect(section1b).not.toMatch(/^\| Employer plan \|/m);
        expect(section1b).toMatch(/Employer plan: retired/i);
    });

    it('1c quotes the listing-card sentence each page builder prints, in both phases', () => {
        // The document writes the sentence with its config token, not the number.
        const asWritten = (text: string): string => text.split(String(config.durationDays)).join('${durationDays}');
        const lead = (sentence: string): string => asWritten(sentence.slice(0, sentence.indexOf('bidding') + 'bidding'.length));
        for (const now of [PROMO_RUNNING, LADDER_LIVE]) {
            const pricing = pricingPageCopy(now).listingRun;
            const employers = forEmployersCopy(now).listingRun;
            expect(lead(pricing)).toMatch(/^Every post runs/);
            expect(lead(employers)).toMatch(/^Every job runs/);
            expect(section1c).toContain(lead(pricing));
            expect(section1c).toContain(lead(employers));
            // Neither card names a plan post: the plan is retired.
            expect(pricing).not.toMatch(/\bplan\b/i);
            expect(employers).not.toMatch(/\bplan\b/i);
        }
        expect(section1c).not.toContain('come down sooner only if the plan ends');
    });

    it('1c quotes the ladder and the renewal sentence the pages print, with their config tokens', () => {
        const ladder = '`Your first post is $${introPrice}, every post after that is $${postingPrice}, or buy ${packPosts} posts for ${formatDollars(packPrice)}.`';
        const renewal = '`Renewals add ${durationDays} days: $${renewalPrice} for a promo, intro or pack post, $${proRenewalPrice} for a $${postingPrice} post.`';
        expect(section1c).toContain(ladder);
        expect(section1c).toContain(renewal);
        expect(evaluated(ladder.slice(1, -1))).toBe(LADDER_PRICES);
        expect(evaluated(renewal.slice(1, -1))).toBe(RENEWAL_LINE);
        // No plan sentence is quoted as copy any more.
        expect(section1c).not.toContain('`${planSlots} active job slots');
        expect(section1c).not.toMatch(/`planPriceLine\(now\)`:/);
    });

    it('1c quotes the 5-post pack sentences and the refund answer the pages print, in both phases', () => {
        const pricePromo = '`From ${config.ladderStartsLabel}, a ${packPosts}-post pack is ${formatDollars(packPrice)}.`';
        const priceLadder = '`A ${packPosts}-post pack is ${formatDollars(packPrice)}.`';
        const offer = '`${packPosts} posts for ${formatDollars(packPrice)}, ${formatDollars(packPrice / packPosts)} a post`';
        const comparison = '`Bought one at a time at $${postingPrice}, five posts cost ${formatDollars(postingPrice * packPosts)}.`';
        for (const template of [pricePromo, priceLadder, offer, comparison]) expect(section1c, template).toContain(template);
        expect(evaluated(pricePromo.slice(1, -1))).toBe(packPriceLine(PROMO_RUNNING));
        expect(evaluated(priceLadder.slice(1, -1))).toBe(packPriceLine(LADDER_LIVE));
        expect(evaluated(offer.slice(1, -1))).toBe(PACK_OFFER);
        expect(evaluated(comparison.slice(1, -1))).toBe(PACK_COMPARISON);
        // The refund answer is quoted with its one token.
        const refund = `\`${REFUND_ANSWER.split(`${config.packPosts}-post packs`).join('${packPosts}-post packs')}\``;
        expect(section1c).toContain(refund);
        expect(evaluated(refund.slice(1, -1))).toBe(REFUND_ANSWER);
    });

    it('1d says the first request after a cached page expires is still served the old render', () => {
        // Time-based revalidation is stale-while-revalidate: the request that
        // finds the window closed gets the cached page and only triggers the
        // re-render. Left out, the owner opens /pricing an hour after the
        // switch, sees the promo and concludes the switch failed.
        const copyBullet = lineWith(section1d, '**Copy, on every phase-aware surface**');
        expect(copyBullet).toMatch(/first request after that is still answered with that render/);
        expect(copyBullet).toMatch(/every later request gets the ladder/);
    });

    it('1d names every page in PROMO_SWITCH_PATHS as one whose lastmod moves, and no page that left the set', () => {
        // The bullet names the employer resources pages in words, so each
        // path is looked up by the name the bullet gives it.
        const NAMED_AS: Readonly<Record<string, string>> = {
            '/pricing': '/pricing',
            '/for-employers': '/for-employers',
            '/faq': '/faq',
            '/for-employers/resources': 'the employer resources hub',
            '/for-employers/resources/how-to-hire': 'hiring guide',
            '/for-employers/resources/job-description-guide': 'job description guide',
            '/for-employers/resources/job-description-templates': 'template library',
            '/for-employers/resources/job-description-templates/[id]': 'template pages',
            '/tools/salary-benchmark': '/tools/salary-benchmark',
            '/tools/cost-per-hire-calculator': '/tools/cost-per-hire-calculator',
            '/compare/np-hiring-vs-indeed': 'the three comparison pages',
            '/compare/np-hiring-vs-aanp-jobcenter': 'the three comparison pages',
            '/compare/np-hiring-vs-enp-network': 'the three comparison pages',
        };
        const bullet = lineWith(section1d, '**Sitemap lastmod:**');
        for (const switchPath of PROMO_SWITCH_PATHS) {
            const name = NAMED_AS[switchPath];
            expect(name, `${switchPath} joined PROMO_SWITCH_PATHS: name it in the section 1d lastmod bullet and in NAMED_AS`).toBeDefined();
            expect(bullet, switchPath).toContain(name);
        }
        expect(Object.keys(NAMED_AS).filter((named) => !PROMO_SWITCH_PATHS.has(named)), 'named in section 1d but no longer in PROMO_SWITCH_PATHS').toEqual([]);
    });
});

describe('section 1d: no plan sale can open, and no plan variable is named', () => {
    it('the plan Payment Link variable is gone from lib/env.ts, and section 1d says nothing reads it', () => {
        // The plan-sale ratchet (register 2.16) checked whether the plan sale
        // opened without the Stripe key; the sale and its variable are gone.
        expect(readRepo('lib/env.ts')).not.toMatch(/STRIPE_PLAN_\w+/);
        expect(doc).not.toMatch(/STRIPE_PLAN_\w+/);
        expect(pending).not.toMatch(/STRIPE_PLAN_\w+/);
        expect(lineWith(section1d, "**The retired plan's Payment Link variable**")).toMatch(/nothing reads it/);
        expect(lineWith(section1d, '`ENABLE_PAID_POSTING=true`')).not.toMatch(/plan sales open/);
    });
});

describe('section 2: the flows', () => {
    const postFree = withoutComments(readRepo('app/api/jobs/post-free/route.ts'));
    const activate = withoutComments(readRepo('app/api/webhooks/stripe/activate-paid-job.ts'));

    it('2a and 2c name the search engine ping the routes call', () => {
        const called = (src: string): string[] => [...new Set([...src.matchAll(/\b(ping[A-Z]\w*)\(/g)].map((match) => match[1]))];
        const named = (section: string): string[] => [...new Set([...section.matchAll(/\b(ping[A-Z]\w*)\b/g)].map((match) => match[1]))];
        expect(called(postFree).length).toBe(1);
        expect(named(section2a)).toEqual(called(postFree));
        expect(named(section2c)).toEqual(called(activate));
    });

    it('2c: the activation claims the row before it publishes, and never publishes an archived post', () => {
        const claim = activate.indexOf("paymentStatus: 'pending'");
        const publish = activate.indexOf('publishUnlessArchived(jobId)');
        expect(claim).toBeGreaterThan(-1);
        expect(publish).toBeGreaterThan(-1);
        const claimsFirst = claim < publish;

        const docClaim = section2c.indexOf("EmployerJob.update where paymentStatus='pending'");
        const docPublish = section2c.indexOf('Job.update (isPublished=true');
        expect(docClaim, 'the claim step').toBeGreaterThan(-1);
        expect(docPublish, 'the publish step').toBeGreaterThan(-1);
        expect(docClaim < docPublish).toBe(claimsFirst);

        // The publish matches only a row that is not archived.
        expect(activate).toMatch(/where: \{ id: jobId, archivedAt: null \}/);
        const publishStep = section2c.slice(docPublish, section2c.indexOf('JobCharge.create', docPublish));
        expect(publishStep).toMatch(/unless the post was archived while\s+[│ ]*its checkout was open/);
    });

    it('2d prices a renewal by the post it renews, from config, and ledgers what Stripe charged', () => {
        expect(section2d).toContain(`$${config.renewalPrice}`);
        expect(section2d).toContain(`$${config.proRenewalPrice}`);
        expect(section2d).toContain('config.renewalPriceCentsFor(renewalRung)');
        expect(section2d).toContain('metadata.renewalRung');
        const checkout = withoutComments(readRepo('app/api/create-renewal-checkout/route.ts'));
        expect(checkout).toContain('unit_amount: config.renewalPriceCentsFor(renewalRung),');
        const apply = withoutComments(readRepo('app/api/webhooks/stripe/apply-renewal.ts'));
        expect(apply).toContain('session.amount_total ?? config.renewalPriceCentsFor(asRenewalRung(session.metadata?.renewalRung))');
        // The one flat renewal amount is gone from the flow.
        expect(section2d).not.toMatch(/\$179|17900/);
    });

    it('2e, 2f, 3b, 3c and 12: the plan code is deleted, every plan route is gone, and the sections say so', () => {
        const pricingPage = withoutComments(readRepo('app/pricing/page.tsx'));
        expect(pricingPage, 'a page links the plan again: update 2e, 12 and this check').not.toContain('/api/employer/plan/subscribe');
        expect(pricingPage).not.toContain('isPlanSaleOpen');
        for (const deleted of [
            'lib/employer-plan.ts',
            'lib/employer-plan-link.ts',
            'app/api/employer/plan/route.ts',
            'app/api/employer/plan/subscribe/route.ts',
            'app/api/employer/billing-portal/route.ts',
            'app/api/webhooks/stripe/plan-checkout.ts',
            'app/api/webhooks/stripe/plan-subscription.ts',
            'lib/inngest/functions/plan-lapse.ts',
            'lib/inngest/functions/plan-reconciliation.ts',
            'app/api/admin/employer-plans/route.ts',
            'app/admin/employer-plans/page.tsx',
        ]) {
            expect(existsInRepo(deleted), deleted).toBe(false);
        }
        const inngest = withoutComments(readRepo('app/api/inngest/route.ts'));
        expect(inngest).not.toMatch(/planLapse|planReconciliation/);

        // 2e, 2f and the section 12 diagram are history notes now.
        for (const [name, section] of [['2e', section2e], ['2f', section2f], ['12', planDiagram]] as const) {
            expect(section, name).toMatch(/Retired 2026-10-24/);
            expect(section, name).toMatch(/deleted/);
        }
        // No route, page or admin row of the plan is listed as if it still ran.
        expect(section3b).not.toMatch(/`\/api\/employer\/plan|`\/api\/employer\/billing-portal`|`\/api\/admin\/employer-plans/);
        expect(section3c).not.toContain('/admin/employer-plans');
        // Nothing is described as dormant code that still runs.
        expect(doc).not.toMatch(/\(dormant\b|\bDormant[:(]|code stays, dormant/);
    });

    it('2e: a subscription-mode session is alerted for a refund and acknowledged, before the pack and per-post paths', () => {
        const route = withoutComments(readRepo('app/api/webhooks/stripe/route.ts'));
        const paid = between(route, 'async function handleCheckoutSessionPaid(', '\n}\n');
        const guard = paid.indexOf("if (session.mode === 'subscription')");
        expect(guard, 'the subscription-mode guard').toBeGreaterThan(-1);
        expect(guard).toBeLessThan(paid.indexOf('POST_PACK_CHECKOUT_TYPE'));
        expect(guard).toBeLessThan(paid.indexOf('session.metadata?.jobId'));
        expect(route).toContain("await alertWebhookFailure('Employer plan retired: refund it in Stripe'");
        expect(route).toContain("return NextResponse.json({ received: true, plan: 'retired' });");
        expect(route).not.toMatch(/subscriptions\.\w+\(/);

        expect(section2e).toContain("alertWebhookFailure('Employer plan retired: refund it in Stripe'");
        expect(section2e).toContain("200 { received: true, plan: 'retired' }");
        expect(section2e).toMatch(/checked FIRST, before the 5-post pack branch and the per-post paths/);
        // The operator is told what the alert means.
        expect(lineWith(section9c, 'Employer plan retired: refund it in Stripe')).toMatch(/refund the payment, cancel the subscription/i);
        // And the loophole table no longer lists the unattached plan checkout.
        expect(section8).not.toContain('Unattached plan checkout');
    });

    it('2b, 2d and 2g: a legacy plan row is refused a renewal and a republish, and offered a repost', () => {
        const renewal = withoutComments(readRepo('app/api/create-renewal-checkout/route.ts'));
        expect(renewal).toMatch(/paymentStatus === 'plan'\)\s*\{\s*return NextResponse\.json\([\s\S]*?status: 409/);
        const toggle = withoutComments(readRepo('app/api/employer/jobs/[jobId]/toggle-publish/route.ts'));
        expect(toggle).toContain("new Set(['paid', 'free', 'promo', 'pack'])");
        expect(toggle).not.toMatch(/republishPlanPost|'plan'/);

        expect(lineWith(section2d, "paymentStatus 'plan' (legacy)")).toMatch(/no Renew \(409/);
        expect(section2g).toMatch(/a legacy 'plan' row included/);
        expect(section2g).not.toMatch(/republishPlanPost|resumePlanPosts|freed slot for a plan post/);
    });

    it('4b and the glossary: the EmployerPlan model is kept, deprecated, and nothing reads or writes the table', () => {
        const schema = readRepo('prisma/schema.prisma');
        const comment = between(schema, '/// DEPRECATED. The Employer plan', 'model EmployerPlan {');
        expect(comment).toMatch(/nothing reads or writes this table/);
        const sources = [...walk('app', isSource), ...walk('lib', isSource), ...walk('components', isSource)];
        expect(sources.filter((file) => /\bemployerPlan\./.test(withoutComments(readRepo(file)))), 'a source reads or writes employer_plans again').toEqual([]);

        expect(lineWith(section4, '### 4b. EmployerPlan')).toMatch(/deprecated/);
        expect(section4).not.toContain('Entitled = ');
        expect(glossary).not.toContain('**Entitled plan**');
    });
});

describe('section 3: the surfaces that follow the promo clock', () => {
    const guideRoute = '/for-employers/resources/job-description-guide';

    it('3a lists every page that calls postJobCta as a user of it, and no other', () => {
        const importsBuilder = /from ['"](?:(?:\.{1,2}\/)+|@\/app\/for-employers\/resources\/)post-job-cta['"]/;
        const pages = [...walk('app', isSource), ...walk('components', isSource)]
            .filter((file) => importsBuilder.test(readRepo(file)));
        expect(pages.every((file) => file.startsWith('app/') && file.endsWith('/page.tsx')), pages.join(', ')).toBe(true);
        const routes = pages.map((file) => file.slice('app'.length, -'/page.tsx'.length));
        expect(routes).toContain(guideRoute);

        // The cell names the pages in words, so each route is looked up by its name there.
        const NAMED_AS: Readonly<Record<string, string>> = {
            '/for-employers/resources': 'the employer resources hub',
            '/for-employers/resources/job-description-templates': 'the template library',
            '/for-employers/resources/job-description-templates/[id]': 'every template page',
            [guideRoute]: 'the job description guide',
        };
        const usedBy = lineWith(section3a, 'post-job-cta.ts](').split('|')[3];
        for (const route of routes) {
            const name = NAMED_AS[route];
            expect(name, `${route} now calls postJobCta: name it in the section 3a "Used by" cell and in NAMED_AS`).toBeDefined();
            expect(usedBy, route).toContain(name);
        }
        expect(Object.keys(NAMED_AS).filter((named) => !routes.includes(named)), 'named in section 3a but no longer a caller').toEqual([]);
    });

    it('3c names the job description guide beside the builder, and the guide does follow the clock', () => {
        const guide = withoutComments(readRepo(`app${guideRoute}/page.tsx`));
        const followsClock =
            /postJobCta\(new Date\(\)\)/.test(guide) &&
            /export const revalidate = 3600;/.test(guide) &&
            !/Post a Job: Free/.test(guide) &&
            PROMO_SWITCH_PATHS.has(guideRoute);
        expect(
            followsClock,
            `${guideRoute} prints a fixed promo label or is static again. docs/PENDING_WORK.md lists backlog 2.1 as closed and section 3a says every promo sentence is chosen per render: convert the page, or reopen 2.1 in the register and name the page in section 1d`,
        ).toBe(true);
        expect(lineWith(section3c, '`postJobCta(now)`')).toContain(`(../app${guideRoute}/page.tsx)`);
    });

    it('3c: the welcome email prints all three parts of the pricing copy, and is its one caller since the plan emails went', () => {
        const emails = withoutComments(readRepo('lib/email-service.ts'));
        const used = (body: string): string[] => ['label', 'headline', 'body'].filter((part) => body.includes(`pricing.${part}`));
        const welcome = between(emails, 'export async function sendSignupWelcomeEmail(', '\nexport async function sendConfirmationEmail(');
        expect(used(welcome)).toEqual(['label', 'headline', 'body']);
        // The definition and the welcome email's call: no other email reads it.
        expect(emails.match(/\bpricingCopyForNow\(/g)).toHaveLength(2);
        expect(emails).not.toMatch(/export async function sendPlan\w*Email/);

        const row = lineWith(section3c, '| Employer emails');
        expect(row).toMatch(/its one caller since the plan emails were deleted/);
        expect(row).not.toMatch(/plan-paused/);
    });
});

describe('section 4: the schema blocks and the status lists', () => {
    const schema = readRepo('prisma/schema.prisma');
    const SCALAR = /^\s+(\w+)\s+(?:String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)\b/;
    const scalarFields = (block: string): string[] =>
        block.split('\n').map((line) => SCALAR.exec(line)?.[1]).filter((name): name is string => Boolean(name));
    const schemaModel = (model: string): string => between(schema, `model ${model} {`, '\n}');
    const docModel = (model: string): string => between(section4, `model ${model} {`, '\n}');

    it.each(['EmployerPlan', 'ProcessedStripeEvent', 'JobCharge', 'EmployerPostPack'])('%s: the block shows every column of the model, and no other', (model) => {
        expect(scalarFields(docModel(model)).sort()).toEqual(scalarFields(schemaModel(model)).sort());
    });

    it('EmployerJob: an excerpt, and every column it shows exists', () => {
        const block = docModel('EmployerJob');
        expect(block).toContain('...');
        const real = new Set(scalarFields(schemaModel('EmployerJob')));
        expect(scalarFields(block).filter((field) => !real.has(field))).toEqual([]);
    });

    it('EmployerPlan.status lists every status the schema comment lists', () => {
        const statuses = [...lineWith(schemaModel('EmployerPlan'), ' status ').matchAll(/'(\w+)'/g)].map((match) => match[1]);
        expect(statuses).toContain('pending');
        const documented = lineWith(docModel('EmployerPlan'), ' status ');
        for (const status of statuses) expect(documented, status).toContain(`'${status}'`);
    });

    it('paymentStatus: the block and the glossary list every value the code reads or writes', () => {
        const values = new Set<string>();
        for (const file of [...walk('app/api', isSource), ...walk('lib', isSource)]) {
            for (const match of withoutComments(readRepo(file)).matchAll(/paymentStatus:\s*'([a-z_]+)'/g)) values.add(match[1]);
        }
        expect(values.has('disputed')).toBe(true);
        const block = docModel('EmployerJob');
        const blockList = block.slice(block.indexOf('paymentStatus'), block.indexOf('pricingTier'));
        const glossaryRow = lineWith(glossary, '| **`paymentStatus`**');
        for (const value of values) {
            expect(blockList, `section 4a: ${value}`).toContain(`'${value}'`);
            expect(glossaryRow, `glossary: ${value}`).toContain(`'${value}'`);
        }
    });

    it('4c describes the two-phase claim the webhook runs', () => {
        const route = withoutComments(readRepo('app/api/webhooks/stripe/route.ts'));
        expect(route).toContain("status: 'processing'");
        expect(route).toContain("data: { status: 'done' }");
        expect(route).toContain('reclaimStaleDedupe');
        const section4c = between(section4, '### 4c. ProcessedStripeEvent', '### 4d. JobCharge');
        expect(section4c).toContain("'processing'");
        expect(section4c).toMatch(/takes it over/);
    });
});

describe('sections 8 and 9: what an operator is told to do', () => {
    it('two intro checkouts: the domain underpaid, so nothing is refunded', () => {
        const activate = readRepo('app/api/webhooks/stripe/activate-paid-job.ts');
        const alert = /logger\.error\('(Intro price charged twice for one domain)/.exec(activate);
        expect(alert, 'the alert the monitor row quotes').not.toBeNull();
        // Each checkout paid the intro price where the second owed the full one.
        const underpaid = config.postingPrice - config.introPrice;
        expect(underpaid).toBeGreaterThan(0);

        const monitor = lineWith(section9c, alert![1]);
        expect(monitor).toContain(`$${underpaid} less`);
        expect(monitor).not.toMatch(/refund \$\d+ on the later one/);
        const loophole = lineWith(section8, '**Concurrent first checkouts**');
        expect(loophole).toContain(`$${underpaid} less`);
        expect(loophole).not.toContain('refund the difference by hand');
    });

    it('9b asks for no plan Payment Link and no Customer Portal setup (the plan is retired)', () => {
        expect(section9b).not.toMatch(/- \[ \] Stripe Payment Link/);
        expect(section9b).not.toMatch(/- \[ \] Customer Portal/);
        expect(section9b).not.toContain('STRIPE_PLAN_PAYMENT_LINK');
    });

    it('9c: the job_charges monitor lists every amount the checkouts charge at list price', () => {
        const amounts = [...new Set([
            config.stripeIntroPriceInCents,
            config.stripePriceInCents,
            config.renewalPriceCentsFor('base'),
            config.renewalPriceCentsFor('pro'),
        ])].sort((a, b) => a - b);
        const row = lineWith(section9c, '`job_charges` rows where');
        const listed = [...row.matchAll(/\b(\d{5})\b/g)].map((match) => Number(match[1])).sort((a, b) => a - b);
        expect(listed).toEqual(amounts);
    });

    it('9a lists every migration that touches a pricing or Stripe table', () => {
        const pricing = /pricing_tier|processed_stripe|job_charges|quota_domain|employer_plans|post_packs|stripe_/;
        const migrations = walk('prisma/migrations', (name) => name === 'migration.sql')
            .map((file) => file.split('/')[2])
            .filter((name) => pricing.test(name));
        expect(migrations.length).toBeGreaterThanOrEqual(8);
        for (const migration of migrations) expect(section9a, migration).toContain(`\`${migration}\``);
    });

    it('9b lists exactly the webhook events the route handles and .env.example names', () => {
        const route = readRepo('app/api/webhooks/stripe/route.ts');
        const processEvent = between(route, 'async function processEvent(', '\n}\n');
        const handled = [...processEvent.matchAll(/case '([a-z_.]+)':/g)].map((match) => match[1]);
        // The retired plan's subscription and dunning events went with its code
        // (2026-10-27): the endpoint needs exactly the 7 events the route handles.
        expect(handled.filter((event) => /^customer\.subscription\.|^invoice\.payment_failed$/.test(event))).toEqual([]);
        expect(handled).toHaveLength(7);
        const required = new Set(handled);

        const EVENT = /(?:checkout|invoice|charge|customer)\.[a-z_.]*[a-z]/;
        const bullet = lineWith(section9b, 'Webhook endpoint');
        const documented = [...bullet.matchAll(new RegExp(`\`(${EVENT.source})\``, 'g'))].map((match) => match[1]);
        expect(new Set(documented)).toEqual(required);

        const envExample = readRepo('.env.example');
        const example = [...envExample.matchAll(new RegExp(`^#\\s+(${EVENT.source})(?=\\s|$)`, 'gm'))].map((match) => match[1]);
        expect(new Set(example)).toEqual(required);
    });

    // Register 2.8: a restricted live key can do only what its permissions
    // allow, so the list has to cover every Stripe call in app/ and lib/,
    // each at the level the call needs (a POST needs Write, a GET Read), and
    // the objects a call expands. (Fix pass of the pack reviews: the pack's
    // fulfilment reads its payment intent and expands the latest charge.)
    it('9b gives a restricted key every permission the Stripe calls in the code need', () => {
        const LABELS: Record<string, string> = {
            'checkout.sessions': 'Checkout Sessions',
            paymentIntents: 'Payment Intents',
            subscriptions: 'Subscriptions',
            invoices: 'Invoices',
            'billingPortal.sessions': 'Customer portal',
        };
        const WRITES = new Set(['create', 'update', 'expire', 'cancel', 'del']);
        const needs = new Map<string, 'Read' | 'Write'>();
        let expandsPaymentIntent = false;
        let expandsCharge = false;
        for (const file of [...walk('app', isSource), ...walk('lib', isSource)]) {
            const src = withoutComments(readRepo(file));
            if (/expand:\s*\[[^\]]*'payment_intent'/.test(src)) expandsPaymentIntent = true;
            if (/expand:\s*\[[^\]]*'latest_charge'/.test(src)) expandsCharge = true;
            for (const match of src.matchAll(/\bstripe(?:Client)?\.((?:[a-zA-Z]+\.)+)([a-zA-Z]+)\(/g)) {
                const resource = match[1].slice(0, -1);
                if (resource === 'webhooks') continue;
                expect(LABELS[resource], `a Stripe resource 9b does not name: ${resource}`).toBeDefined();
                const level = WRITES.has(match[2]) ? 'Write' : 'Read';
                if (needs.get(LABELS[resource]) !== 'Write') needs.set(LABELS[resource], level);
            }
        }
        if (expandsPaymentIntent && !needs.has('Payment Intents')) needs.set('Payment Intents', 'Read');
        if (expandsCharge) needs.set('Charges', 'Read');
        // Checkout Sessions, Payment Intents, Charges and Invoices (Subscriptions
        // and the Customer portal went with the plan code, 2026-10-27).
        expect(needs.size).toBeGreaterThanOrEqual(4);

        const list = between(section9b, 'Restricted live key', '\n- [ ]');
        for (const [label, level] of needs) {
            expect(list, label).toContain(`${label}: ${level}`);
        }
        expect(list).toContain('webhooks.constructEvent');
        // A permission no call needs is not asked for (the retired plan's
        // Subscriptions and Customer portal, since its code was deleted).
        for (const label of Object.values(LABELS).filter((name) => !needs.has(name))) {
            expect(list, label).not.toMatch(new RegExp(`${label}: (?:Read|Write)`));
        }
    });
});

describe('sections 10 and 11: the test map', () => {
    /** The suites that cover a path where money is taken or a paid entitlement is granted. */
    const MONEY_SUITES = [
        'tests/api/post-free-modes.test.ts',
        'tests/api/create-checkout-tier.test.ts',
        'tests/api/create-renewal-checkout-status.test.ts',
        'tests/api/create-renewal-checkout-single-payable.test.ts',
        'tests/api/create-renewal-checkout-tiered-price.test.ts',
        'tests/api/apply-renewal-amount.test.ts',
        'tests/lib/renewal-price.test.ts',
        'tests/api/webhooks-stripe-c2.test.ts',
        'tests/api/webhooks-stripe-refund-dispute.test.ts',
        // The retired Employer plan's guard: a subscription-mode session is alerted for a refund, never fulfilled.
        'tests/api/webhooks-stripe-subscription-retired.test.ts',
        'tests/api/webhooks-stripe-archived-post.test.ts',
        'tests/api/apply-renewal-sibling-sessions.test.ts',
        'tests/lib/renewal-checkout-sessions.test.ts',
        'tests/lib/pricing.test.ts',
        'tests/lib/email-change-policy.test.ts',
        // The 5-post pack: a purchase, the credits it grants, and the admin changes that grant or revoke them.
        'tests/api/create-pack-checkout.test.ts',
        'tests/api/webhooks-stripe-post-pack.test.ts',
        'tests/lib/post-packs.test.ts',
        'tests/lib/post-pack-admin.test.ts',
        'tests/api/admin-post-packs.test.ts',
    ];

    it('names every money-path suite, and each one exists', () => {
        for (const suite of MONEY_SUITES) {
            expect(existsInRepo(suite), suite).toBe(true);
            expect(section10, suite).toContain(path.posix.basename(suite));
        }
    });

    it('names every checkout, webhook, plan and reconciliation suite under tests/api and tests/inngest', () => {
        const suites = [
            ...walk('tests/api', (name) => /(?:stripe|checkout|post-free|employer-plan|paid-job|apply-renewal|verify-renewal).*\.test\.ts$/.test(name)),
            ...walk('tests/inngest', (name) => /^(?:plan|payment)-.*\.test\.ts$/.test(name)),
        ];
        expect(suites.length).toBeGreaterThanOrEqual(15);
        for (const suite of suites) expect(section10, suite).toContain(path.posix.basename(suite));
    });

    it('claims no gap a suite covers, and says what really is missing', () => {
        expect(section10).not.toMatch(/^- No (?:integration )?tests for/m);
        expect(section10).toMatch(/mocked Prisma client/);
        expect(section10).toMatch(/real database/);
        const audit20 = lineWith(section11, '| Audit #20');
        expect(audit20).not.toContain('Webhook + checkout + plan integration tests');
        expect(audit20).toMatch(/real database/);
    });

    it('11: the plan code removal is done, and only the deprecated table is left, for a separate migration', () => {
        expect(section11).not.toContain('| Plan code removal');
        const table = lineWith(section11, '| Plan table removal');
        expect(table).toMatch(/deleted on 2026-10-27/);
        expect(table).toMatch(/separate, deliberate migration/);
        // The migration that would drop it does not exist.
        expect(walk('prisma/migrations', (name) => name === 'migration.sql').filter((file) => /drop.*employer_plans|employer_plans.*drop/i.test(readRepo(file)))).toEqual([]);
    });

    it('credits the checkout banner to the suite that renders it in both phases', () => {
        const suite = 'tests/regressions/checkout-page-server-quote.test.ts';
        expect(readRepo(suite)).toContain("describe('once the promo has ended");
        expect(section10).toContain(path.posix.basename(suite));
    });
});

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
 */
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { config } from '@/lib/config';
import { isPlanEntitled, mapStripeSubscriptionStatus } from '@/lib/employer-plan';
import { PROMO_SWITCH_PATHS } from '@/app/api/sitemaps/lastmod';
import { pricingPageCopy } from '@/app/pricing/pricing-page-copy';
import { forEmployersCopy } from '@/app/for-employers/for-employers-copy';
import { between, existsInRepo, isSource, lineWith, readRepo, repoPathsNamed, walk, withoutComments } from '../support/docs-vs-code';

const DOC = 'docs/pricing-system.md';
const doc = readRepo(DOC);
const pending = readRepo('docs/PENDING_WORK.md');

const section1c = between(doc, '### 1c. Helpers', '### 1d. What happens');
const section1d = between(doc, '### 1d. What happens', '## 2. End-to-end flows');
const section2a = between(doc, '### 2a. Promo post', '### 2b. Plan post');
const section2c = between(doc, '### 2c. Intro / Featured checkout', '### 2d. Renewal');
const section2e = between(doc, '### 2e. Employer plan lifecycle', '### 2f. Plan-lapse job');
const section2f = between(doc, '### 2f. Plan-lapse job', '### 2g. Expiry');
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
        expect(named.length).toBeGreaterThanOrEqual(4);
        expect(named.filter((name) => !declared.has(name)), 'variables nothing reads').toEqual([]);
    });
});

describe('section 1: the copy and the switch at config.promoEndsAt', () => {
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
            // Both cards close on the same plan clause.
            const planClause = `the same ${config.durationDays} days and come down sooner only if the plan ends.`;
            expect(pricing.endsWith(planClause)).toBe(true);
            expect(employers.endsWith(planClause)).toBe(true);
            expect(section1c).toContain(asWritten(planClause));
        }
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

describe('section 1d and the register: what the flag opens without the Stripe key', () => {
    const LINK = 'https://buy.stripe.com/abc123';

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('states plan sales as the code opens them, and the register tracks the gap while it is open', async () => {
        // The real lib/env and lib/employer-plan-link, on a fresh module graph
        // (getEnv caches its first parse): the flag on, a valid Payment Link,
        // no secret key, the promo over.
        vi.stubEnv('ENABLE_PAID_POSTING', 'true');
        vi.stubEnv('STRIPE_SECRET_KEY', '');
        vi.stubEnv('STRIPE_PLAN_PAYMENT_LINK', LINK);
        vi.stubEnv('CRON_SECRET', 'unit-test-cron-secret');
        vi.resetModules();
        const env = await import('@/lib/env');
        const planLink = await import('@/lib/employer-plan-link');

        // The environment parsed: a failed parse would also read as "closed".
        expect(env.getEnv().STRIPE_PLAN_PAYMENT_LINK).toBe(LINK);
        expect(env.getPaidPostingStatus()).toEqual({ enabled: true, stripeConfigured: false, available: false });
        expect(planLink.isPlanSaleOpen(PROMO_RUNNING)).toBe(false);
        const opensWithoutKey = planLink.isPlanSaleOpen(LADDER_LIVE);

        const flagBullet = lineWith(section1d, '`ENABLE_PAID_POSTING=true`');
        const registerItem = '**2.16 Plan sales do not check the Stripe key.**';
        if (opensWithoutKey) {
            // Checkout answers 503 without the key, but the plan can be bought
            // and the webhook (503 without the key or its secret) cannot record it.
            expect(flagBullet).not.toMatch(/Until both are set/);
            expect(flagBullet).toContain('plan sales open as soon as `STRIPE_PLAN_PAYMENT_LINK` is valid');
            expect(flagBullet).toMatch(/the webhook answers 503 until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are both set/);
            expect(pending, 'the open gap belongs in the register').toContain(registerItem);
        } else {
            expect(flagBullet, 'isPlanSaleOpen now needs the key: drop the warning from section 1d').not.toContain('plan sales open as soon as');
            expect(pending, 'isPlanSaleOpen now needs the key: close 2.16 in docs/PENDING_WORK.md').not.toContain(registerItem);
        }
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

    it('2e, 3b and 12: the /pricing plan card goes through /api/employer/plan/subscribe, never the raw link', () => {
        const pricingPage = withoutComments(readRepo('app/pricing/page.tsx'));
        expect(pricingPage, 'the plan card no longer routes through the subscribe route: update 2e, 12 and this check')
            .toMatch(/planSaleOpen \? '\/api\/employer\/plan\/subscribe' : `mailto:/);

        expect(section2e).toContain('/api/employer/plan/subscribe while isPlanSaleOpen()');
        expect(section2e).not.toContain('href = process.env.STRIPE_PLAN_PAYMENT_LINK');
        expect(planDiagram).toContain('/api/employer/plan/subscribe');
        expect(planDiagram).not.toMatch(/\/pricing → STRIPE_PLAN_PAYMENT_LINK/);

        // The subscribe route sends an employer with an entitled OR a pending plan to the dashboard.
        const subscribe = withoutComments(readRepo('app/api/employer/plan/subscribe/route.ts'));
        expect(subscribe).toContain("isPlanEntitled(plan) || plan.status === 'pending'");
        expect(lineWith(section3b, '`/api/employer/plan/subscribe`')).toMatch(/entitled or pending plan/);
        expect(section2e).toMatch(/entitled or pending plan/);
    });

    it('2e prints the plan widget response as GET /api/employer/plan builds it', () => {
        const route = withoutComments(readRepo('app/api/employer/plan/route.ts'));
        const body = between(route, 'NextResponse.json({', '});');
        const inner = /\?\s*\{([\s\S]*?)\}\s*:\s*null/.exec(body);
        expect(inner).not.toBeNull();
        const keys = (text: string): string[] => [...text.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]);
        const planKeys = keys(inner![1]);
        const topKeys = keys(body.replace(inner![0], 'null')).filter((key) => key !== 'plan');
        expect(planKeys).toContain('canManageBilling');

        const shape = /\{ plan: \{([^}]*)\} \| null,([^}]*)\}/.exec(section2e);
        expect(shape, 'the response shape line').not.toBeNull();
        const names = (list: string): string[] => list.split(',').map((item) => item.split(':')[0].trim()).filter(Boolean);
        expect(names(shape![1])).toEqual(planKeys);
        expect(names(shape![2])).toEqual(topKeys);
    });

    it('2e and 8: a plan is attached by the account reference, never by the checkout email', () => {
        const checkoutSource = readRepo('app/api/webhooks/stripe/plan-checkout.ts');
        const checkout = withoutComments(checkoutSource);
        // The code: the attached account comes from the server-issued reference alone.
        expect(checkout).toContain('const userId = await resolveReferencedEmployer(session);');
        const resolver = between(checkout, 'async function resolveReferencedEmployer', 'async function emailMatchesEmployer');
        expect(resolver).toContain('session.client_reference_id');
        expect(resolver).toContain('session.metadata?.userId');
        expect(resolver).not.toMatch(/email/i);
        expect(checkout).toContain('mapStripeSubscriptionStatus(subscription.status)');
        expect(checkout).toContain('{ detached: true }');

        // The document says the same.
        expect(section2e).toContain('client_reference_id or metadata.userId');
        expect(section2e).toMatch(/never used to attach/);
        expect(section2e).not.toContain('userProfile.findFirst({ email');
        expect(section2e).not.toContain("status:'active'");
        expect(section2e).toContain('mapStripeSubscriptionStatus(subscription.status)');
        expect(section2e).toMatch(/'pending' while the session is unpaid/);
        expect(section2e).toMatch(/stored detached/);
        const emails = [...new Set([...checkout.matchAll(/\b(send\w+Email)\b/g)].map((match) => match[1]))];
        expect(emails.length).toBeGreaterThanOrEqual(2);
        for (const email of emails) expect(section2e, email).toContain(email);

        const loophole = lineWith(section8, 'plan checkout**');
        expect(loophole).not.toContain('Payment Links cannot carry our user id');
        expect(loophole).toMatch(/never attaches/);
        expect(loophole).toContain('client_reference_id');
        // A detached duplicate is unattached too, so the monitor row names both.
        expect(lineWith(section9c, '`user_id IS NULL`')).toMatch(/no account reference/);
        expect(lineWith(section9c, '`user_id IS NULL`')).toMatch(/detached/);
    });

    it('2e status map is the one mapStripeSubscriptionStatus applies, fallback included', () => {
        const planLib = readRepo('lib/employer-plan.ts');
        const mapper = between(planLib, 'export function mapStripeSubscriptionStatus', '\n}\n');
        const stripeStatuses = [...mapper.matchAll(/case '(\w+)':/g)].map((match) => match[1]);
        expect(stripeStatuses.length).toBeGreaterThanOrEqual(8);

        const line = lineWith(section2e, 'status map:');
        const documented = new Map<string, string>();
        let fallback: string | undefined;
        for (const entry of line.slice(line.indexOf('status map:') + 'status map:'.length).split(';')) {
            const parsed = /^(.+?) → '(\w+)'$/.exec(entry.trim());
            expect(parsed, `unreadable status map entry: ${entry}`).not.toBeNull();
            if (/^any other status/.test(parsed![1])) fallback = parsed![2];
            else for (const status of parsed![1].split('|')) documented.set(status.trim(), parsed![2]);
        }
        expect([...documented.keys()].sort()).toEqual([...stripeStatuses].sort());
        for (const status of stripeStatuses) expect(documented.get(status), status).toBe(mapStripeSubscriptionStatus(status));
        expect(fallback).toBe(mapStripeSubscriptionStatus('a_status_stripe_adds_later'));
    });

    it('2f, 4b and the glossary state entitlement as isPlanEntitled decides it', () => {
        const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
        const longPast = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        // A cancelled plan keeps its paid-through period; a pending one is never entitled.
        expect(isPlanEntitled({ status: 'cancelled', currentPeriodEnd: future })).toBe(true);
        expect(isPlanEntitled({ status: 'cancelled', currentPeriodEnd: longPast })).toBe(false);
        expect(isPlanEntitled({ status: 'pending', currentPeriodEnd: future })).toBe(false);

        for (const statement of [lineWith(section4, 'Entitled = '), lineWith(glossary, '**Entitled plan**')]) {
            expect(statement).toMatch(/'cancelled'/);
            expect(statement).toMatch(/'pending'/);
        }
        // So a cancelled plan is not lapsed until its period has ended, and a pending one always is.
        expect(section2f).not.toContain("(status 'cancelled', or currentPeriodEnd + grace < now)");
        expect(section2f).toMatch(/'cancelled' once currentPeriodEnd has passed/);
        expect(section2f).toMatch(/'pending' always/);
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

    it('3c: the plan-paused email prints the label and the body of the pricing copy, the welcome email all three', () => {
        const emails = readRepo('lib/email-service.ts');
        const used = (body: string): string[] => ['label', 'headline', 'body'].filter((part) => body.includes(`pricing.${part}`));
        const welcome = between(emails, 'export async function sendSignupWelcomeEmail(', '\nexport async function sendConfirmationEmail(');
        const paused = between(emails, 'export async function sendPlanPausedEmail(', '\nasync function sendPlanNotice(');
        expect(used(welcome)).toEqual(['label', 'headline', 'body']);
        expect(used(paused)).toEqual(['label', 'body']);

        const row = lineWith(section3c, '| Employer emails');
        expect(row).toMatch(/plan-paused email prints that copy's label and body only/);
    });
});

describe('section 4: the schema blocks and the status lists', () => {
    const schema = readRepo('prisma/schema.prisma');
    const SCALAR = /^\s+(\w+)\s+(?:String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)\b/;
    const scalarFields = (block: string): string[] =>
        block.split('\n').map((line) => SCALAR.exec(line)?.[1]).filter((name): name is string => Boolean(name));
    const schemaModel = (model: string): string => between(schema, `model ${model} {`, '\n}');
    const docModel = (model: string): string => between(section4, `model ${model} {`, '\n}');

    it.each(['EmployerPlan', 'ProcessedStripeEvent', 'JobCharge'])('%s: the block shows every column of the model, and no other', (model) => {
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

    it('9a lists every migration that touches a pricing or Stripe table', () => {
        const pricing = /pricing_tier|processed_stripe|job_charges|quota_domain|employer_plans|stripe_/;
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
        expect(processEvent).toContain('customer.subscription.created is intentionally a no-op');
        const required = new Set([...handled, 'customer.subscription.created']);

        const EVENT = /(?:checkout|invoice|charge|customer)\.[a-z_.]*[a-z]/;
        const bullet = lineWith(section9b, 'Webhook endpoint');
        const documented = [...bullet.matchAll(new RegExp(`\`(${EVENT.source})\``, 'g'))].map((match) => match[1]);
        expect(new Set(documented)).toEqual(required);

        const envExample = readRepo('.env.example');
        const example = [...envExample.matchAll(new RegExp(`^#\\s+(${EVENT.source})(?=\\s|$)`, 'gm'))].map((match) => match[1]);
        expect(new Set(example)).toEqual(required);
    });
});

describe('sections 10 and 11: the test map', () => {
    /** The suites that cover a path where money is taken or a paid entitlement is granted. */
    const MONEY_SUITES = [
        'tests/api/post-free-modes.test.ts',
        'tests/api/create-checkout-tier.test.ts',
        'tests/api/create-renewal-checkout-status.test.ts',
        'tests/api/create-renewal-checkout-single-payable.test.ts',
        'tests/api/webhooks-stripe-c2.test.ts',
        'tests/api/webhooks-stripe-refund-dispute.test.ts',
        'tests/api/webhooks-stripe-subscription.test.ts',
        'tests/api/webhooks-stripe-subscription-live-read.test.ts',
        'tests/api/webhooks-stripe-archived-post.test.ts',
        'tests/api/apply-renewal-sibling-sessions.test.ts',
        'tests/inngest/plan-lapse.test.ts',
        'tests/inngest/plan-reconciliation.test.ts',
        'tests/lib/employer-plan.test.ts',
        'tests/lib/employer-plan-link.test.ts',
        'tests/lib/employer-plan-stale-write.test.ts',
        'tests/lib/renewal-checkout-sessions.test.ts',
        'tests/lib/pricing.test.ts',
        'tests/lib/email-change-policy.test.ts',
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

    it('credits the checkout banner to the suite that renders it in both phases', () => {
        const suite = 'tests/regressions/checkout-page-server-quote.test.ts';
        expect(readRepo(suite)).toContain("describe('once the promo has ended");
        expect(section10).toContain(path.posix.basename(suite));
    });
});

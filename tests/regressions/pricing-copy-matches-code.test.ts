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
 *      and pausePlanPosts takes plan posts down when the plan lapses. What
 *      the plan buys is the SLOT: when a post ends or is closed, the employer
 *      posts into it again at no extra charge.
 *   2. "Renewing ... refreshes its 25 unlocks and 25 InMails". No renewal
 *      path resets either counter: lib/tier-limits.ts counts unlocks by
 *      ProfileView.employerJobId and InMails by conversations since the
 *      posting was created, and apply-renewal.ts only moves the end date.
 *
 * The first block pins the code facts, so a behaviour change fails here and
 * forces the copy to be re-checked. The rest pins the copy: the banned claims
 * stay gone from every surface's VISIBLE text (comments may explain them),
 * and the plan and renewal answers, which also feed the FAQPage JSON-LD,
 * render the real lifecycle with the real config values.
 *
 * Since backlog 2.1 the promo-clock copy of /pricing, /for-employers and /faq
 * is built per render by a sibling module of each page, so the copy pins
 * call those builders on both sides of config.promoEndsAt: the lifecycle
 * holds in both phases, and only the promo phase dates the plan price.
 * tests/regressions/pricing-pages-phase-switch.test.ts covers the switch.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { config } from '@/lib/config';
import {
    PLAN_CANCEL_LINE,
    PLAN_POSTS_LINE,
    PLAN_TERMS,
    RENEWAL_CAP_LINE,
    RENEWAL_EFFECT_LINE,
    RENEWAL_LINE,
    pricingPageCopy,
} from '@/app/pricing/pricing-page-copy';
import { forEmployersCopy } from '@/app/for-employers/for-employers-copy';
import { employerPricingFaqs } from '@/app/faq/faq-employer-copy';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

describe('the code facts the pricing copy rests on', () => {
    it('gives every post, plan included, the same fixed config.durationDays expiry', () => {
        const postFree = read('app/api/jobs/post-free/route.ts');
        expect(postFree).toContain('const expiresAt = expiresFromNow(config.durationDays, now);');
        // One expiry for every mode: nothing branches it on promo vs plan.
        expect(postFree.match(/expiresFromNow\(/g)).toHaveLength(1);
        // Line-ending agnostic: a Windows checkout reads CRLF.
        expect(postFree).toMatch(/^\s*expiresAt,\s*$/m);
    });

    it('refuses to renew a plan post', () => {
        const renewal = read('app/api/create-renewal-checkout/route.ts');
        expect(renewal).toMatch(/paymentStatus === 'plan'\)\s*\{\s*return NextResponse\.json\([\s\S]*?status: 409/);
    });

    it('takes plan posts down when the plan lapses, and frees a slot when a post ends or is closed', () => {
        const plan = read('lib/employer-plan.ts');
        expect(plan).toMatch(/export async function pausePlanPosts[\s\S]*?paymentStatus: 'plan'[\s\S]*?data: \{ isPublished: false \}/);
        // A slot is in use only while its post is published and unexpired.
        expect(plan).toMatch(/export async function countActivePlanPosts[\s\S]*?paymentStatus: 'plan',\s*job: \{ isPublished: true, OR: \[\{ expiresAt: null \}, \{ expiresAt: \{ gt: now \} \}\] \}/);
    });

    it('lets the employer cancel the plan themselves (Stripe Customer Portal)', () => {
        expect(read('app/api/employer/billing-portal/route.ts')).toContain('stripe.billingPortal.sessions.create(');
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
});

describe('no pricing surface repeats a claim the code does not back', () => {
    const BANNED: readonly [RegExp, string][] = [
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

    it('the banned list catches the reworded plan claims the listing cards used to carry', () => {
        const retired = [
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

describe('the listing cards state the plan post run the code gives', () => {
    const PLAN_RUN = `run the same ${config.durationDays} days and come down sooner only if the plan ends.`;

    it.each(PHASES)('/pricing (%s): every post runs durationDays; plan posts the same, shortened only by the plan ending', (_phase, now) => {
        const run = pricingPageCopy(now).listingRun;
        expect(run.startsWith(`Every post runs ${config.durationDays} days with no daily budget and no bidding`)).toBe(true);
        expect(run).toContain(`Plan posts ${PLAN_RUN}`);
        // The listing card prints the builder's sentence for the render clock.
        expect(read(PRICING)).toContain('{copy.listingRun}');
    });

    it.each(PHASES)('/for-employers (%s): the same run for every job, plan posts shortened only by the plan ending', (_phase, now) => {
        const run = forEmployersCopy(now).listingRun;
        expect(run.startsWith(`Every job runs ${config.durationDays} days with no daily budget and no bidding.`)).toBe(true);
        expect(run).toMatch(new RegExp(`[Pp]lan posts ${PLAN_RUN.replace(/\./g, '\\.')}$`));
        expect(read(EMPLOYERS)).toContain('{copy.listingRun}');
    });

    it('names promo posts in the run only while the promo runs', () => {
        expect(pricingPageCopy(DURING_PROMO).listingRun).toContain(' days with no daily budget and no bidding, promo posts included. Plan posts run the same ');
        expect(forEmployersCopy(DURING_PROMO).listingRun).toContain('Promo posts get the same run and the same features; plan posts run the same ');
        expect(pricingPageCopy(LADDER_START).listingRun).not.toMatch(/promo/i);
        expect(forEmployersCopy(LADDER_START).listingRun).not.toMatch(/promo/i);
    });
});

describe('the plan answers state the real lifecycle in both phases (they also feed FAQPage JSON-LD)', () => {
    const lifecycle = (answer: string, now: Date): void => {
        expect(answer).toContain(`${config.planSlots} active job slots while you're subscribed.`);
        expect(answer).toContain('Swap jobs any time. Cancel any time.');
        expect(answer).toContain(`Each plan post runs ${config.durationDays} days.`);
        expect(answer).toContain('its slot opens up and you can post into it again at no extra charge.');
        expect(answer).toContain('Plan posts come down if the plan ends.');
        expect(answer).toContain(`or until their ${config.durationDays} days run out if that comes first.`);
        // The price is dated only while the ladder is still ahead.
        if (config.isPromoActive(now)) {
            expect(answer.startsWith(`From ${config.ladderStartsLabel}, the Employer plan is $${config.planPrice}/month. `)).toBe(true);
        } else {
            expect(answer.startsWith(`The Employer plan is $${config.planPrice}/month. `)).toBe(true);
            expect(answer).not.toContain(config.ladderStartsLabel);
        }
        expect(answer).not.toMatch(/[–—]|\s-\s/);
    };

    it.each(PHASES)('/pricing (%s) builds its plan answer and plan card from the lifecycle sentences', (_phase, now) => {
        const plan = pricingPageCopy(now).pricingFaqs.find((f) => f.q === 'How does the Employer plan work?');
        expect(plan).toBeDefined();
        lifecycle(plan!.a, now);
        expect(plan!.a).toContain(` ${PLAN_TERMS} ${PLAN_POSTS_LINE} `);
        expect(plan!.a.endsWith(PLAN_CANCEL_LINE)).toBe(true);
        const src = read(PRICING);
        // The plan card note carries the same two sentences.
        expect(src).toMatch(/note: `Every slot is a Featured post[^`]*\$\{PLAN_POSTS_LINE\} \$\{PLAN_CANCEL_LINE\}`/);
        // JSON-LD republishes the same array the accordion renders.
        expect(src).toMatch(/mainEntity: faqs\.map/);
        expect(src).toContain('const faqs = [...copy.pricingFaqs, ...EVERGREEN_FAQS];');
    });

    it.each(PHASES)('/faq (%s) renders the same lifecycle', (_phase, now) => {
        const plan = employerPricingFaqs(now).find((f) => f.question === 'How does the Employer plan work?');
        expect(plan).toBeDefined();
        lifecycle(plan!.answer, now);
        expect(read(FAQ)).toMatch(/mainEntity: \[\.\.\.jobSeekerFaqs, \.\.\.employerFaqs/);
        expect(read(FAQ)).toContain('...employerPricingFaqs(new Date()),');
    });

    it.each(PHASES)('/for-employers (%s) renders the same lifecycle', (_phase, now) => {
        const plan = forEmployersCopy(now).pricingFaqs.find((f) => f.q === 'How does the Employer plan work?');
        expect(plan).toBeDefined();
        lifecycle(plan!.a, now);
        expect(read(EMPLOYERS)).toMatch(/mainEntity: employerFaqs\.map/);
        expect(read(EMPLOYERS)).toContain('const employerFaqs = [...copy.pricingFaqs, ...EVERGREEN_FAQS];');
    });
});

describe('the renewal answers say what a renewal does, and nothing more', () => {
    it('/pricing: +durationDays, no new unlocks or InMails, plan posts reposted, the cap stated', () => {
        expect(RENEWAL_LINE).toBe(
            `Renew a promo, intro or featured post for $${config.renewalPrice} (+${config.durationDays} days).`,
        );
        expect(RENEWAL_EFFECT_LINE).toContain(`A renewal adds ${config.durationDays} days to the post`);
        expect(RENEWAL_EFFECT_LINE).toContain('It does not add unlocks or InMails');
        expect(RENEWAL_CAP_LINE).toBe(
            `Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.`,
        );
        const src = read(PRICING);
        const answer = src.match(/q: 'What does renewal cost\?', a: `([^`]*)`/);
        expect(answer).not.toBeNull();
        const template = (answer as RegExpMatchArray)[1];
        expect(template).toContain('${RENEWAL_LINE} ${RENEWAL_EFFECT_LINE}');
        expect(template).toContain('Plan posts are not renewed');
        expect(template).not.toMatch(/refresh|unlocksPerPosting/);
    });

    it('/faq: renewal gives more days, not more unlocks, and states the cap', () => {
        const src = read(FAQ);
        expect(src).toContain('Renew a promo, intro or featured post for $${config.renewalPrice} (+${config.durationDays} days) from the employer dashboard.');
        expect(src).toContain('A renewal gives the post ${config.durationDays} more days; it does not add unlocks or InMails.');
        expect(src).toContain('Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.');
    });
});

describe('/terms states the same rules as the marketing pages', () => {
    const terms = read(TERMS);

    it('plan postings run durationDays, are not renewable, and free their slot', () => {
        expect(terms).toContain('Postings made from an Employer plan slot are not renewed. Each runs for {config.durationDays} days;');
        expect(terms).toContain('its slot becomes available and the employer may publish a new posting in that slot at no additional charge');
        expect(terms).toContain('Postings made from plan slots are unpublished when the plan ends');
        expect(terms).toContain('or until their own {config.durationDays}-day term ends if that is sooner');
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

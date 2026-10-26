/**
 * Renewal offer truth (package RENEWAL-OFFER).
 *
 * The dashboard, the edit page, the expiry warning email and the post-expiry
 * email all used to print round((1 - renewalPrice / postingPrice) * 100) = 40
 * and claim a $179 renewal "saves 40% vs. a new post". That is false during
 * the launch promo (a new post is free), false by a wide margin for a domain
 * whose next post is the $199 intro price, and false outright for an
 * employer with a free Employer plan slot. It also offered the renewal while
 * the renewal checkout answers 503 (paid posting off).
 *
 * lib/renewal-offer.ts decides the claim in one place:
 *   - no saving unless a renewal can be bought AND the promo is over AND the
 *     renewal is cheaper than the price it is compared with;
 *   - the comparison is the reader's own next new post when known
 *     ('next-post'), otherwise the standard post price, named as such
 *     ('list-price');
 *   - the percent rounds DOWN so the claim never overstates.
 * The module imports only lib/config (backlog 2.6), so the dashboard and the
 * edit page, which are client bundles, call it instead of the copies they
 * kept while the rule lived in Prisma-backed lib/pricing.ts. lib/pricing.ts
 * re-exports it for the emails and the cron. These blocks test the module
 * directly, prove the move kept what both pages printed (their old copies
 * are the oracle), and keep the module free of Prisma.
 *
 * 2027 re-price: a renewal has two prices (lib/renewal-price.ts), so the
 * offer takes the renewal price of the row being renewed, `renewalPrice`, and
 * both the price it names and the saving it claims use it. An offer that can
 * be bought must be given it (review 2.28 M1): leaving it out is a type
 * error, and throws rather than name the base price for a row that may pay
 * more. An offer that cannot be bought names config.renewalPrice when it is
 * left out, and prints nothing from it. The saving rounds down: $199 against
 * the $249 intro price is 20.08%, against the $349 post price 42.98%; $249
 * against $349 is 28.65%, and against the $249 intro price nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import * as pricing from '@/lib/pricing';
import { nextNewPostPrice } from '@/lib/pricing';
import {
    renewalSavings,
    renewalSavingsLabel,
    renewalSavingsLine,
    resolveRenewalOffer,
    type RenewalOfferInputs,
} from '@/lib/renewal-offer';

const DURING_PROMO = new Date('2026-11-21T12:00:00.000Z');
const LAST_PROMO_INSTANT = new Date(Date.parse(config.promoEndsAt) - 1);
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');
const DOMAIN = 'clinic.example';
/** The base renewal: what a purchasable offer for a promo, intro or legacy row is told. */
const BASE = config.renewalPrice;
const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

beforeEach(() => {
    vi.clearAllMocks();
});

describe('renewalSavings: only a real, rounded-down saving', () => {
    it('against the standard post price', () => {
        expect(renewalSavings(config.postingPrice, 'list-price')).toEqual({
            dollars: config.postingPrice - config.renewalPrice,
            percent: Math.floor(((config.postingPrice - config.renewalPrice) / config.postingPrice) * 100),
            comparedWith: config.postingPrice,
            basis: 'list-price',
        });
    });

    it('against the intro price the saving is small, not the list-price saving', () => {
        const savings = renewalSavings(config.introPrice, 'next-post');
        expect(savings?.dollars).toBe(config.introPrice - config.renewalPrice);
        expect(savings?.percent).toBe(Math.floor(((config.introPrice - config.renewalPrice) / config.introPrice) * 100));
        expect(savings?.percent).toBeLessThan(Math.round((1 - config.renewalPrice / config.postingPrice) * 100));
    });

    it('never claims a saving when the renewal is not cheaper', () => {
        expect(renewalSavings(0, 'next-post')).toBeNull();
        expect(renewalSavings(config.renewalPrice, 'next-post')).toBeNull();
        expect(renewalSavings(config.renewalPrice - 1, 'next-post')).toBeNull();
    });

    it('never claims "save 0%" for a sub-1% difference, nor anything for a non-number', () => {
        expect(renewalSavings(config.renewalPrice + 1, 'next-post')).toBeNull();
        expect(renewalSavings(Number.NaN, 'next-post')).toBeNull();
    });

    it('rounds down so the claim never overstates', () => {
        // 199 vs 349 is 42.98% and 199 vs 249 is 20.08%: both floor, never round up.
        expect(renewalSavings(config.postingPrice, 'list-price')?.percent).toBe(42);
        expect(renewalSavings(config.introPrice, 'next-post')?.percent).toBe(20);
        const s = renewalSavings(1000, 'list-price', 555);
        expect(s?.percent).toBe(44); // 44.5% floors to 44
    });
});

describe("resolveRenewalOffer: the renewal price of the row being renewed", () => {
    const PRO = config.proRenewalPrice;

    it('names the base price, and measures the saving from it, for a row that pays the base renewal', () => {
        const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.postingPrice, renewalPrice: BASE, now: AFTER_PROMO });
        expect(offer.price).toBe(config.renewalPrice);
        expect(offer.savings).toMatchObject({ dollars: config.postingPrice - config.renewalPrice, percent: 42 });
    });

    it('refuses a purchasable offer that was not told the price, instead of naming the base one', () => {
        // @ts-expect-error a purchasable offer requires the price of the row being renewed
        expect(() => resolveRenewalOffer({ purchasable: true, nextPostPrice: config.postingPrice, now: AFTER_PROMO })).toThrow(/renewalPrice/);
        // A cast past the type is refused at run time as well.
        for (const renewalPrice of [undefined, Number.NaN, null]) {
            expect(() => resolveRenewalOffer({ purchasable: true, renewalPrice: renewalPrice as never, now: AFTER_PROMO })).toThrow(/renewalPrice/);
            expect(() => renewalSavingsLine({ purchasable: true, renewalPrice: renewalPrice as never, now: AFTER_PROMO })).toThrow(/renewalPrice/);
        }
    });

    it('an offer that cannot be bought may leave the price out: it names the base price and claims nothing', () => {
        expect(resolveRenewalOffer({ purchasable: false, now: AFTER_PROMO })).toEqual({ purchasable: false, promoActive: false, price: config.renewalPrice, savings: null });
        expect(renewalSavingsLine({ purchasable: false, now: AFTER_PROMO })).toBeNull();
    });

    it("names the row's own price, and measures the saving from it", () => {
        const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.postingPrice, renewalPrice: PRO, now: AFTER_PROMO });
        expect(offer.price).toBe(PRO);
        expect(offer.savings).toEqual({ dollars: config.postingPrice - PRO, percent: 28, comparedWith: config.postingPrice, basis: 'next-post' });
    });

    it('with an unknown next post, compares the row\'s own price with the named standard post price', () => {
        const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice: null, renewalPrice: PRO, now: AFTER_PROMO });
        expect(offer.savings).toEqual({ dollars: config.postingPrice - PRO, percent: 28, comparedWith: config.postingPrice, basis: 'list-price' });
    });

    it('claims no saving when the next post costs no more than the renewal', () => {
        // The pro renewal equals the intro price: a renewal is no cheaper than that post.
        expect(PRO).toBe(config.introPrice);
        const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.introPrice, renewalPrice: PRO, now: AFTER_PROMO });
        expect(offer).toEqual({ purchasable: true, promoActive: false, price: PRO, savings: null });
    });

    it('during the promo the price is named and no saving is claimed, whichever price the row pays', () => {
        for (const renewalPrice of [config.renewalPrice, PRO]) {
            const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.postingPrice, renewalPrice, now: DURING_PROMO });
            expect(offer).toEqual({ purchasable: true, promoActive: true, price: renewalPrice, savings: null });
        }
    });

    it('while no renewal can be bought, no saving is claimed at either price', () => {
        for (const renewalPrice of [config.renewalPrice, PRO]) {
            expect(resolveRenewalOffer({ purchasable: false, nextPostPrice: config.postingPrice, renewalPrice, now: AFTER_PROMO }).savings).toBeNull();
        }
    });
});

describe('resolveRenewalOffer: when a saving may be claimed', () => {
    it('during the promo: no saving, even when a renewal can be bought', () => {
        for (const now of [DURING_PROMO, LAST_PROMO_INSTANT]) {
            const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.postingPrice, renewalPrice: BASE, now });
            expect(offer).toEqual({ purchasable: true, promoActive: true, price: config.renewalPrice, savings: null });
        }
    });

    it('while no renewal can be bought: no saving, promo or not', () => {
        expect(resolveRenewalOffer({ purchasable: false, now: DURING_PROMO }).savings).toBeNull();
        expect(resolveRenewalOffer({ purchasable: false, nextPostPrice: config.postingPrice, now: AFTER_PROMO }).savings).toBeNull();
        expect(resolveRenewalOffer({ purchasable: false, now: AFTER_PROMO }).purchasable).toBe(false);
    });

    it("after the promo: measured against the reader's own next new post", () => {
        const intro = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.introPrice, renewalPrice: BASE, now: AFTER_PROMO });
        expect(intro.promoActive).toBe(false);
        expect(intro.savings).toMatchObject({ basis: 'next-post', comparedWith: config.introPrice });
        const pro = resolveRenewalOffer({ purchasable: true, nextPostPrice: config.postingPrice, renewalPrice: BASE, now: AFTER_PROMO });
        expect(pro.savings).toMatchObject({ basis: 'next-post', comparedWith: config.postingPrice });
    });

    it('a free next post (a pack credit) gets no saving', () => {
        expect(resolveRenewalOffer({ purchasable: true, nextPostPrice: 0, renewalPrice: BASE, now: AFTER_PROMO }).savings).toBeNull();
    });

    it('an unknown next-post price compares with the standard post price and says so', () => {
        for (const nextPostPrice of [null, undefined]) {
            const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice, renewalPrice: BASE, now: AFTER_PROMO });
            expect(offer.savings).toMatchObject({ basis: 'list-price', comparedWith: config.postingPrice });
        }
    });
});

describe('renewalSavingsLabel: names the price it is measured against', () => {
    it('next-post and list-price wording, house style', () => {
        const next = renewalSavingsLabel(renewalSavings(config.introPrice, 'next-post')!);
        const list = renewalSavingsLabel(renewalSavings(config.postingPrice, 'list-price')!);
        expect(next).toBe(`Save 20% vs. your next new post at $${config.introPrice}`);
        expect(list).toBe(`Save 42% vs. the $${config.postingPrice} post price`);
        for (const label of [next, list]) {
            expect(label).not.toMatch(/[–—]|\s-\s/);
            expect(label).not.toContain('a new post');
        }
    });

    it("names the price it is measured against for the pro renewal as well", () => {
        const next = renewalSavingsLabel(renewalSavings(config.postingPrice, 'next-post', config.proRenewalPrice)!);
        const list = renewalSavingsLabel(renewalSavings(config.postingPrice, 'list-price', config.proRenewalPrice)!);
        expect(next).toBe(`Save 28% vs. your next new post at $${config.postingPrice}`);
        expect(list).toBe(`Save 28% vs. the $${config.postingPrice} post price`);
    });
});

describe('renewalSavingsLine: the claim the pages print, or nothing', () => {
    it('during the promo: no line, whatever the next post costs', () => {
        for (const now of [DURING_PROMO, LAST_PROMO_INSTANT]) {
            for (const nextPostPrice of [null, config.introPrice, config.postingPrice]) {
                expect(renewalSavingsLine({ purchasable: true, nextPostPrice, renewalPrice: BASE, now })).toBeNull();
            }
        }
    });

    it('after the promo: the label for the reader, naming the price it is measured against', () => {
        const ladderStart = new Date(config.promoEndsAt);
        expect(renewalSavingsLine({ purchasable: true, nextPostPrice: config.introPrice, renewalPrice: BASE, now: ladderStart }))
            .toBe(`Save 20% vs. your next new post at $${config.introPrice}`);
        expect(renewalSavingsLine({ purchasable: true, renewalPrice: BASE, now: AFTER_PROMO }))
            .toBe(`Save 42% vs. the $${config.postingPrice} post price`);
    });

    it("after the promo: the line for a row that pays the pro renewal is measured from that price", () => {
        const pro = { renewalPrice: config.proRenewalPrice, now: AFTER_PROMO };
        expect(renewalSavingsLine({ purchasable: true, nextPostPrice: config.postingPrice, ...pro }))
            .toBe(`Save 28% vs. your next new post at $${config.postingPrice}`);
        expect(renewalSavingsLine({ purchasable: true, ...pro }))
            .toBe(`Save 28% vs. the $${config.postingPrice} post price`);
        // The pro renewal is no cheaper than the intro post, and a free post beats any renewal.
        expect(renewalSavingsLine({ purchasable: true, nextPostPrice: config.introPrice, ...pro })).toBeNull();
        expect(renewalSavingsLine({ purchasable: true, nextPostPrice: 0, ...pro })).toBeNull();
    });

    it('during the promo: no line for the pro renewal either', () => {
        for (const now of [DURING_PROMO, LAST_PROMO_INSTANT]) {
            expect(renewalSavingsLine({ purchasable: true, nextPostPrice: config.postingPrice, renewalPrice: config.proRenewalPrice, now })).toBeNull();
        }
    });

    it('no line beside a renewal that cannot be bought, nor for a free next post', () => {
        expect(renewalSavingsLine({ purchasable: false, nextPostPrice: config.postingPrice, now: AFTER_PROMO })).toBeNull();
        expect(renewalSavingsLine({ purchasable: true, nextPostPrice: 0, renewalPrice: BASE, now: AFTER_PROMO })).toBeNull();
    });

    it('is exactly resolveRenewalOffer in renewalSavingsLabel words', () => {
        // A purchasable offer is always told its price; one that cannot be bought may leave it out.
        const inputs: RenewalOfferInputs[] = [];
        for (const now of [DURING_PROMO, LAST_PROMO_INSTANT, AFTER_PROMO]) {
            for (const nextPostPrice of [null, 0, config.introPrice, config.postingPrice]) {
                for (const renewalPrice of [config.renewalPrice, config.proRenewalPrice]) {
                    inputs.push({ purchasable: true, nextPostPrice, renewalPrice, now });
                }
                for (const renewalPrice of [undefined, config.renewalPrice, config.proRenewalPrice]) {
                    inputs.push({ purchasable: false, nextPostPrice, renewalPrice, now });
                }
            }
        }
        for (const input of inputs) {
            const offer = resolveRenewalOffer(input);
            expect(renewalSavingsLine(input)).toBe(offer.savings ? renewalSavingsLabel(offer.savings) : null);
        }
    });
});

describe('one rule for server and client', () => {
    it('lib/pricing re-exports the same functions, so server importers are unchanged', () => {
        expect(pricing.resolveRenewalOffer).toBe(resolveRenewalOffer);
        expect(pricing.renewalSavings).toBe(renewalSavings);
        expect(pricing.renewalSavingsLabel).toBe(renewalSavingsLabel);
        const pricingSrc = read('lib/pricing.ts');
        expect(pricingSrc).not.toMatch(/export function (renewalSavings|resolveRenewalOffer|renewalSavingsLabel)\b/);
        expect(pricingSrc).not.toMatch(/export interface (RenewalSavings|RenewalOffer)\b/);
    });

    it('lib/renewal-offer.ts stays client-safe: no Prisma and no lib/pricing, however deep', () => {
        // Every module a client bundle would load through it, following
        // in-repo imports. Type-only imports are erased from the bundle, but
        // Prisma and lib/pricing are refused even there.
        const importsOf = (rel: string): { spec: string; typeOnly: boolean }[] => {
            const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true);
            return sf.statements.flatMap((s) => {
                if ((ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)) {
                    const typeOnly = ts.isImportDeclaration(s) ? s.importClause?.isTypeOnly === true : s.isTypeOnly;
                    return [{ spec: s.moduleSpecifier.text, typeOnly }];
                }
                return [];
            });
        };
        /** Repo-relative file for an '@/' or relative specifier; null for a package. */
        const resolve = (from: string, spec: string): string | null => {
            if (!spec.startsWith('@/') && !spec.startsWith('.')) return null;
            const base = spec.startsWith('@/')
                ? spec.slice(2)
                : path.posix.join(path.posix.dirname(from), spec);
            const hit = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => fs.existsSync(path.join(ROOT, c)));
            if (!hit) throw new Error(`${from}: cannot resolve ${spec}`);
            return hit;
        };
        const seen = new Set<string>();
        const queue = ['lib/renewal-offer.ts'];
        const loaded: string[] = [];
        while (queue.length > 0) {
            const rel = queue.shift() as string;
            if (seen.has(rel)) continue;
            seen.add(rel);
            for (const { spec, typeOnly } of importsOf(rel)) {
                const file = resolve(rel, spec);
                expect(spec, `${rel} imports ${spec}`).not.toMatch(/prisma/i);
                expect(file, `${rel} imports ${spec}`).not.toBe('lib/pricing.ts');
                expect(file, `${rel} imports ${spec}`).not.toBe('lib/prisma.ts');
                if (typeOnly) continue;
                loaded.push(file ?? spec);
                if (file) queue.push(file);
            }
        }
        // Today that is lib/config alone, which imports nothing.
        expect(loaded).toEqual(['lib/config.ts']);
    });
});

describe('nextNewPostPrice: the reader-specific comparison price', () => {
    it('is unknown without a quota domain, and reads nothing', async () => {
        expect(await nextNewPostPrice({ quotaDomain: null, hasPackCredit: false, now: AFTER_PROMO })).toBeNull();
        expect(await nextNewPostPrice({ quotaDomain: undefined, hasPackCredit: false, now: AFTER_PROMO })).toBeNull();
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it('is 0 during the promo and with a usable pack credit, without a DB read', async () => {
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPackCredit: false, now: DURING_PROMO })).toBe(0);
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPackCredit: true, now: AFTER_PROMO })).toBe(0);
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it("is the intro price for a domain's first paid post, the post price after that", async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValueOnce(0 as never);
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPackCredit: false, now: AFTER_PROMO })).toBe(config.introPrice);
        vi.mocked(prisma.employerJob.count).mockResolvedValueOnce(2 as never);
        expect(await nextNewPostPrice({ quotaDomain: DOMAIN, hasPackCredit: false, now: AFTER_PROMO })).toBe(config.postingPrice);
    });
});

/**
 * The two client copies of the rule, verbatim as they stood before they
 * moved to lib/renewal-offer.ts (EmployerDashboardClient#renewalSavingsLine
 * and the edit page's listPriceSavingsLine). They are the oracle: the shared
 * rule must print exactly what each page printed, for every price and date.
 */
function dashboardLineBeforeTheMove(nextPostPrice: number | null, now: Date): string | null {
    if (config.isPromoActive(now)) return null;
    const comparedWith = nextPostPrice ?? config.postingPrice;
    if (!Number.isFinite(comparedWith) || comparedWith <= config.renewalPrice) return null;
    const percent = Math.floor(((comparedWith - config.renewalPrice) / comparedWith) * 100);
    if (percent < 1) return null;
    return nextPostPrice === null
        ? `Save ${percent}% vs. the $${comparedWith} post price`
        : `Save ${percent}% vs. your next new post at $${comparedWith}`;
}

function editPageLineBeforeTheMove(now: Date): string | null {
    if (config.isPromoActive(now)) return null;
    const comparedWith = config.postingPrice;
    if (comparedWith <= config.renewalPrice) return null;
    const percent = Math.floor(((comparedWith - config.renewalPrice) / comparedWith) * 100);
    return percent < 1 ? null : `Save ${percent}% vs. the $${comparedWith} post price`;
}

describe('client surfaces use the shared rule', () => {
    const DATES = [DURING_PROMO, LAST_PROMO_INSTANT, new Date(config.promoEndsAt), AFTER_PROMO];

    it('the dashboard line is unchanged by the move, for every price and date', () => {
        const prices: (number | null)[] = [null, 0, config.renewalPrice - 1, config.renewalPrice, config.renewalPrice + 1, config.introPrice, config.postingPrice];
        for (const now of DATES) {
            for (const nextPostPrice of prices) {
                const offer = resolveRenewalOffer({ purchasable: true, nextPostPrice, renewalPrice: BASE, now });
                const expected = offer.savings ? renewalSavingsLabel(offer.savings) : null;
                const line = renewalSavingsLine({ purchasable: true, nextPostPrice, renewalPrice: BASE, now });
                expect(line, `${now.toISOString()} / ${nextPostPrice}`).toBe(expected);
                expect(line, `${now.toISOString()} / ${nextPostPrice}`).toBe(dashboardLineBeforeTheMove(nextPostPrice, now));
            }
        }
    });

    it('the edit page line (no quota domain) is unchanged: the named post price, never during the promo', () => {
        for (const now of DATES) {
            expect(renewalSavingsLine({ purchasable: true, renewalPrice: BASE, now }), now.toISOString()).toBe(editPageLineBeforeTheMove(now));
        }
        expect(renewalSavingsLine({ purchasable: true, renewalPrice: BASE, now: DURING_PROMO })).toBeNull();
        expect(renewalSavingsLine({ purchasable: true, renewalPrice: BASE, now: AFTER_PROMO })).toBe(`Save 42% vs. the $${config.postingPrice} post price`);
    });

    it('both pages call the shared rule and keep no copy of it', () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(dashboard).toContain("import { renewalSavingsLine } from '@/lib/renewal-offer';");
        // The row being renewed pays its own renewal price, so the saving is measured from it.
        expect(dashboard).toContain('const selectedRenewalPrice = selectedJob?.renewalPrice ?? config.renewalPrice;');
        expect(dashboard).toContain('const savingsLine = renewalSavingsLine({ purchasable: renewalPurchasable, nextPostPrice, renewalPrice: selectedRenewalPrice });');
        expect(edit).toContain("import { renewalSavingsLine } from '@/lib/renewal-offer';");
        // No quota domain on this page, so no next-post price: the list-price basis.
        expect(edit).toContain('const renewalPrice = employerJob?.renewalPrice ?? config.renewalPrice;');
        expect(edit).toContain('const savingsLine = renewalSavingsLine({ purchasable: renewalPurchasable, renewalPrice });');
        for (const [rel, src] of [['dashboard', dashboard], ['edit page', edit]] as const) {
            expect(src, rel).not.toMatch(/function (renewalSavingsLine|listPriceSavingsLine)\b/);
            // Subtracting the renewal price is computing a saving: only lib/renewal-offer does that.
            expect(src, rel).not.toMatch(/-\s*config\.renewalPrice\b/);
            // Neither can load the Prisma-backed module.
            expect(src, rel).not.toContain("from '@/lib/pricing'");
            // Printed only when the rule claims a saving; it is null otherwise.
            expect(src, rel).toContain('{savingsLine && (');
        }
    });

    it("both pages print, and report to GA, the renewal price of the row being renewed", () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        const edit = read('app/jobs/edit/[token]/page.tsx');
        // The server sends each row's price (lib/renewal-price.ts); the pages never decide it.
        expect(dashboard).toMatch(/interface Job \{[^}]*\brenewalPrice: number;/);
        expect(edit).toMatch(/interface EmployerJobData \{[^}]*\brenewalPrice: number;/);
        expect(dashboard).toContain("trackBeginCheckout(selectedRenewalPrice * 100, 'renewal');");
        expect(edit).toContain("trackBeginCheckout(renewalPrice * 100, 'renewal');");
        expect(dashboard).toContain('>${selectedRenewalPrice}</span>');
        expect(edit).toContain('>${renewalPrice}</span>');
        for (const [rel, src] of [['dashboard', dashboard], ['edit page', edit]] as const) {
            // The base price is a list fact, never the price of a row.
            expect(src, rel).not.toContain('config.stripeRenewalPriceInCents');
            expect(src, rel).not.toContain('>${config.renewalPrice}</span>');
            // Neither page works out the rung: it has neither the ledger nor lib/renewal-price.
            expect(src, rel).not.toContain('@/lib/renewal-price');
            expect(src, rel).not.toContain('proRenewalPrice');
            // The legacy free-trial modal states the lowest renewal price.
            expect(src, rel).toContain('Renewals from ${config.renewalPrice} (+{config.durationDays} days) are available for posts made under our current pricing.');
            expect(src, rel).not.toContain('Renewals at $');
        }
    });

    it('no surface computes the old list-price-only discount any more', () => {
        const oldFormula = /1 - config\.renewalPrice \/ config\.postingPrice/;
        for (const rel of [
            'components/employer/EmployerDashboardClient.tsx',
            'app/jobs/edit/[token]/page.tsx',
            'lib/email-service.ts',
            'app/api/cron/expiry-warnings/route.ts',
        ]) {
            const src = read(rel);
            expect(src, rel).not.toMatch(oldFormula);
            expect(src, rel).not.toMatch(/vs\. a new post/);
        }
    });

    it('both pages learn availability from the existing endpoint and sell a renewal only when it is on', () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        expect(dashboard).toContain("readJson<{ available?: boolean }>('/api/create-checkout/availability')");
        expect(dashboard).toContain("readJson<{ eligible?: boolean; price?: number }>('/api/employer/free-quota-status')");
        expect(dashboard).toContain('const renewalPurchasable = paidPostingAvailable === true;');
        // The Renew action appears only once availability is known, and only with something to offer.
        expect(dashboard).toContain('const canOfferRenewAction = paidPostingAvailable !== null && (renewalPurchasable || promoActive);');
        expect(dashboard).toContain('{mounted && shouldShowRenew(job) && canOfferRenewAction && (');
        // Both renewal modals need a purchasable renewal; otherwise the free repost modal opens.
        expect(dashboard).toContain("{showRenewModal && selectedJob && renewalPurchasable && selectedJob.paymentStatus === 'free' && (");
        expect(dashboard).toContain("{showRenewModal && selectedJob && renewalPurchasable && selectedJob.paymentStatus !== 'free' && (");
        expect(dashboard).toContain('{showRenewModal && selectedJob && !renewalPurchasable && (');
        expect(dashboard).toContain('if (!selectedJob || !renewalPurchasable) return;');

        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(edit).toContain("fetch('/api/create-checkout/availability')");
        expect(edit).toContain('const offerRenewal = canRenew && renewalPurchasable;');
        expect(edit).toContain("{showRenewModal && job && renewalPurchasable && employerJob?.paymentStatus === 'free' && (");
        expect(edit).toContain("{showRenewModal && job && employerJob?.paymentStatus !== 'free' && offerRenewal && (");
        expect(edit).toContain('if (!job || !renewalPurchasable) return;');
    });

    it('during the promo the pages offer the free repost, dated with the promo end', () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        expect(dashboard).toContain('`Renewal is not available yet. Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`');
        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(edit).toContain('` Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`');
        for (const src of [dashboard, edit]) {
            expect(src).toContain('Or post this role again as a fresh listing, free through {config.promoEndsLabel}.');
        }
    });

    it('the renewal modals describe a renewal as the webhook applies it', () => {
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(dashboard).toContain('It does not add unlocks or InMails. Renewals can extend a post to at most {config.renewalCapDays} days after it was first posted.');
        expect(edit).toContain('<li>Does not add unlocks or InMails</li>');
        expect(edit).toContain('<li>Renewals can extend a post to at most {config.renewalCapDays} days after it was first posted</li>');
        expect(edit).not.toContain('(top of list)');
        for (const src of [dashboard, edit]) expect(src).not.toContain('new bucket of');
    });

    it('neither page promises a plan slot: the Employer plan is retired and its code deleted', () => {
        // A legacy 'plan' row stays non-renewable on both pages (the
        // dashboard's rule in lib/employer-dashboard-rules.ts, the edit page's
        // renewableStatus), but nothing tells its owner to post into a free
        // slot, and toggle-publish answers 402 to a republish.
        const dashboard = read('components/employer/EmployerDashboardClient.tsx');
        const edit = read('app/jobs/edit/[token]/page.tsx');
        expect(edit).toContain("const renewableStatus = employerJob?.paymentStatus !== 'plan'");
        for (const src of [dashboard, edit]) {
            expect(src).not.toMatch(/free slot|plan slot again|Employer plan slot|while you(?:&apos;|')re subscribed/);
            expect(src).not.toContain('Each plan post runs');
            expect(src).not.toContain('from a plan slot');
            expect(src).not.toMatch(/live while (the|your) (Employer )?plan/);
        }
    });
});

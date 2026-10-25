/**
 * The employer application switches from the launch promo to the ladder at
 * config.promoEndsAt, on its own, with no deploy (backlog 2.1).
 *
 * While the promo runs these surfaces say every post is free through
 * config.promoEndsLabel, exactly as before. From the instant it ends they
 * state the ladder as the current price, and never "free", "launch promo",
 * "launch period" or "From January 1, 2027" as a current offer:
 *   - the /post-job wizard: its subtitle and Step 5 come from
 *     postJobPricingCopy(now), called on render (the Step 5 line used to
 *     print "From January 1, 2027: ..." after that date);
 *   - the /post-job/preview package line and caption, the dashboard usage
 *     strip and the checkout banner: a 'promo' quote fetched before the
 *     boundary counts only while the promo runs (lib/next-post-quote.ts);
 *   - the candidate profile upgrade card, gated on config.isPromoActive().
 * The dashboard's job rows and modals and the job edit page are rendered in
 * both phases in tests/regressions/employer-dashboard-edit-render.test.ts;
 * the last block here pins only that each decides the phase once per render.
 *
 * Every case runs at an explicit instant. The client pages render through
 * renderToStaticMarkup with their useState values seeded in order (effects
 * do not run there), as tests/regressions/checkout-page-server-quote.test.ts
 * does for the checkout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { config } from '@/lib/config';
import { LADDER_PRICES, packUseByLabel } from '@/lib/pricing-copy';
import { postJobPricingCopy } from '@/app/post-job/_lib/post-job-pricing-copy';
import PreviewPage from '@/app/post-job/preview/page';
import UsageWidget from '@/components/employer/UsageWidget';
import CandidateProfileClient from '@/components/employer/CandidateProfileClient';

const seeded = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: (initial: unknown) => {
            const i = seeded.index++;
            const value = i < seeded.values.length
                ? seeded.values[i]
                : typeof initial === 'function' ? (initial as () => unknown)() : initial;
            return [value, () => undefined];
        },
    };
});

vi.mock('next/link', async () => {
    const { createElement } = await vi.importActual<typeof import('react')>('react');
    return {
        default: ({ href, children }: { href: string; children?: React.ReactNode }) => createElement('a', { href }, children),
    };
});
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/analytics', () => ({ trackFreePostLimitHit: vi.fn() }));
vi.mock('@/components/JobCard', () => ({ default: () => null }));
vi.mock('@/components/employer/ComposeMessageModal', () => ({ default: () => null }));

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LAST_PROMO_INSTANT = new Date(Date.parse(config.promoEndsAt) - 1);
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');

/** Promo language that must never be a current offer once the promo has ended. */
const PROMO_OFFER = /\bfree\b|launch promo|launch period|\$0\b/i;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

function render(component: React.ComponentType, state: unknown[]): string {
    seeded.values = state;
    seeded.index = 0;
    return renderToStaticMarkup(React.createElement(component));
}

/** GET /api/employer/free-quota-status payloads, as lib/pricing.ts#quoteForMode shapes them. */
const PROMO_QUOTE = { eligible: true, mode: 'promo', tier: 'pro', willBeFree: true, price: 0, priceCents: 0, durationDays: config.durationDays, promoEndsLabel: config.promoEndsLabel };
const INTRO_QUOTE = { eligible: true, mode: 'intro', tier: 'intro', willBeFree: false, price: config.introPrice, priceCents: config.stripeIntroPriceInCents, durationDays: config.durationDays };
/** A usable 5-post pack credit (2027 re-price, phase 3): 3 of 5 left. */
const PACK_EXPIRES = '2027-12-01T12:00:00.000Z';
const PACK_QUOTE = {
    eligible: true, mode: 'pack', tier: 'pack', willBeFree: true, price: 0, priceCents: 0, durationDays: config.durationDays,
    pack: { remaining: 3, used: config.packPosts - 3, total: config.packPosts, expiresAt: PACK_EXPIRES },
};

describe('/post-job wizard: postJobPricingCopy', () => {
    it('during the promo: the sentences the wizard has always printed', () => {
        for (const now of [DURING_PROMO, LAST_PROMO_INSTANT]) {
            expect(postJobPricingCopy(now)).toEqual({
                subtitle: `Free through ${config.promoEndsLabel}. Every feature included, no credit card required.`,
                packageIntro: 'Every job post gets the full package, free or paid',
                packagePrice: `Free through ${config.promoEndsLabel}`,
            });
        }
    });

    it('from the instant it ends: the ladder as the current price, undated', () => {
        for (const now of [LADDER_START, LATER]) {
            const copy = postJobPricingCopy(now);
            expect(copy.subtitle).toBe(`Every feature included. ${LADDER_PRICES}`);
            expect(copy.packagePrice).toBe(LADDER_PRICES);
            expect(copy.packageIntro).toBe('Every job post gets the full package');
            for (const line of Object.values(copy)) {
                expect(line).not.toMatch(PROMO_OFFER);
                expect(line).not.toContain(config.ladderStartsLabel);
                expect(line).not.toContain(config.promoEndsLabel);
                expect(line).not.toMatch(/[–—]|\s-\s/);
            }
        }
    });

    it('reads the clock when it is called, not when the module loads', () => {
        vi.setSystemTime(DURING_PROMO);
        expect(postJobPricingCopy().packagePrice).toBe(`Free through ${config.promoEndsLabel}`);
        vi.setSystemTime(LATER);
        expect(postJobPricingCopy().packagePrice).toBe(LADDER_PRICES);
    });

    it('the wizard renders it on every render and keeps no phase copy of its own', () => {
        const page = read('app/post-job/page.tsx');
        const content = page.slice(page.indexOf('function PostJobContent()'), page.indexOf('export default function PostJobPage'));
        expect(page).toContain("import { postJobPricingCopy } from './_lib/post-job-pricing-copy';");
        expect(content).toContain('const pricingCopy = postJobPricingCopy();');
        for (const field of ['subtitle', 'packageIntro', 'packagePrice']) {
            expect(content).toContain(`{pricingCopy.${field}}`);
        }
        // The dated ladder sentence and the inline promo branches are gone.
        expect(page).not.toContain('config.ladderStartsLabel');
        expect(page).not.toContain('config.isPromoActive()');
        expect(page).not.toContain('free or paid');
    });
});

describe('/post-job/preview: the package line and caption', () => {
    const FORM = {
        title: 'Nurse Practitioner, Telehealth',
        companyName: 'Clinic Co',
        location: 'Remote',
        mode: 'Remote',
        jobType: 'Full-Time',
        description: '<p>Role</p>',
        applyUrl: 'https://clinic.example/apply',
        contactEmail: 'hiring@clinic.example',
        pricingTier: 'pro',
    };
    // useState order: formData, loading, isLoading, error, fetchedQuotaStatus, paidPostingAvailable.
    const renderPreview = (quote: object | null): string => render(PreviewPage, [FORM, false, false, null, quote, true]);

    it('during the promo: free through the promo end, as before', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        const html = renderPreview(PROMO_QUOTE);
        expect(html).toContain(`Free through ${config.promoEndsLabel}, live for ${config.durationDays} days`);
        expect(html).toContain(`Every post is free during our launch period through ${config.promoEndsLabel}. No credit card required.`);
        expect(html).toContain('Looks Good, Post Job');
    });

    it('a promo quote rendered after the promo ends claims nothing free', () => {
        vi.setSystemTime(LADDER_START);
        const html = renderPreview(PROMO_QUOTE);
        expect(html).not.toMatch(PROMO_OFFER);
        expect(html).not.toContain(config.promoEndsLabel);
        expect(html).toContain(`Live for ${config.durationDays} days`);
        // The server prices the post when the employer continues.
        expect(html).toContain('Looks Good, Post Job');
    });

    it('after the promo the quoted rung is the price, in the present tense', () => {
        vi.setSystemTime(LATER);
        const html = renderPreview(INTRO_QUOTE);
        expect(html).toContain(`$${config.introPrice} today, the intro price for your first post`);
        expect(html).toContain(`Continue to Payment: $${config.introPrice}`);
        expect(html).not.toMatch(PROMO_OFFER);
    });

    it('a 5-post pack credit: posted from the pack, captioned "Included in your post pack." (D19), with no payment', () => {
        vi.setSystemTime(LATER);
        const html = renderPreview(PACK_QUOTE);
        expect(html).toContain(`From your ${config.packPosts}-post pack, live for ${config.durationDays} days`);
        expect(html).toContain(`2 of ${config.packPosts} pack posts left after this one`);
        expect(html).toContain('Included in your post pack.');
        expect(html).toContain('Looks Good, Post Job');
        expect(html).not.toContain('Continue to Payment');
        expect(html).not.toMatch(/launch promo|launch period|\$0\b|Employer plan|plan slot/i);
    });

    it('sends a pack post to /success?mode=pack, as a promo post to ?mode=promo', () => {
        const src = read('app/post-job/preview/page.tsx');
        expect(src).toContain("const postedMode = result.mode === 'pack' || result.mode === 'promo' ? result.mode : null;");
        expect(src).toContain('router.push(postedMode ? `/success?mode=${postedMode}` : \'/success?free=true\');');
        expect(src).not.toMatch(/result\.mode === 'plan'/);
    });
});

describe('dashboard usage strip: the Plan card', () => {
    const USAGE = {
        tier: 'pro',
        tierLabel: 'Pro',
        usage: {
            candidateUnlocks: { used: 0, limit: config.limits.candidateUnlocksPerPosting, unlimited: false },
            inmails: { used: 0, limit: config.limits.inmailsPerPosting, unlimited: false },
        },
    };
    // useState order: data, quota, loading, packs (GET /api/employer/post-packs).
    // The strip reads no plan status any more: the Employer plan is retired
    // (owner decision 2026-10-24); the 5-post pack took its card's action.
    const renderStrip = (quote: object | null, packs: object | null = null): string => render(UsageWidget, [USAGE, quote, false, packs]);
    /** The retired plan's pitch, in any of the forms the strip used to print. */
    const PLAN_PITCH = /Employer plan|Subscribe|Contact us|Manage billing|\/mo\b|slots? used/;

    it('during the promo: "Launch promo", free through the promo end, no plan pitch', () => {
        vi.setSystemTime(DURING_PROMO);
        const html = renderStrip(PROMO_QUOTE);
        expect(html).toContain('Launch promo');
        expect(html).toContain(`Free through ${config.promoEndsLabel}`);
        expect(html).not.toMatch(PLAN_PITCH);
    });

    it('a promo quote still on screen after the promo ends drops the promo label, and pitches no plan', () => {
        vi.setSystemTime(LADDER_START);
        const html = renderStrip(PROMO_QUOTE);
        expect(html).not.toMatch(PROMO_OFFER);
        expect(html).not.toContain(config.promoEndsLabel);
        expect(html).not.toMatch(PLAN_PITCH);
    });

    it('after the promo: the next post price, and no plan pitch beside it', () => {
        vi.setSystemTime(LATER);
        const html = renderStrip(INTRO_QUOTE);
        expect(html).toContain(`Next post $${config.introPrice}`);
        expect(html).not.toMatch(PROMO_OFFER);
        expect(html).not.toMatch(PLAN_PITCH);
    });

    it('calls no plan endpoint and reads no plan price', () => {
        const src = read('components/employer/UsageWidget.tsx');
        expect(src).not.toMatch(/\/api\/employer\/(?:plan|billing-portal)\b/);
        expect(src).not.toContain('config.planPrice');
        expect(src).not.toContain('config.planSlots');
    });

    describe('the 5-post pack (2027 re-price, phase 3)', () => {
        const BUY = `Buy ${config.packPosts} posts · ${config.formatDollars(config.packPrice)}`;
        const credit = (remaining: number) => ({ remaining, used: config.packPosts - remaining, total: config.packPosts, expiresAt: PACK_EXPIRES });
        const PAID_QUOTE = { eligible: true, mode: 'paid', tier: 'pro', willBeFree: false, price: config.postingPrice, priceCents: config.stripePriceInCents, durationDays: config.durationDays };

        it('a usable credit: "N of 5 posts left" and the date to use them by', () => {
            vi.setSystemTime(LATER);
            const html = renderStrip(PACK_QUOTE, { saleOpen: false, credit: credit(3) });
            expect(html).toContain(`3 of ${config.packPosts} posts left`);
            expect(html).toContain(`Use by ${packUseByLabel(new Date(PACK_EXPIRES))}`);
            expect(html).not.toContain(BUY);
        });

        it('while the sale is open: a way to buy the pack, to /employer/post-pack', () => {
            vi.setSystemTime(LATER);
            const html = renderStrip(INTRO_QUOTE, { saleOpen: true, credit: null });
            expect(html).toContain(`<a href="/employer/post-pack"`);
            expect(html).toContain(BUY);
            // The card still states the next post's price.
            expect(html).toContain(`Next post $${config.introPrice}`);
        });

        it('a used-up pack: "5 of 5 posts used", then the next post price', () => {
            vi.setSystemTime(LATER);
            const html = renderStrip(PAID_QUOTE, { saleOpen: true, credit: credit(0) });
            expect(html).toContain(`${config.packPosts} of ${config.packPosts} posts used`);
            expect(html).toContain(`Next post $${config.postingPrice}`);
            expect(html).toContain(BUY);
        });

        it('takes the credit from the quote when the pack list is not there', () => {
            vi.setSystemTime(LATER);
            const html = renderStrip(PACK_QUOTE, null);
            expect(html).toContain(`3 of ${config.packPosts} posts left`);
            expect(html).not.toContain(BUY);
        });

        it('while the promo runs the promo wins, as it does when posting, and nothing is sold', () => {
            vi.setSystemTime(DURING_PROMO);
            const html = renderStrip(PROMO_QUOTE, { saleOpen: false, credit: credit(5) });
            expect(html).toContain('Launch promo');
            expect(html).not.toContain(BUY);
            expect(html).not.toMatch(PLAN_PITCH);
        });

        it('reads the pack list from GET /api/employer/post-packs', () => {
            expect(read('components/employer/UsageWidget.tsx')).toContain("fetch('/api/employer/post-packs')");
        });
    });
});

describe('candidate profile: the upgrade card', () => {
    const LOCKED = {
        id: 'cand-1',
        displayName: 'A. Candidate',
        initials: 'AC',
        avatarUrl: null,
        headline: null,
        bio: null,
        yearsExperience: 3,
        certifications: [],
        licenseStates: [],
        specialties: [],
        preferredWorkMode: null,
        preferredJobType: null,
        availableDate: null,
        salaryRange: null,
        hasResume: false,
        linkedinUrl: null,
        joinedAt: '2026-01-15T00:00:00.000Z',
        hasFullAccess: false,
        contactEmail: null,
        resumeUrl: null,
    };
    // useState order: candidate, loading, error, errorReason, showContact,
    // showCompose, postingJobId, postingJobTitle.
    const Profile = () => React.createElement(CandidateProfileClient, { candidateId: 'cand-1' });
    const renderProfile = (): string => render(Profile, [LOCKED, false, '', null, false, false, undefined, undefined]);

    it('free through the promo end only while the promo runs', () => {
        vi.setSystemTime(LAST_PROMO_INSTANT);
        expect(renderProfile()).toContain(`Post a job to unlock candidate profiles, free through ${config.promoEndsLabel}.`);

        vi.setSystemTime(LADDER_START);
        const after = renderProfile();
        expect(after).toContain('Post a job to unlock candidate profiles.');
        expect(after).not.toMatch(PROMO_OFFER);
    });
});

describe('no surface decides the phase at module load', () => {
    const SURFACES = [
        'app/post-job/page.tsx',
        'app/post-job/preview/page.tsx',
        'app/post-job/checkout/page.tsx',
        'app/post-job/_lib/post-job-pricing-copy.ts',
        'components/employer/UsageWidget.tsx',
        'components/employer/CandidateProfileClient.tsx',
        'components/employer/EmployerDashboardClient.tsx',
        'app/jobs/edit/[token]/page.tsx',
        'lib/renewal-offer.ts',
        'lib/next-post-quote.ts',
        'lib/hooks/useRerenderAtPromoEnd.ts',
    ];
    /** Anything whose value depends on the promo phase. */
    const PHASE = /promoEndsLabel|ladderStartsLabel|isPromoActive|PROMO_HEADLINE|PROMO_SUB|ladderLine|postJobPricingCopy|currentQuote|renewalSavingsLine|resolveRenewalOffer/;

    it('module-scope constants hold no phase-dependent value (functions decide per call)', () => {
        for (const rel of SURFACES) {
            const src = read(rel);
            const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
            const moduleScope = sf.statements
                .filter(ts.isVariableStatement)
                .flatMap((s) => s.declarationList.declarations)
                // A function value is fine: its body runs per call.
                .filter((d) => d.initializer && !ts.isArrowFunction(d.initializer) && !ts.isFunctionExpression(d.initializer))
                .filter((d) => PHASE.test((d.initializer as ts.Expression).getText(sf)))
                .map((d) => d.name.getText(sf));
            expect(moduleScope, rel).toEqual([]);
        }
    });
});

describe('dashboard and edit page: one phase decision per render', () => {
    it('the legacy free-trial modal branches on the same promoActive as the rest of the page', () => {
        for (const rel of ['components/employer/EmployerDashboardClient.tsx', 'app/jobs/edit/[token]/page.tsx']) {
            const src = read(rel);
            expect(src, rel).toContain('const promoActive = config.isPromoActive();');
            expect(src.match(/config\.isPromoActive\(/g), rel).toHaveLength(1);
            expect(src, rel).toContain("{promoActive ? 'Post a New Job for Free' : 'Post a New Job'}");
        }
    });
});

/**
 * Expiry warning email truth (package RENEWAL-OFFER).
 *
 * Before: every non-plan expiry warning said "Renew for $179 (Save 40%)"
 * in its heading and preheader. During the launch promo a new post is free,
 * so the saving was false; while paid posting is off the renewal link ends
 * in a 503; and a domain whose next post is the $199 intro price saves far
 * less than 40%. Promo posts made now get this email from about 2026-11-21.
 *
 * After: the email offers exactly what the employer can do next:
 *   renew        — only when the caller confirmed a renewal can be bought;
 *                  a saving is named only after the promo, against the
 *                  employer's own next new-post price (or the named
 *                  standard post price when unknown), never when it is not
 *                  cheaper
 *   promo_repost — no renewal on sale during the promo: post again free
 *                  through config.promoEndsLabel
 *   paid_repost  — no renewal on sale after the promo, but new posts can be
 *                  bought: post again at the ladder price, present tense
 *                  (backlog 2.1: the free wording stops at config.promoEndsAt)
 *   none         — nothing on sale after the promo: no offer at all
 *
 * A legacy 'plan' row (the Employer plan is retired and its code deleted,
 * phase 4 of the 2027 re-price) is a row the renewal checkout refuses, so it
 * gets the repost offers above, and no email names a plan slot any more.
 *
 * The REAL email-service runs (the global setup mocks it); Resend is mocked
 * to capture the HTML and the plain-text part sendAndLog derives from it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { ExpiryWarningOptions } from '@/lib/email-service';
import { LADDER_PRICES } from '@/lib/pricing-copy';

vi.unmock('@/lib/email-service');

const resendSendMock = vi.fn().mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
vi.mock('resend', () => ({
    Resend: vi.fn().mockImplementation(() => ({
        emails: { send: resendSendMock },
        batch: { send: vi.fn().mockResolvedValue({ data: [], error: null }) },
    })),
}));

import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';

const DURING_PROMO = new Date('2026-11-21T12:00:00.000Z');
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');
const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
/** Free posting offered as a current deal: never true once the promo is over. */
const FREE_REPOST = /free through|for free|at no charge|launch (period|promo)/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE = 'Nurse Practitioner, Primary Care';
const RENEWAL = `$${config.renewalPrice}`;
const DASHES = /[–—]/;

interface Sent {
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
}

async function sendWarning(options: ExpiryWarningOptions): Promise<Sent> {
    const { sendExpiryWarningEmail } = await import('@/lib/email-service');
    const now = options.now ?? DURING_PROMO;
    const expiresAt = new Date(now.getTime() + 5 * DAY_MS);
    const result = await sendExpiryWarningEmail('employer@clinic.example', TITLE, expiresAt, 120, 8, 'dash-token', null, options);
    expect(result.success).toBe(true);
    return resendSendMock.mock.calls.at(-1)![0] as Sent;
}

/** The metadata the EmailSend log row was written with. */
function loggedMetadata(): Record<string, unknown> {
    const call = vi.mocked(prisma.emailSend.create).mock.calls.at(-1)![0] as { data: { metadata: Record<string, unknown> } };
    return call.data.metadata;
}

/** Every renderable part of the message: subject, HTML body and the text part. */
function parts(sent: Sent): string[] {
    return [sent.subject, sent.html, sent.text];
}

// The first import of the real email service is a cold transform of its
// whole module graph (it outran the first test's 30s budget on a loaded
// machine); pay for it once, in a hook with its own budget.
beforeAll(async () => {
    await import('@/lib/email-service');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = 'test-key';
    resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ isSuppressed: false, unsubscribeToken: 'tok-abc-123' } as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

describe('expiry warning: during the launch promo', () => {
    it('with paid posting off: no renewal, post again free through the promo end', async () => {
        const sent = await sendWarning({ paymentStatus: 'promo', renewalPurchasable: false, now: DURING_PROMO });
        for (const part of parts(sent)) {
            expect(part).not.toContain(RENEWAL);
            expect(part).not.toMatch(/save \d+%/i);
        }
        expect(sent.subject).not.toMatch(/renew/i);
        expect(sent.text).toContain(`Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`);
        expect(sent.html).toContain('/post-job');
        expect(loggedMetadata()).toMatchObject({ offer: 'promo_repost', paymentStatus: 'promo' });
    }, 30_000);

    it('omitting the availability flag never offers a renewal (fails closed)', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', now: DURING_PROMO });
        expect(sent.text).not.toContain(RENEWAL);
        expect(loggedMetadata()).toMatchObject({ offer: 'promo_repost' });
    });

    it('with paid posting on: the renewal is offered with no saving claimed, plus the free repost', async () => {
        const sent = await sendWarning({ paymentStatus: 'promo', renewalPurchasable: true, renewalPrice: config.renewalPrice, nextPostPrice: config.postingPrice, now: DURING_PROMO });
        expect(sent.text).toContain(`Renew for ${RENEWAL}`);
        for (const part of parts(sent)) expect(part).not.toMatch(/save \d+%/i);
        expect(sent.text).toContain(`Or post this role again as a fresh listing, free through ${config.promoEndsLabel}.`);
        expect(loggedMetadata()).toMatchObject({ offer: 'renew' });
    });

    it('describes a renewal as apply-renewal.ts performs it: days only, within the cap', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, renewalPrice: config.renewalPrice, now: DURING_PROMO });
        expect(sent.text).toContain(`Adds ${config.durationDays} days to your current expiration, so renewing early doesn't lose any remaining days. It does not add unlocks or InMails.`);
        expect(sent.text).toContain(`Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.`);
        expect(sent.text).not.toMatch(/expiration plus a fresh/);
        // Unlocked profiles are served only while the candidate stays visible.
        expect(sent.text).toContain('stay in your dashboard after expiry, for as long as they keep their profile visible and open to opportunities.');
    });
});

describe('expiry warning: after the promo, paid posting on', () => {
    // Percents round DOWN (lib/renewal-offer.ts): $199 against the $249 intro
    // price is 20.08%, against the $349 post price 42.98%.
    it("names the saving against the employer's own next post: the intro price", async () => {
        const sent = await sendWarning({ paymentStatus: 'promo', renewalPurchasable: true, renewalPrice: config.renewalPrice, nextPostPrice: config.introPrice, now: AFTER_PROMO });
        expect(sent.html).toContain(`Renew for ${RENEWAL} (Save 20% vs. your next new post at $${config.introPrice})`);
        expect(sent.html).toContain(`Renew for ${RENEWAL} and save 20% vs. your next new post at $${config.introPrice}.`);
        expect(sent.html).not.toContain('42%');
    });

    it('against the post price for a domain that already bought a post', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, renewalPrice: config.renewalPrice, nextPostPrice: config.postingPrice, now: AFTER_PROMO });
        expect(sent.html).toContain(`(Save 42% vs. your next new post at $${config.postingPrice})`);
    });

    it('against the named standard post price when the next price is unknown', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, renewalPrice: config.renewalPrice, nextPostPrice: null, now: AFTER_PROMO });
        expect(sent.html).toContain(`(Save 42% vs. the $${config.postingPrice} post price)`);
    });

    it('claims no saving when the next post is free (a pack credit)', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, renewalPrice: config.renewalPrice, nextPostPrice: 0, now: AFTER_PROMO });
        expect(sent.text).toContain(`Renew for ${RENEWAL}`);
        for (const part of parts(sent)) expect(part).not.toMatch(/save \d+%/i);
    });

    it('never offers a renewal to a legacy free row, which the renewal checkout refuses', async () => {
        const sent = await sendWarning({ paymentStatus: 'free', renewalPurchasable: true, renewalPrice: config.renewalPrice, nextPostPrice: config.postingPrice, now: AFTER_PROMO });
        expect(sent.text).not.toContain(RENEWAL);
        expect(loggedMetadata()).toMatchObject({ offer: 'none' });
    });
});

describe("expiry warning: a post bought at the posting price renews for its own price", () => {
    const PRO_RENEWAL = `$${config.proRenewalPrice}`;

    it('names the pro renewal and measures the saving against it', async () => {
        // $249 against the $349 next post is 28.65%, rounded down.
        const sent = await sendWarning({
            paymentStatus: 'paid',
            renewalPurchasable: true,
            nextPostPrice: config.postingPrice,
            renewalPrice: config.proRenewalPrice,
            now: AFTER_PROMO,
        });
        expect(sent.html).toContain(`Renew for ${PRO_RENEWAL} (Save 28% vs. your next new post at $${config.postingPrice})`);
        expect(sent.html).toContain(`Renew for ${PRO_RENEWAL} and save 28% vs. your next new post at $${config.postingPrice}.`);
        expect(sent.html).not.toContain(RENEWAL);
        expect(sent.html).not.toContain('42%');
    });

    it('against the named standard post price when the next price is unknown', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, renewalPrice: config.proRenewalPrice, now: AFTER_PROMO });
        expect(sent.html).toContain(`(Save 28% vs. the $${config.postingPrice} post price)`);
    });

    it('claims no saving when the next post costs the same as the renewal', async () => {
        const sent = await sendWarning({
            paymentStatus: 'paid',
            renewalPurchasable: true,
            nextPostPrice: config.introPrice,
            renewalPrice: config.proRenewalPrice,
            now: AFTER_PROMO,
        });
        expect(sent.text).toContain(`Renew for ${PRO_RENEWAL}`);
        for (const part of parts(sent)) expect(part).not.toMatch(/save \d+%/i);
    });

    it('during the promo it names the price and still claims no saving', async () => {
        const sent = await sendWarning({
            paymentStatus: 'paid',
            renewalPurchasable: true,
            nextPostPrice: config.postingPrice,
            renewalPrice: config.proRenewalPrice,
            now: DURING_PROMO,
        });
        expect(sent.text).toContain(`Renew for ${PRO_RENEWAL}`);
        expect(sent.subject).not.toContain(PRO_RENEWAL);
        for (const part of parts(sent)) expect(part).not.toMatch(/save \d+%/i);
    });

    it("a renewal offered without the row's price is not sent at the base price (review 2.28 M1)", async () => {
        // The base price would misquote a post bought at the posting price.
        // The type requires the price; a send that bypasses it fails, so the
        // cron reports the row and leaves it unstamped for its next run.
        const { sendExpiryWarningEmail } = await import('@/lib/email-service');
        const expiresAt = new Date(AFTER_PROMO.getTime() + 5 * DAY_MS);
        // @ts-expect-error a purchasable renewal requires the row's renewalPrice
        const result = await sendExpiryWarningEmail('employer@clinic.example', TITLE, expiresAt, 120, 8, 'dash-token', null, { paymentStatus: 'paid', renewalPurchasable: true, now: AFTER_PROMO });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/renewalPrice/);
        expect(resendSendMock).not.toHaveBeenCalled();
    });
});

describe('expiry warning: after the promo, paid posting off', () => {
    it('makes no offer at all', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: false, now: AFTER_PROMO });
        for (const part of parts(sent)) {
            expect(part).not.toContain(RENEWAL);
            expect(part).not.toMatch(/free through/i);
        }
        expect(sent.subject).not.toMatch(/renew/i);
        expect(loggedMetadata()).toMatchObject({ offer: 'none' });
    });
});

describe('expiry warning: after the promo, a row the renewal checkout refuses', () => {
    it('is offered a paid repost at the ladder price while new posts can be bought', async () => {
        const sent = await sendWarning({ paymentStatus: 'free', renewalPurchasable: true, renewalPrice: config.renewalPrice, postingPurchasable: true, now: AFTER_PROMO });
        expect(sent.text).toContain(`You can post this role again as a fresh listing. It runs ${config.durationDays} days with a fresh ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails. ${LADDER_PRICES}`);
        expect(sent.html).toContain('/post-job');
        expect(sent.html).toMatch(/>\s*Post a New Job\s*</);
        for (const part of parts(sent)) {
            expect(part).not.toContain(RENEWAL);
            expect(part).not.toMatch(FREE_REPOST);
            // Present tense: no start date that has already passed.
            expect(part).not.toContain(config.ladderStartsLabel);
        }
        expect(loggedMetadata()).toMatchObject({ offer: 'paid_repost', paymentStatus: 'free' });
    });

    it('gets no offer when new posts cannot be bought either', async () => {
        const sent = await sendWarning({ paymentStatus: 'free', renewalPurchasable: false, postingPurchasable: false, now: AFTER_PROMO });
        expect(sent.html).not.toContain('/post-job');
        expect(loggedMetadata()).toMatchObject({ offer: 'none' });
    });

    it('during the promo the free repost still wins over the paid one', async () => {
        await sendWarning({ paymentStatus: 'free', renewalPurchasable: false, postingPurchasable: true, now: DURING_PROMO });
        expect(loggedMetadata()).toMatchObject({ offer: 'promo_repost' });
    });
});

describe('expiry warning: the free wording stops exactly at config.promoEndsAt', () => {
    it('paid posting off: free repost in the last promo second, no offer from the next instant', async () => {
        const last = await sendWarning({ paymentStatus: 'promo', renewalPurchasable: false, postingPurchasable: false, now: LAST_PROMO_SECOND });
        expect(last.text).toContain(`Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`);
        expect(last.html).toMatch(/>\s*Post a New Job for Free\s*</);
        expect(loggedMetadata()).toMatchObject({ offer: 'promo_repost' });

        const first = await sendWarning({ paymentStatus: 'promo', renewalPurchasable: false, postingPurchasable: false, now: LADDER_START });
        for (const part of parts(first)) expect(part).not.toMatch(FREE_REPOST);
        expect(first.html).not.toContain('Post a New Job for Free');
        expect(loggedMetadata()).toMatchObject({ offer: 'none' });
    });

    it('paid posting on: the renewal drops its free alternative at the same instant', async () => {
        const options = { paymentStatus: 'promo', renewalPurchasable: true, renewalPrice: config.renewalPrice, postingPurchasable: true, nextPostPrice: config.introPrice };
        const last = await sendWarning({ ...options, now: LAST_PROMO_SECOND });
        expect(last.text).toContain(`Or post this role again as a fresh listing, free through ${config.promoEndsLabel}.`);

        const first = await sendWarning({ ...options, now: LADDER_START });
        expect(first.text).toContain(`Renew for ${RENEWAL}`);
        for (const part of parts(first)) expect(part).not.toMatch(FREE_REPOST);
        expect(loggedMetadata()).toMatchObject({ offer: 'renew' });
    });
});

describe('expiry warning: a legacy plan post (the Employer plan is retired)', () => {
    /** Plan wording that no longer describes anything an employer can do. */
    const PLAN_WORDING = /plan post|Employer plan|slot|subscribed/i;

    it('is never offered a renewal, and during the promo is offered the free repost', async () => {
        const sent = await sendWarning({ paymentStatus: 'plan', renewalPurchasable: true, renewalPrice: config.renewalPrice, postingPurchasable: true, now: DURING_PROMO });
        for (const part of parts(sent)) {
            expect(part).not.toContain(RENEWAL);
            expect(part).not.toMatch(PLAN_WORDING);
        }
        expect(sent.text).toContain(`Every job post is free through ${config.promoEndsLabel}, so you can post this role again as a fresh listing at no charge.`);
        expect(loggedMetadata()).toMatchObject({ offer: 'promo_repost', paymentStatus: 'plan' });
    });

    it('after the promo is offered a paid repost at the ladder price while new posts can be bought', async () => {
        const sent = await sendWarning({ paymentStatus: 'plan', renewalPurchasable: true, renewalPrice: config.renewalPrice, postingPurchasable: true, now: AFTER_PROMO });
        for (const part of parts(sent)) {
            expect(part).not.toContain(RENEWAL);
            expect(part).not.toMatch(PLAN_WORDING);
            expect(part).not.toMatch(FREE_REPOST);
        }
        expect(sent.text).toContain(LADDER_PRICES);
        expect(loggedMetadata()).toMatchObject({ offer: 'paid_repost', paymentStatus: 'plan' });
    });

    it('after the promo gets no offer when new posts cannot be bought either', async () => {
        const sent = await sendWarning({ paymentStatus: 'plan', renewalPurchasable: false, postingPurchasable: false, now: AFTER_PROMO });
        for (const part of parts(sent)) expect(part).not.toMatch(PLAN_WORDING);
        expect(loggedMetadata()).toMatchObject({ offer: 'none', paymentStatus: 'plan' });
    });
});

describe('expiry warning: every variant renders and keeps house style', () => {
    const variants: [string, ExpiryWarningOptions][] = [
        ['promo repost', { paymentStatus: 'promo', renewalPurchasable: false, now: DURING_PROMO }],
        ['renew in promo', { paymentStatus: 'promo', renewalPurchasable: true, renewalPrice: config.renewalPrice, now: DURING_PROMO }],
        ['renew after promo', { paymentStatus: 'paid', renewalPurchasable: true, renewalPrice: config.renewalPrice, nextPostPrice: config.introPrice, now: AFTER_PROMO }],
        ['no offer', { paymentStatus: 'paid', renewalPurchasable: false, now: AFTER_PROMO }],
        ['paid repost', { paymentStatus: 'free', renewalPurchasable: false, postingPurchasable: true, now: AFTER_PROMO }],
        ['legacy plan post', { paymentStatus: 'plan', postingPurchasable: true, now: AFTER_PROMO }],
    ];

    it.each(variants)('%s: HTML and text parts, no dashes, real unsubscribe token', async (_name, options) => {
        const sent = await sendWarning(options);
        expect(sent.html).toContain('<!DOCTYPE html>');
        expect(sent.text.length).toBeGreaterThan(100);
        expect(sent.text).toContain(TITLE);
        expect(sent.subject).not.toMatch(DASHES);
        expect(sent.text).not.toMatch(DASHES);
        // The footer used to fall back to the 'sample' placeholder when the
        // cron passed no token; it now carries the same minted token as the
        // List-Unsubscribe header.
        expect(sent.html).toContain('/unsubscribe?token=tok-abc-123');
        // The unmeasured "Saved" stat placeholder is gone.
        expect(sent.html).not.toContain('>Saved<');
    });

    it('pluralises a one-day warning', async () => {
        const { sendExpiryWarningEmail } = await import('@/lib/email-service');
        await sendExpiryWarningEmail('employer@clinic.example', TITLE, new Date(DURING_PROMO.getTime() + 12 * 60 * 60 * 1000), 1, 0, 't', null, { paymentStatus: 'promo', now: DURING_PROMO });
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.subject).toContain('expires in 1 day');
        expect(sent.html).toMatch(/Your Listing Expires in 1 Day\s*</);
    });
});

describe('the other employer emails tell the truth', () => {
    it('the email service sends no Employer plan email any more (the plan is retired, its code deleted)', async () => {
        const emails = await import('@/lib/email-service');
        expect(Object.keys(emails).filter((name) => /plan/i.test(name))).toEqual([]);
        const fs = await import('node:fs');
        const src = fs.readFileSync(`${process.cwd()}/lib/email-service.ts`, 'utf8');
        // No plan EmailType, no plan confirmation mode, no plan expiry copy.
        expect(src).not.toMatch(/'plan_(?:activated|paused|payment_failed|link_pending)'/);
        expect(src).not.toMatch(/mode === 'plan'|planExpiryCopy|planTerms/);
        expect(src).not.toMatch(/Employer plan|plan slot|free slot/i);
    });

    it('the renewal confirmation claims no new unlocks or InMails', async () => {
        const { sendRenewalConfirmationEmail } = await import('@/lib/email-service');
        await sendRenewalConfirmationEmail('owner@clinic.example', TITLE, AFTER_PROMO, 'dash', 'tok-abc-123', { amountCents: config.stripeRenewalPriceInCents });
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.text).toContain('A renewal adds days only. This posting keeps its applicants, stats, and remaining unlocks and InMails, but gets no new ones.');
        expect(sent.text).not.toMatch(/fresh \d+ candidate unlocks|renewal cycle/);
        expect(sent.text).toContain(`Renewal: $${config.renewalPrice}.00`);
        expect(sent.subject).not.toMatch(DASHES);
    });

    it.each([
        ['a post bought at the posting price', config.stripeProRenewalPriceInCents, '$249.00'],
        ['any other post', config.stripeRenewalPriceInCents, '$199.00'],
        ['a charge a coupon reduced', 17910, '$179.10'],
    ])('the renewal confirmation prints the amount actually charged for %s', async (_post, amountCents, printed) => {
        const { sendRenewalConfirmationEmail } = await import('@/lib/email-service');
        await sendRenewalConfirmationEmail('owner@clinic.example', TITLE, AFTER_PROMO, 'dash', 'tok-abc-123', { amountCents });
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.text).toContain(`Renewal: ${printed}`);
        // No other renewal price leaks into the receipt.
        for (const other of ['$199.00', '$249.00', '$179.10'].filter((price) => price !== printed)) {
            expect(sent.text).not.toContain(other);
        }
    });

    it('the renewal confirmation keeps the invoice links beside the amount', async () => {
        const { sendRenewalConfirmationEmail } = await import('@/lib/email-service');
        await sendRenewalConfirmationEmail('owner@clinic.example', TITLE, AFTER_PROMO, 'dash', 'tok-abc-123', {
            amountCents: config.stripeProRenewalPriceInCents,
            invoiceNumber: 'INV-0042',
            invoicePdfUrl: 'https://example.com/api/employer/invoice?jobId=job-1&token=t',
            hostedInvoiceUrl: 'https://invoice.stripe.test/i/abc',
        });
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.html).toContain('Renewal: $249.00 · Invoice #INV-0042');
        expect(sent.html).toContain('href="https://example.com/api/employer/invoice?jobId=job-1&token=t"');
        expect(sent.html).toContain('href="https://invoice.stripe.test/i/abc"');
    });

    it('no email promises unlocked candidates "forever"', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync(`${process.cwd()}/lib/email-service.ts`, 'utf8');
        expect(src).not.toMatch(/stay (accessible|in your dashboard) forever/);
        expect(src).not.toMatch(/fresh \$\{config\.limits\.candidateUnlocksPerPosting\} candidate unlocks/);
    });
});

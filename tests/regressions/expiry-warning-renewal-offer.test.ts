/**
 * Expiry warning email and plan email truth (package RENEWAL-OFFER).
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
 *   plan         — each plan post runs config.durationDays; when it ends,
 *                  post again into the free slot at no extra charge
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
        const sent = await sendWarning({ paymentStatus: 'promo', renewalPurchasable: true, nextPostPrice: config.postingPrice, now: DURING_PROMO });
        expect(sent.text).toContain(`Renew for ${RENEWAL}`);
        for (const part of parts(sent)) expect(part).not.toMatch(/save \d+%/i);
        expect(sent.text).toContain(`Or post this role again as a fresh listing, free through ${config.promoEndsLabel}.`);
        expect(loggedMetadata()).toMatchObject({ offer: 'renew' });
    });

    it('describes a renewal as apply-renewal.ts performs it: days only, within the cap', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, now: DURING_PROMO });
        expect(sent.text).toContain(`Adds ${config.durationDays} days to your current expiration, so renewing early doesn't lose any remaining days. It does not add unlocks or InMails.`);
        expect(sent.text).toContain(`Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.`);
        expect(sent.text).not.toMatch(/expiration plus a fresh/);
        // Unlocked profiles are served only while the candidate stays visible.
        expect(sent.text).toContain('stay in your dashboard after expiry, for as long as they keep their profile visible and open to opportunities.');
    });
});

describe('expiry warning: after the promo, paid posting on', () => {
    it("names the saving against the employer's own next post: the intro price", async () => {
        const sent = await sendWarning({ paymentStatus: 'promo', renewalPurchasable: true, nextPostPrice: config.introPrice, now: AFTER_PROMO });
        expect(sent.html).toContain(`Renew for ${RENEWAL} (Save 10% vs. your next new post at $${config.introPrice})`);
        expect(sent.html).toContain(`Renew for ${RENEWAL} and save 10% vs. your next new post at $${config.introPrice}.`);
        expect(sent.html).not.toContain('40%');
    });

    it('against the post price for a domain that already bought a post', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, nextPostPrice: config.postingPrice, now: AFTER_PROMO });
        expect(sent.html).toContain(`(Save 40% vs. your next new post at $${config.postingPrice})`);
    });

    it('against the named standard post price when the next price is unknown', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, nextPostPrice: null, now: AFTER_PROMO });
        expect(sent.html).toContain(`(Save 40% vs. the $${config.postingPrice} post price)`);
    });

    it('claims no saving when the next post is free (an open plan slot)', async () => {
        const sent = await sendWarning({ paymentStatus: 'paid', renewalPurchasable: true, nextPostPrice: 0, now: AFTER_PROMO });
        expect(sent.text).toContain(`Renew for ${RENEWAL}`);
        for (const part of parts(sent)) expect(part).not.toMatch(/save \d+%/i);
    });

    it('never offers a renewal to a legacy free row, which the renewal checkout refuses', async () => {
        const sent = await sendWarning({ paymentStatus: 'free', renewalPurchasable: true, nextPostPrice: config.postingPrice, now: AFTER_PROMO });
        expect(sent.text).not.toContain(RENEWAL);
        expect(loggedMetadata()).toMatchObject({ offer: 'none' });
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
        const sent = await sendWarning({ paymentStatus: 'free', renewalPurchasable: true, postingPurchasable: true, now: AFTER_PROMO });
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
        const options = { paymentStatus: 'promo', renewalPurchasable: true, postingPurchasable: true, nextPostPrice: config.introPrice };
        const last = await sendWarning({ ...options, now: LAST_PROMO_SECOND });
        expect(last.text).toContain(`Or post this role again as a fresh listing, free through ${config.promoEndsLabel}.`);

        const first = await sendWarning({ ...options, now: LADDER_START });
        expect(first.text).toContain(`Renew for ${RENEWAL}`);
        for (const part of parts(first)) expect(part).not.toMatch(FREE_REPOST);
        expect(loggedMetadata()).toMatchObject({ offer: 'renew' });
    });
});

describe('expiry warning: plan posts', () => {
    it('each plan post runs its days; when it ends, post again into the free slot', async () => {
        for (const now of [DURING_PROMO, AFTER_PROMO]) {
            const sent = await sendWarning({ paymentStatus: 'plan', renewalPurchasable: true, now });
            expect(sent.text).not.toContain(RENEWAL);
            expect(sent.text).toContain(`Each plan post runs ${config.durationDays} days. When this one ends, its slot is free again: post a job into it at no extra charge while you're subscribed`);
            expect(sent.text).not.toMatch(/stays? live while/i);
            expect(loggedMetadata()).toMatchObject({ offer: 'plan', paymentStatus: 'plan' });
        }
    });
});

describe('expiry warning: every variant renders and keeps house style', () => {
    const variants: [string, ExpiryWarningOptions][] = [
        ['promo repost', { paymentStatus: 'promo', renewalPurchasable: false, now: DURING_PROMO }],
        ['renew in promo', { paymentStatus: 'promo', renewalPurchasable: true, now: DURING_PROMO }],
        ['renew after promo', { paymentStatus: 'paid', renewalPurchasable: true, nextPostPrice: config.introPrice, now: AFTER_PROMO }],
        ['no offer', { paymentStatus: 'paid', renewalPurchasable: false, now: AFTER_PROMO }],
        ['paid repost', { paymentStatus: 'free', renewalPurchasable: false, postingPurchasable: true, now: AFTER_PROMO }],
        ['plan', { paymentStatus: 'plan', now: AFTER_PROMO }],
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

describe('plan copy elsewhere in the email service matches what plan posts do', () => {
    it('the plan activated email states the slot terms truthfully', async () => {
        const { sendPlanActivatedEmail } = await import('@/lib/email-service');
        await sendPlanActivatedEmail('owner@clinic.example', { slots: config.planSlots, currentPeriodEnd: AFTER_PROMO });
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.text).toContain(`${config.planSlots} active job slots while you're subscribed. Each plan post runs ${config.durationDays} days; when one ends, post again into the free slot at no extra charge.`);
        expect(sent.html).not.toMatch(/live while you're subscribed|stays live for up to/);
        expect(sent.subject).not.toMatch(DASHES);
    });

    it('a single-slot admin grant reads "1 active job slot"', async () => {
        const { sendPlanActivatedEmail } = await import('@/lib/email-service');
        await sendPlanActivatedEmail('owner@clinic.example', { slots: 1, currentPeriodEnd: AFTER_PROMO });
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.text).toContain('1 active job slot while you');
    });

    it('the plan confirmation email says the post runs its days, then the slot is free', async () => {
        const { sendConfirmationEmail } = await import('@/lib/email-service');
        await sendConfirmationEmail('owner@clinic.example', TITLE, 'job-1', undefined, undefined, config.durationDays, 'plan');
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.text).toContain(`It was posted under your Employer plan and runs ${config.durationDays} days. When it ends, post again into the free slot at no extra charge while you're subscribed.`);
        expect(sent.text).not.toContain('stays live while your plan is active');
    });

    it('the renewal confirmation claims no new unlocks or InMails', async () => {
        const { sendRenewalConfirmationEmail } = await import('@/lib/email-service');
        await sendRenewalConfirmationEmail('owner@clinic.example', TITLE, AFTER_PROMO, 'dash', 'tok-abc-123');
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.text).toContain('A renewal adds days only: this posting keeps its applicants, stats and remaining unlocks and InMails, and does not get new ones.');
        expect(sent.text).not.toMatch(/fresh \d+ candidate unlocks|renewal cycle/);
        expect(sent.text).toContain(`Renewal: $${config.renewalPrice}.00`);
        expect(sent.subject).not.toMatch(DASHES);
    });

    it('no email promises unlocked candidates "forever"', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync(`${process.cwd()}/lib/email-service.ts`, 'utf8');
        expect(src).not.toMatch(/stay (accessible|in your dashboard) forever/);
        expect(src).not.toMatch(/fresh \$\{config\.limits\.candidateUnlocksPerPosting\} candidate unlocks/);
    });

    it('the cancellation notice does not promise posts past their own run', async () => {
        const { sendPlanPausedEmail } = await import('@/lib/email-service');
        await sendPlanPausedEmail('owner@clinic.example', { reason: 'cancelled', pausedCount: 0, liveUntil: AFTER_PROMO });
        const sent = resendSendMock.mock.calls.at(-1)![0] as Sent;
        expect(sent.subject).toContain('your paid period runs through');
        expect(sent.subject).not.toMatch(DASHES);
        expect(sent.text).toContain(`Plan posts still inside their ${config.durationDays}-day run stay live through`);
    });
});

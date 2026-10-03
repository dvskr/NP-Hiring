/**
 * Employer emails state the launch promo while it runs and the ladder as
 * today's price afterwards, decided at SEND time (backlog 2.1, package R1).
 *
 * Before:
 *   - pricingCopyForNow's ladder branch printed the LADDER_LINE constant,
 *     "From January 1, 2027: your first post is $199, ...", so every
 *     employer welcome and plan-paused email sent after that date announced
 *     a start date already in the past;
 *   - lib/email-service.ts redefined PROMO_HEADLINE and PROMO_SUB instead of
 *     taking them from lib/pricing-copy.ts, so the copies could drift;
 *   - the employer welcome preheader, body and subject carried em dashes.
 * After: both phases come from lib/pricing-copy.ts at send time; from
 * config.promoEndsAt the price is present tense and nothing offers free
 * posting. The REAL email-service runs (the global setup mocks it); Resend
 * is mocked to capture the HTML and the plain-text part sendAndLog derives.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { config } from '@/lib/config';
import { brand } from '@/config/brand';
import { LADDER_PRICES, PROMO_HEADLINE, PROMO_SUB } from '@/lib/pricing-copy';

vi.unmock('@/lib/email-service');

const resendSendMock = vi.fn().mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
vi.mock('resend', () => ({
    Resend: vi.fn().mockImplementation(() => ({
        emails: { send: resendSendMock },
        batch: { send: vi.fn().mockResolvedValue({ data: [], error: null }) },
    })),
}));

import { prisma } from '@/lib/prisma';

const DURING_PROMO = new Date('2026-12-31T12:00:00.000Z');
const LAST_PROMO_SECOND = new Date('2027-01-01T09:59:59.000Z');
const LADDER_START = new Date(config.promoEndsAt);
const LATER = new Date('2027-03-15T12:00:00.000Z');
const DASHES = /[–—]| - /;
/** Free posting stated as a current offer: never true once the promo is over. */
const FREE_AS_CURRENT_OFFER = /\bfree\b|launch (period|promo|offer)|\$0\b|no credit card/i;

interface Sent {
    subject: string;
    html: string;
    text: string;
}

function lastSent(): Sent {
    return resendSendMock.mock.calls.at(-1)![0] as Sent;
}

/** The employer welcome email, sent with the clock at `now`. */
async function employerWelcomeAt(now: Date): Promise<Sent> {
    vi.setSystemTime(now);
    const { sendSignupWelcomeEmail } = await import('@/lib/email-service');
    const result = await sendSignupWelcomeEmail('owner@clinic.example', 'Dana', 'employer');
    expect(result.success).toBe(true);
    return lastSent();
}

/** The plan-paused notice (payment failed), sent with the clock at `now`. */
async function planPausedAt(now: Date): Promise<Sent> {
    vi.setSystemTime(now);
    const { sendPlanPausedEmail } = await import('@/lib/email-service');
    const result = await sendPlanPausedEmail('owner@clinic.example', { reason: 'past_due', pausedCount: 2 });
    expect(result.success).toBe(true);
    return lastSent();
}

// The first import of the real email service is a cold transform of its
// whole module graph; give it a hook budget so no single test pays for it.
beforeAll(async () => {
    await import('@/lib/email-service');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    process.env.RESEND_API_KEY = 'test-key';
    resendSendMock.mockResolvedValue({ data: { id: 'resend-msg-1' }, error: null });
    vi.mocked(prisma.emailLead.findUnique).mockResolvedValue({ isSuppressed: false, unsubscribeToken: 'tok-abc-123' } as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('employer welcome email', () => {
    it('during the promo: the launch offer card and preheader, from lib/pricing-copy', async () => {
        const sent = await employerWelcomeAt(DURING_PROMO);
        expect(sent.html).toContain('Launch offer');
        expect(sent.html).toContain(PROMO_HEADLINE);
        expect(sent.html).toContain(PROMO_SUB);
        expect(sent.text).toContain(`Your employer account is ready. Every post is free through ${config.promoEndsLabel}.`);
        expect(sent.html).not.toContain(LADDER_PRICES);
    });

    it('still promises the promo in its last second', async () => {
        const sent = await employerWelcomeAt(LAST_PROMO_SECOND);
        expect(sent.html).toContain(PROMO_HEADLINE);
        expect(sent.text).toContain(`Every post is free through ${config.promoEndsLabel}.`);
    });

    it("from config.promoEndsAt: the ladder as today's price, nothing free", async () => {
        for (const now of [LADDER_START, LATER]) {
            const sent = await employerWelcomeAt(now);
            expect(sent.html).toContain('Simple per-post pricing');
            expect(sent.text).toContain(LADDER_PRICES);
            expect(sent.text).toContain('Your employer account is ready. Post your first job today.');
            for (const part of [sent.subject, sent.text]) {
                // No start date that is already in the past.
                expect(part).not.toContain(config.ladderStartsLabel);
                expect(part).not.toMatch(FREE_AS_CURRENT_OFFER);
            }
        }
    });

    it('keeps house style in both phases: no dashes in the subject or the text', async () => {
        for (const now of [DURING_PROMO, LATER]) {
            const sent = await employerWelcomeAt(now);
            expect(sent.subject).toBe(`Welcome to ${brand.name}: Start Hiring Today`);
            expect(sent.subject).not.toMatch(DASHES);
            expect(sent.text).not.toMatch(DASHES);
            expect(sent.text).toContain(`connect with qualified ${brand.niche.long}s, all from one dashboard.`);
        }
    });
});

describe('plan paused notice: the "what you can do instead" pricing card', () => {
    it('after the promo it states the ladder in the present tense', async () => {
        for (const now of [LADDER_START, LATER]) {
            const sent = await planPausedAt(now);
            expect(sent.text).toContain(LADDER_PRICES);
            expect(sent.text).not.toContain(config.ladderStartsLabel);
            expect(sent.text).not.toMatch(/free during our launch period|free through|no credit card/i);
        }
    });

    it('while the promo runs it carries the promo package', async () => {
        const sent = await planPausedAt(DURING_PROMO);
        expect(sent.text).toContain(PROMO_SUB);
        expect(sent.text).not.toContain(LADDER_PRICES);
    });
});

describe('email-service takes the promo sentences from lib/pricing-copy', () => {
    it('never redefines them, and has no dated ladder constant left', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync(`${process.cwd()}/lib/email-service.ts`, 'utf8');
        expect(src).toMatch(/import \{[^}]*\bPROMO_HEADLINE\b[^}]*\} from '@\/lib\/pricing-copy'/);
        expect(src).toMatch(/import \{[^}]*\bPROMO_SUB\b[^}]*\} from '@\/lib\/pricing-copy'/);
        expect(src).not.toMatch(/const (PROMO_HEADLINE|PROMO_SUB|LADDER_LINE)\b/);
    });
});

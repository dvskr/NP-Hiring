/**
 * A new post's claim and its publish commit together
 * (app/api/webhooks/stripe/activate-paid-job.ts: claimAndPublish).
 * Committed apart, a publish that failed after the claim left a paid post
 * down for good: Stripe's retry lost the claim (the row was 'paid' by then),
 * and resolveLostClaim answered 'already_active' without publishing, so the
 * post never went live and its confirmation email never went out.
 *
 * The fake database (tests/helpers/fake-transaction.ts) runs a query when it
 * is awaited, as Prisma does, and commits a transaction's writes together or
 * drops them all when one fails; a write outside a transaction commits on
 * its own. Its WHEREs are read by tests/helpers/fake-row-where.ts.
 *   - The first delivery fails the publish once. The retry, as Stripe sends
 *     it once the 500 has rolled the dedupe row back, wins the claim again,
 *     publishes, and sends the one confirmation email; a later replay sends
 *     no second one.
 *   - A post archived, or taken down by an admin, is still claimed and
 *     ledgered, and stays down with no email.
 *   - A replay never puts back up a post its employer paused after it went
 *     live.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { sendConfirmationEmail } from '@/lib/email-service';
import { pingSearchEnginesForJobPage } from '@/lib/job-page-indexing';
import { deferred, fakeTransaction } from '../helpers/fake-transaction';
import { rowMatches, type Row } from '../helpers/fake-row-where';

vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
    })),
}));
vi.mock('@/lib/email-service', () => ({
    sendConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendRenewalConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
}));
vi.mock('@/lib/job-page-indexing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/job-page-indexing')>()),
    pingSearchEnginesForJobPage: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

const HOUR_MS = 60 * 60 * 1000;

const SESSION = {
    id: 'cs_new_post',
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: 'pi_new_post',
    amount_total: config.stripePriceInCents,
    currency: 'usd',
    invoice: null,
    metadata: { jobId: 'job-1', pricing: 'pro' },
};

interface Listing {
    isPublished: boolean;
    archivedAt: Date | null;
    adminHoldAt: Date | null;
    isManuallyUnpublished: boolean;
    contentChangedAt: Date | null;
}

/** One new post: its payment status (employer_jobs), its listing (jobs) and the sessions on its ledger (job_charges). */
interface FakeDb {
    paymentStatus: string;
    listing: Listing;
    ledger: string[];
}

let db: FakeDb;
/** Publishes still to fail, one each, as a dropped connection fails them. */
let publishesToFail = 0;

function startWith(paymentStatus: string, listing: Partial<Listing> = {}, ledger: string[] = []): void {
    db = {
        paymentStatus,
        listing: { isPublished: false, archivedAt: null, adminHoldAt: null, isManuallyUnpublished: false, contentChangedAt: null, ...listing },
        ledger,
    };
}

/** The job row as Prisma returns it, and as a WHERE reads it. */
const jobRow = () => ({ id: 'job-1', title: 'Nurse Practitioner', slug: 'nurse-practitioner-job-1', ...db.listing });

const duplicate = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

interface Write<D> {
    where: Row;
    data: D;
}

/** The employer row and its ledger: the claim, the read a lost claim makes, and the ledger writes. */
function useFakeEmployerRows(): void {
    vi.mocked(prisma.employerJob.findFirst).mockImplementation((async () => ({
        id: 'ej-1', jobId: 'job-1', paymentStatus: db.paymentStatus, contactEmail: 'owner@clinic.example',
        dashboardToken: 'tok', quotaDomain: null, userId: null,
    })) as never);
    vi.mocked(prisma.employerJob.findUnique).mockImplementation((async () => ({ paymentStatus: db.paymentStatus })) as never);
    // The claim: it counts the pending row it moved.
    vi.mocked(prisma.employerJob.updateMany).mockImplementation(((args: Write<{ paymentStatus: string }>) => deferred(() => {
        if (!rowMatches({ id: 'ej-1', paymentStatus: db.paymentStatus }, args.where)) return { count: 0 };
        db = { ...db, paymentStatus: args.data.paymentStatus };
        return { count: 1 };
    })) as never);
    vi.mocked(prisma.jobCharge.create).mockImplementation((async (args: { data: { stripeSessionId: string } }) => {
        if (db.ledger.includes(args.data.stripeSessionId)) throw duplicate();
        db = { ...db, ledger: [...db.ledger, args.data.stripeSessionId] };
        return {};
    }) as never);
    vi.mocked(prisma.jobCharge.findMany).mockImplementation((async () =>
        db.ledger.map((stripeSessionId) => ({ stripeSessionId, type: 'new' }))) as never);
    vi.mocked(prisma.jobCharge.findFirst).mockImplementation((async (args: { where: { stripeSessionId: string } }) =>
        (db.ledger.includes(args.where.stripeSessionId) ? { id: 'jc-1' } : null)) as never);
}

/** The listing: the publish, which counts the row it matched and can be told to fail, and the read back after it. */
function useFakeListing(): void {
    vi.mocked(prisma.job.updateMany).mockImplementation(((args: Write<Partial<Listing>>) => deferred(() => {
        if (publishesToFail > 0) {
            publishesToFail -= 1;
            throw new Error('Connection terminated unexpectedly');
        }
        if (!rowMatches(jobRow(), args.where)) return { count: 0 };
        db = { ...db, listing: { ...db.listing, ...args.data } };
        return { count: 1 };
    })) as never);
    vi.mocked(prisma.job.findUnique).mockImplementation((async () => jobRow()) as never);
    vi.mocked(prisma.$transaction).mockImplementation(fakeTransaction(prisma, {
        read: () => db,
        restore: (saved: FakeDb) => {
            db = saved;
        },
    }) as never);
}

async function deliver(eventId: string) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify({ id: eventId, type: 'checkout.session.completed', data: { object: SESSION } }),
    }) as never);
    return { status: res.status, json: await res.json() };
}

let logSpies: Array<{ mockRestore: () => void }> = [];

// Load the webhook route graph once, outside any single test's time budget.
beforeAll(async () => {
    await import('@/app/api/webhooks/stripe/route');
}, 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    logSpies = [
        vi.spyOn(logger, 'error').mockImplementation(() => undefined),
        vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
        vi.spyOn(logger, 'info').mockImplementation(() => undefined),
    ];
    publishesToFail = 0;
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.processedStripeEvent.delete).mockResolvedValue({} as never);
    useFakeEmployerRows();
    useFakeListing();
});

afterEach(() => {
    for (const spy of logSpies) spy.mockRestore();
});

describe('a publish that fails after the claim', () => {
    it('rolls the claim back, and the retry publishes the post and sends one confirmation email', async () => {
        startWith('pending');
        publishesToFail = 1;

        const first = await deliver('evt_new_post');

        expect(first.status).toBe(500);
        // Nothing committed: the row is 'pending' again, so the retry (or the
        // verify page, or the daily sweep) can still win the claim.
        expect(db.paymentStatus).toBe('pending');
        expect(db.listing.isPublished).toBe(false);
        expect(db.ledger).toEqual([]);
        expect(sendConfirmationEmail).not.toHaveBeenCalled();
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_new_post' } });

        const retry = await deliver('evt_new_post');

        expect(retry.status).toBe(200);
        expect(retry.json).toEqual({ received: true });
        expect(db.paymentStatus).toBe('paid');
        expect(db.listing.isPublished).toBe(true);
        expect(db.listing.contentChangedAt).toBeInstanceOf(Date);
        expect(db.ledger).toEqual(['cs_new_post']);
        expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
        expect(pingSearchEnginesForJobPage).toHaveBeenCalledTimes(1);

        // A later delivery for the same payment (the verify page, the sweep, an
        // async_payment_succeeded) loses the claim and sends nothing again.
        const replay = await deliver('evt_new_post_replay');

        expect(replay.status).toBe(200);
        expect(sendConfirmationEmail).toHaveBeenCalledTimes(1);
        expect(db.ledger).toEqual(['cs_new_post']);
    });
});

describe('a post that must stay down is still claimed and ledgered', () => {
    const DOWN: Array<[string, Partial<Listing>, Record<string, unknown>]> = [
        ['taken down by an admin', { adminHoldAt: new Date(Date.now() - HOUR_MS) }, { received: true, leftHeld: true }],
        ['archived while its checkout was open', { archivedAt: new Date(Date.now() - HOUR_MS) }, { received: true, leftArchived: true }],
    ];

    it.each(DOWN)('%s: paid, on the ledger, and left down with no confirmation email', async (_label, listing, answer) => {
        startWith('pending', listing);

        const { status, json } = await deliver('evt_new_post_down');

        expect(status).toBe(200);
        expect(json).toEqual(answer);
        // The claim committed although the publish in its transaction matched nothing.
        expect(db.paymentStatus).toBe('paid');
        expect(db.ledger).toEqual(['cs_new_post']);
        expect(db.listing.isPublished).toBe(false);
        expect(sendConfirmationEmail).not.toHaveBeenCalled();
        expect(pingSearchEnginesForJobPage).not.toHaveBeenCalled();
    });
});

describe('a replay never puts back up a post its employer paused', () => {
    const LEDGERS: Array<[string, string[]]> = [
        ['on the ledger', ['cs_new_post']],
        ['missing from the ledger (a run that died before its ledger write)', []],
    ];

    it.each(LEDGERS)('a paid, paused post with its payment %s stays paused', async (_label, ledger) => {
        startWith('paid', { isPublished: false, isManuallyUnpublished: true }, ledger);

        const { status, json } = await deliver('evt_new_post_late');

        expect(status).toBe(200);
        expect(json).toEqual({ received: true });
        expect(db.listing.isPublished).toBe(false);
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
        expect(sendConfirmationEmail).not.toHaveBeenCalled();
        // The payment is on the ledger either way: backfilled when it was missing.
        expect(db.ledger).toEqual(['cs_new_post']);
    });
});

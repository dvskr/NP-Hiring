/**
 * A refund or a chargeback changes a posting's payment status and its
 * listing together or not at all (app/api/webhooks/stripe/route.ts:
 * revokeRefundedPosting, revokeDisputedPosting, restoreWonPosting). Written
 * as two statements, a failure between them committed the first, and the
 * Stripe retry read the new status and skipped the second:
 *   - a refunded renewal left the posting 'refunded' and live: the retry
 *     reads a posting no longer 'paid' as one the renewal was never applied
 *     to, and keeps it (fullRefundRevokesPosting);
 *   - a chargeback won left the posting 'paid' and down: the retry found
 *     nothing still 'disputed' to restore.
 * The fake database (tests/helpers/fake-transaction.ts) runs a query when it
 * is awaited, as Prisma does, and commits a transaction's writes together or
 * drops them all when one fails, as Postgres does; a write outside a
 * transaction commits on its own. Its WHEREs are read by
 * tests/helpers/fake-row-where.ts. Each failure case fails the listing write
 * once, then delivers the event again, as Stripe's retry does once the 500
 * has rolled the dedupe row back. Two more cases land an admin hold or an
 * archive between a won chargeback's read and its republish, which carries
 * both gates in its WHERE. The last follows a chargeback on a posting
 * already refunded through to its close: the posting stays 'refunded' and
 * down.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { sendDiscordMessage } from '@/lib/discord-notifier';
import { sendRefundConfirmationEmail } from '@/lib/email-service';
import { deferred, fakeTransaction } from '../helpers/fake-transaction';
import { rowMatches, type Row } from '../helpers/fake-row-where';

vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        webhooks: { constructEvent: vi.fn().mockImplementation((raw: string) => JSON.parse(raw)) },
    })),
}));
vi.mock('@/lib/email-service', () => ({
    sendRenewalConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendRefundConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
}));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/discord-notifier', () => ({ sendDiscordMessage: vi.fn().mockResolvedValue(true) }));

const DAY_MS = 24 * 60 * 60 * 1000;
const POST_FEE = config.stripePriceInCents;
const RENEWAL = config.stripeRenewalPriceInCents;

interface Listing {
    isPublished: boolean;
    expiresAt: Date | null;
    archivedAt: Date | null;
    adminHoldAt: Date | null;
    contentChangedAt: Date | null;
}

/** One posting: its payment status (employer_jobs) and its listing (jobs). */
interface FakeDb {
    paymentStatus: string;
    listing: Listing;
}

let db: FakeDb;
/** Listing writes still to fail, one each, as a dropped connection fails them. */
let listingWritesToFail = 0;

function startWith(paymentStatus: string, listing: Partial<Listing>): void {
    db = {
        paymentStatus,
        listing: {
            isPublished: true,
            expiresAt: new Date(Date.now() + 20 * DAY_MS),
            archivedAt: null,
            adminHoldAt: null,
            contentChangedAt: null,
            ...listing,
        },
    };
}

/** The posting's rows as a WHERE reads them. */
const postingRow = (): Row => ({ id: 'ej-1', paymentStatus: db.paymentStatus });
const listingRow = (): Row => ({ id: 'job-1', ...db.listing });

const recordNotFound = () => Object.assign(new Error('No record was found for an update.'), { code: 'P2025' });

function readListing(): Pick<Listing, 'expiresAt' | 'archivedAt' | 'adminHoldAt'> {
    const { expiresAt, archivedAt, adminHoldAt } = db.listing;
    return { expiresAt, archivedAt, adminHoldAt };
}

function writeListing(data: Partial<Listing>): void {
    if (listingWritesToFail > 0) {
        listingWritesToFail -= 1;
        throw new Error('Connection terminated unexpectedly');
    }
    db = { ...db, listing: { ...db.listing, ...data } };
}

function writeStatus(paymentStatus: string): void {
    db = { ...db, paymentStatus };
}

interface Write<D> {
    where: Row;
    data: D;
}

function useFakeDatabase(): void {
    vi.mocked(prisma.employerJob.findUnique).mockImplementation((async () => ({
        id: 'ej-1',
        jobId: 'job-1',
        paymentStatus: db.paymentStatus,
        contactEmail: 'owner@clinic.example',
        job: { id: 'job-1', title: 'Nurse Practitioner' },
    })) as never);
    vi.mocked(prisma.employerJob.update).mockImplementation(((args: Write<{ paymentStatus: string }>) => deferred(() => {
        if (!rowMatches(postingRow(), args.where)) throw recordNotFound();
        writeStatus(args.data.paymentStatus);
        return {};
    })) as never);
    vi.mocked(prisma.employerJob.updateMany).mockImplementation(((args: Write<{ paymentStatus: string }>) => deferred(() => {
        if (!rowMatches(postingRow(), args.where)) return { count: 0 };
        writeStatus(args.data.paymentStatus);
        return { count: 1 };
    })) as never);
    vi.mocked(prisma.job.findUnique).mockImplementation((async () => readListing()) as never);
    vi.mocked(prisma.job.update).mockImplementation(((args: Write<Partial<Listing>>) => deferred(() => {
        if (!rowMatches(listingRow(), args.where)) throw recordNotFound();
        writeListing(args.data);
        return {};
    })) as never);
    vi.mocked(prisma.job.updateMany).mockImplementation(((args: Write<Partial<Listing>>) => deferred(() => {
        if (!rowMatches(listingRow(), args.where)) return { count: 0 };
        writeListing(args.data);
        return { count: 1 };
    })) as never);
    vi.mocked(prisma.$transaction).mockImplementation(fakeTransaction(prisma, {
        read: () => db,
        restore: (saved: FakeDb) => {
            db = saved;
        },
    }) as never);
}

/** The ledger row the event's payment intent matches. */
function chargeFor(type: 'new' | 'renewal', amountCents: number): void {
    vi.mocked(prisma.jobCharge.findUnique).mockResolvedValue({ id: `jc-${type}`, employerJobId: 'ej-1', amountCents, type } as never);
}

async function deliver(eventId: string, type: string, object: object) {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(new Request('https://example.com/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_test' },
        body: JSON.stringify({ id: eventId, type, data: { object } }),
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
    listingWritesToFail = 0;
    vi.mocked(prisma.processedStripeEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.processedStripeEvent.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.emailSend.create).mockResolvedValue({} as never);
    vi.mocked(prisma.jobCharge.update).mockResolvedValue({} as never);
    // The posting's only payment: no other one stands.
    vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);
    useFakeDatabase();
});

afterEach(() => {
    for (const spy of logSpies) spy.mockRestore();
});

describe('a full refund that takes the posting down', () => {
    const refundRenewal = () => deliver('evt_refund_renewal', 'charge.refunded', {
        id: 'ch_renewal',
        payment_intent: 'pi_renewal',
        amount_refunded: RENEWAL,
        refunds: { data: [{ id: 're_renewal', reason: 'requested_by_customer' }] },
    });

    it('a failure between the status and the unpublish commits neither, and the retry takes the posting down', async () => {
        // A renewed promo post: its renewal is its only payment, refunded in full.
        startWith('paid', { isPublished: true });
        chargeFor('renewal', RENEWAL);
        listingWritesToFail = 1;

        const first = await refundRenewal();

        expect(first.status).toBe(500);
        // Rolled back together: the posting is as it was before the event...
        expect(db.paymentStatus).toBe('paid');
        expect(db.listing.isPublished).toBe(true);
        // ...and the dedupe row is gone, so Stripe's retry is processed.
        expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { eventId: 'evt_refund_renewal' } });
        expect(sendRefundConfirmationEmail).not.toHaveBeenCalled();

        const retry = await refundRenewal();

        expect(retry.status).toBe(200);
        expect(db.paymentStatus).toBe('refunded');
        expect(db.listing.isPublished).toBe(false);
        expect(sendRefundConfirmationEmail).toHaveBeenCalledTimes(1);
    });
});

describe('a chargeback opened', () => {
    const openDispute = () => deliver('evt_dispute_opened', 'charge.dispute.created', { id: 'dp_opened', payment_intent: 'pi_post', amount: POST_FEE });

    it('a failure between the status and the unpublish commits neither, and the retry takes the posting down', async () => {
        startWith('paid', { isPublished: true });
        chargeFor('new', POST_FEE);
        listingWritesToFail = 1;

        const first = await openDispute();

        expect(first.status).toBe(500);
        expect(db.paymentStatus).toBe('paid');
        expect(db.listing.isPublished).toBe(true);

        const retry = await openDispute();

        expect(retry.status).toBe(200);
        expect(db.paymentStatus).toBe('disputed');
        expect(db.listing.isPublished).toBe(false);
    });
});

describe('a chargeback won', () => {
    const closeWon = (eventId: string) => deliver(eventId, 'charge.dispute.closed', { id: 'dp_won', payment_intent: 'pi_post', amount: POST_FEE, status: 'won' });

    beforeEach(() => {
        chargeFor('new', POST_FEE);
    });

    it('a failure between the restore and the republish commits neither, and the retry puts the posting back up', async () => {
        startWith('disputed', { isPublished: false });
        listingWritesToFail = 1;

        const first = await closeWon('evt_won');

        expect(first.status).toBe(500);
        // Still 'disputed', so the retry has something to restore.
        expect(db.paymentStatus).toBe('disputed');
        expect(db.listing.isPublished).toBe(false);

        const retry = await closeWon('evt_won');

        expect(retry.status).toBe(200);
        expect(retry.json).toEqual({ received: true, dispute: 'won', restored: true, republished: true });
        expect(db.paymentStatus).toBe('paid');
        expect(db.listing.isPublished).toBe(true);
        expect(db.listing.contentChangedAt).toBeInstanceOf(Date);
    });

    const RACES: Array<[string, string, Partial<Listing>]> = [
        ['an admin hold', 'evt_won_hold_race', { adminHoldAt: new Date(Date.now() - 60 * 1000) }],
        ['an archive', 'evt_won_archive_race', { archivedAt: new Date(Date.now() - 60 * 1000) }],
    ];

    it.each(RACES)('%s landing after the read keeps the posting down', async (_label, eventId, change) => {
        startWith('disputed', { isPublished: false });
        // The read finds the posting free to go back up; the change lands right after it.
        vi.mocked(prisma.job.findUnique).mockImplementationOnce((async () => {
            const read = readListing();
            db = { ...db, listing: { ...db.listing, ...change } };
            return read;
        }) as never);

        const { status, json } = await closeWon(eventId);

        expect(status).toBe(200);
        expect(json).toEqual({ received: true, dispute: 'won', restored: true, republished: false });
        expect(db.paymentStatus).toBe('paid');
        expect(db.listing.isPublished).toBe(false);
    });
});

describe('a chargeback on a posting already refunded', () => {
    it('leaves it refunded and down from the dispute opened to the dispute won', async () => {
        // The post fee was refunded in full and took the posting down; its renewal payment is disputed.
        startWith('refunded', { isPublished: false });
        chargeFor('renewal', RENEWAL);
        const dispute = { id: 'dp_after_refund', payment_intent: 'pi_renewal', amount: RENEWAL };

        const opened = await deliver('evt_dispute_after_refund', 'charge.dispute.created', dispute);

        expect(opened.status).toBe(200);
        expect(db.paymentStatus).toBe('refunded');
        expect(db.listing.isPublished).toBe(false);
        expect(JSON.stringify(vi.mocked(sendDiscordMessage).mock.calls)).toContain('Chargeback on a posting already refunded');

        const won = await deliver('evt_dispute_after_refund_won', 'charge.dispute.closed', { ...dispute, status: 'won' });

        // Nothing 'disputed' to restore: a refunded posting never goes back to 'paid' or back on the board.
        expect(won.json).toEqual({ received: true, dispute: 'won', restored: false, republished: false });
        expect(db.paymentStatus).toBe('refunded');
        expect(db.listing.isPublished).toBe(false);
    });
});

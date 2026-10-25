/**
 * lib/post-packs.ts — the 5-post pack's credits (2027 re-price, phase 2).
 *
 * A pack is one EmployerPostPack row: config.packPosts credits bought once,
 * spendable by the buying account until expiresAt. Pinned here:
 *   - packExpiresAt: config.packValidityMonths calendar months in UTC, at the
 *     same time of day, clamped to the last day of the target month;
 *   - a credit is usable while the pack is 'paid', unexpired and has one left;
 *     the status is read across the account's current packs ('paid' and
 *     unexpired), so a used-up pack still reports its totals ("5 of 5 used",
 *     a code review fix of phase 3), and the pack that expires first among
 *     those with a credit left is the one a post spends;
 *   - spending is one conditional decrement inside the caller's transaction:
 *     no usable pack, or a pack another request emptied first, refuses
 *     (PackCreditUnavailableError) and never goes below zero;
 *   - the intro rule counts only PAID packs bought through STRIPE at the
 *     domain: refunded, disputed and admin-comped packs never use it up;
 *   - a full refund revokes the unused credits for good, a dispute freezes the
 *     pack, a won dispute unfreezes it, and the pack's own posts are taken
 *     down and put back with it, never a renewed one;
 *   - (fix pass, security review L2) every query on an account's packs
 *     refuses a missing account id: Prisma reads `userId: undefined` as no
 *     filter at all, which would read or spend every account's credits;
 *   - (fix pass, code review M1) taking the posts down and putting them back
 *     are two writes each, and the one that fails leaves a state the
 *     redelivered event finishes: the listing is changed first, matched on
 *     the status the rows still hold, and the status is flipped last.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import {
    PackCreditUnavailableError,
    countPaidPacksForDomain,
    currentPackWhere,
    freezePack,
    getPackCreditStatus,
    packExpiresAt,
    paidPackWhere,
    restorePackPosts,
    revokeUnusedPackCredits,
    spendPackCredit,
    takeDownPackPosts,
    unfreezePack,
    usablePackWhere,
} from '@/lib/post-packs';

const NOW = new Date('2027-03-01T12:00:00.000Z');
const USER = 'user-1';

function pack(overrides: Record<string, unknown> = {}) {
    return { id: 'pack-1', creditsRemaining: 5, creditsTotal: 5, creditsRevoked: 0, expiresAt: new Date('2028-03-01T12:00:00.000Z'), ...overrides };
}

beforeEach(() => {
    vi.clearAllMocks();
    // Back to an empty table (tests/setup.ts): a value one test sets must not leak into the next.
    vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.employerPostPack.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 0 } as never);
});

describe('packExpiresAt: 12 calendar months in UTC, clamped to the month', () => {
    it.each([
        ['mid month', '2027-01-15T10:00:00.000Z', '2028-01-15T10:00:00.000Z'],
        ['the last day of a 31-day month', '2027-01-31T23:59:59.000Z', '2028-01-31T23:59:59.000Z'],
        ['February 29 of a leap year', '2028-02-29T08:30:00.000Z', '2029-02-28T08:30:00.000Z'],
        ['the first instant of a year', '2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z'],
        ['December 31', '2027-12-31T18:00:00.000Z', '2028-12-31T18:00:00.000Z'],
    ])('%s: %s is usable until %s', (_label, bought, expires) => {
        expect(packExpiresAt(new Date(bought)).toISOString()).toBe(expires);
    });

    it('defaults to config.packValidityMonths, and clamps a shorter month for any length', () => {
        expect(config.packValidityMonths).toBe(12);
        expect(packExpiresAt(new Date('2027-08-31T00:00:00.000Z'), 6).toISOString()).toBe('2028-02-29T00:00:00.000Z');
        expect(packExpiresAt(new Date('2027-03-31T00:00:00.000Z'), 1).toISOString()).toBe('2027-04-30T00:00:00.000Z');
        expect(packExpiresAt(new Date('2027-11-30T00:00:00.000Z'), 3).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    });

    it('does not move the instant it is given', () => {
        const bought = new Date('2027-05-31T05:00:00.000Z');
        packExpiresAt(bought);
        expect(bought.toISOString()).toBe('2027-05-31T05:00:00.000Z');
    });
});

describe('getPackCreditStatus: what the account holds and can spend now', () => {
    it('a credit is usable while the pack is paid, unexpired and has one left', () => {
        expect(usablePackWhere(USER, NOW)).toEqual({ userId: USER, status: 'paid', expiresAt: { gt: NOW }, creditsRemaining: { gt: 0 } });
    });

    it("the status reads the account's current packs: paid and unexpired, whether or not a credit is left", () => {
        expect(currentPackWhere(USER, NOW)).toEqual({ userId: USER, status: 'paid', expiresAt: { gt: NOW } });
    });

    it('sums the current packs, and names the expiry of the pack a post spends first', async () => {
        vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([
            pack({ id: 'soon', creditsRemaining: 2, expiresAt: new Date('2027-06-01T00:00:00.000Z') }),
            pack({ id: 'later', creditsRemaining: 5, expiresAt: new Date('2028-01-01T00:00:00.000Z') }),
        ] as never);

        const status = await getPackCreditStatus(USER, NOW);

        expect(status).toEqual({ usable: true, remaining: 7, used: 3, total: 10, expiresAt: new Date('2027-06-01T00:00:00.000Z') });
        expect(prisma.employerPostPack.findMany).toHaveBeenCalledWith({
            where: currentPackWhere(USER, NOW),
            select: { creditsRemaining: true, creditsTotal: true, creditsRevoked: true, expiresAt: true },
            orderBy: [{ expiresAt: 'asc' }, { purchasedAt: 'asc' }],
        });
    });

    it('a used-up pack still reports its totals, so a page can say "5 of 5 used" (review fix)', async () => {
        const expiresAt = new Date('2028-01-01T00:00:00.000Z');
        vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([pack({ creditsRemaining: 0, expiresAt })] as never);

        expect(await getPackCreditStatus(USER, NOW)).toEqual({ usable: false, remaining: 0, used: config.packPosts, total: config.packPosts, expiresAt });
    });

    it('skips a used-up pack for the next spend: the expiry named is the pack a post spends from', async () => {
        vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([
            pack({ id: 'used-up', creditsRemaining: 0, expiresAt: new Date('2027-06-01T00:00:00.000Z') }),
            pack({ id: 'next', creditsRemaining: 4, expiresAt: new Date('2028-01-01T00:00:00.000Z') }),
        ] as never);

        expect(await getPackCreditStatus(USER, NOW)).toEqual({ usable: true, remaining: 4, used: 6, total: 10, expiresAt: new Date('2028-01-01T00:00:00.000Z') });
    });

    it('with every current pack used up, names the last of them to expire', async () => {
        vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([
            pack({ id: 'first', creditsRemaining: 0, expiresAt: new Date('2027-06-01T00:00:00.000Z') }),
            pack({ id: 'second', creditsRemaining: 0, expiresAt: new Date('2028-01-01T00:00:00.000Z') }),
        ] as never);

        expect(await getPackCreditStatus(USER, NOW)).toMatchObject({ usable: false, remaining: 0, used: 10, total: 10, expiresAt: new Date('2028-01-01T00:00:00.000Z') });
    });

    it('counts the credits a pack still holds: revoked ones are neither used nor part of its total', async () => {
        vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([pack({ creditsRemaining: 1, creditsRevoked: 1 })] as never);

        expect(await getPackCreditStatus(USER, NOW)).toMatchObject({ remaining: 1, used: 3, total: 4 });
    });

    it('has nothing usable without a pack, and reads nothing without an account', async () => {
        expect(await getPackCreditStatus(USER, NOW)).toEqual({ usable: false, remaining: 0, used: 0, total: 0, expiresAt: null });
        vi.mocked(prisma.employerPostPack.findMany).mockClear();
        expect(await getPackCreditStatus(null, NOW)).toEqual({ usable: false, remaining: 0, used: 0, total: 0, expiresAt: null });
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
    });

    it("reads through the caller's client", async () => {
        const tx = { employerPostPack: { findMany: vi.fn().mockResolvedValue([pack()]) } };

        expect((await getPackCreditStatus(USER, NOW, tx as never)).usable).toBe(true);
        expect(tx.employerPostPack.findMany).toHaveBeenCalledOnce();
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
    });
});

describe('spendPackCredit: one conditional decrement inside the posting transaction', () => {
    function tx(found: unknown, updated: number) {
        return {
            employerPostPack: {
                findFirst: vi.fn().mockResolvedValue(found),
                updateMany: vi.fn().mockResolvedValue({ count: updated }),
            },
        };
    }

    it('spends from the usable pack that expires first, guarded by the same conditions', async () => {
        const client = tx({ id: 'pack-soon' }, 1);

        expect(await spendPackCredit(client as never, USER, NOW)).toEqual({ packId: 'pack-soon' });
        expect(client.employerPostPack.findFirst).toHaveBeenCalledWith({
            where: usablePackWhere(USER, NOW),
            orderBy: [{ expiresAt: 'asc' }, { purchasedAt: 'asc' }],
            select: { id: true },
        });
        expect(client.employerPostPack.updateMany).toHaveBeenCalledWith({
            where: { id: 'pack-soon', userId: USER, status: 'paid', expiresAt: { gt: NOW }, creditsRemaining: { gt: 0 } },
            data: { creditsRemaining: { decrement: 1 } },
        });
    });

    it('refuses when the account has no usable pack, writing nothing', async () => {
        const client = tx(null, 0);

        await expect(spendPackCredit(client as never, USER, NOW)).rejects.toBeInstanceOf(PackCreditUnavailableError);
        expect(client.employerPostPack.updateMany).not.toHaveBeenCalled();
    });

    it('refuses when another request spent the last credit between the read and the write', async () => {
        const client = tx({ id: 'pack-1' }, 0);

        await expect(spendPackCredit(client as never, USER, NOW)).rejects.toBeInstanceOf(PackCreditUnavailableError);
    });
});

describe('an account id is required (security review L2)', () => {
    // Prisma reads `userId: undefined` as no filter at all: every account's packs.
    it.each([['an empty id', ''], ['no id', undefined]])('the where clauses refuse %s', (_label, userId) => {
        expect(() => usablePackWhere(userId as never, NOW)).toThrow(/account id/);
        expect(() => currentPackWhere(userId as never, NOW)).toThrow(/account id/);
    });

    it.each([['an empty id', ''], ['no id', undefined]])('spendPackCredit refuses %s before it reads or writes anything', async (_label, userId) => {
        const client = { employerPostPack: { findFirst: vi.fn().mockResolvedValue({ id: 'pack-1' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };

        await expect(spendPackCredit(client as never, userId as never, NOW)).rejects.toThrow(/account id/);
        expect(client.employerPostPack.findFirst).not.toHaveBeenCalled();
        expect(client.employerPostPack.updateMany).not.toHaveBeenCalled();
    });
});

describe('countPaidPacksForDomain: the intro rule', () => {
    it('counts only paid packs bought through Stripe at the domain', async () => {
        vi.mocked(prisma.employerPostPack.count).mockResolvedValue(1 as never);

        expect(await countPaidPacksForDomain('clinic.example')).toBe(1);
        expect(prisma.employerPostPack.count).toHaveBeenCalledWith({ where: { quotaDomain: 'clinic.example', status: 'paid', source: 'stripe' } });
        // Refunded, disputed and admin-comped packs never use the intro price up.
        expect(paidPackWhere('clinic.example')).toEqual({ quotaDomain: 'clinic.example', status: 'paid', source: 'stripe' });
    });

    it("reads through the caller's client", async () => {
        const client = { employerPostPack: { count: vi.fn().mockResolvedValue(0) } };

        expect(await countPaidPacksForDomain('clinic.example', client as never)).toBe(0);
        expect(prisma.employerPostPack.count).not.toHaveBeenCalled();
    });
});

describe('revokeUnusedPackCredits: a full refund, or a lost dispute', () => {
    it('moves the unused credits to revoked and sets the status, compared and set on the counter', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue({ status: 'paid', creditsRemaining: 3 } as never);
        vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 1 } as never);

        expect(await revokeUnusedPackCredits('pack-1', ['paid', 'disputed'], 'refunded')).toEqual({ changed: true, revoked: 3 });
        expect(prisma.employerPostPack.updateMany).toHaveBeenCalledWith({
            where: { id: 'pack-1', status: 'paid', creditsRemaining: 3 },
            data: { status: 'refunded', creditsRemaining: 0, creditsRevoked: { increment: 3 } },
        });
    });

    it('re-reads and tries again when a post spent a credit at the same moment', async () => {
        vi.mocked(prisma.employerPostPack.findUnique)
            .mockResolvedValueOnce({ status: 'paid', creditsRemaining: 3 } as never)
            .mockResolvedValueOnce({ status: 'paid', creditsRemaining: 2 } as never);
        vi.mocked(prisma.employerPostPack.updateMany)
            .mockResolvedValueOnce({ count: 0 } as never)
            .mockResolvedValueOnce({ count: 1 } as never);

        expect(await revokeUnusedPackCredits('pack-1', ['paid'], 'refunded')).toEqual({ changed: true, revoked: 2 });
        expect(vi.mocked(prisma.employerPostPack.updateMany).mock.calls[1][0]).toMatchObject({ where: { creditsRemaining: 2 } });
    });

    it('changes nothing for a pack already out of those statuses (a redelivered refund) or gone', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValueOnce({ status: 'refunded', creditsRemaining: 0 } as never);
        expect(await revokeUnusedPackCredits('pack-1', ['paid', 'disputed'], 'refunded')).toEqual({ changed: false, revoked: 0 });
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValueOnce(null as never);
        expect(await revokeUnusedPackCredits('pack-1', ['paid'], 'refunded')).toEqual({ changed: false, revoked: 0 });
        expect(prisma.employerPostPack.updateMany).not.toHaveBeenCalled();
    });

    it('gives up loudly when the counter will not hold still, so the webhook answers 500 and Stripe retries', async () => {
        vi.mocked(prisma.employerPostPack.findUnique).mockResolvedValue({ status: 'paid', creditsRemaining: 4 } as never);
        vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 0 } as never);

        await expect(revokeUnusedPackCredits('pack-1', ['paid'], 'refunded')).rejects.toThrow(/kept changing/);
    });
});

describe('freezePack / unfreezePack: a dispute and its win', () => {
    it("a dispute freezes a paid pack: 'disputed' is never usable, and its credits stay counted", async () => {
        vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 1 } as never);

        expect(await freezePack('pack-1')).toBe(true);
        expect(prisma.employerPostPack.updateMany).toHaveBeenCalledWith({ where: { id: 'pack-1', status: 'paid' }, data: { status: 'disputed' } });
    });

    it('a won dispute unfreezes only a pack still disputed (a refund since then wins)', async () => {
        vi.mocked(prisma.employerPostPack.updateMany).mockResolvedValue({ count: 0 } as never);

        expect(await unfreezePack('pack-1')).toBe(false);
        expect(prisma.employerPostPack.updateMany).toHaveBeenCalledWith({ where: { id: 'pack-1', status: 'disputed' }, data: { status: 'paid' } });
    });
});

describe("takeDownPackPosts / restorePackPosts: the pack's own posts follow it", () => {
    it("takes down the posts that still stand on the pack ('pack' rows), as a full refund of a post does", async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([{ id: 'ej-1', jobId: 'job-1' }, { id: 'ej-2', jobId: 'job-2' }] as never);
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 2 } as never);
        vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 2 } as never);

        expect(await takeDownPackPosts('pack-1', 'refunded')).toEqual(['job-1', 'job-2']);
        // A renewed pack post is 'paid', with its own renewal payment: it is not selected.
        expect(prisma.employerJob.findMany).toHaveBeenCalledWith({ where: { postPackId: 'pack-1', paymentStatus: 'pack' }, select: { id: true, jobId: true } });
        // Unpublished first, matched on the status the rows still hold: one renewed in between keeps its listing.
        expect(prisma.job.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['job-1', 'job-2'] }, employerJobs: { postPackId: 'pack-1', paymentStatus: 'pack' } },
            data: { isPublished: false },
        });
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ej-1', 'ej-2'] }, paymentStatus: 'pack' }, data: { paymentStatus: 'refunded' } });
        // The status flips last, so a failed flip leaves rows the redelivery selects again.
        expect(vi.mocked(prisma.job.updateMany).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(prisma.employerJob.updateMany).mock.invocationCallOrder[0]);
    });

    it('does nothing for a pack with no post standing on it', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);

        expect(await takeDownPackPosts('pack-1', 'disputed')).toEqual([]);
        expect(prisma.employerJob.updateMany).not.toHaveBeenCalled();
        expect(prisma.job.updateMany).not.toHaveBeenCalled();
    });

    it('a won dispute puts back the posts the dispute took down, and republishes those still inside their run', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([
            { id: 'ej-live', jobId: 'job-live', job: { expiresAt: new Date('2027-04-01T00:00:00.000Z'), archivedAt: null, isManuallyUnpublished: false } },
            { id: 'ej-ended', jobId: 'job-ended', job: { expiresAt: new Date('2027-02-01T00:00:00.000Z'), archivedAt: null, isManuallyUnpublished: false } },
            { id: 'ej-archived', jobId: 'job-archived', job: { expiresAt: new Date('2027-04-01T00:00:00.000Z'), archivedAt: new Date('2027-02-15T00:00:00.000Z'), isManuallyUnpublished: true } },
            { id: 'ej-paused', jobId: 'job-paused', job: { expiresAt: new Date('2027-04-01T00:00:00.000Z'), archivedAt: null, isManuallyUnpublished: true } },
        ] as never);
        vi.mocked(prisma.employerJob.updateMany).mockResolvedValue({ count: 4 } as never);
        vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);

        expect(await restorePackPosts('pack-1', NOW)).toEqual({ restored: 4, republished: ['job-live'] });
        // A pack post disputed through its own renewal charge has a JobCharge: never selected.
        expect(prisma.employerJob.findMany).toHaveBeenCalledWith({
            where: { postPackId: 'pack-1', paymentStatus: 'disputed', jobCharges: { none: {} } },
            select: { id: true, jobId: true, job: { select: { expiresAt: true, archivedAt: true, isManuallyUnpublished: true } } },
        });
        expect(prisma.employerJob.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['ej-live', 'ej-ended', 'ej-archived', 'ej-paused'] }, paymentStatus: 'disputed' },
            data: { paymentStatus: 'pack' },
        });
        // Republished first, matched on the status the rows still hold; the status flips last.
        expect(prisma.job.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['job-live'] }, archivedAt: null, employerJobs: { postPackId: 'pack-1', paymentStatus: 'disputed' } },
            data: { isPublished: true, contentChangedAt: NOW },
        });
        expect(vi.mocked(prisma.job.updateMany).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(prisma.employerJob.updateMany).mock.invocationCallOrder[0]);
    });
});

/**
 * Code review M1: each of these steps is two writes, and the webhook answers
 * 500 when one fails, so Stripe redelivers the event. Whichever write failed,
 * the redelivery has to finish both. The status used to flip first: a failed
 * listing write after it left rows the redelivery no longer selected (they
 * hold the new status), so refunded posts stayed live, or restored ones dark.
 */
describe('a failed write is finished by the redelivered event (code review M1)', () => {
    interface Row { id: string; jobId: string; paymentStatus: string }
    type RowFilter = { postPackId?: string; paymentStatus?: string };

    /** The two tables as the functions read and write them, in place of Prisma; `failOnce` names the table whose next write throws. */
    function fakeDb(rows: Row[], published: Record<string, boolean>) {
        const failOnce = new Set<'job' | 'employerJob'>();
        const stillHolds = (row: Row, where: RowFilter) => where.paymentStatus === undefined || row.paymentStatus === where.paymentStatus;
        const db = {
            employerJob: {
                findMany: vi.fn(async ({ where }: { where: RowFilter }) => rows
                    .filter((row) => stillHolds(row, where))
                    .map((row) => ({ id: row.id, jobId: row.jobId, job: { expiresAt: new Date('2027-04-01T00:00:00.000Z'), archivedAt: null, isManuallyUnpublished: false } }))),
                updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] }; paymentStatus: string }; data: { paymentStatus: string } }) => {
                    if (failOnce.delete('employerJob')) throw new Error('connection reset');
                    const hit = rows.filter((row) => where.id.in.includes(row.id) && row.paymentStatus === where.paymentStatus);
                    for (const row of hit) row.paymentStatus = data.paymentStatus;
                    return { count: hit.length };
                }),
            },
            job: {
                updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] }; employerJobs?: RowFilter }; data: { isPublished: boolean } }) => {
                    if (failOnce.delete('job')) throw new Error('connection reset');
                    const hit = rows.filter((row) => where.id.in.includes(row.jobId) && (!where.employerJobs || stillHolds(row, where.employerJobs)));
                    for (const row of hit) published[row.jobId] = data.isPublished;
                    return { count: hit.length };
                }),
            },
        };
        return { db, failOnce };
    }

    const twoPosts = (paymentStatus: string): Row[] => [
        { id: 'ej-1', jobId: 'job-1', paymentStatus },
        { id: 'ej-2', jobId: 'job-2', paymentStatus },
    ];

    it.each(['job', 'employerJob'] as const)('a full refund whose %s write fails once is finished by the redelivery', async (table) => {
        const rows = twoPosts('pack');
        const published = { 'job-1': true, 'job-2': true };
        const { db, failOnce } = fakeDb(rows, published);
        failOnce.add(table);

        await expect(takeDownPackPosts('pack-1', 'refunded', db as never)).rejects.toThrow('connection reset');
        await takeDownPackPosts('pack-1', 'refunded', db as never);

        expect(rows.map((row) => row.paymentStatus)).toEqual(['refunded', 'refunded']);
        expect(published).toEqual({ 'job-1': false, 'job-2': false });
    });

    it.each(['job', 'employerJob'] as const)('a won dispute whose %s write fails once is finished by the redelivery', async (table) => {
        const rows = twoPosts('disputed');
        const published = { 'job-1': false, 'job-2': false };
        const { db, failOnce } = fakeDb(rows, published);
        failOnce.add(table);

        await expect(restorePackPosts('pack-1', NOW, db as never)).rejects.toThrow('connection reset');
        expect(await restorePackPosts('pack-1', NOW, db as never)).toEqual({ restored: 2, republished: ['job-1', 'job-2'] });

        expect(rows.map((row) => row.paymentStatus)).toEqual(['pack', 'pack']);
        expect(published).toEqual({ 'job-1': true, 'job-2': true });
    });
});

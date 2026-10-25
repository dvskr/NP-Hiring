/**
 * GET /api/employer/free-quota-status — the next-post quote with a 5-post
 * pack (2027 re-price, phase 2).
 *
 * The quote follows lib/pricing.ts#resolvePostingMode: promo, then a usable
 * pack credit, then intro, then paid. The answer carries
 * `pack: { remaining, used, total, expiresAt }` whenever the account holds a
 * current pack, used up or not (lib/post-packs.ts#getPackCreditStatus; a
 * used-up pack still reports its totals, a phase 3 review fix), in place of
 * the retired Employer plan's `plan` field, which is never sent again. The
 * legacy `remaining` / `limit` pair reads the credits left and held in pack
 * mode.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { currentPackWhere } from '@/lib/post-packs';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const DURING_PROMO = new Date('2026-11-01T12:00:00.000Z');
const AFTER_PROMO = new Date('2027-03-01T12:00:00.000Z');
const SOON = new Date('2027-06-30T00:00:00.000Z');
const LATER = new Date('2028-01-31T00:00:00.000Z');

function signedIn(email = 'owner@clinic.example') {
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ role: 'employer' } as never);
}

function packs(rows: { creditsRemaining: number; creditsTotal?: number; expiresAt: Date }[]) {
    vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue(
        rows.map((row) => ({ creditsTotal: config.packPosts, creditsRevoked: 0, ...row })) as never,
    );
}

async function quote() {
    const { GET } = await import('@/app/api/employer/free-quota-status/route');
    const res = await GET();
    return { res, json: await res.json() };
}

// The route graph's cold import, paid once outside any test's time budget.
beforeAll(async () => {
    await import('@/app/api/employer/free-quota-status/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    signedIn();
    vi.mocked(prisma.employerPostPack.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.employerPostPack.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('after the promo', () => {
    beforeEach(() => vi.setSystemTime(AFTER_PROMO));

    it("quotes a free 'pack' post while a credit is usable, and reports the credits", async () => {
        packs([{ creditsRemaining: 2, expiresAt: SOON }, { creditsRemaining: 5, expiresAt: LATER }]);

        const { res, json } = await quote();

        expect(res.status).toBe(200);
        expect(json).toMatchObject({
            eligible: true,
            mode: 'pack',
            tier: 'pack',
            willBeFree: true,
            price: 0,
            priceCents: 0,
            durationDays: config.durationDays,
            promoActive: false,
            pack: { remaining: 7, used: 3, total: 2 * config.packPosts, expiresAt: SOON.toISOString() },
            remaining: 7,
            limit: 2 * config.packPosts,
        });
        expect(prisma.employerPostPack.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: currentPackWhere('user-1', AFTER_PROMO) }));
        // A credit wins ahead of the intro price: no paid-post count is read.
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
    });

    it('quotes the ladder and sends no pack field without a current pack', async () => {
        const { json } = await quote();

        expect(json).toMatchObject({ mode: 'intro', tier: 'intro', price: config.introPrice, willBeFree: false, remaining: 0, limit: 0 });
        expect(json).not.toHaveProperty('pack');
    });

    it('once the last credit is used, quotes the paid post and still reports the pack: 5 of 5 used, and its expiry', async () => {
        packs([{ creditsRemaining: 0, expiresAt: LATER }]);
        vi.mocked(prisma.employerPostPack.count).mockResolvedValue(1 as never);

        const { json } = await quote();

        expect(json).toMatchObject({
            mode: 'paid',
            willBeFree: false,
            price: config.postingPrice,
            pack: { remaining: 0, used: config.packPosts, total: config.packPosts, expiresAt: LATER.toISOString() },
            remaining: 0,
            limit: 0,
        });
    });

    it('quotes the posting price once the domain bought a pack, though its credits are gone', async () => {
        vi.mocked(prisma.employerPostPack.count).mockResolvedValue(1 as never);

        const { json } = await quote();

        expect(json).toMatchObject({ mode: 'paid', tier: 'pro', price: config.postingPrice });
    });

    it('never sends the retired plan field', async () => {
        vi.mocked(prisma.employerPlan.findUnique).mockResolvedValue({ status: 'active', slots: 5, currentPeriodEnd: LATER } as never);
        packs([{ creditsRemaining: 1, expiresAt: SOON }]);

        const { json } = await quote();

        expect(json).not.toHaveProperty('plan');
        expect(prisma.employerPlan.findUnique).not.toHaveBeenCalled();
    });
});

describe('during the promo', () => {
    beforeEach(() => vi.setSystemTime(DURING_PROMO));

    it('quotes the promo, which wins over a credit, and still reports the credits the account holds', async () => {
        packs([{ creditsRemaining: 5, expiresAt: LATER }]);

        const { json } = await quote();

        expect(json).toMatchObject({ mode: 'promo', willBeFree: true, promoActive: true, pack: { remaining: 5, used: 0, total: config.packPosts, expiresAt: LATER.toISOString() } });
        // The legacy pair keeps its promo meaning: cap headroom and cap.
        expect(json.limit).toBe(config.promoMaxActivePostsPerDomain);
    });
});

describe('who gets a quote', () => {
    it('401s an anonymous caller before any read', async () => {
        getUserMock.mockResolvedValue({ data: { user: null }, error: null });

        const { res, json } = await quote();

        expect(res.status).toBe(401);
        expect(json).toMatchObject({ eligible: false, reason: 'unauthenticated' });
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
    });

    it('a free-email signup is not eligible, and its packs are not read', async () => {
        vi.setSystemTime(AFTER_PROMO);
        signedIn('someone@gmail.com');

        const { json } = await quote();

        expect(json).toEqual({ eligible: false, reason: 'free-email-provider' });
        expect(prisma.employerPostPack.findMany).not.toHaveBeenCalled();
    });

    it('a failed read answers 500 without the error text', async () => {
        vi.setSystemTime(AFTER_PROMO);
        vi.mocked(prisma.employerPostPack.findMany).mockRejectedValue(new Error('select failed: secret detail'));

        const { res, json } = await quote();

        expect(res.status).toBe(500);
        expect(JSON.stringify(json)).not.toContain('secret detail');
    });
});

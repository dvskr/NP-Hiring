/**
 * Who may download a guide: a browser holding a token for a purchase (or a
 * promo claim) that includes the guide, is not refunded or disputed, and is
 * under its limit. The count is a conditional increment, so parallel clicks
 * cannot pass it. The library lists guides in store order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { MAX_DOWNLOADS_PER_PURCHASE } from '@/lib/guides/access';
import { authorizeDownload, loadLibrary, purchaseExists, releaseDownload } from '@/lib/guides/library';

const gp = prisma.guidePurchase as unknown as Record<string, ReturnType<typeof vi.fn>>;
const TOKEN = 'c'.repeat(48);

beforeEach(() => {
    vi.clearAllMocks();
    gp.findMany.mockReset().mockResolvedValue([]);
    gp.updateMany.mockReset().mockResolvedValue({ count: 0 });
    gp.count.mockReset().mockResolvedValue(0);
});

describe('authorizeDownload', () => {
    it('refuses a browser with no tokens without touching the database', async () => {
        expect(await authorizeDownload([], 'interview-prep-pack')).toEqual({ ok: false, reason: 'no-access' });
        expect(gp.findMany).not.toHaveBeenCalled();
    });

    it('looks only at purchases that include the guide', async () => {
        gp.findMany.mockResolvedValueOnce([]);
        expect(await authorizeDownload([TOKEN], 'launch-your-practice')).toEqual({ ok: false, reason: 'no-access' });
        expect(gp.findMany.mock.calls[0][0].where).toEqual({ accessToken: { in: [TOKEN] }, guideSlugs: { has: 'launch-your-practice' } });
    });

    it('refuses a refunded or disputed purchase', async () => {
        gp.findMany.mockResolvedValueOnce([{ id: 'p1', refundedAt: new Date(), disputedAt: null, downloadCount: 0 }]);
        expect(await authorizeDownload([TOKEN], 'interview-prep-pack')).toEqual({ ok: false, reason: 'revoked' });
        gp.findMany.mockResolvedValueOnce([{ id: 'p1', refundedAt: null, disputedAt: new Date(), downloadCount: 0 }]);
        expect(await authorizeDownload([TOKEN], 'interview-prep-pack')).toEqual({ ok: false, reason: 'revoked' });
        expect(gp.updateMany).not.toHaveBeenCalled();
    });

    it('counts the download with a conditional increment', async () => {
        gp.findMany.mockResolvedValueOnce([{ id: 'p1', refundedAt: null, disputedAt: null, downloadCount: 3 }]);
        gp.updateMany.mockResolvedValueOnce({ count: 1 });
        expect(await authorizeDownload([TOKEN], 'interview-prep-pack')).toEqual({ ok: true, purchaseId: 'p1' });
        expect(gp.updateMany).toHaveBeenCalledWith({
            where: { id: 'p1', downloadCount: { lt: MAX_DOWNLOADS_PER_PURCHASE }, refundedAt: null, disputedAt: null },
            data: { downloadCount: { increment: 1 } },
        });
    });

    it('refuses once every purchase is at its limit', async () => {
        gp.findMany.mockResolvedValueOnce([{ id: 'p1', refundedAt: null, disputedAt: null, downloadCount: MAX_DOWNLOADS_PER_PURCHASE }]);
        gp.updateMany.mockResolvedValueOnce({ count: 0 });
        expect(await authorizeDownload([TOKEN], 'interview-prep-pack')).toEqual({ ok: false, reason: 'limit' });
    });

    it('falls through to another purchase of the same guide', async () => {
        gp.findMany.mockResolvedValueOnce([
            { id: 'p1', refundedAt: null, disputedAt: null, downloadCount: MAX_DOWNLOADS_PER_PURCHASE },
            { id: 'p2', refundedAt: null, disputedAt: null, downloadCount: MAX_DOWNLOADS_PER_PURCHASE },
        ]);
        gp.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
        expect(await authorizeDownload([TOKEN], 'interview-prep-pack')).toEqual({ ok: true, purchaseId: 'p2' });
    });
});

describe('releaseDownload', () => {
    it('gives back one counted download, never going below zero', async () => {
        gp.updateMany.mockResolvedValueOnce({ count: 1 });
        await releaseDownload('p1');
        expect(gp.updateMany).toHaveBeenCalledWith({
            where: { id: 'p1', downloadCount: { gt: 0 } },
            data: { downloadCount: { decrement: 1 } },
        });
    });
});

describe('loadLibrary', () => {
    it('is empty for a browser with no tokens, without a query', async () => {
        expect(await loadLibrary([])).toEqual({ purchases: [], guides: [] });
        expect(gp.findMany).not.toHaveBeenCalled();
    });

    it('lists the guides of active purchases only, in store order', async () => {
        gp.findMany.mockResolvedValueOnce([
            { id: 'p1', productSlug: 'practice-owner-bundle', guideSlugs: ['launch-your-practice', 'telehealth-playbook', 'compensation-report'], createdAt: new Date(), refundedAt: null, disputedAt: null },
            { id: 'p2', productSlug: 'interview-prep-pack', guideSlugs: ['interview-prep-pack'], createdAt: new Date(), refundedAt: new Date(), disputedAt: null },
        ]);
        const library = await loadLibrary([TOKEN]);
        expect(library.guides).toEqual(['compensation-report', 'telehealth-playbook', 'launch-your-practice']);
        expect(library.purchases.map((p) => p.revoked)).toEqual([false, true]);
    });

    it('drops a slug the catalog no longer has', async () => {
        gp.findMany.mockResolvedValueOnce([
            { id: 'p1', productSlug: 'old', guideSlugs: ['retired-guide', 'first-year-playbook'], createdAt: new Date(), refundedAt: null, disputedAt: null },
        ]);
        expect((await loadLibrary([TOKEN])).guides).toEqual(['first-year-playbook']);
    });
});

describe('purchaseExists', () => {
    it('is true only for a token that matches a row', async () => {
        gp.count.mockResolvedValueOnce(1);
        expect(await purchaseExists(TOKEN)).toBe(true);
        expect(gp.count).toHaveBeenCalledWith({ where: { accessToken: TOKEN } });
        gp.count.mockResolvedValueOnce(0);
        expect(await purchaseExists(TOKEN)).toBe(false);
    });
});

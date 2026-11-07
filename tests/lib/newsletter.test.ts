/**
 * lib/newsletter.ts: the public signup and the guide claim form both opt an
 * address in. An anonymous claim does not prove who owns the address, so it
 * may subscribe only an address the site has never seen: it can never
 * re-subscribe someone who unsubscribed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/beehiiv', () => ({ syncToBeehiiv: vi.fn() }));

import { syncToBeehiiv } from '@/lib/beehiiv';
import { subscribeNewAddressToNewsletter, subscribeToNewsletter } from '@/lib/newsletter';

const lead = prisma.emailLead as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
    vi.clearAllMocks();
    lead.upsert = vi.fn().mockResolvedValue({});
    lead.findUnique.mockReset().mockResolvedValue(null);
    lead.create.mockReset().mockResolvedValue({});
});

describe('subscribeToNewsletter', () => {
    it('creates the lead or sets its opt-in, keeps the source of a new one, and syncs Beehiiv', async () => {
        await subscribeToNewsletter('np@example.com', 'guide_claim');
        expect(lead.upsert).toHaveBeenCalledWith({
            where: { email: 'np@example.com' },
            update: { newsletterOptIn: true },
            create: { email: 'np@example.com', source: 'guide_claim', newsletterOptIn: true },
        });
        expect(syncToBeehiiv).toHaveBeenCalledWith('np@example.com', { utmSource: 'guide_claim' });
    });
});

describe('subscribeNewAddressToNewsletter', () => {
    it('subscribes an address the site has never seen', async () => {
        expect(await subscribeNewAddressToNewsletter('np@example.com', 'guide_claim')).toBe(true);
        expect(lead.create).toHaveBeenCalledWith({ data: { email: 'np@example.com', source: 'guide_claim', newsletterOptIn: true } });
        expect(syncToBeehiiv).toHaveBeenCalledWith('np@example.com', { utmSource: 'guide_claim' });
    });

    it('leaves an address on file as it is, so an unsubscribe stands', async () => {
        lead.findUnique.mockResolvedValueOnce({ id: 'lead-1' });
        expect(await subscribeNewAddressToNewsletter('np@example.com', 'guide_claim')).toBe(false);
        expect(lead.create).not.toHaveBeenCalled();
        expect(lead.upsert).not.toHaveBeenCalled();
        expect(syncToBeehiiv).not.toHaveBeenCalled();
    });

    it('leaves a lead another request created a moment ago, and throws any other write failure', async () => {
        lead.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
        expect(await subscribeNewAddressToNewsletter('np@example.com', 'guide_claim')).toBe(false);
        expect(syncToBeehiiv).not.toHaveBeenCalled();
        lead.create.mockRejectedValueOnce(new Error('db down'));
        await expect(subscribeNewAddressToNewsletter('np@example.com', 'guide_claim')).rejects.toThrow('db down');
    });
});

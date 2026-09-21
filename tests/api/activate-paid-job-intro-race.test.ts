/**
 * Intro-rung race detector (app/api/webhooks/stripe/activate-paid-job.ts).
 *
 * The $199 intro price is decided when the Checkout Session is CREATED from
 * the domain's paid-post count, so two checkouts opened at once for one
 * domain can both be sold at 'intro'. The race is accepted (blocking it at
 * creation would punish an honest abandon-and-retry with the $299 price);
 * what must hold instead is that the second activation is SURFACED:
 *
 *   - an 'intro' activation that finds another paid post at the same domain
 *     logs a Sentry-forwarded error naming the domain and session;
 *   - the count uses the exact intro predicate (lib/pricing.ts#paidPostWhere)
 *     minus the row being activated, so it cannot drift from the decision;
 *   - a 'pro' activation, a legacy row without quotaDomain, and a clean
 *     first intro never log; a failing count never throws.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { paidPostWhere } from '@/lib/pricing';
import { detectIntroDoubleCharge } from '@/app/api/webhooks/stripe/activate-paid-job';

vi.mock('@/lib/email-service', () => ({
    sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    getOrCreateUnsubToken: vi.fn().mockResolvedValue('utok'),
}));
vi.mock('@/lib/search-indexing', () => ({ pingAllSearchEngines: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerPurchase: vi.fn().mockResolvedValue(undefined) }));

const SESSION = { id: 'cs_test_intro', amount_total: 19900 };
const DOMAIN = 'clinic.example';

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

describe('detectIntroDoubleCharge', () => {
    it('logs an error when an intro activation finds another paid post at the domain', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(1 as never);

        const flagged = await detectIntroDoubleCharge('ej-2', DOMAIN, 'intro', 'job-2', SESSION);

        expect(flagged).toBe(true);
        expect(logger.error).toHaveBeenCalledTimes(1);
        const [message, err, context] = vi.mocked(logger.error).mock.calls[0];
        expect(message).toMatch(/Intro price charged twice/);
        expect(err).toBeUndefined();
        expect(context).toMatchObject({ jobId: 'job-2', employerJobId: 'ej-2', quotaDomain: DOMAIN, sessionId: 'cs_test_intro', amountCents: 19900, otherPaidPosts: 1 });
    });

    it('counts with the exact intro predicate minus the row being activated', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        await detectIntroDoubleCharge('ej-1', DOMAIN, 'intro', 'job-1', SESSION);

        expect(prisma.employerJob.count).toHaveBeenCalledWith({
            where: { ...paidPostWhere(DOMAIN), id: { not: 'ej-1' } },
        });
    });

    it('stays silent for a clean first intro post', async () => {
        vi.mocked(prisma.employerJob.count).mockResolvedValue(0 as never);

        expect(await detectIntroDoubleCharge('ej-1', DOMAIN, 'intro', 'job-1', SESSION)).toBe(false);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("never runs for a 'pro' activation or a row without a quota domain", async () => {
        expect(await detectIntroDoubleCharge('ej-3', DOMAIN, 'pro', 'job-3', SESSION)).toBe(false);
        expect(await detectIntroDoubleCharge('ej-4', null, 'intro', 'job-4', SESSION)).toBe(false);
        expect(prisma.employerJob.count).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('never throws when the count itself fails — activation must not depend on the detector', async () => {
        vi.mocked(prisma.employerJob.count).mockRejectedValue(new Error('db down') as never);

        await expect(detectIntroDoubleCharge('ej-5', DOMAIN, 'intro', 'job-5', SESSION)).resolves.toBe(false);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.error).not.toHaveBeenCalled();
    });
});

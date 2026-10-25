/**
 * GET /api/jobs/edit/[token] — the renewal price of the post being edited
 * (2027 re-price).
 *
 * The edit page prints the price its renewal modal charges and measures the
 * saving it claims from it, and it is a client bundle that has neither the
 * ledger nor lib/renewal-price.ts. So the route decides it: it loads the
 * row's 'new' charge with the post (NEW_POST_CHARGE_SELECT) and answers
 * employerJob.renewalPrice, in dollars, from the same rule the renewal
 * checkout charges by (tests/api/create-renewal-checkout-tiered-price.test.ts).
 * Nothing else about the answer changes, and the charge rows themselves are
 * not sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { logger } from '@/lib/logger';
import { NEW_POST_CHARGE_SELECT } from '@/lib/pricing';

vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(async () => null),
    RATE_LIMITS: { auth: { limit: 10, windowMs: 60_000 } },
}));
vi.mock('@/lib/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface RowOptions {
    paymentStatus?: string;
    pricingTier?: string;
    bought?: boolean;
    withoutCharges?: boolean;
}

function row({ paymentStatus = 'paid', pricingTier = 'pro', bought = false, withoutCharges = false }: RowOptions = {}) {
    vi.mocked(prisma.employerJob.findFirst).mockResolvedValue({
        id: 'ej-1',
        employerName: 'Clinic Co',
        contactEmail: 'owner@clinic.example',
        companyWebsite: 'https://clinic.example',
        companyLogoUrl: null,
        paymentStatus,
        pricingTier,
        editToken: 'edit-1',
        ...(withoutCharges ? {} : { jobCharges: bought ? [{ id: 'jc-new' }] : [] }),
        job: {
            id: 'job-1',
            title: 'Family Nurse Practitioner',
            isPublished: true,
            expiresAt: new Date(Date.now() + 10 * 86_400_000),
            screeningQuestions: [],
        },
    } as never);
}

async function get(token = 'edit-1') {
    const { GET } = await import('@/app/api/jobs/edit/[token]/route');
    const res = await GET(
        new NextRequest(`https://test.local/api/jobs/edit/${token}`),
        { params: Promise.resolve({ token }) },
    );
    return { res, json: await res.json() };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('employerJob.renewalPrice follows what the post cost', () => {
    it.each([
        ['a promo post', { paymentStatus: 'promo', pricingTier: 'pro' }, config.renewalPrice],
        ['a promo post that was renewed once', { paymentStatus: 'paid', pricingTier: 'pro' }, config.renewalPrice],
        ['an intro post', { paymentStatus: 'paid', pricingTier: 'intro', bought: true }, config.renewalPrice],
        ['a post bought at the posting price', { paymentStatus: 'paid', pricingTier: 'pro', bought: true }, config.proRenewalPrice],
        ['a legacy paid row with no charge', { paymentStatus: 'paid', pricingTier: 'pro' }, config.renewalPrice],
        ['a legacy free_renewed row', { paymentStatus: 'free_renewed', pricingTier: 'pro' }, config.renewalPrice],
    ] satisfies Array<[string, RowOptions, number]>)('%s renews for its own price', async (_name, options, price) => {
        row(options);

        const { res, json } = await get();

        expect(res.status).toBe(200);
        expect(json.employerJob.renewalPrice).toBe(price);
    });

    it('a row loaded without its charges answers a logged 500, never the base price (review 2.28 M1)', async () => {
        row({ paymentStatus: 'paid', pricingTier: 'pro', withoutCharges: true });

        const { res, json } = await get();

        expect(res.status).toBe(500);
        expect(json).toEqual({ error: 'Failed to fetch job' });
        expect(logger.error).toHaveBeenCalledWith(
            'Error fetching job for edit',
            expect.objectContaining({ message: expect.stringMatching(/NEW_POST_CHARGE_SELECT/) }),
        );
    });

    it('answers whole dollars, the unit the edit page prints', async () => {
        row({ bought: true });

        const { json } = await get();

        expect(json.employerJob.renewalPrice).toBe(249);
        expect(Number.isInteger(json.employerJob.renewalPrice)).toBe(true);
    });
});

describe('the rest of the answer is unchanged', () => {
    it('keeps the job and the employerJob fields the edit form reads, and adds only the price', async () => {
        row({ bought: true });

        const { json } = await get();

        expect(json.job).toMatchObject({ id: 'job-1', title: 'Family Nurse Practitioner' });
        expect(json.employerJob).toEqual({
            id: 'ej-1',
            employerName: 'Clinic Co',
            contactEmail: 'owner@clinic.example',
            companyWebsite: 'https://clinic.example',
            companyLogoUrl: null,
            paymentStatus: 'paid',
            renewalPrice: config.proRenewalPrice,
        });
    });

    it('does not send the ledger rows it read to decide the price', async () => {
        row({ bought: true });

        const { json } = await get();

        expect(JSON.stringify(json)).not.toContain('jc-new');
        expect(json.employerJob).not.toHaveProperty('jobCharges');
    });

    it("loads the row's new charge with the post, and keeps the lookup by edit token", async () => {
        row();

        await get();

        expect(prisma.employerJob.findFirst).toHaveBeenCalledWith({
            where: { editToken: 'edit-1' },
            include: {
                job: { include: { screeningQuestions: { orderBy: { sortOrder: 'asc' } } } },
                ...NEW_POST_CHARGE_SELECT,
            },
        });
    });

    it('an unknown token is still a 401 with no price', async () => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(null as never);

        const { res, json } = await get('nope');

        expect(res.status).toBe(401);
        expect(json).toEqual({ error: 'Invalid or expired edit token' });
    });
});

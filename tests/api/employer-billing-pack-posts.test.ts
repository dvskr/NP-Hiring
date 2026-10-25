/**
 * Billing, invoice and receipt routes for a 5-post pack post (2027 re-price,
 * phase 2).
 *
 * A 'pack' row was published with a credit from a pack the employer bought
 * once; no payment was made for the post itself, so, like a promo post:
 *   - GET /api/employer/billing marks it as a no-charge row (the dashboard
 *     shows no invoice link for it);
 *   - GET /api/employer/invoice and GET /api/employer/receipt answer 400 with
 *     a reason that names the pack, never "payment was not completed", and
 *     never fall back to the legacy invoice amount.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

const getUserMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn().mockResolvedValue(null),
    RATE_LIMITS: { employer: { limit: 30, windowSeconds: 60 } },
}));
const generateInvoice = vi.hoisted(() => vi.fn());
vi.mock('@/lib/invoice-generator', () => ({ generateInvoice }));

const PACK_ROW = {
    id: 'ej-pack',
    jobId: 'job-pack',
    employerName: 'Clinic Co',
    contactEmail: 'hiring@clinic.example',
    paymentStatus: 'pack',
    pricingTier: 'pack',
    postPackId: 'pack-1',
    createdAt: new Date('2027-02-01T00:00:00.000Z'),
    job: { id: 'job-pack', title: 'Family Nurse Practitioner', isFeatured: false, createdAt: new Date('2027-02-01T00:00:00.000Z'), expiresAt: new Date('2027-04-02T00:00:00.000Z'), isPublished: true },
};

// Load the three route graphs once, outside any single test's time budget (a
// cold import under a loaded full run can outlast vitest's 5 second default).
beforeAll(async () => {
    await import('@/app/api/employer/billing/route');
    await import('@/app/api/employer/invoice/route');
    await import('@/app/api/employer/receipt/route');
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'hiring@clinic.example' } }, error: null });
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValue({ id: 'profile-1', role: 'employer' } as never);
});

describe('GET /api/employer/billing', () => {
    it("lists a 'pack' post as a no-charge row", async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([PACK_ROW] as never);
        vi.mocked(prisma.jobCharge.findMany).mockResolvedValue([] as never);

        const { GET } = await import('@/app/api/employer/billing/route');
        const res = await GET(new NextRequest('https://test.local/api/employer/billing'));
        const { payments } = await res.json();

        expect(res.status).toBe(200);
        expect(payments).toEqual([expect.objectContaining({ id: 'ej-pack', status: 'pack', isFree: true, tier: 'Pack', charges: [] })]);
    });
});

describe('GET /api/employer/invoice and /api/employer/receipt', () => {
    beforeEach(() => {
        vi.mocked(prisma.employerJob.findFirst).mockResolvedValue(PACK_ROW as never);
    });

    it('the invoice route answers 400 naming the pack, and generates nothing', async () => {
        const { GET } = await import('@/app/api/employer/invoice/route');
        const res = await GET(new NextRequest('https://test.local/api/employer/invoice?jobId=job-pack&token=dash-1'));
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(`${json.error} ${json.message}`).toMatch(/5-post pack/);
        expect(`${json.error} ${json.message}`).not.toMatch(/not completed|[–—]| - /);
        expect(prisma.jobCharge.findFirst).not.toHaveBeenCalled();
        expect(generateInvoice).not.toHaveBeenCalled();
    });

    it('the receipt route answers 400 naming the pack', async () => {
        const { GET } = await import('@/app/api/employer/receipt/route');
        const res = await GET(new NextRequest('https://test.local/api/employer/receipt?jobId=job-pack&token=dash-1'));
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(json.error).toMatch(/5-post pack/);
        expect(json.error).not.toMatch(/not completed|[–—]| - /);
        expect(prisma.jobCharge.findFirst).not.toHaveBeenCalled();
    });
});

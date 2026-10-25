/**
 * The employer dashboard page — the renewal price of each row (2027 re-price).
 *
 * The dashboard is a client component that has neither the ledger nor
 * lib/renewal-price.ts, and a renewal costs the base price or, for a post
 * bought at the posting price, the pro price. So the page decides it per row
 * and sends it down: it loads each row's 'new' charge with the post
 * (NEW_POST_CHARGE_SELECT), reads the rung (tests/lib/renewal-price.test.ts
 * pins the rule), and hands the client `renewalPrice`, in dollars, on every
 * row. The ownership clause and the rest of each row are unchanged
 * (tests/api/employer-ownership-routes.test.ts pins the clause).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { NEW_POST_CHARGE_SELECT } from '@/lib/pricing';
import EmployerDashboardClient from '@/components/employer/EmployerDashboardClient';
import EmployerDashboardPage from '@/app/employer/dashboard/page';

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/auth/protect', () => ({ requireEmployer: vi.fn(async () => undefined) }));
vi.mock('next/navigation', () => ({
    redirect: vi.fn((url: string) => {
        throw new Error(`NEXT_REDIRECT ${url}`);
    }),
}));
vi.mock('@/components/employer/EmployerDashboardClient', () => ({ default: () => null }));
vi.mock('@/components/employer/UnfinishedPostBanner', () => ({ default: () => null }));
vi.mock('@/components/BreadcrumbSchema', () => ({ default: () => null }));

const EMAIL = 'hiring@clinic.example';

interface RowOptions {
    id: string;
    paymentStatus: string;
    pricingTier: string;
    /** The row has a JobCharge of type 'new', as NEW_POST_CHARGE_SELECT loads it. */
    bought?: boolean;
    /** Leave jobCharges off the row, as a query without the select returns it. */
    withoutCharges?: boolean;
}

function record({ id, paymentStatus, pricingTier, bought = false, withoutCharges = false }: RowOptions) {
    return {
        id: `ej-${id}`,
        employerName: 'Clinic Co',
        editToken: `edit-${id}`,
        paymentStatus,
        pricingTier,
        ...(withoutCharges ? {} : { jobCharges: bought ? [{ id: `jc-${id}` }] : [] }),
        job: {
            id,
            title: `Role ${id}`,
            isPublished: true,
            isFeatured: true,
            viewCount: 4,
            applyClickCount: 1,
            createdAt: new Date('2026-10-01T00:00:00.000Z'),
            expiresAt: new Date('2026-12-01T00:00:00.000Z'),
            archivedAt: null,
            slug: `role-${id}`,
            _count: { jobApplications: 2 },
        },
    };
}

interface DashboardJob {
    id: string;
    renewalPrice: number;
    paymentStatus: string;
    pricingTier: string;
    editToken: string;
}

/** The `jobs` prop the page handed to the dashboard client. */
async function renderedJobs(): Promise<DashboardJob[]> {
    const page = (await EmployerDashboardPage()) as React.ReactElement<{ children: React.ReactNode }>;
    const client = React.Children.toArray(page.props.children).find(
        (child): child is React.ReactElement<{ jobs: DashboardJob[] }> =>
            React.isValidElement(child) && child.type === EmployerDashboardClient,
    );
    expect(client, 'the dashboard client is rendered').toBeDefined();
    return client!.props.jobs;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
        data: { user: { id: 'supabase-employer', email: EMAIL, email_confirmed_at: '2026-10-01T00:00:00Z' } },
        error: null,
    });
});

describe('each dashboard row carries the price it renews for', () => {
    it('is the pro price only for a post bought at the posting price, the base price for every other row', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([
            record({ id: 'promo', paymentStatus: 'promo', pricingTier: 'pro' }),
            record({ id: 'renewed-promo', paymentStatus: 'paid', pricingTier: 'pro' }),
            record({ id: 'intro', paymentStatus: 'paid', pricingTier: 'intro', bought: true }),
            record({ id: 'bought', paymentStatus: 'paid', pricingTier: 'pro', bought: true }),
            record({ id: 'legacy-renewed', paymentStatus: 'free_renewed', pricingTier: 'pro' }),
            record({ id: 'legacy-free', paymentStatus: 'free', pricingTier: 'pro' }),
        ] as never);

        const jobs = await renderedJobs();

        expect(Object.fromEntries(jobs.map((job) => [job.id, job.renewalPrice]))).toEqual({
            promo: config.renewalPrice,
            'renewed-promo': config.renewalPrice,
            intro: config.renewalPrice,
            bought: config.proRenewalPrice,
            'legacy-renewed': config.renewalPrice,
            'legacy-free': config.renewalPrice,
        });
    });

    it('is whole dollars, 199 and 249', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([
            record({ id: 'promo', paymentStatus: 'promo', pricingTier: 'pro' }),
            record({ id: 'bought', paymentStatus: 'paid', pricingTier: 'pro', bought: true }),
        ] as never);

        const jobs = await renderedJobs();

        expect(jobs.map((job) => job.renewalPrice)).toEqual([199, 249]);
    });

    it('a row loaded without its charges is priced at the base renewal', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([
            record({ id: 'bare', paymentStatus: 'paid', pricingTier: 'pro', withoutCharges: true }),
        ] as never);

        const [job] = await renderedJobs();

        expect(job.renewalPrice).toBe(config.renewalPrice);
    });

    it('keeps the fields the client already read, and sends no ledger rows', async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([
            record({ id: 'bought', paymentStatus: 'paid', pricingTier: 'pro', bought: true }),
        ] as never);

        const [job] = await renderedJobs();

        expect(job).toMatchObject({ id: 'bought', paymentStatus: 'paid', pricingTier: 'pro', editToken: 'edit-bought' });
        expect(job).not.toHaveProperty('jobCharges');
        expect(JSON.stringify(job)).not.toContain('jc-bought');
    });
});

describe('the query that finds the rung', () => {
    it("loads each row's new charge with the post, beside the ownership clause", async () => {
        vi.mocked(prisma.employerJob.findMany).mockResolvedValue([] as never);

        await renderedJobs();

        expect(prisma.employerJob.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.employerJob.findMany).toHaveBeenCalledWith({
            where: { OR: [{ userId: 'supabase-employer' }, { userId: null, contactEmail: EMAIL }] },
            include: {
                job: { include: { _count: { select: { jobApplications: true } } } },
                ...NEW_POST_CHARGE_SELECT,
            },
            orderBy: { createdAt: 'desc' },
        });
    });
});

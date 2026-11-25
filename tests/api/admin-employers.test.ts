/**
 * /api/admin/employers: one row per ORGANIZATION (the connected component of
 * employer accounts and posts sharing any identity key from
 * lib/admin/employer-org-keys.ts) with post, payment and ATS aggregates, plus
 * a per-account breakdown nested in each row.
 *
 * Pins the aggregation invariants that are easy to break silently:
 *  - the guard short-circuits before any database work, and access is
 *    audited with the admin's id only
 *  - two accounts on one business mail domain merge; free mail domains and
 *    shared company names never do
 *  - a stored free quotaDomain (or one with a trailing dot) never fuses
 *    unrelated account-less posts
 *  - an orphan post with a business domain folds into the account
 *    organization on that domain; one with no usable domain stands alone
 *  - employer accounts with no posts still get an organization
 *  - withdrawn applications never reach the live total
 *  - the active predicate matches lib/tier-limits.ts getEmployerActivePostings
 *  - every payment status lands in its own bucket, and nothing goes uncounted
 *  - hiringStatus precedence: hired outranks all_rejected
 *  - every organization is the exact sum of its accounts, and every summary
 *    field the exact sum over the returned rows
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const db = vi.hoisted(() => ({
    employerJob: { findMany: vi.fn() },
    userProfile: { findMany: vi.fn() },
    jobApplication: { groupBy: vi.fn() },
}));
const requireApiAdminActor = vi.hoisted(() => vi.fn());
const logAudit = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/auth/require-api-admin', () => ({ requireApiAdminActor }));
vi.mock('@/lib/audit-log', () => ({ logAudit }));
vi.mock('@/lib/logger', () => ({ logger }));

import { GET } from '@/app/api/admin/employers/route';
import { PAYMENT_BUCKETS } from '@/lib/admin/employer-overview-types';

const ADMIN = { profileId: 'admin-profile-1', supabaseId: 'admin-auth-1' };
const DAY_MS = 24 * 60 * 60 * 1000;
const past = () => new Date(Date.now() - DAY_MS);
const future = () => new Date(Date.now() + DAY_MS);

type JobShape = { isPublished: boolean; expiresAt: Date | null; viewCount: number; applyClickCount: number };

function employerJob(over: Partial<{
    userId: string | null; jobId: string; employerName: string; contactEmail: string; quotaDomain: string | null;
    paymentStatus: string; createdAt: Date; job: Partial<JobShape>;
}>) {
    return {
        userId: null,
        jobId: 'j-default',
        employerName: 'Employer',
        contactEmail: 'contact@example.com',
        quotaDomain: null,
        paymentStatus: 'paid',
        createdAt: new Date('2026-07-01T00:00:00Z'),
        ...over,
        job: { isPublished: true, expiresAt: null, viewCount: 0, applyClickCount: 0, ...(over.job ?? {}) },
    };
}

function profile(over: Partial<{ supabaseId: string; email: string; firstName: string | null; lastName: string | null; company: string | null; createdAt: Date }>) {
    return {
        supabaseId: 'u-x',
        email: 'user@example.com',
        firstName: null,
        lastName: null,
        company: null,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        ...over,
    };
}

/** Wire the two disjoint groupBy calls off a per-job fixture. */
function wireApplications(live: Array<{ jobId: string; status: string; n: number }>, withdrawn: Array<{ jobId: string; n: number }>) {
    db.jobApplication.groupBy.mockImplementation((args: { where: { withdrawnAt: unknown } }) =>
        Promise.resolve(
            args.where.withdrawnAt === null
                ? live.map(g => ({ jobId: g.jobId, status: g.status, _count: { _all: g.n } }))
                : withdrawn.map(g => ({ jobId: g.jobId, _count: { _all: g.n } })),
        ),
    );
}

function wireProfiles(employerRole: ReturnType<typeof profile>[], others: ReturnType<typeof profile>[]) {
    db.userProfile.findMany.mockImplementation((args: { where?: { role?: string } }) =>
        Promise.resolve(args.where?.role === 'employer' ? employerRole : others),
    );
}

function wirePosts(rows: ReturnType<typeof employerJob>[]) {
    db.employerJob.findMany.mockResolvedValue(rows);
}

async function callGet() {
    return GET(new Request('https://board.example/api/admin/employers', { method: 'GET' }) as never);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function overview(): Promise<{ summary: any; organizations: any[] }> {
    const res = await callGet();
    expect(res.status).toBe(200);
    return res.json();
}

function byId(organizations: any[]): Record<string, any> {
    return Object.fromEntries(organizations.map((org: any) => [org.id, org]));
}

const ids = (organizations: any[]): string[] => organizations.map((org: any) => org.id).sort();

beforeEach(() => {
    vi.clearAllMocks();
    requireApiAdminActor.mockResolvedValue({ error: null, actor: ADMIN });
    logAudit.mockResolvedValue(undefined);
    wirePosts([]);
    wireProfiles([], []);
    wireApplications([], []);
});

describe('GET /api/admin/employers: guard and audit', () => {
    it('returns the auth error without touching the database or the audit log', async () => {
        requireApiAdminActor.mockResolvedValue({ error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }), actor: null });
        const res = await callGet();
        expect(res.status).toBe(403);
        expect(db.employerJob.findMany).not.toHaveBeenCalled();
        expect(db.jobApplication.groupBy).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('audits the access with the admin id and nothing personal', async () => {
        await callGet();
        expect(logAudit).toHaveBeenCalledTimes(1);
        const entry = logAudit.mock.calls[0][0];
        expect(entry).toEqual({ action: 'admin.employers.list', actorType: 'admin', actorId: ADMIN.profileId });
        expect(JSON.stringify(entry)).not.toContain('@');
    });

    it('answers 500 with a plain message, and logs the error, when a query fails', async () => {
        const failure = new Error('connection reset');
        db.employerJob.findMany.mockRejectedValue(failure);
        const res = await callGet();
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ success: false, error: 'Failed to fetch employer data' });
        expect(logger.error).toHaveBeenCalledWith(expect.any(String), failure);
    });
});

describe('GET /api/admin/employers: aggregation', () => {
    beforeEach(() => {
        // j2 expired, j3 unpublished; j1, j4 and j5 live.
        wirePosts([
            employerJob({
                userId: 'u-a', jobId: 'j2', employerName: 'Acme Family Health', contactEmail: 'hr@acme.com', quotaDomain: 'acme.com',
                paymentStatus: 'pending', createdAt: new Date('2026-07-20T00:00:00Z'),
                job: { isPublished: true, expiresAt: past(), viewCount: 5, applyClickCount: 1 },
            }),
            employerJob({
                userId: 'u-c', jobId: 'j5', employerName: 'Drifted Role Co', contactEmail: 'ops@drift.com', quotaDomain: 'drift.com',
                paymentStatus: 'refunded', createdAt: new Date('2026-07-18T00:00:00Z'),
                job: { isPublished: true, expiresAt: null, viewCount: 2, applyClickCount: 0 },
            }),
            employerJob({
                userId: null, jobId: 'j4', employerName: 'Other Health', contactEmail: 'HR@Other.COM', quotaDomain: null,
                paymentStatus: 'promo', createdAt: new Date('2026-07-15T00:00:00Z'),
                job: { isPublished: true, expiresAt: future(), viewCount: 3, applyClickCount: 0 },
            }),
            employerJob({
                userId: null, jobId: 'j3', employerName: 'Legacy Clinic', contactEmail: 'jobs@legacy.org', quotaDomain: 'legacy.org',
                paymentStatus: 'free', createdAt: new Date('2026-07-10T00:00:00Z'),
                job: { isPublished: false, expiresAt: null, viewCount: 1, applyClickCount: 0 },
            }),
            employerJob({
                userId: 'u-a', jobId: 'j1', employerName: 'Acme Family Health', contactEmail: 'hr@acme.com', quotaDomain: 'acme.com',
                paymentStatus: 'paid', createdAt: new Date('2026-07-01T00:00:00Z'),
                job: { isPublished: true, expiresAt: null, viewCount: 10, applyClickCount: 2 },
            }),
        ]);
        wireProfiles(
            [
                profile({ supabaseId: 'u-a', email: 'hr@acme.com', company: 'Acme Family Health Group' }),
                profile({ supabaseId: 'u-b', email: 'never@posted-example.com', firstName: 'Never', lastName: 'Posted' }),
            ],
            [profile({ supabaseId: 'u-c', email: 'ops@drift.com', company: 'Drifted Role Co' })],
        );
        wireApplications(
            [
                { jobId: 'j1', status: 'applied', n: 3 },
                { jobId: 'j1', status: 'hired', n: 1 },
                { jobId: 'j2', status: 'rejected', n: 2 },
                { jobId: 'j4', status: 'applied', n: 1 },
                { jobId: 'j5', status: 'screening', n: 1 },
                // Marked withdrawn through the ATS, which does not stamp
                // withdrawnAt. It must not land in the live total.
                { jobId: 'j5', status: 'withdrawn', n: 1 },
            ],
            [{ jobId: 'j1', n: 2 }],
        );
    });

    it('folds posts, payments and applications onto the right organization', async () => {
        const body = await overview();
        const rows = byId(body.organizations);

        expect(rows['u-a'].name).toBe('Acme Family Health');
        expect(rows['u-a'].allNames).toEqual(['Acme Family Health', 'Acme Family Health Group']);
        expect(rows['u-a'].email).toBe('hr@acme.com');
        expect(rows['u-a'].posts).toMatchObject({ total: 2, active: 1, inactive: 1, paid: 1, pending: 1, free: 0, promo: 0, refunded: 0 });
        expect(rows['u-a'].applications).toEqual({ total: 6, applied: 3, screening: 0, interview: 0, offered: 0, hired: 1, rejected: 2, withdrawn: 2 });
        expect(rows['u-a'].hiringStatus).toBe('hired');
        expect(rows['u-a'].views).toBe(15);
        expect(rows['u-a'].applyClicks).toBe(3);
        expect(rows['u-a'].firstPostedAt).toBe('2026-07-01T00:00:00.000Z');
        expect(rows['u-a'].lastPostedAt).toBe('2026-07-20T00:00:00.000Z');
        expect(rows['u-a'].accounts).toHaveLength(1);
        expect(rows['u-a'].accounts[0]).toMatchObject({ id: 'u-a', hasAccount: true, name: 'Acme Family Health Group' });

        // Orphans anchored on their business domains, never merged.
        expect(rows['orphan:job:j3'].accounts).toEqual([expect.objectContaining({ id: 'no-account', hasAccount: false, accountCreatedAt: null })]);
        expect(rows['orphan:job:j3'].posts).toMatchObject({ active: 0, free: 1 });
        expect(rows['orphan:job:j3'].hiringStatus).toBe('no_applicants');
        expect(rows['orphan:job:j4'].posts).toMatchObject({ active: 1, promo: 1 });
        expect(rows['orphan:job:j4'].applications.applied).toBe(1);
        expect(rows['orphan:job:j4'].hiringStatus).toBe('untriaged');

        // Status 'withdrawn' without a withdrawnAt stamp stays out of the total.
        expect(rows['u-c'].applications.total).toBe(1);
        expect(rows['u-c'].applications.withdrawn).toBe(1);
        expect(rows['u-c'].hiringStatus).toBe('in_progress');
        // A refunded post is never claimed as paid; it has its own bucket.
        expect(rows['u-c'].posts).toMatchObject({ paid: 0, refunded: 1, total: 1 });
        // u-c posted while carrying a non employer role: shown in full, with
        // the recovered profile on its account.
        expect(rows['u-c'].accounts[0]).toMatchObject({ hasAccount: true, email: 'ops@drift.com' });

        // A signup that never posted still appears as its own organization.
        expect(rows['u-b'].posts.total).toBe(0);
        expect(rows['u-b'].hiringStatus).toBe('no_posts');
        expect(rows['u-b'].accounts[0].accountCreatedAt).not.toBeNull();
    });

    it('reports every organization as the exact sum of its account breakdown', async () => {
        const { organizations } = await overview();
        for (const org of organizations) {
            const sum = (pick: (a: any) => number) => org.accounts.reduce((running: number, account: any) => running + pick(account), 0);
            for (const field of ['total', 'active', 'inactive', ...PAYMENT_BUCKETS]) {
                expect(org.posts[field], `${org.id} posts.${field}`).toBe(sum(a => a.posts[field]));
            }
            for (const field of ['total', 'applied', 'hired', 'rejected', 'withdrawn']) {
                expect(org.applications[field], `${org.id} applications.${field}`).toBe(sum(a => a.applications[field]));
            }
        }
    });

    it('never issues a query per employer', async () => {
        await callGet();
        expect(db.employerJob.findMany).toHaveBeenCalledTimes(1);
        expect(db.jobApplication.groupBy).toHaveBeenCalledTimes(2);
        expect(db.userProfile.findMany.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('scopes application aggregates to employer posted jobs and splits withdrawn into a disjoint pass', async () => {
        await callGet();
        const calls = db.jobApplication.groupBy.mock.calls.map((c: any[]) => c[0]);
        const live = calls.find((c: any) => c.where.withdrawnAt === null);
        const gone = calls.find((c: any) => c.where.withdrawnAt !== null);
        expect(live.where.job).toEqual({ employerJobs: { isNot: null } });
        expect(gone.where.job).toEqual({ employerJobs: { isNot: null } });
        expect(gone.where.withdrawnAt).toEqual({ not: null });
    });

    it('reports every summary field as the exact sum over the returned rows', async () => {
        const { summary, organizations } = await overview();
        const sum = (pick: (org: any) => number) => organizations.reduce((a: number, org: any) => a + pick(org), 0);

        expect(summary.totalPosts).toBe(sum(org => org.posts.total));
        expect(summary.activePosts).toBe(sum(org => org.posts.active));
        expect(summary.activePosts + summary.inactivePosts).toBe(summary.totalPosts);
        expect(summary.paidPosts).toBe(sum(org => org.posts.paid));
        expect(summary.packPosts).toBe(sum(org => org.posts.pack));
        expect(summary.promoPosts).toBe(sum(org => org.posts.promo));
        expect(summary.freePosts).toBe(sum(org => org.posts.free));
        expect(summary.pendingCheckouts).toBe(sum(org => org.posts.pending));
        expect(summary.totalApplications).toBe(sum(org => org.applications.total));
        expect(summary.untriagedApplications).toBe(sum(org => org.applications.applied));
        expect(summary.employersWithUntriaged).toBe(organizations.filter((org: any) => org.applications.applied > 0).length);
        expect(summary.orphanPosters).toBe(organizations.filter((org: any) => !org.accounts.some((a: any) => a.hasAccount)).length);
        expect(summary.totalOrganizations).toBe(organizations.length);
        // The account numbers partition one population, even though u-c
        // posted while carrying a non employer role.
        expect(summary.accountsWithPosts + summary.accountsNeverPosted).toBe(summary.totalAccounts);

        // Concrete values, so a regression in one bucket cannot cancel out in another.
        expect(summary).toMatchObject({
            totalAccounts: 2, accountsWithPosts: 1, accountsNeverPosted: 1, orphanPosters: 2,
            totalPosts: 5, activePosts: 3, paidPosts: 1, promoPosts: 1, freePosts: 1, packPosts: 0, pendingCheckouts: 1,
            totalApplications: 8, untriagedApplications: 4, employersWithUntriaged: 2,
            totalOrganizations: 5, organizationsWithMultipleAccounts: 0,
        });
    });

    it('exposes no candidate identity', async () => {
        const raw = JSON.stringify(await overview());
        expect(raw).not.toContain('candidate');
        expect(raw).not.toContain('applicantName');
    });
});

describe('GET /api/admin/employers: payment buckets', () => {
    it('gives every payment status its own bucket and counts an unknown one as other', async () => {
        const statuses = ['paid', 'pack', 'promo', 'plan', 'free', 'free_renewed', 'free_upgraded', 'pending', 'expired', 'refunded', 'disputed', 'mystery'];
        wireProfiles([profile({ supabaseId: 'u-1', email: 'a@solo-example.com' })], []);
        wirePosts(statuses.map((paymentStatus, i) => employerJob({ userId: 'u-1', jobId: `p${i}`, paymentStatus })));
        const { organizations } = await overview();
        expect(organizations).toHaveLength(1);
        expect(organizations[0].posts).toEqual({
            total: 12, active: 12, inactive: 0,
            paid: 1, pack: 1, promo: 1, plan: 1, free: 3, pending: 1, expired: 1, refunded: 1, disputed: 1, other: 1,
        });
    });
});

describe('GET /api/admin/employers: organization grouping', () => {
    it('merges two accounts on one business mail domain into one organization', async () => {
        // One clinic, one mail domain, two accounts: one posted free during the
        // promo and received every application, the other paid for a post.
        wireProfiles(
            [
                profile({ supabaseId: 'u-free', email: 'frontdesk@example-clinic.com', company: 'Example Family Practice LLC', createdAt: new Date('2026-06-01T00:00:00Z') }),
                profile({ supabaseId: 'u-paid', email: 'md@example-clinic.com', company: 'Example Primary Care Associates', createdAt: new Date('2026-07-01T00:00:00Z') }),
            ],
            [],
        );
        wirePosts([
            employerJob({ userId: 'u-paid', jobId: 'jp', employerName: 'Example Primary Care', contactEmail: 'md@example-clinic.com', quotaDomain: 'example-clinic.com', paymentStatus: 'paid', createdAt: new Date('2026-07-10T00:00:00Z') }),
            employerJob({ userId: 'u-free', jobId: 'jf', employerName: 'Example Family Practice', contactEmail: 'frontdesk@example-clinic.com', quotaDomain: 'example-clinic.com', paymentStatus: 'promo', createdAt: new Date('2026-06-10T00:00:00Z') }),
        ]);
        wireApplications([{ jobId: 'jf', status: 'applied', n: 2 }, { jobId: 'jf', status: 'screening', n: 1 }], []);

        const { summary, organizations } = await overview();
        expect(organizations).toHaveLength(1);
        const org = organizations[0];
        expect(org.id).toBe('u-paid');
        expect(org.name).toBe('Example Primary Care');
        expect(org.allNames).toEqual(['Example Primary Care', 'Example Family Practice', 'Example Primary Care Associates', 'Example Family Practice LLC']);
        expect(org.posts).toMatchObject({ total: 2, active: 2, inactive: 0, paid: 1, promo: 1 });
        expect(org.applications).toMatchObject({ total: 3, applied: 2, screening: 1 });

        // The per-account story stays one click away, newest account first.
        expect(org.accounts.map((a: any) => a.id)).toEqual(['u-paid', 'u-free']);
        expect(org.accounts[0].posts.paid).toBe(1);
        expect(org.accounts[0].applications.total).toBe(0);
        expect(org.accounts[1].posts.promo).toBe(1);
        expect(org.accounts[1].applications.total).toBe(3);

        expect(summary).toMatchObject({ totalOrganizations: 1, organizationsWithMultipleAccounts: 1, accountsWithPosts: 2, employersWithUntriaged: 1 });
    });

    it('never merges free mail posters, including a stored free quotaDomain', async () => {
        wireProfiles(
            [
                profile({ supabaseId: 'g-1', email: 'x1@gmail.com', createdAt: new Date('2026-05-01T00:00:00Z') }),
                profile({ supabaseId: 'g-2', email: 'y2@gmail.com', createdAt: new Date('2026-05-02T00:00:00Z') }),
            ],
            [],
        );
        wirePosts([
            employerJob({ userId: 'g-1', jobId: 'pg1', quotaDomain: 'gmail.com', contactEmail: 'x1@gmail.com', createdAt: new Date('2026-07-01T00:00:00Z') }),
            employerJob({ userId: 'g-2', jobId: 'pg2', quotaDomain: 'gmail.com', contactEmail: 'y2@gmail.com', createdAt: new Date('2026-07-02T00:00:00Z') }),
            employerJob({ userId: null, jobId: 'o1', quotaDomain: 'gmail.com', contactEmail: 'one@gmail.com', createdAt: new Date('2026-07-03T00:00:00Z') }),
            employerJob({ userId: null, jobId: 'o2', quotaDomain: 'gmail.com', contactEmail: 'two@gmail.com', createdAt: new Date('2026-07-04T00:00:00Z') }),
        ]);

        const { summary, organizations } = await overview();
        expect(ids(organizations)).toEqual(['g-1', 'g-2', 'orphan:job:o1', 'orphan:job:o2']);
        expect(summary).toMatchObject({ totalOrganizations: 4, organizationsWithMultipleAccounts: 0, orphanPosters: 2 });
    });

    it('normalizes a trailing dot, so a dotted free domain fuses no one and a dotted business domain still joins', async () => {
        wirePosts([
            employerJob({ userId: null, jobId: 'k1', quotaDomain: 'gmail.com.', contactEmail: 'one@gmail.com.', createdAt: new Date('2026-07-02T00:00:00Z') }),
            employerJob({ userId: null, jobId: 'k2', quotaDomain: 'gmail.com.', contactEmail: 'two@gmail.com.', createdAt: new Date('2026-07-01T00:00:00Z') }),
            employerJob({ userId: null, jobId: 'k3', quotaDomain: 'acme-example.com.', contactEmail: 'a@acme-example.com', createdAt: new Date('2026-07-03T00:00:00Z') }),
            employerJob({ userId: null, jobId: 'k4', quotaDomain: 'acme-example.com', contactEmail: 'b@acme-example.com', createdAt: new Date('2026-07-04T00:00:00Z') }),
        ]);

        const { summary, organizations } = await overview();
        expect(ids(organizations)).toEqual(['orphan:job:k1', 'orphan:job:k2', 'orphan:job:k4']);
        expect(summary.totalOrganizations).toBe(3);
        expect(byId(organizations)['orphan:job:k4'].posts.total).toBe(2);
    });

    it('never bridges organizations on a shared company name', async () => {
        wireProfiles(
            [
                profile({ supabaseId: 'w-1', email: 'hello@alpha-example.com', company: 'Wellness', createdAt: new Date('2026-05-01T00:00:00Z') }),
                profile({ supabaseId: 'w-2', email: 'hi@beta-example.com', company: 'Wellness', createdAt: new Date('2026-05-02T00:00:00Z') }),
                profile({ supabaseId: 'm-1', email: 'a@gamma-example.com', company: 'Example Care Collective', createdAt: new Date('2026-05-01T00:00:00Z') }),
                profile({ supabaseId: 'm-2', email: 'b@delta-example.com', company: 'Example Care Collective', createdAt: new Date('2026-06-01T00:00:00Z') }),
            ],
            [],
        );
        const { summary, organizations } = await overview();
        expect(summary).toMatchObject({ totalOrganizations: 4, organizationsWithMultipleAccounts: 0 });
        expect(organizations.filter((org: any) => org.name === 'Wellness')).toHaveLength(2);
    });

    it('folds an orphan post with a business domain into the account organization on that domain', async () => {
        wireProfiles([profile({ supabaseId: 'u-1', email: 'hr@example-clinic.com', createdAt: new Date('2026-06-01T00:00:00Z') })], []);
        wirePosts([
            employerJob({ userId: 'u-1', jobId: 'ja', employerName: 'Example Clinic', contactEmail: 'hr@example-clinic.com', quotaDomain: 'example-clinic.com', createdAt: new Date('2026-06-15T00:00:00Z') }),
            // Legacy orphan carrying the same company domain in quotaDomain.
            employerJob({ userId: null, jobId: 'jb', employerName: 'Example Clinic Careers', contactEmail: 'jobs@example-clinic.com', quotaDomain: 'example-clinic.com', createdAt: new Date('2026-06-10T00:00:00Z') }),
            // Older orphan: no quotaDomain, only the contact email domain, case-normalized.
            employerJob({ userId: null, jobId: 'jc', employerName: 'Example Clinic', contactEmail: 'Jobs@Example-Clinic.com', quotaDomain: null, createdAt: new Date('2026-06-05T00:00:00Z') }),
        ]);

        const { summary, organizations } = await overview();
        expect(organizations).toHaveLength(1);
        const org = organizations[0];
        expect(org.id).toBe('u-1');
        expect(org.posts.total).toBe(3);
        expect(org.accounts.map((a: any) => a.id)).toEqual(['u-1', 'no-account']);
        expect(org.accounts[0].posts.total).toBe(1);
        expect(org.accounts[1]).toMatchObject({ hasAccount: false });
        expect(org.accounts[1].posts.total).toBe(2);
        expect(summary).toMatchObject({ orphanPosters: 0, totalOrganizations: 1 });
    });

    it('never joins an account to a stranger through the contact email typed on its post', async () => {
        // The contact email is unverified form input: a post by u-1 that names
        // another company's address must not pull that company in.
        wireProfiles(
            [
                profile({ supabaseId: 'u-1', email: 'hr@first-example.com', createdAt: new Date('2026-06-01T00:00:00Z') }),
                profile({ supabaseId: 'u-2', email: 'hr@second-example.com', createdAt: new Date('2026-06-02T00:00:00Z') }),
            ],
            [],
        );
        wirePosts([employerJob({ userId: 'u-1', jobId: 'jx', contactEmail: 'someone@second-example.com', quotaDomain: 'first-example.com' })]);
        const { organizations } = await overview();
        expect(ids(organizations)).toEqual(['u-1', 'u-2']);
    });

    it('keeps a zero-post employer account visible as its own organization', async () => {
        wireProfiles(
            [
                profile({ supabaseId: 'z-1', email: 'solo@zeta-example.com', company: 'Zeta Example Collective', createdAt: new Date('2026-06-01T00:00:00Z') }),
                profile({ supabaseId: 'u-2', email: 'hr@omega-example.com', createdAt: new Date('2026-06-02T00:00:00Z') }),
            ],
            [],
        );
        wirePosts([employerJob({ userId: 'u-2', jobId: 'jo', quotaDomain: 'omega-example.com', contactEmail: 'hr@omega-example.com' })]);

        const { summary, organizations } = await overview();
        expect(summary.totalOrganizations).toBe(2);
        const zeroPost = byId(organizations)['z-1'];
        expect(zeroPost).toMatchObject({ hiringStatus: 'no_posts', name: 'Zeta Example Collective' });
        expect(zeroPost.posts.total).toBe(0);
        expect(zeroPost.accounts).toHaveLength(1);
        expect(summary.accountsNeverPosted).toBe(1);
    });
});

describe('GET /api/admin/employers: orphan identity', () => {
    it('merges account-less posts sharing a business contact domain and keeps other domains apart', async () => {
        wirePosts([
            employerJob({ userId: null, jobId: 'j1', contactEmail: 'Jobs@Legacy.ORG', employerName: 'Legacy Clinic', createdAt: new Date('2026-07-05T00:00:00Z') }),
            employerJob({ userId: null, jobId: 'j2', contactEmail: ' jobs@legacy.org ', employerName: 'Legacy Clinic', createdAt: new Date('2026-07-04T00:00:00Z') }),
            employerJob({ userId: null, jobId: 'j3', contactEmail: 'hr@somewhere.com', employerName: 'Somewhere Health', createdAt: new Date('2026-07-03T00:00:00Z') }),
        ]);
        wireApplications([{ jobId: 'j1', status: 'applied', n: 2 }, { jobId: 'j3', status: 'hired', n: 1 }], []);

        const { summary, organizations } = await overview();
        expect(ids(organizations)).toEqual(['orphan:job:j1', 'orphan:job:j3']);
        expect(summary.orphanPosters).toBe(2);
        const legacy = byId(organizations)['orphan:job:j1'];
        expect(legacy.accounts).toEqual([expect.objectContaining({ id: 'no-account', hasAccount: false, accountCreatedAt: null })]);
        expect(legacy).toMatchObject({ name: 'Legacy Clinic' });
        expect(legacy.posts.total).toBe(2);
        expect(legacy.applications.applied).toBe(2);
        // Applications never bleed across organizations.
        expect(byId(organizations)['orphan:job:j3'].applications).toMatchObject({ total: 1, hired: 1 });
        expect(summary.totalApplications).toBe(3);
    });

    it('prefers the stored quotaDomain as the anchor and normalizes its case', async () => {
        wirePosts([
            employerJob({ userId: null, jobId: 'j1', contactEmail: 'a@elsewhere-one.com', quotaDomain: 'ACME.com', createdAt: new Date('2026-07-02T00:00:00Z') }),
            employerJob({ userId: null, jobId: 'j2', contactEmail: 'b@elsewhere-two.com', quotaDomain: 'acme.com', createdAt: new Date('2026-07-01T00:00:00Z') }),
        ]);
        const { organizations } = await overview();
        expect(organizations).toHaveLength(1);
        expect(organizations[0].id).toBe('orphan:job:j1');
        expect(organizations[0].posts.total).toBe(2);
    });

    it('lets a post with no usable domain at all stand alone', async () => {
        wirePosts([
            employerJob({ userId: null, jobId: 'n1', contactEmail: 'not-an-email', quotaDomain: null }),
            employerJob({ userId: null, jobId: 'n2', contactEmail: 'not-an-email', quotaDomain: null }),
        ]);
        const { organizations } = await overview();
        expect(ids(organizations)).toEqual(['orphan:job:n1', 'orphan:job:n2']);
    });
});

describe('GET /api/admin/employers: empty states', () => {
    it('returns a zeroed summary and no rows when nothing exists', async () => {
        const { summary, organizations } = await overview();
        expect(organizations).toEqual([]);
        expect(Object.values(summary).every(v => v === 0)).toBe(true);
        // No posts means no reason to aggregate applications at all.
        expect(db.jobApplication.groupBy).not.toHaveBeenCalled();
    });

    it('lists employer accounts that never posted as zeroed no_posts organizations', async () => {
        wireProfiles(
            [
                profile({ supabaseId: 'u-1', email: 'one@example-one.com', company: 'One Example Clinic' }),
                profile({ supabaseId: 'u-2', email: 'two@example-two.com', firstName: 'Two', lastName: 'Person' }),
            ],
            [],
        );
        const { summary, organizations } = await overview();
        expect(organizations).toHaveLength(2);
        expect(organizations.every((org: any) => org.hiringStatus === 'no_posts' && org.posts.total === 0 && org.applications.total === 0)).toBe(true);
        expect(summary).toMatchObject({ totalAccounts: 2, accountsNeverPosted: 2, accountsWithPosts: 0, orphanPosters: 0, totalOrganizations: 2 });
    });
});

/**
 * The route evaluates the active predicate in memory over rows it already
 * loaded, so it cannot literally share the Prisma clause with
 * lib/tier-limits.ts getEmployerActivePostings, the rule behind the
 * employer's own live count. Both halves are pinned here: if anyone changes
 * the canonical clause, this fails and names the admin route.
 */
describe('GET /api/admin/employers: active predicate parity with lib/tier-limits.ts', () => {
    it('still matches the canonical getEmployerActivePostings clause', async () => {
        const { getEmployerActivePostings } = await import('@/lib/tier-limits');
        await getEmployerActivePostings('u-1');
        const canonical = db.employerJob.findMany.mock.calls[0][0].where.job;
        expect(Object.keys(canonical).sort()).toEqual(['OR', 'isPublished']);
        expect(canonical.isPublished).toBe(true);
        expect(canonical.OR).toHaveLength(2);
        expect(canonical.OR[0]).toEqual({ expiresAt: null });
        expect(Object.keys(canonical.OR[1].expiresAt)).toEqual(['gt']);
        expect(canonical.OR[1].expiresAt.gt).toBeInstanceOf(Date);
    });

    it('classifies the same matrix the canonical clause would select', async () => {
        // A null expiresAt means never expires, not expired.
        wirePosts([
            employerJob({ userId: 'u-1', jobId: 'j0', job: { isPublished: true, expiresAt: null } }),
            employerJob({ userId: 'u-1', jobId: 'j1', job: { isPublished: true, expiresAt: future() } }),
            employerJob({ userId: 'u-1', jobId: 'j2', job: { isPublished: true, expiresAt: past() } }),
            employerJob({ userId: 'u-1', jobId: 'j3', job: { isPublished: false, expiresAt: null } }),
            employerJob({ userId: 'u-1', jobId: 'j4', job: { isPublished: false, expiresAt: future() } }),
        ]);
        wireProfiles([profile({ supabaseId: 'u-1', email: 'a@solo-example.com', company: 'Solo' })], []);

        const { summary, organizations } = await overview();
        expect(summary.activePosts).toBe(2);
        expect(summary.inactivePosts).toBe(3);
        expect(organizations[0].posts.active).toBe(2);
    });
});

describe('GET /api/admin/employers: hiringStatus precedence', () => {
    async function statusFor(live: Array<{ status: string; n: number }>): Promise<string> {
        wirePosts([employerJob({ userId: 'u-1', jobId: 'j1', paymentStatus: 'paid' })]);
        wireProfiles([profile({ supabaseId: 'u-1', email: 'a@solo-example.com', company: 'Solo' })], []);
        wireApplications(live.map(l => ({ jobId: 'j1', status: l.status, n: l.n })), []);
        const { organizations } = await overview();
        return organizations[0].hiringStatus;
    }

    it('lets a hire outrank rejections', async () => {
        expect(await statusFor([{ status: 'rejected', n: 4 }, { status: 'hired', n: 1 }])).toBe('hired');
    });

    it('reports all_rejected only when nothing is still open', async () => {
        expect(await statusFor([{ status: 'rejected', n: 3 }])).toBe('all_rejected');
        expect(await statusFor([{ status: 'rejected', n: 3 }, { status: 'applied', n: 1 }])).toBe('untriaged');
        expect(await statusFor([{ status: 'rejected', n: 3 }, { status: 'interview', n: 1 }])).toBe('in_progress');
    });

    it('reports untriaged when every applicant is still at applied', async () => {
        expect(await statusFor([{ status: 'applied', n: 9 }])).toBe('untriaged');
    });

    it('reports no_applicants when the only applications were withdrawn', async () => {
        wirePosts([employerJob({ userId: 'u-1', jobId: 'j1', paymentStatus: 'paid' })]);
        wireProfiles([profile({ supabaseId: 'u-1', email: 'a@solo-example.com', company: 'Solo' })], []);
        wireApplications([], [{ jobId: 'j1', n: 3 }]);
        const { organizations } = await overview();
        expect(organizations[0].applications).toMatchObject({ total: 0, withdrawn: 3 });
        expect(organizations[0].hiringStatus).toBe('no_applicants');
    });
});

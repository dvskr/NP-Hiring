/**
 * lib/admin/employer-overview-view.ts: what the admin employers page does
 * with the rows it fetched (search, filters, sorting), and the shared
 * helpers in lib/admin/employer-overview-types.ts the page and the route
 * both read.
 */
import { describe, expect, it } from 'vitest';
import {
    addPostCounts,
    deriveHiringStatus,
    emptyApplicationCounts,
    emptyPostCounts,
    paymentBucket,
    PAYMENT_BUCKETS,
    type AdminOrganizationAccount,
    type AdminOrganizationRow,
} from '@/lib/admin/employer-overview-types';
import {
    alsoPostsAs,
    filterOrganizations,
    newestAccountCreatedAt,
    nextSort,
    orgEmail,
    sortOrganizations,
} from '@/lib/admin/employer-overview-view';

function account(over: Partial<AdminOrganizationAccount>): AdminOrganizationAccount {
    return {
        id: 'acct',
        hasAccount: true,
        email: 'hr@example.com',
        name: 'Example Clinic',
        accountCreatedAt: '2026-06-01T00:00:00.000Z',
        posts: emptyPostCounts(),
        applications: emptyApplicationCounts(),
        ...over,
    };
}

function org(over: Partial<AdminOrganizationRow>): AdminOrganizationRow {
    return {
        id: 'org',
        name: 'Example Clinic',
        allNames: ['Example Clinic'],
        email: 'hr@example.com',
        posts: { ...emptyPostCounts(), total: 1, active: 1, paid: 1 },
        firstPostedAt: '2026-07-01T00:00:00.000Z',
        lastPostedAt: '2026-07-01T00:00:00.000Z',
        applications: emptyApplicationCounts(),
        hiringStatus: 'no_applicants',
        views: 0,
        applyClicks: 0,
        accounts: [account({})],
        ...over,
    };
}

const ALL = { search: '', status: 'all', account: 'all' } as const;

describe('filterOrganizations', () => {
    const untriagedButHired = org({
        id: 'a',
        name: 'Alpha Health',
        allNames: ['Alpha Health', 'Alpha Primary Care'],
        applications: { ...emptyApplicationCounts(), total: 3, applied: 2, hired: 1 },
        hiringStatus: 'hired',
    });
    const orphan = org({ id: 'b', name: 'Beta Clinic', email: '', accounts: [account({ id: 'no-account', hasAccount: false, email: 'jobs@beta.example' })] });
    const quiet = org({ id: 'c', name: 'Gamma Care', email: 'ops@gamma.example', hiringStatus: 'no_posts' });
    const rows = [untriagedButHired, orphan, quiet];

    it('holds every organization with an untriaged applicant, whatever its status says', () => {
        expect(filterOrganizations(rows, { ...ALL, status: 'has_untriaged' }).map((r) => r.id)).toEqual(['a']);
        // The status filter alone would miss it: it reads 'hired'.
        expect(filterOrganizations(rows, { ...ALL, status: 'untriaged' })).toEqual([]);
    });

    it('filters on hiring status', () => {
        expect(filterOrganizations(rows, { ...ALL, status: 'no_posts' }).map((r) => r.id)).toEqual(['c']);
    });

    it('filters on whether the organization has an account', () => {
        expect(filterOrganizations(rows, { ...ALL, account: 'without' }).map((r) => r.id)).toEqual(['b']);
        expect(filterOrganizations(rows, { ...ALL, account: 'with' }).map((r) => r.id)).toEqual(['a', 'c']);
    });

    it('searches the organization name, every name it posts under, and member emails', () => {
        expect(filterOrganizations(rows, { ...ALL, search: 'primary care' }).map((r) => r.id)).toEqual(['a']);
        expect(filterOrganizations(rows, { ...ALL, search: 'BETA.EXAMPLE' }).map((r) => r.id)).toEqual(['b']);
        expect(filterOrganizations(rows, { ...ALL, search: 'gamma' }).map((r) => r.id)).toEqual(['c']);
        expect(filterOrganizations(rows, { ...ALL, search: '   ' })).toHaveLength(3);
    });

    it('leaves the input as it was', () => {
        const input = [...rows];
        filterOrganizations(input, { ...ALL, status: 'has_untriaged' });
        expect(input).toEqual(rows);
    });
});

describe('sortOrganizations and nextSort', () => {
    const rows = [
        org({ id: 'x', name: 'beta', posts: { ...emptyPostCounts(), total: 1 }, lastPostedAt: null }),
        org({ id: 'y', name: 'Alpha', posts: { ...emptyPostCounts(), total: 5 }, lastPostedAt: '2026-08-01T00:00:00.000Z' }),
        org({ id: 'z', name: 'gamma', posts: { ...emptyPostCounts(), total: 3 }, lastPostedAt: '2026-07-01T00:00:00.000Z' }),
    ];

    it('sorts by a count, by date (never posted last when newest first) and by name, without touching the input', () => {
        expect(sortOrganizations(rows, 'posts', 'desc').map((r) => r.id)).toEqual(['y', 'z', 'x']);
        expect(sortOrganizations(rows, 'lastPosted', 'desc').map((r) => r.id)).toEqual(['y', 'z', 'x']);
        expect(sortOrganizations(rows, 'name', 'asc').map((r) => r.id)).toEqual(['y', 'x', 'z']);
        expect(rows.map((r) => r.id)).toEqual(['x', 'y', 'z']);
    });

    it('flips the direction on the same key and starts a new key on its natural order', () => {
        expect(nextSort({ key: 'posts', dir: 'desc' }, 'posts')).toEqual({ key: 'posts', dir: 'asc' });
        expect(nextSort({ key: 'posts', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
        expect(nextSort({ key: 'name', dir: 'asc' }, 'applications')).toEqual({ key: 'applications', dir: 'desc' });
    });
});

describe('organization derivations', () => {
    it('lists the other names an organization posts under, once each', () => {
        expect(alsoPostsAs(org({ name: 'Alpha', allNames: ['Alpha', 'alpha', 'Alpha Care', 'ALPHA CARE', ' '] }))).toEqual(['Alpha Care']);
    });

    it('picks an email from the newest account when the row has none', () => {
        const row = org({
            email: '',
            accounts: [
                account({ id: 'old', email: 'old@example.com', accountCreatedAt: '2026-01-01T00:00:00.000Z' }),
                account({ id: 'new', email: 'new@example.com', accountCreatedAt: '2026-05-01T00:00:00.000Z' }),
            ],
        });
        expect(orgEmail(row)).toBe('new@example.com');
        expect(newestAccountCreatedAt(row)).toBe('2026-05-01T00:00:00.000Z');
    });

    it('has no signup date for an organization without an account', () => {
        expect(newestAccountCreatedAt(org({ accounts: [account({ hasAccount: false, accountCreatedAt: null })] }))).toBeNull();
    });
});

describe('payment buckets and hiring status', () => {
    it('puts each stored status in its bucket, the legacy free ones together, anything else in other', () => {
        expect(paymentBucket('paid')).toBe('paid');
        expect(paymentBucket('pack')).toBe('pack');
        expect(paymentBucket('promo')).toBe('promo');
        expect(paymentBucket('free_renewed')).toBe('free');
        expect(paymentBucket('free_upgraded')).toBe('free');
        expect(paymentBucket('expired')).toBe('expired');
        expect(paymentBucket('something-new')).toBe('other');
        expect(paymentBucket('')).toBe('other');
    });

    it('adds post counts field by field into a new object', () => {
        const a = { ...emptyPostCounts(), total: 2, active: 1, inactive: 1, paid: 1, promo: 1 };
        const b = { ...emptyPostCounts(), total: 1, active: 1, pack: 1 };
        const sum = addPostCounts(a, b);
        expect(sum).toMatchObject({ total: 3, active: 2, inactive: 1, paid: 1, promo: 1, pack: 1 });
        expect(PAYMENT_BUCKETS.reduce((n, bucket) => n + sum[bucket], 0)).toBe(sum.total);
        expect(a.total).toBe(2);
    });

    it('ranks a hire above rejections and calls all-applied untriaged', () => {
        const apps = (over: Partial<ReturnType<typeof emptyApplicationCounts>>) => ({ ...emptyApplicationCounts(), ...over });
        const posts = { total: 1 };
        expect(deriveHiringStatus({ total: 0 }, apps({}))).toBe('no_posts');
        expect(deriveHiringStatus(posts, apps({}))).toBe('no_applicants');
        expect(deriveHiringStatus(posts, apps({ total: 5, rejected: 4, hired: 1 }))).toBe('hired');
        expect(deriveHiringStatus(posts, apps({ total: 3, rejected: 3 }))).toBe('all_rejected');
        expect(deriveHiringStatus(posts, apps({ total: 2, rejected: 1, interview: 1 }))).toBe('in_progress');
        expect(deriveHiringStatus(posts, apps({ total: 2, applied: 2 }))).toBe('untriaged');
    });
});

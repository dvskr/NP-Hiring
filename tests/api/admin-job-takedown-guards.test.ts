/**
 * app/api/admin/_lib/job-takedown.ts: which jobs an admin may hard delete or
 * publish. Pure: no route and no database.
 *
 * A hard delete cascades through employer_jobs and job_applications, so it
 * erased a paid post's payment status, the pricing record its company is
 * counted by, and every candidate's application to it. The bulk route
 * refused only legacy free posts, so a bulk call could delete a paid one.
 *
 * Pinned:
 *   - A hard delete is refused for every employer post except an unpaid one
 *     whose checkout can no longer be paid: 'expired' (the daily payment
 *     check retired it), or 'pending' untouched for longer than a delayed
 *     payment can take to arrive. It is refused for any job with
 *     applications. The refusal names the jobs and says which guard held.
 *   - A publish is refused for an archived post and for one whose payment
 *     status is not paid, free, promo, pack or plan.
 *   - The WHERE each write carries encodes the same rule as its pre-check,
 *     row for row, so the write cannot let through what the check refused.
 *
 * All fixtures are fictional.
 */
import { describe, it, expect } from 'vitest';
import {
    HARD_DELETE_APPLICATIONS_MESSAGE,
    HARD_DELETE_CHANGED_MESSAGE,
    HARD_DELETE_OPEN_CHECKOUT_MESSAGE,
    HARD_DELETE_PAID_MESSAGE,
    PUBLISHABLE_JOB_WHERE,
    PUBLISH_BLOCKED_MESSAGE,
    hardDeletableJobWhere,
    hardDeleteRefusal,
    isHardDeletableEmployerRow,
    isPublishBlocked,
} from '@/app/api/admin/_lib/job-takedown';
import { RENEWAL_SETTLEMENT_LOOKBACK_MS } from '@/lib/renewal-checkout-sessions';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-25T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const VISIBLE_DASH = /[–—]|\s-\s/;

interface FixtureJob {
    id: string;
    archivedAt: Date | null;
    employerJobs: { paymentStatus: string; updatedAt: Date } | null;
    _count: { jobApplications: number };
}

function job(id: string, overrides: Partial<Omit<FixtureJob, 'id'>> = {}): FixtureJob {
    return { id, archivedAt: null, employerJobs: null, _count: { jobApplications: 0 }, ...overrides };
}

const employer = (paymentStatus: string, updatedAt: Date = ago(DAY)) => ({ paymentStatus, updatedAt });

type Clause = Record<string, unknown>;

/**
 * Evaluates the WHERE clauses these guards build, and nothing else: a key or
 * an operator it does not know fails the test, so a clause it cannot read
 * never quietly matches.
 */
function matches(row: FixtureJob, where: Clause): boolean {
    return Object.entries(where).every(([key, cond]) => {
        if (key === 'OR') return (cond as Clause[]).some((clause) => matches(row, clause));
        if (key === 'archivedAt' && cond === null) return row.archivedAt === null;
        if (key === 'jobApplications') {
            expect(cond).toEqual({ none: {} });
            return row._count.jobApplications === 0;
        }
        if (key === 'employerJobs') return employerMatches(row.employerJobs, (cond as { is: unknown }).is);
        throw new Error(`the evaluator does not know the WHERE key ${key}`);
    });
}

function employerMatches(row: FixtureJob['employerJobs'], is: unknown): boolean {
    if (is === null) return row === null;
    if (row === null) return false;
    return Object.entries(is as Clause).every(([field, cond]) => {
        const stored = (row as Record<string, unknown>)[field];
        if (typeof cond === 'string') return stored === cond;
        const ops = cond as { in?: string[]; lte?: Date };
        if (ops.in) return ops.in.includes(stored as string);
        if (ops.lte) return (stored as Date).getTime() <= ops.lte.getTime();
        throw new Error(`the evaluator does not know the operator in ${JSON.stringify(cond)}`);
    });
}

const PAID_OR_GIVEN = ['paid', 'free', 'promo', 'pack', 'plan', 'refunded', 'disputed', 'free_renewed', 'something_new'];

describe('the hard delete guard', () => {
    it('lets an ingested or admin-created job with no applications go', () => {
        expect(hardDeleteRefusal([job('j1')], NOW)).toBeNull();
    });

    it.each(PAID_OR_GIVEN)("refuses an employer post whose status is '%s', as a paid posting", (status) => {
        const refusal = hardDeleteRefusal([job('j1', { employerJobs: employer(status) })], NOW);

        expect(refusal).toEqual({ jobIds: ['j1'], error: HARD_DELETE_PAID_MESSAGE });
    });

    it("lets an abandoned checkout the daily payment check marked 'expired' go", () => {
        expect(hardDeleteRefusal([job('j1', { employerJobs: employer('expired', ago(DAY)) })], NOW)).toBeNull();
    });

    it('refuses a pending checkout that can still be paid, as an open checkout, not as a paid posting', () => {
        const refusal = hardDeleteRefusal([job('j1', { employerJobs: employer('pending', ago(60 * 60 * 1000)) })], NOW);

        expect(refusal).toEqual({ jobIds: ['j1'], error: HARD_DELETE_OPEN_CHECKOUT_MESSAGE });
        expect(refusal?.error).toMatch(/can still be paid/);
    });

    it('keeps a pending checkout past the day a session can be paid, while a delayed payment can still arrive', () => {
        const pending = job('j1', { employerJobs: employer('pending', ago(3 * DAY)) });

        expect(hardDeleteRefusal([pending], NOW)?.error).toBe(HARD_DELETE_OPEN_CHECKOUT_MESSAGE);
    });

    it('lets a pending checkout go once no payment for it can arrive any more', () => {
        const stale = job('j1', { employerJobs: employer('pending', ago(RENEWAL_SETTLEMENT_LOOKBACK_MS + DAY)) });

        expect(isHardDeletableEmployerRow(stale.employerJobs!, NOW)).toBe(true);
        expect(hardDeleteRefusal([stale], NOW)).toBeNull();
    });

    it('refuses any job candidates applied to, an ingested one included', () => {
        const refusal = hardDeleteRefusal([job('j1'), job('j2', { _count: { jobApplications: 2 } })], NOW);

        expect(refusal).toEqual({ jobIds: ['j2'], error: HARD_DELETE_APPLICATIONS_MESSAGE });
    });

    it('names every employer post it holds back, and calls a mix of open checkouts and paid posts paid', () => {
        const refusal = hardDeleteRefusal([
            job('j1', { employerJobs: employer('pending', ago(60 * 1000)) }),
            job('j2', { employerJobs: employer('paid') }),
            job('j3'),
        ], NOW);

        expect(refusal).toEqual({ jobIds: ['j1', 'j2'], error: HARD_DELETE_PAID_MESSAGE });
    });

    it('checks the employer rule before the applications rule', () => {
        const refusal = hardDeleteRefusal([job('j1', { employerJobs: employer('paid'), _count: { jobApplications: 1 } })], NOW);

        expect(refusal?.error).toBe(HARD_DELETE_PAID_MESSAGE);
    });
});

describe('the WHERE of the delete encodes the same rule as the check', () => {
    const ROWS: Array<[string, FixtureJob]> = [
        ['an ingested job', job('j')],
        ['an ingested job with applications', job('j', { _count: { jobApplications: 1 } })],
        ['an expired checkout', job('j', { employerJobs: employer('expired') })],
        ['an expired checkout with applications', job('j', { employerJobs: employer('expired'), _count: { jobApplications: 1 } })],
        ['a checkout opened an hour ago', job('j', { employerJobs: employer('pending', ago(60 * 60 * 1000)) })],
        ['a checkout opened a week ago', job('j', { employerJobs: employer('pending', ago(7 * DAY)) })],
        ['a checkout no payment can reach', job('j', { employerJobs: employer('pending', ago(RENEWAL_SETTLEMENT_LOOKBACK_MS + 1)) })],
        ...PAID_OR_GIVEN.map((status): [string, FixtureJob] => [`a '${status}' post`, job('j', { employerJobs: employer(status) })]),
    ];

    it.each(ROWS)('%s', (_label, row) => {
        expect(matches(row, hardDeletableJobWhere(NOW))).toBe(hardDeleteRefusal([row], NOW) === null);
    });
});

describe('the publish guard', () => {
    it.each(['paid', 'free', 'promo', 'pack', 'plan'])("publishes a '%s' post", (status) => {
        expect(isPublishBlocked({ archivedAt: null, employerJobs: { paymentStatus: status } })).toBe(false);
    });

    it('publishes an ingested or admin-created job, which has no employer row', () => {
        expect(isPublishBlocked({ archivedAt: null, employerJobs: null })).toBe(false);
    });

    it.each(['pending', 'expired', 'refunded', 'disputed', 'something_new'])("refuses a '%s' post", (status) => {
        expect(isPublishBlocked({ archivedAt: null, employerJobs: { paymentStatus: status } })).toBe(true);
    });

    it('refuses an archived post whatever it paid', () => {
        expect(isPublishBlocked({ archivedAt: ago(DAY), employerJobs: { paymentStatus: 'paid' } })).toBe(true);
        expect(isPublishBlocked({ archivedAt: ago(DAY), employerJobs: null })).toBe(true);
    });

    it.each([
        ['no employer row', job('j')],
        ['archived', job('j', { archivedAt: ago(DAY) })],
        ...['paid', 'free', 'promo', 'pack', 'plan', 'pending', 'expired', 'refunded', 'disputed'].map(
            (status): [string, FixtureJob] => [`'${status}'`, job('j', { employerJobs: employer(status) })],
        ),
    ])('the WHERE of the publish agrees with the check: %s', (_label, row) => {
        expect(matches(row, PUBLISHABLE_JOB_WHERE)).toBe(!isPublishBlocked(row));
    });
});

describe('what the admin is told', () => {
    it('the open checkout refusal states the window the guard applies', () => {
        expect(HARD_DELETE_OPEN_CHECKOUT_MESSAGE).toContain(`${RENEWAL_SETTLEMENT_LOOKBACK_MS / DAY} days`);
    });

    it.each([
        HARD_DELETE_PAID_MESSAGE,
        HARD_DELETE_OPEN_CHECKOUT_MESSAGE,
        HARD_DELETE_APPLICATIONS_MESSAGE,
        HARD_DELETE_CHANGED_MESSAGE,
        PUBLISH_BLOCKED_MESSAGE,
    ])('%s follows the house style', (message) => {
        expect(message).not.toMatch(VISIBLE_DASH);
        expect(message).not.toMatch(/PMHNP/);
    });
});

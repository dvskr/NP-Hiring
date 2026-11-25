import type { Prisma } from '@prisma/client';
import { RENEWAL_SETTLEMENT_LOOKBACK_MS } from '@/lib/renewal-checkout-sessions';

/**
 * The guards on an admin hard delete and an admin publish, shared by the
 * single and bulk job routes (app/api/admin/jobs/[id]/route.ts and
 * app/api/admin/jobs/bulk/route.ts).
 *
 * An admin unpublish or soft delete is a takedown (lib/admin/job-hold.ts),
 * which an admin can undo. A hard delete cannot be undone, and it cascades:
 * deleting a job deletes its EmployerJob row (the payment status, and the
 * link a refund or a dispute is matched to; the JobCharge ledger row is left
 * orphaned) and every candidate's application to it. The pricing rules count
 * EmployerJob rows too: removing a 'paid' row gives the company the
 * introductory price again. So a hard delete is refused for every employer
 * post except an unpaid one whose checkout can no longer be paid, and for
 * any job with applications.
 *
 * Each rule is checked twice: on the rows the route loaded, to tell the
 * admin which guard held the change back, and again in the WHERE of the
 * write itself, so a payment or an application landing in between cannot be
 * overtaken.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long an unpaid posting's checkout can still bring a payment in. A
 * Checkout session stays payable for a day, and a delayed payment (ACH and
 * similar) can settle weeks after its session completed, which is why the
 * daily payment check (lib/inngest/functions/payment-reconciliation.ts)
 * leaves such a row 'pending' rather than marking it 'expired'. The renewals
 * use the same bound (lib/renewal-checkout-sessions.ts).
 */
const UNPAID_CHECKOUT_PAYABLE_MS = RENEWAL_SETTLEMENT_LOOKBACK_MS;
const UNPAID_CHECKOUT_PAYABLE_DAYS = Math.round(UNPAID_CHECKOUT_PAYABLE_MS / DAY_MS);

/**
 * Payment states a posting may be made live from by an admin: paid, a legacy
 * free post, a launch promo post, a 5-post pack post, and a legacy plan post.
 */
export const PUBLISHABLE_PAYMENT_STATUSES: readonly string[] = ['paid', 'free', 'promo', 'pack', 'plan'];

export const HARD_DELETE_PAID_MESSAGE =
    'Cannot hard-delete an employer posting: the delete would erase its payment status and the candidates\' applications, and the pricing rules that count the company\'s earlier posts would no longer see it. Unpublish it instead.';

export const HARD_DELETE_OPEN_CHECKOUT_MESSAGE =
    `Cannot hard-delete this posting yet: its checkout can still be paid, and a payment that arrives for a deleted posting can only be refunded by hand. Unpublish it now. It can be hard-deleted once the daily payment check marks its checkout expired, or ${UNPAID_CHECKOUT_PAYABLE_DAYS} days after its checkout was last opened.`;

export const HARD_DELETE_APPLICATIONS_MESSAGE =
    'Cannot hard-delete a job that has applications: the delete would remove them from the candidates\' application lists. Unpublish it instead.';

export const HARD_DELETE_CHANGED_MESSAGE =
    'Nothing was deleted: the posting changed while it was being deleted, by a payment, a checkout or an application. Reload the list and try again.';

export const PUBLISH_BLOCKED_MESSAGE =
    'Cannot publish this posting: it is archived, or it has no completed payment on record (its checkout was never paid, or the payment was refunded or disputed). Restore an archived posting from the archive first.';

/** The employer row of a job, with the columns the hard delete guard reads. */
export interface GuardedEmployerRow {
    paymentStatus: string;
    updatedAt: Date;
}

/** A job as the routes load it for the hard delete guard (HARD_DELETE_GUARD_SELECT). */
export interface HardDeleteCandidate {
    id: string;
    employerJobs: GuardedEmployerRow | null;
    _count: { jobApplications: number };
}

/** The columns the hard delete guard reads, for a route's own select. */
export const HARD_DELETE_GUARD_SELECT = {
    employerJobs: { select: { paymentStatus: true, updatedAt: true } },
    _count: { select: { jobApplications: true } },
} satisfies Prisma.JobSelect;

export interface HardDeleteRefusal {
    jobIds: string[];
    error: string;
}

/**
 * Whether an employer row may go with its job: an abandoned checkout the
 * daily payment check marked 'expired', or a 'pending' one last touched
 * longer ago than a payment can still arrive. Every other status is a post
 * the employer paid for or was given.
 */
export function isHardDeletableEmployerRow(row: GuardedEmployerRow, now: Date): boolean {
    if (row.paymentStatus === 'expired') return true;
    return row.paymentStatus === 'pending' && row.updatedAt.getTime() <= now.getTime() - UNPAID_CHECKOUT_PAYABLE_MS;
}

/**
 * Why these jobs may not be hard deleted, or null when every one may. The
 * employer rule is checked first, and its refusal says whether it held back
 * a checkout that can still be paid or a posting that was paid for.
 */
export function hardDeleteRefusal(jobs: readonly HardDeleteCandidate[], now: Date): HardDeleteRefusal | null {
    const employerBlocked = jobs.filter((job) => job.employerJobs && !isHardDeletableEmployerRow(job.employerJobs, now));
    if (employerBlocked.length > 0) {
        const onlyOpenCheckouts = employerBlocked.every((job) => job.employerJobs?.paymentStatus === 'pending');
        return {
            jobIds: employerBlocked.map((job) => job.id),
            error: onlyOpenCheckouts ? HARD_DELETE_OPEN_CHECKOUT_MESSAGE : HARD_DELETE_PAID_MESSAGE,
        };
    }
    const withApplications = jobs.filter((job) => job._count.jobApplications > 0);
    if (withApplications.length > 0) {
        return { jobIds: withApplications.map((job) => job.id), error: HARD_DELETE_APPLICATIONS_MESSAGE };
    }
    return null;
}

/** The hard delete rule, for the WHERE of the delete itself. */
export function hardDeletableJobWhere(now: Date): Prisma.JobWhereInput {
    const payableSince = new Date(now.getTime() - UNPAID_CHECKOUT_PAYABLE_MS);
    return {
        OR: [
            { employerJobs: { is: null } },
            { employerJobs: { is: { paymentStatus: 'expired' } } },
            { employerJobs: { is: { paymentStatus: 'pending', updatedAt: { lte: payableSince } } } },
        ],
        jobApplications: { none: {} },
    };
}

/** A job as the routes load it for the publish guard. */
export interface PublishCandidate {
    archivedAt?: Date | null;
    employerJobs?: { paymentStatus: string } | null;
}

/** True when a posting in this state may not be made live by an admin: archived, or not paid for. */
export function isPublishBlocked(job: PublishCandidate): boolean {
    if (job.archivedAt) return true;
    return !!job.employerJobs && !PUBLISHABLE_PAYMENT_STATUSES.includes(job.employerJobs.paymentStatus);
}

/**
 * The publish rule, for the WHERE of the publish itself. Spread it into a
 * WHERE that has no OR of its own. Typed by its own shape (satisfies, not an
 * annotation) so it also spreads into the WHERE of a single-row update.
 */
export const PUBLISHABLE_JOB_WHERE = {
    archivedAt: null,
    OR: [
        { employerJobs: { is: null } },
        { employerJobs: { is: { paymentStatus: { in: [...PUBLISHABLE_PAYMENT_STATUSES] } } } },
    ],
} satisfies Prisma.JobWhereInput;

/** Prisma's "no row matched" for an update with a WHERE condition. */
export function isRecordNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025';
}

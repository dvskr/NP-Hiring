/**
 * Pure rules behind the job rows of the employer dashboard
 * (components/employer/EmployerDashboardClient.tsx), kept out of the
 * component so they are tested without rendering it. No imports: the
 * dashboard is a client bundle.
 */

/** The fields of a dashboard job row these rules read. */
export interface DashboardJobRow {
    readonly paymentStatus: string;
    readonly archivedAt: string | null;
    readonly isPublished: boolean;
}

/**
 * paymentStatus values that never renew: a plan post runs its days and then
 * frees its slot, a pending row was never paid, and a refunded row has
 * nothing left to renew.
 */
const NON_RENEWABLE_STATUSES: ReadonlySet<string> = new Set(['plan', 'pending', 'refunded']);

/** Where the row's posting window stands, as the dashboard reads it. */
export interface RenewTiming {
    readonly expired: boolean;
    readonly expiringSoon: boolean;
}

/**
 * Whether the row offers Renew: a renewable post that has ended or ends soon,
 * and is not archived. An archived post is off the board by its employer's
 * choice, so a renewal would buy days for a post nobody can see; the
 * employer restores it first.
 */
export function shouldOfferRenew(job: Pick<DashboardJobRow, 'paymentStatus' | 'archivedAt'>, timing: RenewTiming): boolean {
    if (job.archivedAt) return false;
    if (NON_RENEWABLE_STATUSES.has(job.paymentStatus)) return false;
    return timing.expired || timing.expiringSoon;
}

/**
 * The archive route's body: the state the employer chose on this row, never
 * a bare toggle, so a stale tab that still shows a post live cannot restore
 * it by archiving it again.
 */
export function archiveRequestBody(job: Pick<DashboardJobRow, 'archivedAt'>): { archived: boolean } {
    return { archived: !job.archivedAt };
}

/** The archive route's success answer, as far as a row reads it. */
export interface ArchiveRouteResult {
    readonly archivedAt?: string | null;
    readonly isPublished?: boolean;
}

/**
 * The row once the archive route answered: the state the server stored,
 * which differs from this tab's guess when another tab changed the post
 * first. An answer without isPublished keeps the reading the dashboard used
 * before the route reported it: archiving unpublishes, restoring leaves the
 * row as it was.
 */
export function applyArchiveResult<T extends Pick<DashboardJobRow, 'archivedAt' | 'isPublished'>>(
    job: T,
    result: ArchiveRouteResult,
): T {
    const archivedAt = result.archivedAt ?? null;
    const isPublished = typeof result.isPublished === 'boolean'
        ? result.isPublished
        : archivedAt === null && job.isPublished;
    return { ...job, archivedAt, isPublished };
}

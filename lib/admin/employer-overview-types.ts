/**
 * Shared types and pure helpers for the admin employers table, grouped by
 * ORGANIZATION.
 *
 * Producer: app/api/admin/employers/route.ts (GET), through
 *           lib/admin/employer-organizations.ts
 * Consumer: app/admin/employers/page.tsx
 *
 * This module imports nothing, so the client page can import from it without
 * pulling a server module into its bundle; the route and the page read one
 * contract and cannot drift apart silently.
 *
 * An ORGANIZATION is the connected component of employer accounts and posts
 * that share ANY identity key from lib/admin/employer-org-keys.ts:
 * acct:<account id>, or dom:<business mail domain>. Two accounts on one
 * company mail domain are one row here, with the per-account breakdown
 * nested under it.
 *
 * Nothing in this file is a metric or a measurement. Every number in the
 * response is computed live from the database on each request.
 */

/**
 * Application statuses the employer ATS moves a candidate through
 * (JobApplication.status in prisma/schema.prisma). 'withdrawn' is NOT here: a
 * withdrawal is a candidate action, reported separately and never counted
 * toward a live applicant total.
 */
export const TRACKED_APPLICATION_STATUSES = [
    'applied',
    'screening',
    'interview',
    'offered',
    'hired',
    'rejected',
] as const;

export type TrackedApplicationStatus = (typeof TRACKED_APPLICATION_STATUSES)[number];

export function isTrackedStatus(status: string): status is TrackedApplicationStatus {
    return (TRACKED_APPLICATION_STATUSES as readonly string[]).includes(status);
}

/**
 * The payment breakdown, one bucket per EmployerJob.paymentStatus the board
 * writes (lib/config.ts):
 *   paid      bought through Stripe Checkout, or renewed
 *   free      the legacy free tier: 'free', 'free_renewed', 'free_upgraded'
 *   pending   a checkout started and never completed; not paid
 *   refunded  refunded through Stripe
 *   pack      published from a bought 5-post pack credit
 *   promo     free during the launch promo
 *   plan      the retired Employer plan
 *   expired   a pending checkout the reconciliation sweep closed
 *   disputed  a card dispute is open
 *   other     any value not listed above, so nothing is ever uncounted
 */
export const PAYMENT_BUCKETS = [
    'paid',
    'free',
    'pending',
    'refunded',
    'pack',
    'promo',
    'plan',
    'expired',
    'disputed',
    'other',
] as const;

export type PaymentBucket = (typeof PAYMENT_BUCKETS)[number];

const LEGACY_FREE_STATUSES: ReadonlySet<string> = new Set(['free', 'free_renewed', 'free_upgraded']);

/** The bucket a stored paymentStatus counts in. */
export function paymentBucket(paymentStatus: string): PaymentBucket {
    if (LEGACY_FREE_STATUSES.has(paymentStatus)) return 'free';
    const known = (PAYMENT_BUCKETS as readonly string[]).includes(paymentStatus) && paymentStatus !== 'other';
    return known ? (paymentStatus as PaymentBucket) : 'other';
}

/**
 * Where an organization stands on the candidates it has received.
 *
 * 'untriaged' is the load bearing one: applicants exist and every single one
 * is still sitting at 'applied', meaning nobody has opened the pipeline.
 */
export type EmployerHiringStatus =
    | 'no_posts'
    | 'no_applicants'
    | 'untriaged'
    | 'in_progress'
    | 'all_rejected'
    | 'hired';

export type EmployerPostCounts = {
    readonly total: number;
    /**
     * Live right now: isPublished and not expired, the rule behind the
     * employer's own live count (lib/tier-limits.ts getEmployerActivePostings).
     */
    readonly active: number;
    readonly inactive: number;
} & Readonly<Record<PaymentBucket, number>>;

export interface EmployerApplicationCounts {
    /** Excludes withdrawn applications. */
    readonly total: number;
    readonly applied: number;
    readonly screening: number;
    readonly interview: number;
    readonly offered: number;
    readonly hired: number;
    readonly rejected: number;
    /** Reported for context, never included in `total`. */
    readonly withdrawn: number;
}

/**
 * One member of an organization: a real employer account, or the single
 * account-less segment that carries the organization's legacy orphan posts.
 */
export interface AdminOrganizationAccount {
    /**
     * For a real account, the Supabase auth id (UserProfile.supabaseId),
     * because EmployerJob.userId references supabaseId. It is NOT the
     * UserProfile id that /api/admin/users calls `id`. For the account-less
     * segment it is the literal 'no-account', unique only within its
     * organization.
     */
    readonly id: string;
    /** False only for the account-less poster segment. */
    readonly hasAccount: boolean;
    readonly email: string;
    /** Account identity first: company, then the most recent post's name. */
    readonly name: string;
    readonly accountCreatedAt: string | null;
    readonly posts: EmployerPostCounts;
    readonly applications: EmployerApplicationCounts;
}

export interface AdminOrganizationRow {
    /**
     * Opaque and unique per row: the newest member account's Supabase auth id
     * when the organization has any account, else 'orphan:job:<jobId of the
     * most recent post>'. Never a UserProfile id.
     */
    readonly id: string;
    /**
     * The name it most recently posted under, else the newest account's
     * company, then contact name, then email.
     */
    readonly name: string;
    /**
     * Every distinct post employerName and account company in the
     * organization, deduped case insensitively, post names newest first.
     */
    readonly allNames: readonly string[];
    /** Representative contact email: newest account, else the most recent post. */
    readonly email: string;
    /** Exact sum over `accounts`, so the row never disagrees with its breakdown. */
    readonly posts: EmployerPostCounts;
    readonly firstPostedAt: string | null;
    readonly lastPostedAt: string | null;
    /** Exact sum over `accounts`. Withdrawn stays out of `total`. */
    readonly applications: EmployerApplicationCounts;
    readonly hiringStatus: EmployerHiringStatus;
    /** Sum of Job.viewCount across every post in the organization. */
    readonly views: number;
    /** Sum of Job.applyClickCount. Zero for jobs that take applications on the board. */
    readonly applyClicks: number;
    /** Real accounts newest first, then the account-less segment last. */
    readonly accounts: readonly AdminOrganizationAccount[];
}

export interface AdminEmployerSummary {
    /** UserProfile rows with role 'employer'. */
    readonly totalAccounts: number;
    /** Employer-role accounts with at least one post. Partitions totalAccounts with the next field. */
    readonly accountsWithPosts: number;
    readonly accountsNeverPosted: number;
    /** Organizations that have posts but no linked account at all. */
    readonly orphanPosters: number;
    readonly totalPosts: number;
    readonly activePosts: number;
    readonly inactivePosts: number;
    readonly paidPosts: number;
    readonly packPosts: number;
    readonly promoPosts: number;
    readonly freePosts: number;
    /** Checkouts started and never completed. These are not paid posts. */
    readonly pendingCheckouts: number;
    /** Excludes withdrawn applications. */
    readonly totalApplications: number;
    /** Applications still sitting at 'applied'. */
    readonly untriagedApplications: number;
    /**
     * Organizations sitting on at least one untriaged applicant. Counted per
     * organization so the stat tile and the table's 'has_untriaged' filter
     * always describe the same rows.
     */
    readonly employersWithUntriaged: number;
    /** One per connected component of shared identity keys. */
    readonly totalOrganizations: number;
    /** Organizations where two or more real accounts share one identity. */
    readonly organizationsWithMultipleAccounts: number;
}

export interface AdminEmployersResponse {
    readonly success: true;
    readonly summary: AdminEmployerSummary;
    readonly organizations: readonly AdminOrganizationRow[];
}

/* ─── Counting primitives (pure, immutable) ─── */

export function emptyPostCounts(): EmployerPostCounts {
    return {
        total: 0,
        active: 0,
        inactive: 0,
        paid: 0,
        free: 0,
        pending: 0,
        refunded: 0,
        pack: 0,
        promo: 0,
        plan: 0,
        expired: 0,
        disputed: 0,
        other: 0,
    };
}

export function emptyApplicationCounts(): EmployerApplicationCounts {
    return { total: 0, applied: 0, screening: 0, interview: 0, offered: 0, hired: 0, rejected: 0, withdrawn: 0 };
}

/** A new object holding the field-by-field sum of two post counts. */
export function addPostCounts(a: EmployerPostCounts, b: EmployerPostCounts): EmployerPostCounts {
    const buckets = Object.fromEntries(PAYMENT_BUCKETS.map((bucket) => [bucket, a[bucket] + b[bucket]])) as Record<PaymentBucket, number>;
    return { ...buckets, total: a.total + b.total, active: a.active + b.active, inactive: a.inactive + b.inactive };
}

/** A new object holding the field-by-field sum of two application counts. */
export function addApplicationCounts(a: EmployerApplicationCounts, b: EmployerApplicationCounts): EmployerApplicationCounts {
    return {
        total: a.total + b.total,
        applied: a.applied + b.applied,
        screening: a.screening + b.screening,
        interview: a.interview + b.interview,
        offered: a.offered + b.offered,
        hired: a.hired + b.hired,
        rejected: a.rejected + b.rejected,
        withdrawn: a.withdrawn + b.withdrawn,
    };
}

/**
 * Precedence is fixed and order sensitive: a hire outranks rejections, and an
 * organization only reads as 'untriaged' once every applicant is still at
 * 'applied'. Shared by the route (organizations) and the page (accounts).
 */
export function deriveHiringStatus(
    posts: Pick<EmployerPostCounts, 'total'>,
    apps: EmployerApplicationCounts,
): EmployerHiringStatus {
    if (posts.total === 0) return 'no_posts';
    if (apps.total === 0) return 'no_applicants';
    if (apps.hired > 0) return 'hired';

    const inFlight = apps.screening + apps.interview + apps.offered;
    if (apps.rejected > 0 && apps.applied === 0 && inFlight === 0) return 'all_rejected';
    if (inFlight > 0) return 'in_progress';

    return 'untriaged';
}

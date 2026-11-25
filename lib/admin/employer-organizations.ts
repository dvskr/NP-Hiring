/**
 * Organization grouping and folding for the admin employers view.
 *
 * Pure in-memory logic, no I/O: app/api/admin/employers/route.ts loads the
 * rows and this module turns them into AdminOrganizationRow aggregates.
 *
 * An organization is the connected component (union-find) of employer
 * accounts and posts that share ANY identity key from
 * lib/admin/employer-org-keys.ts: acct:<account id>, or dom:<business mail
 * domain>, where a free mail domain never gives a key. The Verify Employers
 * page reads the same keys, so both pages see the same organizations.
 *
 * contactEmail is unverified form input, so it never joins a post to an
 * account. Only an account-less legacy post, which has nothing else, is
 * anchored on its stored quotaDomain or, failing that, its contact email's
 * domain, through the same free-domain screen; a post with no usable domain
 * at all gets a key of its own and stands alone rather than merging blindly.
 */
import { employerOrgKeys } from '@/lib/admin/employer-org-keys';
import {
    addApplicationCounts,
    addPostCounts,
    deriveHiringStatus,
    emptyApplicationCounts,
    emptyPostCounts,
    paymentBucket,
    type AdminEmployerSummary,
    type AdminOrganizationAccount,
    type AdminOrganizationRow,
    type EmployerApplicationCounts,
    type EmployerPostCounts,
} from '@/lib/admin/employer-overview-types';

/** Account id of the per-organization segment that holds userId NULL posts. */
export const NO_ACCOUNT_ID = 'no-account';
const ORPHAN_POST_KEY_PREFIX = 'post:';
const UNKNOWN_EMPLOYER = 'Unknown employer';

export interface EmployerJobRow {
    readonly userId: string | null;
    readonly jobId: string;
    readonly employerName: string;
    readonly contactEmail: string;
    readonly quotaDomain: string | null;
    readonly paymentStatus: string;
    readonly createdAt: Date;
    readonly job: {
        readonly isPublished: boolean;
        readonly expiresAt: Date | null;
        readonly viewCount: number;
        readonly applyClickCount: number;
    };
}

export interface EmployerProfileRow {
    readonly supabaseId: string;
    readonly email: string;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly company: string | null;
    readonly createdAt: Date;
}

/** Profiles and posts that share a union-find root: one organization. */
interface OrganizationComponent {
    readonly profiles: readonly EmployerProfileRow[];
    readonly posts: readonly EmployerJobRow[];
}

/** One account's posts folded into counts, with what the row shaping reads. */
interface AccountFold {
    readonly id: string;
    readonly hasAccount: boolean;
    readonly profile: EmployerProfileRow | undefined;
    readonly posts: EmployerPostCounts;
    readonly applications: EmployerApplicationCounts;
    readonly views: number;
    readonly applyClicks: number;
    readonly firstPostedAt: Date | null;
    readonly lastPostedAt: Date | null;
    /** The account's most recent post, for its fallback name and email. */
    readonly latestPost: EmployerJobRow | undefined;
}

/* ─── Counting ─── */

/**
 * Live right now: isPublished, and expiresAt null (never expires) or in the
 * future. The rule behind the employer's own live count
 * (lib/tier-limits.ts getEmployerActivePostings), evaluated in memory on rows
 * already loaded. Archive and Pause both set isPublished false, and a pending
 * post is never published, so they are covered by isPublished.
 */
export function isActivePost(job: EmployerJobRow['job'], now: Date): boolean {
    if (!job.isPublished) return false;
    return job.expiresAt === null || job.expiresAt.getTime() > now.getTime();
}

/** The counts one post contributes: one in total, active or inactive, and its payment bucket. */
function postCounts(row: EmployerJobRow, now: Date): EmployerPostCounts {
    const active = isActivePost(row.job, now);
    return {
        ...emptyPostCounts(),
        total: 1,
        active: active ? 1 : 0,
        inactive: active ? 0 : 1,
        [paymentBucket(row.paymentStatus)]: 1,
    };
}

const sumOf = <T>(items: readonly T[], pick: (item: T) => number): number =>
    items.reduce((running, item) => running + pick(item), 0);

/* ─── Identity keys and union-find ─── */

function hasAccountId(userId: string | null): userId is string {
    return typeof userId === 'string' && userId.trim().length > 0;
}

function profileNodeKeys(profile: EmployerProfileRow): string[] {
    return employerOrgKeys({ accountId: profile.supabaseId, signupEmail: profile.email });
}

/**
 * A post by an account carries the account key and the business domain of
 * its quotaDomain, else of the account's signup email. An account-less post
 * falls back to its contact email's domain; with no domain at all it stands
 * alone on a key of its own.
 */
function postNodeKeys(row: EmployerJobRow, profilesById: ReadonlyMap<string, EmployerProfileRow>): string[] {
    if (hasAccountId(row.userId)) {
        const signupEmail = profilesById.get(row.userId)?.email ?? null;
        return employerOrgKeys({ accountId: row.userId, signupEmail, quotaDomain: row.quotaDomain });
    }
    const keys = employerOrgKeys({ accountId: '', signupEmail: row.contactEmail, quotaDomain: row.quotaDomain });
    return keys.length > 0 ? keys : [`${ORPHAN_POST_KEY_PREFIX}${row.jobId}`];
}

/** Union-find over node indexes; path compression keeps repeated finds near constant time. */
function createUnionFind(size: number): { find: (node: number) => number; union: (a: number, b: number) => void } {
    const parent = Array.from({ length: size }, (_, index) => index);

    function find(node: number): number {
        let root = node;
        while (parent[root] !== root) root = parent[root];
        let current = node;
        while (parent[current] !== root) {
            const next = parent[current];
            parent[current] = root;
            current = next;
        }
        return root;
    }

    function union(a: number, b: number): void {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent[rootB] = rootA;
    }

    return { find, union };
}

/**
 * Every employer-role profile and every post is a node; nodes that share any
 * key are one organization. Accounts that never posted are nodes too, so the
 * never-posted cohort stays visible.
 */
function groupIntoComponents(
    profiles: readonly EmployerProfileRow[],
    posts: readonly EmployerJobRow[],
    profilesById: ReadonlyMap<string, EmployerProfileRow>,
): OrganizationComponent[] {
    const nodeKeys = [...profiles.map(profileNodeKeys), ...posts.map((row) => postNodeKeys(row, profilesById))];
    const uf = createUnionFind(nodeKeys.length);
    const keyOwner = new Map<string, number>();
    nodeKeys.forEach((keys, node) => {
        for (const key of keys) {
            const owner = keyOwner.get(key);
            if (owner === undefined) keyOwner.set(key, node);
            else uf.union(owner, node);
        }
    });

    const byRoot = new Map<number, { profiles: EmployerProfileRow[]; posts: EmployerJobRow[] }>();
    const bucketFor = (node: number) => {
        const root = uf.find(node);
        const existing = byRoot.get(root);
        if (existing) return existing;
        const created = { profiles: [] as EmployerProfileRow[], posts: [] as EmployerJobRow[] };
        byRoot.set(root, created);
        return created;
    };
    profiles.forEach((profile, index) => bucketFor(index).profiles.push(profile));
    posts.forEach((row, index) => bucketFor(profiles.length + index).posts.push(row));
    return [...byRoot.values()];
}

/* ─── Folding accounts ─── */

function latestPostOf(posts: readonly EmployerJobRow[]): EmployerJobRow | undefined {
    return posts.reduce<EmployerJobRow | undefined>(
        (latest, row) => (!latest || row.createdAt > latest.createdAt ? row : latest),
        undefined,
    );
}

function earliestPostedAt(posts: readonly EmployerJobRow[]): Date | null {
    return posts.reduce<Date | null>((first, row) => (!first || row.createdAt < first ? row.createdAt : first), null);
}

/**
 * Fold one account's posts. EmployerJob.jobId is unique, so each job's
 * applications land on exactly one account, and so on exactly one
 * organization: counts never multiply across joins.
 */
function foldAccount(
    seed: Pick<AccountFold, 'id' | 'hasAccount' | 'profile'>,
    posts: readonly EmployerJobRow[],
    applicationsByJob: ReadonlyMap<string, EmployerApplicationCounts>,
    now: Date,
): AccountFold {
    const latestPost = latestPostOf(posts);
    return {
        ...seed,
        posts: posts.map((row) => postCounts(row, now)).reduce(addPostCounts, emptyPostCounts()),
        applications: posts
            .map((row) => applicationsByJob.get(row.jobId) ?? emptyApplicationCounts())
            .reduce(addApplicationCounts, emptyApplicationCounts()),
        views: sumOf(posts, (row) => row.job.viewCount),
        applyClicks: sumOf(posts, (row) => row.job.applyClickCount),
        firstPostedAt: earliestPostedAt(posts),
        lastPostedAt: latestPost?.createdAt ?? null,
        latestPost,
    };
}

/** Real accounts newest first (unknown creation last), the account-less segment at the end. */
function compareAccounts(a: AccountFold, b: AccountFold): number {
    if (a.hasAccount !== b.hasAccount) return a.hasAccount ? -1 : 1;
    const aCreated = a.profile?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const bCreated = b.profile?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    if (aCreated !== bCreated) return bCreated - aCreated;
    return a.id.localeCompare(b.id);
}

/**
 * One fold per account in the component. Every employer-role profile gets
 * one even with zero posts; a post by a profile whose role is no longer
 * 'employer' still lands on that account (the route's second, bounded query
 * recovers the profile); account-less posts share one segment.
 */
function foldComponentAccounts(
    component: OrganizationComponent,
    applicationsByJob: ReadonlyMap<string, EmployerApplicationCounts>,
    profilesById: ReadonlyMap<string, EmployerProfileRow>,
    now: Date,
): AccountFold[] {
    const postsByAccount = new Map<string, EmployerJobRow[]>();
    for (const row of component.posts) {
        const accountId = hasAccountId(row.userId) ? row.userId : NO_ACCOUNT_ID;
        const list = postsByAccount.get(accountId);
        if (list) list.push(row);
        else postsByAccount.set(accountId, [row]);
    }
    const componentProfiles = new Map(component.profiles.map((profile) => [profile.supabaseId, profile]));
    const accountIds = [...new Set([...componentProfiles.keys(), ...postsByAccount.keys()])];
    return accountIds
        .map((id) => {
            const hasAccount = id !== NO_ACCOUNT_ID;
            const profile = hasAccount ? componentProfiles.get(id) ?? profilesById.get(id) : undefined;
            return foldAccount({ id, hasAccount, profile }, postsByAccount.get(id) ?? [], applicationsByJob, now);
        })
        .sort(compareAccounts);
}

/* ─── Row shaping ─── */

function contactName(profile: EmployerProfileRow | undefined): string {
    return `${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`.trim();
}

/** Account identity: company first, then the account's own most recent post name. */
function resolveAccountName(account: AccountFold): string {
    const company = account.profile?.company?.trim();
    if (company) return company;
    const postName = account.latestPost?.employerName.trim();
    if (postName) return postName;
    return contactName(account.profile) || account.profile?.email || account.latestPost?.contactEmail.trim() || UNKNOWN_EMPLOYER;
}

/**
 * Organization identity: the name it most recently posted under, THEN
 * account attributes. An organization that posts under one brand reads as
 * that brand even when the newest account signed up under a legal name
 * (allNames carries the rest).
 */
function resolveOrganizationName(latestPost: EmployerJobRow | undefined, newestAccount: AccountFold | undefined): string {
    const postName = latestPost?.employerName.trim();
    if (postName) return postName;
    const profile = newestAccount?.profile;
    const company = profile?.company?.trim();
    if (company) return company;
    return contactName(profile) || profile?.email || latestPost?.contactEmail.trim() || UNKNOWN_EMPLOYER;
}

/** Distinct names across the organization: post names newest first, then companies. */
function collectNames(posts: readonly EmployerJobRow[], accounts: readonly AccountFold[]): string[] {
    const newestFirst = [...posts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const candidates = [...newestFirst.map((row) => row.employerName), ...accounts.map((account) => account.profile?.company)];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const raw of candidates) {
        const name = raw?.trim();
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        names.push(name);
    }
    return names;
}

function toAccountRow(account: AccountFold): AdminOrganizationAccount {
    return {
        id: account.id,
        hasAccount: account.hasAccount,
        email: account.profile?.email || account.latestPost?.contactEmail.trim() || '',
        name: resolveAccountName(account),
        accountCreatedAt: account.profile?.createdAt.toISOString() ?? null,
        posts: account.posts,
        applications: account.applications,
    };
}

function minDate(dates: readonly (Date | null)[]): Date | null {
    return dates.reduce<Date | null>((min, date) => (date && (!min || date < min) ? date : min), null);
}

function maxDate(dates: readonly (Date | null)[]): Date | null {
    return dates.reduce<Date | null>((max, date) => (date && (!max || date > max) ? date : max), null);
}

function buildOrganization(
    component: OrganizationComponent,
    applicationsByJob: ReadonlyMap<string, EmployerApplicationCounts>,
    profilesById: ReadonlyMap<string, EmployerProfileRow>,
    now: Date,
): AdminOrganizationRow {
    const accounts = foldComponentAccounts(component, applicationsByJob, profilesById, now);
    // Organization totals are the exact sum of the account breakdown, so the
    // row can never disagree with its own expanded subrows.
    const posts = accounts.map((account) => account.posts).reduce(addPostCounts, emptyPostCounts());
    const applications = accounts.map((account) => account.applications).reduce(addApplicationCounts, emptyApplicationCounts());
    const latestPost = latestPostOf(component.posts);
    const newestAccount = accounts.find((account) => account.hasAccount);

    return {
        // Unique per row: account ids and job ids are globally unique, and
        // every account and post belongs to exactly one organization.
        id: newestAccount?.id ?? `orphan:job:${latestPost?.jobId ?? 'unknown'}`,
        name: resolveOrganizationName(latestPost, newestAccount),
        allNames: collectNames(component.posts, accounts),
        email: newestAccount?.profile?.email || newestAccount?.latestPost?.contactEmail.trim() || latestPost?.contactEmail.trim() || '',
        posts,
        firstPostedAt: minDate(accounts.map((account) => account.firstPostedAt))?.toISOString() ?? null,
        lastPostedAt: maxDate(accounts.map((account) => account.lastPostedAt))?.toISOString() ?? null,
        applications,
        hiringStatus: deriveHiringStatus(posts, applications),
        views: sumOf(accounts, (account) => account.views),
        applyClicks: sumOf(accounts, (account) => account.applyClicks),
        accounts: accounts.map(toAccountRow),
    };
}

/**
 * Most actionable first: organizations sitting on untriaged applicants, then
 * the busiest, then most recent activity, then alphabetical so the order is
 * stable.
 */
function compareOrganizations(a: AdminOrganizationRow, b: AdminOrganizationRow): number {
    if (b.applications.applied !== a.applications.applied) return b.applications.applied - a.applications.applied;
    if (b.applications.total !== a.applications.total) return b.applications.total - a.applications.total;
    if (b.posts.total !== a.posts.total) return b.posts.total - a.posts.total;
    const aLast = a.lastPostedAt ?? '';
    const bLast = b.lastPostedAt ?? '';
    if (aLast !== bLast) return bLast.localeCompare(aLast);
    return a.name.localeCompare(b.name);
}

/** Group, fold, shape and sort: the whole in-memory pipeline in one call. */
export function buildOrganizations(
    profiles: readonly EmployerProfileRow[],
    posts: readonly EmployerJobRow[],
    applicationsByJob: ReadonlyMap<string, EmployerApplicationCounts>,
    profilesById: ReadonlyMap<string, EmployerProfileRow>,
    now: Date,
): AdminOrganizationRow[] {
    return groupIntoComponents(profiles, posts, profilesById)
        .map((component) => buildOrganization(component, applicationsByJob, profilesById, now))
        .sort(compareOrganizations);
}

/**
 * @param employerAccountIds supabaseIds of every UserProfile with role
 * 'employer'. This is the population totalAccounts counts, and what
 * accountsWithPosts and accountsNeverPosted partition.
 * @param postedUserIds distinct non-null EmployerJob.userId values.
 */
export function buildSummary(
    organizations: readonly AdminOrganizationRow[],
    employerAccountIds: ReadonlySet<string>,
    postedUserIds: ReadonlySet<string>,
): AdminEmployerSummary {
    // Scoped to employer-role accounts, not to every account inside an
    // organization: a post can belong to a profile whose role is not
    // 'employer', and counting it here, where totalAccounts cannot see it,
    // would make the partition overshoot.
    const accountsWithPosts = [...employerAccountIds].filter((id) => postedUserIds.has(id)).length;
    const sum = (pick: (org: AdminOrganizationRow) => number): number => sumOf(organizations, pick);
    const realAccountCount = (org: AdminOrganizationRow): number => org.accounts.filter((account) => account.hasAccount).length;

    return {
        totalAccounts: employerAccountIds.size,
        accountsWithPosts,
        accountsNeverPosted: employerAccountIds.size - accountsWithPosts,
        // An organization with any linked account is not an orphan, even when
        // some of its posts are account-less legacy rows.
        orphanPosters: organizations.filter((org) => realAccountCount(org) === 0).length,
        totalPosts: sum((org) => org.posts.total),
        activePosts: sum((org) => org.posts.active),
        inactivePosts: sum((org) => org.posts.inactive),
        paidPosts: sum((org) => org.posts.paid),
        packPosts: sum((org) => org.posts.pack),
        promoPosts: sum((org) => org.posts.promo),
        freePosts: sum((org) => org.posts.free),
        pendingCheckouts: sum((org) => org.posts.pending),
        totalApplications: sum((org) => org.applications.total),
        untriagedApplications: sum((org) => org.applications.applied),
        // Per organization on purpose: this number drives the stat tile that
        // filters the table, so the tile and the filtered rows must agree.
        employersWithUntriaged: organizations.filter((org) => org.applications.applied > 0).length,
        totalOrganizations: organizations.length,
        organizationsWithMultipleAccounts: organizations.filter((org) => realAccountCount(org) > 1).length,
    };
}

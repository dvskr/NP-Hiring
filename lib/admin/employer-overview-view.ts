/**
 * What the admin employers page does with the rows it fetched: search,
 * filter, sort, and the few values it derives from an organization's
 * accounts. Pure and client-safe (it imports only the shared types), so the
 * page stays small and every rule here is unit tested.
 */
import type {
    AdminOrganizationAccount,
    AdminOrganizationRow,
    EmployerHiringStatus,
} from '@/lib/admin/employer-overview-types';

export type SortKey = 'posts' | 'applications' | 'untriaged' | 'lastPosted' | 'name';
export type SortDir = 'asc' | 'desc';

/**
 * Row filter. 'has_untriaged' is deliberately NOT a hiring status: it selects
 * every organization holding at least one applicant still at 'applied',
 * including those that read 'in_progress' or 'hired' because some account
 * moved another candidate. That is the population the summary counts as
 * employersWithUntriaged, so the stat tile and the filtered table agree.
 */
export type RowFilter = 'all' | 'has_untriaged' | EmployerHiringStatus;
export type AccountFilter = 'all' | 'with' | 'without';

export interface OrganizationQuery {
    readonly search: string;
    readonly status: RowFilter;
    readonly account: AccountFilter;
}

export function linkedAccounts(org: AdminOrganizationRow): AdminOrganizationAccount[] {
    return org.accounts.filter((account) => account.hasAccount);
}

export function orgHasAccount(org: AdminOrganizationRow): boolean {
    return org.accounts.some((account) => account.hasAccount);
}

/** Newest real account signup date, for the Accounts cell subline. */
export function newestAccountCreatedAt(org: AdminOrganizationRow): string | null {
    return org.accounts.reduce<string | null>(
        (newest, account) =>
            account.hasAccount && account.accountCreatedAt && (newest === null || account.accountCreatedAt > newest)
                ? account.accountCreatedAt
                : newest,
        null,
    );
}

/** Representative email: the API's pick, else the newest real account, else any member with an email. */
export function orgEmail(org: AdminOrganizationRow): string {
    if (org.email) return org.email;
    const newest = linkedAccounts(org)
        .filter((account) => account.email)
        .sort((a, b) => (b.accountCreatedAt ?? '').localeCompare(a.accountCreatedAt ?? ''))[0];
    if (newest) return newest.email;
    return org.accounts.find((account) => account.email)?.email ?? '';
}

/** Names beyond the display name, deduped case insensitively, for the "also posts as" subline. */
export function alsoPostsAs(org: AdminOrganizationRow): string[] {
    const primary = org.name.trim().toLowerCase();
    const seen = new Set<string>([primary]);
    const extras: string[] = [];
    for (const raw of org.allNames) {
        const name = raw.trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        extras.push(name);
    }
    return extras;
}

function matchesSearch(org: AdminOrganizationRow, search: string): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
        org.name.toLowerCase().includes(q) ||
        orgEmail(org).toLowerCase().includes(q) ||
        org.allNames.some((name) => name.toLowerCase().includes(q)) ||
        org.accounts.some((account) => account.email.toLowerCase().includes(q) || account.name.toLowerCase().includes(q))
    );
}

function matchesStatus(org: AdminOrganizationRow, status: RowFilter): boolean {
    if (status === 'all') return true;
    if (status === 'has_untriaged') return org.applications.applied > 0;
    return org.hiringStatus === status;
}

function matchesAccount(org: AdminOrganizationRow, account: AccountFilter): boolean {
    if (account === 'with') return orgHasAccount(org);
    if (account === 'without') return !orgHasAccount(org);
    return true;
}

/** Search by organization, any name it posts under, or any member's name or email; then the two filters. */
export function filterOrganizations(
    organizations: readonly AdminOrganizationRow[],
    query: OrganizationQuery,
): AdminOrganizationRow[] {
    return organizations.filter(
        (org) => matchesStatus(org, query.status) && matchesAccount(org, query.account) && matchesSearch(org, query.search),
    );
}

function sortValue(org: AdminOrganizationRow, key: SortKey): number | string {
    if (key === 'posts') return org.posts.total;
    if (key === 'applications') return org.applications.total;
    if (key === 'untriaged') return org.applications.applied;
    if (key === 'lastPosted') return org.lastPostedAt ? new Date(org.lastPostedAt).getTime() : 0;
    return org.name.toLowerCase();
}

/** A sorted copy; the input is left as it was. */
export function sortOrganizations(
    organizations: readonly AdminOrganizationRow[],
    key: SortKey,
    dir: SortDir,
): AdminOrganizationRow[] {
    return [...organizations].sort((a, b) => {
        const av = sortValue(a, key);
        const bv = sortValue(b, key);
        const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv);
        return dir === 'asc' ? cmp : -cmp;
    });
}

/** The direction a header click leaves the table in: the same key flips it, a new key starts on its natural order. */
export function nextSort(current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
    if (key === current.key) return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
    return { key, dir: key === 'name' ? 'asc' : 'desc' };
}

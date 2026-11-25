'use client';

/**
 * /admin/employers: every employer ORGANIZATION with its accounts, posts,
 * payment statuses, applicants and hiring progress (GET /api/admin/employers).
 *
 * One row per organization: the connected component of employer accounts and
 * posts that share an identity key (lib/admin/employer-org-keys.ts: the
 * account, or a business mail domain), with the per-account breakdown one
 * click away. Search, filters and sorting run in the browser over the rows
 * already fetched (lib/admin/employer-overview-view.ts).
 *
 * NOTE: a row's `id` is an opaque organization key. It is not a UserProfile
 * id and cannot be passed to /api/admin/users/[id].
 */

import { useState, useEffect, Fragment } from 'react';
import { formatCT } from '@/lib/format-ct';
import { adminFetch, type AdminFetchResult } from '@/lib/admin/admin-fetch';
import AdminLoadError from '../_components/AdminLoadError';
import {
    Building2, UserCheck, UserX, Briefcase, CheckCircle2, CreditCard, Inbox,
    AlertTriangle, Search, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { AdminEmployerSummary, AdminOrganizationRow, EmployerHiringStatus } from '@/lib/admin/employer-overview-types';
import {
    alsoPostsAs,
    filterOrganizations,
    linkedAccounts,
    newestAccountCreatedAt,
    nextSort,
    orgEmail,
    orgHasAccount,
    sortOrganizations,
    type AccountFilter,
    type RowFilter,
    type SortDir,
    type SortKey,
} from '@/lib/admin/employer-overview-view';
import {
    AccountSubrow, ApplicationsCell, FunnelCell, HIRING_STATUS, HIRING_STATUS_KEYS, PaymentCell, PostsCell,
    ACCENT, badge, card, heading, hiringBadge, inputStyle, muted, sub, td, th,
} from './EmployerTableParts';

const COLUMN_COUNT = 10;

interface StatTile {
    readonly icon: React.ReactNode;
    readonly label: string;
    readonly value: number;
    readonly color: string;
    readonly title?: string;
    readonly onClick?: () => void;
}

function statTiles(summary: AdminEmployerSummary, showUntriaged: () => void): StatTile[] {
    return [
        { icon: <Building2 size={18} />, label: 'Employer Accounts', value: summary.totalAccounts, color: ACCENT },
        { icon: <UserCheck size={18} />, label: 'Accounts With Posts', value: summary.accountsWithPosts, color: '#3B82F6' },
        { icon: <UserX size={18} />, label: 'Never Posted', value: summary.accountsNeverPosted, color: '#EC4899' },
        { icon: <Briefcase size={18} />, label: 'Total Posts', value: summary.totalPosts, color: '#9333EA' },
        { icon: <CheckCircle2 size={18} />, label: 'Active Posts', value: summary.activePosts, color: '#16A34A' },
        {
            icon: <CreditCard size={18} />, label: 'Paid Posts', value: summary.paidPosts + summary.packPosts, color: '#8B5CF6',
            title: `${summary.paidPosts} bought through Stripe Checkout, ${summary.packPosts} from a bought 5-post pack`,
        },
        { icon: <Inbox size={18} />, label: 'Applications', value: summary.totalApplications, color: '#3B82F6' },
        {
            // Drills into 'has_untriaged', exactly the population this number
            // counts. Filtering on hiringStatus 'untriaged' would show fewer
            // rows than the tile advertises.
            icon: <AlertTriangle size={18} />, label: 'Sitting On Untriaged', value: summary.employersWithUntriaged, color: '#F59E0B',
            title: 'Filter the table to these employers', onClick: showUntriaged,
        },
    ];
}

function SummaryTiles({ tiles }: { tiles: readonly StatTile[] }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4" style={{ marginBottom: 24 }}>
            {tiles.map(stat => {
                const body = (
                    <>
                        <div style={{ color: stat.color, marginBottom: 6 }}>{stat.icon}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: '#1A2E35' }}>{stat.value}</div>
                        <div style={muted}>{stat.label}</div>
                    </>
                );
                const style: React.CSSProperties = { ...card, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '100%' };
                return stat.onClick ? (
                    <button key={stat.label} type="button" onClick={stat.onClick} title={stat.title} style={{ ...style, cursor: 'pointer', font: 'inherit' }}>
                        {body}
                    </button>
                ) : (
                    <div key={stat.label} title={stat.title} style={style}>{body}</div>
                );
            })}
        </div>
    );
}

function BreakdownStrip({ summary }: { summary: AdminEmployerSummary }) {
    const items = [
        { l: 'Organizations', v: summary.totalOrganizations, c: ACCENT, t: 'Accounts and posts grouped into one row when they share an account or a business mail domain.' },
        { l: 'Multi-account Orgs', v: summary.organizationsWithMultipleAccounts, c: '#8B5CF6', t: 'Organizations where two or more employer accounts share one identity. Their posts and applicants combine into one row.' },
        { l: 'Untriaged Applicants', v: summary.untriagedApplications, c: '#F59E0B', t: 'Applications still at status applied. Nobody has looked at them.' },
        { l: 'Inactive Posts', v: summary.inactivePosts, c: '#94A3B8', t: 'Unpublished, paused, archived or expired posts.' },
        { l: 'Promo Posts', v: summary.promoPosts, c: '#3B82F6', t: 'Posts published free during the launch promo.' },
        { l: 'Pack Posts', v: summary.packPosts, c: '#16A34A', t: 'Posts published from a bought 5-post pack credit.' },
        { l: 'Free Posts', v: summary.freePosts, c: '#64748B', t: 'Posts on the legacy free tier.' },
        { l: 'Pending Checkouts', v: summary.pendingCheckouts, c: '#EF4444', t: 'Checkout started, never completed. These are not paid posts.' },
        { l: 'Posters Without Account', v: summary.orphanPosters, c: '#9333EA', t: 'Legacy posts with no linked employer account.' },
    ];
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-4" style={{ padding: 20, borderBottom: '1px solid #E8ECF0' }}>
            {items.map(s => (
                <div key={s.l} style={{ textAlign: 'center' }} title={s.t}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: s.c }}>{s.v}</div>
                    <div style={muted}>{s.l}</div>
                </div>
            ))}
        </div>
    );
}

interface RowProps {
    readonly org: AdminOrganizationRow;
    readonly expanded: boolean;
    readonly onToggle: (id: string) => void;
}

function OrganizationRow({ org, expanded, onToggle }: RowProps) {
    const extras = alsoPostsAs(org);
    const linked = linkedAccounts(org);
    const memberList = org.accounts.map(a => a.email || a.name).filter(Boolean).join('\n');
    const newestSignup = newestAccountCreatedAt(org);
    const toggleLabel = expanded ? 'Hide the per-account breakdown' : 'Show the per-account breakdown';
    return (
        <Fragment>
            <tr style={org.hiringStatus === 'untriaged' ? { backgroundColor: 'rgba(245,158,11,0.06)' } : undefined}>
                <td style={{ ...td, fontWeight: 600, color: '#1A2E35' }}>
                    <div>{org.name || 'Unknown employer'}</div>
                    {extras.length > 0 && (
                        <div style={{ ...muted, marginTop: 2, fontWeight: 400, whiteSpace: 'normal', maxWidth: 280 }}>
                            also posts as: {extras.join(', ')}
                        </div>
                    )}
                </td>
                <td style={td}>{orgEmail(org) || 'None'}</td>
                <td style={td} title={memberList || undefined}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {linked.length > 0
                            ? badge(`${linked.length} ${linked.length === 1 ? 'account' : 'accounts'}`, 'green')
                            : badge('No account', 'orange')}
                        {org.accounts.length > 1 && (
                            <button type="button" onClick={() => onToggle(org.id)} aria-expanded={expanded} aria-label={toggleLabel} title={toggleLabel}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: ACCENT, display: 'inline-flex', alignItems: 'center' }}>
                                <ChevronRight size={14} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
                            </button>
                        )}
                    </div>
                    {newestSignup && <div style={{ ...muted, marginTop: 4 }}>{formatCT(newestSignup, 'date')}</div>}
                </td>
                <td style={td}><PostsCell posts={org.posts} /></td>
                <td style={td}><PaymentCell posts={org.posts} /></td>
                <td style={td}><ApplicationsCell apps={org.applications} /></td>
                <td style={td}><FunnelCell apps={org.applications} /></td>
                <td style={td}>{hiringBadge(org.hiringStatus)}</td>
                <td style={td}>
                    <div style={{ fontWeight: 600, color: '#1A2E35' }}>{org.views}</div>
                    <div style={{ ...muted, marginTop: 2 }}>{org.applyClicks} apply clicks</div>
                </td>
                <td style={td}>{org.lastPostedAt ? formatCT(org.lastPostedAt, 'date') : 'Never'}</td>
            </tr>
            {expanded && org.accounts.map(account => <AccountSubrow key={account.id} account={account} />)}
        </Fragment>
    );
}

interface OverviewPayload {
    readonly summary?: AdminEmployerSummary;
    readonly organizations?: unknown;
}

const UNREADABLE_OVERVIEW = 'The server answered without the summary and rows this page needs. Retry, and check the admin API logs if it repeats.';

/** The overview read. It sets no state: the page applies its answer (applyOverview). */
function requestOverview(): Promise<AdminFetchResult<OverviewPayload>> {
    return adminFetch<OverviewPayload>('/api/admin/employers');
}

export default function AdminEmployersPage() {
    const [organizations, setOrganizations] = useState<AdminOrganizationRow[]>([]);
    const [summary, setSummary] = useState<AdminEmployerSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<RowFilter>('all');
    const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'applications', dir: 'desc' });
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

    // The overview's answer. Only an answer sets state, never the effect itself; the first
    // load starts with the spinner on (useState(true)) and a retry turns it on (reload).
    const applyOverview = (result: AdminFetchResult<OverviewPayload>) => {
        if (!result.ok) {
            setLoadError(result.error);
        } else if (!result.data.summary || !Array.isArray(result.data.organizations)) {
            setLoadError(UNREADABLE_OVERVIEW);
        } else {
            setOrganizations(result.data.organizations as AdminOrganizationRow[]);
            setSummary(result.data.summary);
            setLoadError(null);
        }
        setLoading(false);
    };

    const reload = () => {
        setLoading(true);
        setLoadError(null);
        void requestOverview().then(applyOverview);
    };

    useEffect(() => {
        let current = true;
        void requestOverview().then((result) => { if (current) applyOverview(result); });
        return () => { current = false; };
    }, []);

    const toggleExpanded = (id: string) => {
        setExpanded(prev => (prev.has(id) ? new Set([...prev].filter(key => key !== id)) : new Set([...prev, id])));
    };
    const applySort = (key: SortKey) => setSort(current => nextSort(current, key));

    const sorted = sortOrganizations(
        filterOrganizations(organizations, { search, status: statusFilter, account: accountFilter }),
        sort.key,
        sort.dir,
    );
    const statusCount = (status: EmployerHiringStatus) => organizations.filter(org => org.hiringStatus === status).length;
    const untriagedCount = organizations.filter(org => org.applications.applied > 0).length;
    const withAccountCount = organizations.filter(orgHasAccount).length;

    const sortableTh = (label: string, key: SortKey, title: string) => (
        <th style={{ ...th, color: sort.key === key ? ACCENT : '#94A3B8' }} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
            <button type="button" onClick={() => applySort(key)} title={title}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }}>
                {label}
                {sort.key === key && <ChevronDown size={12} style={{ transform: sort.dir === 'asc' ? 'rotate(180deg)' : 'none' }} />}
            </button>
        </th>
    );

    if (loading) {
        return (
            <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 16px', textAlign: 'center' }}>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ width: 48, height: 48, border: '3px solid #E8ECF0', borderTop: `3px solid ${ACCENT}`, borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ ...sub, marginTop: 16 }}>Loading employers...</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 16px' }}>
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ ...heading, fontSize: 28, marginBottom: 4 }}>Employers</h1>
                <p style={sub}>Every organization with its accounts, posts, applicants, and hiring progress</p>
            </div>

            {loadError && (
                <AdminLoadError subject="The employers overview" message={loadError} onRetry={reload} />
            )}

            {summary && <SummaryTiles tiles={statTiles(summary, () => setStatusFilter('has_untriaged'))} />}

            <div style={card}>
                {summary && <BreakdownStrip summary={summary} />}

                <div style={{ padding: '14px 20px', borderBottom: '1px solid #E8ECF0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: '1 1 200px' }}>
                        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                        <input type="text" aria-label="Search organizations" placeholder="Search organization, name, or member email..." value={search}
                            onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: '100%', paddingLeft: 32 }} />
                    </div>
                    <select aria-label="Hiring status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as RowFilter)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="all">All Hiring Status ({organizations.length})</option>
                        <option value="has_untriaged">Holding untriaged applicants ({untriagedCount})</option>
                        {HIRING_STATUS_KEYS.map(key => (
                            <option key={key} value={key}>{HIRING_STATUS[key].label} ({statusCount(key)})</option>
                        ))}
                    </select>
                    <select aria-label="Account" value={accountFilter} onChange={e => setAccountFilter(e.target.value as AccountFilter)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="all">All Accounts ({organizations.length})</option>
                        <option value="with">With Account ({withAccountCount})</option>
                        <option value="without">No Account ({organizations.length - withAccountCount})</option>
                    </select>
                    <select aria-label="Sort" value={sort.key} onChange={e => applySort(e.target.value as SortKey)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="applications">Sort: Most applications</option>
                        <option value="untriaged">Sort: Most untriaged</option>
                        <option value="posts">Sort: Most posts</option>
                        <option value="lastPosted">Sort: Last posted</option>
                        <option value="name">Sort: Organization name</option>
                    </select>
                    <span style={{ ...muted, marginLeft: 'auto' }}>Showing {sorted.length} of {organizations.length}</span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#F8FAF9' }}>
                                {sortableTh('Employer', 'name', 'Sort by organization name')}
                                <th style={th}>Email</th>
                                <th style={th}>Accounts</th>
                                {sortableTh('Posts', 'posts', 'Sort by posts')}
                                <th style={th}>Payment</th>
                                {sortableTh('Applications', 'applications', 'Sort by applications')}
                                {sortableTh('ATS Funnel', 'untriaged', 'Sort by untriaged applicants')}
                                <th style={th}>Hiring Status</th>
                                <th style={th}>Views</th>
                                {sortableTh('Last Posted', 'lastPosted', 'Sort by last posted')}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map(org => (
                                <OrganizationRow key={org.id} org={org} expanded={expanded.has(org.id)} onToggle={toggleExpanded} />
                            ))}
                            {sorted.length === 0 && (
                                <tr><td colSpan={COLUMN_COUNT} style={{ ...td, textAlign: 'center', padding: 40 }}>No organizations found</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

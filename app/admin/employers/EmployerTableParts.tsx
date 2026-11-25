'use client';

/**
 * The cells and subrow of the admin employers table (app/admin/employers),
 * in the admin back office's inline style set. Shared by organization rows
 * and their per-account subrows so both stay in lockstep.
 */
import { formatCT } from '@/lib/format-ct';
import {
    PAYMENT_BUCKETS,
    deriveHiringStatus,
    type AdminOrganizationAccount,
    type EmployerApplicationCounts,
    type EmployerHiringStatus,
    type EmployerPostCounts,
    type PaymentBucket,
} from '@/lib/admin/employer-overview-types';

/* ─── Styles ─── */
export const card: React.CSSProperties = { backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', overflow: 'hidden' };
export const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
export const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
export const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
export const th: React.CSSProperties = { padding: '12px 16px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8', borderBottom: '1px solid #E8ECF0', textAlign: 'left', whiteSpace: 'nowrap' };
export const td: React.CSSProperties = { padding: '14px 16px', fontSize: '13px', color: '#6B7F8A', borderBottom: '1px solid #E8ECF0', whiteSpace: 'nowrap' };
export const inputStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: '8px', fontSize: '13px', backgroundColor: '#F8FAF9', border: '1px solid rgba(0,0,0,0.08)', color: '#1A2E35', outline: 'none' };
export const ACCENT = '#BE185D';

export type BadgeColor = 'green' | 'purple' | 'blue' | 'gray' | 'red' | 'orange';

const BADGE_COLORS: Record<BadgeColor, { bg: string; text: string }> = {
    green: { bg: 'rgba(34,197,94,0.12)', text: '#16A34A' },
    purple: { bg: 'rgba(168,85,247,0.12)', text: '#9333EA' },
    blue: { bg: 'rgba(59,130,246,0.12)', text: '#3B82F6' },
    gray: { bg: 'rgba(148,163,184,0.12)', text: '#64748B' },
    red: { bg: 'rgba(239,68,68,0.12)', text: '#DC2626' },
    orange: { bg: 'rgba(245,158,11,0.12)', text: '#B45309' },
};

export function badge(text: string, color: BadgeColor) {
    const { bg, text: fg } = BADGE_COLORS[color];
    return <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, backgroundColor: bg, color: fg, whiteSpace: 'nowrap' }}>{text}</span>;
}

/* ─── Hiring status presentation ─── */
export const HIRING_STATUS: Record<EmployerHiringStatus, { label: string; color: BadgeColor }> = {
    hired: { label: 'Hired', color: 'green' },
    in_progress: { label: 'In progress', color: 'blue' },
    untriaged: { label: 'Untriaged', color: 'orange' },
    all_rejected: { label: 'All rejected', color: 'red' },
    no_applicants: { label: 'No applicants', color: 'gray' },
    no_posts: { label: 'No posts', color: 'gray' },
};
export const HIRING_STATUS_KEYS = Object.keys(HIRING_STATUS) as EmployerHiringStatus[];

export function hiringBadge(status: EmployerHiringStatus) {
    const meta = HIRING_STATUS[status];
    // An unknown value still renders, as itself, instead of an empty cell.
    if (!meta) return badge(String(status), 'gray');
    return badge(meta.label, meta.color);
}

/* ─── Payment cell ─── */
const PAYMENT_BADGE: Record<PaymentBucket, { label: string; color: BadgeColor; title: string }> = {
    paid: { label: 'paid', color: 'green', title: 'Bought through Stripe Checkout, or renewed.' },
    pack: { label: 'pack', color: 'green', title: 'Published from a bought 5-post pack credit.' },
    promo: { label: 'promo', color: 'blue', title: 'Free during the launch promo.' },
    plan: { label: 'plan', color: 'blue', title: 'Posted under the retired Employer plan.' },
    free: { label: 'free', color: 'gray', title: 'The legacy free tier.' },
    pending: { label: 'pending', color: 'red', title: 'Checkout started, never completed. Not paid.' },
    expired: { label: 'checkout expired', color: 'gray', title: 'A pending checkout that was closed unpaid.' },
    refunded: { label: 'refunded', color: 'purple', title: 'Refunded through Stripe.' },
    disputed: { label: 'disputed', color: 'orange', title: 'A card dispute is open.' },
    other: { label: 'other', color: 'purple', title: 'Any other payment status.' },
};

export function PaymentCell({ posts }: { posts: EmployerPostCounts }) {
    if (posts.total === 0) return badge('None', 'gray');
    return (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 260 }}>
            {PAYMENT_BUCKETS.filter((bucket) => posts[bucket] > 0).map((bucket) => (
                <span key={bucket} title={PAYMENT_BADGE[bucket].title}>
                    {badge(`${posts[bucket]} ${PAYMENT_BADGE[bucket].label}`, PAYMENT_BADGE[bucket].color)}
                </span>
            ))}
        </div>
    );
}

/* ─── ATS funnel cell ───
 * The 'applied' stage is the operator signal: candidates the employer has
 * never actioned, so it stays amber and bold while every zero stage fades.
 */
export function FunnelCell({ apps }: { apps: EmployerApplicationCounts }) {
    if (apps.total === 0) return <span style={muted}>No applicants</span>;
    const stages: Array<{ label: string; value: number; color: string }> = [
        { label: 'new', value: apps.applied, color: '#B45309' },
        { label: 'screen', value: apps.screening, color: '#3B82F6' },
        { label: 'interview', value: apps.interview, color: '#3B82F6' },
        { label: 'offer', value: apps.offered, color: '#9333EA' },
        { label: 'hired', value: apps.hired, color: '#16A34A' },
        { label: 'rejected', value: apps.rejected, color: '#DC2626' },
    ];
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            {stages.map((stage, index) => (
                <span key={stage.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {index > 0 && <span style={{ color: '#CBD5E1' }} aria-hidden>{'·'}</span>}
                    <span style={{ color: stage.value > 0 ? stage.color : '#94A3B8', fontWeight: stage.value > 0 ? 700 : 400 }}>
                        {stage.value} {stage.label}
                    </span>
                </span>
            ))}
        </div>
    );
}

export function PostsCell({ posts }: { posts: EmployerPostCounts }) {
    return (
        <>
            <div style={{ fontWeight: 600, color: '#1A2E35' }}>{posts.total}</div>
            <div style={{ ...muted, marginTop: 2 }}>{posts.active} active, {posts.inactive} inactive</div>
        </>
    );
}

export function ApplicationsCell({ apps }: { apps: EmployerApplicationCounts }) {
    return (
        <>
            <div style={{ fontWeight: 600, color: '#1A2E35' }}>{apps.total}</div>
            {apps.withdrawn > 0 && <div style={{ ...muted, marginTop: 2 }}>{apps.withdrawn} withdrawn</div>}
        </>
    );
}

/* ─── Per-account subrow ───
 * One per member account, or the account-less poster segment, under an
 * expanded organization row. Views and Last posted stay empty: the API ships
 * those per organization only.
 */
export function AccountSubrow({ account }: { account: AdminOrganizationAccount }) {
    const status = deriveHiringStatus(account.posts, account.applications);
    return (
        <tr style={{ backgroundColor: '#F8FAF9' }}>
            <td style={{ ...td, paddingLeft: 36 }}>
                <span style={{ color: '#94A3B8', marginRight: 6 }} aria-hidden>{'↳'}</span>
                <span style={{ fontWeight: 600, color: '#6B7F8A' }}>{account.name || account.email || 'Unknown account'}</span>
            </td>
            <td style={td}>{account.email || 'None'}</td>
            <td style={td}>
                {account.hasAccount ? badge('Account', 'green') : badge('No account', 'orange')}
                {account.accountCreatedAt && <div style={{ ...muted, marginTop: 4 }}>{formatCT(account.accountCreatedAt, 'date')}</div>}
            </td>
            <td style={td}><PostsCell posts={account.posts} /></td>
            <td style={td}><PaymentCell posts={account.posts} /></td>
            <td style={td}><ApplicationsCell apps={account.applications} /></td>
            <td style={td}><FunnelCell apps={account.applications} /></td>
            <td style={td}>{hiringBadge(status)}</td>
            <td style={td} />
            <td style={td} />
        </tr>
    );
}

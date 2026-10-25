/**
 * Settings, Billing: the account's 5-post packs, newest first (2027
 * re-price, phase 3; plan section 3.9). Each row is one pack purchase: its
 * posts left or used, the date to use them by or its state, the date bought,
 * the amount, and Stripe's hosted invoice page. The posts a pack paid for
 * have no invoice of their own; this one covers them.
 *
 * Presentational: EmployerSettingsClient reads the rows from
 * GET /api/employer/post-packs. Dates print as /employer/post-pack prints
 * them (lib/pricing-copy.ts#packDateLabel), so a pack reads the same in both.
 */
import { FileText } from 'lucide-react';
import { config } from '@/lib/config';
import { packDateLabel } from '@/lib/pricing-copy';
import { packCreditsLine, packInvoiceHref, packStatusLine, type PostPackView } from '@/lib/post-pack-view';

const th: React.CSSProperties = {
    textAlign: 'left', padding: '10px 8px', color: '#8A9BA6', fontWeight: 700,
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
};
const td: React.CSSProperties = { padding: '14px 8px', whiteSpace: 'nowrap' };
const pill: React.CSSProperties = {
    display: 'inline-block', fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '8px',
    background: '#FDF2F8', color: '#BE185D', boxShadow: 'inset 1px 1px 2px rgba(0,0,0,0.03)', whiteSpace: 'nowrap',
};
const invoiceLink: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    fontSize: '12px', fontWeight: 600, color: '#BE185D',
    padding: '6px 12px', borderRadius: '8px',
    background: '#FDF2F8', textDecoration: 'none',
    border: '1px solid rgba(190,24,93,0.18)', whiteSpace: 'nowrap',
};

const PACK_COLUMNS = ['Pack', 'Posts', 'Bought', 'Amount', 'Invoice'] as const;

export default function PackPurchases({ packs }: { packs: readonly PostPackView[] }) {
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                        {PACK_COLUMNS.map(h => <th key={h} style={th}>{h}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {packs.map(pack => {
                        const status = packStatusLine(pack);
                        const href = packInvoiceHref(pack);
                        return (
                            <tr key={pack.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                <td style={td}>
                                    <span style={pill}>{config.packPosts}-post pack</span>
                                    {status && (
                                        <span style={{ display: 'block', marginTop: '6px', fontSize: '12px', color: '#8A9BA6' }}>{status}</span>
                                    )}
                                </td>
                                <td style={{ ...td, color: '#1A2E35', fontWeight: 600 }}>{packCreditsLine(pack)}</td>
                                <td style={{ ...td, color: '#8A9BA6', fontSize: '13px' }}>{packDateLabel(new Date(pack.purchasedAt))}</td>
                                <td style={{ ...td, color: '#1A2E35', fontSize: '13px' }}>{config.formatDollars(pack.amountCents / 100)}</td>
                                <td style={{ ...td, fontSize: '13px' }}>
                                    {href ? (
                                        <a href={href} target="_blank" rel="noopener noreferrer" style={invoiceLink}>
                                            <FileText size={13} aria-hidden="true" /> Invoice{pack.invoiceNumber ? ` #${pack.invoiceNumber}` : ''}
                                        </a>
                                    ) : (
                                        <span style={{ color: '#B0BEC5', fontSize: '12px', fontStyle: 'italic' }}>Pending</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/**
 * The salary guide's measured pay breakdowns (salary build 2026-11, spec
 * Item 2): advertised pay by specialty, work mode, employment type and
 * experience, from the NP Pay Report snapshot (lib/reports/np-pay.ts), the
 * same figures /reports/np-pay publishes. They replace the experience,
 * setting and specialty premium tables, which were uncited editorial
 * estimates.
 *
 * Each row is the one engine's median advertised pay with its n in
 * employers, and the middle half where the full tier allows. A scope below
 * the median tier is OMITTED here (the report lists it with the reason), so
 * this page never prints "$0" or an empty figure.
 */
import Link from 'next/link';
import { brand } from '@/config/brand';
import { BENCHMARK_MIN_EMPLOYERS } from '@/components/tools/benchmark-model';
import { NP_PAY_REPORT_PATH, usd, type NpPayScopeRow, type NpPaySnapshot } from '@/lib/reports/np-pay-model';
import { publishedByMedian } from '@/lib/salary-guide-hub-faq';

const card: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};
const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '1px solid rgba(0,0,0,0.06)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' };
const td: React.CSSProperties = { padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)', fontSize: '13px', color: '#1A2E35' };

interface Group {
    id: string;
    title: string;
    scopeLabel: string;
    rows: NpPayScopeRow[];
    note: string;
}

function GroupTable({ group }: { group: Group }) {
    const rows = publishedByMedian(group.rows);
    return (
        <div id={group.id} className="emp-bento-card" style={{ ...card, padding: 0, overflow: 'hidden', minWidth: 0 }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: 0, padding: '20px 20px 8px' }}>{group.title}</h3>
            {rows.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th scope="col" style={th}>{group.scopeLabel}</th>
                                <th scope="col" style={{ ...th, textAlign: 'right' }}>Median advertised pay</th>
                                <th scope="col" style={{ ...th, textAlign: 'right' }}>Employers</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.scope}>
                                    <th scope="row" style={{ ...td, fontWeight: 600, textAlign: 'left' }}>
                                        {row.href ? <Link href={row.href} className="sal-state-link" style={{ color: '#1A2E35', textDecoration: 'none' }}>{row.scope}</Link> : row.scope}
                                    </th>
                                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#BE185D', whiteSpace: 'nowrap' }}>
                                        {usd(row.median as number)}
                                        {row.p25 !== null && row.p75 !== null && (
                                            <span style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#64748B' }}>
                                                middle half {usd(row.p25)} to {usd(row.p75)}
                                            </span>
                                        )}
                                    </td>
                                    <td style={{ ...td, textAlign: 'right', color: '#64748B' }}>{row.employers}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p style={{ fontSize: '13px', color: '#64748B', margin: 0, padding: '4px 20px 0' }}>
                    Fewer than {BENCHMARK_MIN_EMPLOYERS} employers disclose pay for each of these in live postings right now, so no median is published.
                </p>
            )}
            <p style={{ fontSize: '11.5px', color: '#64748B', margin: 0, padding: '10px 20px 18px', lineHeight: 1.5 }}>{group.note}</p>
        </div>
    );
}

export default function AdvertisedPaySection({ snapshot, asOfLabel }: { snapshot: NpPaySnapshot; asOfLabel: string }) {
    const groups: Group[] = [
        { id: 'pay-by-specialty', title: 'By specialty', scopeLabel: 'Specialty', rows: snapshot.specialties, note: 'Each specialty links its own salary guide. CRNA and CNM pay is reported on those roles’ own pages, never inside an NP figure.' },
        { id: 'pay-by-work-mode', title: 'By work mode', scopeLabel: 'Work mode', rows: snapshot.workModes, note: 'From each posting’s own work mode fields.' },
        { id: 'pay-by-employment-type', title: 'By employment type', scopeLabel: 'Employment type', rows: snapshot.employmentTypes, note: 'From each posting’s category tags. Rows overlap with the work modes.' },
        { id: 'pay-by-experience', title: 'By experience asked for', scopeLabel: 'Roles', rows: snapshot.experience, note: 'Buckets overlap: a role asking for 5 or more years also asks for 3 or more.' },
    ];
    return (
        <section id="advertised-pay" style={{ background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 50%, #FFF5EE 100%)', padding: '80px 20px' }}>
            <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                    Live Postings
                </p>
                <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3.5vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '12px' }}>
                    Advertised {brand.niche.short} Pay by Specialty, Work Mode and Experience
                </h2>
                <p style={{ fontSize: '14px', color: '#5A4A42', lineHeight: 1.65, textAlign: 'center', maxWidth: '720px', margin: '0 auto 32px' }}>
                    The median pay employers advertise in live {brand.niche.short} postings on {brand.name} as of {asOfLabel}, each employer counted once. A row appears once at least {BENCHMARK_MIN_EMPLOYERS} employers disclose pay for it; the full breakdown, with the rows below that line, is in the{' '}
                    <Link href={NP_PAY_REPORT_PATH} style={{ color: '#BE185D', fontWeight: 600 }}>NP Pay Report</Link>.
                </p>
                <div className="sal-pay-grid" style={{ display: 'grid', gap: '14px' }}>
                    {groups.map((group) => <GroupTable key={group.id} group={group} />)}
                </div>
                <p style={{ fontSize: '14px', color: '#5A4A42', textAlign: 'center', margin: '24px 0 0' }}>
                    How each factor shows up in a real offer:{' '}
                    <Link href="/blog/np-salary-guide" style={{ color: '#BE185D', fontWeight: 600 }}>What moves NP pay</Link>
                </p>
            </div>
        </section>
    );
}

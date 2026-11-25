/**
 * /admin/settings: what this deployment is actually configured to do.
 *
 * A server component on purpose. Every claim on the page is read at request
 * time from the environment, the live rate-limit table, or the AI flag
 * registry and its override rows. The previous version was a client
 * component with no data access at all: its "Active" and "Enabled" pills
 * were literals that stayed green whether or not the integration behind
 * them existed.
 *
 * Env VALUES never leave the server. Only "is this key present" does.
 */
import { Bot, Database, Gauge } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth/protect';
import { logger } from '@/lib/logger';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { listFlags } from '@/lib/ai/feature-flags';
import {
    INTEGRATION_SECTIONS,
    describeRateLimit,
    readIntegrationStatus,
    type IntegrationRow,
    type IntegrationStatus,
} from './config-status';

// Reading process.env at build time would freeze the answers into the
// bundle, which is the failure this page exists to avoid.
export const dynamic = 'force-dynamic';

/* Styles */
const card: React.CSSProperties = {
    backgroundColor: '#FAFBF9', border: '1px solid rgba(255,255,255,0.7)', borderRadius: '18px', boxShadow: '8px 8px 20px rgba(0,0,0,0.05), -6px -6px 16px rgba(255,255,255,0.9), inset 3px 3px 6px rgba(255,255,255,0.7), inset -2px -2px 4px rgba(0,0,0,0.02)', padding: '24px',
};
const heading: React.CSSProperties = { color: '#1A2E35', fontWeight: 700 };
const sub: React.CSSProperties = { color: '#6B7F8A', fontSize: '14px' };
const muted: React.CSSProperties = { color: '#94A3B8', fontSize: '12px' };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, monospace', fontSize: '11px' };
const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    padding: '16px 0', borderBottom: '1px solid #E8ECF0',
};
const sectionTitle: React.CSSProperties = { ...heading, fontSize: 18, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 };

type PillTone = 'good' | 'bad' | 'neutral';

const PILL_COLORS: Readonly<Record<PillTone, { bg: string; text: string }>> = {
    good: { bg: 'rgba(34,197,94,0.12)', text: '#15803D' },
    bad: { bg: 'rgba(245,158,11,0.14)', text: '#B45309' },
    neutral: { bg: 'rgba(148,163,184,0.14)', text: '#64748B' },
};

function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
    return (
        <span style={{
            padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            whiteSpace: 'nowrap', backgroundColor: PILL_COLORS[tone].bg, color: PILL_COLORS[tone].text,
        }}>{children}</span>
    );
}

function keyList(row: IntegrationRow): string {
    return row.envKeys.join(row.mode === 'any' ? ' or ' : ', ');
}

function IntegrationRowView({ row, status }: { row: IntegrationRow; status: IntegrationStatus }) {
    return (
        <div style={rowStyle}>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1A2E35' }}>{row.label}</div>
                <div style={muted}>{row.description}</div>
                <div style={{ ...muted, ...mono, marginTop: 4 }}>
                    {keyList(row)}, read by {row.readBy}
                </div>
                {!status.configured && (
                    <div style={{ ...muted, ...mono, color: '#B45309', marginTop: 2 }}>
                        Not set: {status.missing.join(row.mode === 'any' ? ' or ' : ', ')}
                    </div>
                )}
            </div>
            <div style={{ flexShrink: 0 }}>
                {status.configured
                    ? <Pill tone="good">Configured</Pill>
                    : <Pill tone="bad">Not configured</Pill>}
            </div>
        </div>
    );
}

function RateLimitsCard() {
    return (
        <div style={{ ...card, marginBottom: 24 }}>
            <h2 style={sectionTitle}>
                <Gauge size={20} style={{ color: '#F59E0B' }} /> Rate limits
            </h2>
            <p style={{ ...muted, marginBottom: 12 }}>
                The live values from lib/rate-limit.ts, not a copy of them.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {Object.entries(RATE_LIMITS).map(([name, cfg]) => (
                    <div key={name} style={{ padding: '10px 14px', borderRadius: 10, backgroundColor: '#F8FAF9' }}>
                        <div style={{ ...mono, color: '#1A2E35', fontWeight: 600 }}>{name}</div>
                        <div style={muted}>{describeRateLimit(cfg)}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

interface FlagOverrideRow {
    flag: string;
    tenantType: string;
    tenantId: string | null;
    enabled: boolean;
}

/** Every override row that has not expired, or a failure the page reports. */
async function readActiveOverrides(): Promise<{ rows: FlagOverrideRow[]; failed: boolean }> {
    try {
        const rows = await prisma.aiFeatureFlagOverride.findMany({
            where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
            select: { flag: true, tenantType: true, tenantId: true, enabled: true },
            orderBy: [{ flag: 'asc' }, { tenantType: 'asc' }],
        });
        return { rows, failed: false };
    } catch (err) {
        // A database outage should not blank the page: the rest of it is
        // env-derived and still true. The card says the overrides are missing.
        logger.error('[admin/settings] could not read AI flag overrides', err);
        return { rows: [], failed: true };
    }
}

function describeOverride(o: FlagOverrideRow): string {
    const tenant = o.tenantId ? `${o.tenantType}:${o.tenantId}` : o.tenantType;
    return `${tenant} = ${o.enabled ? 'on' : 'off'}`;
}

function AiFlagsCard({ overrides, failed }: { overrides: readonly FlagOverrideRow[]; failed: boolean }) {
    return (
        <div style={card}>
            <h2 style={sectionTitle}>
                <Bot size={20} style={{ color: '#A855F7' }} /> AI feature flags
            </h2>
            <p style={{ ...muted, marginBottom: 12 }}>
                Compiled defaults plus every active override row. A KILL_AI_ environment variable for a flag
                beats both and is not shown here. Overrides are written through POST /api/admin/ai/flags.
            </p>
            {failed && (
                <p role="alert" style={{ ...muted, color: '#B45309', marginBottom: 12 }}>
                    Override rows could not be read, so only the compiled defaults below are current.
                </p>
            )}
            {listFlags().map((f) => {
                const rows = overrides.filter((o) => o.flag === f.flag);
                return (
                    <div key={f.flag} style={{ ...rowStyle, padding: '12px 0' }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ ...mono, fontSize: 12, fontWeight: 600, color: '#1A2E35' }}>{f.flag}</div>
                            <div style={muted}>{f.description}</div>
                            {rows.length > 0 && (
                                <div style={{ ...muted, ...mono, marginTop: 4, color: '#3B82F6' }}>
                                    {rows.map(describeOverride).join(' · ')}
                                </div>
                            )}
                        </div>
                        <div style={{ flexShrink: 0, display: 'flex', gap: 8 }}>
                            {rows.length > 0 && <Pill tone="neutral">Overridden</Pill>}
                            {f.default ? <Pill tone="good">Default on</Pill> : <Pill tone="neutral">Default off</Pill>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default async function AdminSettingsPage() {
    // The admin layout already gates /admin. Checking again here keeps the
    // page closed even when it is rendered without the layout.
    await requireAdmin('/admin/settings');

    const env = process.env as Readonly<Record<string, string | undefined>>;
    const sections = INTEGRATION_SECTIONS.map((section) => ({
        title: section.title,
        rows: section.rows.map((row) => ({ row, status: readIntegrationStatus(row, env) })),
    }));
    const allRows = sections.flatMap((s) => s.rows);
    const configuredCount = allRows.filter((r) => r.status.configured).length;

    const overrides = await readActiveOverrides();

    return (
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ ...heading, fontSize: 26 }}>Settings</h1>
                <p style={sub}>
                    Read at request time from this deployment. {configuredCount} of {allRows.length} integrations
                    have every key they read. Key values are never shown.
                </p>
            </div>

            {sections.map((section) => (
                <div key={section.title} style={{ ...card, marginBottom: 24 }}>
                    <h2 style={sectionTitle}>
                        <Database size={20} style={{ color: '#BE185D' }} /> {section.title}
                    </h2>
                    {section.rows.map(({ row, status }) => (
                        <IntegrationRowView key={row.label} row={row} status={status} />
                    ))}
                </div>
            ))}

            <RateLimitsCard />

            <AiFlagsCard overrides={overrides.rows} failed={overrides.failed} />
        </div>
    );
}

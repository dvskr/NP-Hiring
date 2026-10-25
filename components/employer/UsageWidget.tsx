'use client';

import { useState, useEffect } from 'react';
import { Users, Mail, TrendingUp, Loader2, Zap } from 'lucide-react';
import Link from 'next/link';
import { config } from '@/lib/config';
import { currentQuote } from '@/lib/next-post-quote';
import { packUseByLabel } from '@/lib/pricing-copy';
import { packCreditsLine } from '@/lib/post-pack-view';
import { useRerenderAtPromoEnd } from '@/lib/hooks/useRerenderAtPromoEnd';

/**
 * Dashboard usage strip: Plan card + unlock / InMail meters + "Post Another".
 *
 * The Plan card states what the employer's NEXT post is, from
 * GET /api/employer/free-quota-status: the launch promo ("Free through
 * <date>", only while the promo is still running on this render), a 5-post
 * pack credit ("3 of 5 posts left", "Use by <date>"), or the paid rung and
 * its price. A used-up pack still reads "5 of 5 posts used" above the next
 * post's price. While the pack can be sold (GET /api/employer/post-packs
 * answers saleOpen), the card's action buys one at /employer/post-pack.
 *
 * The Employer plan is retired (owner decision, 2026-10-24): the card no
 * longer reads the plan status endpoint, pitches no subscription and opens
 * no Stripe Customer Portal.
 */

interface UsageData {
    tier: string;
    tierLabel: string;
    usage: {
        candidateUnlocks: { used: number; limit: number | null; unlimited: boolean };
        inmails: { used: number; limit: number | null; unlimited: boolean };
    };
}

/** The account's current 5-post packs, summed (lib/post-packs.ts#getPackCreditStatus). */
interface PackCredit {
    remaining: number;
    used: number;
    total: number;
    expiresAt: string | null;
}

/** GET /api/employer/free-quota-status — see lib/pricing.ts#PricingQuote. */
interface QuotaStatus {
    eligible: boolean;
    mode?: 'promo' | 'pack' | 'intro' | 'paid';
    tier?: 'intro' | 'pro' | 'pack';
    willBeFree?: boolean;
    price?: number;
    promoEndsLabel?: string;
    pack?: PackCredit;
}

/** GET /api/employer/post-packs, the two fields the strip reads. */
interface PackSummary {
    saleOpen: boolean;
    credit: PackCredit | null;
}

/* ═══ Clay Design Tokens ═══ */
const clayCard: React.CSSProperties = {
    borderRadius: '18px',
    border: '1px solid rgba(0,0,0,0.05)',
    boxShadow: '5px 5px 14px rgba(0,0,0,0.05), -3px -3px 8px rgba(255,255,255,0.7), inset 1px 1px 2px rgba(255,255,255,0.5), inset -1px -1px 1px rgba(0,0,0,0.02)',
    background: '#FFFFFF',
};

const clayIconWrap: React.CSSProperties = {
    width: '44px', height: '44px', borderRadius: '14px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '3px 3px 8px rgba(0,0,0,0.06), inset 1px 1px 2px rgba(255,255,255,0.3)',
};

export default function UsageWidget() {
    const [data, setData] = useState<UsageData | null>(null);
    const [quota, setQuota] = useState<QuotaStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [packs, setPacks] = useState<PackSummary | null>(null);
    // The Plan card reads the promo phase as it renders (currentQuote below);
    // this gives a strip left open over config.promoEndsAt the render that
    // drops its promo label.
    useRerenderAtPromoEnd();

    useEffect(() => {
        // Fetch in parallel — usage drives the meters; the quote drives the
        // Plan card; the pack list says whether a pack can be bought. Each
        // request degrades independently: a missing quote just leaves the
        // card on the tier label, a missing pack list offers no purchase,
        // never a broken strip.
        Promise.allSettled([
            fetch('/api/employer/usage').then(r => r.ok ? r.json() : null),
            fetch('/api/employer/free-quota-status').then(r => r.ok ? r.json() : null),
            fetch('/api/employer/post-packs').then(r => r.ok ? r.json() : null),
        ]).then(([usageResult, quotaResult, packsResult]) => {
            if (usageResult.status === 'fulfilled') setData(usageResult.value);
            if (quotaResult.status === 'fulfilled') setQuota(quotaResult.value);
            if (packsResult.status === 'fulfilled') setPacks(packsResult.value);
        }).finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '28px', borderRadius: '18px',
                ...clayCard,
                marginBottom: '24px',
            }}>
                <Loader2 size={20} className="animate-spin" style={{ color: '#B0BEC5' }} />
            </div>
        );
    }

    if (!data) return null;

    const { usage, tierLabel, tier } = data;

    // Single-tier model — gradient palette keyed for current 'pro' value with
    // legacy fallbacks so older cached payloads still render correctly.
    const tierGradients: Record<string, { gradient: string; accent: string; glow: string }> = {
        pro: { gradient: 'linear-gradient(145deg, #BE185D, #9D174D)', accent: '#BE185D', glow: 'rgba(190,24,93,0.15)' },
        starter: { gradient: 'linear-gradient(145deg, #94A3B8, #64748B)', accent: '#94A3B8', glow: 'rgba(148,163,184,0.15)' },
        growth: { gradient: 'linear-gradient(145deg, #BE185D, #9D174D)', accent: '#BE185D', glow: 'rgba(190,24,93,0.15)' },
        premium: { gradient: 'linear-gradient(145deg, #8B5CF6, #A855F7)', accent: '#8B5CF6', glow: 'rgba(139,92,246,0.15)' },
    };

    const t = tierGradients[tier] || tierGradients.pro;

    // ─── Plan card label (one message: the next post) ───
    // The quote is the server's answer from when the dashboard loaded. A
    // 'promo' answer stops holding at config.promoEndsAt, so it counts only
    // while the promo runs on this render (currentQuote). A dashboard left
    // open over the boundary is rendered again at that instant
    // (useRerenderAtPromoEnd above), so it drops the promo label instead of
    // advertising free posting.
    const liveQuota = currentQuote(quota);
    const quoteMode = liveQuota?.eligible === true ? liveQuota.mode : undefined;
    const promoEndsLabel = liveQuota?.promoEndsLabel ?? config.promoEndsLabel;

    // The account's 5-post packs: from the pack list, else from the quote
    // (both read lib/post-packs.ts#getPackCreditStatus). While the promo
    // runs the promo wins, as it does when posting, and a credit stays unspent.
    const packCredit = quoteMode === 'promo' ? null : (packs?.credit ?? liveQuota?.pack ?? null);
    const nextPostPrice = quoteMode === 'intro' || quoteMode === 'paid'
        ? `Next post $${liveQuota?.price ?? config.priceDollarsForTier(liveQuota?.tier)}`
        : null;

    // The packs' line as every pack surface prints it (lib/post-pack-view.ts).
    const planLabel = quoteMode === 'promo'
        ? 'Launch promo'
        : packCredit
            ? packCreditsLine({
                state: packCredit.remaining > 0 ? 'active' : 'used',
                total: packCredit.total,
                remaining: packCredit.remaining,
                used: packCredit.used,
            })
            : tierLabel;
    const planSublabel = quoteMode === 'promo'
        ? `Free through ${promoEndsLabel}`
        : packCredit && packCredit.remaining > 0 && packCredit.expiresAt
            ? `Use by ${packUseByLabel(new Date(packCredit.expiresAt))}`
            : nextPostPrice;
    // Buy a pack, only while it can be sold (never during the promo).
    const planAction: CardAction | null = packs?.saleOpen
        ? { href: '/employer/post-pack', label: `Buy ${config.packPosts} posts · ${config.formatDollars(config.packPrice)}`, external: false }
        : null;

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '10px',
            marginBottom: '24px',
        }}>
            {/* ─── Plan card — launch promo / pack credits / next-post rung ─── */}
            <CompactCard
                icon={<Zap size={14} color="#fff" />}
                iconBg={t.gradient}
                iconGlow={t.glow}
                label="Plan"
                value={planLabel}
                valueColor={t.accent}
                sub={planSublabel}
                action={planAction}
            />

            {/* ─── Candidate Unlocks ─── */}
            <CompactMeter
                icon={<Users size={14} />}
                label="Unlocks"
                used={usage.candidateUnlocks.used}
                limit={usage.candidateUnlocks.limit}
                unlimited={usage.candidateUnlocks.unlimited}
                accent="#BE185D"
                gradient="linear-gradient(90deg, #BE185D, #9D174D)"
                glow="rgba(190,24,93,0.12)"
            />

            {/* ─── InMails ─── */}
            <CompactMeter
                icon={<Mail size={14} />}
                label="InMails"
                used={usage.inmails.used}
                limit={usage.inmails.limit}
                unlimited={usage.inmails.unlimited}
                accent="#3B82F6"
                gradient="linear-gradient(90deg, #3B82F6, #60A5FA)"
                glow="rgba(59,130,246,0.12)"
            />

            {/* ─── Post-another-job CTA — same compact footprint as the others ─── */}
            <Link
                href="/post-job"
                className="clay-upgrade-btn"
                style={{
                    ...clayCard, padding: '12px 14px',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    textDecoration: 'none',
                    transition: 'all 0.2s ease',
                }}
            >
                <div style={{
                    width: '32px', height: '32px', borderRadius: '10px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(145deg, #BE185D, #9D174D)',
                    boxShadow: '3px 3px 8px rgba(190,24,93,0.15), inset 1px 1px 2px rgba(255,255,255,0.2)',
                    flexShrink: 0,
                }}>
                    <TrendingUp size={14} color="#fff" />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{
                        fontSize: '13px', fontWeight: 700, margin: 0,
                        color: '#BE185D',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>Post Another</p>
                    <p style={{
                        fontSize: '10px', color: '#8A9BA6', margin: '1px 0 0',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                        +{config.limits.candidateUnlocksPerPosting} unlocks · +{config.limits.inmailsPerPosting} InMails
                    </p>
                </div>
            </Link>

            <style>{`
                .clay-upgrade-btn:hover {
                    transform: translateY(-1px);
                    box-shadow: 7px 7px 16px rgba(0,0,0,0.06), -3px -3px 8px rgba(255,255,255,0.8),
                                inset 1px 1px 2px rgba(255,255,255,0.5) !important;
                }
            `}</style>
        </div>
    );
}

/** Plan card footer: a link or a button (the 5-post pack's purchase link). */
type CardAction =
    | { href: string; label: string; external: boolean }
    | { label: string; onClick: () => void };

/* ═══ Compact Card — used for the Plan badge ═══ */
function CompactCard({
    icon, iconBg, iconGlow, label, value, valueColor, sub, action,
}: {
    icon: React.ReactNode;
    iconBg: string;
    iconGlow: string;
    label: string;
    value: string;
    valueColor: string;
    sub: string | null;
    /** Optional footer action: a link, or a button. */
    action?: CardAction | null;
}) {
    const actionStyle: React.CSSProperties = {
        flexBasis: '100%',
        fontSize: '10px', fontWeight: 700, color: '#1D4ED8',
        textDecoration: 'underline', textUnderlineOffset: '2px',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    };
    return (
        <div style={{
            ...clayCard, padding: '12px 14px',
            display: 'flex', alignItems: 'center', gap: '10px',
            flexWrap: 'wrap',
        }}>
            <div style={{
                width: '32px', height: '32px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: iconBg,
                boxShadow: `3px 3px 8px ${iconGlow}, inset 1px 1px 2px rgba(255,255,255,0.2)`,
                flexShrink: 0,
            }}>
                {icon}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{
                    fontSize: '10px', fontWeight: 700, color: '#B0BEC5', margin: 0,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>{label}</p>
                <p style={{
                    fontSize: '15px', fontWeight: 800, margin: '1px 0 0',
                    color: valueColor,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{value}</p>
                {sub && (
                    <p style={{
                        fontSize: '10px', color: '#BE185D', margin: '1px 0 0', fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                        {sub}
                    </p>
                )}
            </div>
            {action && 'onClick' in action && (
                <button
                    type="button"
                    onClick={action.onClick}
                    style={{ ...actionStyle, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                >
                    {action.label}
                </button>
            )}
            {action && 'href' in action && (
                <a
                    href={action.href}
                    {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    style={actionStyle}
                >
                    {action.label}
                </a>
            )}
        </div>
    );
}

/* ═══ Compact Meter — used for unlocks / InMails ═══ */
function CompactMeter({
    icon, label, used, limit, unlimited, accent, gradient, glow,
}: {
    icon: React.ReactNode;
    label: string;
    used: number;
    limit: number | null;
    unlimited: boolean;
    accent: string;
    gradient: string;
    glow: string;
}) {
    // No active posting → no entitlement at all. Render a dashed, gentle empty
    // state instead of "0/25", which previously implied a free 25-credit pool.
    const noEntitlement = !unlimited && (limit === 0 || limit === null);

    const pct = unlimited || !limit ? 0 : Math.min((used / limit) * 100, 100);
    const isNearLimit = !unlimited && !!limit && used >= limit * 0.8;
    const isAtLimit = !unlimited && !!limit && used >= limit;
    const valueColor = noEntitlement
        ? '#B0C4BC'
        : isAtLimit ? '#EF4444' : isNearLimit ? '#F59E0B' : '#1A2E35';

    return (
        <div style={{
            ...clayCard, padding: '12px 14px',
            border: noEntitlement
                ? '1px dashed rgba(0,0,0,0.12)'
                : isAtLimit
                    ? '1px solid rgba(239,68,68,0.22)'
                    : isNearLimit
                        ? '1px solid rgba(251,191,36,0.22)'
                        : '1px solid rgba(0,0,0,0.05)',
            display: 'flex', flexDirection: 'column', gap: '8px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                    width: '32px', height: '32px', borderRadius: '10px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: glow, color: accent,
                    flexShrink: 0,
                    opacity: noEntitlement ? 0.55 : 1,
                }}>
                    {icon}
                </div>
                <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{
                        fontSize: '10px', fontWeight: 700, color: '#8A9BA6',
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{label}</span>
                    <span style={{
                        fontSize: noEntitlement ? '11px' : '14px',
                        fontWeight: 800,
                        color: valueColor,
                        fontFamily: 'var(--font-inter, system-ui)',
                        whiteSpace: 'nowrap',
                    }}>
                        {unlimited ? '∞' : noEntitlement ? 'Post a job' : `${used}/${limit}`}
                    </span>
                </div>
            </div>
            {!unlimited && !noEntitlement && limit && (
                <div style={{
                    width: '100%', height: '4px', borderRadius: '2px',
                    background: '#F0F2F5',
                    boxShadow: 'inset 1px 1px 2px rgba(0,0,0,0.05)',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: '2px',
                        background: isAtLimit
                            ? 'linear-gradient(90deg, #EF4444, #F87171)'
                            : isNearLimit
                                ? 'linear-gradient(90deg, #F59E0B, #FBBF24)'
                                : gradient,
                        transition: 'width 0.6s ease',
                    }} />
                </div>
            )}
        </div>
    );
}


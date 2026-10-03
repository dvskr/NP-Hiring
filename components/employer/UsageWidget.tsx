'use client';

import { useState, useEffect } from 'react';
import { Users, Mail, TrendingUp, Loader2, Zap } from 'lucide-react';
import Link from 'next/link';
import { config } from '@/lib/config';
import { currentQuote } from '@/lib/next-post-quote';
import { useRerenderAtPromoEnd } from '@/lib/hooks/useRerenderAtPromoEnd';
import { brand } from '@/config/brand';

/**
 * Dashboard usage strip: Plan card + unlock / InMail meters + "Post Another".
 *
 * The Plan card is the dashboard's compact Employer-plan widget. It reads
 * two endpoints and picks ONE label so the employer is never told two
 * things at once:
 *   1. GET /api/employer/plan — an active plan wins: "Employer plan · N of
 *      M slots used".
 *   2. GET /api/employer/free-quota-status — otherwise the next-post quote:
 *      launch promo ("Free through <date>", only while the promo is still
 *      running on this render) or the paid rung.
 * Without an active plan the card carries the Subscribe link (Stripe
 * Payment Link from the plan endpoint) or, when no link is configured, a
 * mailto to support — the same fallback /pricing uses. A Stripe-billed plan
 * (including one that is past due) instead carries "Manage billing", which
 * opens the Stripe Customer Portal via POST /api/employer/billing-portal.
 */

interface UsageData {
    tier: string;
    tierLabel: string;
    usage: {
        candidateUnlocks: { used: number; limit: number | null; unlimited: boolean };
        inmails: { used: number; limit: number | null; unlimited: boolean };
    };
}

/** GET /api/employer/free-quota-status — see lib/pricing.ts#PricingQuote. */
interface QuotaStatus {
    eligible: boolean;
    mode?: 'promo' | 'plan' | 'intro' | 'paid';
    tier?: 'intro' | 'pro' | 'plan';
    willBeFree?: boolean;
    price?: number;
    promoEndsLabel?: string;
}

/** GET /api/employer/plan — see lib/employer-plan.ts#getPlanSlotStatus. */
interface PlanStatus {
    plan: { status: string; slots: number; currentPeriodEnd: string; source: string; canManageBilling?: boolean } | null;
    entitled: boolean;
    slots: number;
    used: number;
    remaining: number;
    price: number;
    paymentLinkUrl: string | null;
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
    const [planStatus, setPlanStatus] = useState<PlanStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [billingError, setBillingError] = useState<string | null>(null);
    // The Plan card reads the promo phase as it renders (currentQuote below);
    // this gives a strip left open over config.promoEndsAt the render that
    // drops its promo label.
    useRerenderAtPromoEnd();

    const openBillingPortal = async () => {
        setBillingError(null);
        try {
            const res = await fetch('/api/employer/billing-portal', { method: 'POST' });
            const body = await res.json().catch(() => null);
            if (res.ok && body?.url) {
                window.location.href = body.url;
                return;
            }
            setBillingError(body?.error ?? 'Could not open billing. Please contact support.');
        } catch {
            setBillingError('Could not open billing. Please contact support.');
        }
    };

    useEffect(() => {
        // Fetch in parallel — usage drives the meters; plan + quota drive the
        // Plan card (see the header comment for precedence). Each request
        // degrades independently: a missing plan endpoint just means "no
        // active plan", never a broken strip.
        Promise.allSettled([
            fetch('/api/employer/usage').then(r => r.ok ? r.json() : null),
            fetch('/api/employer/free-quota-status').then(r => r.ok ? r.json() : null),
            fetch('/api/employer/plan').then(r => r.ok ? r.json() : null),
        ]).then(([usageResult, quotaResult, planResult]) => {
            if (usageResult.status === 'fulfilled') setData(usageResult.value);
            if (quotaResult.status === 'fulfilled') setQuota(quotaResult.value);
            if (planResult.status === 'fulfilled') setPlanStatus(planResult.value);
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

    // ─── Plan card label (one message, precedence documented up top) ───
    // The quote is the server's answer from when the dashboard loaded. A
    // 'promo' answer stops holding at config.promoEndsAt, so it counts only
    // while the promo runs on this render (currentQuote). A dashboard left
    // open over the boundary is rendered again at that instant
    // (useRerenderAtPromoEnd above), so it drops the promo label instead of
    // advertising free posting, and shows the Subscribe pitch the ladder
    // phase carries.
    const liveQuota = currentQuote(quota);
    const hasActivePlan = planStatus?.entitled === true;
    const quoteMode = liveQuota?.eligible === true ? liveQuota.mode : undefined;
    const promoEndsLabel = liveQuota?.promoEndsLabel ?? config.promoEndsLabel;
    const planPrice = planStatus?.price ?? config.planPrice;
    const planSlots = planStatus?.slots && planStatus.slots > 0 ? planStatus.slots : config.planSlots;

    const planLabel = hasActivePlan
        ? 'Employer plan'
        : quoteMode === 'promo'
            ? 'Launch promo'
            : tierLabel;
    const planSublabel = hasActivePlan && planStatus
        ? `${planStatus.used} of ${planStatus.slots} slots used`
        : quoteMode === 'promo'
            ? `Free through ${promoEndsLabel}`
            : quoteMode === 'intro' || quoteMode === 'paid'
                ? `Next post $${liveQuota?.price ?? config.priceDollarsForTier(liveQuota?.tier)}`
                : null;

    // Subscribe (Stripe Payment Link) or Contact us (mailto) — only when the
    // employer is NOT already on a plan. Hidden during the launch promo:
    // every post is free then, so a subscription pitch would only confuse.
    const canManageBilling = planStatus?.plan?.canManageBilling === true
        && (hasActivePlan || planStatus.plan.status === 'past_due');
    const planAction: CardAction | null = canManageBilling
        ? { label: billingError ?? 'Manage billing', onClick: openBillingPortal }
        : !hasActivePlan && quoteMode !== 'promo'
            ? planStatus?.paymentLinkUrl
                ? { href: planStatus.paymentLinkUrl, label: `Subscribe · $${planPrice}/mo for ${planSlots} jobs`, external: true }
                : { href: `mailto:${brand.email.support}`, label: `Contact us · $${planPrice}/mo for ${planSlots} jobs`, external: false }
            : null;

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '10px',
            marginBottom: '24px',
        }}>
            {/* ─── Plan card — active plan / launch promo / next-post rung, plus Subscribe or Contact ─── */}
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

/** Plan card footer: a link (Subscribe / Contact) or a button (Manage billing). */
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
    /** Optional footer action — Subscribe (Payment Link), Contact (mailto) or Manage billing (portal). */
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


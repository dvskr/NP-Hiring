import { brand } from '@/config/brand';
import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import BreadcrumbSchema from '@/components/BreadcrumbSchema';
// Live review item 8c (WP-5): this page carried a stale pre-audit FORK of
// the /for-employers comparison table ("100% NP Audience", "No Unqualified
// Applicants", "Others: 30 days") labeled "same as employer page" — the P2
// #16 honesty audit had only reached /for-employers. Both pages now render
// the ONE audited module, so the audit cannot be forked away again.
import { EMPLOYER_COMPARISON_ROWS } from '@/lib/employer-comparison';
import { config } from '@/lib/config';
import { isPlanSaleOpen } from '@/lib/employer-plan-link';
import { Check, ArrowRight, X, HelpCircle, RefreshCw, Calendar, Star, TrendingUp, Mail, Users, Briefcase, BarChart3, DollarSign, Layers } from 'lucide-react';

/**
 * Pricing page — launch promo + 2027 ladder (2026-09-12).
 *
 * Every number and date on this page is a lib/config token, and the
 * sentences below are the CANONICAL copy strings the other employer
 * surfaces (/for-employers, /faq, /terms, the post-job wizard, emails)
 * repeat verbatim, so a price change in config can never strand a stale
 * figure here and the regression suite can pin the exact wording.
 *
 *   PROMO_HEADLINE / PROMO_SUB — the hero: every post free through
 *                                config.promoEndsLabel.
 *   LADDER_LINE                — what happens from config.ladderStartsLabel:
 *                                intro → featured → Employer plan.
 *   PLAN_TERMS                 — the plan's billing shape.
 *   PLAN_POSTS_LINE            — how a plan post actually lives: it runs
 *                                config.durationDays like every post, is never
 *                                renewed (create-renewal-checkout 409s it), and
 *                                frees its slot when it ends or is closed, so
 *                                the employer posts again into it at no extra
 *                                charge. Plan posts come down when the plan
 *                                ends (lib/employer-plan.ts#pausePlanPosts).
 *   PLAN_CANCEL_LINE           — a cancel keeps plan posts up through the paid
 *                                period (isPlanEntitled), never past a post's
 *                                own config.durationDays.
 *   FEATURES_LINE              — what EVERY post gets (no stripped tier).
 *   RENEWAL_LINE               — +60 days on a promo/intro/featured post; plan
 *                                posts are not renewable.
 *   RENEWAL_EFFECT_LINE        — what a renewal does and nothing more: it
 *                                moves the end date (apply-renewal.ts via
 *                                lib/expires-at.ts#renewalExpiresAt). It does
 *                                not reset the post's unlock or InMail counts
 *                                (lib/tier-limits.ts counts them per posting
 *                                since it was created), so no copy may say so.
 */
const PROMO_HEADLINE = `Free through ${config.promoEndsLabel}`;
const PROMO_SUB = `Every job post is free during our launch period: ${config.durationDays}-day listing, Featured badge, top placement, ${config.limits.candidateUnlocksPerPosting} candidate unlocks and ${config.limits.inmailsPerPosting} InMails. No credit card required.`;
const LADDER_LINE = `From ${config.ladderStartsLabel}: your first post is $${config.introPrice}, every post after that is $${config.postingPrice}, or $${config.planPrice}/month for ${config.planSlots} active jobs.`;
const PLAN_TERMS = `${config.planSlots} active job slots while you're subscribed. Swap jobs any time. Cancel any time.`;
const PLAN_POSTS_LINE = `Each plan post runs ${config.durationDays} days. When one ends, or you close it to swap in another role, its slot opens up and you can post into it again at no extra charge. Plan posts come down if the plan ends.`;
const PLAN_CANCEL_LINE = `If you cancel, your plan posts stay up through the end of the period you paid for, or until their ${config.durationDays} days run out if that comes first.`;
const FEATURES_LINE = `Featured badge · Top placement · ${config.limits.candidateUnlocksPerPosting} candidate unlocks · ${config.limits.inmailsPerPosting} InMails · Applicant analytics`;
const RENEWAL_LINE = `Renew a promo, intro or featured post for $${config.renewalPrice} (+${config.durationDays} days).`;
const RENEWAL_EFFECT_LINE = `A renewal adds ${config.durationDays} days to the post: to its current end date while it is still live, or from the day you renew once it has ended. It does not add unlocks or InMails: a post has ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails in total, however many times it is renewed.`;
const RENEWAL_CAP_LINE = `Renewals can extend a post to at most ${config.renewalCapDays} days after it was first posted.`;

// Edge-generated OG card — no dependency on storage assets that don't
// exist on this board (the old pmhnp-*.webp URL 400s). Same pattern as
// app/for-employers/page.tsx.
const PRICING_OG_IMAGE = `${brand.baseUrl}/api/og?title=${encodeURIComponent(`Pricing: free through ${config.promoEndsLabel}`)}&type=page`;

// The plan CTA depends on the launch-promo clock (lib/employer-plan-link.ts
// isPlanSaleOpen); re-render hourly so it opens without a redeploy when the
// promo ends — same cadence as /for-employers.
export const revalidate = 3600;

export const metadata: Metadata = {
    title: `Pricing | ${brand.niche.short} Job Board | Free Through ${config.promoEndsLabel}`,
    description:
        `Every ${brand.niche.short} job post is free through ${config.promoEndsLabel}, all features included. ${LADDER_LINE} No bidding, no contracts.`,
    openGraph: {
        title: `Pricing | ${brand.niche.short} Job Board`,
        description: `Post ${brand.niche.short} jobs free through ${config.promoEndsLabel}. ${LADDER_LINE} Every post gets the full package.`,
        images: [{ url: PRICING_OG_IMAGE, width: 1200, height: 630, alt: `${brand.niche.short} job board pricing` }],
    },
    twitter: { card: 'summary_large_image', images: [PRICING_OG_IMAGE] },
    alternates: { canonical: `${brand.baseUrl}/pricing` },
};

/* ═══ Clay Tokens — matched to employer page ═══ */
const clayCard: React.CSSProperties = {
    background: '#FFFFFF', borderRadius: '20px',
    border: '1px solid rgba(255,255,255,0.5)',
    boxShadow: '6px 6px 16px rgba(0,0,0,0.06), -3px -3px 10px rgba(255,255,255,0.8), inset 1px 1px 2px rgba(255,255,255,0.6), inset -1px -1px 1px rgba(0,0,0,0.02)',
};

const iconBg: React.CSSProperties = {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    background: '#D4E2D4',
    color: '#1E3A5F',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
};

const iconBgCentered: React.CSSProperties = {
    ...iconBg,
    margin: '0 auto 14px',
};

const clayIconWrap = (gradient: string): React.CSSProperties => ({
    width: '28px', height: '28px', borderRadius: '8px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: gradient,
    boxShadow: '2px 2px 5px rgba(190,24,93,0.12)',
    flexShrink: 0,
});

const ctaPrimary: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '13px 24px', borderRadius: '14px', fontWeight: 700, fontSize: '14px',
    background: 'linear-gradient(145deg, #BE185D, #9D174D)', color: '#fff',
    textDecoration: 'none',
    boxShadow: '4px 4px 12px rgba(190,24,93,0.25), inset 1px 1px 2px rgba(255,255,255,0.15)',
};

const ctaSecondary: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '13px 24px', borderRadius: '14px', fontWeight: 600, fontSize: '14px',
    background: '#fff', color: '#1A2E35', textDecoration: 'none',
    border: '1px solid rgba(0,0,0,0.08)',
    boxShadow: '2px 2px 6px rgba(0,0,0,0.04)',
};

/* ═══ Comparison Data — the shared audited module (lib/employer-comparison.ts),
   genuinely the same rows as the employer page ═══ */
const comparisonRows = EMPLOYER_COMPARISON_ROWS;

const faqs = [
    { q: 'How long is posting free?', a: `${PROMO_HEADLINE}. ${PROMO_SUB} Promo posts run the full ${config.durationDays} days even if that runs past the promo, and they can be renewed like an intro or featured post.` },
    { q: `What happens on ${config.ladderStartsLabel}?`, a: `${LADDER_LINE} ${RENEWAL_LINE} Every post, whether promo, intro, featured, or plan, gets exactly the same features. There is no stripped-down tier.` },
    { q: 'What is the intro price, and who gets it?', a: `The intro price ($${config.introPrice}) applies to the first paid post per company email domain. It is scoped to your organization, not to a login, and posts made free during the launch promo don't use it up.` },
    { q: 'How does the Employer plan work?', a: `From ${config.ladderStartsLabel}, the Employer plan is $${config.planPrice}/month. ${PLAN_TERMS} ${PLAN_POSTS_LINE} Every slot is a full Featured post with the same ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails. The plan is billed month to month. ${PLAN_CANCEL_LINE}` },
    { q: 'What does renewal cost?', a: `${RENEWAL_LINE} ${RENEWAL_EFFECT_LINE} Plan posts are not renewed: when one ends, post the role again into its slot at no extra charge.` },
    { q: 'If I renew before my posting expires, do I lose the remaining days?', a: `No. Renewing early adds ${config.durationDays} days to your current expiration date, so you don't lose any time you already have. ${RENEWAL_CAP_LINE}` },
    { q: 'Do I lose access to candidates I\'ve unlocked when my posting expires?', a: 'No. Once you\'ve unlocked a candidate (viewed their full profile), their contact info, resume, and details stay in your dashboard after the posting expires, for as long as the candidate keeps their profile visible and open to offers. To unlock new candidates or send new InMails, you will need an active posting.' },
    { q: 'Can I edit my job posting after publishing?', a: 'Yes. You can edit your posting at any time from your dashboard to update the salary, requirements, or any other details. Changes go live immediately.' },
    { q: `Need more than ${config.planSlots} active jobs at once?`, a: `Contact us at ${brand.email.support} and tell us how many roles you're hiring for. We'll work out the right arrangement for larger organizations.` },
];

export default function PricingPage() {
    // The plan is sold through a Stripe Payment Link (subscription). The CTA
    // never hands out the raw link: /api/employer/plan/subscribe signs the
    // buyer in, sends an employer who already has a plan to the dashboard,
    // and adds their account id to the link (the only key the webhook
    // attaches a plan by). While plan sales are closed — link unset or not a
    // Stripe link, ENABLE_PAID_POSTING off, or the free launch promo running
    // — the card routes to support instead (lib/employer-plan-link.ts).
    const planSaleOpen = isPlanSaleOpen();
    const planHref = planSaleOpen ? '/api/employer/plan/subscribe' : `mailto:${brand.email.support}`;
    const planCtaLabel = planSaleOpen ? 'Subscribe to the plan' : 'Ask about the plan';

    const ladder = [
        {
            key: 'intro',
            icon: <Star size={22} />,
            name: `${config.getTierLabel('intro')} post`,
            price: `$${config.introPrice}`,
            unit: '/post',
            blurb: 'Your first paid post',
            note: `First paid post per company email domain. ${config.durationDays} days. Promo posts don't use it up.`,
            cta: <Link href="/post-job" className="emp-cta-secondary" style={ctaSecondary}>Post a Job <ArrowRight size={15} /></Link>,
            featured: false,
        },
        {
            key: 'pro',
            icon: <DollarSign size={22} />,
            name: 'Featured post',
            price: `$${config.postingPrice}`,
            unit: '/post',
            blurb: 'Every post after that',
            note: `${config.durationDays} days, exactly the same features. ${RENEWAL_LINE}`,
            cta: <Link href="/post-job" className="emp-cta-secondary" style={ctaSecondary}>Post a Job <ArrowRight size={15} /></Link>,
            featured: false,
        },
        {
            key: 'plan',
            icon: <Layers size={22} />,
            name: 'Employer plan',
            price: `$${config.planPrice}`,
            unit: '/month',
            blurb: PLAN_TERMS,
            note: `Every slot is a Featured post with the same ${config.limits.candidateUnlocksPerPosting} unlocks and ${config.limits.inmailsPerPosting} InMails. ${PLAN_POSTS_LINE} ${PLAN_CANCEL_LINE}`,
            cta: <a href={planHref} className="emp-cta-primary" style={ctaPrimary}>{planCtaLabel} <ArrowRight size={15} /></a>,
            featured: true,
        },
    ];

    return (
        <>
            <BreadcrumbSchema items={[
                { name: 'Home', url: brand.baseUrl },
                { name: 'Pricing', url: `${brand.baseUrl}/pricing` },
            ]} />

            {/* FAQPage JSON-LD — derives from the SAME `faqs` array the visible
                accordion renders below, so schema and page copy cannot diverge
                (repo pattern: app/contact/page.tsx). */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        '@context': 'https://schema.org',
                        '@type': 'FAQPage',
                        mainEntity: faqs.map(({ q, a }) => ({
                            '@type': 'Question',
                            name: q,
                            acceptedAnswer: { '@type': 'Answer', text: a },
                        })),
                    }),
                }}
            />

            {/* ═══════════════════════════════════════════════════════════════
                SECTION 1: PROMO HERO + BENTO GRID (promo card is the first bento card)
                ═══════════════════════════════════════════════════════════════ */}
            <div style={{
                background: 'linear-gradient(180deg, #FFF5EE 0%, #FDE8D8 40%, #FFF5EE 100%)',
                paddingBottom: '64px',
            }}>
                <section style={{ padding: '80px 16px 48px', textAlign: 'center' }}>
                    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '8px' }}>
                            Launch Pricing
                        </p>
                        <h1 className="font-lora" style={{
                            fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.15,
                            color: '#1A2E35', marginBottom: '16px',
                        }}>
                            {PROMO_HEADLINE}
                        </h1>
                        <p style={{ fontSize: '17px', color: '#5A4A42', maxWidth: '640px', margin: '0 auto', lineHeight: 1.6 }}>
                            {PROMO_SUB}
                        </p>
                    </div>
                </section>

                {/* ─── Bento Grid with the promo card as the hero ─── */}
                <section style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 20px' }}>
                    <div className="bento-grid" style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(12, 1fr)',
                        gridTemplateRows: 'auto',
                        gap: '14px',
                    }}>

                        {/* ═══ ROW 0: PROMO HERO (full-width 12 cols) ═══ */}
                        <div className="bento-pricing-hero emp-bento-card" style={{
                            ...clayCard, gridColumn: 'span 12', padding: '0', overflow: 'hidden',
                            border: '2px solid rgba(190,24,93,0.15)',
                            position: 'relative',
                        }}>
                            <div style={{
                                position: 'absolute', top: '-1px', left: '50%', transform: 'translateX(-50%)',
                                background: 'linear-gradient(145deg, #BE185D, #9D174D)', color: '#fff',
                                fontSize: '11px', fontWeight: 700, padding: '6px 24px', borderRadius: '0 0 12px 12px',
                                textTransform: 'uppercase', letterSpacing: '0.06em',
                                boxShadow: '0 4px 12px rgba(190,24,93,0.2)',
                            }}>Launch Promo</div>

                            <div className="pricing-hero-inner" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '0' }}>
                                {/* Left — Price block */}
                                <div style={{
                                    background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                                    padding: '44px 36px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                                    borderRight: '1px solid rgba(190,24,93,0.1)',
                                }}>
                                    <div style={{ marginBottom: '16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                                            <span style={{ fontSize: '56px', fontWeight: 800, color: '#831843', lineHeight: 1 }}>$0</span>
                                            <span style={{ fontSize: '16px', color: '#BE185D', fontWeight: 500 }}>/post</span>
                                        </div>
                                        <p style={{ fontSize: '14px', color: '#BE185D', fontWeight: 700, marginTop: '6px' }}>Every post, through {config.promoEndsLabel}. No card required.</p>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(255,255,255,0.7)', borderRadius: '10px', border: '1px solid rgba(190,24,93,0.1)', marginBottom: '20px' }}>
                                        <RefreshCw size={14} style={{ color: '#BE185D', flexShrink: 0 }} />
                                        <p style={{ fontSize: '12px', color: '#831843', margin: 0, lineHeight: 1.4 }}>
                                            <strong>{RENEWAL_LINE}</strong>
                                        </p>
                                    </div>

                                    <Link href="/post-job" className="emp-cta-primary" style={{ ...ctaPrimary, padding: '14px 28px', fontSize: '15px' }}>
                                        Post a Job: Free <ArrowRight size={16} />
                                    </Link>
                                </div>

                                {/* Right — Feature checklist */}
                                <div style={{ padding: '44px 36px 36px' }}>
                                    <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Full Package on Every Post</h2>
                                    <p style={{ fontSize: '13px', color: '#5A4A42', margin: '0 0 20px', lineHeight: 1.5 }}>No tiers. No downgrades. Whether promo, intro, featured, or plan, you get everything.</p>
                                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                                        {[
                                            `${config.durationDays}-day listing`,
                                            '★ Featured badge',
                                            'Top search placement',
                                            'Highlighted in job alerts',
                                            `${config.limits.candidateUnlocksPerPosting} candidate unlocks`,
                                            `${config.limits.inmailsPerPosting} InMails`,
                                            'Full analytics dashboard',
                                            'Up to 5 screening questions',
                                        ].map(feat => (
                                            <li key={feat} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: '#1A2E35' }}>
                                                <Check size={15} style={{ color: '#BE185D', flexShrink: 0 }} /> {feat}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        {/* ═══ ROW 1: 60-Day Listing (8 cols) + Featured Badge (4 cols) ═══ */}
                        <div className="bento-hero-1 emp-bento-card" style={{
                            ...clayCard, gridColumn: 'span 8', padding: '0', overflow: 'hidden',
                            display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center',
                        }}>
                            <div style={{ padding: '32px 28px' }}>
                                <div style={iconBg}>
                                    <Calendar size={24} />
                                </div>
                                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>{config.durationDays}-Day Listing</h3>
                                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                                    Every post runs {config.durationDays} days with no daily budget and no bidding, promo posts included. Plan posts run the same {config.durationDays} days and come down sooner only if the plan ends.
                                </p>
                            </div>
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', padding: '16px' }}>
                                <Image src="/images/employers/bento-60day.webp" alt="60-day job listing calendar" width={280} height={200} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
                            </div>
                        </div>

                        <div className="bento-hero-2 emp-bento-card" style={{
                            ...clayCard, gridColumn: 'span 4', padding: '0', overflow: 'hidden',
                            display: 'flex', flexDirection: 'column',
                        }}>
                            <div style={{ flex: '0 0 auto', background: 'linear-gradient(145deg, #FFFBEB, #FEF3C7)', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Image src="/images/employers/bento-featured.webp" alt="Featured badge on job listing" width={200} height={140} style={{ width: '100%', maxWidth: '200px', height: 'auto', borderRadius: '10px' }} />
                            </div>
                            <div style={{ padding: '24px 22px', flex: 1 }}>
                                <div style={iconBg}>
                                    <Star size={22} />
                                </div>
                                <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#1A2E35', margin: '0 0 6px' }}>Featured Badge</h3>
                                <p style={{ fontSize: '12.5px', color: '#7A6A62', margin: 0, lineHeight: 1.5 }}>
                                    Stand out with a prominent Featured tag on your listing and in search results.
                                </p>
                            </div>
                        </div>

                        {/* ═══ ROW 2: 4 compact cards ═══ */}
                        <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
                            <div style={iconBgCentered}>
                                <TrendingUp size={22} />
                            </div>
                            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Top Search Placement</h3>
                            <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Featured listings rank higher, which means more visibility and more clicks.</p>
                        </div>

                        <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
                            <div style={iconBgCentered}>
                                <Mail size={22} />
                            </div>
                            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>Daily Job Alerts</h3>
                            <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Highlighted in daily email digests to opted-in {brand.niche.short}s.</p>
                        </div>

                        <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
                            <div style={iconBgCentered}>
                                <Users size={22} />
                            </div>
                            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>{config.limits.candidateUnlocksPerPosting} Candidate Unlocks</h3>
                            <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>View full profiles: contact info, resume, and LinkedIn.</p>
                        </div>

                        <div className="emp-bento-card" style={{ ...clayCard, gridColumn: 'span 3', padding: '24px 18px', textAlign: 'center' }}>
                            <div style={iconBgCentered}>
                                <Briefcase size={22} />
                            </div>
                            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1A2E35', margin: '0 0 6px' }}>{config.limits.inmailsPerPosting} InMails</h3>
                            <p style={{ fontSize: '12px', color: '#7A6A62', margin: 0, lineHeight: 1.55 }}>Message candidates directly, with no guessing at email addresses.</p>
                        </div>

                        {/* ═══ ROW 3: Analytics (12 cols full-width) ═══ */}
                        <div className="bento-hero-3 emp-bento-card" style={{
                            ...clayCard, gridColumn: 'span 12', padding: '0', overflow: 'hidden',
                            display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center',
                        }}>
                            <div style={{ padding: '32px 28px' }}>
                                <div style={iconBg}>
                                    <BarChart3 size={24} />
                                </div>
                                <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#1A2E35', margin: '0 0 8px' }}>Live Analytics</h3>
                                <p style={{ fontSize: '14px', color: '#5A4A42', margin: 0, lineHeight: 1.6 }}>
                                    Track views, clicks, and applications in real time. See exactly where your candidates come from.
                                </p>
                            </div>
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #FFF7ED, #FFEDD5)', padding: '16px' }}>
                                <Image src="/images/employers/bento-analytics.webp" alt="Analytics dashboard with charts" width={280} height={200} style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '12px' }} />
                            </div>
                        </div>

                    </div>
                </section>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                SECTION 2: THE 2027 LADDER — three cards, same features on every rung
                ═══════════════════════════════════════════════════════════════ */}
            <section style={{ background: '#FFF', padding: '80px 20px' }}>
                <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                        After the launch period
                    </p>
                    <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>
                        Starting {config.ladderStartsLabel}
                    </h2>
                    <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '640px', margin: '0 auto 12px', lineHeight: 1.6 }}>
                        {LADDER_LINE}
                    </p>
                    <p style={{ fontSize: '13px', color: '#7A6A62', textAlign: 'center', maxWidth: '640px', margin: '0 auto 40px', lineHeight: 1.6 }}>
                        Until then, every post is free, and every rung gets the same package: {FEATURES_LINE}.
                    </p>

                    <div className="pricing-ladder-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px', alignItems: 'stretch' }}>
                        {ladder.map((rung) => (
                            <div
                                key={rung.key}
                                className="emp-bento-card"
                                style={{
                                    ...clayCard,
                                    padding: '30px 26px 26px',
                                    display: 'flex', flexDirection: 'column',
                                    ...(rung.featured
                                        ? { background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)', border: '2px solid rgba(190,24,93,0.2)' }
                                        : {}),
                                }}
                            >
                                <div style={{ ...iconBg, ...(rung.featured ? { background: 'rgba(190,24,93,0.1)', color: '#BE185D' } : {}) }}>
                                    {rung.icon}
                                </div>
                                <h3 style={{ fontSize: '16px', fontWeight: 800, color: rung.featured ? '#831843' : '#1A2E35', margin: '0 0 8px' }}>{rung.name}</h3>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '40px', fontWeight: 800, color: '#831843', lineHeight: 1 }}>{rung.price}</span>
                                    <span style={{ fontSize: '14px', color: '#BE185D', fontWeight: 500 }}>{rung.unit}</span>
                                </div>
                                <p style={{ fontSize: '13.5px', color: '#1A2E35', fontWeight: 600, margin: '0 0 8px', lineHeight: 1.5 }}>{rung.blurb}</p>
                                <p style={{ fontSize: '12.5px', color: '#5A4A42', margin: '0 0 20px', lineHeight: 1.55, flex: 1 }}>{rung.note}</p>
                                {rung.cta}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ═══════════════════════════════════════════════════════════════
                SECTION 3: COMPARISON + CTA (split screen, same as employer)
                ═══════════════════════════════════════════════════════════════ */}
            <section style={{ background: 'linear-gradient(180deg, #F1F5F9 0%, #E8EDF2 50%, #F1F5F9 100%)', padding: '80px 20px' }}>
                <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                        Why Switch
                    </p>
                    <h2 className="font-lora" style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '8px' }}>
                        How We Compare
                    </h2>
                    <p style={{ fontSize: '15px', color: '#5A4A42', textAlign: 'center', maxWidth: '440px', margin: '0 auto 44px', lineHeight: 1.6 }}>
                        An honest look at what you get, with no cherry-picking.
                    </p>

                    {/* Split: Table (left) + CTA Card (right) */}
                    <div className="emp-compare-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}>

                        {/* LEFT — Comparison Table */}
                        <div className="emp-compare-table" style={{ ...clayCard, padding: '0', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
                                <thead>
                                    <tr style={{ background: 'linear-gradient(135deg, rgba(190,24,93,0.08), rgba(190,24,93,0.02))' }}>
                                        <th style={{ width: '40%', padding: '16px 24px', textAlign: 'left', fontWeight: 600, color: '#64748B', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                                        <th style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 800, color: '#BE185D', borderBottom: '2px solid rgba(190,24,93,0.2)', fontSize: '12px' }}>{brand.name}</th>
                                        <th style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 600, color: '#94A3B8', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px' }}>Indeed</th>
                                        <th style={{ width: '20%', padding: '16px 16px', textAlign: 'center', fontWeight: 600, color: '#94A3B8', borderBottom: '2px solid rgba(0,0,0,0.06)', fontSize: '12px' }}>LinkedIn</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {comparisonRows.map((row, i) => {
                                        const renderCell = (val: true | false | 'partial', isUs: boolean) => {
                                            if (val === true) return <Check size={16} style={{ color: isUs ? '#BE185D' : '#94A3B8', display: 'block', margin: '0 auto' }} />;
                                            if (val === 'partial') return <span style={{ fontSize: '11px', color: '#F59E0B', fontWeight: 600 }}>Partial</span>;
                                            return <X size={16} style={{ color: '#D1D5DB', display: 'block', margin: '0 auto' }} />;
                                        };
                                        return (
                                            <tr key={row.feature} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                                                <td style={{ padding: '12px 24px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    <span style={{ color: '#1A2E35', fontWeight: 500 }}>{row.feature}</span>
                                                    {row.note && <span style={{ display: 'block', fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>{row.note}</span>}
                                                </td>
                                                <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(190,24,93,0.03)' }}>
                                                    {renderCell(row.us, true)}
                                                </td>
                                                <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    {renderCell(row.indeed, false)}
                                                </td>
                                                <td style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                                                    {renderCell(row.linkedin, false)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* RIGHT — Vertical CTA Card (image top, content bottom) */}
                        <div style={{
                            ...clayCard, padding: '0', overflow: 'hidden',
                            display: 'flex', flexDirection: 'column',
                        }}>
                            <div style={{
                                background: 'linear-gradient(145deg, #FDF2F8, #FCE7F3)',
                                padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                {/* Exact-DPR ladder (scripts/regen-image-ladders.mjs) so the
                                    browser paints 1:1 physical pixels at every display
                                    scaling — same asset + pattern as the /for-employers CTA
                                    card (the old Supabase cta-illustration.webp 400s). */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src="/images/employers/cta-illustration-v2-520.webp"
                                    srcSet={[260, 325, 390, 455, 520, 585, 650, 780]
                                        .map((w) => `/images/employers/cta-illustration-v2-${w}.webp ${w}w`)
                                        .join(', ')}
                                    sizes="260px"
                                    alt={`Successful ${brand.niche.short} hiring celebration`}
                                    width={260} height={260}
                                    style={{ width: '100%', maxWidth: '260px', height: 'auto', borderRadius: '14px', display: 'block' }}
                                    loading="lazy"
                                    decoding="async"
                                />
                            </div>
                            <div style={{ padding: '28px 24px' }}>
                                <h3 className="font-lora" style={{
                                    fontSize: '20px', fontWeight: 700,
                                    color: '#1A2E35', margin: '0 0 10px',
                                }}>
                                    Ready to Hire Your{' '}
                                    <span style={{ color: '#BE185D' }}>Next {brand.niche.short}</span>?
                                </h3>
                                <p style={{ fontSize: '13px', color: '#5A4A42', lineHeight: 1.6, margin: '0 0 20px' }}>
                                    Every post is free through {config.promoEndsLabel}, with all features included. From{' '}
                                    {config.ladderStartsLabel}, from ${config.introPrice}.
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <Link href="/post-job" className="emp-cta-primary" style={{ ...ctaPrimary, borderRadius: '12px', padding: '12px 24px' }}>
                                        Post a Job: Free <ArrowRight size={15} />
                                    </Link>
                                    <Link href="/contact" className="emp-cta-secondary" style={{ ...ctaSecondary, borderRadius: '12px', padding: '12px 24px' }}>
                                        Contact Sales
                                    </Link>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </section>

            {/* ═══════════════════════════════════════════════════════════════
                SECTION 4: FAQ
                ═══════════════════════════════════════════════════════════════ */}
            <section style={{ padding: '80px 16px', background: '#FFF' }}>
                <div style={{ maxWidth: '700px', margin: '0 auto' }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.15em', textAlign: 'center', marginBottom: '8px' }}>
                        Common Questions
                    </p>
                    <h2 className="font-lora" style={{ fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 700, color: '#1A2E35', textAlign: 'center', marginBottom: '32px' }}>Frequently Asked Questions</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {faqs.map(({ q, a }) => (
                            <details key={q} style={{ ...clayCard, padding: 0, overflow: 'hidden' }}>
                                <summary style={{
                                    padding: '18px 24px', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    fontSize: '15px', fontWeight: 600, color: '#1A2E35', listStyle: 'none',
                                }}>
                                    <div style={{ ...clayIconWrap('linear-gradient(145deg, #BE185D, #9D174D)') }}>
                                        <HelpCircle size={14} color="#fff" />
                                    </div>
                                    {q}
                                </summary>
                                <div style={{ padding: '0 24px 18px 64px', fontSize: '14px', color: '#5A4A42', lineHeight: 1.65 }}>{a}</div>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {/* ═══ Responsive + Hover ═══ */}
            <style>{`
                .emp-cta-primary {
                    transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease;
                }
                .emp-cta-primary:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 10px 32px rgba(190,24,93,0.35), inset 1px 1px 2px rgba(255,255,255,0.2) !important;
                    filter: brightness(1.05);
                }
                .emp-cta-secondary {
                    transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
                }
                .emp-cta-secondary:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(0,0,0,0.08) !important;
                    border-color: rgba(190,24,93,0.3) !important;
                }
                .emp-bento-card {
                    transition: transform 0.3s ease, box-shadow 0.3s ease;
                }
                .emp-bento-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 8px 8px 24px rgba(0,0,0,0.1), -4px -4px 12px rgba(255,255,255,0.9), inset 1px 1px 2px rgba(255,255,255,0.6) !important;
                }
                .emp-compare-table tr {
                    transition: background 0.2s ease;
                }
                .emp-compare-table tbody tr:hover {
                    background: rgba(190,24,93,0.04) !important;
                }

                @media (max-width: 768px) {
                    .emp-compare-grid { grid-template-columns: 1fr !important; }
                    .pricing-ladder-grid { grid-template-columns: 1fr !important; }
                    .bento-grid { grid-template-columns: 1fr !important; }
                    .bento-hero-1, .bento-hero-2, .bento-hero-3, .bento-pricing-hero {
                        grid-column: span 1 !important;
                    }
                    .bento-hero-1, .bento-hero-3 {
                        grid-template-columns: 1fr !important;
                    }
                    .pricing-hero-inner {
                        grid-template-columns: 1fr !important;
                    }
                    .bento-grid > div { grid-column: span 1 !important; }
                }
                @media (min-width: 769px) and (max-width: 1024px) {
                    .bento-grid { grid-template-columns: repeat(6, 1fr) !important; }
                    .bento-hero-1, .bento-hero-3, .bento-pricing-hero { grid-column: span 6 !important; }
                    .bento-hero-2 { grid-column: span 6 !important; }
                    .pricing-hero-inner {
                        grid-template-columns: 1fr !important;
                    }
                    .bento-grid > div:not(.bento-hero-1):not(.bento-hero-2):not(.bento-hero-3):not(.bento-pricing-hero) {
                        grid-column: span 3 !important;
                    }
                }
            `}</style>
        </>
    );
}
